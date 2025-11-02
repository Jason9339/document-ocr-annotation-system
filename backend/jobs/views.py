from __future__ import annotations

import json
from typing import Optional

from django.http import HttpResponseBadRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from jobs.models import Job
from jobs.queue import get_queue
from jobs.services import create_job, get_job, list_jobs, serialize_job
from jobs.tasks import run_record_ocr_job
from records.services import RecordError, WorkspaceError, get_active_workspace, get_record


def _json_error(message: str, *, status: int = 400) -> JsonResponse:
    return JsonResponse({"ok": False, "error": message}, status=status)


def _get_active_workspace_or_error() -> Optional[tuple]:
    workspace = get_active_workspace()
    if workspace is None:
        raise WorkspaceError("請先選擇工作區")
    return workspace


def _job_payload(job: Job, *, status: int = 200) -> JsonResponse:
    return JsonResponse({"ok": True, "job": serialize_job(job)}, status=status)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def jobs_collection(request):
    if request.method == "GET":
        status_filter = request.GET.get("status") or None
        limit_param = request.GET.get("limit")
        limit = None
        if limit_param:
            try:
                limit = max(1, min(int(limit_param), 100))
            except ValueError:
                return HttpResponseBadRequest("Invalid 'limit'.")

        jobs = list_jobs(status=status_filter, limit=limit)
        return JsonResponse({"ok": True, "jobs": [serialize_job(job) for job in jobs]})

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON payload.")

    job_type = payload.get("job_type") or "ocr"
    record_slug = payload.get("record") or payload.get("record_slug")
    if not record_slug:
        return HttpResponseBadRequest("Missing 'record' field.")

    try:
        workspace = _get_active_workspace_or_error()
    except WorkspaceError as exc:
        return _json_error(str(exc), status=400)

    try:
        record = get_record(workspace, record_slug)
    except RecordError as exc:
        return _json_error(str(exc), status=404)

    created_by = request.user.username if getattr(request, "user", None) and request.user.is_authenticated else ""
    job = create_job(
        workspace_slug=workspace.slug,
        record_slug=record.slug,
        record_title=record.title,
        job_type=job_type,
        created_by=created_by,
    )

    queue = get_queue()
    rq_job = queue.enqueue(
        run_record_ocr_job,
        str(job.id),
        workspace.slug,
        record.slug,
    )
    job.rq_job_id = rq_job.id
    job.save(update_fields=["rq_job_id", "updated_at"])

    return _job_payload(job, status=201)


@require_GET
def job_detail(request, job_id: str):
    try:
        job = get_job(job_id)
    except Job.DoesNotExist:
        return _json_error("Job not found.", status=404)
    return _job_payload(job)


@csrf_exempt
@require_POST
def job_retry(request, job_id: str):
    try:
        job = get_job(job_id)
    except Job.DoesNotExist:
        return _json_error("Job not found.", status=404)

    if job.status not in (Job.Status.FAILED, Job.Status.CANCELED, Job.Status.FINISHED):
        return _json_error("Job is still in progress.", status=400)

    job.status = Job.Status.PENDING
    job.error_message = ""
    job.progress = 0
    job.started_at = None
    job.finished_at = None
    job.save(update_fields=["status", "error_message", "progress", "started_at", "finished_at", "updated_at"])

    queue = get_queue()
    rq_job = queue.enqueue(
        run_record_ocr_job,
        str(job.id),
        job.workspace_slug,
        job.record_slug,
    )
    job.rq_job_id = rq_job.id
    job.save(update_fields=["rq_job_id", "updated_at"])

    return _job_payload(job)


@csrf_exempt
@require_POST
def job_cancel(request, job_id: str):
    try:
        job = get_job(job_id)
    except Job.DoesNotExist:
        return _json_error("Job not found.", status=404)

    if job.status not in (Job.Status.PENDING, Job.Status.RUNNING):
        return _job_payload(job)

    queue = get_queue()
    if job.rq_job_id:
        rq_job = queue.fetch_job(job.rq_job_id)
        if rq_job and rq_job.get_status(refresh=False) in {"queued", "deferred"}:
            rq_job.cancel()

    job.status = Job.Status.CANCELED
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "finished_at", "updated_at"])
    return _job_payload(job)
