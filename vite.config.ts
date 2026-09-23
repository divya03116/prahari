import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

interface HostingHeader {
  key: string;
  value: string;
}

/**
 * The production security headers live in firebase.json (Firebase Hosting).
 * `vite preview` serves the very same set, so a production build can be
 * tested locally with the real Content-Security-Policy enforced. Against the
 * emulators the only change is allowing their local origins.
 */
function hostingHeaders(useEmulators: boolean): Record<string, string> {
  const firebase = JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'));
  const all: HostingHeader[] = firebase.hosting.headers.find((h: { source: string }) => h.source === '**').headers;
  const out: Record<string, string> = {};
  for (const { key, value } of all) {
    if (key === 'Strict-Transport-Security') continue; // meaningless over http://127.0.0.1
    out[key] = value;
  }
  if (useEmulators) {
    // + the local PPE inference service (ai/inference_service, port 8765)
    const local = 'http://127.0.0.1:9099 http://127.0.0.1:8085 http://127.0.0.1:5001 http://127.0.0.1:9199 http://127.0.0.1:8765';
    out['Content-Security-Policy'] = out['Content-Security-Policy']
      .replace('; upgrade-insecure-requests', '')
      .replace("connect-src 'self'", `connect-src 'self' ${local}`)
      .replace("img-src 'self'", "img-src 'self' http://127.0.0.1:9199")
      .replace('frame-src', 'frame-src http://127.0.0.1:9099');
  }
  return out;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // strictPort: if 5173 is taken, fail loudly rather than drift to 5174,
    // where the bookmarked address would no longer find the app.
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, headers: hostingHeaders(env.VITE_USE_EMULATORS === 'true') },
    build: {
      target: 'es2022',
      sourcemap: false,
      // The Firebase 12 Auth + Firestore core (with the persistent cache) is
      // ~790 kB minified / ~196 kB gzip and cannot be split further; every
      // other chunk is far under this budget.
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          // Vendor code changes on a different cadence to ours; separate chunks
          // keep a UI change from invalidating the cached Firebase SDK.
          // firebase/functions and firebase/storage are deliberately absent:
          // they are imported dynamically on first write/upload, so the first
          // page load never downloads them.
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            react: ['react', 'react-dom', 'react-router-dom'],
            ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tooltip', 'sonner'],
            forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          },
        },
      },
    },
  };
});
