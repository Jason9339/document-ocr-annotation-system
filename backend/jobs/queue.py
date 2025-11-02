from __future__ import annotations

from django.conf import settings
from redis import Redis
from rq import Queue


def get_connection() -> Redis:
    return Redis.from_url(settings.REDIS_URL)


def get_queue(name: str = "ocr") -> Queue:
    return Queue(name, connection=get_connection())
