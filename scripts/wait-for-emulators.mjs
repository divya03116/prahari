#!/usr/bin/env node
/**
 * Waits until the local emulator suite can actually serve the app: Auth,
 * Firestore and Storage answering, and the Cloud Functions loaded (a callable
 * returns 401 for "no token" instead of 404 "no such function").
 * Used by start-local.bat; exits non-zero after 4 minutes (or at once with --once).
 */

const CHECKS = [
  ['Auth', () => fetch('http://127.0.0.1:9099/')],
  ['Firestore', () => fetch('http://127.0.0.1:8085/')],
  ['Storage', () => fetch('http://127.0.0.1:9199/')],
  [
    'Functions',
    async () => {
      const r = await fetch('http://127.0.0.1:5001/demo-prahari/us-central1/submitReport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"data":{}}',
      });
      if (r.status === 404) throw new Error('functions not loaded yet');
      return r;
    },
  ],
];

// --once: a single check, no waiting (exit 0 = everything is already up).
const once = process.argv.includes('--once');
const deadline = Date.now() + 4 * 60 * 1000;
const pending = new Set(CHECKS.map(([name]) => name));
if (!once) process.stdout.write('  Waiting for the Firebase emulators');

while (pending.size) {
  for (const [name, check] of CHECKS) {
    if (!pending.has(name)) continue;
    try {
      await check();
      pending.delete(name);
    } catch {
      /* not up yet */
    }
  }
  if (!pending.size) break;
  if (once) process.exit(1);
  if (Date.now() > deadline) {
    console.error(`\n  Timed out waiting for: ${[...pending].join(', ')}. Check the emulator window for errors.`);
    process.exit(1);
  }
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 2000));
}
if (!once) console.log(' ready.');
