import { expect, signIn, signOut, test, unique } from './fixtures';

/**
 * Tier 1 alerts. The emulators have no email or WhatsApp provider configured,
 * which is exactly what these tests need: the app must say so plainly and
 * never claim that something was sent. The sending itself is covered by
 * scripts/alerts-test.mjs against a stand-in provider.
 */
test.describe('Tier 1 alerts', () => {
  test('an officer chooses their channels; the screen says what the server can deliver', async ({ page }) => {
    await signIn(page, 'officer');
    await page.goto('/app/settings');
    const panel = page.locator('form', { has: page.getByRole('heading', { name: 'Tier 1 alerts' }) });
    await expect(panel.getByText('Email alerts are not set up on the server yet, so none will be sent.')).toBeVisible();
    await expect(panel.getByText('WhatsApp alerts are not set up on the server yet, so none will be sent.')).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: /^Email/ })).toBeChecked();

    // A number without its country code is refused before anything is sent.
    await panel.getByLabel('WhatsApp number').fill('98765 43210');
    await panel.getByRole('checkbox', { name: 'WhatsApp' }).check();
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByText('Enter the number with its country code, e.g. +91 98765 43210.')).toBeVisible();

    await panel.getByLabel('WhatsApp number').fill('+91 98765 43210');
    await panel.getByRole('checkbox', { name: 'WhatsApp' }).check();
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Alert settings saved')).toBeVisible();

    await page.reload();
    await expect(panel.getByLabel('WhatsApp number')).toHaveValue('+919876543210');
    await expect(panel.getByRole('checkbox', { name: 'WhatsApp' })).toBeChecked();

    // Back to how it was, for the tests that follow.
    await panel.getByLabel('WhatsApp number').fill('');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Alert settings saved')).toBeVisible();
  });

  test('a reviewer is not offered alerts', async ({ page }) => {
    await signIn(page, 'reviewer');
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tier 1 alerts' })).toHaveCount(0);
  });

  test('a Tier 1 report records what was sent — here, honestly, nothing', async ({ page }) => {
    const marker = unique('alrt').replace(/[^a-z0-9]/g, '');
    await signIn(page, 'reviewer');
    await page.goto('/app/report');
    await page.getByRole('radio', { name: 'Text report' }).click();
    await page
      .getByLabel('What happened')
      .fill(`Scaffold ${marker}: a fitter was working at height without a harness, directly above two people. No barricade below.`);
    await page.getByLabel('Where').selectOption({ label: 'Tank Farm A' });
    await page.getByRole('button', { name: 'Submit report' }).click();
    await page.waitForURL(/\/app\/reports\/[A-Za-z0-9]{20}$/);
    const url = page.url();
    await expect(page.getByText('Tier 1 · Critical').first()).toBeVisible({ timeout: 30_000 });
    // Who was alerted is not the reporter's business.
    await expect(page.getByText('Alerts', { exact: true })).toHaveCount(0);

    await signOut(page);
    await signIn(page, 'officer');
    await page.goto(url);
    const row = page.locator('div', { has: page.getByText('Alerts', { exact: true }) }).last();
    await expect(row.getByText('Email: not set up')).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText('WhatsApp: not set up')).toBeVisible();
  });

  test('an administrator can send a test alert and is told exactly what happened', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/app/settings');
    const panel = page.locator('form', { has: page.getByRole('heading', { name: 'Tier 1 alerts' }) });
    await panel.getByRole('button', { name: 'Send me a test alert' }).click();
    await expect(page.getByText('Email: not set up · WhatsApp: not set up')).toBeVisible({ timeout: 30_000 });
  });
});
