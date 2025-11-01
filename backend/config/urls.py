"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from annotations.views import health, enqueue_test, job_status
from records.views import (
    available_workspaces,
    current_workspace,
    item_original,
    item_thumbnail,
    list_items_view,
    open_workspace,
    record_detail_view,
    records_root,
    item_annotations_view,
)

urlpatterns = [
    path('admin/', admin.site.urls),

    # 健康檢查
    path('api/health', health),

    # RQ 測試端點
    path('api/jobs/test', enqueue_test),
    path('api/jobs/<str:jid>', job_status),

    # Workspace / Items
    path('api/v1/workspaces', available_workspaces),
    path('api/v1/workspace', current_workspace),
    path('api/v1/workspace/open', open_workspace),
    path('api/v1/records', records_root),
    path('api/v1/records/<str:record_slug>', record_detail_view),
    path('api/v1/items', list_items_view),
    path('api/v1/items/thumbnail', item_thumbnail),
    path('api/v1/items/raw', item_original),
    path('api/v1/items/<path:item_id>/annotations', item_annotations_view),
]
