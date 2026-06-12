#!/bin/bash
# scripts/download-models.sh
# 下载 Sherpa-ONNX 中英文双语流式识别模型

set -euo pipefail

# Resolve script location and project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

MODEL_NAME="sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2"
MODEL_DIR="$PROJECT_ROOT/public/models"

# Cleanup on error
cleanup() {
  echo "Error occurred, cleaning up..."
  rm -f "$MODEL_DIR/${MODEL_NAME}.tar.bz2"
  rm -rf "$MODEL_DIR/${MODEL_NAME}"
}
trap cleanup ERR

echo "Creating model directory..."
mkdir -p "$MODEL_DIR"

cd "$MODEL_DIR"

if [ -d "$MODEL_NAME" ]; then
  echo "Model already exists, skipping download."
  exit 0
fi

echo "Downloading model from GitHub releases..."
curl -L --fail --retry 3 --retry-delay 5 --connect-timeout 30 --max-time 1800 -O "$MODEL_URL"

echo "Extracting model files..."
tar xjf "${MODEL_NAME}.tar.bz2"

echo "Cleaning up archive..."
rm -f "${MODEL_NAME}.tar.bz2"

echo "Model downloaded successfully!"
echo "Model location: $(pwd)/$MODEL_NAME"
ls -la "$MODEL_NAME"
