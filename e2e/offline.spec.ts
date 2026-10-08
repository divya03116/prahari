import { fileURLToPath } from 'node:url';

import { expect, signIn, test, unique } from './fixtures';

const PHOTO = fileURLToPath(new URL('../public/hero-poster.jpg', import.meta.url));

// With the network cut on purpose the browser logs every failed request;
// these tests are about what the app does next, not about a clean console.
test.use({ allowConsole: [/./] });

test.describe('offline and weak network', () => {
  test('a report filed offline, with a photo, waits on the device and is sent when the connection returns', async ({ page, context }) => {
    const marker = unique('offl').replace(/[^a-z0-9]/g, '');
    const text = `Oil ${marker} is leaking from the pump seal near the walkway and people are stepping through it.`;

    await signIn(page, 'reviewer');
    await page.goto('/app/report');
    await page.getByRole('radio', { name: 'Text report' }).click();
    await expect(page.getByLabel('Where').locator('option', { hasText: 'Tank Farm A' })).toHaveCount(1);

    await context.setOffline(true);
    await expect(page.getByText('You are offline.', { exact: false })).toBeVisible();

    await page.getByLabel('What happened').fill(text);
    await page.getByLabel('Where').selectOption({ label: 'Tank Farm A' });
    await page.getByLabel('Attach files').setInputFiles(PHOTO);
    await expect(page.getByText(/uploads when you are back online$/)).toBeVisible();
    await page.getByRole('button', { name: 'Submit report' }).click();

    // Not lost: it is on the device, the app says so, and the form is ready for the next one.
    await expect(page.getByText('Saved on this device').first()).toBeVisible();
    await expect(page.getByText('1 report is saved on this device, waiting to be sent.')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveValue('');
    await expect(page.getByTestId('offline-bar').getByText(text)).toBeVisible();

    // It survives closing and reopening the app.
    const saved = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open('prahari-outbox');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const count = open.result.transaction('reports').objectStore('reports').count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
        }),
    );
    expect(saved).toBe(1);

    // The connection returns: sent without anyone pressing anything.
    await context.setOffline(false);
    await expect(page.getByText('1 saved report was sent')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('offline-bar')).toHaveCount(0);

    // It is a normal report now: in the register, scored, with its photo.
    await page.goto('/app/reports');
    await page.getByRole('link', { name: new RegExp(marker) }).click();
    await expect(page.getByText('SIF potential').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /hero-poster\.jpg/ })).toBeVisible();
  });

  test('the app is installable and opens without a connection', async ({ page, context, request, baseURL }) => {
    const manifest = await (await request.get(`${baseURL}/manifest.webmanifest`)).json();
    expect(manifest.short_name).toBe('PRAHARI');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/app');
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const res = await request.get(`${baseURL}${icon.src}`);
      expect(res.ok(), icon.src).toBe(true);
      expect(res.headers()['content-type']).toContain('image/png');
    }
    await page.goto('/signin');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');

    // The service worker belongs to production builds only (PREVIEW=1).
    test.skip(!process.env.PREVIEW, 'the dev server has no service worker');

    await signIn(page, 'reviewer');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    // Everything the app needs is on the device once the worker has installed.
    await expect
      .poll(() => page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).length))
      .toBeGreaterThan(40);

    await context.setOffline(true);
    await page.goto('/app/report');
    await expect(page.getByRole('heading', { level: 1, name: 'Report a hazard' })).toBeVisible();
    await expect(page.getByText('You are offline.', { exact: false })).toBeVisible();
    // A screen that was never opened online still loads: its code was cached ahead of time.
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await context.setOffline(false);
  });
});
