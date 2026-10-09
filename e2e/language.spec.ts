import { expect, signIn, test } from './fixtures';

const SIGN_IN_TITLE = {
  hi: 'PRAHARI में साइन इन करें',
  as: 'PRAHARI-ত ছাইন ইন কৰক',
  bn: 'PRAHARI-তে সাইন ইন করুন',
  en: 'Sign in to PRAHARI',
} as const;

test.describe('interface language', () => {
  test('the sign-in screen works in all four languages and remembers the choice', async ({ page }) => {
    await page.goto('/signin');
    const picker = page.getByRole('combobox');
    await expect(picker).toHaveAccessibleName('Language');

    for (const [code, title] of Object.entries(SIGN_IN_TITLE)) {
      await picker.selectOption(code);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', code);
    }

    await picker.selectOption('hi');
    await expect(page.getByRole('button', { name: 'साइन इन करें', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: SIGN_IN_TITLE.hi })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Google से जारी रखें' })).toBeVisible();
  });

  test('the public page can be read in another language; its example reports stay as written', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('could have become');

    await page.getByRole('contentinfo').getByRole('combobox', { name: 'Language' }).selectOption('as');
    await expect(page.getByRole('heading', { level: 2, name: 'ই কেনেকৈ কাম কৰে' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ছাইন ইন কৰক' })).toBeVisible();
    await expect(page.getByText('Scaffold third lift missing toe boards, fitter working directly below', { exact: true })).toBeVisible();
  });

  test('the menu and settings follow the language chosen in the app', async ({ page }) => {
    await signIn(page, 'reviewer');
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    // The switcher in the settings panel; the menu carries a second one.
    await page.getByRole('main').getByRole('combobox', { name: 'Language' }).selectOption('bn');
    await expect(page.getByRole('heading', { level: 1, name: 'সেটিংস' })).toBeVisible();
    const menu = page.getByRole('navigation', { name: 'প্রধান' });
    await expect(menu.getByRole('link', { name: 'ড্যাশবোর্ড' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'রিপোর্ট', exact: true })).toBeVisible();

    await page.getByRole('main').getByRole('combobox', { name: 'ভাষা' }).selectOption('en');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' })).toBeVisible();
  });

  test('screens are translated; reports stay exactly as they were written', async ({ page }) => {
    await signIn(page, 'officer');
    await page.goto('/app/reports');
    const firstReport = page.getByRole('row').nth(1).getByRole('link');
    await expect(firstReport).toBeVisible();
    const written = await firstReport.innerText();

    await page.goto('/app/settings');
    await page.getByRole('main').getByRole('combobox', { name: 'Language' }).selectOption('hi');
    await expect(page.getByRole('heading', { level: 1, name: 'सेटिंग्स' })).toBeVisible();

    // The register: headings, filters and columns in Hindi, the report text untouched.
    await page.goto('/app/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'रिपोर्टें' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'स्कोर' })).toBeVisible();
    await expect(page.getByRole('row').nth(1).getByRole('link')).toHaveText(written);

    // A report: panels in Hindi, the narrative as written.
    await page.getByRole('row').nth(1).getByRole('link').click();
    await expect(page.getByRole('heading', { name: 'अधिकारी की समीक्षा' })).toBeVisible();
    await expect(page.getByText(written).first()).toBeVisible();

    // The worker's quick report and the dashboard.
    await page.goto('/app/report');
    await expect(page.getByRole('heading', { level: 1, name: 'खतरे की रिपोर्ट करें' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'रिपोर्ट भेजें' })).toBeVisible();
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: 'मेरा डैशबोर्ड' })).toBeVisible();
  });
});
