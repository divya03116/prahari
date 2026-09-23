import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc } from 'firebase/firestore';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, Cpu, PenLine, Play, RefreshCw, ShieldAlert, Square, Trash2 } from 'lucide-react';

import { useAuth } from '@/auth/AuthProvider';
import { cameraSupport, describeCameraError, listCameras, openCamera, stopStream } from '@/ai/camera';
import { detectFrame, getModelStatus, INFERENCE_URL, MODEL_ROLE_LABEL, modelFor, type ModelInfo, type ModelRole, type ModelStatus } from '@/ai/inference';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { useReference } from '@/hooks/reference';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { firebase } from '@/lib/firebase';
import { api } from '@/services/callables';
import { startUpload } from '@/services/storage';
import { COLLECTIONS, REPORT_TYPE_LABEL } from '@/shared/constants';
import {
  DEFAULT_HAZARD_SETTINGS,
  HAZARD_TYPES,
  HazardMonitor,
  HAZARDS,
  supportedHazards,
  type HazardEvent,
  type HazardFinding,
  type HazardType,
  type Zone,
  type ZoneKind,
} from '@/shared/hazards';
import {
  ComplianceMonitor,
  DEFAULT_PPE_SETTINGS,
  PPE_LABEL,
  PPE_SETTINGS_LIMITS,
  PPE_TYPES,
  supportedPpe,
  type PpeSettings,
  type PpeType,
  type ViolationEvent,
  type WorkerStatus,
} from '@/shared/ppe';

/* ------------------------------------------------------------------ *
 * Camera station configuration, remembered on this device
 * ------------------------------------------------------------------ */

interface StationConfig {
  cameraId: string;
  label: string;
  installationId: string;
  source: 'device' | 'back' | 'front' | 'stream';
  deviceId: string;
  streamUrl: string;
  streamFormat: 'video' | 'mjpeg';
  required: PpeType[];
  settings: PpeSettings;
  /** Start the camera and detection as soon as the page opens. */
  autoStart: boolean;
  /** Hazard rules switched on (each also needs a model that can see it). */
  hazards: HazardType[];
  /** Danger and keep-clear areas drawn on this camera's view. */
  zones: Zone[];
  hazardConfidence: number;
}

/** Which models each frame goes to, from what is switched on. */
function rolesFor(info: ModelInfo | null, ppe: boolean, hazards: HazardType[]): ModelRole[] {
  if (!info) return [];
  const has = (r: ModelRole) => info.models.some((m) => m.role === r);
  const roles = new Set<ModelRole>();
  if (ppe) roles.add('ppe');
  const people = hazards.some((h) => h === 'restricted-zone' || h === 'person-down' || h === 'vehicle-proximity' || h === 'phone-use');
  const objects = hazards.some((h) => h === 'vehicle-proximity' || h === 'blocked-zone' || h === 'phone-use');
  if (people) roles.add(has('pose') ? 'pose' : has('general') ? 'general' : 'ppe');
  if (objects) roles.add('general');
  if (hazards.includes('fire') || hazards.includes('smoke')) roles.add('fire');
  return [...roles].filter(has);
}

const ZONE_KIND_LABEL: Record<ZoneKind, string> = { danger: 'Restricted (no entry)', 'keep-clear': 'Keep clear (walkway / exit)' };

const CONFIG_KEY = 'prahari.monitoring.v1';

/** A readable camera name when the person has not typed one. */
function autoLabel(source: StationConfig['source'], stream: MediaStream | null, streamUrl: string): string {
  if (source === 'stream') {
    try {
      return `IP camera ${new URL(streamUrl).host}`;
    } catch {
      return 'IP camera';
    }
  }
  if (source === 'back') return 'Phone camera (back)';
  if (source === 'front') return 'Phone camera (front)';
  // e.g. "Integrated Webcam (0c45:6a1b)" → "Integrated Webcam"
  const track = stream?.getVideoTracks()[0]?.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  return (track || 'Camera').slice(0, 80);
}

function newCameraId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return `cam_${[...a].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function loadConfig(): StationConfig {
  const base: StationConfig = {
    cameraId: newCameraId(),
    label: '',
    installationId: '',
    source: 'device',
    deviceId: '',
    streamUrl: '',
    streamFormat: 'mjpeg',
    required: ['helmet', 'vest'],
    settings: { ...DEFAULT_PPE_SETTINGS },
    autoStart: true,
    hazards: ['restricted-zone', 'vehicle-proximity', 'person-down', 'blocked-zone', 'fire', 'smoke'],
    zones: [],
    hazardConfidence: DEFAULT_HAZARD_SETTINGS.minConfidence,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as Partial<StationConfig> | null;
    return saved ? { ...base, ...saved, settings: { ...base.settings, ...saved.settings } } : base;
  } catch {
    return base;
  }
}

function saveConfig(c: StationConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* optional */
  }
}

interface LogEntry {
  at: Date;
  kind: 'created' | 'suppressed' | 'error';
  text: string;
  reportId?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */

export default function Monitoring() {
  const { user, profile } = useAuth();
  const { installations } = useReference();
  const [cfg, setCfg] = useState<StationConfig>(loadConfig);
  // Latest values for callbacks that outlive a render (detection loop, timers, device events).
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);
  const [perf, setPerf] = useState({ fps: 0, ms: 0 });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [needInstallation, setNeedInstallation] = useState(false);
  const [findings, setFindings] = useState<HazardFinding[]>([]);
  /** Points of the zone being drawn (fractions of the frame), or null when not drawing. */
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const [draftMeta, setDraftMeta] = useState<{ name: string; kind: ZoneKind }>({ name: '', kind: 'danger' });
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const installationRef = useRef<HTMLSelectElement>(null);
  const runningRef = useRef(false);
  const starting = useRef(false);
  const userStopped = useRef(false); // a person pressed Stop: never restart on our own
  const retryTimer = useRef<number | undefined>(undefined);
  const startRef = useRef<(auto?: boolean) => Promise<void>>(async () => {});
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loop = useRef<{ active: boolean; abort: AbortController | null }>({ active: false, abort: null });
  const monitor = useRef(new ComplianceMonitor(cfg.settings, cfg.required));
  const hazardMon = useRef(new HazardMonitor({ minConfidence: cfg.hazardConfidence, incidentCooldownSeconds: cfg.settings.incidentCooldownSeconds }, [], cfg.zones));
  const lastDraw = useRef<{ statuses: WorkerStatus[]; findings: HazardFinding[]; w: number; h: number } | null>(null);
  const reporting = useRef<Promise<void>>(Promise.resolve());
  const support = useMemo(cameraSupport, []);

  const info = model?.state === 'ready' ? model.info : null;
  const ready = info !== null;
  const ppeModel = info ? modelFor(info, 'ppe') : null;
  const supported = useMemo(() => (ppeModel ? supportedPpe(ppeModel.classes) : []), [ppeModel]);
  const required = cfg.required.filter((t) => supported.includes(t));
  // Hazard rules the loaded models can support (a PPE model only lends its people).
  const hazardSupport = useMemo(
    () =>
      info
        ? supportedHazards(
            info.models.flatMap((m) => (m.role === 'ppe' ? m.classes.filter((c) => c === 'person') : m.classes)),
            info.models.some((m) => m.keypoints),
          )
        : [],
    [info],
  );
  const zoneFor = (h: HazardType) => !HAZARDS[h].zone || cfg.zones.some((z) => z.kind === HAZARDS[h].zone);
  const activeHazards = cfg.hazards.filter((h) => hazardSupport.includes(h) && zoneFor(h));
  const activeKey = activeHazards.join(',');
  const detecting = ready && (required.length > 0 || activeHazards.length > 0);
  const roles = useMemo(() => rolesFor(info, required.length > 0, activeHazards), [info, required.length, activeKey]);
  const rolesRef = useRef(roles);
  rolesRef.current = roles;
  const activeRef = useRef(activeHazards);
  activeRef.current = activeHazards;

  const update = (patch: Partial<StationConfig>) =>
    setCfg((c) => {
      const next = { ...c, ...patch, settings: { ...c.settings, ...patch.settings } };
      saveConfig(next);
      return next;
    });

  const refreshModel = useCallback(async () => {
    setModel(null);
    setModel(await getModelStatus());
  }, []);

  const refreshDevices = useCallback(async () => {
    setDevices(await listCameras().catch(() => []));
  }, []);

  useEffect(() => {
    void refreshModel();
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshModel, refreshDevices]);

  /* ---------------- overlay ---------------- */

  const drawOverlay = useCallback((statuses: WorkerStatus[], hazards: HazardFinding[], frameW: number, frameH: number) => {
    lastDraw.current = { statuses, findings: hazards, w: frameW, h: frameH };
    const canvas = overlayRef.current;
    const el = cfg.source === 'stream' && cfg.streamFormat === 'mjpeg' ? imgRef.current : videoRef.current;
    if (!canvas || !el) return;
    const rect = el.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // object-contain mapping from frame pixels to the displayed element
    const s = Math.min(rect.width / frameW, rect.height / frameH);
    const ox = (rect.width - frameW * s) / 2;
    const oy = (rect.height - frameH * s) / 2;
    ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
    for (const w of statuses) {
      const colour = w.confirmed.length ? '#eb5757' : Object.keys(w.pending).length ? '#e5a50a' : '#3fa66d';
      const x = ox + w.person.box.x1 * s;
      const y = oy + w.person.box.y1 * s;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, (w.person.box.x2 - w.person.box.x1) * s, (w.person.box.y2 - w.person.box.y1) * s);
      const label = `W${w.trackId} ${required.map((t) => `${t} ${w.ppe[t]?.state === 'present' ? '✓' : '✗'}`).join('  ')}`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = colour;
      ctx.fillRect(x, Math.max(0, y - 18), tw, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 5, Math.max(13, y - 5));
    }
    // Zones (and the one being drawn), in frame fractions.
    const at = ([fx, fy]: [number, number]) => [ox + fx * frameW * s, oy + fy * frameH * s] as const;
    const polygon = (pts: [number, number][], colour: string, fill: string, closed: boolean) => {
      if (!pts.length) return;
      ctx.beginPath();
      pts.forEach((pt, i) => (i ? ctx.lineTo(...at(pt)) : ctx.moveTo(...at(pt))));
      if (closed) ctx.closePath();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (closed) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      for (const pt of pts) {
        const [px, py] = at(pt);
        ctx.fillStyle = colour;
        ctx.fillRect(px - 3, py - 3, 6, 6);
      }
    };
    for (const z of cfgRef.current.zones) {
      const danger = z.kind === 'danger';
      polygon(z.points, danger ? '#eb5757' : '#e5a50a', danger ? 'rgba(235,87,87,0.12)' : 'rgba(229,165,10,0.12)', true);
      const [lx, ly] = at(z.points[0]);
      ctx.fillStyle = danger ? '#eb5757' : '#e5a50a';
      ctx.fillText(z.name, lx + 4, ly + 14);
    }
    if (draftRef.current) polygon(draftRef.current, '#8b7cf6', 'rgba(139,124,246,0.15)', draftRef.current.length >= 3);
    for (const f of hazards) {
      const colour = f.confirmed ? '#eb5757' : '#e5a50a';
      const x = ox + f.box.x1 * s;
      const y = oy + f.box.y1 * s;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, (f.box.x2 - f.box.x1) * s, (f.box.y2 - f.box.y1) * s);
      const label = `${HAZARDS[f.type].label}${f.confirmed ? '' : ` ${Math.round(f.progress * 100)}%`}`;
      const tw = ctx.measureText(label).width + 10;
      const ty = Math.min(canvas.height - 18, oy + f.box.y2 * s);
      ctx.fillStyle = colour;
      ctx.fillRect(x, ty, tw, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 5, ty + 13);
    }
  }, [cfg.source, cfg.streamFormat, required]);

  /** Redraws zones and the zone being drawn when no detection frame is coming. */
  const redraw = useCallback(() => {
    const el = cfg.source === 'stream' && cfg.streamFormat === 'mjpeg' ? imgRef.current : videoRef.current;
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el?.naturalWidth ?? 0;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el?.naturalHeight ?? 0;
    const last = lastDraw.current;
    if (last && last.w && last.h) drawOverlay(last.statuses, last.findings, last.w, last.h);
    else if (w && h) drawOverlay([], [], w, h);
  }, [cfg.source, cfg.streamFormat, drawOverlay]);

  useEffect(() => {
    if (running) redraw();
  }, [running, draft, cfg.zones, redraw]);

  /** Adds a point to the zone being drawn, from a click on the live view. */
  const addDraftPoint = (ev: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const el = cfg.source === 'stream' && cfg.streamFormat === 'mjpeg' ? imgRef.current : videoRef.current;
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el?.naturalWidth ?? 0;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el?.naturalHeight ?? 0;
    if (!w || !h) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const sc = Math.min(rect.width / w, rect.height / h);
    const fx = (ev.clientX - rect.left - (rect.width - w * sc) / 2) / (w * sc);
    const fy = (ev.clientY - rect.top - (rect.height - h * sc) / 2) / (h * sc);
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    setDraft([...draft, [Number(fx.toFixed(4)), Number(fy.toFixed(4))]]);
  };

  const saveZone = () => {
    if (!draft || draft.length < 3 || !draftMeta.name.trim()) return;
    const zone: Zone = { id: `z${Date.now().toString(36)}`, name: draftMeta.name.trim().slice(0, 60), kind: draftMeta.kind, points: draft };
    update({ zones: [...cfg.zones, zone] });
    setDraft(null);
    setDraftMeta({ name: '', kind: 'danger' });
  };

  /* ---------------- automatic incident ---------------- */

  const fileIncident = useCallback(
    async (events: ViolationEvent[], statuses: WorkerStatus[], frame: HTMLCanvasElement) => {
      if (!user || !ppeModel) return;
      const c = cfgRef.current; // the camera name may have been filled in automatically after start
      const reportId = doc(collection(firebase.db, COLLECTIONS.reports)).id;
      try {
        const blob = await new Promise<Blob>((res, rej) => frame.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.9));
        const path = `attachments/${user.uid}/${reportId}/evidence-frame.jpg`;
        const { task } = await startUpload(path, new File([blob], 'evidence-frame.jpg', { type: 'image/jpeg' }));
        await task;
        const result = await api.createPpeIncident({
          reportId,
          installationId: c.installationId,
          camera: { id: c.cameraId, label: c.label, kind: c.source === 'stream' ? 'stream' : 'device' },
          violations: events.map((e) => ({
            type: e.type,
            trackId: e.trackId,
            personConfidence: Number(e.person.confidence.toFixed(4)),
            frames: e.frames,
            seconds: Number(e.seconds.toFixed(2)),
          })),
          workers: statuses.map((w) => ({
            trackId: w.trackId,
            box: w.person.box,
            confidence: Number(w.person.confidence.toFixed(4)),
            ppe: Object.fromEntries(
              Object.entries(w.ppe).map(([k, v]) => [k, { state: v!.state, confidence: v!.confidence === null ? null : Number(v!.confidence.toFixed(4)) }]),
            ),
          })),
          frame: { width: frame.width, height: frame.height },
          evidence: { path, name: 'evidence-frame.jpg', size: blob.size, contentType: 'image/jpeg' },
          model: { name: ppeModel.name, architecture: ppeModel.architecture, backend: 'remote', classes: ppeModel.classes },
          settings: c.settings,
          required,
          geo: null,
        });
        const what = events.map((e) => PPE_LABEL[e.type]).join(', ');
        const entry: LogEntry = result.deduplicated
          ? { at: new Date(), kind: 'suppressed', text: `${what} — already reported within the cooldown`, reportId: result.reportId }
          : { at: new Date(), kind: 'created', text: `Incident created: missing ${what}`, reportId: result.reportId };
        setLog((l) => [entry, ...l].slice(0, 30));
      } catch (err) {
        setLog((l) => [{ at: new Date(), kind: 'error' as const, text: `Could not file the incident: ${errorMessage(err)}` }, ...l].slice(0, 30));
      }
    },
    [user, ppeModel, required],
  );

  const fileHazard = useCallback(
    async (e: HazardEvent, frame: HTMLCanvasElement) => {
      if (!user || !info) return;
      const c = cfgRef.current;
      const reportId = doc(collection(firebase.db, COLLECTIONS.reports)).id;
      const label = HAZARDS[e.type].label;
      try {
        const blob = await new Promise<Blob>((res, rej) => frame.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.9));
        const path = `attachments/${user.uid}/${reportId}/evidence-frame.jpg`;
        const { task } = await startUpload(path, new File([blob], 'evidence-frame.jpg', { type: 'image/jpeg' }));
        await task;
        // The models that looked at this frame (the PPE model only if it supplied the people).
        const used = info.models.filter((m) => rolesRef.current.includes(m.role));
        const hazardModels = used.filter((m) => m.role !== 'ppe');
        const result = await api.createHazardIncident({
          reportId,
          installationId: c.installationId,
          camera: { id: c.cameraId, label: c.label, kind: c.source === 'stream' ? 'stream' : 'device' },
          event: {
            key: e.key,
            type: e.type,
            frames: e.frames,
            seconds: Number(e.seconds.toFixed(2)),
            subject: e.subject,
            ...(e.other ? { other: e.other } : {}),
            ...(e.zone ? { zone: e.zone } : {}),
            ...(e.objects ? { objects: e.objects } : {}),
            ...(e.method ? { method: e.method } : {}),
          },
          frame: { width: frame.width, height: frame.height },
          evidence: { path, name: 'evidence-frame.jpg', size: blob.size, contentType: 'image/jpeg' },
          models: (hazardModels.length ? hazardModels : used).map((m) => ({ role: m.role, name: m.name, architecture: m.architecture })),
          settings: { minConfidence: c.hazardConfidence, incidentCooldownSeconds: c.settings.incidentCooldownSeconds },
          geo: null,
        });
        const entry: LogEntry = result.deduplicated
          ? { at: new Date(), kind: 'suppressed', text: `${label} — already reported within the cooldown`, reportId: result.reportId }
          : { at: new Date(), kind: 'created', text: `Incident created: ${label} (${REPORT_TYPE_LABEL[e.kind].toLowerCase()})`, reportId: result.reportId };
        setLog((l) => [entry, ...l].slice(0, 30));
      } catch (err) {
        setLog((l) => [{ at: new Date(), kind: 'error' as const, text: `Could not file “${label}”: ${errorMessage(err)}` }, ...l].slice(0, 30));
      }
    },
    [user, info],
  );

  /* ---------------- detection loop ---------------- */

  const runLoop = useCallback(async () => {
    const L = loop.current;
    const frame = document.createElement('canvas');
    const times: number[] = [];
    while (L.active) {
      const el = cfg.source === 'stream' && cfg.streamFormat === 'mjpeg' ? imgRef.current : videoRef.current;
      const w = el instanceof HTMLVideoElement ? el.videoWidth : el?.naturalWidth ?? 0;
      const h = el instanceof HTMLVideoElement ? el.videoHeight : el?.naturalHeight ?? 0;
      if (!el || !w || !h) {
        await sleep(150);
        continue;
      }
      const scale = Math.min(1, 960 / w);
      frame.width = Math.round(w * scale);
      frame.height = Math.round(h * scale);
      frame.getContext('2d')!.drawImage(el, 0, 0, frame.width, frame.height);
      const wanted = rolesRef.current;
      if (!wanted.length) {
        await sleep(500); // nothing switched on that the models can see
        continue;
      }
      try {
        const r = await detectFrame(frame, L.abort?.signal, wanted);
        if (!L.active) break;
        const now = performance.now();
        const ppeOn = wanted.includes('ppe') && monitorRequired.current.length > 0;
        const { workers: statuses, events } = ppeOn
          ? monitor.current.update(r.detections.filter((d) => d.model === 'ppe'), now)
          : { workers: [], events: [] };
        const hz = activeRef.current.length
          ? hazardMon.current.update(r.detections, { width: frame.width, height: frame.height }, now)
          : { findings: [], events: [] };
        setWorkers(statuses);
        setFindings(hz.findings);
        drawOverlay(statuses, hz.findings, frame.width, frame.height);
        setDetectError(null);
        times.push(now);
        while (times.length > 10) times.shift();
        const fps = times.length > 1 ? ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]) : 0;
        setPerf({ fps, ms: r.inferenceMs });
        if (events.length || hz.events.length) {
          const snapshot = document.createElement('canvas');
          snapshot.width = frame.width;
          snapshot.height = frame.height;
          snapshot.getContext('2d')!.drawImage(frame, 0, 0);
          if (events.length) reporting.current = reporting.current.then(() => fileIncident(events, statuses, snapshot));
          for (const e of hz.events) reporting.current = reporting.current.then(() => fileHazard(e, snapshot));
        }
      } catch (err) {
        if (!L.active || (err as Error).name === 'AbortError') break;
        const name = (err as Error).name;
        setDetectError(
          name === 'SecurityError'
            ? 'The stream server does not allow cross-origin access (CORS), so its frames cannot be analysed.'
            : errorMessage(err, (err as Error).message || 'Detection failed.'),
        );
        await sleep(1500);
      }
    }
  }, [cfg.source, cfg.streamFormat, drawOverlay, fileIncident, fileHazard]);

  const stop = useCallback(() => {
    loop.current.active = false;
    loop.current.abort?.abort();
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
    if (imgRef.current) imgRef.current.removeAttribute('src');
    overlayRef.current?.getContext('2d')?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    setWorkers([]);
    setFindings([]);
    setDraft(null);
    lastDraw.current = null;
    runningRef.current = false;
    setRunning(false);
  }, []);

  // Rules, zones and thresholds can change while the camera runs (zones are drawn on the live view).
  const monitorRequired = useRef(required);
  monitorRequired.current = required;
  useEffect(() => {
    hazardMon.current.configure(
      { minConfidence: cfg.hazardConfidence, incidentCooldownSeconds: cfg.settings.incidentCooldownSeconds },
      activeHazards,
      cfg.zones,
    );
  }, [cfg.hazardConfidence, cfg.settings.incidentCooldownSeconds, activeKey, cfg.zones]);

  useEffect(() => stop, [stop]);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);

  /** A person pressed Stop: respect it until they press Start. */
  const stopByUser = () => {
    userStopped.current = true;
    window.clearTimeout(retryTimer.current);
    stop();
  };

  // Choose the installation automatically: the person's own site, else the first active one.
  useEffect(() => {
    const active = installations.filter((i) => i.active);
    if (active.some((i) => i.id === cfg.installationId)) return;
    const pick = active.find((i) => i.id === profile?.installationId) ?? active[0];
    if (pick) update({ installationId: pick.id });
  }, [installations, profile?.installationId, cfg.installationId]);

  // Once an installation exists, the message about it has done its job.
  useEffect(() => {
    if (needInstallation && cfg.installationId) {
      setNeedInstallation(false);
      setCamError(null);
    }
  }, [needInstallation, cfg.installationId]);

  const start = async (auto = false) => {
    if (starting.current || runningRef.current) return;
    if (auto && userStopped.current) return;
    if (!auto) userStopped.current = false;
    window.clearTimeout(retryTimer.current);
    setCamError(null);
    setDetectError(null);
    if (!cfg.installationId) {
      setNeedInstallation(true);
      installationRef.current?.focus();
      return setCamError(
        installations.some((i) => i.active)
          ? 'Choose the installation this camera watches.'
          : 'No active installation exists yet — an administrator can add one under Reference data.',
      );
    }
    if (ready && !required.length && !activeHazards.length) {
      return setCamError('Switch on at least one PPE item or hazard rule the loaded models can detect.');
    }
    starting.current = true;
    try {
      if (cfg.source === 'stream') {
        if (!/^https?:\/\//i.test(cfg.streamUrl)) return setCamError('Enter an http(s) stream URL.');
        if (!cfg.label.trim()) update({ label: autoLabel('stream', null, cfg.streamUrl) });
        if (cfg.streamFormat === 'mjpeg') {
          imgRef.current!.crossOrigin = 'anonymous';
          imgRef.current!.src = cfg.streamUrl;
        } else {
          videoRef.current!.crossOrigin = 'anonymous';
          videoRef.current!.src = cfg.streamUrl;
          await videoRef.current!.play();
        }
      } else {
        if (!support.secure) return setCamError('Camera access needs HTTPS (or localhost). Open the site over HTTPS.');
        if (!support.mediaDevices) return setCamError('This browser cannot access cameras.');
        const choice =
          cfg.source === 'device' && cfg.deviceId
            ? ({ kind: 'device', deviceId: cfg.deviceId } as const)
            : ({ kind: 'facing', facingMode: cfg.source === 'front' ? 'user' : 'environment' } as const);
        const stream = await openCamera(choice);
        streamRef.current = stream;
        videoRef.current!.srcObject = stream;
        await videoRef.current!.play();
        void refreshDevices(); // labels become available after permission
        if (!cfg.label.trim()) update({ label: autoLabel(cfg.source, stream, '') });
        // Unplugged, or taken by another app: stop cleanly and reconnect by itself.
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (streamRef.current !== stream) return;
          stop();
          setCamError('The camera disconnected. Reconnecting automatically…');
          retryTimer.current = window.setTimeout(() => void startRef.current(true), 5000);
        });
      }
      monitor.current = new ComplianceMonitor(cfg.settings, required);
      hazardMon.current = new HazardMonitor(
        { minConfidence: cfg.hazardConfidence, incidentCooldownSeconds: cfg.settings.incidentCooldownSeconds },
        activeHazards,
        cfg.zones,
      );
      runningRef.current = true;
      setRunning(true);
      if (detecting) {
        loop.current = { active: true, abort: new AbortController() };
        void runLoop();
      }
    } catch (err) {
      stop();
      setCamError(cfg.source === 'stream' ? 'The stream could not be opened. Check the URL and that the server allows this site (CORS).' : describeCameraError(err));
    } finally {
      starting.current = false;
    }
  };
  startRef.current = start;

  // Start by itself as soon as the model status is known and an installation is chosen.
  useEffect(() => {
    if (cfg.autoStart && model !== null && cfg.installationId) void startRef.current(true);
  }, [cfg.autoStart, model, cfg.installationId]);

  // The AI service came up after the camera started: switch detection on without a reload.
  // (Runs on model/camera state changes only; the loop reads everything else when it starts.)
  useEffect(() => {
    if (!detecting || !running || loop.current.active) return;
    monitor.current = new ComplianceMonitor(cfg.settings, required);
    loop.current = { active: true, abort: new AbortController() };
    void runLoop();
  }, [detecting, running]);

  // No model yet: keep checking quietly, so starting the AI service later is enough.
  useEffect(() => {
    if (!model || model.state === 'ready') return;
    const t = window.setInterval(async () => {
      const next = await getModelStatus();
      if (next.state === 'ready') setModel(next);
    }, 15_000);
    return () => window.clearInterval(t);
  }, [model]);

  // A camera plugged in later is picked up automatically.
  useEffect(() => {
    const onChange = () => {
      if (cfgRef.current.autoStart && !runningRef.current) void startRef.current(true);
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, []);

  // Camera allowed after a refusal (address-bar or site settings): start by itself,
  // instead of leaving the old "permission was blocked" message until Start is pressed.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status?.state === 'granted' && cfgRef.current.autoStart && !runningRef.current) void startRef.current(true);
    };
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.addEventListener('change', onChange);
      })
      .catch(() => undefined); // not every browser can report the camera permission
    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, []);

  const setting = (key: keyof PpeSettings, label: string, step: number, hint: string) => {
    const [min, max] = PPE_SETTINGS_LIMITS[key];
    return (
      <Field label={label} hint={hint}>
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={cfg.settings[key]}
          disabled={running}
          onChange={(e) => {
            const v = Math.min(max, Math.max(min, Number(e.target.value) || min));
            update({ settings: { ...cfg.settings, [key]: v } });
          }}
        />
      </Field>
    );
  };

  const streamMode = cfg.source === 'stream';

  return (
    <>
      <PageHeader
        title="Live safety monitoring"
        description="Watches a camera for missing PPE, unsafe acts, unsafe conditions and near misses, and files an incident with the photo automatically once one is confirmed."
      />

      {/* ---------------- model status ---------------- */}
      <Panel className="mb-5">
        <PanelBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {model === null ? (
            <Skeleton className="h-10 w-72" />
          ) : model.state === 'ready' ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  {model.info.models.length === 1 ? 'AI model ready' : `AI models ready · ${model.info.models.length} models`} on{' '}
                  {model.info.models[0].device.toUpperCase()}
                </p>
                <ul className="mt-0.5 flex flex-col gap-0.5 text-xs text-fg-muted">
                  {model.info.models.map((m) => (
                    <li key={m.role}>
                      <span className="text-fg">{MODEL_ROLE_LABEL[m.role]}</span> · {m.name}
                      {m.role === 'ppe' || m.role === 'fire' ? ` · detects ${m.classes.join(', ')}` : m.keypoints ? ' · people and body posture' : ' · people, vehicles, phones, objects'}
                      {m.metrics?.test &&
                        ` · test set: precision ${m.metrics.test.precision.toFixed(2)}, recall ${m.metrics.test.recall.toFixed(2)}${m.metrics.test.mAP50 !== undefined ? `, mAP@0.5 ${m.metrics.test.mAP50.toFixed(2)}` : ''}`}
                    </li>
                  ))}
                  {model.info.missing.map((m) => (
                    <li key={m.role} className="text-fg-subtle">
                      {MODEL_ROLE_LABEL[m.role as ModelRole] ?? m.role} · not loaded: {m.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-fg">AI Model Not Configured</p>
                <p className="text-xs text-fg-muted">{model.reason} Cameras can still be previewed; no detection runs and no incidents are created.</p>
              </div>
            </div>
          )}
          <Button size="sm" onClick={() => void refreshModel()} aria-label="Check the model again">
            <RefreshCw aria-hidden /> Re-check
          </Button>
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------- live view ---------------- */}
        <div className="flex min-w-0 flex-col gap-5">
          <Panel>
            <PanelHeader
              title={cfg.label || 'Camera'}
              description={running ? (detecting ? 'Live · detection on' : ready ? 'Live · detection off (nothing switched on)' : 'Live · detection off (no model)') : 'Stopped'}
              actions={
                running ? (
                  <Button variant="danger" size="sm" onClick={stopByUser}>
                    <Square aria-hidden /> Stop
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => void start()}>
                    <Play aria-hidden /> Start camera
                  </Button>
                )
              }
            />
            <PanelBody className="flex flex-col gap-3">
              {camError && <Alert tone="critical">{camError}</Alert>}
              {detectError && <Alert tone="warning">{detectError}</Alert>}
              <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
                <video ref={videoRef} muted playsInline className={cn('absolute inset-0 size-full object-contain', streamMode && cfg.streamFormat === 'mjpeg' && 'hidden')} />
                <img ref={imgRef} alt="" className={cn('absolute inset-0 size-full object-contain', !(streamMode && cfg.streamFormat === 'mjpeg') && 'hidden')} />
                <canvas
                  ref={overlayRef}
                  onClick={addDraftPoint}
                  className={cn('absolute inset-0 size-full', draft ? 'cursor-crosshair' : 'pointer-events-none')}
                  aria-label={draft ? 'Click to add zone corners' : undefined}
                  aria-hidden={draft ? undefined : true}
                />
                {!running && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fg-subtle">
                    <CameraOff className="size-8" aria-hidden />
                    <p className="text-sm">Camera off</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted" role="status" aria-live="polite">
                <span>
                  Workers in view: <b className="text-fg tabular">{workers.length}</b>
                </span>
                <span>
                  Pending: <b className="text-warning tabular">{workers.reduce((n, w) => n + Object.keys(w.pending).length, 0)}</b>
                </span>
                <span>
                  Confirmed: <b className="text-critical tabular">{workers.reduce((n, w) => n + w.confirmed.length, 0)}</b>
                </span>
                <span>
                  Hazards: <b className="text-warning tabular">{findings.filter((f) => !f.confirmed).length}</b> confirming ·{' '}
                  <b className="text-critical tabular">{findings.filter((f) => f.confirmed).length}</b> confirmed
                </span>
                {running && detecting && (
                  <span>
                    {perf.fps.toFixed(1)} fps · {Math.round(perf.ms)} ms/frame
                  </span>
                )}
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Hazards in view" description="Unsafe acts, unsafe conditions and near misses in the current frame" />
            <PanelBody>
              {!findings.length ? (
                <p className="text-sm text-fg-subtle">{running && detecting ? 'No hazards detected.' : 'Start a camera with a configured model to see hazards.'}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {findings.map((f) => (
                    <li key={f.key} className="flex items-center justify-between gap-3">
                      <span className="text-fg">
                        {HAZARDS[f.type].label} <span className="text-xs text-fg-subtle">· {REPORT_TYPE_LABEL[HAZARDS[f.type].kind]}</span>
                      </span>
                      {f.confirmed ? (
                        <span className="text-xs font-semibold text-critical">Confirmed</span>
                      ) : (
                        <span className="text-xs text-warning">Confirming {Math.round(f.progress * 100)}%</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Workers" description="Per-worker PPE compliance in the current frame" />
            <PanelBody>
              {!workers.length ? (
                <p className="text-sm text-fg-subtle">{running && ready ? 'No workers detected.' : 'Start a camera with a configured model to see workers.'}</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {workers.map((w) => (
                    <li key={w.trackId} className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
                      <p className="font-semibold text-fg">
                        W{w.trackId} <span className="font-normal text-fg-subtle">· person {Math.round(w.person.confidence * 100)}%</span>
                      </p>
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                        {required.map((t) => {
                          const s = w.ppe[t];
                          const pending = w.pending[t];
                          return (
                            <li key={t} className="flex justify-between gap-2">
                              <span className="text-fg-muted">{PPE_LABEL[t]}</span>
                              {s?.state === 'present' ? (
                                <span className="text-success">Compliant</span>
                              ) : w.confirmed.includes(t) ? (
                                <span className="font-semibold text-critical">Violation</span>
                              ) : (
                                <span className="text-warning">Missing · confirming {Math.round((pending ?? 0) * 100)}%</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Incidents from this session" description="Created automatically; duplicates within the cooldown are suppressed." />
            <PanelBody>
              {!log.length ? (
                <p className="text-sm text-fg-subtle">None yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {log.map((e, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', e.kind === 'created' ? 'text-critical' : e.kind === 'error' ? 'text-warning' : 'text-fg-subtle')} aria-hidden />
                      <span className="min-w-0 flex-1 text-fg-muted">
                        {e.text}
                        {e.reportId && (
                          <>
                            {' '}
                            · <Link to={`/app/reports/${e.reportId}`} className="text-fg hover:underline">open</Link>
                          </>
                        )}
                      </span>
                      <span className="shrink-0 text-2xs text-fg-subtle">{e.at.toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </div>

        {/* ---------------- configuration ---------------- */}
        <div className="flex min-w-0 flex-col gap-5">
          <Panel>
            <PanelHeader title="Camera" />
            <PanelBody className="flex flex-col gap-4">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" checked={cfg.autoStart} onChange={(e) => update({ autoStart: e.target.checked })} />
                <span>
                  Start automatically
                  <span className="block text-xs text-fg-muted">Camera and detection start when this page opens and reconnect by themselves.</span>
                </span>
              </label>
              <Field label="Camera name" hint={cfg.label ? undefined : 'Filled in automatically from the camera. You can rename it.'}>
                <Input value={cfg.label} maxLength={80} disabled={running} placeholder="Automatic" onChange={(e) => update({ label: e.target.value })} />
              </Field>
              <Field label="Installation" error={needInstallation && !cfg.installationId ? 'Required to start the camera.' : undefined}>
                <Select ref={installationRef} value={cfg.installationId} disabled={running} onChange={(e) => update({ installationId: e.target.value })}>
                  <option value="">Choose installation</option>
                  {installations.filter((i) => i.active).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Source">
                <Select value={cfg.source} disabled={running} onChange={(e) => update({ source: e.target.value as StationConfig['source'] })}>
                  <option value="device">This device’s camera (webcam / USB)</option>
                  <option value="back">Phone — back camera</option>
                  <option value="front">Phone — front camera</option>
                  <option value="stream">IP camera (stream URL)</option>
                </Select>
              </Field>
              {cfg.source === 'device' && (
                <Field label="Device" hint={devices.some((d) => d.label) ? undefined : 'Names appear after you allow camera access once.'}>
                  <Select value={cfg.deviceId} disabled={running} onChange={(e) => update({ deviceId: e.target.value })}>
                    <option value="">Default camera</option>
                    {devices.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {streamMode && (
                <>
                  <Field label="Stream URL" hint="MJPEG, MP4 or WebM over http(s). RTSP cameras need a gateway such as MediaMTX or go2rtc. The server must allow this site (CORS).">
                    <Input value={cfg.streamUrl} disabled={running} placeholder="https://camera-gateway.local/cam1.mjpg" onChange={(e) => update({ streamUrl: e.target.value })} />
                  </Field>
                  <Field label="Stream format">
                    <Select value={cfg.streamFormat} disabled={running} onChange={(e) => update({ streamFormat: e.target.value as 'video' | 'mjpeg' })}>
                      <option value="mjpeg">MJPEG (image stream)</option>
                      <option value="video">Video (MP4 / WebM / HLS on Safari)</option>
                    </Select>
                  </Field>
                </>
              )}
              <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                <Camera className="size-3" aria-hidden /> Camera ID <span className="font-mono">{cfg.cameraId}</span>
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Required PPE" description="Missing items are judged per worker, never detected as objects." />
            <PanelBody className="flex flex-col gap-2">
              {PPE_TYPES.map((t) => {
                const can = !ready || supported.includes(t);
                return (
                  <label key={t} className={cn('flex items-center justify-between gap-3 text-sm', !can && 'opacity-60')}>
                    <span className="flex items-center gap-2.5">
                      <Checkbox
                        checked={cfg.required.includes(t)}
                        disabled={running || !can}
                        onChange={(e) => update({ required: e.target.checked ? [...cfg.required, t] : cfg.required.filter((x) => x !== t) })}
                      />
                      {PPE_LABEL[t]}
                    </span>
                    {ready && !can && <Badge>Not in this model</Badge>}
                  </label>
                );
              })}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Hazard rules" description="Unsafe acts, unsafe conditions and near misses. Each needs a model that can see it." />
            <PanelBody className="flex flex-col gap-2">
              {HAZARD_TYPES.map((h) => {
                const can = !ready || hazardSupport.includes(h);
                const needsZone = can && !zoneFor(h);
                return (
                  <label key={h} className={cn('flex items-center justify-between gap-3 text-sm', !can && 'opacity-60')}>
                    <span className="flex items-center gap-2.5">
                      <Checkbox
                        checked={cfg.hazards.includes(h)}
                        disabled={running || !can}
                        onChange={(e) => update({ hazards: e.target.checked ? [...cfg.hazards, h] : cfg.hazards.filter((x) => x !== h) })}
                      />
                      <span>
                        {HAZARDS[h].label}
                        <span className="block text-2xs text-fg-subtle">{REPORT_TYPE_LABEL[HAZARDS[h].kind]}</span>
                      </span>
                    </span>
                    {ready && !can ? (
                      <Badge>Not in these models</Badge>
                    ) : needsZone && cfg.hazards.includes(h) ? (
                      <Badge>Draw a {HAZARDS[h].zone === 'danger' ? 'restricted' : 'keep-clear'} zone</Badge>
                    ) : null}
                  </label>
                );
              })}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Zones" description="Areas drawn on this camera's view: nobody may enter a restricted zone; nothing may stand in a keep-clear zone." />
            <PanelBody className="flex flex-col gap-3">
              {cfg.zones.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {cfg.zones.map((z) => (
                    <li key={z.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-fg">
                        {z.name} <span className="text-xs text-fg-subtle">· {ZONE_KIND_LABEL[z.kind]}</span>
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete zone ${z.name}`}
                        onClick={() => update({ zones: cfg.zones.filter((x) => x.id !== z.id) })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {draft ? (
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3">
                  <p className="text-xs text-fg-muted">
                    Click on the live view to place the zone's corners ({draft.length} placed; at least 3).
                  </p>
                  <Field label="Zone name">
                    <Input value={draftMeta.name} maxLength={60} placeholder="e.g. Crane swing area" onChange={(e) => setDraftMeta({ ...draftMeta, name: e.target.value })} />
                  </Field>
                  <Field label="Zone type">
                    <Select value={draftMeta.kind} onChange={(e) => setDraftMeta({ ...draftMeta, kind: e.target.value as ZoneKind })}>
                      <option value="danger">{ZONE_KIND_LABEL.danger}</option>
                      <option value="keep-clear">{ZONE_KIND_LABEL['keep-clear']}</option>
                    </Select>
                  </Field>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" disabled={draft.length < 3 || !draftMeta.name.trim()} onClick={saveZone}>
                      Save zone
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" disabled={!running} onClick={() => setDraft([])}>
                  <PenLine aria-hidden /> Draw a zone
                </Button>
              )}
              {!running && !draft && <p className="text-xs text-fg-subtle">Start the camera to draw on its view.</p>}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Detection rules" description="Confidence and multi-frame confirmation reduce false alarms." />
            <PanelBody className="grid grid-cols-2 gap-4">
              {setting('minConfidence', 'Min confidence', 0.05, '0.25–0.95')}
              {setting('confirmationFrames', 'Confirm frames', 1, 'Consecutive frames')}
              {setting('violationSeconds', 'Violation (s)', 0.5, 'Minimum duration')}
              {setting('incidentCooldownSeconds', 'Cooldown (s)', 30, 'Per camera and PPE type or hazard')}
              <Field label="Hazard confidence" hint="0.25–0.95, hazard models">
                <Input
                  type="number"
                  min={0.25}
                  max={0.95}
                  step={0.05}
                  value={cfg.hazardConfidence}
                  disabled={running}
                  onChange={(e) => update({ hazardConfidence: Math.min(0.95, Math.max(0.25, Number(e.target.value) || 0.25)) })}
                />
              </Field>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelBody className="flex items-start gap-3 text-xs text-fg-muted">
              <Cpu className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Frames are sent to the inference service at <span className="font-mono text-fg">{INFERENCE_URL || 'not set'}</span>. Only
                frames that confirm a violation or hazard are stored, as incident evidence.
              </span>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
