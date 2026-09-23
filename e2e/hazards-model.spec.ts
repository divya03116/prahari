import { expect, signIn, test } from './fixtures';

/**
 * Opt-in: hazard detection with the REAL models, end to end.
 *
 *  1. Live camera: Chrome's fake camera plays a worker, then a smoky fire scene
 *     (held-out test images). With a restricted zone covering the view and the
 *     fire and smoke rules on, the camera must file an unsafe act and an unsafe
 *     condition by itself, each with its evidence frame.
 *  2. Worker photo: the fire-scene photo is checked by the models, the report is
 *     filled in and sent automatically after the countdown; Cancel stops it.
 *
 * Needs the inference service running with the general, pose and fire models:
 *
 *   python ai/hazards/make_hazard_media.py
 *   PPE_HAZARD_CAMERA=E:/prahari-ml/verify/hazard-test.mjpeg PPE_FIRE_PHOTO=E:/prahari-ml/verify/fire-photo.jpg \
 *     npx playwright test hazards-model
 */

const video = process.env.PPE_HAZARD_CAMERA;
const photo = process.env.PPE_FIRE_PHOTO;
test.skip(!video || !photo, 'set PPE_HAZARD_CAMERA and PPE_FIRE_PHOTO (see ai/README.md)');

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

test('the camera files an unsafe act and an unsafe condition by itself', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const key = 'prahari.monitoring.v1';
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(
      key,
      JSON.stringify({
        ...saved,
        label: 'Hazard check (test images)',
        installationId: 'tank-farm-a',
        required: [],
        hazards: ['restricted-zone', 'fire', 'smoke'],
        zones: [{ id: 'zall', name: 'Whole view (test)', kind: 'danger', points: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
      }),
    );
  });
  await signIn(page, 'officer');
  await page.goto('/app/monitoring');
  await expect(page.getByText(/^AI models? ready/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Live · detection on')).toBeVisible();

  const zone = page.locator('li').filter({ hasText: 'Incident created: Person in a restricted zone (unsafe act)' });
  // The fire scene is smoky: either fire or smoke is a correct unsafe condition.
  const fire = page.locator('li').filter({ hasText: /Incident created: (Fire|Smoke) \(unsafe condition\)/ });
  await expect(zone).toHaveCount(1, { timeout: 90_000 });
  await expect(fire.first()).toBeVisible({ timeout: 90_000 });
  const body = await page.screenshot({ path: 'test-results/screens/hazards-live.png' });
  await info.attach('hazards-live', { body, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Stop' }).click();

  await zone.getByRole('link', { name: 'open' }).click();
  await page.waitForURL(/\/app\/reports\/[A-Za-z0-9]{20}$/);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Camera evidence' })).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText('Person in a restricted zone · Unsafe act')).toBeVisible();
  await expect
    .poll(async () => page.getByAltText('Frame captured when the hazard was confirmed').evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
  await expect(main.getByText('Unauthorised entry')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('SIF potential').first()).toBeVisible({ timeout: 30_000 });
});

test('a worker photo is checked, filled in and sent automatically', async ({ page }, info) => {
  test.setTimeout(120_000);
  await signIn(page, 'reviewer');
  await page.goto('/app/report');
  await page.getByRole('radio', { name: 'Photo report' }).click();
  await page.getByLabel('Where').selectOption({ label: 'Tank Farm A' });
  await page.getByLabel('Attach files').setInputFiles(photo!);

  await expect(page.getByText('AI photo check found')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('main').getByText(/(fire|smoke) \(\d+%\)/).first()).toBeVisible();
  await expect(page.getByText(/Sending as “Unsafe condition” in \d s/)).toBeVisible({ timeout: 30_000 });
  const body = await page.screenshot({ path: 'test-results/screens/photo-report-countdown.png' });
  await info.attach('photo-report-countdown', { body, contentType: 'image/png' });

  // No click: it sends itself.
  await page.waitForURL(/\/app\/reports\/[A-Za-z0-9]{20}$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'AI photo check' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Worker photo (AI check)').first()).toBeVisible();
  await expect(page.locator('main').getByText('Fire / explosion')).toBeVisible({ timeout: 30_000 });
});

test('Cancel stops the automatic send', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'reviewer');
  await page.goto('/app/report');
  await page.getByRole('radio', { name: 'Photo report' }).click();
  await page.getByLabel('Where').selectOption({ label: 'Tank Farm A' });
  await page.getByLabel('Attach files').setInputFiles(photo!);
  await expect(page.getByText(/Sending as “Unsafe condition” in \d s/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(7_000);
  await expect(page).toHaveURL(/\/app\/report$/);
  await expect(page.getByRole('button', { name: 'Submit report' })).toBeEnabled();
});
