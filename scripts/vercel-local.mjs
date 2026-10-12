#!/usr/bin/env node
/**
 * Runs the Vercel functions (api/) on this machine.
 *
 * Vercel hands a Node function a request with `query` and `body`, and a
 * response with `status()` and `json()`. This file supplies those four things
 * around the real handlers, so what runs here is the code that is deployed.
 * `npm run test:vercel` uses it; it can also be run on its own:
 *
 *   firebase emulators:start --only auth,firestore,storage --project demo-prahari
 *   node scripts/vercel-local.mjs
 *   npm run seed && npm run test:e2e
 *
 * Run like that it listens where the Functions emulator would (port 5001) and
 * answers both address shapes — /api/fn/<name> and the emulator's
 * /<project>/<region>/<name> — so the seed and the browser tests exercise the
 * Vercel route without being changed.
 *
 * That route has no Firestore triggers: a report is scored by the request that
 * files it (functions/src/vercel.ts). The seed back-dates reports by writing
 * them directly, so the stand-in also scores any report still pending a while
 * after it was written.
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const ROUTE = /^\/(?:api\/fn|[^/]+\/[^/]+)\/([^/]+)$/;

/** Set the environment the server code should see before calling this: it is read on first import. */
export async function serveApi(port = 0) {
  const { default: callable } = await import('../api/fn/[name].js');
  const { default: health } = await import('../api/health.js');

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    // The dev server is another origin. On Vercel the app and /api share one, and no such header is sent.
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }

    let raw = '';
    for await (const chunk of req) raw += chunk;
    // Like Vercel's: parsed on first access, throws on malformed JSON.
    Object.defineProperty(req, 'body', { get: () => (raw ? JSON.parse(raw) : undefined) });
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (value) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(value));
    };

    try {
      const name = ROUTE.exec(pathname)?.[1];
      if (pathname === '/api/health') {
        req.query = {};
        await health(req, res);
      } else if (name) {
        req.query = { name: decodeURIComponent(name) };
        await callable(req, res);
      } else {
        res.status(404).json({ error: 'Not found' });
      }
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'The function crashed.' });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Forces the emulator hosts: this can never reach a real project.
  const { db, HOSTS, sleep } = await import('./lib/emulator.mjs');
  const { url } = await serveApi(Number(HOSTS.functions.split(':')[1]));
  const { scoreReport } = await import('../functions/lib/triggers/scoreReport.js');
  console.log(`\n  The Vercel functions are answering at ${url} (in place of the Functions emulator).\n`);

  const WAIT_MS = 15_000; // far longer than a request takes to score its own report
  for (;;) {
    await sleep(2000);
    const pending = await db.collection('reports').where('status', '==', 'pending').get().catch(() => null);
    for (const doc of pending?.docs ?? []) {
      if (Date.now() - doc.createTime.toMillis() < WAIT_MS) continue;
      await scoreReport.run({ data: doc, params: { reportId: doc.id } });
    }
  }
}
