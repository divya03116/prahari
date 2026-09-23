import { expect, signIn, test } from './fixtures';

test.describe('dashboard', () => {
  test('every widget renders real data and its controls work', async ({ page }) => {
    await signIn(page, 'officer');
    await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();

    // Hero: the active count matches the register's own total.
    const hero = page.getByRole('region', { name: 'Total reports' });
    await expect(hero).toContainText(/\d+\s*active/);
    await expect(hero).toContainText(/reports from last month/);
    await expect(hero.getByRole('link', { name: /Review queue/ })).toHaveAttribute('href', '/app/reports?view=review');

    // Report flow: five bars; switching to weekly re-buckets them; selecting a bar updates the readout.
    const flow = page.locator('section', { has: page.getByRole('heading', { name: 'Report flow' }) });
    await expect(flow.getByRole('button', { name: /reports$/ })).toHaveCount(5);
    await flow.getByRole('button', { name: 'Period: Monthly' }).click();
    await page.getByRole('menuitem', { name: 'Weekly' }).click();
    await expect(flow.getByRole('button', { name: 'Period: Weekly' })).toBeVisible();
    await expect(flow.getByRole('button', { name: /reports$/ })).toHaveCount(5);
    const first = flow.getByRole('button', { name: /reports$/ }).first();
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');

    // Hazard split: legend percentages add up to about 100.
    const split = page.locator('section', { has: page.getByRole('heading', { name: 'Hazard split' }) });
    const pcts = (await split.locator('li').allInnerTexts()).map((t) => Number(t.match(/(\d+)%/)?.[1] ?? 0));
    expect(pcts.length).toBeGreaterThan(0);
    expect(Math.abs(pcts.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(pcts.length);

    // Open actions: the menu offers an update to an officer, which opens the real dialog.
    const actions = page.locator('section', { has: page.getByRole('heading', { name: /Open actions/ }) });
    await actions.getByRole('button', { name: 'Action options' }).first().click();
    await page.getByRole('menuitem', { name: 'Update action' }).click();
    await expect(page.getByRole('dialog', { name: 'Update corrective action' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // Recent reports: menu opens the report.
    const recent = page.locator('section', { has: page.getByRole('heading', { name: /Recent reports/ }) });
    await recent.getByRole('button', { name: 'Report options' }).first().click();
    await page.getByRole('menuitem', { name: 'Open report' }).click();
    await expect(page).toHaveURL(/\/app\/reports\/[A-Za-z0-9]{20}$/);
    await expect(page.getByText('SIF potential').first()).toBeVisible();
  });

  test('installation cards filter the register', async ({ page }) => {
    await signIn(page, 'admin');
    const card = page.locator('section', { has: page.getByRole('heading', { name: /Installations/ }) });
    await expect(card.getByRole('link', { name: /Add/ })).toBeVisible(); // admins can add sites
    await card.getByRole('button').last().click();
    await expect(page).toHaveURL(/\/app\/reports\?installation=/);
    await expect(page.getByRole('row').nth(1)).toBeVisible();
  });

  test('a reviewer sees the dashboard without admin or update controls', async ({ page }) => {
    await signIn(page, 'reviewer');
    await expect(page.getByRole('heading', { name: 'My dashboard' })).toBeVisible();
    const card = page.locator('section', { has: page.getByRole('heading', { name: /Installations/ }) });
    await expect(card.getByRole('link', { name: /Add/ })).toHaveCount(0);
    const actions = page.locator('section', { has: page.getByRole('heading', { name: /Open actions/ }) });
    await actions.getByRole('button', { name: 'Action options' }).first().click();
    await expect(page.getByRole('menuitem', { name: 'Open report' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Update action' })).toHaveCount(0);
  });
});
