import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

test('empty Home keeps both story entries and one useful next action visible', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await installMockBackend(context, { ...CREATOR, records: [], events: [], trips: [] });
  const page = await context.newPage();

  await page.goto('/home');
  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toBeVisible({ timeout: 20_000 });

  await expect(page.getByRole('button', { name: '내 스토리' })).toBeVisible();
  await expect(page.getByRole('button', { name: /의 스토리$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '이야기할 것' })).toContainText('이야기');

  const currentNeed = page.getByRole('region', { name: '지금 가장 필요한 것' });
  await expect(currentNeed).toBeVisible();
  await expect(currentNeed.getByRole('button')).toContainText('오늘 있었던 일을 가볍게 남겨볼까요');
  await expect(page.getByRole('heading', { name: /의 최근 기록$/ })).toBeVisible();
  await expect(page.getByText('오늘을 포함한 7일')).toBeVisible();
  await expect(page.getByText('최근 7일에 공유된 기록이 없어요')).toBeVisible();

  const overflow = await page.evaluate(() => (
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ));
  expect(overflow).toBeLessThanOrEqual(1);

  await context.close();
});
