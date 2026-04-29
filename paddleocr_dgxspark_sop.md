# PaddleOCR PP-OCRv4/v5 GPU 推論 — DGX Spark 部署 SOP

**目標讀者**：AI 模型或技術人員，可照此文件從零開始完成部署  
**適用硬體**：NVIDIA DGX Spark（GB10 Grace Blackwell，sm_121，aarch64）  
**適用情境**：純 PP-OCRv4 / PP-OCRv5 inference，不含 PaddleOCR-VL / vLLM backend  
**文件語言**：繁體中文  
**最後更新**：2026-04

---

## 目錄

1. [背景與核心問題](#1-背景與核心問題)
2. [為什麼官方方式不可行](#2-為什麼官方方式不可行)
3. [系統前期確認](#3-系統前期確認)
4. [唯一可行路徑：從源碼編譯 PaddlePaddle](#4-唯一可行路徑從源碼編譯-paddlepaddle)
5. [安裝 PaddleOCR 並驗證 GPU](#5-安裝-paddleocr-並驗證-gpu)
6. [執行 PP-OCRv5 推論](#6-執行-pp-ocrv5-推論)
7. [自製 Docker Image（可複製環境）](#7-自製-docker-image可複製環境)
8. [多環境支援：DGX Spark + 現有 x86 GPU 機器](#8-多環境支援dgx-spark--現有-x86-gpu-機器)
9. [常見錯誤與解法](#9-常見錯誤與解法)
10. [參考資料](#10-參考資料)

---

## 1. 背景與核心問題

### 1.1 DGX Spark 硬體特性

NVIDIA DGX Spark 搭載 GB10 Grace Blackwell 超級晶片，與一般工作站 GPU 有根本性差異：

| 項目 | 一般 GPU 工作站 | DGX Spark |
|---|---|---|
| CPU 架構 | x86_64 | **aarch64（ARM64）** |
| GPU 架構 | Ampere / Ada / Hopper | **Blackwell（sm_121）** |
| CUDA 版本 | 11.x / 12.x | **CUDA 13.0** |
| OS | Ubuntu（x86） | **DGX OS 7（Ubuntu 24.04 ARM64）** |
| 記憶體架構 | CPU/GPU 記憶體分離 | **128GB 統一記憶體（Unified Memory）** |

這兩個特性（aarch64 + sm_121）的組合，導致幾乎所有現有 AI framework 的官方 binary 都無法直接使用。

### 1.2 PaddleOCR 架構說明

PaddleOCR 的 GPU 加速依賴鏈如下：

```
PaddleOCR（上層 OCR pipeline）
    └── PaddlePaddle（深度學習 framework，負責 GPU 呼叫）
            └── CUDA（GPU 計算）
                    └── GPU 硬體（需要對應 Compute Capability）
```

因此，**PaddlePaddle 能否正確使用 GPU 是關鍵**。PaddleOCR 本身與硬體無關，問題完全在 PaddlePaddle 層。

---

## 2. 為什麼官方方式不可行

### 2.1 方式一：pip 直接安裝（❌ GPU 無法啟用）

```bash
# 這個指令在 DGX Spark 上只會安裝 CPU 版本
pip install paddlepaddle-gpu
```

**原因**：PaddlePaddle 官方 PyPI 僅提供 `linux_x86_64` 的 GPU wheel。在 aarch64 機器上，pip 找不到對應的 GPU wheel，會 fallback 安裝 CPU-only 版本，或直接安裝失敗。

驗證方式（安裝後確認是否真的有 GPU）：
```bash
python3 -c "import paddle; print(paddle.is_compiled_with_cuda())"
# 若輸出 False → 安裝的是 CPU 版，GPU 未啟用
```

### 2.2 方式二：官方 Docker Image（❌ 平台架構不符）

PaddleOCR 官方提供 Blackwell 專用 Docker image：

```bash
# 官方提供的 Blackwell image（僅 amd64）
docker run --gpus all \
  ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-vl:latest-gpu-sm120 \
  /bin/bash
```

**原因**：此 image 的平台為 `linux/amd64`，在 DGX Spark（`linux/arm64/v8`）上執行會出現：

```
WARNING: The requested image's platform (linux/amd64) does not match
the detected host platform (linux/arm64/v8)
exec /usr/local/bin/paddlex_genai_server: exec format error
```

即使強制拉取也無法執行，因為 binary 的指令集根本不同。

### 2.3 方式三：官方 aarch64 wheel（❌ 僅 CPU，無 GPU 支援）

PaddlePaddle 的 aarch64 支援狀態（截至 2026 Q2）：

| wheel | 可用性 |
|---|---|
| `paddlepaddle`（CPU，aarch64） | ✅ 官方提供 |
| `paddlepaddle-gpu`（GPU，aarch64） | ❌ **官方未提供** |

官方 GitHub Discussion [#17328](https://github.com/PaddlePaddle/PaddleOCR/discussions/17328) 明確說明：aarch64 + GPU 的 wheel 尚未在 roadmap 上有明確時程。

### 2.4 問題根本原因

這是一個 **build-time 問題**，不是 runtime 問題：

- 官方 binary 中的 CUDA kernel 只編譯了 x86_64 + sm_80/sm_86/sm_90 等架構
- DGX Spark 需要 **aarch64 + sm_121** 的組合
- 此組合目前只能透過**從源碼自行編譯**取得

> **結論**：截至 2026 Q2，在 DGX Spark 上啟用 PaddlePaddle GPU 加速的唯一方式是從源碼編譯。

---

## 3. 系統前期確認

在開始任何安裝之前，確認以下所有項目均符合預期。

### 3.1 確認系統架構

```bash
uname -m
```

預期輸出：`aarch64`

### 3.2 確認 CUDA 版本

```bash
nvcc --version
```

預期輸出包含：`release 13.0`（或 12.9+）

### 3.3 確認 GPU 狀態

```bash
nvidia-smi
```

預期輸出關鍵項目：
- `GB10` 字樣
- `Compute Capability: 12.1`
- Driver 正常載入（無 `N/A` 或錯誤）

### 3.4 確認 Python 版本

```bash
python3 --version
```

預期輸出：Python `3.10`、`3.11` 或 `3.12`（推薦 3.12）

### 3.5 確認 CUDA Toolkit（aarch64 SBSA 版本）

```bash
dpkg -l | grep cuda-toolkit
```

若無輸出，安裝：
```bash
sudo apt-get install cuda-toolkit-13-0
```

### 3.6 確認系統更新狀態

```bash
sudo apt-get update
sudo apt-get upgrade
# 確認無 pending 的 kernel / firmware update
sudo reboot  # 若有 pending update，先重開機
```

> **重要**：有 pending kernel update 未重開機的情況下編譯可能失敗，請確保系統是最新狀態且已重開機。

---

## 4. 唯一可行路徑：從源碼編譯 PaddlePaddle

### 4.1 安裝系統依賴

```bash
sudo apt-get update
sudo apt-get install -y \
    git cmake ninja-build \
    python3-dev python3-pip python3-venv \
    libopenblas-dev liblapack-dev \
    gfortran patchelf swig \
    wget curl unzip \
    libssl-dev zlib1g-dev
```

### 4.2 建立編譯專用 venv

> **重要**：編譯用的 venv 與後續工作用的 venv **必須分開**，不可混用。

```bash
python3 -m venv ~/paddle_compile_env
source ~/paddle_compile_env/bin/activate
```

確認 venv 已正確啟用：
```bash
which python3
# 必須輸出：/home/<user>/paddle_compile_env/bin/python3
# 不可以是：/usr/bin/python3
```

### 4.3 安裝編譯依賴到 venv

```bash
(paddle_compile_env)$ pip install --upgrade pip
(paddle_compile_env)$ pip install numpy protobuf cython wheel setuptools
```

### 4.4 Clone PaddlePaddle 源碼

```bash
(paddle_compile_env)$ cd ~
(paddle_compile_env)$ git clone https://github.com/PaddlePaddle/Paddle.git
(paddle_compile_env)$ cd Paddle
```

切換到 develop branch（社群驗證可在 DGX Spark 上編譯成功）：
```bash
(paddle_compile_env)$ git checkout develop
```

> 也可嘗試 `git checkout v3.0.0` 等穩定 tag，但社群驗證案例使用 develop。

拉取 submodules（這步不可跳過）：
```bash
(paddle_compile_env)$ git submodule update --init --recursive
```

確認源碼完整：
```bash
(paddle_compile_env)$ ls ~/Paddle
(paddle_compile_env)$ git log --oneline -3
```

### 4.5 安裝 Python 打包依賴

```bash
(paddle_compile_env)$ pip install -r ~/Paddle/python/requirements.txt
```

### 4.6 CMake 配置（關鍵步驟）

```bash
(paddle_compile_env)$ mkdir -p ~/Paddle/build
(paddle_compile_env)$ cd ~/Paddle/build

(paddle_compile_env)$ cmake .. \
    -GNinja \
    -DCMAKE_BUILD_TYPE=Release \
    -DWITH_GPU=ON \
    -DWITH_TESTING=OFF \
    -DCUDA_ARCH_NAME=Manual \
    -DCUDA_ARCH_BIN="12.1" \
    -DWITH_ARM=ON \
    -DWITH_AVX=OFF \
    -DWITH_MKL=OFF \
    -DWITH_MKLDNN=OFF \
    -DWITH_TENSORRT=OFF \
    -DCMAKE_CUDA_FLAGS="-U__ARM_NEON -DEIGEN_DONT_VECTORIZE=1" \
    -DPYTHON_EXECUTABLE=$(which python3) \
    2>&1 | tee cmake_output.log
```

**各 flag 說明**：

| Flag | 值 | 原因 |
|---|---|---|
| `-DCUDA_ARCH_BIN` | `"12.1"` | GB10 的 Compute Capability 是 sm_121 |
| `-DWITH_ARM` | `ON` | 啟用 aarch64 code path |
| `-DWITH_AVX` | `OFF` | AVX 是 x86 專屬指令集，ARM 無此指令 |
| `-DWITH_MKL` | `OFF` | Intel MKL，ARM 不支援 |
| `-DWITH_MKLDNN` | `OFF` | Intel oneDNN，ARM 不支援 |
| `-DWITH_TENSORRT` | `OFF` | aarch64 TRT 支援尚不完整 |
| `-U__ARM_NEON` | （CUDA flag）| 解除 Eigen 自動偵測 NEON 的衝突 |
| `EIGEN_DONT_VECTORIZE=1` | （CUDA flag）| 關閉 Eigen 向量化，避免 CUDA kernel 生成錯誤 |

若 cmake 成功，最後應看到：
```
-- Configuring done
-- Build files have been written to: /home/<user>/Paddle/build
```

若出現錯誤，檢查 `cmake_output.log`。

### 4.7 開始編譯

```bash
(paddle_compile_env)$ ninja -j$(nproc) 2>&1 | tee build_output.log
```

- 在 DGX Spark 上預計耗時約 **40 分鐘**
- 若記憶體壓力大，可改用 `ninja -j8` 限制並行數
- 過程中若出現錯誤，檢查 `build_output.log`

編譯成功後確認 wheel 產出：
```bash
ls ~/Paddle/build/python/dist/
# 應看到類似：paddlepaddle_gpu-3.x.x.devYYYYMMDD-cp312-cp312-linux_aarch64.whl
```

---

## 5. 安裝 PaddleOCR 並驗證 GPU

### 5.1 建立工作 venv（與編譯 venv 分開）

```bash
(paddle_compile_env)$ deactivate

$ python3 -m venv ~/ocr_work_env
$ source ~/ocr_work_env/bin/activate
```

### 5.2 安裝 PaddleOCR

```bash
(ocr_work_env)$ pip install paddleocr 'numpy<2.0.0' opencv-python-headless Pillow
```

> `paddleocr` 安裝時會自動拉取 CPU 版 paddlepaddle 作為依賴，下一步會覆蓋為 GPU 版。

### 5.3 安裝自編 GPU wheel（覆蓋 CPU 版）

```bash
(ocr_work_env)$ pip install \
    ~/Paddle/build/python/dist/paddlepaddle_gpu-*-linux_aarch64.whl \
    --force-reinstall
```

### 5.4 驗證 GPU 是否正確啟用

```bash
python3 -c "
import paddle
paddle.utils.run_check()
print('---')
print('GPU available:', paddle.is_compiled_with_cuda())
print('GPU count:', paddle.device.cuda.device_count())
print('Current device:', paddle.device.get_device())
"
```

預期輸出：
```
Running verify PaddlePaddle program ...
PaddlePaddle works well on 1 GPU.
PaddlePaddle is installed successfully!
---
GPU available: True
GPU count: 1
Current device: gpu:0
```

> 若 `GPU available: False`，代表 wheel 未正確覆蓋，重跑 5.3 步驟。

---

## 6. 執行 PP-OCRv5 推論

### 6.1 基本推論程式碼

```python
from paddleocr import PaddleOCR
import platform
import paddle

def create_ocr_engine(lang='chinese_cht'):
    arch = platform.machine()
    has_gpu = paddle.is_compiled_with_cuda()
    print(f"[INFO] Architecture: {arch}, GPU: {has_gpu}")

    return PaddleOCR(
        use_angle_cls=True,   # 偵測旋轉文字
        lang=lang,
        use_gpu=has_gpu,      # 自動偵測，不 hardcode
        gpu_mem=8000,         # GPU 記憶體限制（MB），128GB unified memory 可調高
    )

ocr = create_ocr_engine(lang='chinese_cht')  # 繁中；'ch' 為簡中

result = ocr.ocr('image.jpg', cls=True)
for line in result[0]:
    text, confidence = line[1]
    print(f"{text}  (conf: {confidence:.3f})")
```

### 6.2 語言參數對照

| 語言 | `lang` 參數 |
|---|---|
| 繁體中文 | `chinese_cht` |
| 簡體中文 | `ch` |
| 英文 | `en` |
| 日文 | `japan` |

### 6.3 模型版本選擇

PP-OCRv5 為預設最新版，若需明確指定：
```python
ocr = PaddleOCR(
    use_angle_cls=True,
    lang='chinese_cht',
    use_gpu=True,
    ocr_version='PP-OCRv4',  # 或 'PP-OCRv5'
)
```

---

## 7. 自製 Docker Image（可複製環境）

若需要將環境打包成 Docker image 以供部署或複製：

### 7.1 Dockerfile（DGX Spark 專用）

```dockerfile
# Dockerfile.paddleocr-aarch64
FROM nvcr.io/nvidia/cuda:13.0-devel-ubuntu24.04

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    libopenblas-dev libgomp1 \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# 複製自編 wheel（需先在 host 上編譯完成）
COPY paddlepaddle_gpu-*-linux_aarch64.whl /tmp/

RUN pip3 install --no-cache-dir /tmp/paddlepaddle_gpu-*-linux_aarch64.whl
RUN pip3 install --no-cache-dir paddleocr 'numpy<2.0.0' \
    opencv-python-headless Pillow

WORKDIR /workspace
CMD ["python3"]
```

### 7.2 Build 與執行

```bash
# 將 wheel 複製到 Dockerfile 同層目錄
cp ~/Paddle/build/python/dist/paddlepaddle_gpu-*-linux_aarch64.whl .

# Build image
docker build -f Dockerfile.paddleocr-aarch64 -t paddleocr:aarch64-gpu .

# 執行並驗證
docker run --gpus all \
    -v $(pwd)/data:/workspace/data \
    paddleocr:aarch64-gpu \
    python3 -c "
import paddle
print('GPU:', paddle.is_compiled_with_cuda())
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_gpu=True, lang='chinese_cht')
print('PaddleOCR loaded OK')
"
```

---

## 8. 多環境支援：DGX Spark + 現有 x86 GPU 機器

若需要同一套 OCR pipeline 同時在 DGX Spark 和現有 x86 GPU 機器上運行：

### 8.1 原則

**程式碼與模型完全共用，只有安裝方式不同。**

```
同一份 inference.py
    ├── x86_64 機器 → pip install paddlepaddle-gpu（官方 wheel）
    └── DGX Spark   → pip install 自編 wheel
```

### 8.2 Dockerfile 對照（兩份 Dockerfile，同一份程式碼）

**x86 GPU 機器**（`Dockerfile.x86`）：
```dockerfile
FROM nvcr.io/nvidia/cuda:12.6-devel-ubuntu22.04

RUN pip install paddlepaddle-gpu==3.0.0 \
    -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
RUN pip install paddleocr 'numpy<2.0.0' opencv-python-headless Pillow

WORKDIR /workspace
```

**DGX Spark**（`Dockerfile.aarch64`）：
```dockerfile
FROM nvcr.io/nvidia/cuda:13.0-devel-ubuntu24.04

COPY paddlepaddle_gpu-*-linux_aarch64.whl /tmp/
RUN pip install /tmp/paddlepaddle_gpu-*-linux_aarch64.whl
RUN pip install paddleocr 'numpy<2.0.0' opencv-python-headless Pillow

WORKDIR /workspace
```

### 8.3 推論程式碼（兩個平台共用）

```python
import platform
import paddle
from paddleocr import PaddleOCR

arch = platform.machine()          # 'x86_64' 或 'aarch64'
has_gpu = paddle.is_compiled_with_cuda()

print(f"[INFO] arch={arch}, gpu={has_gpu}")

ocr = PaddleOCR(
    use_angle_cls=True,
    lang='chinese_cht',
    use_gpu=has_gpu,   # 自動偵測，兩個平台行為一致
)
```

### 8.4 模型權重共用

PaddleOCR 模型權重與平台無關，可以：
- 放在共用 NFS，兩個環境掛載同一路徑
- 或各自下載（第一次執行時自動下載）

---

## 9. 常見錯誤與解法

| 錯誤訊息 | 原因 | 解法 |
|---|---|---|
| `Eigen` 相關 compile error | ARM NEON 與 Eigen 向量化衝突 | 確認 cmake 有加 `-U__ARM_NEON -DEIGEN_DONT_VECTORIZE=1` |
| `exec format error` | Docker image 架構不符（amd64 vs arm64） | 確認拉取的 image 有 aarch64 版本 |
| `GPU available: False` | wheel 安裝後未覆蓋 CPU 版 | 重跑 `pip install --force-reinstall` |
| `Segmentation fault` | numpy 版本衝突 | 固定 `pip install 'numpy<2.0.0'` |
| `libcuda.so not found` | Docker 未掛載 GPU | 確認 `docker run --gpus all --runtime=nvidia` |
| cmake 找不到 python | venv 未 activate | 確認 `which python3` 指向 venv 路徑 |
| `git submodule` 拉取失敗 | 網路問題或 submodule URL 變更 | 重試 `git submodule update --init --recursive` |
| ninja 編譯中途 OOM | 並行數過高 | 改用 `ninja -j8` 限制並行 |

---

## 10. 參考資料

- [PaddleOCR GitHub](https://github.com/PaddlePaddle/PaddleOCR)
- [PaddlePaddle GitHub](https://github.com/PaddlePaddle/Paddle)
- [社群討論：PaddleOCR ARM/aarch64 support #17328](https://github.com/PaddlePaddle/PaddleOCR/discussions/17328)
- [社群教學：PaddlePaddle with GPU on DGX Spark](https://news.metaparadigma.de/dgx-spark-installing-paddlepaddle-ocr-on-nvidia-dgx-spark-5348/)
- [NVIDIA DGX OS 7 User Guide](https://docs.nvidia.com/dgx/dgx-os-7-user-guide/)
- [PaddleOCR-VL Blackwell 環境配置教學](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL-NVIDIA-Blackwell.html)