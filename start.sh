#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WHEEL_NAME="paddlepaddle_gpu-3.5.0.dev20260429-cp312-cp312-linux_aarch64.whl"
WHEEL_URL="https://github.com/Jason9339/document-ocr-annotation-system/releases/download/dgxspark-wheel-v1/${WHEEL_NAME}"
DGXSPARK_IMAGE="paddleocr-backend:dgxspark"

# ── Auto-detect default based on architecture ─────────────────────────────────

if [[ "$(uname -m)" == "aarch64" ]]; then
    DEFAULT=2
else
    DEFAULT=1
fi

echo "=============================="
echo "  Document OCR Annotation System"
echo "=============================="
echo ""
echo "  1) x86 GPU / CPU（一般工作站）"
echo "  2) DGX Spark（aarch64 + sm_121）"
echo ""
printf "請選擇環境 [預設: %d]: " "$DEFAULT"
read -r CHOICE
CHOICE="${CHOICE:-$DEFAULT}"

# ── DGX Spark: ensure image is ready before starting ─────────────────────────

_ensure_dgxspark_image() {
    if sudo docker image inspect "$DGXSPARK_IMAGE" &>/dev/null; then
        echo "✓ Image $DGXSPARK_IMAGE already exists"
        return
    fi

    echo ""
    echo "=== First-time setup: building DGX Spark image ==="

    # Download wheel if not present
    if ! ls "$PROJECT_ROOT"/paddlepaddle_gpu-*-linux_aarch64.whl &>/dev/null; then
        echo "Downloading pre-built wheel from GitHub Releases..."
        curl -L --progress-bar "$WHEEL_URL" -o "$PROJECT_ROOT/$WHEEL_NAME"
    else
        echo "✓ Wheel already present"
    fi

    echo ""
    echo "Building Docker image (this takes a few minutes)..."
    sudo docker build \
        -f "$PROJECT_ROOT/backend/Dockerfile.dgxspark" \
        -t "$DGXSPARK_IMAGE" \
        "$PROJECT_ROOT"

    echo "✓ Image built successfully"
}

# ── Launch ────────────────────────────────────────────────────────────────────

case "$CHOICE" in
    1)
        echo ""
        echo "▶ 啟動 x86 環境..."
        docker compose -f docker-compose.yml up "$@"
        ;;
    2)
        _ensure_dgxspark_image
        echo ""
        echo "▶ 啟動 DGX Spark 環境..."
        sudo docker compose -f docker-compose.yml -f docker-compose.dgxspark.yml up "$@"
        ;;
    *)
        echo "無效選項：$CHOICE" >&2
        exit 1
        ;;
esac
