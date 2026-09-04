import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

test('empty Home keeps both story entries and one useful next action visible', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await installMockBackend(context, { ...CREATOR, records: [], events: [], trips: [] });
  const page = await context.newPage();

  await page.goto('/home');
  const bottomNavigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(bottomNavigation).toBeVisible({ timeout: 20_000 });
  await expect(bottomNavigation.getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page');

  await expect(page.getByRole('button', { name: '내 스토리' })).toBeVisible();
  await expect(page.getByRole('button', { name: /의 스토리$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '이야기할 것' })).toHaveText('');

  const currentNeed = page.getByRole('region', { name: '지금 가장 필요한 것' });
  await expect(currentNeed).toBeVisible();
  await expect(currentNeed.getByRole('button')).toContainText('오늘 한 줄 남기기');
  await expect(page.getByRole('heading', { name: /의 최근 기록$/ })).toBeVisible();
  await expect(page.getByText('최근 7일에 공유된 기록이 없어요')).toBeVisible();

  const overflow = await page.evaluate(() => (
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ));
  expect(overflow).toBeLessThanOrEqual(1);

  await context.close();
});
