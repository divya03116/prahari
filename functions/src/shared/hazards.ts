/**
 * Hazard rules beyond PPE — unsafe acts, unsafe conditions and near misses —
 * from what general-purpose models see: people and their posture (COCO,
 * COCO-pose), vehicles and everyday objects (COCO), fire and smoke (fire-v1).
 * Canonical source: functions/src/shared/ — synced into src/shared/.
 *
 * Like ppe.ts it is independent of any model or camera: detections go in;
 * per-frame findings and confirmed, de-duplicated events come out. Nothing is
 * claimed that the detections do not show: a "possible fall" is a person lying
 * down for seconds, a "near miss" is a person within reach of a vehicle that
 * is moving, a blocked exit is an object standing inside a keep-clear zone
 * someone drew.
 */

import type { ReportType } from './constants.js';
import { associate, IouTracker, PPE_LABEL, type Box, type Detection, type PpeType } from './ppe.js';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export const HAZARD_TYPES = [
  'restricted-zone',
  'vehicle-proximity',
  'person-down',
  'blocked-zone',
  'phone-use',
  'fire',
  'smoke',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

export type ZoneKind = 'danger' | 'keep-clear';

/** An area drawn on a camera view. Points are fractions (0..1) of the frame. */
export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  points: [number, number][];
}

export interface HazardInfo {
  label: string;
  kind: ReportType;
  /** A finding must persist this many frames AND seconds to be confirmed. */
  confirm: { frames: number; seconds: number };
  /** Rules that act inside zones need one of this kind drawn. */
  zone?: ZoneKind;
}

export const HAZARDS: Record<HazardType, HazardInfo> = {
  'restricted-zone': { label: 'Person in a restricted zone', kind: 'unsafe-act', confirm: { frames: 4, seconds: 2 }, zone: 'danger' },
  'vehicle-proximity': { label: 'Person close to a moving vehicle', kind: 'near-miss', confirm: { frames: 2, seconds: 0.5 } },
  'person-down': { label: 'Person on the ground (possible fall)', kind: 'near-miss', confirm: { frames: 4, seconds: 3 } },
  'blocked-zone': { label: 'Keep-clear area obstructed', kind: 'unsafe-condition', confirm: { frames: 4, seconds: 10 }, zone: 'keep-clear' },
  'phone-use': { label: 'Mobile phone in use', kind: 'unsafe-act', confirm: { frames: 4, seconds: 3 } },
  fire: { label: 'Fire', kind: 'unsafe-condition', confirm: { frames: 3, seconds: 1 } },
  smoke: { label: 'Smoke', kind: 'unsafe-condition', confirm: { frames: 4, seconds: 3 } },
};

/** COCO labels (plus common custom ones) the rules treat as vehicles. */
export const VEHICLE_CLASSES = ['car', 'truck', 'bus', 'motorcycle', 'train', 'forklift'];

/** Objects that must not stand in a walkway or in front of an exit. */
export const OBSTRUCTION_CLASSES = [
  'chair',
  'couch',
  'bench',
  'suitcase',
  'backpack',
  'handbag',
  'potted plant',
  'dining table',
  'bed',
  'refrigerator',
  'tv',
  'bicycle',
  'motorcycle',
  'car',
  'truck',
  'bus',
  'forklift',
  'box',
  'barrel',
];

/** A detection tagged with the model that produced it. */
export interface HazardDetection extends Detection {
  /** 'general' (COCO), 'pose' (COCO keypoints), 'fire', 'ppe'. */
  model?: string;
  /** COCO-17 keypoints [x, y, confidence] in frame pixels, from a pose model. */
  keypoints?: [number, number, number][];
}

export interface HazardSettings {
  minConfidence: number;
  incidentCooldownSeconds: number;
}

export const DEFAULT_HAZARD_SETTINGS: HazardSettings = { minConfidence: 0.5, incidentCooldownSeconds: 300 };

export interface Frame {
  width: number;
  height: number;
}

export interface Seen {
  label: string;
  confidence: number;
  box: Box;
}

/** What one frame shows, for the overlay (confirmed or still being confirmed). */
export interface HazardFinding {
  key: string;
  type: HazardType;
  box: Box;
  progress: number;
  confirmed: boolean;
  zoneId?: string;
}

export interface HazardEvent {
  /** De-duplication key: the type, or type + zone for zone rules. */
  key: string;
  type: HazardType;
  kind: ReportType;
  frames: number;
  seconds: number;
  subject: Seen;
  /** The vehicle for a near miss, the phone for phone use. */
  other?: Seen;
  zone?: { id: string; name: string; kind: ZoneKind };
  /** Objects inside a keep-clear zone. */
  objects?: string[];
  /** How a lying person was recognised. */
  method?: 'pose' | 'box';
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

const W = (b: Box) => b.x2 - b.x1;
const H = (b: Box) => b.y2 - b.y1;
const area = (b: Box) => Math.max(0, W(b)) * Math.max(0, H(b));

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Where a person or object stands: bottom-centre of its box. */
export const footPoint = (b: Box): [number, number] => [(b.x1 + b.x2) / 2, b.y2];

/** Ray casting; `pts` and the point share one coordinate system. */
export function pointInPolygon(x: number, y: number, pts: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inZone(b: Box, zone: Zone, frame: Frame): boolean {
  const [fx, fy] = footPoint(b);
  return zone.points.length >= 3 && pointInPolygon(fx / frame.width, fy / frame.height, zone.points);
}

/**
 * Is this person lying down? With pose keypoints: the torso (mid-hip to
 * mid-shoulder) leans more than 55° from vertical. Without: the box is much
 * wider than tall. Null when it cannot be judged.
 */
export function lyingDown(d: HazardDetection): { lying: boolean; method: 'pose' | 'box' } | null {
  const k = d.keypoints;
  if (k && k.length >= 13) {
    const ok = (i: number) => k[i][2] >= 0.4;
    if (ok(5) && ok(6) && ok(11) && ok(12)) {
      const sx = (k[5][0] + k[6][0]) / 2;
      const sy = (k[5][1] + k[6][1]) / 2;
      const hx = (k[11][0] + k[12][0]) / 2;
      const hy = (k[11][1] + k[12][1]) / 2;
      const angle = (Math.atan2(Math.abs(sx - hx), Math.abs(sy - hy)) * 180) / Math.PI;
      return { lying: angle > 55, method: 'pose' };
    }
  }
  if (H(d.box) <= 0) return null;
  return { lying: W(d.box) / H(d.box) >= 1.4, method: 'box' };
}

/** A person standing next to a vehicle (same ground line, gap under ~1 m). */
function nextTo(person: Box, vehicle: Box): boolean {
  const ph = H(person);
  if (ph <= 0) return false;
  // Someone inside the vehicle (driver, passenger) is not in its path.
  if (overlap(person, vehicle) / Math.max(1, area(person)) > 0.8) return false;
  const sameGround = Math.abs(person.y2 - vehicle.y2) < 0.35 * ph;
  const gap = Math.max(0, Math.max(person.x1, vehicle.x1) - Math.min(person.x2, vehicle.x2));
  return sameGround && gap < 0.6 * ph;
}

/** A phone held by this person: its centre at hand or face height, within reach. */
function holding(person: Box, phone: Box): boolean {
  const cx = (phone.x1 + phone.x2) / 2;
  const cy = (phone.y1 + phone.y2) / 2;
  const w = W(person);
  return cx >= person.x1 - 0.1 * w && cx <= person.x2 + 0.1 * w && cy >= person.y1 && cy <= person.y1 + 0.75 * H(person);
}

/** The people in a frame: pose model first, then the general model, then the PPE model. */
export function pickPeople(dets: readonly HazardDetection[], minConfidence: number): HazardDetection[] {
  const people = dets.filter((d) => d.label === 'person' && d.confidence >= minConfidence);
  for (const model of ['pose', 'general', 'ppe']) {
    const own = people.filter((d) => d.model === model);
    if (own.length) return own;
  }
  return people.filter((d) => !d.model);
}

const seen = (d: Detection): Seen => ({ label: d.label, confidence: Number(d.confidence.toFixed(4)), box: d.box });

/* ------------------------------------------------------------------ *
 * What the loaded models can support
 * ------------------------------------------------------------------ */

export function supportedHazards(classes: readonly string[], keypoints: boolean): HazardType[] {
  const has = (l: string) => classes.includes(l);
  const person = has('person') || keypoints;
  return HAZARD_TYPES.filter((t) => {
    switch (t) {
      case 'restricted-zone':
        return person;
      case 'vehicle-proximity':
        return person && VEHICLE_CLASSES.some(has);
      case 'person-down':
        return person;
      case 'blocked-zone':
        return OBSTRUCTION_CLASSES.some(has);
      case 'phone-use':
        return person && has('cell phone');
      case 'fire':
        return has('fire');
      case 'smoke':
        return has('smoke');
    }
  });
}

/* ------------------------------------------------------------------ *
 * Live monitoring: confirmation and de-duplication
 * ------------------------------------------------------------------ */

interface Streak {
  frames: number;
  since: number;
  lastSeen: number;
  reported: boolean;
}

/** Findings survive brief detection gaps; hazard models often run at 2–3 fps. */
const STREAK_GRACE_MS = 2500;
/** How far back vehicle motion is measured. */
const MOTION_WINDOW_MS = 1500;

export class HazardMonitor {
  private streaks = new Map<string, Streak>();
  private lastReported = new Map<string, number>();
  private readonly people = new IouTracker(0.3, 10);
  private readonly vehicles = new IouTracker(0.2, 10);
  private readonly motion = new Map<number, { t: number; cx: number; cy: number; w: number }[]>();

  constructor(
    private settings: HazardSettings,
    private enabled: HazardType[],
    private zones: Zone[],
  ) {}

  configure(settings: HazardSettings, enabled: HazardType[], zones: Zone[]): void {
    this.settings = settings;
    this.enabled = enabled;
    this.zones = zones;
    this.streaks.clear();
  }

  markReported(key: string, at: number): void {
    this.lastReported.set(key, at);
  }

  /** Is this tracked vehicle moving? Box centre or size changing faster than 15% of its width per second. */
  private moving(id: number, box: Box, now: number): boolean {
    const hist = (this.motion.get(id) ?? []).filter((p) => now - p.t <= MOTION_WINDOW_MS);
    hist.push({ t: now, cx: (box.x1 + box.x2) / 2, cy: (box.y1 + box.y2) / 2, w: W(box) });
    this.motion.set(id, hist);
    const first = hist[0];
    const dt = (now - first.t) / 1000;
    if (dt < 0.4) return false;
    const w = Math.max(1, W(box));
    const shift = Math.hypot(hist[hist.length - 1].cx - first.cx, hist[hist.length - 1].cy - first.cy);
    const grow = Math.abs(hist[hist.length - 1].w - first.w);
    return shift / dt > 0.15 * w || grow / dt > 0.15 * w;
  }

  update(dets: readonly HazardDetection[], frame: Frame, now: number): { findings: HazardFinding[]; events: HazardEvent[] } {
    const min = this.settings.minConfidence;
    const on = (t: HazardType) => this.enabled.includes(t);
    const people = pickPeople(dets, min);
    const personIds = this.people.update(
      people.map((p) => p.box),
      now,
    );
    const vehicles = dets.filter((d) => VEHICLE_CLASSES.includes(d.label) && d.confidence >= min);
    const vehicleIds = this.vehicles.update(
      vehicles.map((v) => v.box),
      now,
    );
    const movingVehicle = vehicles.map((v, i) => this.moving(vehicleIds[i], v.box, now));
    for (const id of [...this.motion.keys()]) if (!vehicleIds.includes(id)) this.motion.delete(id);

    // Everything this frame shows, before confirmation.
    const raw: { key: string; cooldown: string; type: HazardType; event: Omit<HazardEvent, 'frames' | 'seconds' | 'key' | 'kind'>; zoneId?: string }[] = [];

    people.forEach((p, i) => {
      const id = personIds[i];
      if (on('restricted-zone')) {
        for (const z of this.zones) {
          if (z.kind !== 'danger' || !inZone(p.box, z, frame)) continue;
          raw.push({
            key: `restricted-zone:${id}:${z.id}`,
            cooldown: `restricted-zone:${z.id}`,
            type: 'restricted-zone',
            zoneId: z.id,
            event: { type: 'restricted-zone', subject: seen(p), zone: { id: z.id, name: z.name, kind: z.kind } },
          });
        }
      }
      if (on('person-down')) {
        const lying = lyingDown(p);
        if (lying?.lying) {
          raw.push({ key: `person-down:${id}`, cooldown: 'person-down', type: 'person-down', event: { type: 'person-down', subject: seen(p), method: lying.method } });
        }
      }
      if (on('vehicle-proximity')) {
        vehicles.forEach((v, vi) => {
          if (!movingVehicle[vi] || !nextTo(p.box, v.box)) return;
          raw.push({
            key: `vehicle-proximity:${id}:${vehicleIds[vi]}`,
            cooldown: 'vehicle-proximity',
            type: 'vehicle-proximity',
            event: { type: 'vehicle-proximity', subject: seen(p), other: seen(v) },
          });
        });
      }
      if (on('phone-use')) {
        const phone = dets.find((d) => d.label === 'cell phone' && d.confidence >= min && holding(p.box, d.box));
        if (phone) raw.push({ key: `phone-use:${id}`, cooldown: 'phone-use', type: 'phone-use', event: { type: 'phone-use', subject: seen(p), other: seen(phone) } });
      }
    });

    if (on('blocked-zone')) {
      const objects = dets.filter((d) => OBSTRUCTION_CLASSES.includes(d.label) && d.confidence >= min);
      for (const z of this.zones) {
        if (z.kind !== 'keep-clear') continue;
        const inside = objects.filter((o) => inZone(o.box, z, frame));
        if (!inside.length) continue;
        const biggest = [...inside].sort((a, b) => area(b.box) - area(a.box))[0];
        raw.push({
          key: `blocked-zone:${z.id}`,
          cooldown: `blocked-zone:${z.id}`,
          type: 'blocked-zone',
          zoneId: z.id,
          event: { type: 'blocked-zone', subject: seen(biggest), zone: { id: z.id, name: z.name, kind: z.kind }, objects: [...new Set(inside.map((o) => o.label))] },
        });
      }
    }

    for (const t of ['fire', 'smoke'] as const) {
      if (!on(t)) continue;
      const hits = dets.filter((d) => d.label === t && d.confidence >= min);
      if (!hits.length) continue;
      const strongest = [...hits].sort((a, b) => b.confidence - a.confidence)[0];
      raw.push({ key: t, cooldown: t, type: t, event: { type: t, subject: seen(strongest) } });
    }

    // Confirmation over frames and seconds; one event per continuing finding;
    // cooldown per type (or type + zone) whatever the tracker ids do.
    const findings: HazardFinding[] = [];
    const events: HazardEvent[] = [];
    for (const r of raw) {
      const prev = this.streaks.get(r.key);
      // A finding that went away for longer than the grace period starts afresh.
      const s = prev && now - prev.lastSeen <= STREAK_GRACE_MS ? prev : { frames: 0, since: now, lastSeen: now, reported: false };
      s.frames++;
      s.lastSeen = now;
      this.streaks.set(r.key, s);
      const seconds = (now - s.since) / 1000;
      const need = HAZARDS[r.type].confirm;
      const progress = Math.min(1, s.frames / need.frames, seconds / need.seconds);
      findings.push({ key: r.key, type: r.type, box: r.event.subject.box, progress, confirmed: progress >= 1, zoneId: r.zoneId });
      if (progress < 1 || s.reported) continue;
      s.reported = true;
      const last = this.lastReported.get(r.cooldown);
      if (last !== undefined && now - last < this.settings.incidentCooldownSeconds * 1000) continue;
      this.lastReported.set(r.cooldown, now);
      events.push({ ...r.event, key: r.cooldown, kind: HAZARDS[r.type].kind, frames: s.frames, seconds });
    }
    for (const [key, s] of this.streaks) if (now - s.lastSeen > STREAK_GRACE_MS) this.streaks.delete(key);
    return { findings, events };
  }
}

/* ------------------------------------------------------------------ *
 * Worker photos: one picture, no tracking
 * ------------------------------------------------------------------ */

export type PhotoFindingType = Exclude<HazardType, 'restricted-zone' | 'blocked-zone'> | 'missing-ppe';

export interface PhotoFinding {
  type: PhotoFindingType;
  kind: ReportType;
  /** One factual clause, e.g. "a worker without a safety helmet (person 88%)". */
  text: string;
  confidence: number;
}

/** Most serious first: this decides the report type when a photo shows several things. */
const PHOTO_ORDER: PhotoFindingType[] = ['fire', 'person-down', 'vehicle-proximity', 'smoke', 'missing-ppe', 'phone-use'];

const pct = (c: number) => `${Math.round(c * 100)}%`;

/**
 * Reads one worker photo. Without motion, a person beside a vehicle is an
 * unsafe act (standing in its path), not a near miss; zone rules do not apply.
 */
export function analysePhoto(
  dets: readonly HazardDetection[],
  opts: { minConfidence: number; requiredPpe: PpeType[]; ppeMinConfidence: number },
): { findings: PhotoFinding[]; type: ReportType | null; description: string } {
  const min = opts.minConfidence;
  const found: PhotoFinding[] = [];

  for (const t of ['fire', 'smoke'] as const) {
    const best = dets.filter((d) => d.label === t && d.confidence >= min).sort((a, b) => b.confidence - a.confidence)[0];
    if (best) found.push({ type: t, kind: 'unsafe-condition', confidence: best.confidence, text: `${t} (${pct(best.confidence)})` });
  }

  const people = pickPeople(dets, min);
  const down = people.map((p) => ({ p, l: lyingDown(p) })).filter((x) => x.l?.lying);
  if (down.length) {
    const c = Math.max(...down.map((x) => x.p.confidence));
    found.push({
      type: 'person-down',
      kind: 'near-miss',
      confidence: c,
      text: `${down.length === 1 ? 'a person' : `${down.length} people`} lying on the ground — possible fall (person ${pct(c)})`,
    });
  }

  const vehicles = dets.filter((d) => VEHICLE_CLASSES.includes(d.label) && d.confidence >= min);
  const close = people.flatMap((p) => vehicles.filter((v) => nextTo(p.box, v.box)).map((v) => ({ p, v })));
  if (close.length) {
    const { p, v } = close.sort((a, b) => b.v.confidence - a.v.confidence)[0];
    found.push({
      type: 'vehicle-proximity',
      kind: 'unsafe-act',
      confidence: Math.min(p.confidence, v.confidence),
      text: `a person within reach of a ${v.label} (person ${pct(p.confidence)}, ${v.label} ${pct(v.confidence)})`,
    });
  }

  if (opts.requiredPpe.length) {
    const ppeDets = dets.filter((d) => d.model === 'ppe' || !d.model);
    const workers = associate(ppeDets, opts.requiredPpe, opts.ppeMinConfidence);
    const missing = new Map<PpeType, number>();
    for (const w of workers) for (const t of opts.requiredPpe) if (w.ppe[t]?.state === 'missing') missing.set(t, (missing.get(t) ?? 0) + 1);
    if (missing.size) {
      const items = [...missing.keys()].map((t) => PPE_LABEL[t].toLowerCase()).join(' and ');
      const n = Math.max(...missing.values());
      const c = Math.max(...workers.map((w) => w.person.confidence));
      found.push({ type: 'missing-ppe', kind: 'unsafe-act', confidence: c, text: `${n === 1 ? 'a worker' : `${n} workers`} without the required ${items} (person ${pct(c)})` });
    }
  }

  const phones = dets.filter((d) => d.label === 'cell phone' && d.confidence >= min);
  const onPhone = people.find((p) => phones.some((ph) => holding(p.box, ph.box)));
  if (onPhone) {
    const ph = phones.find((x) => holding(onPhone.box, x.box))!;
    found.push({ type: 'phone-use', kind: 'unsafe-act', confidence: ph.confidence, text: `a person using a mobile phone (phone ${pct(ph.confidence)})` });
  }

  found.sort((a, b) => PHOTO_ORDER.indexOf(a.type) - PHOTO_ORDER.indexOf(b.type));
  if (!found.length) return { findings: [], type: null, description: '' };
  const list = found.map((f) => f.text);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join('; ')}; and ${list[list.length - 1]}`;
  return {
    findings: found,
    type: found[0].kind,
    description: `Photo check found ${joined}.`,
  };
}

/** A factual incident narrative for a confirmed camera hazard. */
export function describeHazard(e: Omit<HazardEvent, 'kind'>, camera: string, modelNames: string): string {
  const conf = (s: Seen) => `${s.label} ${pct(s.confidence)}`;
  const over = `Confirmed over ${e.frames} frames (${e.seconds.toFixed(1)} s) by ${modelNames}.`;
  switch (e.type) {
    case 'restricted-zone':
      return `Camera "${camera}" detected a person inside the restricted zone "${e.zone?.name ?? 'Not specified'}" (${conf(e.subject)}). ${over}`;
    case 'vehicle-proximity':
      return `Camera "${camera}" detected a person within about a metre of a moving ${e.other?.label ?? 'vehicle'} — a near miss in the vehicle's path (${conf(e.subject)}${e.other ? `, ${conf(e.other)}` : ''}). ${over}`;
    case 'person-down':
      return `Camera "${camera}" detected a person lying on the ground — possible fall; check on the worker (${conf(e.subject)}, judged from ${e.method === 'pose' ? 'body pose' : 'body shape'}). ${over}`;
    case 'blocked-zone':
      return `Camera "${camera}" detected the keep-clear area "${e.zone?.name ?? 'Not specified'}" obstructed by ${(e.objects ?? [e.subject.label]).join(', ')} (${conf(e.subject)}). ${over}`;
    case 'phone-use':
      return `Camera "${camera}" detected a person using a mobile phone (${conf(e.subject)}${e.other ? `, ${conf(e.other)}` : ''}). ${over}`;
    case 'fire':
      return `Camera "${camera}" detected fire (${conf(e.subject)}). ${over}`;
    case 'smoke':
      return `Camera "${camera}" detected smoke (${conf(e.subject)}). ${over}`;
  }
}
