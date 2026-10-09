"""Step 3 — validation and testing.

Evaluates trained weights on the validation split and on the held-out test
split (never seen during training or model selection) and records precision,
recall, mAP@0.5 and mAP@0.5:0.95 overall and per class.

Usage:
    python ai/ppe/evaluate.py --weights E:/prahari-ml/runs/ppe-v1/weights/best.pt
Writes <run>/metrics.json, which export.py copies into the model manifest.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATASETS, RUNS, configure_ultralytics, write_json  # noqa: E402


def summarise(results, names: dict[int, str]) -> dict:
    box = results.box
    per_class = {}
    for i, cls in enumerate(box.ap_class_index):
        per_class[names[int(cls)]] = {
            "precision": round(float(box.p[i]), 4),
            "recall": round(float(box.r[i]), 4),
            "mAP50": round(float(box.ap50[i]), 4),
            "mAP50_95": round(float(box.ap[i]), 4),
        }
    return {
        "precision": round(float(box.mp), 4),
        "recall": round(float(box.mr), 4),
        "mAP50": round(float(box.map50), 4),
        "mAP50_95": round(float(box.map), 4),
        "per_class": per_class,
        "speed_ms_per_image": {k: round(float(v), 2) for k, v in results.speed.items()},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", type=Path, default=RUNS / "ppe-v1" / "weights" / "best.pt")
    ap.add_argument("--data", type=Path, default=DATASETS / "ppe-v1" / "data.yaml")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="0")
    # Small batches and no loader processes: evaluation then fits beside other
    # applications on a 4 GB GPU / 8 GB laptop (larger batches fail in cuDNN there).
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--workers", type=int, default=0)
    args = ap.parse_args()

    configure_ultralytics()
    import yaml
    from ultralytics import YOLO

    model = YOLO(str(args.weights))
    data = yaml.safe_load(args.data.read_text(encoding="utf-8"))
    out = {"weights": str(args.weights), "data": str(args.data), "imgsz": args.imgsz}

    for split in ("val", "test"):
        if split not in data:
            continue
        r = model.val(
            data=str(args.data), split=split, imgsz=args.imgsz, device=args.device, plots=False, verbose=False,
            batch=args.batch, workers=args.workers,
            project=str(args.weights.parent.parent), name=f"eval-{split}", exist_ok=True,  # keep outputs with the run
        )
        out[split] = summarise(r, model.names)
        s = out[split]
        print(f"\n{split.upper():5s} precision {s['precision']:.3f}  recall {s['recall']:.3f}  "
              f"mAP50 {s['mAP50']:.3f}  mAP50-95 {s['mAP50_95']:.3f}")
        for cls, m in s["per_class"].items():
            print(f"      {cls:8s} P {m['precision']:.3f}  R {m['recall']:.3f}  mAP50 {m['mAP50']:.3f}  mAP50-95 {m['mAP50_95']:.3f}")

    target = args.weights.parent.parent / "metrics.json"
    write_json(target, out)
    print(f"\nMetrics written to {target}")


if __name__ == "__main__":
    main()
