#!/usr/bin/env bash
# Compile PaddlePaddle from source for DGX Spark (aarch64 + sm_121 + CUDA 13.0)
# Following SOP sections 3-4.
#
# Usage: bash scripts/build_paddle_dgxspark.sh
#
# After completion, copy the wheel to the project root before docker build:
#   cp ~/Paddle/build/python/dist/paddlepaddle_gpu-*-linux_aarch64.whl .
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPILE_VENV="$HOME/paddle_compile_env"
PADDLE_SRC="$HOME/Paddle"
LOG_DIR="$PADDLE_SRC/build"

# ── Preflight checks ─────────────────────────────────────────────────────────

echo "=== Preflight checks ==="

arch=$(uname -m)
if [[ "$arch" != "aarch64" ]]; then
    echo "ERROR: This script is for aarch64 only. Current arch: $arch"
    exit 1
fi

cuda_ver=$(nvcc --version 2>/dev/null | grep -oP 'release \K[0-9]+\.[0-9]+' || echo "none")
echo "  Architecture : $arch"
echo "  CUDA version : $cuda_ver"
nvidia-smi --query-gpu=name,compute_cap --format=csv,noheader 2>/dev/null || echo "  WARNING: nvidia-smi failed"

python_ver=$(python3 --version 2>&1)
echo "  Python       : $python_ver"

# ── System dependencies ───────────────────────────────────────────────────────

echo ""
echo "=== Installing system dependencies ==="
sudo apt-get update -qq
sudo apt-get install -y \
    git cmake ninja-build \
    python3-dev python3-pip python3-venv \
    libopenblas-dev liblapack-dev \
    gfortran patchelf swig \
    wget curl unzip \
    libssl-dev zlib1g-dev

# ── Compile venv ─────────────────────────────────────────────────────────────

echo ""
echo "=== Setting up compile venv: $COMPILE_VENV ==="
if [[ ! -d "$COMPILE_VENV" ]]; then
    python3 -m venv "$COMPILE_VENV"
fi
source "$COMPILE_VENV/bin/activate"

which_python=$(which python3)
echo "  python3 -> $which_python"
if [[ "$which_python" != "$COMPILE_VENV"* ]]; then
    echo "ERROR: venv not active. python3 points to $which_python"
    exit 1
fi

pip install --upgrade pip -q
pip install numpy protobuf cython wheel setuptools -q

# ── Clone Paddle ─────────────────────────────────────────────────────────────

echo ""
echo "=== Cloning / updating PaddlePaddle source ==="
if [[ ! -d "$PADDLE_SRC/.git" ]]; then
    git clone https://github.com/PaddlePaddle/Paddle.git "$PADDLE_SRC"
fi
cd "$PADDLE_SRC"
git checkout develop
git pull --ff-only

echo "  Updating submodules (may take a few minutes)..."
git submodule update --init --recursive

pip install -r python/requirements.txt -q

# ── CMake configure ───────────────────────────────────────────────────────────

echo ""
echo "=== CMake configure ==="
mkdir -p "$PADDLE_SRC/build"
cd "$PADDLE_SRC/build"

cmake .. \
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
    -DPYTHON_EXECUTABLE="$(which python3)" \
    2>&1 | tee cmake_output.log

echo "  cmake done"

# ── Build ─────────────────────────────────────────────────────────────────────

echo ""
echo "=== Building (ninja -j$(nproc)) — expected ~40 min on DGX Spark ==="
echo "    Log: $LOG_DIR/build_output.log"
ninja -j"$(nproc)" 2>&1 | tee build_output.log

# ── Copy wheel to project root ────────────────────────────────────────────────

echo ""
echo "=== Build complete. Locating wheel ==="
WHEEL=$(ls "$PADDLE_SRC/build/python/dist/paddlepaddle_gpu-"*"-linux_aarch64.whl" 2>/dev/null | head -1)
if [[ -z "$WHEEL" ]]; then
    echo "ERROR: wheel not found under $PADDLE_SRC/build/python/dist/"
    exit 1
fi
echo "  Wheel: $WHEEL"

cp "$WHEEL" "$PROJECT_ROOT/"
echo "  Copied to: $PROJECT_ROOT/$(basename "$WHEEL")"

echo ""
echo "=== Phase 1 complete ==="
echo ""
echo "Next step — build the DGX Spark Docker image:"
echo "  cd $PROJECT_ROOT"
echo "  docker compose -f docker-compose.yml -f docker-compose.dgxspark.yml build"
