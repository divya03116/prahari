"""PRAHARI inference service — PPE and hazard models.

A small HTTP service that runs the site's YOLO models. The web app captures
camera frames (or a worker's photo) in the browser and posts them here; the
service returns what each model detected. It can run on the same laptop, a GPU
server, a cloud VM or an edge box — the app only needs its URL
(VITE_PPE_INFERENCE_URL).

Models, each optional and each served only if it has evaluation metrics:
    ppe      helmet, vest, gloves, boots, goggles + person   (trained: ppe-v1)
    general  COCO objects: people, vehicles, phones, objects (pretrained)
    pose     people with 17 body keypoints                   (pretrained)
    fire     fire and smoke                                  (trained: fire-v1)

Only the Python standard library is used for HTTP, so the one dependency is
Ultralytics (already needed for training).

Endpoints
    GET  /v1/health     -> {"ok": true}
    GET  /v1/model      -> {"configured": true, "models": [...], "missing": [...],
                            + the PPE model's name/classes/metrics at top level},
                           or 503 {"configured": false, "reason": ...}
    POST /v1/detect[?models=ppe,general,pose,fire]
                        -> body: a JPEG/PNG image; returns
                           {"width", "height", "inferenceMs", "timings",
                            "detections": [{"label", "confidence", "model",
                                            "box": {"x1","y1","x2","y2"},
                                            "keypoints"?: [[x, y, conf] * 17]}]}

It returns raw detections only. Deciding what is a violation or a hazard is the
app's job (functions/src/shared/ppe.ts and hazards.ts), so the rules live in
one place.

Run:
    python ai/inference_service/server.py

Environment:
    PPE_WEIGHTS          PPE model weights (.pt or .onnx)
    GENERAL_WEIGHTS      COCO object model     (empty string = off)
    POSE_WEIGHTS         COCO pose model       (empty string = off)
    FIRE_WEIGHTS         fire/smoke model      (empty string = off)
    PPE_DEVICE           "cpu", "0" (first GPU) or "auto" (default)
    PPE_HOST / PPE_PORT  bind address (default 127.0.0.1:8765)
    PPE_ALLOWED_ORIGINS  comma-separated browser origins allowed to call it
    PPE_TOKEN            optional shared secret; if set, requests need
                         "Authorization: Bearer <token>"
    PPE_ALLOW_UNEVALUATED  "1" to serve weights that have no evaluation
                         metrics (development only)
"""

from __future__ import annotations

import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ppe"))

ROLES = {
    # role: (environment variable, default weights)
    "ppe": ("PPE_WEIGHTS", "E:/prahari-ml/runs/ppe-v1/weights/best.pt"),
    "general": ("GENERAL_WEIGHTS", "E:/prahari-ml/models/general-coco/weights/yolov8n.pt"),
    "pose": ("POSE_WEIGHTS", "E:/prahari-ml/models/pose-coco/weights/yolov8n-pose.pt"),
    "fire": ("FIRE_WEIGHTS", "E:/prahari-ml/runs/fire-v1/weights/best.pt"),
}
WEIGHTS = {role: os.environ.get(env, default) for role, (env, default) in ROLES.items()}
HOST = os.environ.get("PPE_HOST", "127.0.0.1")
PORT = int(os.environ.get("PPE_PORT", "8765"))
DEVICE = os.environ.get("PPE_DEVICE", "auto")
TOKEN = os.environ.get("PPE_TOKEN", "")
ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "PPE_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173",
    ).split(",")
    if o.strip()
}
MAX_BYTES = 8 * 1024 * 1024
MIN_CONF = 0.25  # the app applies its own, stricter thresholds

_models: dict[str, tuple[object, str]] = {}
_infos: dict[str, dict] = {}
_errors: dict[str, str] = {}
_lock = threading.Lock()


def evaluation(weights: Path) -> tuple[str, dict | None]:
    """(model name, test metrics) for a training run's .pt or an exported .onnx."""
    manifest = weights.parent / "manifest.json"
    if weights.suffix == ".onnx" and manifest.exists():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        return data.get("name") or weights.stem, data.get("metrics")
    metrics_file = weights.parent.parent / "metrics.json"  # <run>/weights/best.pt
    metrics = json.loads(metrics_file.read_text(encoding="utf-8")) if metrics_file.exists() else None
    return weights.parent.parent.name, metrics


def load_models() -> None:
    """Loads every configured model once. A model that cannot be served is
    reported with the reason; the others still work."""
    import torch
    from ultralytics import YOLO

    device = DEVICE
    if device == "auto":
        device = "0" if torch.cuda.is_available() else "cpu"
    for role, raw in WEIGHTS.items():
        if not raw:
            continue  # switched off
        path = Path(raw)
        if not path.exists():
            _errors[role] = f"No weights at {path}."
            continue
        # Only serve evaluated weights: a checkpoint from an interrupted run
        # must never go live silently.
        name, metrics = evaluation(path)
        if metrics is None and os.environ.get("PPE_ALLOW_UNEVALUATED") != "1":
            _errors[role] = f"The weights at {path} have not been evaluated (no metrics)."
            continue
        try:
            model = YOLO(str(path))
            names = [model.names[i] for i in sorted(model.names)]
            if role == "ppe" and "person" not in names:
                raise RuntimeError(f"The model has no 'person' class (classes: {names}).")
            _models[role] = (model, device)
            _infos[role] = {
                "role": role,
                "name": name,
                "architecture": "YOLOv8",
                "weights": path.name,
                "classes": names,
                "keypoints": getattr(model, "task", "") == "pose",
                "device": "gpu" if device != "cpu" else "cpu",
                "metrics": metrics,
            }
        except Exception as exc:  # noqa: BLE001 - report any load failure to the app
            _errors[role] = f"Could not load the model: {exc}"


def model_description() -> dict:
    body: dict = {
        "configured": True,
        "models": list(_infos.values()),
        "missing": [{"role": r, "reason": e} for r, e in _errors.items()],
    }
    ppe = _infos.get("ppe")
    if ppe:  # the PPE model's fields at top level, as before
        body.update({k: ppe[k] for k in ("name", "architecture", "weights", "classes", "device", "metrics")})
        body["personClass"] = "person"
    return body


def detect(image_bytes: bytes, roles: list[str]) -> dict:
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    dets: list[dict] = []
    timings: dict[str, float] = {}
    with _lock:  # one frame at a time on the device
        for role in roles:
            model, device = _models[role]
            t0 = time.perf_counter()
            result = model.predict(img, conf=MIN_CONF, device=device, verbose=False)[0]
            timings[role] = round((time.perf_counter() - t0) * 1000, 1)
            names = result.names
            points = result.keypoints.data.tolist() if getattr(result, "keypoints", None) is not None else None
            for i, (xyxy, conf, cls) in enumerate(
                zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), result.boxes.cls.tolist())
            ):
                x1, y1, x2, y2 = xyxy
                d = {
                    "label": names[int(cls)],
                    "confidence": round(conf, 4),
                    "model": role,
                    "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                }
                if points is not None and i < len(points):
                    d["keypoints"] = [[round(x, 1), round(y, 1), round(c, 3)] for x, y, c in points[i]]
                dets.append(d)
    return {
        "width": img.width,
        "height": img.height,
        "inferenceMs": round(sum(timings.values()), 1),
        "timings": timings,
        "detections": dets,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "PrahariPPE/1"

    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            # A hosted site (e.g. on Vercel) calling this computer: Chrome asks
            # first (Private/Local Network Access) and needs this answer.
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self) -> bool:
        return not TOKEN or self.headers.get("Authorization", "") == f"Bearer {TOKEN}"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/v1/health":
            return self._json(200, {"ok": True})
        if self.path == "/v1/model":
            if not self._authorised():
                return self._json(401, {"error": "unauthorised"})
            if not _models:
                reason = " ".join(f"{r}: {e}" for r, e in _errors.items()) or "No model configured."
                return self._json(503, {"configured": False, "reason": reason})
            return self._json(200, model_description())
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path != "/v1/detect":
            return self._json(404, {"error": "not found"})
        if not self._authorised():
            return self._json(401, {"error": "unauthorised"})
        if not _models:
            return self._json(503, {"configured": False, "reason": "No model configured."})
        asked = [r for r in ",".join(parse_qs(url.query).get("models", [])).split(",") if r]
        unknown = [r for r in asked if r not in _models]
        if unknown:
            return self._json(400, {"error": f"not loaded: {', '.join(unknown)}"})
        roles = asked or list(_models)
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BYTES:
            return self._json(413, {"error": "image missing or larger than 8 MB"})
        try:
            return self._json(200, detect(self.rfile.read(length), roles))
        except Exception as exc:  # noqa: BLE001
            return self._json(400, {"error": f"could not process the image: {exc}"})

    def log_message(self, fmt: str, *args) -> None:  # quieter console
        if not self.path.startswith("/v1/detect"):
            super().log_message(fmt, *args)


def main() -> None:
    load_models()
    ready = ", ".join(f"{r} ({i['name']})" for r, i in _infos.items()) or "none"
    print(f"PRAHARI inference service on http://{HOST}:{PORT}  — models: {ready}", flush=True)
    for role, err in _errors.items():
        print(f"  {role}: NOT LOADED — {err}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
