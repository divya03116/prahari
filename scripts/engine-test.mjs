/**
 * Engine fixtures — `npm run test:engine`.
 *
 * Each fixture asserts a tier. The tier is the contract; the score is shown so
 * a weight change that shifts the distribution is visible even when every
 * fixture still passes.
 *
 * The last two matter most. If a routine housekeeping report and a live
 * hydrocarbon release land in the same band, the engine is worthless — a queue
 * that flags everything gets ignored, and an ignored queue is more dangerous
 * than no queue at all.
 */

import { analyse, ENGINE_VERSION } from '../functions/lib/shared/engine.js';

const FIXTURES = [
  {
    name: 'Confined space entry, no gas test, no standby',
    tier: 1,
    approx: 92,
    text: 'During maintenance activity, worker entered confined space without gas testing. No standby person was present.',
  },
  {
    name: 'Code-mixed: gas leak with degraded isolation, personnel nearby',
    tier: 1,
    approx: 70,
    language: 'Hindi (romanised)',
    text: 'Gas leak hua, isolation proper nahi tha, aas paas do log kaam kar rahe the.',
  },
  {
    name: 'Hydrocarbon release with hot work open nearby',
    tier: 1,
    text: 'Gas leak reported at the wellhead flange. A hot work permit was open 18 metres away and no gas test had been done before the welding started. Nobody was hurt.',
  },
  {
    name: 'BOP interlock bypassed, helper under a suspended load',
    tier: 1,
    text: 'BOP panel interlock was found bypassed during the tour. A helper was standing under a suspended load at the time. No injury occurred.',
  },
  {
    name: 'Work at height without harness, degraded guard-rail, raining',
    tier: 1,
    text: 'Night shift. A contract fitter was working at 3.5 metres height on a scaffold without a harness. The guard-rail was loose and it was raining. He was standing directly above the deck where two men were working.',
  },
  {
    name: 'Guard removed from a rotating coupling, fitter beside it (rule-net escalation)',
    tier: 1,
    escalated: true,
    text: 'The guard had been removed from the rotating pump coupling so it could be greased while the pump was still running. A fitter was working beside it.',
  },
  {
    name: 'Scaffold tag expired, toe-board damaged, nobody on it',
    tier: 2,
    text: 'The scaffold tag had expired and the toe-board was damaged. Nobody was working on it at the time.',
  },
  {
    name: 'Forklift reversing with no banksman',
    tier: 2,
    text: 'A forklift was reversing in the yard with no banksman and a fitter was walking close behind it.',
  },
  {
    // Regression: an early build scored this Tier 3 because bare "load" and
    // "lift" were not in the gravity vocabulary, so a rigger standing under a
    // suspended load read as routine. Exactly the miss the product exists to
    // prevent, so it is pinned here.
    name: 'Toolbox talk skipped, rigger under the load',
    tier: 1,
    text: 'Toolbox talk was skipped before the lift. The rigger stood underneath the load while it was being positioned.',
  },
  {
    // Regression: scored 2 (Tier 3) until "wireline"/"tripping" were energy
    // terms and "no combined JSA" was a barrier. Simultaneous operations with
    // no combined risk assessment is a textbook precursor, and the engine was
    // reading it as an empty sentence.
    name: 'SIMOPS with no combined JSA',
    tier: 2,
    text: 'SIMOPS: wireline job running while the workover rig was tripping. No combined JSA was raised for the two crews.',
  },
  {
    // Regression: a protective system left in manual is a control that has been
    // switched off. Scored 2 until "manual mode" counted as a defeated barrier.
    name: 'Fire water pump left in manual after testing',
    tier: 3,
    escalated: false,
    text: 'Fire water pump found in manual mode after the monthly test. Not restored to auto for two days.',
  },
  {
    // Regression: the danda (।) that ends Assamese sentences lives in the
    // Devanagari Unicode block, so two full stops outvoted zero Latin
    // characters and a pure Assamese report was labelled Hindi.
    name: 'Assamese narrative, Bengali script',
    tier: 1,
    language: 'Assamese / Bengali',
    text: 'ৰাতিৰ শ্বিফটত ভাল্ভ খোলাৰ সময়ত গেছ লিক হয়। আইছোলেচন ঠিকে নাছিল, ওচৰত দুজন লোকে কাম কৰি আছিল।',
  },
  {
    // Regression, and the worst miss found so far: this scored 32 (Tier 3).
    // "Isolation had not been proven" was not a barrier, "residual pressure" and
    // "gas detected" were not energy, and — the sharpest one — "two technicians"
    // did not match while "a technician" did, so a report describing MORE people
    // exposed scored LOWER than one describing a single person.
    name: 'Hydrocarbon release, isolation unproven, technicians present',
    tier: 1,
    text: 'Hydrocarbon release from the pig launcher door seal during the launch. Isolation had not been proven and two technicians were standing at the launcher.',
  },
  {
    name: 'Routine housekeeping, no stored energy',
    tier: 3,
    text: 'Poor housekeeping in the workshop. Litter on the floor and some paperwork left near the walkway. Cleaning was completed the same morning.',
  },
];

let failed = 0;
const pad = (s, n) => String(s).padEnd(n);

console.log(`\n  PRAHARI engine v${ENGINE_VERSION} — ${FIXTURES.length} fixtures\n`);
console.log(`  ${pad('', 5)}${pad('score', 7)}${pad('tier', 8)}${pad('E/B/X', 26)}name`);
console.log(`  ${'-'.repeat(104)}`);

for (const f of FIXTURES) {
  const r = analyse(f.text);
  const tierOk = r.tier === f.tier;
  const escOk = f.escalated === undefined || r.escalated === f.escalated;
  const langOk = f.language === undefined || r.language.primary === f.language;
  const ok = tierOk && escOk && langOk;
  if (!ok) failed++;

  const ebx = `${r.energy[0]?.id ?? '—'}/${r.barrier[0]?.id ?? '—'}/${r.exposure[0]?.id ?? '—'}`;
  console.log(
    `  ${pad(ok ? 'ok' : 'FAIL', 5)}${pad(r.score, 7)}${pad(`T${r.tier}/T${f.tier}`, 8)}${pad(ebx, 26)}${f.name}`,
  );

  if (!ok) {
    console.log(`       language  ${r.language.primary} (wanted ${f.language})`);
    console.log(`       escalated ${r.escalated} (wanted ${f.escalated})`);
    console.log(`       rules     ${r.rulesTriggered.map((x) => x.code).join(', ') || '—'}`);
    console.log(
      `       breakdown ${r.contributions.map((c) => `${c.label} ${c.amount > 0 ? '+' : ''}${c.amount}`).join(' | ')}`,
    );
  }
}

// The scale has to separate, not just rank.
const routine = analyse(FIXTURES[FIXTURES.length - 1].text).score;
const critical = analyse(FIXTURES[0].text).score;
const spread = critical - routine;
console.log(`\n  discrimination: routine ${routine} vs critical ${critical} (spread ${spread})`);
if (spread < 50) {
  console.log('  FAIL the engine does not separate routine from critical');
  failed++;
}

console.log('');
if (failed) {
  console.error(`  ${failed} check(s) failed.\n`);
  process.exit(1);
}
console.log(`  All ${FIXTURES.length} fixtures landed on the expected tier.\n`);
