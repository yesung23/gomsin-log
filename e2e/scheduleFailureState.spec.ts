import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

test('Schedule distinguishes an unavailable task list from an empty day', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 844 } });
  await installMockBackend(context, {
    ...CREATOR,
    failures: {
      couple_tasks: { status: 500, code: 'PGRST500', message: 'mock failure' },
    },
  });
  const page = await context.newPage();

  await page.goto('/schedule');

  await expect(page.getByText('할 일을 불러오지 못했어요')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('일정은 불러왔지만 할 일 목록은 확인하지 못했어요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '할 일 다시 시도' })).toBeVisible();
  await expect(page.getByText('선택한 날짜에 일정과 할 일이 없어요.')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '할 일 제목' })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await context.close();
});
