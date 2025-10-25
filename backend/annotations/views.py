# backend/annotations/views.py
from django.http import JsonResponse
from django.conf import settings

# === 健康檢查（M0 驗收用） ===
def health(request):
    return JsonResponse({"ok": True, "service": "backend", "version": 1})

# === RQ 佇列最小測試（M6 會換成真正 PaddleOCR 任務） ===
import time
from redis import Redis
from rq import Queue
from rq.job import Job

redis_conn = Redis.from_url(settings.REDIS_URL)
q = Queue('ocr', connection=redis_conn)

def _demo_ocr_page(item_id: int):
    time.sleep(2)  # 模擬耗時
    return {"item_id": item_id, "text": "OK"}

def enqueue_test(request):
    job = q.enqueue(_demo_ocr_page, 123)  # 丟一個假 item_id
    return JsonResponse({"ok": True, "job_id": job.get_id()})

def job_status(request, jid: str):
    job = Job.fetch(jid, connection=redis_conn)
    return JsonResponse({
        "ok": True,
        "id": job.id,
        "status": job.get_status(),
        "result": job.result if job.is_finished else None
    })
