import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER } from './scenarios';
import { mkdir } from 'node:fs/promises';

/**
 * The two homes, side by side.
 *
 * The point of Gate 2 is that these two screens are NOT the same screen with
 * different cards, so the check that matters is what each one leads with.
 */
const OUT = 'ui-audit-results/home';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

const ROLES = [
  { name: 'sender-gomsin', scenario: CREATOR },
  { name: 'receiver-gunhwa', scenario: PARTNER },
];

for (const { name, scenario } of ROLES) {
  for (const width of [320, 390]) {
    test(`${name} ${width}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await installMockBackend(context, scenario);
      const page = await context.newPage();
      await page.goto('/home');
      await expect(page.getByTestId('home-core')).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
      await context.close();
    });
  }
}
