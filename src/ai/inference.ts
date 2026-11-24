/**
 * Where the site's YOLO models run.
 *
 * By default, in this browser (./browser.ts): the models ship with the site and
 * run on the device itself, so the camera AI works on any phone or computer
 * with no server. When VITE_PPE_INFERENCE_URL is set, frames go to that
 * inference service (ai/inference_service/server.py) instead — a GPU server,
 * a cloud VM or an edge box next to the cameras. Either way detections come
 * back tagged with the model that made them, and the app never fabricates
 * one: a model that cannot load or a service that cannot be reached says so.
 */

import { translate } from '@/i18n';
import type { HazardDetection } from '@/shared/hazards';

import { browserStatus, detectInBrowser } from './browser';

export const INFERENCE_URL = (import.meta.env.VITE_PPE_INFERENCE_URL || '').replace(/\/$/, '');
const TOKEN = import.meta.env.VITE_PPE_INFERENCE_TOKEN || '';

/** ppe: PPE items + person · general: COCO objects · pose: people + keypoints · fire: fire, smoke */
export type ModelRole = 'ppe' | 'general' | 'pose' | 'fire';

export interface ModelMetrics {
  val?: { precision: number; recall: number; mAP50: number; mAP50_95: number };
  test?: {
    precision: number;
    recall: number;
    mAP50?: number;
    mAP50_95?: number;
    per_class?: Record<string, { precision: number; recall: number; mAP50: number; mAP50_95: number }>;
  };
  published?: { dataset: string; metric: string; value: number; source: string };
}

export interface LoadedModel {
  role: ModelRole;
  name: string;
  architecture: string;
  weights: string;
  classes: string[];
  keypoints: boolean;
  device: 'gpu' | 'cpu';
  /** 'webgpu' / 'wasm': running in this browser · 'remote': on the inference service. */
  backend?: 'webgpu' | 'wasm' | 'remote';
  metrics: ModelMetrics | null;
}

export interface ModelInfo {
  configured: true;
  models: LoadedModel[];
  /** Models the service is configured for but could not serve, and why. */
  missing: { role: string; reason: string }[];
}

export type ModelStatus =
  | { state: 'ready'; info: ModelInfo }
  | { state: 'not-configured'; reason: string }
  | { state: 'unreachable'; reason: string };

export const MODEL_ROLE_LABEL: Record<ModelRole, string> = {
  ppe: 'PPE',
  general: 'People, vehicles & objects',
  pose: 'Body posture',
  fire: 'Fire & smoke',
};

const headers = (): HeadersInit => (TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {});

export const modelFor = (info: ModelInfo, role: ModelRole) => info.models.find((m) => m.role === role) ?? null;

export async function getModelStatus(): Promise<ModelStatus> {
  if (!INFERENCE_URL) return browserStatus();
  let res: Response;
  try {
    res = await fetch(`${INFERENCE_URL}/v1/model`, { headers: headers(), cache: 'no-store' });
  } catch {
    return {
      state: 'unreachable',
      reason: translate('ai.unreachable', { url: INFERENCE_URL }),
    };
  }
  const body = (await res.json().catch(() => ({}))) as Partial<ModelInfo> &
    Partial<Omit<LoadedModel, 'role'>> & { reason?: string; error?: string };
  if (res.status === 401) return { state: 'unreachable', reason: translate('ai.tokenRejected') };
  if (!res.ok || !body.configured) {
    return { state: 'not-configured', reason: body.reason ?? body.error ?? translate('ai.answered', { status: res.status }) };
  }
  // An older, single-model service describes just its PPE model.
  const models: LoadedModel[] = body.models ?? [
    {
      role: 'ppe',
      name: body.name ?? 'ppe',
      architecture: body.architecture ?? 'YOLOv8',
      weights: body.weights ?? '',
      classes: body.classes ?? [],
      keypoints: false,
      device: body.device ?? 'cpu',
      metrics: body.metrics ?? null,
    },
  ];
  return { state: 'ready', info: { configured: true, models, missing: body.missing ?? [] } };
}

export interface FrameResult {
  detections: HazardDetection[];
  inferenceMs: number;
  width: number;
  height: number;
}

async function post(image: Blob, roles: ModelRole[] | undefined, signal?: AbortSignal, fallback?: { width: number; height: number }): Promise<FrameResult> {
  const query = roles?.length ? `?models=${roles.join(',')}` : '';
  const res = await fetch(`${INFERENCE_URL}/v1/detect${query}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': image.type || 'image/jpeg' },
    body: image,
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<FrameResult> & { reason?: string; error?: string };
  if (!res.ok) throw new Error(body.reason ?? body.error ?? `Detection failed (${res.status}).`);
  return {
    // An older service does not tag detections: they are all from the PPE model.
    detections: (body.detections ?? []).map((d) => ({ ...d, model: d.model ?? 'ppe' })),
    inferenceMs: body.inferenceMs ?? 0,
    width: body.width ?? fallback?.width ?? 0,
    height: body.height ?? fallback?.height ?? 0,
  };
}

/** Runs the chosen models on one frame (already drawn on a canvas). */
export async function detectFrame(frame: HTMLCanvasElement, signal?: AbortSignal, roles?: ModelRole[]): Promise<FrameResult> {
  if (!INFERENCE_URL) return detectInBrowser(frame, frame.width, frame.height, roles, signal);
  const blob = await new Promise<Blob>((resolve, reject) =>
    frame.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the frame.'))), 'image/jpeg', 0.7),
  );
  return post(blob, roles, signal, { width: frame.width, height: frame.height });
}

/** Runs the chosen models on a photo (JPEG/PNG/WebP up to 8 MB). */
export async function detectImage(image: Blob, roles?: ModelRole[], signal?: AbortSignal): Promise<FrameResult> {
  if (INFERENCE_URL) return post(image, roles, signal);
  const bitmap = await createImageBitmap(image);
  try {
    return await detectInBrowser(bitmap, bitmap.width, bitmap.height, roles, signal);
  } finally {
    bitmap.close();
  }
}
