# Generated manually because makemigrations is unavailable in this environment.

import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Job",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)),
                ("workspace_slug", models.CharField(max_length=255)),
                ("record_slug", models.CharField(max_length=255, blank=True)),
                ("record_title", models.CharField(max_length=255, blank=True)),
                ("job_type", models.CharField(max_length=64, default="ocr")),
                (
                    "status",
                    models.CharField(
                        max_length=16,
                        choices=[
                            ("pending", "待處理"),
                            ("running", "處理中"),
                            ("finished", "已完成"),
                            ("failed", "失敗"),
                            ("canceled", "已取消"),
                        ],
                        default="pending",
                    ),
                ),
                ("progress", models.PositiveSmallIntegerField(default=0)),
                ("created_by", models.CharField(max_length=255, blank=True)),
                ("rq_job_id", models.CharField(max_length=128, blank=True)),
                ("error_message", models.TextField(blank=True)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
    ]
