#!/usr/bin/env node
/**
 * Seeds the LOCAL EMULATOR with a working register — `npm run seed`.
 * Emulator hosts are forced in scripts/lib/emulator.mjs; this cannot touch a
 * real project.
 *
 * What it does, and why it is not "fake data" for the product:
 *   - Creates four verified accounts, one per role, with the role claim and
 *     profile exactly as setUserRole writes them.
 *   - Creates installations and activities (reference data).
 *   - Files ~30 back-dated narratives in the exact shape submitReport writes,
 *     with status 'pending'. It writes NO scores: the real scoreReport trigger
 *     assesses every one, opens the corrective actions and maintains the
 *     roll-ups. Back-dating is the only reason these are not filed through the
 *     callable — a 30-day trend needs 30 days of history.
 *   - Files two of today's reports through the real submitReport callable,
 *     one with a photo attachment, to exercise the whole path end to end.
 *   - Records officer verdicts and closes actions through the real
 *     recordVerdict / updateAction callables, so the audit log and training
 *     labels are produced by the service layer itself.
 *
 * Names are generic on purpose. No real company, site or person is implied.
 */

import {
  assertEmulatorsUp,
  auth,
  bucket,
  callOk,
  db,
  signIn,
  sleep,
  Timestamp,
  tinyPng,
} from './lib/emulator.mjs';

const PASSWORD = 'Prahari-demo-1';

const ACCOUNTS = [
  { key: 'admin', email: 'admin@prahari.test', name: 'Anita Rao', role: 'admin' },
  { key: 'officer', email: 'officer@prahari.test', name: 'Rahul Menon', role: 'hse-officer' },
  { key: 'manager', email: 'manager@prahari.test', name: 'Sunita Das', role: 'installation-manager' },
  { key: 'reviewer', email: 'reviewer@prahari.test', name: 'Imran Shaikh', role: 'reviewer' },
];

const INSTALLATIONS = [
  ['north-gathering', 'North Field Gathering Station', 'NFGS', 'North field'],
  ['gas-compression', 'Gas Compression Plant', 'GCP-1', 'Central'],
  ['crude-unit-2', 'Crude Distillation Unit 2', 'CDU-2', 'Refinery'],
  ['tank-farm-a', 'Tank Farm A', 'TF-A', 'Refinery'],
  ['rig-17', 'Drilling Rig R-17', 'R-17', 'South field'],
  ['workover-w11', 'Workover Unit W-11', 'W-11', 'South field'],
  ['pipeline-sec7', 'Trunk Pipeline Section 7', 'PL-7', 'Pipeline'],
  ['product-terminal', 'Product Terminal', 'PT', 'Coastal'],
];

const ACTIVITIES = [
  ['hot-work', 'Hot work', 'HW', 'Permit'],
  ['confined-space', 'Confined space entry', 'CSE', 'Permit'],
  ['lifting', 'Lifting operation', 'LIFT', 'Mechanical'],
  ['work-at-height', 'Work at height', 'WAH', 'Access'],
  ['electrical', 'Electrical maintenance', 'ELEC', 'Maintenance'],
  ['pipeline-maint', 'Pipeline maintenance', 'PLM', 'Maintenance'],
  ['drilling', 'Drilling', 'DRL', 'Operations'],
  ['well-servicing', 'Well servicing', 'WS', 'Operations'],
  ['transport', 'Transport and logistics', 'TRN', 'Logistics'],
  ['housekeeping', 'Housekeeping and civil', 'CIV', 'General'],
];

/* [ narrative, installation, activity, shift, type, daysAgo ] */
const REPORTS = [
  ['During maintenance activity, worker entered confined space without gas testing. No standby person was present.', 'north-gathering', 'confined-space', 'Day', 'unsafe-act', 0],
  ['Housekeeping poor near the pipe rack. Scrap and empty drums lying around. Cleared by the shift crew same morning.', 'crude-unit-2', 'housekeeping', 'Day', 'unsafe-condition', 0],
  ['BOP panel interlock was found bypassed during the tour. A helper was standing under a suspended load at the time. No injury occurred.', 'rig-17', 'drilling', 'Day', 'unsafe-condition', 1],
  ['Night shift. A contract fitter was working at 3.5 metres height on a scaffold without a harness. The guard-rail was loose and it was raining. He was standing directly above the deck where two men were working.', 'crude-unit-2', 'work-at-height', 'Night', 'unsafe-act', 1],
  ['TBT was skipped before the lift. The rigger stood underneath the load while the crane operator positioned it over the skid.', 'rig-17', 'lifting', 'Day', 'unsafe-act', 2],
  ['MCC panel found open with a live cable exposed. System had not been isolated, no LOTO applied, and the technician was working alone on night shift.', 'tank-farm-a', 'electrical', 'Night', 'unsafe-condition', 2],
  ['Guard had been removed from the rotating pump coupling on P-101B so it could be greased while the pump was still running. A fitter was working beside it.', 'north-gathering', 'well-servicing', 'Day', 'unsafe-act', 3],
  ['Gas leak hua, isolation proper nahi tha, aas paas do log kaam kar rahe the.', 'north-gathering', 'pipeline-maint', 'Day', 'near-miss', 3],
  ['Forklift was reversing near the warehouse gate with no banksman. A fitter was walking close behind it.', 'product-terminal', 'transport', 'Day', 'unsafe-act', 4],
  ['Scaffold tag on the S-12 access tower had expired and the toe-board was damaged. Nobody was working on it at the time.', 'crude-unit-2', 'work-at-height', 'Day', 'unsafe-condition', 4],
  ['Acid transfer line leaking at the joint and the bund was full. Two operators were working near it without face protection.', 'gas-compression', 'pipeline-maint', 'Day', 'unsafe-condition', 5],
  ['SIMOPS: wireline job running while the workover rig was tripping. No combined JSA was raised for the two crews.', 'workover-w11', 'well-servicing', 'Day', 'unsafe-condition', 5],
  ['ৰাতিৰ শ্বিফটত ভাল্ভ খোলাৰ সময়ত গেছ লিক হয়। আইছোলেচন ঠিকে নাছিল, ওচৰত দুজন লোকে কাম কৰি আছিল।', 'north-gathering', 'pipeline-maint', 'Night', 'near-miss', 6],
  ['Spark arrestor missing on the diesel generator parked next to the condensate tank farm. Hot work permit was live in the same area.', 'gas-compression', 'hot-work', 'Day', 'unsafe-condition', 6],
  ['Isolation valve XV-4412 found in the open position after the LOTO was supposedly applied. Line was still charged when the fitter broke the flange.', 'north-gathering', 'pipeline-maint', 'Day', 'near-miss', 8],
  ['Mast raising done without clearing the area. Two roustabouts were inside the drop zone.', 'rig-17', 'drilling', 'Day', 'unsafe-act', 9],
  ['बिना परमिट के वेल्डिंग शुरू कर दी, पास में तेल की लाइन थी।', 'pipeline-sec7', 'hot-work', 'Day', 'unsafe-act', 10],
  ['Ladder was not secured at the top and the operator was leaning out sideways to reach the gauge on V-2103.', 'tank-farm-a', 'work-at-height', 'Day', 'unsafe-act', 11],
  ['H2S detector at the separator area found with an expired calibration sticker. Reading could not be trusted during the shift handover.', 'gas-compression', 'well-servicing', 'Day', 'unsafe-condition', 12],
  ['Hydrocarbon release from the pig launcher door seal during the launch. Isolation had not been proven and two technicians were standing at the launcher.', 'pipeline-sec7', 'pipeline-maint', 'Day', 'near-miss', 13],
  ['Tong operator had his hand inside the bite while making up the connection on the drill floor. Driller stopped the job.', 'rig-17', 'drilling', 'Night', 'unsafe-act', 14],
  ['Chemical drums stored without secondary containment behind the workshop. Labels faded, contents not identifiable.', 'tank-farm-a', 'housekeeping', 'Day', 'unsafe-condition', 15],
  ['Line was opened before the isolation was verified. Small hydrocarbon release at the flange, crew withdrew. No injury.', 'north-gathering', 'pipeline-maint', 'Day', 'near-miss', 17],
  ['Blind was not fitted after draining. Residual pressure released when the spool was removed. Two men at the work front.', 'north-gathering', 'pipeline-maint', 'Day', 'near-miss', 19],
  ['PTW closed but the isolation list was not signed back. Gas detected at the joint while the fitter was still on the line.', 'north-gathering', 'pipeline-maint', 'Night', 'near-miss', 21],
  ['Hot work started adjacent to a line that had not been proven free of hydrocarbon. Gas test was done before the break but not repeated after the delay.', 'north-gathering', 'hot-work', 'Day', 'unsafe-act', 23],
  ['Crane outrigger pad placed on soft ground near the trench edge. The crane listed during the lift with a slinger standing alongside.', 'pipeline-sec7', 'lifting', 'Day', 'unsafe-condition', 24],
  ['Vehicle entered the plant without a spark arrestor and was driven up to the process area.', 'gas-compression', 'transport', 'Day', 'unsafe-act', 25],
  ['Grating removed from the walkway on the 2nd level and not barricaded. Floor opening left overnight.', 'crude-unit-2', 'housekeeping', 'Night', 'unsafe-condition', 26],
  ['Fire water pump found in manual mode after the monthly test. Not restored to auto for two days.', 'tank-farm-a', 'electrical', 'Day', 'unsafe-condition', 27],
  ['Stationery and old files stacked in the corridor outside the control room. Cleared same day.', 'product-terminal', 'housekeeping', 'Day', 'unsafe-condition', 28],
  ['Slinger used a damaged webbing sling with visible cuts to lift the BOP test stump. Load was over personnel walkway.', 'rig-17', 'lifting', 'Day', 'unsafe-act', 29],
];

/* Filed live through submitReport, today. */
const LIVE = [
  ['PTW-2291 open for hot work at the wellhead. Gas leak noticed at the 6" flange joint approx 18 m from the welding set. No gas test done after the line was opened. Nobody hurt.', 'north-gathering', 'hot-work', 'Day', 'near-miss', false],
  ['Scaffold third lift missing toe boards, fitter working directly below. Photo attached.', 'tank-farm-a', 'work-at-height', 'Day', 'unsafe-condition', true],
];

const COLLECTIONS_TO_WIPE = ['reports', 'actions', 'heat', 'stats', 'labels', 'auditLogs', 'rateLimits', 'installations', 'activities', 'users'];

async function wipe() {
  let n = 0;
  for (const col of COLLECTIONS_TO_WIPE) {
    const snap = await db.collection(col).get();
    let batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      n++;
      if (++inBatch === 400) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch) await batch.commit();
  }
  await bucket.deleteFiles({ prefix: 'attachments/' }).catch(() => undefined);
  return n;
}

async function ensureAccount(a, installationId) {
  let user;
  try {
    user = await auth.getUserByEmail(a.email);
    await auth.updateUser(user.uid, { password: PASSWORD, displayName: a.name, emailVerified: true, disabled: false });
  } catch {
    user = await auth.createUser({ email: a.email, password: PASSWORD, displayName: a.name, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { role: a.role });
  await db.collection('users').doc(user.uid).set({
    email: a.email,
    displayName: a.name,
    role: a.role,
    installationId: a.role === 'installation-manager' ? installationId : null,
    disabled: false,
    createdAt: Timestamp.fromMillis(Date.now() - 45 * 86_400_000),
    lastSeenAt: Timestamp.now(),
  });
  return user.uid;
}

async function waitForScoring(expected, timeoutMs = 90_000) {
  const start = Date.now();
  for (;;) {
    const pending = await db.collection('reports').where('status', '==', 'pending').count().get();
    const total = await db.collection('reports').count().get();
    if (total.data().count >= expected && pending.data().count === 0) return;
    if (Date.now() - start > timeoutMs) throw new Error(`${pending.data().count} report(s) still pending after ${timeoutMs / 1000}s — is the functions emulator running with eventarc?`);
    await sleep(1000);
  }
}

async function run() {
  await assertEmulatorsUp();

  // --if-empty: used by start-local.bat so relaunching never wipes your data.
  if (process.argv.includes('--if-empty') && !(await db.collection('users').limit(1).get()).empty) {
    console.log('\n  The emulator already has data - skipping the seed.\n');
    return;
  }
  console.log('\n  Seeding the local emulator (project demo-prahari)\n');

  const cleared = await wipe();
  if (cleared) console.log(`  cleared     ${cleared} existing document(s)`);

  /* reference data */
  const now = Timestamp.now();
  const batch = db.batch();
  for (const [id, name, code, region] of INSTALLATIONS) {
    batch.set(db.collection('installations').doc(id), { name, code, region, active: true, createdAt: now, updatedAt: now });
  }
  for (const [id, name, code, region] of ACTIVITIES) {
    batch.set(db.collection('activities').doc(id), { name, code, region, active: true, createdAt: now, updatedAt: now });
  }
  await batch.commit();
  const instName = Object.fromEntries(INSTALLATIONS.map(([id, name]) => [id, name]));
  const actName = Object.fromEntries(ACTIVITIES.map(([id, name]) => [id, name]));
  console.log(`  reference   ${INSTALLATIONS.length} installations · ${ACTIVITIES.length} activities`);

  /* accounts */
  const uid = {};
  for (const a of ACCOUNTS) {
    uid[a.key] = await ensureAccount(a, 'north-gathering');
    console.log(`  account     ${a.email.padEnd(24)} ${a.role}`);
  }

  /* back-dated history, scored by the real trigger */
  const reporters = [uid.reviewer, uid.manager, uid.officer, uid.reviewer];
  const filed = [];
  for (const [i, [text, inst, act, shift, type, daysAgo]] of REPORTS.entries()) {
    const created = Timestamp.fromMillis(Date.now() - daysAgo * 86_400_000 - ((i * 7919) % 6) * 3_600_000);
    const ref = db.collection('reports').doc();
    await ref.set({
      text,
      installationId: inst,
      installationName: instName[inst],
      activityId: act,
      activityName: actName[act],
      shift,
      type,
      contractor: /contract/i.test(text),
      attachments: [],
      status: 'pending',
      reportedBy: reporters[i % reporters.length],
      archived: false,
      verdictDecision: null,
      createdAt: created,
    });
    filed.push({ id: ref.id, daysAgo });
  }
  console.log(`  history     ${filed.length} reports filed as 'pending' across 30 days`);

  /* two live reports through the real callable, one with an attachment */
  const reviewer = await signIn('reviewer@prahari.test', PASSWORD);
  for (const [text, inst, act, shift, type, withPhoto] of LIVE) {
    const reportId = db.collection('reports').doc().id;
    const attachments = [];
    if (withPhoto) {
      const path = `attachments/${reviewer.uid}/${reportId}/scaffold-photo.png`;
      await bucket.file(path).save(tinyPng(), { contentType: 'image/png' });
      attachments.push({ path, name: 'scaffold-photo.png', size: tinyPng().length, contentType: 'image/png' });
    }
    await callOk(
      'submitReport',
      { reportId, text, installationId: inst, activityId: act, shift, type, contractor: false, attachments },
      reviewer.token,
    );
  }
  console.log(`  live        ${LIVE.length} reports filed through submitReport (1 with an attachment)`);

  console.log('  waiting     for the scoring trigger…');
  await waitForScoring(REPORTS.length + LIVE.length);

  /* review history through the real callables */
  const officer = await signIn('officer@prahari.test', PASSWORD);
  let verdicts = 0;
  let closed = 0;
  let progressed = 0;
  for (const { id, daysAgo } of filed) {
    const r = (await db.collection('reports').doc(id).get()).data();
    if (r.status !== 'scored') continue;
    if (daysAgo >= 8) {
      const decision = r.tier === 3 ? 'dismissed' : r.score >= 85 ? 'escalated' : 'confirmed';
      const note =
        decision === 'escalated'
          ? 'Reviewed on site. Agreed, raised with the installation manager.'
          : decision === 'dismissed'
            ? 'Housekeeping item. Logged for trend; no action opened.'
            : 'Confirmed at the morning review. Controls reinstated.';
      await callOk('recordVerdict', { reportId: id, decision, note }, officer.token);
      verdicts++;
    }
    const acts = await db.collection('actions').where('reportId', '==', id).orderBy('order').get();
    for (const [n, a] of acts.docs.entries()) {
      if (daysAgo >= 12 && n < acts.size - 1) {
        await callOk('updateAction', { actionId: a.id, status: 'closed', note: 'Verified in place at the follow-up walk.' }, officer.token);
        closed++;
      } else if (daysAgo >= 3 && daysAgo < 12 && n === 0) {
        await callOk('updateAction', { actionId: a.id, status: 'in_progress', note: 'Work order raised.' }, officer.token);
        progressed++;
      }
    }
  }
  console.log(`  review      ${verdicts} verdicts · ${closed} actions closed · ${progressed} in progress (via callables)`);

  const count = async (c) => (await db.collection(c).count().get()).data().count;
  const [reports, actions, heat, stats, labels, audit] = await Promise.all(
    ['reports', 'actions', 'heat', 'stats', 'labels', 'auditLogs'].map(count),
  );
  const failed = (await db.collection('reports').where('status', '==', 'failed').count().get()).data().count;
  console.log(`\n  ${reports} reports (${failed} failed) · ${actions} actions · ${heat} heat cells · ${stats} daily stats · ${labels} labels · ${audit} audit entries`);
  console.log(`\n  Sign in with any of the accounts above, password: ${PASSWORD}\n`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n  Seeding failed:', err.message, '\n');
    process.exit(1);
  });
