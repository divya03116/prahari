"""Step 2 — training.

Fine-tunes a YOLOv8 detector (COCO-pretrained) on the prepared PPE dataset.
Defaults suit a 4 GB laptop GPU; raise --batch / --model on bigger hardware.

Usage:
    python ai/ppe/train.py --data E:/prahari-ml/datasets/ppe-v1/data.yaml
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATASETS, RUNS, WEIGHTS, configure_ultralytics  # noqa: E402


def _commit_status() -> tuple[float, float]:
    """(commit charge, commit limit) in GB — Windows' RAM + page-file budget."""
    import ctypes
    from ctypes import wintypes

    class PerfInfo(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("CommitTotal", ctypes.c_size_t),
            ("CommitLimit", ctypes.c_size_t),
            ("CommitPeak", ctypes.c_size_t),
            ("PhysicalTotal", ctypes.c_size_t),
            ("PhysicalAvailable", ctypes.c_size_t),
            ("SystemCache", ctypes.c_size_t),
            ("KernelTotal", ctypes.c_size_t),
            ("KernelPaged", ctypes.c_size_t),
            ("KernelNonpaged", ctypes.c_size_t),
            ("PageSize", ctypes.c_size_t),
            ("HandleCount", wintypes.DWORD),
            ("ProcessCount", wintypes.DWORD),
            ("ThreadCount", wintypes.DWORD),
        ]

    info = PerfInfo()
    info.cb = ctypes.sizeof(PerfInfo)
    ctypes.windll.psapi.GetPerformanceInfo(ctypes.byref(info), info.cb)
    page = info.PageSize
    return info.CommitTotal * page / 2**30, info.CommitLimit * page / 2**30


def start_memory_guard(min_free_commit_gb: float, min_system_disk_gb: float) -> None:
    """Stops training before Windows runs out of memory for other programs.

    On a small laptop the page file grows onto the system drive; if that fills,
    every application's allocations start failing. This watchdog ends training
    first (checkpoints are saved each epoch; continue with --resume).
    """
    import os
    import shutil
    import threading
    import time

    if os.name != "nt":
        return
    drive = os.environ.get("SystemDrive", "C:") + "\\"

    def watch() -> None:
        while True:
            used, limit = _commit_status()
            free_disk = shutil.disk_usage(drive).free / 2**30
            # A system-managed page file can still grow into the system drive's
            # free space — but never past the reserve kept for everything else.
            headroom = (limit - used) + max(0.0, free_disk - min_system_disk_gb)
            if headroom < min_free_commit_gb or free_disk < min_system_disk_gb:
                print(
                    f"\n[memory guard] stopping training: commit {used:.1f}/{limit:.1f} GB, "
                    f"{drive} free {free_disk:.1f} GB. Resume later with --resume.",
                    flush=True,
                )
                os._exit(3)
            time.sleep(1)

    threading.Thread(target=watch, daemon=True).start()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=DATASETS / "ppe-v1" / "data.yaml")
    ap.add_argument("--model", default="yolov8n.pt", help="starting weights: yolov8n.pt, yolov8s.pt, …")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--workers", type=int, default=2, help="data-loader processes (keep low on 8 GB RAM)")
    ap.add_argument("--patience", type=int, default=25, help="early-stop after N epochs without improvement")
    ap.add_argument("--device", default="0", help="'0' for the first GPU, 'cpu' for CPU")
    ap.add_argument("--name", default="ppe-v1")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--resume", action="store_true", help="continue the run from its last saved epoch")
    ap.add_argument("--guard-commit-gb", type=float, default=1.5, help="stop if less commit headroom than this")
    ap.add_argument("--guard-disk-gb", type=float, default=2.0, help="stop if the system drive has less free space")
    ap.add_argument(
        "--skip-amp-check",
        action="store_true",
        help="keep mixed precision but skip Ultralytics' AMP self-test, which loads a second model and "
        "briefly commits several GB on Windows (use only on a GPU known to support AMP, e.g. RTX 20/30/40)",
    )
    ap.add_argument(
        "--gpu-memory-gb",
        type=float,
        default=None,
        help="cap PyTorch's GPU memory pool. On Windows every GPU allocation is also charged to the system "
        "commit (RAM + page file), so on a small laptop this keeps training inside the memory budget",
    )
    ap.add_argument(
        "--set",
        nargs="*",
        default=[],
        metavar="KEY=VALUE",
        help="extra Ultralytics training settings, e.g. --set lr0=0.003 cos_lr=True close_mosaic=15 "
        "(fine-tuning from an earlier run: --model <run>/weights/best.pt with a lower lr0)",
    )
    args = ap.parse_args()

    import ast

    extra: dict[str, object] = {}
    for item in args.set:
        key, sep, value = item.partition("=")
        if not sep or not key:
            raise SystemExit(f"--set {item}: use KEY=VALUE")
        try:
            extra[key] = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            extra[key] = value  # a plain word, e.g. optimizer=AdamW

    start_memory_guard(args.guard_commit_gb, args.guard_disk_gb)
    configure_ultralytics()
    from ultralytics import YOLO

    if args.skip_amp_check:
        import ultralytics.engine.trainer as trainer_module

        trainer_module.check_amp = lambda *_a, **_k: True

    # cuDNN auto-tuning tries algorithms with large temporary workspaces; on a
    # 4 GB laptop GPU that spills into system memory. A fixed choice is leaner.
    import torch

    torch.backends.cudnn.benchmark = False
    if args.gpu_memory_gb and args.device.split(",")[0].isdigit():
        gpu = int(args.device.split(",")[0])
        total = torch.cuda.get_device_properties(gpu).total_memory / 2**30
        torch.cuda.set_per_process_memory_fraction(min(1.0, args.gpu_memory_gb / total), gpu)

    if args.resume:
        last = RUNS / args.name / "weights" / "last.pt"
        if not last.exists():
            raise SystemExit(f"Nothing to resume: {last} does not exist.")
        # A finished run's checkpoint has no optimizer state. Ultralytics would
        # then silently start a NEW training on its demo dataset — refuse instead.
        ckpt = torch.load(last, map_location="cpu", weights_only=False)
        if ckpt.get("optimizer") is None or ckpt.get("epoch", -1) < 0:
            raise SystemExit(f"Nothing to resume: {last} is from a finished run.")
        del ckpt
        YOLO(str(last)).train(resume=True)
        print(f"\nBest weights: {RUNS / args.name / 'weights' / 'best.pt'}")
        return

    WEIGHTS.mkdir(parents=True, exist_ok=True)
    start = WEIGHTS / args.model
    if not start.exists():  # fetch the pretrained weights into the work folder, not the current directory
        from ultralytics.utils.downloads import attempt_download_asset

        attempt_download_asset(str(start))
    model = YOLO(str(start))

    model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        workers=args.workers,
        patience=args.patience,
        device=args.device,
        project=str(RUNS),
        name=args.name,
        exist_ok=True,
        seed=args.seed,
        deterministic=False,  # deterministic CUDA kernels cost extra memory
        cache=False,  # 8 GB RAM: read images from disk
        plots=False,  # plots are memory-hungry; metrics are recorded by evaluate.py
        **extra,
    )
    best = RUNS / args.name / "weights" / "best.pt"
    print(f"\nBest weights: {best}")
    print("Next: python ai/ppe/evaluate.py && python ai/ppe/export.py")


if __name__ == "__main__":
    main()
