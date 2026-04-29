#!/usr/bin/env bash
set -euo pipefail

# Auto-detect default based on architecture
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

case "$CHOICE" in
    1)
        echo ""
        echo "▶ 啟動 x86 環境..."
        docker compose -f docker-compose.yml up "$@"
        ;;
    2)
        echo ""
        echo "▶ 啟動 DGX Spark 環境..."
        sudo docker compose -f docker-compose.yml -f docker-compose.dgxspark.yml up "$@"
        ;;
    *)
        echo "無效選項：$CHOICE" >&2
        exit 1
        ;;
esac
