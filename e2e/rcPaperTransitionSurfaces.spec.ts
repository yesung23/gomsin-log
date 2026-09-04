import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER, SHARED_LOG, TODAY } from './scenarios';

const OUT = 'e2e/.artifacts/task-1-paper-surfaces';

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

test('Story, Call Mode, and crash recovery share the paper-home surface', async ({ browser }) => {
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
    so this is a safe crash injection for the boundary presentation, not evidence
    that Production can return this row.
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
  await expect(alert).toHaveClass(/paper-texture-layer/);
  await expect(alert.locator('.ink-box')).toBeVisible();
  await expect(alert).toContainText('문제가 발생했어요');
  await expect(alert).toContainText('앱을 다시 시작합니다');
  await expectTouchTarget(alert.getByRole('button', { name: '새로고침' }));
  await errorPage.screenshot({ path: `${OUT}/error-recovery-375.png`, fullPage: true });
  await errorPage.locator('html').evaluate((node) => node.setAttribute('data-theme', 'dark'));
  await expect(alert).toHaveCSS('color', 'rgb(244, 241, 234)');
  await errorPage.screenshot({ path: `${OUT}/error-recovery-dark-375.png`, fullPage: true });
  await errorContext.close();
});
