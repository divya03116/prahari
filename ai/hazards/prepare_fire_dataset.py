"""Fire/smoke dataset — step 1 for the fire-v1 model.

Converts the D-Fire dataset (Parquet shards from the Hugging Face mirror
badsaarow/d-fire; the original is public domain, CC0 1.0) into a YOLO dataset:

    <WORK>/datasets/fire-v1/
        images/{train,val,test}/*.jpg
        labels/{train,val,test}/*.txt   # <class> <xc> <yc> <w> <h>, normalised 0..1
        data.yaml                        # names: 0 fire, 1 smoke
        report.json                      # counts per class and split

D-Fire numbers its classes 0 = smoke, 1 = fire (checked by eye on crops);
PRAHARI's order is 0 = fire, 1 = smoke. Test images come only from the test
shard(s), so the test split is never seen during training or model selection.

Download the shards first (see ai/README.md), then:
    python ai/hazards/prepare_fire_dataset.py
"""

from __future__ import annotations

import argparse
import io
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ppe"))
from common import DATASETS, write_json  # noqa: E402

CLASSES = ["fire", "smoke"]
FROM_DFIRE = {"0": 1, "1": 0}  # D-Fire id -> PRAHARI id
SOURCE = {
    "name": "D-Fire",
    "license": "CC0-1.0 (public domain)",
    "homepage": "https://github.com/gaiasd/DFireDataset",
    "mirror": "https://huggingface.co/datasets/badsaarow/d-fire",
}


def clean_label(text: str | None) -> tuple[list[str], int]:
    """Remapped YOLO lines, and how many lines were invalid and dropped."""
    out, bad = [], 0
    for line in (text or "").splitlines():
        p = line.split()
        if not p:
            continue
        try:
            c, xc, yc, w, h = p[0], *map(float, p[1:5])
        except (ValueError, IndexError):
            bad += 1
            continue
        if len(p) != 5 or c not in FROM_DFIRE or not (0 <= xc <= 1 and 0 <= yc <= 1 and 0 < w <= 1 and 0 < h <= 1):
            bad += 1
            continue
        out.append(f"{FROM_DFIRE[c]} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")
    return out, bad


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DATASETS / "_downloads" / "d-fire")
    ap.add_argument("--name", default="fire-v1")
    ap.add_argument("--val-fraction", type=float, default=0.1)
    ap.add_argument("--max-background", type=int, default=1000, help="images with no fire/smoke kept for training")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    import polars as pl
    from PIL import Image

    out = DATASETS / args.name
    for split in ("train", "val", "test"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    rng = random.Random(args.seed)
    images = Counter()
    boxes = {s: Counter() for s in ("train", "val", "test")}
    dropped = Counter()
    backgrounds = 0

    shards = sorted(args.src.glob("*.parquet"))
    if not shards:
        raise SystemExit(f"No .parquet shards in {args.src}. Download them first (ai/README.md).")
    for shard in shards:
        is_test = shard.name.startswith("test-")
        df = pl.read_parquet(shard)
        for row in df.iter_rows(named=True):
            lines, bad = clean_label(row["label"])
            dropped["invalid_label_lines"] += bad
            if is_test:
                split = "test"
            else:
                if not lines:
                    if backgrounds >= args.max_background:
                        dropped["surplus_background_images"] += 1
                        continue
                    backgrounds += 1
                split = "val" if rng.random() < args.val_fraction else "train"
            try:
                img = Image.open(io.BytesIO(row["image"]["bytes"])).convert("RGB")
            except Exception:  # noqa: BLE001 - count unreadable images, keep going
                dropped["unreadable_images"] += 1
                continue
            stem = Path(row["filename"]).stem
            img.save(out / "images" / split / f"{stem}.jpg", quality=92)
            (out / "labels" / split / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
            images[split] += 1
            for line in lines:
                boxes[split][CLASSES[int(line.split()[0])]] += 1
        print(f"  {shard.name}: done")

    (out / "data.yaml").write_text(
        f"path: {out.as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\n"
        + "names:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(CLASSES)),
        encoding="utf-8",
    )
    report = {
        "name": args.name,
        "source": SOURCE,
        "shards": [s.name for s in shards],
        "classes": CLASSES,
        "images": dict(images),
        "instances": {s: dict(c) for s, c in boxes.items()},
        "background_images_in_train_and_val": backgrounds,
        "dropped": dict(dropped),
    }
    write_json(out / "report.json", report)
    print(f"\n  images {dict(images)}\n  boxes  { {s: dict(c) for s, c in boxes.items()} }\n  dropped {dict(dropped)}")
    print(f"\n  Dataset: {out / 'data.yaml'}")


if __name__ == "__main__":
    main()
