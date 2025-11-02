# GPU 版本設定指南

本文件說明如何在有 NVIDIA GPU 的電腦上啟用 GPU 加速的 PaddleOCR。

## 前置需求

### 1. 安裝 NVIDIA 驅動

確認你的系統已安裝 NVIDIA 驅動：

```bash
nvidia-smi
```

應該會看到類似以下輸出：
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 525.xx.xx    Driver Version: 525.xx.xx    CUDA Version: 12.0     |
|-------------------------------+----------------------+----------------------+
```

### 2. 安裝 NVIDIA Container Toolkit

允許 Docker 容器使用 GPU：

```bash
# Ubuntu/Debian
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# 重啟 Docker
sudo systemctl restart docker
```

驗證安裝：
```bash
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

## 已完成的設定

以下設定已經在這台電腦上完成，你在 GPU 電腦上需要確認這些設定：

### 1. docker-compose.yml

Worker 服務已啟用 GPU：

```yaml
worker:
  environment:
    - USE_GPU=1  # 啟用 GPU
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

### 2. requirements.txt

已改用 GPU 版本的 PaddlePaddle：

```
paddlepaddle-gpu>=3.0.0b0  # GPU version
```

## 在 GPU 電腦上的使用步驟

### 1. 複製專案到 GPU 電腦

```bash
# 使用 git clone 或直接複製整個資料夾
git clone <your-repo-url>
cd document-ocr-annotation-system
```

### 2. 檢查設定

確認以下檔案的設定正確：

- `docker-compose.yml` - worker 有 GPU 設定
- `backend/requirements.txt` - 使用 `paddlepaddle-gpu`

### 3. 建置並啟動服務

```bash
# 建置 Docker images（首次執行或更新時）
docker compose build

# 啟動所有服務
docker compose up -d

# 檢查服務狀態
docker compose ps
```

### 4. 驗證 GPU 是否正常工作

```bash
# 檢查 worker 日誌
docker compose logs worker --tail 50

# 你應該會看到類似以下訊息：
# ✓ PaddleOCR initialized successfully
#   Device: GPU
#   Language: ch
```

執行一個 OCR 任務後，檢查是否使用 GPU：

```bash
# 在 worker 容器內檢查 GPU 使用情況
docker compose exec worker nvidia-smi
```

## 效能比較

| 模式 | 記憶體使用 | 處理速度 | 適用場景 |
|------|-----------|----------|----------|
| CPU  | ~2-3GB    | 慢       | 開發測試 |
| GPU  | ~3-4GB    | 快 3-10 倍 | 生產環境 |

## 錯誤處理

### 前端錯誤顯示

系統已經配置好完整的錯誤處理機制：

1. **後端錯誤捕獲**：
   - `backend/jobs/tasks.py` - OCR 執行時的錯誤會被捕獲
   - `backend/jobs/services.py` - `mark_job_failed()` 會儲存錯誤訊息

2. **前端錯誤顯示**：
   - Jobs 頁面會自動顯示失敗任務的錯誤訊息
   - 紅色錯誤框會顯示在任務卡片中
   - 可以使用「重試」按鈕重新執行失敗的任務

3. **查看詳細錯誤**：
   ```bash
   # 查看 worker 日誌中的完整錯誤堆疊
   docker compose logs worker --tail 100
   ```

### 常見問題

#### 1. GPU 記憶體不足

**錯誤訊息**：
```
RuntimeError: CUDA out of memory
```

**解決方案**：
- 關閉其他使用 GPU 的程式
- 減少同時處理的任務數量

#### 2. CUDA 版本不匹配

**錯誤訊息**：
```
The NVIDIA driver on your system is too old
```

**解決方案**：
- 更新 NVIDIA 驅動至最新版本
- 或修改 `requirements.txt` 使用較舊版本的 `paddlepaddle-gpu`

#### 3. Docker 無法存取 GPU

**錯誤訊息**：
```
could not select device driver "" with capabilities: [[gpu]]
```

**解決方案**：
```bash
# 重新安裝 NVIDIA Container Toolkit
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

## 切換回 CPU 模式

如果需要切換回 CPU 模式：

### 1. 修改 docker-compose.yml

```yaml
worker:
  environment:
    - USE_GPU=0  # 改為 0 或移除此行
  # 註解或移除 deploy 區塊
  # deploy:
  #   resources:
  #     reservations:
  #       devices:
  #         - driver: nvidia
  #           count: 1
  #           capabilities: [gpu]
```

### 2. 修改 requirements.txt

```
paddlepaddle>=3.0.0b0  # CPU version
```

### 3. 重新建置

```bash
docker compose build worker
docker compose restart worker
```

## 監控 GPU 使用情況

### 即時監控

```bash
# 在宿主機上
watch -n 1 nvidia-smi

# 或在 worker 容器內
docker compose exec worker watch -n 1 nvidia-smi
```

### 查看歷史記錄

```bash
# Docker stats
docker stats document-ocr-annotation-system-worker-1
```

## 效能調整

### 增加 Worker 數量（平行處理）

如果你的 GPU 記憶體充足，可以啟動多個 worker：

```yaml
worker:
  deploy:
    replicas: 2  # 啟動 2 個 worker
```

**注意**：每個 worker 都會載入完整的 PaddleOCR 模型，需要足夠的 GPU 記憶體。

## 支援的 CUDA 版本

PaddlePaddle GPU 版本支援：

- CUDA 11.x
- CUDA 12.x

檢查你的 CUDA 版本：
```bash
nvcc --version
# 或
nvidia-smi
```

## 參考資源

- [PaddleOCR 官方文件](https://github.com/PaddlePaddle/PaddleOCR)
- [PaddlePaddle GPU 安裝指南](https://www.paddlepaddle.org.cn/install/quick)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
- [Docker GPU 支援](https://docs.docker.com/config/containers/resource_constraints/#gpu)

---

如有任何問題，請參考 `DEVELOPMENT_GUIDE.md` 或查看 worker 日誌。
