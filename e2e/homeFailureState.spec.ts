import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

test('Home explains when records cannot be loaded and keeps cached content hidden', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await installMockBackend(context, {
    ...CREATOR,
    failures: {
      daily_records: { status: 500, code: 'PGRST500', message: 'mock failure' },
    },
  });
  const page = await context.newPage();

  await page.goto('/home');
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(alert.getByRole('heading')).toHaveText('기록을 불러오지 못했어요');
  await expect(alert).toContainText('확인이 끝날 때까지 둘의 기록은 표시하지 않아요.');
  await expect(alert).toContainText('진단 코드: RECORDS-SERVER');
  await expect(page.getByText('공개기록입니다')).toHaveCount(0);
  await expect(page.getByText('파트너가남긴기록')).toHaveCount(0);

  await context.close();
});
