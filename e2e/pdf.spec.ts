import { readFileSync } from 'node:fs';

import { expect, signIn, test } from './fixtures';

test.describe('PDF export', () => {
  test('a report prints as a clean document, without the app around it', async ({ page }, testInfo) => {
    await signIn(page, 'officer');
    await page.goto('/app/reports');
    const first = page.getByRole('row').nth(1).getByRole('link');
    const narrative = await first.innerText();
    await first.click();

    // The button hands over to the browser's print dialog ("Save as PDF"),
    // with a file name that identifies the report.
    const id = page.url().split('/').pop()!;
    await page.evaluate(() => {
      const w = window as unknown as { printedAs: string[] };
      w.printedAs = [];
      window.print = () => {
        w.printedAs.push(document.title);
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    await page.getByRole('button', { name: 'Export PDF' }).click();
    expect(await page.evaluate(() => (window as unknown as { printedAs: string[] }).printedAs)).toEqual([`PRAHARI-report-${id.slice(0, 8)}`]);
    await expect(page).toHaveTitle(/PRAHARI —/);

    // A real PDF, made the way the print dialog makes it. Nothing of the
    // document exists on the page until printing starts.
    await expect(page.locator('.print-doc')).toHaveCount(0);
    const path = testInfo.outputPath('report.pdf');
    await page.pdf({ path, format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pdf = readFileSync(path);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length, 'the PDF holds the document, not a blank page').toBeGreaterThan(20_000);

    // On paper: the document only — no menu, no buttons.
    await page.emulateMedia({ media: 'print' });
    const doc = page.locator('.print-doc');
    await expect(doc.getByRole('heading', { level: 1, name: 'Safety observation report' })).toBeVisible();
    await expect(doc.getByText(narrative).first()).toBeVisible();
    await expect(doc.getByText('SIF potential').first()).toBeVisible();
    await expect(doc.getByRole('heading', { name: 'Corrective actions' })).toBeVisible();
    await expect(doc.getByRole('heading', { name: 'Officer review' })).toBeVisible();
    await expect(doc.getByText(id).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeHidden();
    // Who filed a report is never shown, on screen or on paper.
    await expect(doc).not.toContainText('reviewer@prahari.test');

    // Back on screen, the paper version is gone again.
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('.print-doc')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible();
  });

  test('the document follows the interface language; the narrative stays as written', async ({ page }) => {
    await signIn(page, 'officer');
    await page.goto('/app/settings');
    await page.getByRole('main').getByRole('combobox', { name: 'Language' }).selectOption('hi');
    await page.goto('/app/reports');
    const first = page.getByRole('row').nth(1).getByRole('link');
    const narrative = await first.innerText();
    await first.click();
    await expect(page.getByRole('button', { name: 'PDF निर्यात करें' })).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    const doc = page.locator('.print-doc');
    await expect(doc.getByRole('heading', { level: 1, name: 'सुरक्षा अवलोकन रिपोर्ट' })).toBeVisible();
    await expect(doc.getByText(narrative).first()).toBeVisible();
  });
});
