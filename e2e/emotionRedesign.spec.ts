import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER, record, TODAY } from './scenarios';

/**
 * Real-browser coverage for the emotion redesign, the 군화 widget home and the
 * planning hub. BROWSER-WITH-MOCKS, like the rest of the e2e suite.
 */

const REPORTED = '일하느라 ㅈ같았는데, 손님이 먹을 것을 줘서 기분이 나아졌어';

async function openComposer(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '한줄' }).click();
  const textarea = page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?');
  await textarea.fill(REPORTED);
  await expect(page.getByTestId('emotion-chip-list')).toBeVisible({ timeout: 15_000 });
}

test('the reported sentence reads as 분노 → 행복 with no tap required', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openComposer(page);

  const list = page.getByTestId('emotion-chip-list');
  await expect(list).toContainText('분노');
  await expect(list).toContainText('행복');
  // The evidence phrase explains WHY, which is what makes opt-out fair.
  await expect(list).toContainText('“ㅈ같음”에서 읽었어요');
  // The flow preview is already there, before any interaction.
  await expect(page.getByText('분노 → 행복').first()).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});

test('✕ removes a feeling and it can be restored, all with real clicks', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await openComposer(page);

  await page.getByLabel('분노 빼기').click();
  await expect(page.getByTestId('emotion-chip-list')).not.toContainText('분노');
  await expect(page.getByTestId('emotion-chip-removed')).toBeVisible();

  await page.getByLabel('분노 다시 넣기').click();
  await expect(page.getByTestId('emotion-chip-list')).toContainText('분노');
  await context.close();
});

test('▲▼ corrects a wrong reading, and every control is a 44px target', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await openComposer(page);

  // 분노 -> ▲ -> 혐오 (one step toward the positive end of the wheel).
  await page.getByLabel('분노 대신 더 긍정적인 감정으로 바꾸기').click();
  await expect(page.getByTestId('emotion-chip-list')).toContainText('혐오');
  await expect(page.getByText('혐오 → 행복').first()).toBeVisible();

  // The remove control has to be thumb-reachable, and actually hit-testable.
  const remove = page.getByLabel('혐오 빼기');
  const box = await remove.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const reached = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x as number, y as number)?.closest('button'),
    [box!.x + box!.width / 2, box!.y + box!.height / 2],
  );
  expect(reached).toBe(true);
  await context.close();
});

test('a saved record can have its emotion flow corrected afterwards', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, {
    ...CREATOR,
    records: [
      record({
        id: 'rec-wrong',
        user_id: 'user-creator',
        log_text: '고쳐야 하는 기록',
        record_time: '09:00',
        emotion_flow: [
          { id: 'f1', group: 'joy', displayLabel: '행복', basic: 'happiness', sequence: 1, source: 'user_confirmed', visibility: 'shared' },
          { id: 'f2', group: 'sadness', displayLabel: '슬픔', basic: 'sadness', sequence: 2, source: 'user_confirmed', visibility: 'shared' },
        ],
      }),
    ],
  });
  const page = await context.newPage();
  await page.goto('/record');
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  const entry = page.getByText('고쳐야 하는 기록', { exact: true }).first();
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await entry.click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);

  // This affordance did not exist: a saved flow was permanent.
  await page.getByTestId('open-emotion-correction').click();
  await expect(page.getByTestId('emotion-correction-panel')).toBeVisible();

  await page.getByLabel('행복 대신 더 부정적인 감정으로 바꾸기').click();
  await expect(page.getByTestId('emotion-chip-list')).toContainText('놀람');
  await expect(page.getByTestId('save-emotion-correction')).toBeEnabled();
  await context.close();
});

test("군화's home leads with the briefing, and the descriptions are one tap inside it", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, PARTNER);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  /*
   * Updated with the 군화 home default, and the reason is here rather than in a
   * commit message.
   *
   * 마음 흐름 / 오늘의 요약 / 다정한 한마디 used to be default home widgets sitting
   * under the pinned briefing, so the same day was described four times in four
   * wrappers. They are not deleted: they render inside the briefing's disclosure and
   * are still offered by 위젯 추가.
   *
   * What this test now protects is stronger than the old ordering claim: the
   * confirm action -- the thing the north-star metric times -- must be reachable
   * WITHOUT opening the descriptions, and the descriptions must still be reachable
   * in one tap with the flow still ahead of the summary.
   */
  const briefing = page.getByTestId('call-briefing');
  await expect(briefing).toBeVisible();

  // The measured action is available before anything optional is expanded.
  await expect(briefing.getByRole('button', { name: /여기까지 확인/ })).toBeVisible();

  // Collapsed by default: a soldier with forty seconds never scrolls past them.
  const flow = page.getByTestId('widget-partner-emotion-flow');
  await expect(flow).toHaveCount(0);

  await briefing.getByRole('button', { name: /더 보기/ }).click();

  const summary = page.getByTestId('widget-partner-emotion-summary');
  await expect(flow).toBeVisible();
  await expect(summary).toBeVisible();

  // The relationship the original test existed to protect, at its new location.
  const flowBox = await flow.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(flowBox!.y).toBeLessThan(summaryBox!.y);

  // And the 군화 home is still editable, which it never was before the redesign.
  await expect(page.getByRole('button', { name: '새 항목 추가' })).toBeVisible();
  await context.close();
});

test('the 일정 tab exists and stays lit on 여행 and on a trip detail', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, {
    ...CREATOR,
    trips: [
      { id: 'trip-now', couple_id: 'couple-1', created_by: 'user-creator', title: '지금 여행', start_date: TODAY, end_date: TODAY, status: 'planned', created_at: `${TODAY}T00:00:00Z` },
      { id: 'trip-past', couple_id: 'couple-1', created_by: 'user-creator', title: '지난 여행', start_date: '2024-01-01', end_date: '2024-01-03', status: 'planned', created_at: '2024-01-01T00:00:00Z' },
      { id: 'trip-next', couple_id: 'couple-1', created_by: 'user-creator', title: '다음 여행', start_date: '2027-01-01', end_date: '2027-01-03', status: 'planned', created_at: '2027-01-01T00:00:00Z' },
    ],
  });
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  /**
   * Scoped to the bottom bar by its own aria-label.
   *
   * During a lazy-route swap the outgoing and incoming screens can both be in the
   * tree for a frame, and an unscoped role query hits strict mode instead of
   * retrying. Re-locating through the nav each time is both stable and a more
   * honest description of what is being asserted.
   */
  const bottomTab = (name: string) =>
    page.locator('nav[aria-label="하단 내비게이션"]').getByRole('tab', { name });

  // 일정 is reachable from the tab bar -- it had no tab at all before.
  await expect(bottomTab('일정')).toBeVisible();
  await bottomTab('일정').click();
  await page.waitForURL(/\/schedule$/, { timeout: 20_000 });
  await expect(bottomTab('일정')).toHaveAttribute('aria-selected', 'true');

  // 여행 is one tap from there, and the 일정 tab stays lit.
  await page.getByRole('tab', { name: '여행 목록' }).click();
  await page.waitForURL(/\/trips$/, { timeout: 20_000 });
  await expect(bottomTab('일정')).toHaveAttribute('aria-selected', 'true');

  // Past, present and future are all visible at once.
  await expect(page.getByTestId('trip-phase-current')).toContainText('지금 여행');
  await expect(page.getByTestId('trip-phase-upcoming')).toContainText('다음 여행');
  await expect(page.getByTestId('trip-phase-past')).toContainText('지난 여행');

  // A trip detail keeps the section lit rather than going dark.
  await page.getByTestId('trip-card-trip-now').click();
  await page.waitForURL(/\/trips\/trip-now$/, { timeout: 20_000 });
  await expect(bottomTab('일정')).toHaveAttribute('aria-selected', 'true');
  await context.close();
});
