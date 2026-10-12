/**
 * Starts the server code with whatever FIREBASE_SERVICE_ACCOUNT it was given and
 * prints how it took it. scripts/vercel-test.mjs runs this once per kind of key:
 * the key is read when the server starts, so each case needs its own process.
 * It contacts nothing — a call with no sign-in is refused before any lookup.
 */

import { createRequire } from 'node:module';

const { credentialProblem } = await import('../../functions/lib/lib/core.js');
const { callFunction } = await import('../../functions/lib/vercel.js');
// firebase-admin belongs to functions/, not to the web app.
const { getApp } = createRequire(new URL('../../functions/package.json', import.meta.url))('firebase-admin/app');

const call = await callFunction('submitReport', { method: 'POST', headers: {}, body: { data: {} } });
console.log(JSON.stringify({ problem: credentialProblem, project: getApp().options.credential?.projectId ?? null, call }));
