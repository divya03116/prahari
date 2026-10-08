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
});
