# PRAHARI safety models

The detectors behind live monitoring and photo reports:

| Role | Model | Sees | How it was made |
|---|---|---|---|
| `ppe` | `ppe-v1` | people and the PPE they wear | trained here (Construction-PPE) |
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
python ai/ppe/train.py --data E:/prahari-ml/datasets/ppe-v1/data.yaml --model yolov8n.pt \
  --epochs 100 --batch 8 --workers 0 --patience 20 --device 0 --skip-amp-check --gpu-memory-gb 1.3
```

Starts from COCO-pretrained YOLOv8n, early-stops after `--patience` epochs
without improvement, and keeps `best.pt` / `last.pt` in
`<work>/runs/ppe-v1/weights/`. Continue an interrupted run with `--resume`.
Bigger GPUs: raise `--batch`, use `yolov8s.pt`, drop `--gpu-memory-gb`.

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
python ai/ppe/evaluate.py --weights E:/prahari-ml/runs/ppe-v1/weights/best.pt
```

Scores the weights on the validation split and on the **held-out test split**
(never used for training or model selection): precision, recall, mAP50 and
mAP50-95, overall and per class, written to `<run>/metrics.json`. The inference
service will not serve weights without it.

### Results — `ppe-v1`

YOLOv8n, 640 px, 100 epochs on an RTX 3050 Laptop GPU (batch 8). Held-out
**test split** (141 images, 1,032 objects), from `metrics.json`:

| Class | Precision | Recall | mAP50 | mAP50-95 |
|---|---:|---:|---:|---:|
| **all** | **0.878** | **0.776** | **0.833** | **0.443** |
| person | 0.857 | 0.812 | 0.844 | 0.493 |
| helmet | 0.942 | 0.896 | 0.941 | 0.510 |
| vest | 0.865 | 0.866 | 0.916 | 0.572 |
| gloves | 0.820 | 0.753 | 0.776 | 0.385 |
| boots | 0.898 | 0.582 | 0.720 | 0.386 |
| goggles | 0.886 | 0.748 | 0.804 | 0.311 |

Boots and goggles are small and often partly hidden, so they are missed more
often (boots recall 0.58) — and to the rule engine a missed item looks like a
missing one. Before requiring them at a camera, validate on your own footage and
keep the confirmation settings strict. CPU inference on an 11th-gen Core i5 takes
~170 ms per frame.

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
set PPE_WEIGHTS=E:/prahari-ml/runs/ppe-v1/weights/best.pt
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
