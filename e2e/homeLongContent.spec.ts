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
  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('region', { name: '지금 가장 필요한 것' })).toBeVisible();
  await expect(page.getByText(longRecord.log_text)).toBeVisible();

  const overflow = await page.evaluate(() => (
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ));
  expect(overflow).toBeLessThanOrEqual(1);

  await context.close();
});
