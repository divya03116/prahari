"""Assembles the Hugging Face Space upload for the PRAHARI AI service.

    python ai/space/stage.py [--out E:/prahari-ml/space-build] [--ml E:/prahari-ml]

Copies the Space definition (Dockerfile, requirements, card), the inference
server and every model the server serves, each with its evaluation results
next to the weights — the server refuses weights without metrics. Upload the
result with:

    hf upload <user>/prahari-ai <out> . --repo-type space
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

# (folder inside the Space, run folder under the ML directory, weights file)
MODELS = [
    ("ppe-v1", "runs/ppe-v1", "best.pt"),
    ("fire-v1", "runs/fire-v1", "best.pt"),
    ("general-coco", "models/general-coco", "yolov8n.pt"),
    ("pose-coco", "models/pose-coco", "yolov8n-pose.pt"),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="E:/prahari-ml/space-build")
    parser.add_argument("--ml", default="E:/prahari-ml")
    args = parser.parse_args()
    out, ml = Path(args.out), Path(args.ml)

    if out.exists():
        shutil.rmtree(out)
    (out / "inference_service").mkdir(parents=True)
    for name in ("Dockerfile", "requirements.txt", "README.md"):
        shutil.copy2(HERE / name, out / name)
    shutil.copy2(REPO / "ai" / "inference_service" / "server.py", out / "inference_service" / "server.py")

    total = 0
    for folder, run, weights in MODELS:
        src_weights = ml / run / "weights" / weights
        src_metrics = ml / run / "metrics.json"
        if not src_weights.exists() or not src_metrics.exists():
            raise SystemExit(f"Missing {src_weights if not src_weights.exists() else src_metrics}")
        dst = out / "models" / folder
        (dst / "weights").mkdir(parents=True)
        shutil.copy2(src_weights, dst / "weights" / weights)
        shutil.copy2(src_metrics, dst / "metrics.json")
        size = src_weights.stat().st_size
        total += size
        print(f"  {folder:<14} {weights:<16} {size / 1e6:5.1f} MB  + metrics.json")
    print(f"  staged in {out} ({total / 1e6:.1f} MB of weights)")


if __name__ == "__main__":
    main()
