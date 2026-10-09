---
title: PRAHARI AI
colorFrom: purple
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# PRAHARI AI inference service

The model server behind PRAHARI's live safety monitoring and photo reports,
hosted so the website works from any device (phones included) without the
laptop that trained the models.

It serves four YOLOv8 models on CPU:

| Role | Weights | Detects |
|---|---|---|
| `ppe` | `ppe-v2` (trained for PRAHARI) | people and missing PPE |
| `general` | `yolov8n` (COCO, pretrained) | vehicles, phones and other objects for hazard rules |
| `pose` | `yolov8n-pose` (COCO, pretrained) | body posture |
| `fire` | `fire-v1` (trained for PRAHARI) | fire and smoke |

Each model is served only with its evaluation results (`metrics.json`) next to
the weights. Endpoints: `GET /v1/health`, `GET /v1/model`, `POST /v1/detect`.
Browsers may call it only from the origins in `PPE_ALLOWED_ORIGINS` (Dockerfile).

This folder in the PRAHARI repository holds the Space definition; the upload
itself is assembled by `python ai/space/stage.py` (server code + weights +
metrics) and pushed with the Hugging Face CLI.
