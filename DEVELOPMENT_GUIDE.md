# 開發指南

這份指南將幫助你理解專案架構、如何操作 Docker，以及如何修改前後端代碼。

## 目錄

1. [專案架構](#專案架構)
2. [Docker 基礎操作](#docker-基礎操作)
3. [後端開發 (Django)](#後端開發-django)
4. [前端開發 (React)](#前端開發-react)
5. [常見問題排解](#常見問題排解)
6. [實用指令速查表](#實用指令速查表)

---

## 專案架構

```
document-ocr-annotation-system/
├── backend/                    # Django 後端
│   ├── config/                 # Django 設定檔
│   │   ├── settings.py        # 主要設定（資料庫、CORS、apps）
│   │   └── urls.py            # URL 路由
│   ├── records/               # Workspace 與 Items 管理
│   │   ├── views.py           # API 端點實作
│   │   ├── services.py        # 業務邏輯
│   │   └── thumbnails.py      # 縮圖生成
│   ├── annotations/           # 標註功能（M0 階段的範例）
│   ├── manage.py              # Django 管理指令入口
│   ├── requirements.txt       # Python 套件清單
│   └── Dockerfile             # 後端 Docker 映像檔定義
├── frontend/                  # React 前端
│   ├── src/
│   │   ├── App.jsx            # 主應用程式元件
│   │   ├── App.css            # 全域樣式
│   │   ├── pages/             # 頁面元件
│   │   │   ├── Records.jsx    # 頁面列表頁
│   │   │   └── RecordItem.jsx # 單頁詳情頁
│   │   ├── components/        # 共用元件
│   │   │   └── WorkspaceSelector.jsx
│   │   └── lib/
│   │       └── api.js         # API 呼叫封裝
│   ├── package.json           # npm 套件清單
│   ├── vite.config.js         # Vite 設定（proxy）
│   └── Dockerfile             # 前端 Docker 映像檔定義
├── workspace_samples/         # 範例資料目錄
│   └── demo_workspace/
│       └── records/
│           └── demo_record/
│               └── pages/     # 圖片檔案
├── docker-compose.yml         # Docker 服務編排設定
└── plan.md                    # 專案計畫與 Milestone 規劃
```

---

## Docker 基礎操作

### 什麼是 Docker？

Docker 讓你在「容器」中運行應用程式，每個容器都是獨立的環境，不會影響你的主機系統。

### 核心概念

- **Image (映像檔)**：應用程式的範本（例如 Python 3.12 + Django）
- **Container (容器)**：從 image 啟動的運行實例
- **Service (服務)**：docker-compose.yml 定義的一組容器（api、web、redis、worker）
- **Volume (掛載卷)**：讓容器可以存取主機的檔案

### 常用指令

#### 1. 啟動所有服務

```bash
docker compose up -d
```

- `-d`：背景執行（detached mode）
- 第一次執行會自動 build image

#### 2. 停止所有服務

```bash
docker compose down
```

#### 3. 查看服務狀態

```bash
docker compose ps
```

輸出範例：
```
NAME                                      STATUS
document-ocr-annotation-system-api-1      Up 2 hours
document-ocr-annotation-system-web-1      Up 2 hours
document-ocr-annotation-system-redis-1    Up 2 hours
document-ocr-annotation-system-worker-1   Up 2 hours
```

#### 4. 查看服務日誌

```bash
# 查看所有服務的日誌
docker compose logs

# 只看後端日誌
docker compose logs api

# 只看前端日誌
docker compose logs web

# 只看 worker 日誌（OCR 背景任務）
docker compose logs worker

# 即時追蹤日誌（類似 tail -f）
docker compose logs -f api
docker compose logs -f worker

# 只看最後 50 行
docker compose logs --tail 50 api
docker compose logs --tail 50 worker

# 即時追蹤 + 限制行數
docker compose logs --tail 20 --follow worker
```

#### 5. 重啟特定服務

```bash
# 重啟後端
docker compose restart api

# 重啟前端
docker compose restart web

# 重啟 worker（OCR 背景任務）
docker compose restart worker

# 重啟 Redis（任務佇列）
docker compose restart redis
```

#### 6. 重新 build image（當 Dockerfile 或 requirements.txt 改變時）

```bash
# 重新 build 並啟動
docker compose up -d --build

# 清除快取重新 build
docker compose build --no-cache
docker compose up -d
```

#### 7. 在容器中執行指令

```bash
# 在 api 容器中執行 Django 指令
docker compose exec api python manage.py migrate
docker compose exec api python manage.py createsuperuser

# 在 api 容器中安裝新的 Python 套件
docker compose exec api pip install package-name

# 進入容器的 shell
docker compose exec api bash
docker compose exec web sh
```

#### 8. 清理所有容器和網路

```bash
docker compose down --volumes
```

⚠️ 注意：這會刪除所有資料（Redis 的資料等）

---

## 後端開發 (Django)

### 技術堆疊

- **Django 5.2.7**：Python Web 框架
- **Django REST framework**：建構 REST API
- **Redis + RQ**：非同步任務佇列
- **Pillow**：圖片處理

### 專案結構

```
backend/
├── config/              # 專案設定
│   ├── settings.py     # 資料庫、CORS、INSTALLED_APPS
│   └── urls.py         # URL 路由配置
├── records/            # 主要功能 app
├── annotations/        # 標註功能 app
├── accounts/           # 未來的帳號管理
└── manage.py           # Django 指令入口
```

### 如何修改代碼

#### 1. 修改 API 端點

**檔案位置**：`backend/records/views.py`

範例：新增一個測試端點

```python
# 在 views.py 最下方新增
from django.views.decorators.http import require_GET

@require_GET
def test_endpoint(request):
    return JsonResponse({"message": "Hello from test endpoint!"})
```

然後在 `backend/config/urls.py` 註冊：

```python
from records.views import test_endpoint  # 加入這行

urlpatterns = [
    # ... 其他路由
    path('api/v1/test', test_endpoint),  # 加入這行
]
```

測試：
```bash
curl http://localhost:8000/api/v1/test
```

#### 2. 修改業務邏輯

**檔案位置**：`backend/records/services.py`

這個檔案包含核心功能：
- `list_workspaces()`：列出可用的 workspace
- `get_active_workspace()`：取得當前 workspace
- `iter_items(workspace)`：迭代 workspace 中的所有項目
- `filter_items(...)`：搜尋和排序

範例：修改搜尋邏輯（忽略大小寫）

```python
def filter_items(items, *, query=None, sort=None):
    filtered = list(items)
    if query:
        q = query.lower()  # 轉小寫
        filtered = [
            item
            for item in filtered
            if q in item.filename.lower() or q in item.record.lower()
        ]
    # ... 排序邏輯
    return filtered
```

#### 3. 安裝新的 Python 套件

1. 在 `backend/requirements.txt` 中新增套件：
   ```txt
   Django==5.2.7
   djangorestframework==3.16.1
   Pillow==10.4.0
   your-new-package==1.0.0  # 新增這行
   ```

2. 重新 build Docker image：
   ```bash
   docker compose down
   docker compose build --no-cache api worker
   docker compose up -d
   ```

#### 4. Django 常用指令

```bash
# 建立資料庫遷移檔
docker compose exec api python manage.py makemigrations

# 執行資料庫遷移
docker compose exec api python manage.py migrate

# 建立超級使用者（用於 Django admin）
docker compose exec api python manage.py createsuperuser

# 進入 Django shell
docker compose exec api python manage.py shell

# 執行測試
docker compose exec api python manage.py test
```

#### 5. 設定檔說明

**`backend/config/settings.py`** 重要設定項目：

```python
# 允許的 Host（加入你需要的域名或 IP）
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "0.0.0.0", "api"]

# 安裝的 apps（新增功能時需要加入）
INSTALLED_APPS = [
    # ...
    'records',       # 你的 app
    'annotations',   # 你的 app
]

# CORS 設定（允許前端跨域請求）
CORS_ALLOW_ALL_ORIGINS = True  # 開發環境可用，正式環境應改為白名單

# Workspace 設定
WORKSPACES_ROOT = Path(os.getenv("WORKSPACES_ROOT", BASE_DIR.parent / "workspace_samples"))
```

---

## 前端開發 (React)

### 技術堆疊

- **React 18**：UI 框架
- **Vite**：快速的開發伺服器和建置工具
- **React Router**：客戶端路由（自訂實作）

### 專案結構

```
frontend/src/
├── main.jsx              # 應用程式入口
├── App.jsx               # 主元件（路由、workspace 狀態）
├── App.css               # 全域樣式
├── pages/                # 頁面元件
│   ├── Records.jsx       # 列表頁
│   ├── RecordItem.jsx    # 詳情頁
│   └── Login.jsx         # 登入頁
├── components/           # 共用元件
│   └── WorkspaceSelector.jsx
└── lib/
    └── api.js            # API 呼叫封裝
```

### 如何修改代碼

#### 1. 修改頁面 UI

**檔案位置**：`frontend/src/pages/Records.jsx`

範例：修改頁面標題

```jsx
<section className="page">
  <header className="records-header">
    <div>
      <h2>我的頁面列表</h2>  {/* 修改這行 */}
      <p className="records-summary">
        {pagination.total
          ? `顯示 ${rangeStart}-${rangeEnd} / 共 ${pagination.total} 頁`
          : '工作區為空。'}
      </p>
    </div>
    {/* ... */}
  </header>
</section>
```

#### 2. 修改樣式

**檔案位置**：`frontend/src/App.css`

範例：修改卡片樣式

```css
.record-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  /* 修改圓角 */
  border-radius: 20px;

  /* 修改陰影 */
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.record-card:hover {
  /* 修改 hover 效果 */
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
}
```

#### 3. 新增 API 呼叫

**檔案位置**：`frontend/src/lib/api.js`

範例：新增一個 API 方法

```javascript
export const api = {
  // ... 現有方法

  // 新增方法
  async deleteItem(itemId) {
    const response = await fetch(`/api/v1/items/${itemId}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`)
    }
    return response.json()
  },
}
```

在頁面中使用：

```jsx
import { api } from '../lib/api.js'

function RecordsPage() {
  const handleDelete = async (itemId) => {
    try {
      await api.deleteItem(itemId)
      alert('刪除成功！')
    } catch (error) {
      alert('刪除失敗：' + error.message)
    }
  }

  // ...
}
```

#### 4. 安裝新的 npm 套件

1. 在前端容器中安裝套件：
   ```bash
   docker compose exec web npm install package-name
   ```

2. 套件會自動寫入 `package.json` 和 `package-lock.json`

3. 在代碼中使用：
   ```jsx
   import SomeComponent from 'package-name'
   ```

#### 5. Vite 設定

**檔案位置**：`frontend/vite.config.js`

重要設定：Proxy（將 API 請求轉發到後端）

```javascript
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

這表示：
- 前端發送到 `/api/*` 的請求會被轉發到 `http://api:8000/api/*`
- 不需要處理 CORS 問題

---

## 常見問題排解

### 1. 前端無法連接後端（400 Bad Request）

**症狀**：瀏覽器 console 顯示 `Failed to load resource: the server responded with a status of 400`

**原因**：Django `ALLOWED_HOSTS` 設定不正確

**解決方案**：
```python
# backend/config/settings.py
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "0.0.0.0", "api"]
```

### 2. Docker 容器無法啟動

**症狀**：`docker compose ps` 顯示服務是 `Exited` 狀態

**診斷步驟**：
```bash
# 查看錯誤訊息
docker compose logs api

# 常見錯誤：
# - ModuleNotFoundError: 缺少 Python 套件 → 重新 build
# - Port already in use: 埠號被佔用 → 更改埠號或停止佔用的程式
```

**解決方案**：
```bash
# 重新 build
docker compose down
docker compose build --no-cache
docker compose up -d
```

### 3. 修改代碼後沒有生效

**情況 A：修改 Python 代碼**
- Django 有 auto-reload，修改 `.py` 檔案後會自動重啟
- 如果沒有生效，手動重啟：`docker compose restart api`

**情況 B：修改 React 代碼**
- Vite 有 Hot Module Replacement (HMR)，修改會即時反映
- 如果沒有生效，重新整理瀏覽器（`Ctrl+F5` 強制重新整理）

**情況 C：修改 Dockerfile 或 requirements.txt**
- 必須重新 build：
  ```bash
  docker compose down
  docker compose build --no-cache
  docker compose up -d
  ```

### 4. 埠號衝突

**症狀**：
```
Error: bind: address already in use
```

**解決方案 1**：停止佔用埠號的程式
```bash
# 找出佔用 8000 埠號的程式
lsof -i :8000

# 停止該程式
kill <PID>
```

**解決方案 2**：修改 docker-compose.yml 的埠號
```yaml
services:
  api:
    ports:
      - "8001:8000"  # 改用 8001
```

### 5. 找不到 workspace_samples

**症狀**：API 返回 `"workspaces": []`

**原因**：Docker 沒有掛載 workspace_samples 目錄

**解決方案**：檢查 docker-compose.yml
```yaml
services:
  api:
    volumes:
      - ./backend:/app
      - ./workspace_samples:/workspace_samples  # 必須有這行
    environment:
      - WORKSPACES_ROOT=/workspace_samples      # 必須有這行
```

然後重新啟動：
```bash
docker compose down
docker compose up -d
```

### 6. 縮圖無法顯示

**症狀**：圖片卡片顯示破圖

**診斷**：
```bash
# 檢查縮圖 API
curl -I "http://localhost:8000/api/v1/items/thumbnail?path=records%2Fdemo_record%2Fpages%2F0001.png"
```

**常見原因**：
1. Pillow 套件未安裝
2. 圖片檔案不存在
3. 權限問題

**解決方案**：
```bash
# 確認 Pillow 已安裝
docker compose exec api pip list | grep Pillow

# 如果沒有，重新 build
docker compose build --no-cache api
docker compose up -d
```

---

## 實用指令速查表

### Docker 操作

```bash
# 啟動服務
docker compose up -d

# 停止服務
docker compose down

# 查看狀態
docker compose ps

# 查看日誌
docker compose logs -f api
docker compose logs -f web

# 重啟服務
docker compose restart api

# 重新 build
docker compose build --no-cache
docker compose up -d

# 在容器中執行指令
docker compose exec api python manage.py migrate
docker compose exec web npm install

# 進入容器 shell
docker compose exec api bash
docker compose exec web sh
```

### Django 操作

```bash
# 資料庫遷移
docker compose exec api python manage.py makemigrations
docker compose exec api python manage.py migrate

# 建立超級使用者
docker compose exec api python manage.py createsuperuser

# Django shell
docker compose exec api python manage.py shell

# 執行測試
docker compose exec api python manage.py test
```

### 前端操作

```bash
# 安裝套件
docker compose exec web npm install package-name

# 移除套件
docker compose exec web npm uninstall package-name

# 查看已安裝套件
docker compose exec web npm list

# 執行 build（正式環境）
docker compose exec web npm run build
```

### 測試 API

```bash
# 測試 GET 請求
curl http://localhost:8000/api/v1/workspaces

# 測試 POST 請求
curl -X POST http://localhost:8000/api/v1/workspace/open \
  -H "Content-Type: application/json" \
  -d '{"slug":"demo_workspace"}'

# 下載檔案
curl "http://localhost:8000/api/v1/items/thumbnail?path=records%2Fdemo_record%2Fpages%2F0001.png" \
  --output test.jpg
```

### 除錯技巧

```bash
# 查看容器內的檔案
docker compose exec api ls -la /app
docker compose exec api ls -la /workspace_samples

# 查看環境變數
docker compose exec api env

# 檢查 Python 套件
docker compose exec api pip list

# 檢查 Django 設定
docker compose exec api python manage.py diffsettings

# 檢查 URL 路由
docker compose exec api python manage.py show_urls
```

---

## 開發工作流程

### 日常開發流程

1. **啟動開發環境**
   ```bash
   docker compose up -d
   ```

2. **修改代碼**
   - 後端：修改 `backend/` 下的 `.py` 檔案
   - 前端：修改 `frontend/src/` 下的 `.jsx` 或 `.css` 檔案

3. **查看效果**
   - 後端：Django 自動重新載入
   - 前端：Vite HMR 自動更新瀏覽器

4. **查看日誌（如果有錯誤）**
   ```bash
   docker compose logs -f api
   docker compose logs -f web
   ```

5. **測試 API**
   ```bash
   curl http://localhost:8000/api/v1/workspaces
   ```

6. **結束工作**
   ```bash
   docker compose down
   ```

### 新增功能流程

1. **後端新增 API 端點**
   - 在 `backend/records/views.py` 實作 view
   - 在 `backend/config/urls.py` 註冊路由
   - 測試：`curl http://localhost:8000/api/v1/your-endpoint`

2. **前端呼叫 API**
   - 在 `frontend/src/lib/api.js` 新增方法
   - 在頁面元件中使用

3. **新增樣式**
   - 在 `frontend/src/App.css` 新增 CSS class

4. **測試**
   - 後端：`docker compose exec api python manage.py test`
   - 前端：在瀏覽器中手動測試

### 安裝新套件流程

**Python 套件**：
```bash
# 1. 編輯 backend/requirements.txt
echo "new-package==1.0.0" >> backend/requirements.txt

# 2. 重新 build
docker compose build --no-cache api worker
docker compose up -d
```

**npm 套件**：
```bash
# 1. 安裝套件
docker compose exec web npm install new-package

# 2. 套件會自動寫入 package.json
```

---

## 學習資源

### Django
- 官方文件：https://docs.djangoproject.com/
- Django REST framework：https://www.django-rest-framework.org/

### React
- 官方文件：https://react.dev/
- React Hooks：https://react.dev/reference/react

### Docker
- 官方文件：https://docs.docker.com/
- Docker Compose：https://docs.docker.com/compose/

### Vite
- 官方文件：https://vitejs.dev/

---

## 下一步

建議學習順序：

1. **熟悉 Docker 基本操作**（1-2 天）
   - 練習啟動/停止服務
   - 查看日誌
   - 進入容器執行指令

2. **了解 Django 基礎**（3-5 天）
   - Views 和 URL routing
   - Models 和資料庫（未來 Milestone 會用到）
   - Django REST framework

3. **學習 React 基礎**（3-5 天）
   - 元件和 Props
   - State 和 Hooks (useState, useEffect)
   - 事件處理

4. **實作小功能**
   - 例如：新增「刪除 workspace」功能
   - 例如：新增「檔案上傳」功能

---

## OCR 背景任務 (PaddleOCR)

### 架構說明

本系統使用 **Redis Queue (RQ)** 來處理 OCR 背景任務：

- **api**：Django API 服務，接收 OCR 請求並將任務加入佇列
- **redis**：任務佇列，儲存待處理的 OCR 任務
- **worker**：背景工作程序，從佇列中取出任務並執行 PaddleOCR

### 如何檢查 OCR 執行狀態

#### 1. 查看 Worker 日誌

**即時監看 OCR 處理過程**：
```bash
docker compose logs worker --tail 20 --follow
```

**查看最近的日誌**：
```bash
docker compose logs worker --tail 50
```

#### 2. 確認 PaddleOCR 正在執行

當你執行 OCR 任務時，worker 日誌會顯示：

```
Creating model: ('PP-OCRv5_server_det', None)
Using official model (PP-OCRv5_server_det)...
Fetching 6 files: 100%|██████████| 6/6 [00:09<00:00]
✓ PaddleOCR initialized successfully
  Device: CPU
  Language: ch
```

這表示 PaddleOCR 正在下載模型並初始化。

#### 3. 檢查 OCR 結果

OCR 完成後，結果會儲存在：
```
workspace_samples/{workspace_slug}/labels/{record_slug}/*.json
```

例如：
```bash
# 查看 OCR 結果
cat workspace_samples/demo_workspace/labels/test-record-001/rec_1_id_2226.json

# 列出所有 OCR 結果
ls -lh workspace_samples/demo_workspace/labels/test-record-001/
```

### PaddleOCR 配置

#### CPU vs GPU

預設使用 **CPU** 模式。若要啟用 GPU 加速：

1. 編輯 `docker-compose.yml`：
   ```yaml
   worker:
     environment:
       - USE_GPU=1  # 啟用 GPU
   ```

2. 重啟 worker：
   ```bash
   docker compose restart worker
   ```

#### 語言設定

預設使用 **中文 + 英文** (ch)。若要更改語言：

```yaml
worker:
  environment:
    - OCR_LANG=en  # 英文
    - OCR_LANG=japan  # 日文
    - OCR_LANG=korean  # 韓文
```

支援的語言請參考：[PaddleOCR 語言列表](https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/doc/doc_en/multi_languages_en.md)

### 常見問題

#### 1. Worker 無法啟動

**檢查日誌**：
```bash
docker compose logs worker
```

**常見錯誤**：
- `ModuleNotFoundError: No module named 'paddleocr'`
  → 需要重新 build：`docker compose build --no-cache worker`

#### 2. OCR 任務卡在「處理中」

**檢查 worker 是否正在運行**：
```bash
docker compose ps worker
```

**檢查 worker 日誌**：
```bash
docker compose logs worker --tail 50
```

**重啟 worker**：
```bash
docker compose restart worker
```

#### 3. OCR 任務失敗

**查看詳細錯誤訊息**：
```bash
docker compose logs worker --tail 100
```

**常見原因**：
- 圖片檔案不存在或無法讀取
- PaddleOCR 模型下載失敗
- 記憶體不足（OCR 模型需要約 2GB RAM）

#### 4. 如何確認 PaddleOCR 真的在執行？

執行 OCR 任務後，在另一個終端執行：
```bash
docker compose logs worker --follow
```

你應該會看到：
1. **模型載入訊息**（首次執行時）：
   ```
   Creating model: ('PP-OCRv5_server_det', None)
   Fetching 6 files: 100%|██████████| 6/6
   ```

2. **初始化成功訊息**：
   ```
   ✓ PaddleOCR initialized successfully
     Device: CPU
     Language: ch
   ```

3. **任務處理訊息**：
   ```
   ocr: jobs.tasks.run_record_ocr_job(...)
   ```

### 效能優化

#### 首次執行較慢

PaddleOCR 首次執行時需要下載模型（約 200MB），後續執行會使用快取：
- 模型快取位置：`/root/.paddlex/official_models/`

#### 加速建議

1. **使用 GPU**（如果有 NVIDIA 顯卡）：
   ```yaml
   worker:
     environment:
       - USE_GPU=1
     deploy:
       resources:
         reservations:
           devices:
             - driver: nvidia
               count: 1
               capabilities: [gpu]
   ```

2. **增加 worker 數量**（平行處理多個任務）：
   ```yaml
   worker:
     deploy:
       replicas: 2  # 啟動 2 個 worker
   ```

### 除錯技巧

```bash
# 進入 worker 容器
docker compose exec worker bash

# 檢查 PaddleOCR 是否已安裝
pip list | grep paddleocr

# 檢查模型快取
ls -lh /root/.paddlex/official_models/

# 手動執行 Python 測試
python3 -c "from paddleocr import PaddleOCR; print('PaddleOCR OK')"

# 檢查 Redis 連線
redis-cli -h redis ping
```

---

如有任何問題，歡迎隨時詢問！
