"""Step 4 — export for deployment.

The inference service (ai/inference_service) serves the trained .pt weights
directly. This step additionally exports a portable ONNX model for edge
devices and other runtimes, with a manifest describing it:

    <WORK>/exports/
        <name>.onnx       # YOLOv8 graph, input [1,3,S,S] RGB 0..1, output [1,4+C,N]
        manifest.json     # classes, input size, metrics, provenance

The inference service can load the .onnx file too (PPE_WEIGHTS=<file>.onnx).

Usage:
    python ai/ppe/export.py --weights E:/prahari-ml/runs/ppe-v1/weights/best.pt
"""

from __future__ import annotations

import argparse
import datetime as dt
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATASETS, EXPORTS, RUNS, configure_ultralytics, read_json, write_json  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", type=Path, default=RUNS / "ppe-v1" / "weights" / "best.pt")
    ap.add_argument("--data", type=Path, default=DATASETS / "ppe-v1" / "data.yaml")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--name", default="ppe-v1")
    ap.add_argument("--out", type=Path, default=EXPORTS)
    args = ap.parse_args()

    configure_ultralytics()
    from ultralytics import YOLO

    model = YOLO(str(args.weights))
    onnx_path = Path(model.export(format="onnx", imgsz=args.imgsz, opset=17, simplify=True, dynamic=False, nms=False))

    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / f"{args.name}.onnx"
    shutil.copy2(onnx_path, target)

    run = args.weights.parent.parent
    metrics_file = run / "metrics.json"
    metrics = read_json(metrics_file) if metrics_file.exists() else None
    report_file = args.data.parent / "report.json"
    dataset = read_json(report_file) if report_file.exists() else None
    args_file = run / "args.yaml"

    names = [model.names[i] for i in sorted(model.names)]
    manifest = {
        "schema": 1,
        "name": args.name,
        "architecture": "YOLOv8",
        "baseWeights": _base_weights(args_file),
        "task": "detect",
        "format": "onnx",
        "file": target.name,
        "bytes": target.stat().st_size,
        "input": {"size": args.imgsz, "layout": "NCHW", "channels": "RGB", "scale": "0..1", "letterbox": True},
        "output": {"layout": "yolov8", "shape": [1, 4 + len(names), "N"], "boxes": "cxcywh-pixels", "nms": False},
        "classes": names,
        "personClass": "person",
        "metrics": metrics,
        "dataset": dataset,
        "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "license": "Weights trained with Ultralytics YOLO (AGPL-3.0) on the dataset listed above.",
    }
    write_json(args.out / "manifest.json", manifest)
    print(f"Exported {target} ({target.stat().st_size / 1e6:.1f} MB)")
    print(f"Manifest  {args.out / 'manifest.json'}")


def _base_weights(args_file: Path) -> str | None:
    if not args_file.exists():
        return None
    import yaml

    return str(yaml.safe_load(args_file.read_text(encoding="utf-8")).get("model"))


if __name__ == "__main__":
    main()
