import { expect, signIn, test } from './fixtures';

/**
 * Voice/text reporting, structuring, combined incidents and live monitoring.
 * Chrome's fake camera provides a real MediaStream; a fixed GPS position is
 * granted to the page. No detections are simulated: with no inference service
 * running, the monitoring page must say the model is not configured.
 */

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['camera', 'microphone', 'geolocation'],
  geolocation: { latitude: 27.4728, longitude: 94.912, accuracy: 15 },
});

test('quick text report: structured on the page, location added, stored with the incident', async ({ page }) => {
  await signIn(page, 'reviewer');
  await page.goto('/app/report');
  await expect(page.getByRole('heading', { name: 'Report a hazard' })).toBeVisible();

  await page.getByRole('radio', { name: 'Text report' }).click();
  await page.getByLabel('What happened').fill('There is an oil spill near the compressor area and people are walking through it.');
  await page.getByLabel('Where').selectOption({ label: 'Tank Farm A' });

  // Structured preview, extracted without inventing anything.
  const preview = page.locator('main');
  await expect(preview.getByRole('heading', { name: 'Structured incident' })).toBeVisible();
  await expect(preview).toContainText('Oil spill near the compressor area');
  await expect(preview).toContainText('Slip / trip');
  await expect(preview).toContainText('Restrict access to the area and clean up the spill.');

  await page.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByText('27.47280, 94.91200 ±15 m')).toBeVisible();

  await page.getByRole('button', { name: 'Submit report' }).click();
  await page.waitForURL(/\/app\/reports\/[A-Za-z0-9]{20}$/);
  await expect(page.getByText('SIF potential').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Structured incident' })).toBeVisible();
  await expect(page.getByText('Worker text report').first()).toBeVisible();
  await expect(page.getByText(/GPS 27\.47280, 94\.91200/)).toBeVisible();
  await page.getByText('Original report (kept exactly as given)').click();
  await expect(page.getByText('There is an oil spill near the compressor area and people are walking through it.').last()).toBeVisible();
});

test('a report with no details is structured as "Not specified", not guessed', async ({ page }) => {
  await signIn(page, 'reviewer');
  await page.goto('/app/report');
  await page.getByRole('radio', { name: 'Text report' }).click();
  await page.getByLabel('What happened').fill('Something did not look right in the yard today.');
  const preview = page.locator('main');
  await expect(preview.getByRole('heading', { name: 'Structured incident' })).toBeVisible();
  await expect(preview.getByText('Not specified').first()).toBeVisible();
});

test.describe('without browser speech recognition', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    });
  });

  test('voice reporting falls back to text', async ({ page }) => {
    await signIn(page, 'reviewer');
    await page.goto('/app/report');
    await page.getByRole('radio', { name: 'Voice report' }).click();
    await expect(page.getByText('Voice input isn’t available in this browser.')).toBeVisible();
    await expect(page.getByLabel(/What you said/)).toBeEditable();
  });
});

test('voice reporting is offered where the browser supports it', async ({ page }) => {
  await signIn(page, 'reviewer');
  await page.goto('/app/reports/new');
  await expect(page.getByRole('button', { name: 'Report by voice' })).toBeVisible();
  await expect(page.getByLabel('Speech language')).toBeVisible();
});

test.describe('live monitoring without an inference service', () => {
  // The page probes the service; Chrome logs the refused connection.
  test.use({ allowConsole: [/ERR_CONNECTION_REFUSED/] });

  test('honest model status; the camera starts by itself and respects Stop', async ({ page }) => {
  // Make sure the service is absent even if one is running on this machine.
  await page.route(/\/v1\/(model|health|detect)$/, (route) => route.abort('connectionrefused'));
  await signIn(page, 'officer');
  await page.goto('/app/monitoring');
  await expect(page.getByRole('heading', { name: 'Live safety monitoring' })).toBeVisible();
  // No inference service is running in this test: it must not pretend.
  await expect(page.getByText('AI Model Not Configured')).toBeVisible();

  // Nothing to fill in or press: name and installation are chosen automatically.
  await expect(page.getByText('Live · detection off (no model)')).toBeVisible();
  await expect(page.getByLabel('Camera name')).not.toHaveValue('');
  await expect(page.getByLabel('Installation')).not.toHaveValue('');
  const playing = await page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && !v.paused);
  expect(playing).toBe(true);

  // A person's Stop is respected: it does not restart on its own…
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Camera off')).toBeVisible();
  await page.waitForTimeout(3_000);
  await expect(page.getByText('Camera off')).toBeVisible();
  // …until they start it again.
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByText('Live · detection off (no model)')).toBeVisible();
  });
});

test('combined incident: camera evidence + AI detection + worker voice/text statements', async ({ page }) => {
  test.skip(process.env.PREVIEW === '1', 'uses the dev server to call the real client services');
  await signIn(page, 'officer');

  // File a camera incident through the real client services (upload + callable).
  const reportId = await page.evaluate(async () => {
    // Module paths as values: these are served by Vite to the page, not resolved by tsc.
    const mod = (p: string) => import(/* @vite-ignore */ p);
    const { api } = await mod('/src/services/callables.ts');
    const { startUpload } = await mod('/src/services/storage.ts');
    const { firebase } = await mod('/src/lib/firebase.ts');
    const uid = firebase.auth.currentUser!.uid;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('') + 'e2ecam0000';
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#556';
    ctx.fillRect(0, 0, 320, 240);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const path = `attachments/${uid}/${id}/evidence-frame.jpg`;
    const { task } = await startUpload(path, new File([blob], 'evidence-frame.jpg', { type: 'image/jpeg' }));
    await task;
    const res = await api.createPpeIncident({
      reportId: id,
      installationId: 'tank-farm-a',
      camera: { id: `cam_e2e${Date.now().toString(16)}`, label: 'E2E camera', kind: 'device' },
      violations: [{ type: 'helmet', trackId: 3, personConfidence: 0.88, frames: 11, seconds: 2.2 }],
      workers: [{ trackId: 3, box: { x1: 100, y1: 40, x2: 180, y2: 230 }, confidence: 0.88, ppe: { helmet: { state: 'missing', confidence: null }, vest: { state: 'present', confidence: 0.81 } } }],
      frame: { width: 320, height: 240 },
      evidence: { path, name: 'evidence-frame.jpg', size: blob.size, contentType: 'image/jpeg' },
      model: { name: 'e2e-model', architecture: 'YOLOv8', backend: 'remote', classes: ['person', 'helmet', 'vest'] },
      settings: { minConfidence: 0.6, confirmationFrames: 10, violationSeconds: 2, incidentCooldownSeconds: 300 },
      required: ['helmet', 'vest'],
      geo: null,
    });
    return res.reportId as string;
  });

  await page.goto(`/app/reports/${reportId}`);
  const evidence = page.locator('main');
  await expect(evidence.getByRole('heading', { name: 'Camera evidence' })).toBeVisible({ timeout: 30_000 });
  await expect(evidence.getByText('Missing').first()).toBeVisible();
  await expect(evidence.getByText('Worn · 81%')).toBeVisible();
  await expect
    .poll(async () => page.getByAltText('Frame captured when the violation was confirmed').evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText('Camera AI detection').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Structured incident' })).toBeVisible();

  // A worker's typed statement joins the same incident as a separate source.
  await page.getByLabel('Add a statement').fill('The worker near the compressor is not wearing a helmet.');
  await page.getByRole('button', { name: 'Add statement' }).click();
  await expect(page.locator('li').filter({ hasText: 'The worker near the compressor is not wearing a helmet.' })).toContainText('Worker text report');
});
