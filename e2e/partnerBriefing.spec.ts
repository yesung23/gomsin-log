import { test, expect, type BrowserContext } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { record, TODAY } from './scenarios';

function shiftCalendarDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

const MISSED_DAY = shiftCalendarDate(TODAY, -1);

const RECORDS = Array.from({ length: 8 }, (_, index) => record({
  id: `briefing-source-${index + 1}`,
  user_id: 'user-creator',
  record_date: MISSED_DAY,
  record_time: `${String(9 + index).padStart(2, '0')}:00`,
  log_text: `상대 기록 ${index + 1}`,
  created_at: `${MISSED_DAY}T${String(9 + index).padStart(2, '0')}:00:00Z`,
}));

async function openPartnerStory(context: BrowserContext, locale: 'ko' | 'en') {
  const { unrouted } = await installMockBackend(context, {
    userId: 'user-partner',
    displayName: '몽룡',
    role: 'soldier',
    coupleId: 'couple-1',
    partnerPresent: true,
    partnerUserId: 'user-creator',
    partnerName: '춘향',
    records: RECORDS,
  });
  await context.addInitScript((nextLocale) => {
    const key = 'gomsinlog.state.v2';
    const state = JSON.parse(window.localStorage.getItem(key) || '{}');
    window.localStorage.setItem(key, JSON.stringify({ ...state, locale: nextLocale }));
  }, locale);
  const page = await context.newPage();
  await page.goto('/story/partner');
  return { page, unrouted };
}

test('Partner Briefing은 8개 전체를 압축하고 정확한 원본을 유지한다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, unrouted } = await openPartnerStory(context, 'ko');

  const dialog = page.getByRole('dialog', { name: '놓친 하루' });
  const briefing = page.getByTestId('partner-briefing-card');
  await expect(briefing).toBeVisible({ timeout: 20_000 });
  await expect(briefing.getByText('순간 8개')).toBeVisible();
  await expect(dialog.getByText('1 / 10')).toBeVisible();

  const expand = briefing.getByTestId('partner-briefing-expand');
  expect((await expand.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expand.click();
  expect((await briefing.boundingBox())!.y).toBeGreaterThanOrEqual(70);
  const originals = briefing.getByRole('button', { name: '원본 보기' });
  await expect(originals).toHaveCount(8);
  expect((await briefing.boundingBox())!.y).toBeGreaterThanOrEqual(70);
  for (const button of await originals.all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: 'ui-audit-results/partner-briefing/ko-8-expanded-390-current.png',
  });

  await originals.first().click();
  await expect(page).toHaveURL(/\/record\?record=briefing-source-1$/);
  expect(unrouted, `unrouted supabase calls: ${unrouted.join(', ')}`).toEqual([]);
  await context.close();
});

test('Partner Briefing은 저장된 영어 언어 설정으로 렌더링된다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, unrouted } = await openPartnerStory(context, 'en');

  const briefing = page.getByTestId('partner-briefing-card');
  await expect(briefing.getByText('Since you last checked')).toBeVisible({ timeout: 20_000 });
  await expect(briefing.getByText('8 moments')).toBeVisible();
  const expand = briefing.getByRole('button', { name: 'See details' });
  expect((await expand.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expand.click();
  expect((await briefing.boundingBox())!.y).toBeGreaterThanOrEqual(70);
  await expect(briefing.getByRole('button', { name: 'View original' })).toHaveCount(8);
  expect((await briefing.boundingBox())!.y).toBeGreaterThanOrEqual(70);
  await page.screenshot({
    path: 'ui-audit-results/partner-briefing/en-8-expanded-390-current.png',
  });

  expect(unrouted, `unrouted supabase calls: ${unrouted.join(', ')}`).toEqual([]);
  await context.close();
});
