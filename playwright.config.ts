import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real stack running locally: the Vite dev
 * server wired to the Firebase emulator suite (Auth, Firestore, Functions,
 * Storage). Nothing is mocked. Prerequisites:
 *
 *   npm run emulators   # terminal 1
 *   npm run seed        # once, after the emulators are up
 *   npm run test:e2e    # starts (or reuses) the dev server
 *
 * Tests share one emulator database, so they run serially.
 */
const PREVIEW = process.env.PREVIEW === '1';
const BASE_URL = PREVIEW ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173';

// Browser profiles and other temporary files go to PRAHARI_TMP when it is set
// (e.g. a folder on a data drive), instead of the system temp folder. Set here,
// before any browser starts, so the test workers and the dev server inherit it.
if (process.env.PRAHARI_TMP) {
  process.env.TMP = process.env.TEMP = process.env.PRAHARI_TMP;
}

export default defineConfig({
  testDir: './e2e',
  // Warms the emulator's function workers once, so tests do not fail on cold starts.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  // Generous: the Functions emulator can take >15 s to spin up a worker the
  // first time a given callable is invoked after a restart.
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    // PLAYWRIGHT_CHANNEL=chrome runs against an installed Google Chrome instead
    // of Playwright's bundled Chromium (useful when browsers are not installed).
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    // PREVIEW=1 tests the production build (npm run build first) served by
    // `vite preview` with the production security headers, CSP included.
    command: PREVIEW ? 'npm run preview' : 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
