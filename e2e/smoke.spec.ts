import { test, expect } from '@playwright/test';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';

const CREATOR: Scenario = {
  userId: 'user-creator',
  displayName: '춘향',
  role: 'gomsin',
  coupleId: 'couple-1',
  partnerPresent: true,
  partnerName: '몽룡',
};

test('the production bundle boots, authenticates and leaves onboarding', async ({ browser }) => {
  const context = await browser.newContext();
  const { unrouted } = await installMockBackend(context, CREATOR);
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const rejections: string[] = [];
  page.on('pageerror', (error) => rejections.push(String(error)));

  await page.goto('/');

  // The splash must resolve: `isReady` becomes true and a real screen renders.
  await expect(page.locator('body')).not.toBeEmpty();
  // The authenticated home surface, not the onboarding wizard.
  await expect(page.getByText('춘향', { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  expect(unrouted, `unrouted supabase calls: ${unrouted.join(', ')}`).toEqual([]);
  expect(rejections).toEqual([]);
  await context.close();
});
