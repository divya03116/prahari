/**
 * Helpers shared by the seed and test scripts. EMULATOR ONLY.
 *
 * The emulator hosts are forced here — not defaulted — so the Admin SDK in
 * these scripts can never reach a real project, whatever is in the caller's
 * environment.
 */

import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

export const PROJECT = 'demo-prahari';
export const REGION = 'asia-south1';
export const HOSTS = {
  auth: '127.0.0.1:9099',
  firestore: '127.0.0.1:8085',
  storage: '127.0.0.1:9199',
  functions: '127.0.0.1:5001',
};
export const BUCKET = `${PROJECT}.appspot.com`;

process.env.FIRESTORE_EMULATOR_HOST = HOSTS.firestore;
process.env.FIREBASE_AUTH_EMULATOR_HOST = HOSTS.auth;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = HOSTS.storage;
process.env.GCLOUD_PROJECT = PROJECT;

// firebase-admin is a functions/ dependency, never a web-app one: resolve it
// from there so no server SDK enters the front-end dependency tree.
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, getApps } = require('firebase-admin/app');
const firestore = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

if (!getApps().length) initializeApp({ projectId: PROJECT, storageBucket: BUCKET });

export const db = firestore.getFirestore();
export const { Timestamp, FieldValue } = firestore;
export const auth = getAuth();
export const bucket = getStorage().bucket(BUCKET);

export const AUTH_REST = `http://${HOSTS.auth}/identitytoolkit.googleapis.com/v1`;
export const FS_REST = `http://${HOSTS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents`;
export const STORAGE_REST = `http://${HOSTS.storage}/v0/b/${BUCKET}/o`;

export async function assertEmulatorsUp() {
  const checks = [
    [`http://${HOSTS.auth}/`, 'Auth'],
    [`http://${HOSTS.firestore}/`, 'Firestore'],
    [`http://${HOSTS.functions}/`, 'Functions'],
    [`http://${HOSTS.storage}/`, 'Storage'],
  ];
  for (const [url, name] of checks) {
    try {
      await fetch(url);
    } catch {
      console.error(`\n  The ${name} emulator is not reachable at ${url}. Start the suite first:\n\n    npm run emulators\n`);
      process.exit(1);
    }
  }
}

/** Signs in through the Auth emulator's REST API, as a browser would. */
export async function signIn(email, password) {
  const r = await fetch(`${AUTH_REST}/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(j.error ?? j)}`);
  return { token: j.idToken, uid: j.localId };
}

/** Invokes a callable the way the web SDK does (POST {data}, Bearer token). */
export async function callFn(name, data, token) {
  const r = await fetch(`http://${HOSTS.functions}/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, result: j.result, error: j.error };
}

export async function callOk(name, data, token) {
  const res = await callFn(name, data, token);
  if (res.status !== 200) throw new Error(`${name} failed: ${res.error?.status} ${res.error?.message}`);
  return res.result;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A real 32×24 PNG (signal-orange), generated rather than shipped, for attachment tests. */
export function tinyPng() {
  const w = 32;
  const h = 24;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  const rows = [];
  for (let y = 0; y < h; y++) {
    rows.push(Buffer.from([0]));
    for (let x = 0; x < w; x++) rows.push(Buffer.from([0xf2, 0x6b, 0x2a]));
  }
  const idat = deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
