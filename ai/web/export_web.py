"""Exports the site's YOLO models for running inside the browser.

    python ai/web/export_web.py            # -> public/models/*.onnx + manifest.json

The same weights the inference service serves (see ai/inference_service/server.py)
are exported to ONNX at 640 px and copied into the website, with a manifest
the browser reads: each model's role, name, architecture, classes, input size,
output layout and its measured test metrics. Nothing is retrained or changed;
the browser runs the identical networks with onnxruntime-web (WebGPU where the
device has it, WebAssembly otherwise).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "models"
WORK = Path(os.environ.get("PRAHARI_ML", "E:/prahari-ml")) / "web-export"

MODELS = {
    # role: (weights, published model name)
    "ppe": ("E:/prahari-ml/runs/ppe-v2/weights/best.pt", "ppe-v2"),
    "general": ("E:/prahari-ml/models/general-coco/weights/yolov8n.pt", "general-coco"),
    "pose": ("E:/prahari-ml/models/pose-coco/weights/yolov8n-pose.pt", "pose-coco"),
    "fire": ("E:/prahari-ml/runs/fire-v1/weights/best.pt", "fire-v1"),
}


def architecture(model) -> str:
    """The model family from the definition file the checkpoint records (yolo26n.yaml -> YOLO26)."""
    source = str((getattr(model.model, "yaml", None) or {}).get("yaml_file") or "")
    stem = Path(source).stem.lower()
    if stem.startswith("yolo26"):
        return "YOLO26"
    if stem.startswith("yolo11"):
        return "YOLO11"
    return "YOLOv8"


def metrics_for(weights: Path) -> dict | None:
    for candidate in (weights.parent.parent / "metrics.json", weights.parent / "metrics.json"):
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--only", nargs="*", default=list(MODELS))
    args = ap.parse_args()

    os.environ.setdefault("YOLO_CONFIG_DIR", str(WORK / "Ultralytics"))
    from ultralytics import YOLO
    import onnx

    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"models": []}
    entries = {m["role"]: m for m in manifest["models"]}

    for role in args.only:
        weights, name = MODELS[role]
        weights = Path(weights)
        work = WORK / name
        work.mkdir(parents=True, exist_ok=True)
        local = work / weights.name
        shutil.copy2(weights, local)  # export writes next to the weights; keep the training runs untouched
        model = YOLO(str(local))
        exported = Path(model.export(format="onnx", imgsz=args.imgsz, simplify=True, dynamic=False, batch=1, device="cpu"))
        graph = onnx.load(str(exported))
        outputs = [[d.dim_value for d in o.type.tensor_type.shape.dim] for o in graph.graph.output]
        out = outputs[0]
        # [1, N, 6] = boxes already selected by the network (x1, y1, x2, y2, score, class);
        # [1, 4 + C (+ keypoints), N] = raw YOLOv8-style head that needs NMS.
        layout = "end2end" if len(out) == 3 and out[2] == 6 and out[1] != 6 else "yolov8"
        target = OUT / f"{name}.onnx"
        shutil.copy2(exported, target)
        names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
        entries[role] = {
            "role": role,
            "name": name,
            "architecture": architecture(model),
            "file": target.name,
            "bytes": target.stat().st_size,
            "imgsz": args.imgsz,
            "layout": layout,
            "output": out,
            "classes": [names[i] for i in sorted(names)],
            "keypoints": bool(getattr(model.model, "kpt_shape", None)) or role == "pose",
            "metrics": metrics_for(weights),
        }
        print(f"  {role:8} {name:14} {architecture(model):7} {layout:8} output {out}  {target.stat().st_size / 1e6:.1f} MB")

    order = list(MODELS)
    manifest = {"imgsz": args.imgsz, "models": sorted(entries.values(), key=lambda m: order.index(m["role"]))}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"  manifest -> {manifest_path}")


if __name__ == "__main__":
    sys.exit(main())
