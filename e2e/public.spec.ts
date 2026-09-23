import { expect, test } from './fixtures';

test.describe('public site', () => {
  test('landing page renders, anchors work and the engine demo scores live', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/PRAHARI/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('could have become');

    await page.getByRole('link', { name: 'Try the engine' }).first().click();
    await expect(page).toHaveURL(/#try$/);

    const box = page.getByLabel('Report narrative');
    await expect(box).toBeVisible();
    await box.fill('Housekeeping item: hose lying across the walkway near the pump house.');
    await expect(page.getByText('Tier 3 · Controlled').first()).toBeVisible();

    await box.fill('Scaffold third lift missing toe boards, fitter working directly below.');
    await expect(page.getByText('Tier 1 · Critical').first()).toBeVisible();
    await expect(page.getByText('Life-saving rule breaches')).toBeVisible();
  });

  test('call-to-action links reach the auth screens', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/signin$/);
  });

  test('unknown routes show a 404 page', async ({ page }) => {
    await page.goto('/definitely-not-a-page');
    await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
  });

  test('protected routes redirect to sign-in and remember where you were going', async ({ page }) => {
    await page.goto('/app/insights');
    await expect(page).toHaveURL(/\/signin\?next=%2Fapp%2Finsights/);
  });

  test('routes from the previous version redirect', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/signin/);
    await page.goto('/triage');
    await expect(page).toHaveURL(/\/signin\?next=%2Fapp%2Freports/);
  });

  test('an open-redirect "next" parameter is ignored', async ({ page }) => {
    await page.goto('/signin?next=//evil.example/x');
    await page.getByLabel('Email').fill('reviewer@prahari.test');
    await page.getByLabel('Password', { exact: true }).fill('Prahari-demo-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/app$/);
  });
});
