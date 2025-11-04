# Backend development image
FROM python:3.12-slim

WORKDIR /app

# Keep Python output unbuffered and avoid .pyc files
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system dependencies for PaddleOCR and OpenCV
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install PaddlePaddle GPU from official source (CUDA 12.9)
RUN pip install --no-cache-dir paddlepaddle-gpu==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/

# Install backend requirements
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

# App source mounted at runtime for live reload
