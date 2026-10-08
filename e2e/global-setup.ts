import { readFileSync } from 'node:fs';

/**
 * The Functions emulator starts a separate worker for each function the first
 * time it is called. On a small machine that takes up to half a minute —
 * longer than a test waits for a dialog to close — so the first test to use a
 * function nothing else has called yet fails on the cold start, not on the app.
 *
 * Call every callable once before the tests. No sign-in: the answer is
 * "unauthenticated", but the worker stays warm. One at a time, so memory use
 * stays flat. Already-warm workers answer in milliseconds, and if the
 * emulators are not running the tests themselves say so.
 */
export default async function warmFunctions(): Promise<void> {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const region = /FUNCTIONS_REGION = '([^']+)'/.exec(read('../functions/src/shared/constants.ts'))?.[1];
  const names = [...read('../functions/src/index.ts').matchAll(/export \{([^}]+)\} from '\.\/callables\//g)].flatMap((m) =>
    m[1].split(',').map((s) => s.trim()).filter(Boolean),
  );
  if (!region || !names.length) throw new Error('Could not read the function names or region from functions/src.');

  for (const name of names) {
    await fetch(`http://127.0.0.1:5001/demo-prahari/${region}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"data":{}}',
      signal: AbortSignal.timeout(120_000),
    }).catch(() => undefined);
  }
}
