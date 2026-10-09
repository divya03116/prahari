import { fileURLToPath } from 'node:url';

import { expect, signIn, signOut, test, unique } from './fixtures';

const PHOTO = fileURLToPath(new URL('../public/hero-poster.jpg', import.meta.url));

test.describe.serial('report lifecycle', () => {
  // A word that appears in no other report, so search can find exactly this one.
  const marker = unique('tagx').replace(/[^a-z0-9]/g, '');
  const text = `Scaffold ${marker} on the east side was missing toe boards on the third lift and a fitter was working directly below it.`;
  let reportUrl = '';

  test('the form validates before sending anything', async ({ page }) => {
    await signIn(page, 'reviewer');
    await page.goto('/app/reports/new');
    await page.getByRole('button', { name: 'File report' }).click();
    await expect(page.getByText('Report must be at least 12 characters')).toBeVisible();
    await expect(page.getByText('Choose an installation')).toBeVisible();
    await expect(page.getByText('Choose an activity')).toBeVisible();
  });

  test('a reviewer files a report with a photo; the server scores it', async ({ page }) => {
    await signIn(page, 'reviewer');
    await page.goto('/app/reports/new');

    await page.getByLabel('What happened').fill(text);
    // The in-browser preview updates while typing.
    await expect(page.getByText('Computed in your browser as you type')).toBeVisible();
    await expect(page.getByText('Tier 1 · Critical').first()).toBeVisible();

    await page.getByRole('radio', { name: 'Unsafe condition' }).check({ force: true });
    await page.getByLabel('Installation').selectOption({ label: 'Tank Farm A' });
    await page.getByLabel('Activity').selectOption({ label: 'Work at height' });
    await page.getByLabel('Attach files').setInputFiles(PHOTO);
    await expect(page.getByText('hero-poster.jpg')).toBeVisible();
    await expect(page.getByText(/uploaded$/)).toBeVisible();

    await page.getByRole('button', { name: 'File report' }).click();
    await page.waitForURL(/\/app\/reports\/[A-Za-z0-9]{20}$/);
    reportUrl = page.url();

    // Pending → scored arrives over the live listener, no reload.
    await expect(page.getByText('SIF potential').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Tier 1 · Critical').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Corrective actions' })).toBeVisible();
    await expect(page.getByText('Stop the activity and make the area safe.')).toBeVisible();

    // The reporter's name is never on the report.
    await expect(page.locator('main').getByText('Imran Shaikh')).toHaveCount(0);

    // Attachment round-trip: listed, and the reviewer has no verdict form.
    await expect(page.getByRole('button', { name: /hero-poster\.jpg/ })).toBeVisible();
    await expect(page.getByText('Not reviewed yet. An HSE officer records the verdict.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-score' })).toHaveCount(0);
  });

  test('the register finds it by word, and filters and paginates', async ({ page }) => {
    await signIn(page, 'officer'); // an officer sees the whole register
    await page.goto('/app/reports');
    await expect(page.getByRole('row')).toHaveCount(26); // header + a full page of 25

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Page 2 ·')).toBeVisible();
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.getByText('Page 1 ·')).toBeVisible();

    await page.getByLabel('Tier').selectOption('3');
    await expect(page).toHaveURL(/tier=3/);
    const badges = page.getByRole('row').filter({ has: page.getByText('T3', { exact: true }) });
    await expect(badges.first()).toBeVisible();
    await expect(page.getByRole('row').filter({ has: page.getByText('T1', { exact: true }) })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear' }).click();

    await page.getByLabel('Search reports').fill(marker);
    await expect(page).toHaveURL(new RegExp(`q=${marker}`));
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('link', { name: new RegExp(marker) })).toBeVisible();

    await page.getByLabel('Search reports').fill('nosuchwordanywhere');
    await expect(page.getByText('No reports contain “nosuchwordanywhere”')).toBeVisible();
  });

  test('an HSE officer records a verdict and manages actions', async ({ page }) => {
    await signIn(page, 'officer');
    await page.goto(reportUrl);

    await page.getByText('Confirmed', { exact: true }).click();
    await page.getByLabel('Note').fill('Checked on site at the start of shift.');
    await page.getByRole('button', { name: 'Record verdict' }).click();
    await expect(page.getByText('Checked on site at the start of shift.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toBeVisible();

    // Add a manual action.
    await page.getByRole('button', { name: 'Add action' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Control').fill('Fit toe boards on every lift above two metres');
    await dialog.getByLabel('Owner').fill('Scaffolding supervisor');
    await dialog.getByLabel('Due in (days)').fill('0');
    await dialog.getByRole('button', { name: 'Add action' }).click();
    await expect(dialog.getByText('At least 1 day')).toBeVisible();
    await dialog.getByLabel('Due in (days)').fill('5');
    await dialog.getByRole('button', { name: 'Add action' }).click();
    await expect(dialog).toBeHidden();
    const manual = page.getByRole('listitem').filter({ hasText: 'Fit toe boards on every lift above two metres' });
    await expect(manual).toBeVisible();
    await expect(manual.getByText('Manual')).toBeVisible();

    // Close it.
    await manual.getByRole('button', { name: 'Update' }).click();
    await page.getByRole('dialog').getByLabel('Status').selectOption('closed');
    await page.getByRole('dialog').getByLabel('Progress note').fill('Fitted and inspected.');
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(manual.getByText('Closed')).toBeVisible();
    await expect(manual.getByText('Fitted and inspected.')).toBeVisible();
    // Officers cannot delete; that is an administrator's call.
    await expect(manual.getByRole('button', { name: /Delete action/ })).toHaveCount(0);
  });

  test('only its author and the officers can open the report', async ({ page }) => {
    // The manager's installation is North Gathering; this report is at Tank Farm A.
    await signIn(page, 'manager');
    await page.goto(reportUrl);
    await expect(page.getByText('You do not have access to this.')).toBeVisible();
    await signOut(page);

    await signIn(page, 'reviewer'); // its author
    await page.goto(reportUrl);
    await expect(page.getByText('SIF potential').first()).toBeVisible({ timeout: 30_000 });
    await signOut(page);

    await signIn(page, 'officer');
    await page.goto(reportUrl);
    await expect(page.getByText('SIF potential').first()).toBeVisible({ timeout: 30_000 });
  });

  test('an administrator deletes the manual action and archives the report', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto(reportUrl);

    const manual = page.getByRole('listitem').filter({ hasText: 'Fit toe boards on every lift above two metres' });
    await manual.getByRole('button', { name: /Delete action/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete action' }).click();
    await expect(manual).toHaveCount(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive report' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Archive report' }).click();
    await expect(dialog.getByText('Reason must be at least 3 characters.')).toBeVisible();
    await dialog.getByLabel('Reason').fill('Duplicate of an earlier report (e2e).');
    await dialog.getByRole('button', { name: 'Archive report' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Archived', { exact: true }).first()).toBeVisible();

    // Archived reports leave the register and appear under Archived.
    await page.goto(`/app/reports?q=${marker}`);
    await expect(page.getByText(`No reports contain “${marker}”`)).toBeVisible();
    await page.goto('/app/reports?view=archived');
    await expect(page.getByRole('link', { name: new RegExp(marker) })).toBeVisible();
  });
});

test('a reviewer sees only their own reports', async ({ page }) => {
  await signIn(page, 'reviewer');
  await page.goto('/app/reports');
  await expect(page.getByRole('row').first()).toBeVisible();
  // Every row is theirs, so the "Filed by me" view would only repeat the list.
  await expect(page.getByRole('radio', { name: 'Filed by me' })).toHaveCount(0);
  const listed = () => page.getByRole('row').getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  const mine = new Set(await listed());
  expect(mine.size).toBeGreaterThan(0);
  await signOut(page);

  // An officer's register (same order: highest potential first) also holds
  // reports this reviewer did not file. Compared by report, not by row count:
  // both lists stop at one page.
  await signIn(page, 'officer');
  await page.goto('/app/reports');
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  expect((await listed()).some((href) => !mine.has(href))).toBe(true);
});

test('a reviewer cannot open the administration screens', async ({ page }) => {
  await signIn(page, 'reviewer');
  await page.goto('/app/admin/users');
  await expect(page.getByText('You do not have access to this page')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
});

test('an installation manager sees and updates only their installation', async ({ page }) => {
  await signIn(page, 'manager');
  await page.goto('/app/actions');
  // Their scope is fixed to their own installation: no installation filter at all.
  await expect(page.getByLabel('Installation')).toHaveCount(0);
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Drilling Rig R-17' })).toHaveCount(0);
  const first = page.getByRole('row').nth(1);
  await first.getByRole('button', { name: 'Update' }).click();
  const dialog = page.getByRole('dialog');
  // Only an officer may cancel, reassign or reschedule.
  await expect(dialog.getByLabel('Status').locator('option[value="cancelled"]')).toHaveCount(0);
  await expect(dialog.getByLabel('Owner')).toHaveAttribute('readonly', '');
  await dialog.getByLabel('Progress note').fill(`Scaffold crew booked (${Date.now()}).`);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
});
