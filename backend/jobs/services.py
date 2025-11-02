from __future__ import annotations

from typing import Iterable, List, Optional

from django.db import transaction
from django.utils import timezone

from .models import Job


def serialize_job(job: Job) -> dict:
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "progress": job.progress,
        "record_slug": job.record_slug,
        "record_title": job.record_title,
        "workspace": job.workspace_slug,
        "created_by": job.created_by,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "rq_job_id": job.rq_job_id or None,
        "error": job.error_message or None,
        "payload": job.payload or {},
    }


def create_job(
    *,
    workspace_slug: str,
    record_slug: str,
    record_title: str,
    job_type: str = "ocr",
    created_by: Optional[str] = None,
    payload: Optional[dict] = None,
) -> Job:
    with transaction.atomic():
        job = Job.objects.create(
            workspace_slug=workspace_slug,
            record_slug=record_slug,
            record_title=record_title,
            job_type=job_type,
            created_by=created_by or "",
            payload=payload or {},
        )
    return job


def list_jobs(*, status: Optional[str] = None, limit: Optional[int] = None) -> List[Job]:
    queryset = Job.objects.all()
    if status:
        queryset = queryset.filter(status=status)
    if limit:
        queryset = queryset[: limit]
    return list(queryset)


def get_job(job_id: str) -> Job:
    return Job.objects.get(pk=job_id)


def update_job_progress(job: Job, *, progress: int):
    job.progress = max(0, min(progress, 100))
    job.save(update_fields=["progress", "updated_at"])


def mark_job_running(job: Job):
    job.mark_running()
    job.save(update_fields=["status", "started_at", "updated_at"])


def mark_job_finished(job: Job):
    job.mark_finished()
    job.save(update_fields=["status", "progress", "finished_at", "updated_at"])


def mark_job_failed(job: Job, *, message: Optional[str] = None):
    job.mark_failed(message)
    job.save(update_fields=["status", "error_message", "finished_at", "updated_at"])
