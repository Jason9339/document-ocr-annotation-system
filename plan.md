# NCCU Library OCR Annotation System — 記錄與佇列版

## 一、專案目標

本專案旨在建立一套可於圖書館內網環境運作的 **OCR 標註系統**，結合 Label Studio 的使用體驗與 PaddleOCR 的自動化辨識能力，讓使用者能以「一本書（Record，多頁）」為單位進行背景自動標註與人工校正。系統最終將支援：

* OCR 自動標註（PaddleOCR detection + recognition）
* 閱讀順序半自動排序
* 異體字標註與對應
* Metadata 標註
* 登入 / 登出 / 註冊機制
* 檔案系統為主的資料儲存（labels、thumbnails、locks、records）

---

## 二、架構概述

**前端**：React + Konva.js
**後端**：Django + Django REST Framework + SQLite
**背景任務**：Redis + RQ（正式環境）
**OCR 模組**：PaddleOCR（離線推論）
**部署**：Docker Compose / Python 本地執行
**儲存結構**：

* 帳號與登入狀態 → SQLite
* 標註、縮圖與歷史版本 → 檔案系統

---

## 三、主要功能

1. **登入 / 登出 / 註冊**：Session Cookie；首位註冊者為 Admin；可關閉自助註冊。
2. **Record 流程**：

   * 上傳/掛載一本書（資料夾）
   * 自動展開頁面（pages）建立索引。
3. **自動標註**：

   * 按下「開始標註」→ 建立 Auto-Annotate Job → Redis + RQ 佇列背景執行。
   * Worker 執行 PaddleOCR，將結果寫入 sidecar JSON。
4. **人工校正**：

   * 修改框與文字、調整閱讀順序、標註異體字與 Metadata。
   * 每頁鎖定機制與 Reviewer 審核流程。
5. **匯出與互通**：

   * 支援 PaddleOCR JSON/txt、自定 JSON、variants.csv。

---

## 四、系統資料流

```
[Browser]
  └── React (Konva) UI
        │
        ▼
  [Django REST API]
        │
        ├── OCR Job Queue (Redis + RQ)
        │       └─ workers → PaddleOCR
        │
        └── File I/O Layer
             ├── records/
             ├── labels/
             ├── .thumbnails/
             ├── .locks/
             └── .history/
```

---

## 五、目錄結構（命名遵循慣例）

```
repo/
  ├── frontend/
  ├── backend/
  │     ├── manage.py
  │     ├── config/
  │     ├── apps/
  │     │     ├── accounts/
  │     │     ├── records/
  │     │     ├── annotations/
  │     │     └── ocr_service/
  │     ├── requirements.txt
  │     ├── app.db
  │     └── .env
  ├── adapters/
  ├── models/
  ├── scripts/
  │     ├── init_workspace.py
  │     ├── rebuild_thumbnails.py
  │     └── ocr_worker.py
  ├── workspace_samples/
  ├── docker-compose.yml
  └── .gitignore
```

---

## 六、使用流程

1. 登入後選擇或建立 Workspace。
2. 上傳/掛載 Record（一本書，多頁）。
3. 按下「開始標註」→ 建立 Auto-Annotate Job。
4. 背景執行 OCR → 產出 JSON → 更新頁面狀態。
5. 人工校正 → 閱讀順序、異體字、Metadata → Reviewer 審核。
6. 匯出 PaddleOCR 格式與異體字對應表。

---

## 七、開發階段

> 每週一階段、以「可執行」為最高優先；每階段皆含：目標｜主要工作（後端/前端/資料/DevOps）｜驗收標準。

### M0｜專案初始化與環境建置

**目標**：前後端骨架可啟動、可連線。
**主要工作**：

* 後端：建立 Django + DRF、CORS、/health 檢查。
* 前端：Vite React 腳手架、路由（/login, /records, /items/:id 佔位）。
* DevOps：docker-compose（api/web/redis 佔位）、.env.sample。
  **驗收**：`docker compose up` 後可開啟前端頁面並呼叫 `/health` 取得 200。

### M1｜Workspace 選擇與影像清單（唯讀）

**目標**：可選資料夾並列出影像縮圖。
**主要工作**：

* 後端：`POST /api/v1/workspace/open`、`GET /api/v1/items`（分頁、排序、搜尋），縮圖快取。
* 前端：資料夾選擇 UI、清單與縮圖 grid。
  **驗收**：可選擇資料夾，看到影像清單（>500 張仍流暢翻頁）。

### M2｜Record 上傳/掛載與頁面展開

**目標**：引入 Record 概念，將資料夾展開為 pages，每個資料夾是一筆record，每個record可能有多個 page。
**主要工作**：

* 後端：`POST /api/v1/records`，展開並寫入 `records/` 索引；為每頁建立空 sidecar。
* 前端：Record 清單與詳細頁（頁數、來源、建立時間）。
  **驗收**：上傳一本書可展開為 pages，Record 詳細頁顯示頁面統計。

### M3｜手動標註（無 OCR）

**目標**：最小可用的框編輯與文字輸入。
**主要工作**：

* 後端：`PUT /api/v1/items/{id}/annotations`。
* 前端：Konva 畫布（新增/刪除/拖曳/縮放）、屬性面板、Autosave 去抖動；整合新 UI 框架（sidebar、breadcrumb、Lucide icon）。
* Workspace / Records 頁面導入現代化設計，包含全寬工作區卡片、表格樣式、進度與狀態標籤。
* `.gitignore` 更新以排除 workspace 生成資料與測試輸出。
  **驗收**：手動建立框與文字後落檔成功、重整仍存在；Workspace/Records 介面符合設計稿，sidebar 固定且具麵包屑與 API 狀態提示。

UI 設計參考 `generated-page.html`，導入藍灰色配色、共用排版（2rem padding、固定 sidebar），並已完成 `lucide-react` 依賴安裝與 React Portal 麵包屑實作；工作區卡片最小寬度 320px，Records 表格改為顯示完成度與狀態。

### M4｜Metadata 表單與批次套用

**目標**：完成頁級 Metadata 編輯與批次操作。
**主要工作**：

* 後端：`PUT /api/v1/items/{id}/metadata`、`PUT /api/v1/items/metadata/batch`。
* 前端：可配置欄位表單、勾選多頁批次寫入。
  **驗收**：多選 10+ 頁批次套用成功且正確落檔。

### M5｜單頁 OCR（同步）與模型設定

**目標**：單頁按鈕觸發 PaddleOCR，立即獲得框+文字。
**主要工作**：

* 後端：`POST /api/v1/items/{id}/predict`；讀取 `OCR_MODELS_DIR` 權重；結果寫回 JSON（source:model）。
* 前端：「自動標註」按鈕、執行中遮罩、錯誤提示。
  **驗收**：任一頁按鈕後 1 次成功產生框+文字，UI 即時更新。

### M6｜背景 OCR 佇列（Redis + RQ）

**目標**：Record 級別批次 OCR 排程與進度可視化。
**主要工作**：

* 後端：`POST /api/v1/records/{id}/auto-annotate` 建立 jobs；`GET /api/v1/jobs` 查進度；`POST /api/v1/jobs/{id}/retry|cancel`。
* Worker：`ocr` 佇列、並行度/節流、失敗重試策略（退避）。
* 前端：Record 詳細頁顯示百分比、失敗數、重試按鈕。
  **驗收**：一本 200+ 頁的 Record 可在背景完成，進度與失敗重試可用。

### M7｜閱讀順序半自動與熱鍵

**目標**：多選框一鍵排序（TL→BR / TR→BL），並保留手動微調。
**主要工作**：

* 後端：`PUT /api/v1/items/{id}/reading-order`；演算法參數 `row_epsilon`。
* 前端：多選（Shift+點/框選）、Alt+1/Alt+2、序號徽章、清單拖曳微調。
  **驗收**：對 50+ 框頁面可在 <1s 完成排序並落檔。

### M8｜異體字標註與對照匯出

**目標**：標註「異體 ↔ 常用」成對資訊並集中管理。
**主要工作**：

* 後端：在 annotations 中儲存 variant_pairs；`POST /api/v1/export?fmt=variants` 輸出 CSV。
* 前端：字元選取→新增異體對、異體清單面板（去重、搜尋、批次套用）。
  **驗收**：同一 Record 的異體對可彙整匯出且與 JSON 一致。

### M9｜登入/註冊與角色權限（基礎）

**目標**：導入 Session 登入與最小權限控管。
**主要工作**：

* 後端：`/auth/signup|login|logout|me`；角色：admin/annotator/reviewer；路由守門（IsAuthenticated）。
* 前端：登入頁、登出、依角色顯示功能。
  **驗收**：未登入不可訪問主功能；第一位註冊者自動為 Admin。

### M10｜頁面狀態流轉與審核

**目標**：完成 `imported→in_progress→under_review→completed` 與 Reviewer 佇列。
**主要工作**：

* 後端：`PUT /api/v1/items/{id}/state`、每頁鎖定 `/lock`；審核退回原因欄位。
* 前端：Reviewer 專區、批次通過/退回。
  **驗收**：兩帳號（Annotator/Reviewer）可完整走一次提交流程。

### M11｜歷史版本與稽核日誌

**目標**：每次變更可回溯、可回復。
**主要工作**：

* 檔案：寫入前存 `.history/` 快照；
* 後端：`GET /api/v1/history/{id}`、`POST /api/v1/history/{id}/restore`；
* DB：`audit_logs`（who/when/what/diff/ip）。
  **驗收**：可回復到任意版本並在稽核中查得記錄。

### M12｜安全與運維強化

**目標**：提升系統可靠度與最小必要安全。
**主要工作**：

* 安全：Argon2、CSRF、登入限流、Session 逾時、路徑沙盒；
* 運維：備份/還原腳本、日誌輪替、RQ/Redis 監控儀表。
  **驗收**：備份還原成功；常見安全檢查通過。

---

## 八、API 概要

**Auth**：`/auth/signup`、`/auth/login`、`/auth/logout`、`/auth/me`

**Records**：上傳、查詢、Auto-Annotate、Job 狀態查詢。

**Items**：讀取、標註、Metadata、閱讀順序、狀態流轉。

**Export**：匯出 PaddleOCR、JSON、variants.csv。

---

## 九、部署方式

* **開發模式**：Django runserver + React dev server（ThreadPool 背景）。
* **正式環境**：Docker Compose（api / worker / redis / web）。
* **離線運作**：OCR 權重、前端靜態資源本地化。

---

## 十、安全與稽核

* 密碼雜湊：Argon2。
* CSRF：所有寫入 API 強制檢查。
* Session：可配置逾時與強制登出。
* 稽核：登入、狀態轉換、匯出行為皆記錄。

---

## 十一、專案啟動指令（本地開發）

### 1. 前端（React + Vite + Konva）

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
npm install konva react-konva
npm run dev
```

frontend/vite.config.js（開發代理）
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/auth': 'http://127.0.0.1:8000',
    },
  },
})
```



### 2. 後端（Django + DRF）

```bash
python -m venv .venv
source .venv/bin/activate  # Windows 用 .venv\Scripts\activate
mkdir -p backend && cd backend
pip install django djangorestframework django-cors-headers django-environ pillow redis rq rq-scheduler paddleocr
django-admin startproject config .
python manage.py startapp accounts
python manage.py startapp annotations
python manage.py startapp ocr_service
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```


backend/config/settings.py
```python
"""
Django settings for config project.
Generated by 'django-admin startproject' using Django 5.2.7.
"""

from pathlib import Path
import os  # ← 新增

# === 路徑 ===
BASE_DIR = Path(__file__).resolve().parent.parent

# === 安全 / 偵錯（開發期） ===
SECRET_KEY = 'django-insecure-*_w*p_8u)xnbqgq-+ui-z2-k8#ayk)icr=gz26#0akb_sto9u4'  # TODO: 正式環境改用環境變數
DEBUG = True
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "0.0.0.0"]  # ← 允許本機與 runserver 綁 0.0.0.0

# === 應用程式 ===
INSTALLED_APPS = [
    # 內建
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # 第三方（開發期先裝這三個）
    'rest_framework',         # ← 新增
    'corsheaders',            # ← 新增

    # 你建立的 Apps
    'accounts',               # ← 新增
    'annotations',            # ← 新增
    'ocr_service',            # ← 新增
]

# === 中介層 ===
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # ← 建議放最前或至少在 CommonMiddleware 之前
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# === 資料庫（開發期 SQLite） ===
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# === 密碼驗證 ===
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# === 語系 / 時區 ===
LANGUAGE_CODE = 'zh-hant'      # ← 符合你的使用情境
TIME_ZONE = 'Asia/Taipei'      # ← 台北時區
USE_I18N = True
USE_TZ = True

# === 靜態檔 ===
STATIC_URL = 'static/'

# === 主要鍵型別 ===
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# === CORS（開發期先放寬；正式環境改白名單） ===
CORS_ALLOW_ALL_ORIGINS = True  # ← 前端 Vite 走 /api 代理時較方便

# === DRF（開發期先開放；登入完成後改成 IsAuthenticated） ===
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
}

# === Redis 連線（給 RQ 用；沒設環境變數時預設本機） ===
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

```


backend/annotations/views.py
```python
# backend/annotations/views.py
from django.http import JsonResponse
from django.conf import settings

# 健康檢查（M0 驗收用）
def health(request):
    return JsonResponse({"ok": True, "service": "backend", "version": 1})

# ---- 以下為 RQ 最小測試（M6 會替換成真正的 PaddleOCR 任務） ----
import time
from redis import Redis
from rq import Queue
from rq.job import Job

# 連線到 Redis（settings.REDIS_URL 預設 redis://localhost:6379）
redis_conn = Redis.from_url(settings.REDIS_URL)
q = Queue('ocr', connection=redis_conn)

def _demo_ocr_page(item_id: int):
    # 模擬耗時任務
    time.sleep(2)
    return {"item_id": item_id, "text": "OK"}

def enqueue_test(request):
    job = q.enqueue(_demo_ocr_page, 123)  # 丟一個假的 item_id 進去
    return JsonResponse({"ok": True, "job_id": job.get_id()})

def job_status(request, jid: str):
    job = Job.fetch(jid, connection=redis_conn)
    return JsonResponse({
        "ok": True,
        "id": job.id,
        "status": job.get_status(),
        "result": job.result if job.is_finished else None
    })

```

backend/config/urls.py
```python
# backend/config/urls.py
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
```

後端
cd ~/document-ocr-annotation-system/backend
python manage.py runserver 0.0.0.0:8000


測健康檢查：
curl -s http://127.0.0.1:8000/api/health
# 應回 {"ok": true, "service": "backend", "version": 1}


### 3. Redis + RQ Worker

(A) 確認 Redis 存活

redis-cli -p 6379 ping   # -> PONG

(B) 啟動 RQ Worker（在 backend/ 下）

cd ~/document-ocr-annotation-system/backend
export PYTHONPATH=$(pwd)
export DJANGO_SETTINGS_MODULE=config.settings
export REDIS_URL=redis://127.0.0.1:6379
rq worker ocr


(C) 丟任務／查狀態（另開終端；Django 要在跑）

curl -s http://127.0.0.1:8000/api/jobs/test
# -> {"ok": true, "job_id": "<ID>"}

curl -s "http://127.0.0.1:8000/api/jobs/<ID>"
# 幾秒後應為 {"status":"finished","result":{"item_id":123,"text":"OK"}}


### 4. Docker Compose

```bash
docker compose up -d  # 啟動 api、web、redis、worker
```

### 5. 開發小抄

* 前端呼叫 API 時加上 `credentials: 'include'`。
* 先確保功能可運行，再進行 UI 與效能優化。


======== 目前完成到這裡 ===========

---

## 十二、工程原則與最佳實踐

* **API 版本化與一致回應**：所有路由以 `/api/v1` 起始；錯誤回傳 `{ ok:false, code, message }`，成功 `{ ok:true, data }`；分頁（`page`, `page_size`, `total`）。
* **設定與特性旗標**：`.env` 管理 `WORKSPACE_ROOT`、`REDIS_URL`、`OCR_MODELS_DIR`、`RQ_CONCURRENCY`、`MAX_JOBS_PER_USER`、`ALLOW_SIGNUP`；以旗標開關實驗性功能（如 ThreadPool 降級）。
* **佇列治理**：限制同時自動標註請求數、對同一 Record 做去重；採指數退避重試與最多重試次數。
* **鎖與一致性**：每頁鎖定（檔案與 DB 雙向），逾時自動釋放，UI 即時提示；寫入採「先快照後覆寫」。
* **觀測性**：結構化日誌（JSON）、請求 ID 串聯、基本指標（RQ 佇列深度、失敗率、平均處理時間）。
* **測試策略**：單元（閱讀順序演算法、轉檔器）、整合（REST API）、端對端（核心流程：上傳→佇列→校正→匯出）。
* **程式品質**：前端 ESLint/Prettier，後端 Ruff/Black；型別檢查（mypy 可選）。
* **遷移路線**：多使用者高併發時遷移至 Postgres；必要時導入物件儲存（MinIO）儲放大檔與版本。
* **擴充機制**：保留 label type/metadata schema 擴充點；以 adapters 連接其他 OCR/外部格式。

---

## 十三、交付內容

* 前後端原始碼與 README 文件。
* Docker Compose 部署範例。
* PaddleOCR 模型與背景任務封裝。
* 匯出工具與異體字對照表。
* 稽核、版本快照與回復功能。
