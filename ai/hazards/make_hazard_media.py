"""Verification helper — test media for the hazard checks, from held-out TEST images.

    <WORK>/verify/hazard-test.mjpeg   fake camera: a worker (6 s), then a fire scene (6 s)
    <WORK>/verify/fire-photo.jpg      a fire photo for the worker photo-report test

The worker comes from the PPE test split, the fire from the fire-v1 test split
(the image whose labelled fire box is largest, chosen from the labels alone —
no model is involved in the choice). Nothing here is used for training or
evaluation. Used by e2e/hazards-model.spec.ts:

    python ai/hazards/make_hazard_media.py
    PPE_HAZARD_CAMERA=E:/prahari-ml/verify/hazard-test.mjpeg PPE_FIRE_PHOTO=E:/prahari-ml/verify/fire-photo.jpg \\
        npx playwright test hazards-model
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ppe"))
from common import DATASETS, WORK  # noqa: E402
from make_test_video import frame  # noqa: E402


def largest_fire(data: Path) -> Path:
    best, best_area = None, 0.0
    for label in sorted((data / "labels" / "test").glob("*.txt")):
        for line in label.read_text(encoding="utf-8").splitlines():
            p = line.split()
            if len(p) == 5 and p[0] == "0":  # fire-v1: 0 = fire
                area = float(p[3]) * float(p[4])
                if area > best_area:
                    best, best_area = label, area
    if best is None:
        raise SystemExit(f"No fire labels in {data}/labels/test. Prepare the fire dataset first.")
    return next((data / "images" / "test").glob(best.stem + ".*"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", type=Path, default=DATASETS / "_raw" / "construction-ppe" / "images" / "test" / "image550.jpg")
    ap.add_argument("--fire-data", type=Path, default=DATASETS / "fire-v1")
    ap.add_argument("--out", type=Path, default=WORK / "verify")
    ap.add_argument("--seconds", type=int, default=6)
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()

    fire = largest_fire(args.fire_data)
    args.out.mkdir(parents=True, exist_ok=True)
    video = args.out / "hazard-test.mjpeg"
    with open(video, "wb") as f:
        for src in (args.worker, fire):
            jpg = frame(src, 960, 540)
            for _ in range(args.fps * args.seconds):
                f.write(jpg)
    shutil.copy2(fire, args.out / "fire-photo.jpg")
    print(f"Wrote {video} ({video.stat().st_size / 1e6:.1f} MB): {args.worker.name}, then {fire.name}")
    print(f"Wrote {args.out / 'fire-photo.jpg'} (from {fire.name})")


if __name__ == "__main__":
    main()
