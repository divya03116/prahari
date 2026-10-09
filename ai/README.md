# PRAHARI safety models

The detectors behind live monitoring and photo reports:

| Role | Model | Sees | How it was made |
|---|---|---|---|
| `ppe` | `ppe-v2` | people and the PPE they wear | trained here (Construction-PPE) |
| `general` | `general-coco` | people, vehicles, phones, everyday objects | COCO-pretrained YOLOv8n, registered with evidence |
| `pose` | `pose-coco` | people with 17 body keypoints | COCO-pretrained YOLOv8n-pose, registered with evidence |
| `fire` | `fire-v1` | fire, smoke | trained here (D-Fire) |

The models only detect; the web app's rules decide what is a violation or a
hazard (`functions/src/shared/ppe.ts`, `hazards.ts`). There is deliberately no
`no_helmet` class — a missing item is not an object.

```
ai/
  ppe/
    common.py            work-folder paths, class taxonomy, dataset adapters
    prepare_dataset.py   1. download, validate, remap → clean YOLO dataset
    train.py             2. fine-tune YOLOv8 (with a Windows memory guard)
    evaluate.py          3. validation + held-out test metrics → metrics.json
    export.py            4. ONNX export + manifest for other runtimes
    make_test_video.py   fake-camera video from test images (end-to-end check)
  hazards/
    prepare_fire_dataset.py   D-Fire (Parquet) → fire-v1 YOLO dataset
    register_pretrained.py    general-coco + pose-coco with published and site metrics
    make_hazard_media.py      fake-camera video + fire photo for the hazard check
  inference_service/
    server.py            HTTP API the web app calls with camera frames
```

Everything heavy — datasets, training runs, weights, exports, the Python
environment — lives in a **work folder outside the repository**: `E:/prahari-ml`
by default, or the folder in `PRAHARI_ML_DIR`.

## Classes

`person, helmet, vest, gloves, boots, goggles` (index order = model class ids).

`harness` is part of the app's PPE vocabulary but is **not** in the current
dataset, so the monitoring page marks it *Not in this model*. To add it (or any
class): append it to `CLASSES` in `common.py`, map it in a dataset adapter,
label images, retrain. The app reads the class list from the inference service,
so no app change is needed.

## Setup (Windows, NVIDIA GPU)

Python 3.10+:

```bash
python -m venv E:/prahari-ml/venv
E:/prahari-ml/venv/Scripts/python -m pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu121
E:/prahari-ml/venv/Scripts/python -m pip install ultralytics onnx onnxslim onnxruntime
```

On a machine without a GPU install the CPU build of PyTorch instead and pass
`--device cpu` to training (much slower).

## 1. Dataset

```bash
python ai/ppe/prepare_dataset.py --source construction-ppe --name ppe-v1
```

Source: Ultralytics **Construction-PPE** (AGPL-3.0). The script downloads it
(once), checks every label line, maps its classes onto the taxonomy above and
**drops** `no_helmet`, `no_gloves`, `no_boots`, `no_goggle` and `none`. Output:

```
<work>/datasets/ppe-v1/
  images/{train,val,test}/…      1132 / 143 / 141 images
  labels/{train,val,test}/*.txt
  data.yaml                      consumed by train.py
  report.json                    images and instances per class and split
```

**Annotation format (YOLO):** one `.txt` per image, one line per object:

```
<class_id> <x_center> <y_center> <width> <height>
```

coordinates normalised to 0–1 by the image width and height. To add your own
site's footage, label it in this format (e.g. with CVAT or Label Studio, exporting
"YOLO 1.1") using the class ids above, add the images/labels to the splits, and
retrain. Keep the test split untouched so metrics stay comparable.

## 2. Training

```bash
python ai/ppe/balance.py --boost boots=2 goggles=2          # optional: a rebalanced training list
python ai/ppe/train.py --name ppe-v2 --data E:/prahari-ml/datasets/ppe-v1/data-balanced.yaml --model yolo26n.pt \
  --epochs 80 --batch 8 --workers 0 --patience 20 --device 0 --skip-amp-check --gpu-memory-gb 1.3
```

Starts from a COCO-pretrained nano model (`yolo26n.pt` for `ppe-v2`; `yolov8n.pt`
was `ppe-v1`), early-stops after `--patience` epochs without improvement, and
keeps `best.pt` / `last.pt` in `<work>/runs/<name>/weights/`. Continue an
interrupted run with `--resume`. Any other Ultralytics training setting can be
passed with `--set KEY=VALUE …` (e.g. `--set lr0=0.003 cos_lr=True`). Bigger
GPUs: raise `--batch`, use a larger model, drop `--gpu-memory-gb`.

`balance.py` writes `train-balanced.txt` and `data-balanced.yaml`, in which images
containing the named classes appear more than once (1,724 instead of 1,132
images per epoch for `boots=2 goggles=2`). It is for a class the model finds
precisely but too seldom. The validation and test splits are untouched, so
results stay comparable.

**Small Windows laptops.** On Windows every GPU allocation is also charged to
the system *commit* (RAM + page file), and a system-managed page file grows onto
the C: drive. Training therefore carries a **memory guard** that stops it
(checkpoints are kept; `--resume` continues) before C: fills up or other programs
run out of memory, and `--gpu-memory-gb` caps PyTorch's GPU memory pool so the
run fits. If training keeps stopping, close memory-heavy programs or move the
page file to a drive with free space (System Properties → Advanced → Performance
→ Settings → Advanced → Virtual memory).

## 3. Evaluation

```bash
python ai/ppe/evaluate.py --weights E:/prahari-ml/runs/ppe-v2/weights/best.pt
```

Scores the weights on the validation split and on the **held-out test split**
(never used for training or model selection): precision, recall, mAP50 and
mAP50-95, overall and per class, written to `<run>/metrics.json`. The inference
service will not serve weights without it. It runs in batches of 4 with no
loader processes by default (`--batch`, `--workers`), which fits beside other
programs on a 4 GB GPU; all numbers below were measured that way.

### Results — `ppe-v2` (served by default)

YOLO26n, 640 px, 80 epochs on the rebalanced list (boots and goggles ×2), RTX 3050
Laptop GPU, batch 8. Held-out **test split** (141 images, 1,032 objects), from
`metrics.json`:

| Class | Precision | Recall | mAP50 | mAP50-95 |
|---|---:|---:|---:|---:|
| **all** | **0.862** | **0.774** | **0.823** | **0.434** |
| person | 0.828 | 0.784 | 0.815 | 0.481 |
| helmet | 0.937 | 0.891 | 0.931 | 0.511 |
| vest | 0.899 | 0.853 | 0.899 | 0.573 |
| gloves | 0.840 | 0.709 | 0.746 | 0.340 |
| boots | 0.769 | 0.720 | 0.770 | 0.385 |
| goggles | 0.900 | 0.690 | 0.777 | 0.315 |

### What changed from `ppe-v1`, and what did not

`ppe-v2` was made to find more boots. On the same test split and settings:

| Model | all mAP50 | all mAP50-95 | boots precision | boots recall | boots mAP50 |
|---|---:|---:|---:|---:|---:|
| `ppe-v1` — YOLOv8n, 100 epochs | 0.831 | 0.441 | 0.891 | 0.580 | 0.716 |
| `ppe-v1` fine-tuned at 800 px on the rebalanced list, run at 640 px | 0.829 | 0.434 | 0.768 | 0.649 | 0.708 |
| the same, run at 800 px | 0.833 | 0.438 | 0.787 | 0.666 | 0.736 |
| **`ppe-v2`** — YOLO26n on the rebalanced list | 0.823 | 0.434 | 0.769 | **0.720** | **0.770** |

- **Boots: better.** `ppe-v2` finds 72% of the boots in the test photos instead
  of 58%, and its boots mAP50 is 5 points higher. It is also less sure of itself:
  boots precision fell from 0.89 to 0.77, so it calls more things boots that are
  not.
- **Everything else: about the same, slightly lower.** Helmet and vest — the two
  items required by default — moved by one to two points of mAP50 (0.940 → 0.931,
  0.916 → 0.899); gloves and goggles by about three (0.776 → 0.746, 0.804 →
  0.777); overall mAP50 by 0.8 of a point. With 141 test images, differences of
  this size are within what a different sample of photos would produce; the boots
  gain is the only change clearly larger than that.
- **Not a fix for boots.** More than a quarter of visible boots are still missed,
  and to the rule engine a missed item looks like a missing one. Boots and
  goggles are small and often partly hidden. Before requiring them at a camera,
  validate on your own footage and keep the confirmation settings strict. The
  real improvement will come from labelled footage of your own sites, not from
  another architecture.
- Running at a higher resolution alone does not help: `ppe-v1` at 800 px finds
  no more boots than at 640 px (recall 0.578) and loses accuracy elsewhere.

`ppe-v1` stays usable: point `PPE_WEIGHTS` at
`<work>/runs/ppe-v1/weights/best.pt` to serve it instead. Its `metrics.json` was
written with batches of 16 and reads 0.833 mAP50; the 0.831 above is the same
weights at the batch size used for every row of this comparison. The ONNX export
(section 5) has been made and checked for `ppe-v1` only.

CPU inference on an 11th-gen Core i5 takes ~170 ms per frame for `ppe-v1`; it was
not re-measured on CPU for `ppe-v2` (10 ms against 9.5 ms on the laptop GPU).

## Hazard models

### general-coco and pose-coco (pretrained)

Not trained here. Download the pose weights once (the COCO detector `yolov8n.pt`
is already in `<work>/weights` from PPE training), then register both:

```bash
curl -L -o E:/prahari-ml/weights/yolov8n-pose.pt https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8n-pose.pt
python ai/hazards/register_pretrained.py
```

Each gets `<work>/models/<name>/metrics.json` with the accuracy Ultralytics
publishes for it and our own check of what every hazard rule depends on —
finding people — on the held-out PPE test photos (confidence 0.5, IoU 0.5):

| Model | Published (COCO val2017) | People on site test photos |
|---|---|---|
| general-coco (YOLOv8n) | box mAP50-95 0.373 | precision 0.815, recall 0.767 |
| pose-coco (YOLOv8n-pose) | pose mAP50-95 0.504, mAP50 0.801 | precision 0.824, recall 0.775 |

### fire-v1 (trained)

Data: **D-Fire** (public domain, CC0 1.0; 21,527 images, YOLO labels) from the
Hugging Face mirror `badsaarow/d-fire`. Four Parquet shards are enough (≈0.57 GB):

```bash
for f in train-00004-of-00009 train-00006-of-00009 train-00008-of-00009 test-00002-of-00003; do
  curl -L -o E:/prahari-ml/datasets/_downloads/d-fire/$f.parquet \
    https://huggingface.co/datasets/badsaarow/d-fire/resolve/main/data/$f.parquet
done
python ai/hazards/prepare_fire_dataset.py
python ai/ppe/train.py --data E:/prahari-ml/datasets/fire-v1/data.yaml --name fire-v1 --epochs 35 --patience 10 \
  --batch 8 --workers 0 --device 0 --skip-amp-check --gpu-memory-gb 1.3
python ai/ppe/evaluate.py --weights E:/prahari-ml/runs/fire-v1/weights/best.pt --data E:/prahari-ml/datasets/fire-v1/data.yaml
```

D-Fire numbers smoke 0 and fire 1; PRAHARI uses fire 0, smoke 1 (checked by eye
on crops). Split: 4379 training / 503 validation images from the train
shards (up to 1,000 of them with no fire or smoke, to learn what is *not* fire),
and 1435 test images from the test shard, never used for training or model
selection. YOLOv8n, 640 px, 35 epochs on the RTX 3050 Laptop GPU. Held-out test:

| Class | Precision | Recall | mAP50 | mAP50-95 |
|---|---:|---:|---:|---:|
| **all** | **0.678** | **0.633** | **0.675** | **0.376** |
| fire | 0.605 | 0.553 | 0.591 | 0.290 |
| smoke | 0.751 | 0.712 | 0.760 | 0.463 |

Flames are the harder class here: many test fires are small or partly hidden, so
recall for fire is lower than for smoke. D-Fire is mostly outdoor and web
imagery — check it on your own cameras before relying on it indoors.

## 4. Export

```bash
python ai/ppe/export.py --weights E:/prahari-ml/runs/ppe-v1/weights/best.pt
```

Writes `<work>/exports/ppe-v1.onnx` (input `[1,3,640,640]` RGB 0–1 letterboxed;
output `[1,4+classes,N]`, no NMS) and `manifest.json` (classes, input, metrics,
dataset, provenance) for edge devices or other runtimes. The inference service
can serve the `.onnx` file too.

## Inference service

```bash
set PPE_WEIGHTS=E:/prahari-ml/runs/ppe-v2/weights/best.pt
python ai/inference_service/server.py
```

| Endpoint | Returns |
|---|---|
| `GET /v1/health` | `{"ok": true}` |
| `GET /v1/model` | classes, device, metrics — or `503 {"configured": false, "reason": …}` |
| `POST /v1/detect` | body: JPEG/PNG (≤ 8 MB) → `{width, height, inferenceMs, detections: [{label, confidence, box}]}` |

It returns raw detections only (confidence ≥ 0.25); the app applies its own
threshold, tracking and confirmation. Point the web app at it with
`VITE_PPE_INFERENCE_URL`. It can run beside the app, on a GPU server, a cloud VM
or an edge box — see the variables in the main README (§12). For anything other
than localhost, put it behind HTTPS and set `PPE_TOKEN`.

## End-to-end check with the trained model

```bash
python ai/ppe/make_test_video.py
PPE_FAKE_CAMERA=E:/prahari-ml/verify/ppe-test.mjpeg npx playwright test monitoring-model
```

Chrome's fake camera plays held-out test photos (compliant workers, a worker
without a helmet, then the same violation again) into the live monitoring page
while the inference service runs. The test passes only if the real model and
rule engine produce exactly one automatic incident with its evidence frame.

## End-to-end hazard check

```bash
python ai/hazards/make_hazard_media.py
PPE_HAZARD_CAMERA=E:/prahari-ml/verify/hazard-test.mjpeg PPE_FIRE_PHOTO=E:/prahari-ml/verify/fire-photo.jpg \
  npx playwright test hazards-model
```

The fake camera shows a worker then a smoky fire scene (held-out test images);
with a restricted zone over the view and the fire and smoke rules on, the camera
must file an unsafe act and an unsafe condition by itself. The fire-scene photo
must be checked,
filled in and sent automatically, and Cancel must stop the send.

## Licensing

The Construction-PPE dataset and Ultralytics YOLO are **AGPL-3.0**; D-Fire is
public domain (CC0 1.0). Weights trained with them, and
a service that offers them over a network, fall under its terms; review this
before commercial deployment (Ultralytics also sells an enterprise licence).
