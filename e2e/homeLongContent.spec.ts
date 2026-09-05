import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, record } from './scenarios';

test('Home contains long partner names and records on the smallest supported width', async ({ browser }) => {
  const longPartnerName = '아주긴이름을사용하는사랑하는상대방';
  const longRecord = record({
    id: 'long-partner-record',
    user_id: 'user-partner',
    log_text: '긴 하루를 남겨도 문장이 화면 밖으로 밀려나지 않고 공책 안에서 자연스럽게 이어져야 해요. '.repeat(4),
  });
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  await installMockBackend(context, {
    ...CREATOR,
    partnerName: longPartnerName,
    records: [longRecord],
  });
  const page = await context.newPage();

  await page.goto('/home');
  const bottomNavigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(bottomNavigation).toBeVisible({ timeout: 20_000 });
  await expect(bottomNavigation.getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: '지금 가장 필요한 것' })).toBeVisible();
  await expect(page.getByText(longRecord.log_text)).toBeVisible();
  await expect(page.getByRole('heading', { name: `${longPartnerName}의 최근 기록` })).toBeVisible();
  await expect(page.getByText('원문 보기')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이따 이야기하기' })).toHaveText('');

  const overflow = await page.evaluate(() => (
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ));
  expect(overflow).toBeLessThanOrEqual(1);

  await context.close();
});
