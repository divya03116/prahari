#!/usr/bin/env node
/**
 * Unit tests for the hazard rules (functions/src/shared/hazards.ts) —
 * `npm run test:hazards`. Inputs are hand-built so the right answer is known;
 * this checks the rule logic, not any model.
 */

import {
  analysePhoto,
  describeHazard,
  HazardMonitor,
  lyingDown,
  pickPeople,
  pointInPolygon,
  supportedHazards,
} from '../functions/lib/shared/hazards.js';
import { structureReport } from '../functions/lib/shared/structure.js';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `\n         ${detail}` : ''}`);
}

const det = (label, x1, y1, x2, y2, confidence = 0.9, model = 'general', extra = {}) => ({
  label,
  confidence,
  model,
  box: { x1, y1, x2, y2 },
  ...extra,
});
const FRAME = { width: 1000, height: 600 };
const SETTINGS = { minConfidence: 0.5, incidentCooldownSeconds: 300 };
const ALL = ['restricted-zone', 'vehicle-proximity', 'person-down', 'blocked-zone', 'phone-use', 'fire', 'smoke'];
const DANGER = { id: 'z1', name: 'Crane swing area', kind: 'danger', points: [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]] };
const CLEAR = { id: 'z2', name: 'Fire exit', kind: 'keep-clear', points: [[0, 0.5], [0.3, 0.5], [0.3, 1], [0, 1]] };

/** Feeds the same detections for `seconds` at `fps`; returns all events. */
function run(mon, frames, fps, seconds, t0 = 0) {
  const events = [];
  let last = null;
  for (let i = 0; i <= seconds * fps; i++) {
    const now = t0 + (i * 1000) / fps;
    const dets = typeof frames === 'function' ? frames(i, now) : frames;
    last = mon.update(dets, FRAME, now);
    events.push(...last.events);
  }
  return { events, last };
}

console.log('\n  1. Geometry and what the models can support\n');
check('point in polygon (inside, outside)', pointInPolygon(0.7, 0.7, DANGER.points) && !pointInPolygon(0.2, 0.2, DANGER.points));
check(
  'people: pose model preferred over the general and PPE models',
  pickPeople([det('person', 0, 0, 10, 10, 0.9, 'ppe'), det('person', 0, 0, 10, 10, 0.9, 'pose')], 0.5).every((p) => p.model === 'pose'),
);
check(
  'supported rules follow the loaded classes',
  JSON.stringify(supportedHazards(['person', 'car', 'cell phone', 'chair'], false)) ===
    JSON.stringify(['restricted-zone', 'vehicle-proximity', 'person-down', 'blocked-zone', 'phone-use']) &&
    JSON.stringify(supportedHazards(['fire', 'smoke'], false)) === JSON.stringify(['fire', 'smoke']),
);

console.log('\n  2. Posture\n');
const upright = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [100, 100, 0.9], [140, 100, 0.9], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [105, 200, 0.9], [135, 200, 0.9]];
const lying = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [100, 300, 0.9], [100, 330, 0.9], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [220, 305, 0.9], [220, 335, 0.9]];
check('pose: upright torso is not lying', lyingDown(det('person', 90, 80, 150, 400, 0.9, 'pose', { keypoints: upright })).lying === false);
check('pose: horizontal torso is lying', lyingDown(det('person', 80, 280, 400, 360, 0.9, 'pose', { keypoints: lying })).lying === true);
check('no keypoints: a wide person box counts as lying', lyingDown(det('person', 0, 400, 300, 480)).method === 'box' && lyingDown(det('person', 0, 400, 300, 480)).lying);

console.log('\n  3. Live rules: confirmation, zones, motion, cooldown\n');
{
  const mon = new HazardMonitor(SETTINGS, ALL, [DANGER]);
  const inZone = [det('person', 700, 300, 780, 560)]; // feet at (740, 560) -> (0.74, 0.93): inside
  const { events } = run(mon, inZone, 3, 1.5);
  check('restricted zone: not confirmed before 2 s', events.length === 0);
  const more = run(mon, inZone, 3, 2, 1600).events;
  check('restricted zone: confirmed once after 2 s', more.length === 1 && more[0].type === 'restricted-zone' && more[0].zone.name === 'Crane swing area' && more[0].kind === 'unsafe-act');
  check('restricted zone: key includes the zone', more[0]?.key === 'restricted-zone:z1');
  const again = run(mon, inZone, 3, 5, 4000).events;
  check('a continuing finding is reported once', again.length === 0);
}
{
  const mon = new HazardMonitor(SETTINGS, ALL, [DANGER]);
  const outside = [det('person', 100, 100, 180, 400)]; // feet at (0.14, 0.67): outside
  check('restricted zone: a person outside is fine', run(mon, outside, 3, 5).events.length === 0);
}
{
  const mon = new HazardMonitor(SETTINGS, ALL, []);
  // A truck rolling past (50 px/s) with a worker standing right beside it.
  const frames = (i) => [det('person', 520, 200, 580, 400), det('truck', 240, 105 + i * 10, 500, 360 + i * 10)];
  const { events } = run(mon, frames, 5, 2);
  const nm = events.find((e) => e.type === 'vehicle-proximity');
  check('near miss: person beside a moving truck', !!nm && nm.kind === 'near-miss' && nm.other.label === 'truck');
}
{
  const mon = new HazardMonitor(SETTINGS, ALL, []);
  const parked = [det('person', 520, 200, 580, 400), det('truck', 250, 150, 510, 405)];
  check('no near miss beside a parked truck', run(mon, parked, 5, 3).events.every((e) => e.type !== 'vehicle-proximity'));
  const driver = [det('person', 300, 180, 360, 300), det('truck', 250, 150, 510, 405)];
  check('the driver inside the vehicle is not a near miss', run(new HazardMonitor(SETTINGS, ALL, []), (i) => [driver[0], det('truck', 250 + i * 12, 150, 510 + i * 12, 405)], 5, 3).events.every((e) => e.type !== 'vehicle-proximity'));
}
{
  const mon = new HazardMonitor(SETTINGS, ALL, []);
  const down = [det('person', 300, 480, 620, 560, 0.85, 'pose', { keypoints: lying.map(([x, y, c]) => [x + 200, y + 200, c]) })];
  const { events } = run(mon, down, 3, 4);
  check('person down for 3 s is a near miss (pose)', events.length === 1 && events[0].type === 'person-down' && events[0].method === 'pose');
}
{
  const mon = new HazardMonitor(SETTINGS, ALL, [CLEAR]);
  const chair = [det('chair', 100, 450, 200, 590)]; // foot (0.15, 0.98): inside the keep-clear zone
  const { events } = run(mon, chair, 2, 11);
  check('blocked exit after 10 s is an unsafe condition', events.length === 1 && events[0].type === 'blocked-zone' && events[0].objects[0] === 'chair' && events[0].kind === 'unsafe-condition');
}
{
  const mon = new HazardMonitor(SETTINGS, ALL, []);
  const fire = [det('fire', 400, 100, 600, 300, 0.82, 'fire')];
  const { events } = run(mon, fire, 3, 1.5);
  check('fire confirmed within about a second', events.length === 1 && events[0].type === 'fire');
  const weak = new HazardMonitor(SETTINGS, ALL, []);
  check('below the confidence threshold nothing happens', run(weak, [det('fire', 400, 100, 600, 300, 0.3, 'fire')], 3, 5).events.length === 0);
}
{
  const mon = new HazardMonitor(SETTINGS, ['fire'], []);
  const fire = [det('fire', 400, 100, 600, 300, 0.82, 'fire')];
  run(mon, fire, 3, 2);
  run(mon, [], 3, 4, 3000); // fire gone: the finding ends
  check('a new fire inside the cooldown is not reported again', run(mon, fire, 3, 3, 8000).events.length === 0);
  check('after the cooldown it is reported again', run(mon, fire, 3, 3, 8000 + 301_000).events.length === 1);
}
{
  const mon = new HazardMonitor(SETTINGS, ['smoke'], []);
  check('rules that are switched off stay silent', run(mon, [det('fire', 400, 100, 600, 300, 0.9, 'fire')], 3, 5).events.length === 0);
}
{
  const mon = new HazardMonitor(SETTINGS, ALL, []);
  const phone = [det('person', 400, 100, 520, 500), det('cell phone', 470, 180, 500, 230, 0.7)];
  const { events } = run(mon, phone, 3, 4);
  check('phone at a person’s face for 3 s is an unsafe act', events.some((e) => e.type === 'phone-use' && e.kind === 'unsafe-act'));
}

console.log('\n  4. Worker photos\n');
{
  const ppe = (label, x1, y1, x2, y2, c = 0.85) => det(label, x1, y1, x2, y2, c, 'ppe');
  const r = analysePhoto(
    [det('fire', 50, 50, 200, 200, 0.88, 'fire'), ppe('person', 400, 100, 520, 500, 0.9), ppe('vest', 410, 200, 510, 350, 0.8)],
    { minConfidence: 0.5, requiredPpe: ['helmet', 'vest'], ppeMinConfidence: 0.6 },
  );
  check('fire decides the report type (most serious first)', r.type === 'unsafe-condition' && r.findings[0].type === 'fire');
  check('missing helmet is listed too', r.findings.some((f) => f.type === 'missing-ppe' && /helmet/.test(f.text)));
  check('description states what was seen', /^Photo check found fire \(88%\)/.test(r.description), r.description);
  const none = analysePhoto([ppe('person', 400, 100, 520, 500), ppe('helmet', 430, 90, 490, 150), ppe('vest', 410, 200, 510, 350)], {
    minConfidence: 0.5,
    requiredPpe: ['helmet', 'vest'],
    ppeMinConfidence: 0.6,
  });
  check('a compliant worker: nothing found, nothing invented', none.type === null && none.findings.length === 0);
}

console.log('\n  5. Narrative and structuring\n');
{
  const e = {
    key: 'restricted-zone:z1',
    type: 'restricted-zone',
    kind: 'unsafe-act',
    frames: 7,
    seconds: 2.4,
    subject: { label: 'person', confidence: 0.91, box: { x1: 0, y1: 0, x2: 1, y2: 1 } },
    zone: { id: 'z1', name: 'Crane swing area', kind: 'danger' },
  };
  const text = describeHazard(e, 'Yard camera', 'the general-coco model');
  check('camera narrative names the camera, zone and evidence', /Yard camera/.test(text) && /Crane swing area/.test(text) && /7 frames \(2\.4 s\)/.test(text), text);
  const s = structureReport({ text, source: 'camera', camera: { label: 'Yard camera' }, hazard: { type: 'restricted-zone' } });
  check('camera hazard structured exactly', s.title === 'Person in a restricted zone — Yard camera' && s.hazardType === 'Unauthorised entry', JSON.stringify(s));
  const p = structureReport({ text: 'Photo check found a worker without the required safety helmet (person 88%).', source: 'photo' });
  check('photo text: missing helmet is PPE non-compliance', p.hazardType === 'PPE non-compliance', JSON.stringify(p));
  const f = structureReport({ text: 'Photo check found a person lying on the ground — possible fall (person 81%).', source: 'photo' });
  check('photo text: person down is a fall', f.hazardType === 'Slip / trip / fall', JSON.stringify(f));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
