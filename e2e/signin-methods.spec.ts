import { expect, test } from './fixtures';

/**
 * Sign-in methods besides email: Google, Apple and a phone number with an SMS
 * code. The Auth emulator sends no SMS; it records each code, which the test
 * reads back — the same flow a real phone gets, minus the network.
 */

const AUTH = 'http://127.0.0.1:9099';
const PROJECT = 'demo-prahari';

// The wrong code is refused (400), and the Auth emulator answers the SDK's
// reCAPTCHA Enterprise config probe with 501; Chrome logs both responses.
test.use({ allowConsole: [/status of (400|501) \(/] });

async function latestSmsCode(phoneNumber: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/verificationCodes`);
    const { verificationCodes = [] } = (await res.json()) as { verificationCodes?: { phoneNumber: string; code: string }[] };
    const match = verificationCodes.filter((c) => c.phoneNumber === phoneNumber).at(-1);
    if (match) return match.code;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No SMS code for ${phoneNumber}`);
}

test('Google, Apple and phone are offered for sign-in and sign-up', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with phone number' })).toBeVisible();
  await page.goto('/signup');
  await expect(page.getByRole('button', { name: 'Sign up with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up with Apple' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up with phone number' })).toBeVisible();
});

test('a worker signs in with a phone number and an SMS code', async ({ page }) => {
  // A fresh Indian mobile number each run, typed without the country code.
  const digits = `9${Date.now().toString().slice(-9)}`;
  const e164 = `+91${digits}`;

  await page.goto('/signin');
  await page.getByRole('button', { name: 'Continue with phone number' }).click();
  await page.getByLabel('Phone number').fill(digits);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('Code from the SMS')).toBeVisible();
  await expect(page.getByText(`Sent to ${e164}.`)).toBeVisible();

  // A wrong code is refused in plain words.
  await page.getByLabel('Code from the SMS').fill('000000');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByText('That code is not right. Check the SMS and try again.')).toBeVisible();

  await page.getByLabel('Code from the SMS').fill(await latestSmsCode(e164));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.waitForURL(/\/app(\/|$|\?)/);

  // A phone account counts as verified: straight into the console, not the
  // verify-email page, with a working (empty, own-only) register.
  await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();
  await page.goto('/app/reports');
  await expect(page.getByText('No reports match')).toBeVisible();
  await page.goto('/app/settings');
  await expect(page.getByLabel('Display name')).toHaveValue(e164);
  await expect(page.getByLabel('Phone')).toHaveValue(e164);
});
