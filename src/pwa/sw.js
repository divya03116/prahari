/*
 * PRAHARI service worker — makes the app open without a connection.
 *
 * It caches the application itself (HTML, scripts, styles, icons, the
 * language files); the build fills in the list below. It never touches data:
 * requests to Firebase, the AI service and every other origin go straight to
 * the network, and reports filed offline wait in the page's own outbox
 * (src/offline/outbox.ts), not here.
 *
 * Each build gets its own cache. A new version installs in the background and
 * takes over when the person accepts the "new version" prompt or reopens the
 * app, so the HTML and the scripts it loads always belong to the same build.
 */

const VERSION = '__VERSION__';
const CACHE = `prahari-${VERSION}`;
const SHELL = '/index.html';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // The page itself must be there; without it nothing opens offline.
      await cache.add(new Request(SHELL, { cache: 'reload' }));
      // Everything else one by one, so a single failed file does not undo the rest;
      // anything missed is cached the first time it is used.
      await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)));
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('prahari-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Firebase Auth's own helper pages.
  if (url.pathname.startsWith('/__/')) return;

  // Every route is the same single page: serve it from the cache at once.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(SHELL, { ignoreVary: true }))
        .then((hit) => hit ?? fetch(request))
        .catch(() => fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // By address alone: these are static files, and a server's "Vary" header
      // (development servers and some CDNs add one) must not hide a cached copy.
      const hit = await cache.match(request, { ignoreVary: true });
      if (hit) return hit;
      const response = await fetch(request);
      // Files with a content hash in their name never change; keep them.
      if (response.ok && url.pathname.startsWith('/assets/')) cache.put(request, response.clone()).catch(() => undefined);
      return response;
    }),
  );
});
