import { expect, signIn, test } from './fixtures';

/**
 * A camera refused at first (the permission prompt dismissed, or blocked in
 * the address bar) and allowed afterwards starts by itself — no reload and no
 * second press of Start. No inference service runs here; the page probes it.
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream'] },
  permissions: [],
  allowConsole: [/ERR_CONNECTION_REFUSED/],
});

test('the camera starts by itself once its permission is granted', async ({ page, context }) => {
  await page.route(/\/v1\/(model|health|detect)$/, (route) => route.abort('connectionrefused'));
  await signIn(page, 'officer');
  await page.goto('/app/monitoring');
  await expect(page.getByText(/Camera permission was blocked/)).toBeVisible();

  await context.grantPermissions(['camera']);
  await expect(page.getByText('Live · detection off (no model)')).toBeVisible();
  await expect(page.getByText(/Camera permission was blocked/)).toHaveCount(0);
  const playing = await page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && !v.paused);
  expect(playing).toBe(true);
});
