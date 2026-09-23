#!/usr/bin/env node
/**
 * Unit tests for the PPE compliance logic (functions/src/shared/ppe.ts) —
 * `npm run test:ppe`. Inputs are hand-built so the correct answer is known;
 * this checks the decoding, association and rule logic, not any model.
 */

import {
  ComplianceMonitor,
  DEFAULT_PPE_SETTINGS,
  IouTracker,
  associate,
  decodeYolov8,
  letterbox,
  supportedPpe,
} from '../functions/lib/shared/ppe.js';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `\n         ${detail}` : ''}`);
}
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

const CLASSES = ['person', 'helmet', 'vest'];
const person = (x1, y1, x2, y2, confidence = 0.9) => ({ label: 'person', confidence, box: { x1, y1, x2, y2 } });
const item = (label, x1, y1, x2, y2, confidence = 0.85) => ({ label, confidence, box: { x1, y1, x2, y2 } });

console.log('\n  1. YOLOv8 output decoding\n');
{
  // A 1280x720 frame letterboxed into 640: scale 0.5, padY 140.
  const lb = letterbox(1280, 720, 640);
  check('letterbox scale and padding', near(lb.scale, 0.5, 1e-6) && near(lb.padX, 0) && near(lb.padY, 140));

  const N = 4;
  const rows = 4 + CLASSES.length;
  const t = new Float32Array(rows * N);
  const put = (i, cx, cy, w, h, scores) => {
    t[i] = cx; t[N + i] = cy; t[2 * N + i] = w; t[3 * N + i] = h;
    scores.forEach((s, c) => (t[(4 + c) * N + i] = s));
  };
  // Candidate 0: person centred at model (320, 320), 100x200 → source (640, 360), 200x400.
  put(0, 320, 320, 100, 200, [0.92, 0.01, 0.02]);
  // Candidate 1: same person, slightly shifted, lower score → removed by NMS.
  put(1, 322, 318, 100, 200, [0.8, 0.01, 0.02]);
  // Candidate 2: helmet below the confidence threshold → dropped.
  put(2, 320, 230, 30, 20, [0.01, 0.4, 0.0]);
  // Candidate 3: vest.
  put(3, 320, 300, 60, 60, [0.05, 0.02, 0.77]);

  const dets = decodeYolov8(t, [1, rows, N], CLASSES, lb, 0.6);
  const p = dets.find((d) => d.label === 'person');
  check('keeps the person and the vest, drops the low-confidence helmet', dets.length === 2 && !!p && dets.some((d) => d.label === 'vest'), JSON.stringify(dets));
  check('NMS removed the duplicate person box', dets.filter((d) => d.label === 'person').length === 1);
  check('box mapped back to source pixels', p && near(p.box.x1, 540) && near(p.box.y1, 160) && near(p.box.x2, 740) && near(p.box.y2, 560), JSON.stringify(p?.box));
  let threw = false;
  try {
    decodeYolov8(t, [1, rows, N], ['person', 'helmet'], lb, 0.6);
  } catch {
    threw = true;
  }
  check('refuses a manifest whose classes do not match the model output', threw);
}

console.log('\n  2. Worker ↔ PPE association\n');
{
  const worker = person(100, 100, 200, 400);
  const helmetOnHead = item('helmet', 130, 80, 170, 120);
  const vestOnTorso = item('vest', 110, 180, 190, 290);
  let [w] = associate([worker, helmetOnHead, vestOnTorso], ['helmet', 'vest'], 0.6);
  check('helmet on the head and vest on the torso → both present', w.ppe.helmet?.state === 'present' && w.ppe.vest?.state === 'present');

  [w] = associate([worker, vestOnTorso], ['helmet', 'vest'], 0.6);
  check('no helmet detected → helmet missing (derived, not detected)', w.ppe.helmet?.state === 'missing' && w.ppe.helmet.confidence === null);

  [w] = associate([worker, item('helmet', 130, 330, 170, 370)], ['helmet'], 0.6);
  check('helmet at the worker’s feet (e.g. on the ground) does not count', w.ppe.helmet?.state === 'missing');

  [w] = associate([worker, item('helmet', 130, 80, 170, 120, 0.4)], ['helmet'], 0.6);
  check('helmet below the confidence threshold does not count', w.ppe.helmet?.state === 'missing');

  [w] = associate([worker, item('no_helmet', 130, 80, 170, 120, 0.99)], ['helmet'], 0.6);
  check('a "no_helmet" box is not treated as anything', w.ppe.helmet?.state === 'missing');

  const a = person(100, 100, 200, 400);
  const b = person(400, 100, 500, 400);
  const ws = associate([a, b, item('helmet', 430, 80, 470, 120)], ['helmet'], 0.6);
  check('a helmet is credited to the worker wearing it, not the other one', ws[0].ppe.helmet?.state === 'missing' && ws[1].ppe.helmet?.state === 'present');

  check('model support: harness is not claimed without a harness class', JSON.stringify(supportedPpe(['person', 'helmet', 'vest'])) === '["helmet","vest"]');
}

console.log('\n  3. Tracking\n');
{
  const tr = new IouTracker();
  const [id1] = tr.update([{ x1: 0, y1: 0, x2: 100, y2: 200 }], 0);
  const [id1b] = tr.update([{ x1: 5, y1: 2, x2: 104, y2: 203 }], 33);
  const ids = tr.update([{ x1: 8, y1: 4, x2: 108, y2: 205 }, { x1: 400, y1: 0, x2: 500, y2: 200 }], 66);
  check('same worker keeps the same id as they move', id1 === id1b && ids[0] === id1);
  check('a new worker gets a new id', ids[1] !== id1);
}

console.log('\n  4. Confirmation, de-duplication and cooldown\n');
{
  const settings = { ...DEFAULT_PPE_SETTINGS, confirmationFrames: 10, violationSeconds: 2, incidentCooldownSeconds: 300 };
  const m = new ComplianceMonitor(settings, ['helmet']);
  const noHelmet = [person(100, 100, 200, 400)];
  const withHelmet = [person(100, 100, 200, 400), item('helmet', 130, 80, 170, 120)];
  const events = [];
  let t = 0;
  const step = (dets, dt) => {
    t += dt;
    const r = m.update(dets, t);
    events.push(...r.events);
    return r;
  };

  for (let i = 0; i < 9; i++) step(noHelmet, 300); // 9 frames, 2.7 s
  check('9 frames missing is not enough (needs 10)', events.length === 0);

  const m2 = new ComplianceMonitor(settings, ['helmet']);
  let t2 = 0;
  let e2 = 0;
  for (let i = 0; i < 20; i++) e2 += m2.update(noHelmet, (t2 += 33)).events.length; // 20 frames in 0.66 s
  check('20 frames but under 2 seconds is not enough', e2 === 0);

  step(noHelmet, 300); // 10th frame, ≥ 2 s
  check('confirmed after 10 frames and 2 seconds → one violation event', events.length === 1 && events[0].type === 'helmet');

  for (let i = 0; i < 50; i++) step(noHelmet, 100);
  check('a continuing violation is never reported twice', events.length === 1);

  const r = step(withHelmet, 100);
  check('helmet put on → worker compliant again', r.workers[0].ppe.helmet?.state === 'present' && r.workers[0].confirmed.length === 0);

  for (let i = 0; i < 30; i++) step(noHelmet, 200); // violation again, within cooldown
  check('a new violation inside the cooldown does not create a second incident', events.length === 1);

  t += 300_000; // cooldown elapses
  step(withHelmet, 100);
  for (let i = 0; i < 30; i++) step(noHelmet, 200);
  check('after the cooldown a new violation is reported', events.length === 2);

  const m3 = new ComplianceMonitor(settings, ['helmet']);
  let t3 = 0;
  let e3 = 0;
  for (let i = 0; i < 25; i++) {
    const dets = i === 12 ? [] : noHelmet; // one frame without the person (detector flicker)
    e3 += m3.update(dets, (t3 += 150)).events.length;
  }
  check('one dropped person detection does not reset the confirmation', e3 === 1);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
