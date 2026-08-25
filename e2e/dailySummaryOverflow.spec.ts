import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { TODAY, record } from './scenarios';

const PARTNER_RECORDS = Array.from({ length: 8 }, (_, index) => record({
  id: `partner-summary-${index}`,
  user_id: 'user-creator',
  record_time: `${String(9 + index).padStart(2, '0')}:00`,
  log_text: `오늘의 기록 ${index + 1}`,
}));

test('파트너 오늘 8개는 5개에서 펼쳐지고 확장 줄도 정확한 원본을 연다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { unrouted } = await installMockBackend(context, {
    userId: 'user-partner',
    displayName: '몽룡',
    role: 'soldier',
    coupleId: 'couple-1',
    partnerPresent: true,
    partnerUserId: 'user-creator',
    partnerName: '춘향',
    records: PARTNER_RECORDS,
  });
  const page = await context.newPage();

  await page.goto('/story/partner');
  const dialog = page.getByRole('dialog', { name: '춘향의 오늘' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  for (let index = 1; index <= 5; index += 1) {
    await expect(dialog.getByRole('button', { name: new RegExp(`오늘의 기록 ${index}$`) })).toBeVisible();
  }
  await expect(dialog.getByText('오늘의 기록 6')).toHaveCount(0);

  const more = dialog.getByRole('button', { name: '3개 더 보기' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await more.click();

  await expect(dialog.getByRole('button', { name: /오늘의 기록 8$/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /오늘의 기록/ })).toHaveCount(8);
  await page.screenshot({ path: './ui-audit-results/after/daily-summary-8-expanded-390.png' });

  await dialog.getByRole('button', { name: /오늘의 기록 8$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/story/partner\\?at=partner-summary-7$`));
  await expect(dialog.getByText('오늘의 기록 8', { exact: true })).toBeVisible();

  await page.goto('/story/partner');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '3개 더 보기' }).click();
  const collapse = dialog.getByRole('button', { name: '접기' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await collapse.click();
  await expect(dialog.getByText('오늘의 기록 6')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '3개 더 보기' })).toBeVisible();

  expect(unrouted, `unrouted supabase calls: ${unrouted.join(', ')}`).toEqual([]);
  await context.close();
});
