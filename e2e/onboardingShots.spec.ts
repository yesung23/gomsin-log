import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { NO_SPACE } from './scenarios';

/**
 * Capture the onboarding wizard, step by step, from the real production bundle.
 *
 * Not a regression test -- it asserts only enough to know it is on the screen it
 * thinks it is, then photographs it. The point is to make the wizard reviewable by
 * eye, which is the one check that unit tests structurally cannot perform.
 *
 * `newAccount: true` is the one switch that puts the app in the wizard: a SUCCESSFUL
 * but EMPTY profile lookup is the only thing the app accepts as proof of a new
 * account, so a failed lookup can never be mistaken for onboarding.
 */

const OUT = process.env.SHOT_DIR || './e2e/.artifacts/onboarding';

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.waitForTimeout(350); // let the progress bar settle
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test('capture the onboarding wizard as 곰신', async ({ browser }) => {
  const context = await browser.newContext();
  await installMockBackend(context, { ...NO_SPACE, newAccount: true });
  const page = await context.newPage();
  await page.goto('/');

  // Step 1 — role
  await expect(page.getByText('곰신로그를 어떻게 사용할까요?')).toBeVisible({ timeout: 20_000 });
  await shot(page, '1-role');

  await page.getByText('나는 곰신이에요').click();
  await shot(page, '1-role-selected');
  await page.getByRole('button', { name: '다음' }).click();

  // Step 2 — nickname
  await expect(page.getByText('어떻게 불러드리면 될까요?')).toBeVisible();
  await shot(page, '2-nickname-empty');
  await page.locator('input[type="text"]').first().fill('춘향');
  await shot(page, '2-nickname-filled');
  await page.getByRole('button', { name: '다음' }).click();

  // Step 3 — couple space
  await expect(page.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeVisible();
  await shot(page, '3-space');
  await page.getByText('초대 코드가 있어요').click();
  await shot(page, '3-space-join');

  await context.close();
});

test('capture the onboarding wizard as 군화', async ({ browser }) => {
  const context = await browser.newContext();
  await installMockBackend(context, { ...NO_SPACE, role: 'soldier', newAccount: true });
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.getByText('곰신로그를 어떻게 사용할까요?')).toBeVisible({ timeout: 20_000 });
  await page.getByText('나는 군화예요').click();
  await shot(page, 's1-role-soldier');
  await page.getByRole('button', { name: '다음' }).click();

  await expect(page.getByText('어떻게 불러드리면 될까요?')).toBeVisible();
  await page.locator('input[type="text"]').first().fill('몽룡');
  await page.getByRole('button', { name: '다음' }).click();

  await expect(page.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeVisible();
  await shot(page, 's3-space-soldier');

  await context.close();
});

test('capture the landing screen', async ({ browser }) => {
  // Signed OUT: step 0, the first thing anyone ever sees.
  const context = await browser.newContext();
  await installMockBackend(context, { ...NO_SPACE, newAccount: true });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForTimeout(2500);
  await shot(page, '0-landing');
  await context.close();
});
