from django.contrib import admin

from .models import Job


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ("id", "job_type", "status", "progress", "record_slug", "workspace_slug", "created_at")
    list_filter = ("job_type", "status", "workspace_slug")
    search_fields = ("id", "record_slug", "workspace_slug")
