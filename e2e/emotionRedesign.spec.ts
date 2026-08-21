import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, CREATOR_PENDING, PARTNER, record, TODAY } from './scenarios';

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
  /*
   * Blur, because analysis runs at a COMPOSITION BOUNDARY and not on every
   * keystroke (`onDeviceInference.ts`: `isInferenceAllowedAt('typing') === false`).
   * The old version of this helper filled the field and waited, which worked only
   * while a 300ms debounce existed to do the same job less deliberately.
   */
  await textarea.blur();
  await expect(page.getByTestId('emotion-suggestion-review')).toBeVisible({ timeout: 15_000 });
}

/** A reading's row, addressed by the feeling rather than by a generated id. */
function row(page: import('@playwright/test').Page, basic: string) {
  return page.getByTestId('emotion-suggestion-list').locator(`[data-basic="${basic}"]`);
}

test('the reading is offered as a question, and answers nothing on its own', async ({ browser }) => {
  /*
   * Replaces "reads as 분노 → 행복 with no tap required", whose premise the
   * privacy redesign deliberately inverted. PRODUCT_V3 §13: a machine reading is
   * the author's private business until an affirmative act makes it theirs, and
   * the absence of a refusal is not that act. So what this now protects is the
   * opposite of what it used to: the readings are VISIBLE and UNANSWERED, and the
   * flow preview -- which is fed only by confirmed items -- must not exist yet.
   */
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openComposer(page);

  const list = page.getByTestId('emotion-suggestion-list');
  await expect(list).toContainText('분노');
  await expect(list).toContainText('행복');
  // The evidence phrase explains WHY, which is what makes the question fair.
  await expect(list).toContainText('“ㅈ같음”에서 읽었어요');

  // Every row is unanswered, and says so in the attribute the store reads.
  await expect(row(page, 'anger')).toHaveAttribute('data-answered', 'false');
  await expect(row(page, 'happiness')).toHaveAttribute('data-answered', 'false');

  // Nothing is confirmed, so there is no flow to preview.
  await expect(page.getByText('분노 → 행복')).toHaveCount(0);

  expect(errors).toEqual([]);
  await context.close();
});

test('answering the readings is what produces the flow', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await openComposer(page);

  await page.getByTestId('emotion-suggestion-confirm-all').click();

  await expect(row(page, 'anger')).toHaveAttribute('data-answered', 'true');
  await expect(row(page, 'happiness')).toHaveAttribute('data-answered', 'true');
  // Only now does the sequence exist to be shown back.
  await expect(page.getByText('분노 → 행복').first()).toBeVisible();

  await context.close();
});

test('✕ removes a feeling and it can be restored, all with real clicks', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await openComposer(page);

  await page.getByLabel('분노 빼기').click();
  await expect(page.getByTestId('emotion-suggestion-list')).not.toContainText('분노');
  await expect(page.getByTestId('emotion-suggestion-removed')).toBeVisible();

  await page.getByLabel('분노 다시 넣기').click();
  await expect(page.getByTestId('emotion-suggestion-list')).toContainText('분노');
  await context.close();
});

test('다른 마음 corrects a wrong reading, and every control is a 44px target', async ({ browser }) => {
  /*
   * The ▲▼ stepper this used to drive is gone. Walking a valence-ordered wheel
   * one press at a time made the six feelings feel ranked, so correcting is now
   * "open the six, pick one" -- and picking is itself an answer, because someone
   * who bothered to correct a reading has plainly engaged with it.
   */
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await openComposer(page);

  const angerRow = row(page, 'anger');
  const id = await angerRow.getAttribute('data-testid');
  const candidateId = id!.replace('emotion-suggestion-', '');

  await page.getByTestId(`emotion-suggestion-change-${candidateId}`).click();
  await expect(page.getByTestId(`emotion-suggestion-picker-${candidateId}`)).toBeVisible();
  await page.getByTestId(`emotion-suggestion-option-${candidateId}-disgust`).click();

  await expect(page.getByTestId('emotion-suggestion-list')).toContainText('혐오');
  // Correcting counts as answering, so this row is now settled.
  await expect(row(page, 'disgust')).toHaveAttribute('data-answered', 'true');

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

test('one tap on 저장 saves, even though the tap itself reveals the reading', async ({ browser }) => {
  /*
   * The defect: the textarea settles the composition on blur, and settling
   * renders the review directly ABOVE the action row. Pressing 저장 blurred the
   * field, the review appeared, the button moved out from under the finger, and
   * the click was never delivered -- no toast, no request, nothing. A second tap
   * worked, which is the worst shape for this bug: it looks like the user
   * mis-tapped rather than like the app dropped their entry.
   *
   * Deliberately does NOT blur first. Blurring first is what made this pass while
   * broken, so a test that pre-blurs cannot see it.
   */
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR_PENDING);
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '한줄' }).click();
  await page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?').fill(REPORTED);

  const write = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/rest/v1/daily_records'),
    { timeout: 15_000 },
  );
  await page.getByRole('button', { name: '저장' }).click();
  await write;

  // And the composer really did hand the entry off.
  await expect(page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?')).toHaveCount(0);
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

  /*
   * Correcting a saved flow used to mean: find a collapsed button, open a second
   * editor, step through the six-emotion wheel with ▲▼, then save. That editor is
   * retired -- it justified itself by showing the evidence phrase behind each
   * machine guess, and saved records store no evidence phrase. What is left is one
   * section, already open, where the correction is a single press.
   */
  const mood = page.getByTestId('record-mood-section');
  await expect(mood).toBeVisible();

  // Two feelings, so the sequence row is shown and the picker targets the last.
  await expect(page.getByTestId('record-mood-sequence')).toBeVisible();
  await expect(page.getByTestId('record-mood-option-sadness')).toHaveAttribute(
    'data-selected',
    'true',
  );

  // One press replaces it. No confirm step: the record is the author's own.
  await page.getByTestId('record-mood-option-anger').click();
  await expect(page.getByTestId('record-mood-option-anger')).toHaveAttribute(
    'data-selected',
    'true',
  );

  // And the capability the retired editor uniquely had came with it.
  await expect(page.getByTestId('record-mood-remove')).toBeEnabled();
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
