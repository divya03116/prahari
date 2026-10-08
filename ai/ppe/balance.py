"""Optional step between preparing and training — a rebalanced training list.

A detector that is precise but timid on a class (high precision, low recall)
sees that class too seldom relative to the others, or sees it mostly as a small
part of busy images. This writes a training list in which images containing
the chosen classes appear more than once, and a data file that points at it.
Validation and test splits are untouched, so results stay comparable.

Usage:
    python ai/ppe/balance.py --boost boots=2 goggles=2
    python ai/ppe/train.py --data E:/prahari-ml/datasets/ppe-v1/data-balanced.yaml ...
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CLASSES, DATASETS  # noqa: E402

IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, default=DATASETS / "ppe-v1")
    ap.add_argument("--boost", nargs="+", default=["boots=2", "goggles=2"], metavar="CLASS=N",
                    help="show images containing CLASS N times per epoch (the largest N of its classes wins)")
    args = ap.parse_args()

    boost: dict[int, int] = {}
    for item in args.boost:
        name, _, times = item.partition("=")
        if name not in CLASSES or not times.isdigit() or int(times) < 1:
            raise SystemExit(f"--boost {item}: use one of {CLASSES} and a whole number, e.g. boots=2")
        boost[CLASSES.index(name)] = int(times)

    images = sorted(p for p in (args.dataset / "images" / "train").iterdir() if p.suffix.lower() in IMAGE_TYPES)
    if not images:
        raise SystemExit(f"No training images in {args.dataset / 'images' / 'train'}")

    lines: list[str] = []
    before: Counter[int] = Counter()
    after: Counter[int] = Counter()
    for image in images:
        label = args.dataset / "labels" / "train" / f"{image.stem}.txt"
        classes = [int(row.split()[0]) for row in label.read_text().splitlines() if row.strip()] if label.exists() else []
        times = max((boost.get(c, 1) for c in set(classes)), default=1)
        lines += [image.as_posix()] * times
        for c in classes:
            before[c] += 1
            after[c] += times

    train_list = args.dataset / "train-balanced.txt"
    train_list.write_text("\n".join(lines) + "\n", encoding="utf-8")
    data = args.dataset / "data-balanced.yaml"
    names = "\n".join(f"  {i}: {n}" for i, n in enumerate(CLASSES))
    data.write_text(
        f"path: {args.dataset.as_posix()}\ntrain: {train_list.name}\nval: images/val\ntest: images/test\nnames:\n{names}\n",
        encoding="utf-8",
    )

    print(f"{len(images)} images -> {len(lines)} per epoch")
    for i, name in enumerate(CLASSES):
        share = lambda c: 100 * c[i] / max(1, sum(c.values()))  # noqa: E731
        print(f"  {name:8} {before[i]:5} -> {after[i]:5} instances  ({share(before):4.1f}% -> {share(after):4.1f}% of all)")
    print(f"Wrote {train_list} and {data}")


if __name__ == "__main__":
    main()
