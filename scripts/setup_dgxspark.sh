#!/usr/bin/env bash
# One-time setup for DGX Spark: fetch the pre-built wheel and build the Docker image.
#
# Usage:
#   bash scripts/setup_dgxspark.sh              # auto-download from GitHub Releases
#   bash scripts/setup_dgxspark.sh /path/to/wheel.whl   # from local path or NFS mount
#   bash scripts/setup_dgxspark.sh http://.../.whl       # from custom HTTP URL
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WHEEL_NAME="paddlepaddle_gpu-3.5.0.dev20260429-cp312-cp312-linux_aarch64.whl"
DEFAULT_URL="https://github.com/Jason9339/document-ocr-annotation-system/releases/download/dgxspark-wheel-v1/${WHEEL_NAME}"

# ── Check if wheel already present ───────────────────────────────────────────

if ls "$PROJECT_ROOT"/paddlepaddle_gpu-*-linux_aarch64.whl 2>/dev/null | head -1 | grep -q .; then
    EXISTING=$(ls "$PROJECT_ROOT"/paddlepaddle_gpu-*-linux_aarch64.whl | head -1)
    echo "✓ Wheel already present: $(basename "$EXISTING")"
else
    SOURCE="${1:-}"

    if [[ -z "$SOURCE" ]]; then
        echo "Downloading wheel from GitHub Releases..."
        curl -L --progress-bar "$DEFAULT_URL" -o "$PROJECT_ROOT/$WHEEL_NAME"
    elif [[ "$SOURCE" == http* ]]; then
        echo "Downloading wheel from $SOURCE..."
        curl -L --progress-bar "$SOURCE" -o "$PROJECT_ROOT/$(basename "$SOURCE")"
    elif [[ -f "$SOURCE" ]]; then
        echo "Copying wheel from $SOURCE..."
        cp "$SOURCE" "$PROJECT_ROOT/"
    else
        echo "ERROR: source not found: $SOURCE" >&2
        exit 1
    fi
fi

# ── Build Docker image ────────────────────────────────────────────────────────

echo ""
echo "=== Building Docker image paddleocr-backend:dgxspark ==="
sudo docker build -f "$PROJECT_ROOT/backend/Dockerfile.dgxspark" \
    -t paddleocr-backend:dgxspark \
    "$PROJECT_ROOT"

echo ""
echo "=== Setup complete ==="
echo "Start with: ./start.sh  (選 2)"
