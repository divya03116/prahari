import { expect, test as base, type Page } from '@playwright/test';

export const PASSWORD = 'Prahari-demo-1';
export const ACCOUNTS = {
  admin: 'admin@prahari.test',
  officer: 'officer@prahari.test',
  manager: 'manager@prahari.test',
  reviewer: 'reviewer@prahari.test',
} as const;
export type Account = keyof typeof ACCOUNTS;

const AUTH = 'http://127.0.0.1:9099';
const PROJECT = 'demo-prahari';

/**
 * Every test fails if the page logs a console error or throws. Errors the
 * test itself provokes on purpose (a refused sign-in) are allow-listed per
 * test through `allowConsole`.
 */
export const test = base.extend<{ allowConsole: RegExp[] }>({
  allowConsole: [[], { option: true }],
  page: async ({ page, allowConsole }, use, testInfo) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (allowConsole.some((r) => r.test(text))) return;
      errors.push(text);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    await use(page);
    if (errors.length) {
      await testInfo.attach('console-errors', { body: errors.join('\n') });
      expect(errors, 'console errors during the test').toEqual([]);
    }
  },
});
export { expect };

export async function signIn(page: Page, who: Account | string, password = PASSWORD) {
  const email = who in ACCOUNTS ? ACCOUNTS[who as Account] : who;
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/app(\/|$|\?)/);
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(/\/signin/);
}

interface OobCode {
  email: string;
  oobCode: string;
  requestType: 'VERIFY_EMAIL' | 'PASSWORD_RESET' | string;
}

/** Reads the out-of-band codes the Auth emulator "sent" by email. */
export async function latestOobCode(email: string, type: 'VERIFY_EMAIL' | 'PASSWORD_RESET'): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`);
    const { oobCodes = [] } = (await res.json()) as { oobCodes?: OobCode[] };
    const match = oobCodes.filter((c) => c.email === email && c.requestType === type).at(-1);
    if (match) return match.oobCode;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No ${type} code for ${email}`);
}

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
