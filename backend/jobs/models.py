from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class Job(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "待處理"
        RUNNING = "running", "處理中"
        FINISHED = "finished", "已完成"
        FAILED = "failed", "失敗"
        CANCELED = "canceled", "已取消"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace_slug = models.CharField(max_length=255)
    record_slug = models.CharField(max_length=255, blank=True)
    record_title = models.CharField(max_length=255, blank=True)
    job_type = models.CharField(max_length=64, default="ocr")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    progress = models.PositiveSmallIntegerField(default=0)
    created_by = models.CharField(max_length=255, blank=True)
    rq_job_id = models.CharField(max_length=128, blank=True)
    error_message = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)

    def mark_running(self):
        if self.status != self.Status.RUNNING:
            self.status = self.Status.RUNNING
            if not self.started_at:
                self.started_at = timezone.now()

    def mark_finished(self):
        self.status = self.Status.FINISHED
        self.progress = 100
        self.finished_at = timezone.now()

    def mark_failed(self, message: str | None = None):
        self.status = self.Status.FAILED
        if message:
            self.error_message = message
        self.finished_at = timezone.now()
