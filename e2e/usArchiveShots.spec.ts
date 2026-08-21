import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { PARTNER } from './scenarios';
import { mkdir } from 'node:fs/promises';

const OUT = 'ui-audit-results/us';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

for (const width of [320, 390]) {
  test(`us archive ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await installMockBackend(context, PARTNER);
    const page = await context.newPage();
    await page.goto('/us');
    await expect(page.locator('[data-testid^="month-texture-"]').first())
      .toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${OUT}/us-${width}.png`, fullPage: true });
    await context.close();
  });
}
