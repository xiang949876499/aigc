#!/bin/bash
# scripts/download-models.sh
# 下载 Sherpa-ONNX 中英文双语流式识别模型

set -e

MODEL_NAME="sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2"
MODEL_DIR="public/models"

echo "Creating model directory..."
mkdir -p "$MODEL_DIR"

cd "$MODEL_DIR"

if [ -d "$MODEL_NAME" ]; then
  echo "Model already exists, skipping download."
  exit 0
fi

echo "Downloading model from GitHub releases..."
curl -L -O "$MODEL_URL"

echo "Extracting model files..."
tar xvf "${MODEL_NAME}.tar.bz2"

echo "Cleaning up archive..."
rm "${MODEL_NAME}.tar.bz2"

echo "Model downloaded successfully!"
echo "Model location: $(pwd)/$MODEL_NAME"
ls -la "$MODEL_NAME"
