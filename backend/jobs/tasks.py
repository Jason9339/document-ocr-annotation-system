from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict

import django

# Initialize Django before importing models
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.utils import timezone

from jobs.models import Job
from jobs.ocr_service import OCRService
from jobs.services import (
    mark_job_failed,
    mark_job_finished,
    mark_job_running,
    update_job_progress,
)
from records.services import WorkspaceError, get_workspace, iter_items


def run_record_ocr_job(job_id: str, workspace_slug: str, record_slug: str) -> Dict[str, object]:
    """
    Execute OCR processing for all pages in a record.

    This function:
    1. Loads all pages from the record
    2. Runs PaddleOCR on each page
    3. Saves results to label JSON files
    4. Updates job progress in real-time
    """
    job = Job.objects.get(pk=job_id)
    mark_job_running(job)

    ocr_results_count = 0

    try:
        try:
            workspace = get_workspace(workspace_slug)
        except WorkspaceError as exc:
            mark_job_failed(job, message=str(exc))
            raise

        items = list(iter_items(workspace, record_slug=record_slug))
        total = max(len(items), 1)

        for index, item in enumerate(items, start=1):
            # Get the page image path
            image_path = workspace.path / item.rel_path

            # Run OCR on the image
            detections = OCRService.run_ocr(image_path)

            # Format results as label JSON
            label_data = OCRService.format_for_label(detections)

            # Save to label file
            label_dir = workspace.path / 'labels' / record_slug
            label_dir.mkdir(parents=True, exist_ok=True)
            label_path = label_dir / f"{item.basename}.json"

            with open(label_path, 'w', encoding='utf-8') as f:
                json.dump(label_data, f, ensure_ascii=False, indent=2)

            ocr_results_count += len(detections)

            # Update progress
            progress = int(index / total * 100)
            job.progress = progress
            update_job_progress(job, progress=progress)

        mark_job_finished(job)
        job.payload = {
            "record": record_slug,
            "pages": len(items),
            "total_detections": ocr_results_count,
            "completed_at": timezone.now().isoformat(),
        }
        job.save(update_fields=["payload", "updated_at"])
        return job.payload
    except Exception as exc:  # pylint: disable=broad-except
        mark_job_failed(job, message=str(exc))
        raise
