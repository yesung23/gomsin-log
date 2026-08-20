import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { NO_SPACE } from './scenarios';
import { mkdir } from 'node:fs/promises';

/** Screenshots of the first screen a new install sees, at the widths it breaks at. */
const OUT = 'ui-audit-results/onboarding';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

for (const width of [320, 390]) {
  test(`landing ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await installMockBackend(context, NO_SPACE);
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await expect(page.getByText('답장이 늦어도, 서로의 하루는 놓치지 않도록.')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${OUT}/landing-${width}.png`, fullPage: true });
    await context.close();
  });
}
