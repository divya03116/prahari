"""Shared paths, class taxonomy and helpers for the PPE model pipeline.

Heavy artefacts (datasets, training runs, weights, exports) live OUTSIDE the
app repository, in a work directory (default E:/prahari-ml, override with the
PRAHARI_ML_DIR environment variable). The repository only holds code.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORK = Path(os.environ.get("PRAHARI_ML_DIR", "E:/prahari-ml"))
DATASETS = WORK / "datasets"
RUNS = WORK / "runs"
WEIGHTS = WORK / "weights"
EXPORTS = WORK / "exports"

# ---------------------------------------------------------------------------
# Canonical taxonomy. The app reasons about these names, never about a
# particular dataset's labels. Order = class index in the trained model.
#
# There is deliberately NO "no_helmet"/"no_vest" class: a missing item is not
# an object. The app decides "missing" from the relationship between a
# detected person and the PPE required for that area.
#
# To add a class later (e.g. harness): append it here, map it in the dataset
# adapter below, label images, retrain. The app picks it up from the manifest.
# ---------------------------------------------------------------------------
CLASSES: list[str] = ["person", "helmet", "vest", "gloves", "boots", "goggles"]

# Source dataset label -> canonical label. Anything not listed is dropped.
DATASET_ADAPTERS: dict[str, dict[str, str]] = {
    # Ultralytics Construction-PPE (AGPL-3.0), 11 classes.
    "construction-ppe": {
        "Person": "person",
        "helmet": "helmet",
        "vest": "vest",
        "gloves": "gloves",
        "boots": "boots",
        "goggles": "goggles",
        # dropped on purpose: no_helmet, no_gloves, no_boots, no_goggle, none
    },
}

DATASET_SOURCES = {
    "construction-ppe": {
        "url": "https://github.com/ultralytics/assets/releases/download/v0.0.0/construction-ppe.zip",
        "license": "AGPL-3.0",
        "homepage": "https://docs.ultralytics.com/datasets/detect/construction-ppe",
    },
}


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def configure_ultralytics() -> None:
    """Keep Ultralytics' files on the work drive and turn off its analytics."""
    from ultralytics import settings

    settings.update(
        {
            "datasets_dir": str(DATASETS),
            "weights_dir": str(WEIGHTS),
            "runs_dir": str(RUNS),
            "sync": False,  # no usage telemetry
        }
    )
