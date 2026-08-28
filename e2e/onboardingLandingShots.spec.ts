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
    const googleButton = page.getByRole('button', { name: 'Google로 계속하기' });
    await expect(googleButton).toBeVisible();
    const googleBox = await googleButton.boundingBox();
    expect(googleBox).not.toBeNull();
    expect(googleBox!.width).toBeGreaterThanOrEqual(44);
    expect(googleBox!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${OUT}/landing-${width}.png`, fullPage: true });

    const requiredConsents = page.getByRole('checkbox');
    await expect(requiredConsents).toHaveCount(2);
    await requiredConsents.nth(0).check();
    await requiredConsents.nth(1).check();
    await expect(googleButton).toHaveAttribute('aria-disabled', 'false');
    await expect(page.getByText('위 두 항목에 동의하면 로그인할 수 있어요.')).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/landing-ready-${width}.png`, fullPage: true });
    await context.close();
  });
}
