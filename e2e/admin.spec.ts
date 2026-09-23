import { expect, signIn, signOut, test, unique } from './fixtures';

test.describe.serial('administration', () => {
  // Some steps deliberately provoke refusals (duplicate name → 409, deleting
  // an installation in use → 400); Chrome logs those responses to the console.
  test.use({ allowConsole: [/status of (400|409) \(/] });

  const email = `${unique('staff')}@prahari.test`;
  const installation = `E2E Test Site ${Date.now().toString(36)}`;

  test('a new person signs up (and so appears in the user list)', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Staff Member');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Staff-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/verify-email/);
  });

  test('admin finds them, promotes them, assigns an installation, disables and re-enables them', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/app/admin/users');
    await page.getByLabel('Search by email').fill(email.slice(0, 12));
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByText('Reviewer')).toBeVisible();

    await row.getByRole('button', { name: 'Manage Staff Member' }).click();
    await page.getByRole('menuitem', { name: 'Change role' }).click();
    await page.getByRole('dialog').getByText('HSE officer', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(row.getByText('HSE officer')).toBeVisible();

    await row.getByRole('button', { name: 'Manage Staff Member' }).click();
    await page.getByRole('menuitem', { name: 'Assign installation' }).click();
    await page.getByRole('dialog').getByLabel('Installation').selectOption({ label: 'Gas Compression Plant' });
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Gas Compression Plant')).toBeVisible();

    await row.getByRole('button', { name: 'Manage Staff Member' }).click();
    await page.getByRole('menuitem', { name: 'Disable account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disable' }).click();
    await expect(row.getByText('Disabled')).toBeVisible();

    await row.getByRole('button', { name: 'Manage Staff Member' }).click();
    await page.getByRole('menuitem', { name: 'Enable account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Enable' }).click();
    await expect(row.getByText('Active')).toBeVisible();
  });

  test('the admin cannot manage their own account from the list', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/app/admin/users');
    await page.getByLabel('Search by email').fill('admin@');
    const self = page.getByRole('row').filter({ hasText: 'admin@prahari.test' });
    await expect(self.getByText('(you)')).toBeVisible();
    await expect(self.getByRole('button', { name: /Manage/ })).toBeDisabled();
  });

  test('every change is in the audit log', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/app/admin/audit');
    await page.getByLabel('Filter by event').selectOption({ label: 'Role changed' });
    await expect(page.getByRole('row').nth(1)).toContainText('Role changed');
    await expect(page.getByRole('row').nth(1)).toContainText('Anita Rao');
    await page.getByLabel('Filter by event').selectOption({ label: 'Account disabled' });
    await expect(page.getByRole('row').nth(1)).toContainText('Account disabled');
  });

  test('admin deletes the account', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/app/admin/users');
    await page.getByLabel('Search by email').fill(email.slice(0, 12));
    const row = page.getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: 'Manage Staff Member' }).click();
    await page.getByRole('menuitem', { name: 'Delete account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete account' }).click();
    await expect(row).toHaveCount(0);
  });

  test('reference data: add, edit, deactivate, delete', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/app/admin/reference');

    await page.getByRole('button', { name: 'Add installation' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('X');
    await dialog.getByRole('button', { name: 'Add installation' }).click();
    await expect(dialog.getByText('Name must be at least 2 characters')).toBeVisible();
    await dialog.getByLabel('Name').fill(installation);
    await dialog.getByLabel('Code').fill('e2e-1');
    await dialog.getByLabel('Region').fill('Test');
    await dialog.getByRole('button', { name: 'Add installation' }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: installation });
    await expect(row).toBeVisible();
    await expect(row.getByText('E2E-1')).toBeVisible(); // codes are normalised to upper case

    // Duplicate names are refused by the service layer.
    await page.getByRole('button', { name: 'Add installation' }).click();
    await dialog.getByLabel('Name').fill(installation);
    await dialog.getByRole('button', { name: 'Add installation' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/already exists/i);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await row.getByRole('button', { name: `Manage ${installation}` }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(row.getByText('Inactive')).toBeVisible();

    // Inactive installations are not offered on the report form.
    await page.goto('/app/reports/new');
    await expect(page.getByLabel('Installation').locator('option', { hasText: installation })).toHaveCount(0);

    await page.goto('/app/admin/reference');
    await row.getByRole('button', { name: `Manage ${installation}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
  });

  test('an installation used by reports cannot be deleted', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/app/admin/reference');
    const row = page.getByRole('row').filter({ hasText: 'Tank Farm A' });
    await row.getByRole('button', { name: 'Manage Tank Farm A' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/report/i);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toBeVisible();
    await signOut(page);
  });
});
