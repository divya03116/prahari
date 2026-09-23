"""Registers the two pretrained models the hazard rules use, with evidence.

    general-coco   yolov8n.pt       COCO, 80 classes: people, vehicles, phones, objects
    pose-coco      yolov8n-pose.pt  COCO keypoints: people and their posture

Neither is trained here, so each gets a metrics.json with (a) the accuracy
Ultralytics publishes for it on COCO, and (b) our own check of the one thing
every hazard rule depends on — finding people — on the held-out TEST split of
the construction-site PPE dataset (never used for training). The inference
service refuses weights without metrics, exactly as for trained models.

    python ai/hazards/register_pretrained.py
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ppe"))
from common import DATASETS, WEIGHTS, WORK, configure_ultralytics, write_json  # noqa: E402

MODELS = WORK / "models"
PUBLISHED = {
    "general-coco": {
        "weights": "yolov8n.pt",
        "published": {
            "dataset": "COCO val2017",
            "metric": "box mAP50-95",
            "value": 0.373,
            "source": "https://docs.ultralytics.com/models/yolov8/",
        },
    },
    "pose-coco": {
        "weights": "yolov8n-pose.pt",
        "published": {
            "dataset": "COCO val2017 keypoints",
            "metric": "pose mAP50-95 / mAP50",
            "value": 0.504,
            "mAP50": 0.801,
            "source": "https://docs.ultralytics.com/models/yolov8/",
        },
    },
}


def iou(a, b) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def person_check(model, data_dir: Path, conf: float, device: str) -> dict:
    """Precision and recall for 'person' at one operating point (IoU 0.5)."""
    images = sorted((data_dir / "images" / "test").glob("*.*"))
    tp = fp = fn = 0
    for img in images:
        label = data_dir / "labels" / "test" / f"{img.stem}.txt"
        r = model.predict(str(img), conf=conf, device=device, verbose=False, classes=[0])[0]
        h, w = r.orig_shape
        truth = []
        for line in label.read_text(encoding="utf-8").splitlines() if label.exists() else []:
            p = line.split()
            if len(p) == 5 and p[0] == "0":  # ppe-v1 class 0 = person
                xc, yc, bw, bh = (float(v) for v in p[1:])
                truth.append(((xc - bw / 2) * w, (yc - bh / 2) * h, (xc + bw / 2) * w, (yc + bh / 2) * h))
        preds = sorted(zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist()), key=lambda x: -x[1])
        used = set()
        for box, _ in preds:
            best, bi = 0.0, -1
            for i, t in enumerate(truth):
                if i not in used and (s := iou(box, t)) > best:
                    best, bi = s, i
            if best >= 0.5:
                used.add(bi)
                tp += 1
            else:
                fp += 1
        fn += len(truth) - len(used)
    return {
        "data": f"{data_dir.name} test split ({len(images)} images, {tp + fn} people)",
        "confidence": conf,
        "iou": 0.5,
        "precision": round(tp / max(1, tp + fp), 4),
        "recall": round(tp / max(1, tp + fn), 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=DATASETS / "ppe-v1")
    ap.add_argument("--conf", type=float, default=0.5, help="the app's default hazard confidence")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    configure_ultralytics()
    from ultralytics import YOLO

    for name, meta in PUBLISHED.items():
        src = WEIGHTS / meta["weights"]
        if not src.exists():
            print(f"  {name}: {src} not found — skipped")
            continue
        run = MODELS / name
        (run / "weights").mkdir(parents=True, exist_ok=True)
        dst = run / "weights" / meta["weights"]
        shutil.copy2(src, dst)
        model = YOLO(str(dst))
        check = person_check(model, args.data, args.conf, args.device)
        metrics = {
            "weights": str(dst),
            "published": meta["published"],
            "site_person_check": check,
            # The monitoring page shows test-set precision/recall for every model.
            "test": {"precision": check["precision"], "recall": check["recall"]},
        }
        write_json(run / "metrics.json", metrics)
        print(f"  {name}: people on site photos — precision {check['precision']:.3f}, recall {check['recall']:.3f}")


if __name__ == "__main__":
    main()
