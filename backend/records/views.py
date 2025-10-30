from __future__ import annotations

import json
from pathlib import PurePosixPath
from typing import Dict, Optional

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponseBadRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods, require_POST
from urllib.parse import quote

from .services import (
    WorkspaceError,
    filter_items,
    get_active_workspace,
    get_workspace,
    iter_items,
    list_workspaces,
    paginate_items,
    set_active_workspace,
)
from .thumbnails import ensure_thumbnail


def _workspace_payload(workspace) -> Dict:
    records_dir = workspace.path / "records"
    record_count = 0
    page_count = 0
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
        "path": str(workspace.path),
        "records": record_count,
        "pages": page_count,
    }


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


def _item_payload(workspace, item):
    rel_path = item.rel_path.as_posix()
    thumbnail_url = f"/api/v1/items/thumbnail?path={quote(rel_path, safe='')}"
    original_url = f"/api/v1/items/raw?path={quote(rel_path, safe='')}"
    return {
        "id": item.id,
        "record": item.record,
        "filename": item.filename,
        "relative_path": rel_path,
        "thumbnail_url": thumbnail_url,
        "original_url": original_url,
    }


@require_GET
def list_items_view(request):
    try:
        workspace = _active_workspace_or_400()
    except WorkspaceError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)

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

    items = filter_items(iter_items(workspace), query=query, sort=sort)
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
