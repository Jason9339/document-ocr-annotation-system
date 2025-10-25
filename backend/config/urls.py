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

urlpatterns = [
    path('admin/', admin.site.urls),

    # 健康檢查
    path('api/health', health),

    # RQ 測試端點
    path('api/jobs/test', enqueue_test),
    path('api/jobs/<str:jid>', job_status),
]
