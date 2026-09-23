import { expect, latestOobCode, signIn, signOut, test, unique } from './fixtures';

test.describe('authentication', () => {
  test.use({ allowConsole: [/identitytoolkit|400 \(Bad Request\)|Failed to load resource/] });

  test('wrong password shows a readable error and does not sign in', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Email').fill('reviewer@prahari.test');
    await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    await expect(page).toHaveURL(/\/signin/);
  });

  test('client-side validation runs before any request', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Email is required')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Use at least 8 characters')).toBeVisible();
  });

  test('Enter in the password field submits the form', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Email').fill('reviewer@prahari.test');
    await page.getByLabel('Password', { exact: true }).fill('Prahari-demo-1');
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await page.waitForURL(/\/app$/);
  });

  test('sign up → verify email → reach the console → sign out → sign back in', async ({ page }) => {
    const email = `${unique('new')}@prahari.test`;
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Test Person');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Correct-horse-9');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Unverified: parked on the verification screen, console is off-limits.
    await expect(page).toHaveURL(/\/verify-email/);
    await expect(page.getByText(email)).toBeVisible();
    await page.goto('/app');
    await expect(page).toHaveURL(/\/verify-email/);

    // Follow the link from the "email", through our own action handler.
    const code = await latestOobCode(email, 'VERIFY_EMAIL');
    await page.goto(`/auth/action?mode=verifyEmail&oobCode=${encodeURIComponent(code)}`);
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
    await page.getByRole('link', { name: 'Continue to PRAHARI' }).click();
    await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();

    // New accounts are reviewers: no administration section.
    await expect(page.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);

    // Session persists across a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();

    await signOut(page);
    await signIn(page, email, 'Correct-horse-9');
    await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();
  });

  test('forgot password → reset link → new password works, old one does not', async ({ page }) => {
    // A fresh account so the seeded passwords are never changed.
    const email = `${unique('reset')}@prahari.test`;
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Reset Person');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Old-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/verify-email/);
    await page.getByRole('button', { name: 'Use a different account' }).click();

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const code = await latestOobCode(email, 'PASSWORD_RESET');
    await page.goto(`/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(code)}`);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill('New-password-2');
    await page.getByLabel('Confirm new password').fill('Mismatch-3');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
    await page.getByLabel('Confirm new password').fill('New-password-2');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page).toHaveURL(/\/signin\?reset=1/);
    await expect(page.getByText('Password updated')).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Old-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill('New-password-2');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    // Completing a reset link proves control of the address, so Firebase
    // marks it verified: the account goes straight to the console.
    await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();
  });

  test('a used or invalid action link is refused', async ({ page }) => {
    await page.goto('/auth/action?mode=verifyEmail&oobCode=not-a-real-code');
    await expect(page.getByRole('heading', { name: 'This link cannot be used' })).toBeVisible();
  });
});
