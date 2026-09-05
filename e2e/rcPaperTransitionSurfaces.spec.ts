import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER, SHARED_LOG, TODAY } from './scenarios';

function markRow(recordId: string, actorUserId: string) {
  return {
    id: `mark-${recordId}`,
    record_id: recordId,
    couple_id: 'couple-1',
    actor_user_id: actorUserId,
    created_at: `${TODAY}T12:00:00.000Z`,
    is_completed: false,
  };
}

async function expectTouchTarget(target: Locator) {
  const box = await target.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

test('Story, Call Mode, and records recovery share the paper-home surface', async ({ browser }, testInfo) => {
  const OUT = testInfo.outputPath('screenshots');
  await mkdir(OUT, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: 'reduce',
  });
  await installMockBackend(context, {
    ...PARTNER,
    talkAboutMarks: [markRow('rec-shared', 'user-partner')],
  });
  const page = await context.newPage();

  await page.goto('/story/partner?at=rec-shared');
  const story = page.getByRole('dialog', { name: '오늘' });
  await expect(story).toBeVisible({ timeout: 20_000 });
  await expect(story).toHaveClass(/paper-texture-layer/);
  await expect(story.getByText(SHARED_LOG, { exact: true }).locator('..')).toHaveClass(/ink-box/);
  await expect(story.getByTestId('story-position')).toHaveAttribute('aria-hidden', 'true');
  await expectTouchTarget(story.getByRole('button', { name: '스토리 닫기' }));
  await expectTouchTarget(story.getByRole('button', { name: '다음 순간' }));

  await page.locator('html').evaluate((node) => node.setAttribute('data-theme', 'dark'));
  await expect(story).toHaveCSS('color', 'rgb(244, 241, 234)');
  await page.screenshot({ path: `${OUT}/story-dark-375.png`, fullPage: true });

  await page.goto('/call');
  const topic = page.getByTestId('call-mode-topic');
  await expect(topic).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.paper-texture-layer').first()).toBeVisible();
  await expect(topic.locator('.ink-box')).toBeVisible();
  await expect(topic.getByText(SHARED_LOG, { exact: true })).toBeVisible();
  await expectTouchTarget(page.getByRole('button', { name: '통화 모드 끝내기' }));
  await expectTouchTarget(topic.getByRole('button', { name: '원본 보기' }));
  await expect(page.getByTestId('call-mode-complete')).toBeEnabled();
  await expectTouchTarget(page.getByTestId('call-mode-complete'));

  await page.setViewportSize({ width: 812, height: 375 });
  await page.locator('html').evaluate((node) => node.setAttribute('data-theme', 'dark'));
  await expect(page.getByTestId('call-mode-complete')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('call-mode-complete')).toHaveCSS('background-color', 'rgb(244, 241, 234)');
  await expect(page.getByTestId('call-mode-complete')).toHaveCSS('color', 'rgb(22, 21, 26)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${OUT}/call-dark-landscape.png`, fullPage: true });
  await context.close();

  /*
    Deliberately malformed local PostgREST fixture: the real column is NOT NULL,
    so this tests fail-closed hydration, not a production row or a render crash.
    ErrorBoundary.test.tsx separately injects a genuine render exception.
  */
  const malformedRecords = [{
    id: 'broken-record',
    user_id: 'user-creator',
    couple_id: 'couple-1',
    date: TODAY,
    record_time: '10:00',
    log_text: '경계 렌더 확인',
    is_private: false,
    attachments: [],
    emotion_flow: [],
  }] as unknown as NonNullable<typeof CREATOR.records>;
  const errorContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await installMockBackend(errorContext, { ...CREATOR, records: malformedRecords });
  const errorPage = await errorContext.newPage();
  await errorPage.goto('/record?record=broken-record');

  const alert = errorPage.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(errorPage.getByRole('main')).toHaveClass(/paper-texture-layer/);
  await expect(alert).toHaveClass(/ink-box/);
  await expect(alert).toContainText('기록을 불러오지 못했어요');
  await expect(alert).toContainText('진단 코드: RECORDS-UNKNOWN');
  await expect(alert).toContainText('확인이 끝날 때까지 둘의 기록은 표시하지 않아요.');
  await expect(errorPage.getByText('경계 렌더 확인', { exact: true })).toHaveCount(0);
  await expect(errorPage.getByText(SHARED_LOG, { exact: true })).toHaveCount(0);
  const retry = alert.getByRole('button', { name: '다시 시도', exact: true });
  const logout = alert.getByRole('button', { name: '로그아웃', exact: true });
  await expectTouchTarget(retry);
  await expectTouchTarget(logout);
  await retry.focus();
  await errorPage.keyboard.press('Tab');
  await expect(logout).toBeFocused();
  await errorPage.screenshot({ path: `${OUT}/error-recovery-375.png`, fullPage: true });
  await errorPage.locator('html').evaluate((node) => node.setAttribute('data-theme', 'dark'));
  await expect(alert).toHaveCSS('color', 'rgb(244, 241, 234)');
  await errorPage.screenshot({ path: `${OUT}/error-recovery-dark-375.png`, fullPage: true });

  // A real reload must retry hydration and recover when the server becomes valid.
  let recoveredReads = 0;
  await errorContext.route('**/rest/v1/daily_records*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    recoveredReads += 1;
    return route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Range': '0-0/0' },
      json: [],
    });
  });
  await retry.click();
  await expect.poll(() => recoveredReads).toBeGreaterThan(0);
  await expect(errorPage.getByText('기록을 불러오지 못했어요', { exact: true })).toHaveCount(0);
  await expect(errorPage.getByText('경계 렌더 확인', { exact: true })).toHaveCount(0);
  const homeLink = errorPage.getByRole('navigation', { name: '하단 내비게이션' })
    .getByRole('link', { name: '홈', exact: true });
  await expect(homeLink).toBeVisible();
  await homeLink.click();
  await expect(homeLink).toHaveAttribute('aria-current', 'page');
  await errorContext.close();
});
