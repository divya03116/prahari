"""Verification helper — a fake-camera video made from held-out TEST images.

Chrome can play an MJPEG file as its camera (--use-file-for-fake-video-capture),
which lets e2e/monitoring-model.spec.ts drive live monitoring end to end with
real photos: compliant workers, then a worker without a helmet, then the same
violation again (to exercise the incident cooldown). Nothing here is used for
training or evaluation.

Usage:
    python ai/ppe/make_test_video.py
    # then, with the inference service running:
    PPE_FAKE_CAMERA=E:/prahari-ml/verify/ppe-test.mjpeg npx playwright test monitoring-model
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATASETS, WORK  # noqa: E402

# Chosen by hand from the Construction-PPE test split: on-site workers only (the
# source's "no_helmet" photos are mostly snapshots of identifiable people, not
# suitable as incident evidence). image708: worker in coveralls, gloves and a
# vest, no helmet. image550 / image168: helmet and vest worn.
SEQUENCE = ["image550", "image708", "image168", "image708"]


def frame(src: Path, width: int, height: int) -> bytes:
    im = Image.open(src).convert("RGB")
    r = min(width / im.width, height / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)))
    canvas = Image.new("RGB", (width, height), (0, 0, 0))
    canvas.paste(im, ((width - im.width) // 2, (height - im.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", type=Path, default=DATASETS / "_raw" / "construction-ppe" / "images" / "test")
    ap.add_argument("--out", type=Path, default=WORK / "verify" / "ppe-test.mjpeg")
    ap.add_argument("--seconds", type=int, default=6, help="how long each photo stays on screen")
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "wb") as f:
        for stem in SEQUENCE:
            src = next(args.images.glob(stem + ".*"))
            jpg = frame(src, 960, 540)
            for _ in range(args.fps * args.seconds):
                f.write(jpg)
    args.out.with_suffix(".json").write_text(json.dumps({"sequence": SEQUENCE, "secondsEach": args.seconds}, indent=2))
    print(f"Wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
