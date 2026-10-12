#!/usr/bin/env node
/**
 * Lets phones use the AI service running on this computer — start-ai-for-phones.bat.
 *
 * A hosted HTTPS page may call http://127.0.0.1 only on the computer it is
 * opened on. This gives the local service (ai/inference_service/server.py) a
 * public HTTPS address through a Cloudflare quick tunnel — no account needed —
 * then points the website at it and rebuilds the site. The address is new each
 * time, which is why the site is rebuilt on every start (about two minutes).
 *
 * It works only while this window stays open. Anyone who has the address can
 * send pictures to the detector for as long as it does; the service still
 * answers browsers only from the origins in PPE_ALLOWED_ORIGINS. For an
 * always-on service, publish the Space instead (publish-ai.bat).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SITE = 'prahari-silk.vercel.app';
const LOCAL = 'http://127.0.0.1:8765';
const CLOUDFLARED = process.env.CLOUDFLARED || 'E:\\dev-cache\\cloudflared\\cloudflared.exe';

const vercel = (args, input) =>
  spawnSync('npx.cmd', ['--yes', 'vercel@59', ...args], { input, encoding: 'utf8', shell: true });

if (!existsSync(CLOUDFLARED)) {
  console.error(`\n  Cloudflare Tunnel was not found at ${CLOUDFLARED}.\n  Download cloudflared-windows-amd64.exe from https://github.com/cloudflare/cloudflared/releases and put it there.\n`);
  process.exit(1);
}
if (!(await fetch(`${LOCAL}/v1/health`).then((r) => r.ok).catch(() => false))) {
  console.error('\n  The AI service is not running on this computer. Start it first (start-ai.bat).\n');
  process.exit(1);
}

console.log('  Opening a secure address for the AI service…');
const tunnel = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', LOCAL], { stdio: ['ignore', 'ignore', 'pipe'] });
const url = await new Promise((resolve, reject) => {
  let log = '';
  tunnel.stderr.on('data', (chunk) => {
    log += chunk;
    const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log);
    if (found) resolve(found[0]);
  });
  tunnel.on('exit', () => reject(new Error(`the tunnel stopped:\n${log.slice(-600)}`)));
  setTimeout(() => reject(new Error('no address after a minute')), 60_000);
}).catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
console.log(`  ${url}`);

// The address takes a few seconds to start answering.
let reachable = false;
for (let i = 0; i < 20 && !reachable; i++) {
  reachable = await fetch(`${url}/v1/health`).then((r) => r.ok).catch(() => false);
  if (!reachable) await new Promise((r) => setTimeout(r, 2000));
}
if (!reachable) {
  console.error('\n  The address did not start answering. Close this window and try again.\n');
  tunnel.kill();
  process.exit(1);
}

console.log('  Pointing the website at it and rebuilding (about two minutes)…');
vercel(['env', 'rm', 'VITE_PPE_INFERENCE_URL', 'production', '--yes']);
const added = vercel(['env', 'add', 'VITE_PPE_INFERENCE_URL', 'production'], url);
if (added.status !== 0) {
  console.error(`\n  Vercel did not accept the setting:\n${(added.stderr || '').slice(-400)}\n`);
  tunnel.kill();
  process.exit(1);
}
const rebuilt = vercel(['redeploy', SITE, '--target', 'production']);
if (rebuilt.status !== 0) {
  console.error(`\n  The rebuild did not finish:\n${(rebuilt.stderr || '').slice(-400)}\n`);
  tunnel.kill();
  process.exit(1);
}

console.log(`\n  Ready. On the phone, open https://${SITE}, go to Monitoring and tap Re-check.`);
console.log('  Keep this window open: closing it switches the phone AI off.\n');
tunnel.on('exit', () => {
  console.log('  The tunnel stopped. Run start-ai-for-phones.bat again.');
  process.exit(1);
});
