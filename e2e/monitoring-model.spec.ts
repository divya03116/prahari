import { expect, signIn, test } from './fixtures';

/**
 * Opt-in: live monitoring with the TRAINED model, end to end — camera frames →
 * inference service (YOLO) → worker/PPE rule engine → confirmed violation →
 * automatic incident with an evidence frame → cooldown stops a duplicate.
 *
 * Needs the inference service running with evaluated weights, and a video for
 * Chrome's fake camera made from held-out test images:
 *
 *   python ai/ppe/make_test_video.py
 *   PPE_FAKE_CAMERA=E:/prahari-ml/verify/ppe-test.mjpeg npx playwright test monitoring-model
 *
 * The video shows a compliant worker, a worker without a helmet, another
 * compliant worker, then the helmet violation again. Nothing is simulated.
 */

const video = process.env.PPE_FAKE_CAMERA;
test.skip(!video, 'set PPE_FAKE_CAMERA to an .mjpeg made from test images');

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

test('a worker without a helmet produces exactly one automatic incident with evidence', async ({ page }, info) => {
  const shot = async (name: string, fullPage = false) =>
    info.attach(name, { body: await page.screenshot({ fullPage, path: `test-results/screens/${name}.png` }), contentType: 'image/png' });

  test.setTimeout(180_000);
  // This station requires helmets only (the saved per-browser setting); everything
  // else — starting the camera and detection — happens without a click.
  await page.addInitScript(() => {
    const key = 'prahari.monitoring.v1';
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    // PPE only: hazard rules are tested in hazards-model.spec.ts.
    localStorage.setItem(key, JSON.stringify({ ...saved, label: 'Model check (test images)', installationId: 'tank-farm-a', required: ['helmet'], hazards: [] }));
  });
  await signIn(page, 'officer');
  await page.goto('/app/monitoring');
  await expect(page.getByText(/^AI models? ready/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Live · detection on')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Safety helmet' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Safety vest' })).not.toBeChecked();

  const created = page.locator('li').filter({ hasText: 'Incident created: missing Safety helmet' });
  await expect(created).toHaveCount(1, { timeout: 90_000 });
  await shot('monitoring-live-incident');

  // Let the video loop past the second appearance of the same violation.
  await page.waitForTimeout(30_000);
  await expect(page.locator('li').filter({ hasText: /Incident created/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop' }).click();

  await created.getByRole('link', { name: 'open' }).click();
  await page.waitForURL(/\/app\/reports\/[A-Za-z0-9]{20}$/);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Camera evidence' })).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText('Missing').first()).toBeVisible();
  await expect
    .poll(async () => page.getByAltText('Frame captured when the violation was confirmed').evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText('Camera AI detection').first()).toBeVisible();
  await expect(page.getByText('SIF potential').first()).toBeVisible({ timeout: 30_000 });
  await shot('monitoring-incident-page', true);
});
