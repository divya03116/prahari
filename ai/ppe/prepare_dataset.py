"""Step 1 — dataset preparation.

Downloads a source dataset (if not already present), validates every label
file, remaps source classes onto PRAHARI's canonical taxonomy (dropping
"no_*" pseudo-classes), and writes a clean YOLO dataset:

    <WORK>/datasets/<name>/
        images/{train,val,test}/*.jpg
        labels/{train,val,test}/*.txt     # YOLO format, see below
        data.yaml                          # consumed by train.py
        report.json                        # counts per class and split

YOLO annotation format — one .txt per image, one line per object:

    <class_index> <x_center> <y_center> <width> <height>

with all four coordinates normalised to 0..1 by image width/height.

Usage:
    python ai/ppe/prepare_dataset.py --source construction-ppe --name ppe-v1
"""

from __future__ import annotations

import argparse
import shutil
import sys
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CLASSES, DATASET_ADAPTERS, DATASET_SOURCES, DATASETS, write_json  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLIT_ALIASES = {"train": "train", "val": "val", "valid": "val", "validation": "val", "test": "test"}


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  using cached {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"  downloading {url}")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:  # noqa: S310 (fixed, trusted URL)
        total = int(r.headers.get("Content-Length", 0))
        done = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done / 1e6:6.1f} / {total / 1e6:.1f} MB", end="", flush=True)
    print()
    tmp.rename(dest)


def find_root(extracted: Path) -> Path:
    """The directory holding the dataset's own data.yaml / images folder."""
    for candidate in [extracted, *sorted(p for p in extracted.rglob("*") if p.is_dir())]:
        if (candidate / "images").is_dir():
            return candidate
    raise SystemExit(f"No images/ folder found under {extracted}")


def source_names(root: Path, override: Path | None) -> list[str]:
    for y in [override, root / "data.yaml", *root.glob("*.yaml"), *root.parent.glob("*.yaml")]:
        if y and y.is_file():
            names = yaml.safe_load(y.read_text(encoding="utf-8")).get("names")
            if isinstance(names, dict):
                return [names[k] for k in sorted(names)]
            if isinstance(names, list):
                return names
    raise SystemExit("Could not find the source class names (pass --names-yaml).")


def parse_label_line(line: str, n_src: int) -> tuple[int, list[float]] | None:
    parts = line.split()
    if len(parts) != 5:
        return None
    try:
        cls = int(float(parts[0]))
        box = [float(v) for v in parts[1:]]
    except ValueError:
        return None
    if not 0 <= cls < n_src:
        return None
    x, y, w, h = box
    if w <= 0 or h <= 0 or not all(0.0 <= v <= 1.0 for v in (x, y)) or w > 1.0 or h > 1.0:
        return None
    return cls, box


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default="construction-ppe", choices=sorted(DATASET_SOURCES))
    ap.add_argument("--name", default="ppe-v1", help="name of the prepared dataset")
    ap.add_argument("--src-dir", type=Path, help="use an already-extracted dataset instead of downloading")
    ap.add_argument("--names-yaml", type=Path, help="source class names, if not found automatically")
    args = ap.parse_args()

    adapter = DATASET_ADAPTERS[args.source]
    info = DATASET_SOURCES[args.source]
    raw = DATASETS / "_raw" / args.source

    print(f"[1/4] Source: {args.source}  ({info['license']}, {info['homepage']})")
    if args.src_dir:
        root = find_root(args.src_dir)
    else:
        archive = DATASETS / "_downloads" / f"{args.source}.zip"
        download(info["url"], archive)
        if not raw.exists():
            print("  extracting…")
            with zipfile.ZipFile(archive) as z:
                z.extractall(raw)
        root = find_root(raw)

    names = source_names(root, args.names_yaml)
    print(f"  source classes ({len(names)}): {names}")
    remap = {i: CLASSES.index(adapter[n]) for i, n in enumerate(names) if n in adapter}
    dropped = [n for n in names if n not in adapter]
    print(f"  kept -> {[CLASSES[v] for v in sorted(set(remap.values()))]}")
    print(f"  dropped (not physical objects, or not used): {dropped}")

    out = DATASETS / args.name
    if out.exists():
        shutil.rmtree(out)

    print("[2/4] Validating and remapping labels")
    counts: dict[str, Counter] = {}
    images_per_split: Counter = Counter()
    bad_lines = 0
    missing_labels = 0
    for split_dir in sorted((root / "images").iterdir()):
        if not split_dir.is_dir() or split_dir.name.lower() not in SPLIT_ALIASES:
            continue
        split = SPLIT_ALIASES[split_dir.name.lower()]
        counts.setdefault(split, Counter())
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
        for img in sorted(split_dir.iterdir()):
            if img.suffix.lower() not in IMAGE_EXT:
                continue
            label = root / "labels" / split_dir.name / (img.stem + ".txt")
            lines_out = []
            if label.is_file():
                for line in label.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    parsed = parse_label_line(line, len(names))
                    if parsed is None:
                        bad_lines += 1
                        continue
                    cls, box = parsed
                    if cls in remap:
                        lines_out.append(f"{remap[cls]} " + " ".join(f"{v:.6f}" for v in box))
                        counts[split][CLASSES[remap[cls]]] += 1
            else:
                missing_labels += 1  # an unlabelled image is a pure background example
            shutil.copy2(img, out / "images" / split / img.name)
            (out / "labels" / split / (img.stem + ".txt")).write_text("\n".join(lines_out) + ("\n" if lines_out else ""), encoding="utf-8")
            images_per_split[split] += 1

    if not images_per_split.get("train") or not images_per_split.get("val"):
        raise SystemExit("The dataset needs at least a train and a val split.")

    print("[3/4] Writing data.yaml")
    data_yaml = {
        "path": str(out).replace("\\", "/"),
        "train": "images/train",
        "val": "images/val",
        **({"test": "images/test"} if images_per_split.get("test") else {}),
        "names": {i: n for i, n in enumerate(CLASSES)},
    }
    (out / "data.yaml").write_text(yaml.safe_dump(data_yaml, sort_keys=False), encoding="utf-8")

    report = {
        "name": args.name,
        "source": args.source,
        "license": info["license"],
        "homepage": info["homepage"],
        "classes": CLASSES,
        "dropped_source_classes": dropped,
        "images": dict(images_per_split),
        "instances": {s: dict(c) for s, c in counts.items()},
        "invalid_label_lines_skipped": bad_lines,
        "images_without_label_file": missing_labels,
    }
    write_json(out / "report.json", report)

    print("[4/4] Summary")
    for split in ("train", "val", "test"):
        if split in images_per_split:
            per = ", ".join(f"{k}={v}" for k, v in sorted(counts[split].items()))
            print(f"  {split:5s} {images_per_split[split]:5d} images   {per}")
    absent = [c for c in CLASSES if not any(counts[s].get(c) for s in counts)]
    if absent:
        print(f"  NOTE: no training examples for {absent}; the model cannot learn these yet.")
    print(f"  invalid label lines skipped: {bad_lines}; images without labels: {missing_labels}")
    print(f"\nDataset ready: {out / 'data.yaml'}")


if __name__ == "__main__":
    main()
