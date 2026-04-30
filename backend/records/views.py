from __future__ import annotations

import json
from pathlib import PurePosixPath
from typing import Dict, List, Optional

from django.http import FileResponse, Http404, HttpResponseBadRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods, require_POST
from urllib.parse import quote

from .services import (
    RecordError,
    WorkspaceError,
    batch_update_items_metadata,
    commit_staged_record_upload,
    create_records_from_file_batch,
    create_records_from_upload,
    create_workspace,
    delete_workspace,
    delete_record,
    discard_staged_record_upload,
    export_workspace_to_zip,
    filter_items,
    get_active_workspace,
    get_item,
    get_item_completed,
    get_item_metadata,
    get_workspace,
    get_record,
    get_record_metadata_payload,
    iter_items,
    import_workspace_from_upload,
    list_metadata_templates,
    list_records,
    list_workspaces,
    load_annotations,
    load_workspace_info,
    paginate_items,
    preview_records_from_file_batch,
    preview_records_from_upload,
    set_item_completed,
    update_item_metadata,
    update_record_metadata,
    update_workspace_info,
    save_annotations,
    set_active_workspace,
    clear_record_annotations,
)
from .thumbnails import ensure_thumbnail


def _workspace_payload(workspace) -> Dict:
    records_dir = workspace.path / "records"
    record_count = 0
    page_count = 0
    info = load_workspace_info(workspace)
    if records_dir.exists():
        for record_dir in records_dir.iterdir():
            if not record_dir.is_dir():
                continue
            record_count += 1
            pages_dir = record_dir / "pages"
            if not pages_dir.exists():
                continue
            page_count += sum(1 for f in pages_dir.rglob("*") if f.is_file())
    return {
        "slug": workspace.slug,
        "title": info.get("title"),
        "path": str(workspace.path),
        "records": record_count,
        "pages": page_count,
    }


def _record_payload(record) -> Dict:
    return record.to_dict()


def _active_workspace_or_400():
    workspace = get_active_workspace()
    if workspace is None:
        raise WorkspaceError("No workspace selected.")
    return workspace


@require_GET
def available_workspaces(request):
    workspaces = [
        _workspace_payload(workspace) for workspace in list_workspaces()
    ]
    return JsonResponse({"ok": True, "workspaces": workspaces})


@require_GET
def current_workspace(request):
    workspace = get_active_workspace()
    if workspace is None:
        return JsonResponse({"ok": True, "workspace": None})
    return JsonResponse({"ok": True, "workspace": _workspace_payload(workspace)})


@csrf_exempt
@require_POST
def open_workspace(request):
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    slug = payload.get("workspace") or payload.get("slug")
    if not slug:
        return HttpResponseBadRequest("Missing 'workspace' field.")

    try:
        workspace = set_active_workspace(slug)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    return JsonResponse({"ok": True, "workspace": _workspace_payload(workspace)})


@csrf_exempt
@require_POST
def create_workspace_view(request):
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    slug = payload.get("slug")
    if not slug:
        return HttpResponseBadRequest("Missing 'slug' field.")

    title = payload.get("title")

    try:
        workspace = create_workspace(slug, title=title)
        return JsonResponse({"ok": True, "workspace": _workspace_payload(workspace)}, status=201)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)


@csrf_exempt
@require_POST
def import_workspace_view(request):
    upload_file = request.FILES.get("file")
    if upload_file is None:
        return JsonResponse({"ok": False, "error": "Missing 'file' upload."}, status=400)

    workspace_name = request.POST.get("name") or request.POST.get("title") or request.POST.get("slug")
    try:
        result = import_workspace_from_upload(
            upload_file=upload_file,
            workspace_name=workspace_name,
        )
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    return JsonResponse(
        {
            "ok": True,
            "workspace": _workspace_payload(result.workspace),
            "summary": {
                "imported": result.imported,
                "skipped": result.skipped,
                "failed": result.failed,
                "failures": list(result.failures),
            },
        },
        status=201,
    )


@require_GET
def export_workspace_view(request, slug: str):
    try:
        workspace = get_workspace(slug)
        archive_path = export_workspace_to_zip(workspace)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    archive = archive_path.open("rb")
    response = FileResponse(
        archive,
        content_type="application/zip",
        as_attachment=True,
        filename=f"{workspace.slug}.zip",
    )
    response._resource_closers.append(lambda: archive_path.unlink(missing_ok=True))
    return response


@csrf_exempt
@require_http_methods(["PATCH", "PUT", "DELETE"])
def update_workspace(request, slug: str):
    try:
        workspace = get_workspace(slug)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    if request.method == "DELETE":
        try:
            delete_workspace(workspace.slug)
        except WorkspaceError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        return JsonResponse({"ok": True, "deleted": workspace.slug})

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    if "title" not in payload:
        return HttpResponseBadRequest("Missing 'title' field.")

    title = payload.get("title")
    try:
        update_workspace_info(workspace.slug, title=title)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    refreshed = get_workspace(slug)
    return JsonResponse({"ok": True, "workspace": _workspace_payload(refreshed)})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def records_root(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    if request.method == "GET":
        records = [_record_payload(record) for record in list_records(workspace)]
        return JsonResponse({"ok": True, "records": records})

    slug = request.POST.get("slug") or request.POST.get("name")
    title = request.POST.get("title")
    upload_file = request.FILES.get("file")
    upload_files = request.FILES.getlist("files")

    try:
        if upload_file is not None:
            upload_result = create_records_from_upload(
                workspace,
                upload_file=upload_file,
                slug=slug,
                title=title,
            )
        elif upload_files:
            upload_result = create_records_from_file_batch(
                workspace,
                upload_files=upload_files,
                relative_paths=request.POST.getlist("relative_paths"),
                root_name=request.POST.get("root_name"),
                slug=slug,
                title=title,
            )
        else:
            return JsonResponse({"ok": False, "error": "Missing 'file' upload."}, status=400)
    except RecordError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    primary_record = upload_result.records[0] if upload_result.records else None
    return JsonResponse(
        {
            "ok": True,
            "record": _record_payload(primary_record) if primary_record else None,
            "records": [_record_payload(record) for record in upload_result.records],
            "summary": {
                "imported": upload_result.imported,
                "skipped": upload_result.skipped,
                "failed": upload_result.failed,
                "failures": list(upload_result.failures),
            },
        },
        status=201,
    )


@csrf_exempt
@require_POST
def record_upload_preview_view(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    slug = request.POST.get("slug") or request.POST.get("name")
    title = request.POST.get("title")
    upload_file = request.FILES.get("file")
    upload_files = request.FILES.getlist("files")

    try:
        if upload_file is not None:
            preview = preview_records_from_upload(
                workspace,
                upload_file=upload_file,
                slug=slug,
                title=title,
            )
        elif upload_files:
            preview = preview_records_from_file_batch(
                workspace,
                upload_files=upload_files,
                relative_paths=request.POST.getlist("relative_paths"),
                root_name=request.POST.get("root_name"),
                slug=slug,
                title=title,
            )
        else:
            return JsonResponse({"ok": False, "error": "Missing 'file' upload."}, status=400)
    except RecordError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    return JsonResponse(
        {
            "ok": True,
            "upload_id": preview.upload_id,
            "plan": _record_upload_plan_payload(preview.plan),
        }
    )


@csrf_exempt
@require_POST
def record_upload_commit_view(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    upload_id = payload.get("upload_id")
    try:
        upload_result = commit_staged_record_upload(workspace, upload_id=upload_id)
    except RecordError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    primary_record = upload_result.records[0] if upload_result.records else None
    return JsonResponse(
        {
            "ok": True,
            "record": _record_payload(primary_record) if primary_record else None,
            "records": [_record_payload(record) for record in upload_result.records],
            "summary": {
                "imported": upload_result.imported,
                "skipped": upload_result.skipped,
                "failed": upload_result.failed,
                "failures": list(upload_result.failures),
            },
        },
        status=201,
    )


@csrf_exempt
@require_POST
def record_upload_cancel_view(request):
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    upload_id = payload.get("upload_id")
    try:
        discard_staged_record_upload(upload_id=upload_id)
    except RecordError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    return JsonResponse({"ok": True})


def _record_upload_plan_payload(plan):
    return {
        "title": plan.title,
        "new_page_count": plan.new_page_count,
        "skipped_count": plan.skipped_count,
        "records": [
            {
                "title": record.title,
                "new_page_count": record.new_page_count,
                "skipped_count": record.skipped_count,
            }
            for record in plan.records
        ],
    }


def _item_payload(workspace, item):
    rel_path = item.rel_path.as_posix()
    thumbnail_url = f"/api/v1/items/thumbnail?path={quote(rel_path, safe='')}"
    original_url = f"/api/v1/items/raw?path={quote(rel_path, safe='')}"
    completed = get_item_completed(workspace, item.id)
    return {
        "id": item.id,
        "record": item.record,
        "filename": item.filename,
        "relative_path": rel_path,
        "thumbnail_url": thumbnail_url,
        "original_url": original_url,
        "completed": completed,
    }


@require_GET
def list_items_view(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    record_filter = request.GET.get("record")

    try:
        page = int(request.GET.get("page", "1"))
    except ValueError:
        return HttpResponseBadRequest("Invalid 'page'.")

    try:
        page_size = int(request.GET.get("page_size", "20"))
    except ValueError:
        return HttpResponseBadRequest("Invalid 'page_size'.")

    page = max(1, page)
    page_size = max(1, min(page_size, 100))

    query = request.GET.get("q")
    sort = request.GET.get("sort")
    try:
        items_iter = iter_items(workspace, record_slug=record_filter)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    items = filter_items(items_iter, query=query, sort=sort)
    total_count = len(items)
    paginated = paginate_items(items, page=page, page_size=page_size)

    return JsonResponse(
        {
            "ok": True,
            "items": [_item_payload(workspace, item) for item in paginated],
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total_count,
            },
        }
    )


def _resolve_request_path(request) -> Optional[PurePosixPath]:
    path_value = request.GET.get("path")
    if not path_value:
        return None
    try:
        relative = PurePosixPath(path_value)
    except ValueError:
        return None
    if relative.is_absolute() or ".." in relative.parts:
        return None
    return relative


@require_GET
def item_thumbnail(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    relative = _resolve_request_path(request)
    if relative is None:
        return HttpResponseBadRequest("Missing or invalid 'path'.")

    source = workspace.path / relative
    if not source.exists():
        raise Http404("Page not found.")

    thumbnail_path = ensure_thumbnail(workspace, relative)
    return FileResponse(thumbnail_path.open("rb"), content_type="image/jpeg")


@require_GET
def item_original(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    relative = _resolve_request_path(request)
    if relative is None:
        return HttpResponseBadRequest("Missing or invalid 'path'.")

    source = workspace.path / relative
    if not source.exists():
        raise Http404("Page not found.")

    content_type = "image/jpeg"
    suffix = source.suffix.lower()
    if suffix in {".png"}:
        content_type = "image/png"
    elif suffix in {".tif", ".tiff"}:
        content_type = "image/tiff"

    return FileResponse(source.open("rb"), content_type=content_type)


@csrf_exempt
@require_http_methods(["GET", "DELETE"])
def record_detail_view(request, record_slug: str):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    if request.method == "DELETE":
        try:
            delete_record(workspace, record_slug)
        except RecordError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=404)
        return JsonResponse({"ok": True, "message": f"Record '{record_slug}' deleted successfully."})

    # GET request
    try:
        record = get_record(workspace, record_slug)
    except RecordError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    try:
        items_iter = iter_items(workspace, record_slug=record_slug)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    pages = [_item_payload(workspace, item) for item in items_iter]
    record_payload = _record_payload(record)
    record_payload["pages"] = pages
    record_payload["page_count"] = len(pages)
    return JsonResponse({"ok": True, "record": record_payload})


@csrf_exempt
@require_http_methods(["GET", "PUT"])
def item_annotations_view(request, item_id: str):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    try:
        get_item(workspace, item_id)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    if request.method == "GET":
        payload = load_annotations(workspace, item_id)
        return JsonResponse({"ok": True, **payload})

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    if not isinstance(data, dict):
        return HttpResponseBadRequest("Payload must be a JSON object.")

    if "annotations" in data and not isinstance(data["annotations"], list):
        return HttpResponseBadRequest("'annotations' must be an array.")

    saved = save_annotations(workspace, item_id, data)
    return JsonResponse({"ok": True, **saved})


@csrf_exempt
@require_http_methods(["PATCH"])
def item_completed_view(request, item_id: str):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    try:
        get_item(workspace, item_id)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    completed = bool(data.get("completed", False))
    set_item_completed(workspace, item_id, completed)
    return JsonResponse({"ok": True, "completed": completed})


@csrf_exempt
@require_http_methods(["POST"])
def record_annotations_clear_view(request, record_slug: str):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    try:
        get_record(workspace, record_slug)
    except RecordError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    cleared = clear_record_annotations(workspace, record_slug)
    return JsonResponse({"ok": True, "cleared": cleared})


@csrf_exempt
@require_http_methods(["GET", "PUT"])
def record_metadata_view(request, record_slug: str):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    try:
        # 確認 record 存在
        get_record(workspace, record_slug)
    except RecordError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    if request.method == "GET":
        metadata_payload = get_record_metadata_payload(workspace, record_slug)
        templates = list_metadata_templates(workspace)
        return JsonResponse(
            {
                "ok": True,
                "metadata": metadata_payload,
                "templates": templates,
            }
        )

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    if not isinstance(data, dict):
        return HttpResponseBadRequest("Payload must be a JSON object.")

    template_value = data.get("template")
    if template_value is not None and not isinstance(template_value, str):
        return HttpResponseBadRequest("'template' must be a string or null.")
    values = data.get("values")
    if values is None:
        values = data.get("metadata")
    if values is None:
        values = {}
    if not isinstance(values, dict):
        return HttpResponseBadRequest("'values' must be a JSON object.")

    updated = update_record_metadata(
        workspace,
        record_slug,
        template=template_value,
        values=values,
    )
    templates = list_metadata_templates(workspace)
    return JsonResponse(
        {
            "ok": True,
            "metadata": updated,
            "templates": templates,
        }
    )


@csrf_exempt
@require_http_methods(["GET", "PUT"])
def item_metadata_view(request, item_id: str):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    try:
        get_item(workspace, item_id)
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=404)

    if request.method == "GET":
        metadata_payload = get_item_metadata(workspace, item_id)
        return JsonResponse({"ok": True, "metadata": metadata_payload})

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    if not isinstance(data, dict):
        return HttpResponseBadRequest("Payload must be a JSON object.")

    metadata_body = data.get("metadata")
    if metadata_body is None:
        metadata_body = data.get("values")
    if metadata_body is None:
        metadata_body = {}
    if not isinstance(metadata_body, dict):
        return HttpResponseBadRequest("'metadata' must be a JSON object.")

    mode = data.get("mode") or "merge"
    merge = True
    if isinstance(mode, str):
        merge = mode.lower() != "replace"
    elif isinstance(mode, bool):
        merge = mode

    updated = update_item_metadata(
        workspace,
        item_id,
        metadata_body,
        merge=merge,
    )
    return JsonResponse({"ok": True, "metadata": updated, "mode": "merge" if merge else "replace"})


@csrf_exempt
@require_http_methods(["PUT"])
def item_metadata_batch_view(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    if not isinstance(data, dict):
        return HttpResponseBadRequest("Payload must be a JSON object.")

    items_payload = data.get("items")
    if not isinstance(items_payload, list) or not items_payload:
        return HttpResponseBadRequest("'items' must be a non-empty array.")

    record_slug = data.get("record")
    if record_slug is not None and not isinstance(record_slug, str):
        return HttpResponseBadRequest("'record' must be a string when provided.")

    normalized_items: List[str] = []
    for raw_item in items_payload:
        if not isinstance(raw_item, str) or not raw_item.strip():
            return HttpResponseBadRequest("Each item in 'items' must be a non-empty string.")
        raw_item = raw_item.strip()
        if "/" in raw_item:
            normalized_items.append(raw_item)
        else:
            if not record_slug:
                return HttpResponseBadRequest(
                    "Item identifiers must include record slug (record/page) 或提供 'record' 欄位。"
                )
            normalized_items.append(f"{record_slug}/{raw_item}")

    # 去除重複
    normalized_items = list(dict.fromkeys(normalized_items))

    metadata_body = data.get("metadata")
    if metadata_body is None:
        metadata_body = data.get("values")
    if metadata_body is None:
        metadata_body = {}
    if not isinstance(metadata_body, dict):
        return HttpResponseBadRequest("'metadata' must be a JSON object.")

    mode = data.get("mode") or "merge"
    merge = True
    if isinstance(mode, str):
        merge = mode.lower() != "replace"
    elif isinstance(mode, bool):
        merge = mode

    result = batch_update_items_metadata(
        workspace,
        normalized_items,
        metadata_body,
        merge=merge,
    )
    status_code = 207 if result["failed"] else 200
    return JsonResponse(
        {
            "ok": True,
            "mode": "merge" if merge else "replace",
            **result,
        },
        status=status_code,
    )
