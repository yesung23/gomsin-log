import { test, expect } from '@playwright/test';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';

const CREATOR: Scenario = {
  userId: 'user-creator',
  displayName: '춘향',
  role: 'gomsin',
  coupleId: 'couple-1',
  partnerPresent: true,
  partnerUserId: 'user-partner',
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
  /*
    The authenticated home surface, not the onboarding wizard.

    앞선 판은 자기 이름(`춘향`)을 찾았다. V4 의 홈은 자기 자리를 이름이 아니라
    `내 스토리` 로 부르므로 그 글자가 사라졌다. 대신 두 가지를 본다: 온보딩에는 없는
    **하단 내비게이션**이 떴는가(구조), 그리고 상대의 이름이 실제 데이터로 그려졌는가(내용).
  */
  const navigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(navigation).toBeVisible({ timeout: 20_000 });
  await expect(navigation.getByRole('link')).toHaveCount(5);
  await expect(page.getByText('몽룡', { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  expect(unrouted, `unrouted supabase calls: ${unrouted.join(', ')}`).toEqual([]);
  expect(rejections).toEqual([]);
  await context.close();
});
