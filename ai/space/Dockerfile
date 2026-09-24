# PRAHARI AI inference service as a Hugging Face Space (Docker, CPU).
# Assembled by ai/space/stage.py; see ai/space/README.md.
FROM python:3.10-slim

# OpenCV (pulled in by Ultralytics) needs these shared libraries.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
WORKDIR /app

# CPU-only PyTorch first, so Ultralytics does not pull the CUDA build.
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1 \
 && pip install --no-cache-dir -r requirements.txt

COPY --chown=user . /app
USER user

ENV PPE_HOST=0.0.0.0 \
    PPE_PORT=7860 \
    PPE_DEVICE=cpu \
    YOLO_CONFIG_DIR=/tmp/Ultralytics \
    PPE_WEIGHTS=/app/models/ppe-v1/weights/best.pt \
    GENERAL_WEIGHTS=/app/models/general-coco/weights/yolov8n.pt \
    POSE_WEIGHTS=/app/models/pose-coco/weights/yolov8n-pose.pt \
    FIRE_WEIGHTS=/app/models/fire-v1/weights/best.pt \
    PPE_ALLOWED_ORIGINS=https://prahari-silk.vercel.app,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173

EXPOSE 7860
CMD ["python", "inference_service/server.py"]
