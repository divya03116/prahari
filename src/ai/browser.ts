/**
 * The site's YOLO models, run in this browser.
 *
 * These are the same networks the inference service serves, exported to ONNX
 * by ai/web/export_web.py into public/models/ together with a manifest (role,
 * classes, input size, measured test metrics). onnxruntime-web runs them on the
 * device's graphics chip through WebGPU where it has one, and on its processor
 * through WebAssembly otherwise. Frames never leave the device, and no server,
 * account or laptop is involved. A model that cannot load says so; nothing is
 * ever made up in its place.
 */

import type * as Ort from 'onnxruntime-web';

import { translate } from '@/i18n';
import type { HazardDetection } from '@/shared/hazards';
import { decodeYolov8, letterbox, nms, type Box, type Detection, type Letterbox } from '@/shared/ppe';

import type { FrameResult, LoadedModel, ModelMetrics, ModelRole, ModelStatus } from './inference';

/** One entry of public/models/manifest.json. */
interface WebModel {
  role: ModelRole;
  name: string;
  architecture: string;
  file: string;
  bytes: number;
  imgsz: number;
  /** 'yolov8': raw head [1, 4 + C (+ keypoints), N] · 'end2end': [1, N, 6] boxes already chosen by the network. */
  layout: 'yolov8' | 'end2end';
  classes: string[];
  keypoints: boolean;
  metrics: ModelMetrics | null;
}

export type WebBackend = 'webgpu' | 'wasm';

/** The thresholds the inference service runs with (Ultralytics' defaults); the rules apply their own on top. */
const MIN_CONFIDENCE = 0.25;
const IOU = 0.7;

let manifestP: Promise<WebModel[]> | null = null;
function webModels(): Promise<WebModel[]> {
  manifestP ??= fetch('/models/manifest.json', { cache: 'no-cache' }).then(async (res) => {
    if (!res.ok) throw new Error(`models/manifest.json answered ${res.status}`);
    return ((await res.json()) as { models: WebModel[] }).models;
  });
  manifestP.catch(() => (manifestP = null)); // try again next time
  return manifestP;
}

let backendP: Promise<WebBackend> | null = null;
/** WebGPU when this device has a usable graphics adapter, WebAssembly otherwise. */
export function webBackend(): Promise<WebBackend> {
  backendP ??= (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (gpu && (await gpu.requestAdapter())) return 'webgpu';
    } catch {
      /* no WebGPU */
    }
    return 'wasm';
  })();
  return backendP;
}

let ortP: Promise<typeof Ort> | null = null;
/** The runtime, loaded on first use: only the build this device can use is downloaded. */
function runtime(): Promise<typeof Ort> {
  ortP ??= (async () => {
    const ort = (await webBackend()) === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
    // Threads need a cross-origin-isolated page, which this site is not (sign-in pop-ups need it not to be).
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    return ort;
  })();
  ortP.catch(() => (ortP = null));
  return ortP;
}

/**
 * One thing on the device at a time: WebGPU refuses to create two sessions at
 * once, and two callers running models together would only slow each other.
 */
let gate: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = gate.then(work);
  gate = next.catch(() => undefined);
  return next;
}

const sessions = new Map<ModelRole, Promise<Ort.InferenceSession>>();
function session(m: WebModel): Promise<Ort.InferenceSession> {
  let s = sessions.get(m.role);
  if (!s) {
    s = inTurn(async () => {
      const [ort, backend] = await Promise.all([runtime(), webBackend()]);
      // The size in the address: a re-exported model is a new file to every cache on the way.
      const res = await fetch(`/models/${m.file}?v=${m.bytes}`);
      if (!res.ok) throw new Error(`${m.file} answered ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return ort.InferenceSession.create(bytes, {
        executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
        graphOptimizationLevel: 'all',
      });
    });
    s.catch(() => sessions.delete(m.role));
    sessions.set(m.role, s);
  }
  return s;
}

/** Downloads (first time only) and starts the models for these roles. */
export async function preloadModels(roles: ModelRole[]): Promise<void> {
  const models = (await webModels()).filter((m) => roles.includes(m.role));
  await Promise.all(models.map(session));
}

export async function browserStatus(): Promise<ModelStatus> {
  try {
    const [models, backend] = await Promise.all([webModels(), webBackend()]);
    const loaded: LoadedModel[] = models.map((m) => ({
      role: m.role,
      name: m.name,
      architecture: m.architecture,
      weights: m.file,
      classes: m.classes,
      keypoints: m.keypoints,
      device: backend === 'webgpu' ? 'gpu' : 'cpu',
      backend,
      metrics: m.metrics,
    }));
    return { state: 'ready', info: { configured: true, models: loaded, missing: [] } };
  } catch (err) {
    return { state: 'unreachable', reason: translate('ai.browserFailed', { error: (err as Error)?.message ?? String(err) }) };
  }
}

/* ---------------- one frame ---------------- */

let surface: { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null = null;

/** The frame letterboxed into the square model input (grey 114 padding, as in training), as RGB 0..1, channels first. */
function input(source: CanvasImageSource, width: number, height: number, size: number): { data: Float32Array; lb: Letterbox } {
  if (!surface || surface.canvas.width !== size) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('This browser cannot prepare frames for the model.');
    surface = { canvas, ctx };
  }
  const { ctx } = surface;
  const lb = letterbox(width, height, size);
  ctx.fillStyle = 'rgb(114, 114, 114)';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(source, lb.padX, lb.padY, width * lb.scale, height * lb.scale);
  const px = ctx.getImageData(0, 0, size, size).data;
  const plane = size * size;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = px[i * 4] / 255;
    data[plane + i] = px[i * 4 + 1] / 255;
    data[2 * plane + i] = px[i * 4 + 2] / 255;
  }
  return { data, lb };
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

function toFrame(lb: Letterbox, x: number, y: number): [number, number] {
  return [Math.min(lb.srcWidth, Math.max(0, (x - lb.padX) / lb.scale)), Math.min(lb.srcHeight, Math.max(0, (y - lb.padY) / lb.scale))];
}

/** A pose head: [1, 4 + C + K*3, N] — box, class scores, then x, y, confidence per keypoint. */
function decodePose(data: Float32Array, dims: readonly number[], classes: string[], lb: Letterbox): HazardDetection[] {
  const [, rows, n] = dims;
  const nc = classes.length;
  const k = (rows - 4 - nc) / 3;
  const found: (Detection & { keypoints: [number, number, number][] })[] = [];
  for (let i = 0; i < n; i++) {
    let best = -1;
    let score = 0;
    for (let c = 0; c < nc; c++) {
      const s = data[(4 + c) * n + i];
      if (s > score) {
        score = s;
        best = c;
      }
    }
    if (best < 0 || score < MIN_CONFIDENCE) continue;
    const [cx, cy, w, h] = [data[i], data[n + i], data[2 * n + i], data[3 * n + i]];
    const [x1, y1] = toFrame(lb, cx - w / 2, cy - h / 2);
    const [x2, y2] = toFrame(lb, cx + w / 2, cy + h / 2);
    if (x2 <= x1 || y2 <= y1) continue;
    const keypoints: [number, number, number][] = [];
    for (let j = 0; j < k; j++) {
      const base = (4 + nc + j * 3) * n + i;
      const [x, y] = toFrame(lb, data[base], data[base + n]);
      keypoints.push([round(x, 1), round(y, 1), round(data[base + 2 * n], 3)]);
    }
    found.push({ label: classes[best], confidence: score, box: { x1, y1, x2, y2 }, keypoints });
  }
  // nms keeps the objects it is given, keypoints and all.
  return nms(found, IOU) as HazardDetection[];
}

/** Boxes the network has already chosen: [1, N, 6] = x1, y1, x2, y2, score, class (model-input pixels). */
function decodeEnd2end(data: Float32Array, dims: readonly number[], classes: string[], lb: Letterbox): Detection[] {
  const out: Detection[] = [];
  for (let i = 0; i < dims[1]; i++) {
    const [ax, ay, bx, by, score, cls] = data.subarray(i * 6, i * 6 + 6);
    if (score < MIN_CONFIDENCE || !classes[cls]) continue;
    const [x1, y1] = toFrame(lb, ax, ay);
    const [x2, y2] = toFrame(lb, bx, by);
    const box: Box = { x1, y1, x2, y2 };
    if (x2 > x1 && y2 > y1) out.push({ label: classes[cls], confidence: score, box });
  }
  return out;
}

/**
 * Runs the chosen models (all of them when none are named) on one frame, one
 * after another on the same prepared input. Detections are in frame pixels,
 * each tagged with the model that made it — the shape the service returns.
 */
export async function detectInBrowser(
  source: CanvasImageSource,
  width: number,
  height: number,
  roles?: ModelRole[],
  signal?: AbortSignal,
): Promise<FrameResult> {
  const models = (await webModels()).filter((m) => !roles?.length || roles.includes(m.role));
  const ort = await runtime();
  // Every model this frame needs is ready before the frame takes its turn.
  const ready = await Promise.all(models.map(session));
  return inTurn(() => run(ort, models, ready, source, width, height, signal));
}

async function run(
  ort: typeof Ort,
  models: WebModel[],
  ready: Ort.InferenceSession[],
  source: CanvasImageSource,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<FrameResult> {
  const started = performance.now();
  const detections: HazardDetection[] = [];
  const prepared = new Map<number, { data: Float32Array; lb: Letterbox }>();
  for (const [i, m] of models.entries()) {
    if (signal?.aborted) throw new DOMException('Detection stopped.', 'AbortError');
    const s = ready[i];
    if (!prepared.has(m.imgsz)) prepared.set(m.imgsz, input(source, width, height, m.imgsz));
    const { data, lb } = prepared.get(m.imgsz)!;
    const feed = new ort.Tensor('float32', data, [1, 3, m.imgsz, m.imgsz]);
    const result = await s.run({ [s.inputNames[0]]: feed });
    const out = result[s.outputNames[0]];
    const raw = out.data as Float32Array;
    const found: HazardDetection[] =
      m.layout === 'end2end'
        ? decodeEnd2end(raw, out.dims, m.classes, lb)
        : m.keypoints
          ? decodePose(raw, out.dims, m.classes, lb)
          : decodeYolov8(raw, out.dims, m.classes, lb, MIN_CONFIDENCE, IOU);
    for (const d of found) {
      detections.push({
        ...d,
        confidence: round(d.confidence, 4),
        model: m.role,
      });
    }
    feed.dispose();
    out.dispose();
  }
  return { detections, inferenceMs: round(performance.now() - started, 1), width, height };
}
