import { expect, signIn, test } from './fixtures';

/**
 * Real layout checks at five widths: every key screen must render with no
 * horizontal page scroll (wide tables scroll inside their own container), and
 * the navigation must be reachable. Screenshots are kept as test artifacts.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'large', width: 1920, height: 1080 },
];

const PUBLIC = ['/', '/signin', '/signup', '/forgot-password'];
const APP = ['/app', '/app/report', '/app/reports', '/app/reports/new', '/app/monitoring', '/app/actions', '/app/insights', '/app/settings', '/app/admin/users', '/app/admin/reference', '/app/admin/audit'];

// The monitoring page probes the PPE inference service, which is not running in this suite.
test.use({ allowConsole: [/ERR_CONNECTION_REFUSED/] });

/**
 * Firestore holds a long-lived listen channel open, so 'networkidle' never
 * arrives inside the console. Settled = no loading skeletons left.
 */
async function settled(page: import('@playwright/test').Page) {
  await expect(page.locator('.animate-shimmer')).toHaveCount(0, { timeout: 20_000 });
}

/** Saved under test-results/screens/ for visual review, and attached to the HTML report. */
async function shot(page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo, name: string, fullPage = false) {
  const body = await page.screenshot({ fullPage, path: `test-results/screens/${name}.png` });
  await info.attach(name, { body, contentType: 'image/png' });
}

async function noHorizontalScroll(page: import('@playwright/test').Page, label: string) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(scroll, `${label}: page is wider than the viewport`).toBeLessThanOrEqual(width);
}

for (const vp of VIEWPORTS) {
  test(`layout at ${vp.width}px (${vp.name})`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.width, height: vp.height });

    for (const path of PUBLIC) {
      await page.goto(path);
      await page.waitForLoadState('load');
      await noHorizontalScroll(page, path);
    }
    await page.goto('/');
    await shot(page, info, `landing-${vp.width}`);

    await signIn(page, 'admin');
    for (const path of APP) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await settled(page);
      await noHorizontalScroll(page, path);
      if (path === '/app' || path === '/app/reports') {
        await shot(page, info, `${path.slice(1).replaceAll('/', '-')}-${vp.width}`);
      }
    }

    // A report detail page.
    await page.goto('/app/reports');
    await page.getByRole('row').nth(1).getByRole('link').click();
    await expect(page.getByText('SIF potential').first()).toBeVisible();
    await noHorizontalScroll(page, 'report detail');
    await shot(page, info, `report-detail-${vp.width}`, true);

    // Navigation: sidebar on large screens, drawer below lg (1024px).
    if (vp.width < 1024) {
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog', { name: 'Navigation' });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('link', { name: 'Insights' }).click();
      await expect(page).toHaveURL(/\/app\/insights/);
      await expect(drawer).toBeHidden();
    } else {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Insights' }).click();
      await expect(page).toHaveURL(/\/app\/insights/);
    }
  });
}
