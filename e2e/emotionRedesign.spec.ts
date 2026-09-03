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
  /*
    앱이 떴다는 표식은 **하단 내비게이션 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 하단 내비게이션에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  const navigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(navigation).toBeVisible({ timeout: 20_000 });
  await expect(navigation.getByRole('link')).toHaveCount(5);
  /*
    컴포저는 홈 안의 접힌 카드가 아니라 `/compose` 전체 화면이다 (V4). 홈에서 여는
    문은 스토리 레일 내 스토리에 붙은 `+` 이고, 그 접근 이름이 `기록 남기기` 다.
  */
  await page.getByRole('button', { name: '기록 남기기' }).click();
  const textarea = page.getByPlaceholder('오늘 어땠어?');
  await textarea.fill(REPORTED);
  /*
   * Blur, because analysis runs at a COMPOSITION BOUNDARY and not on every
   * keystroke (`onDeviceInference.ts`: `isInferenceAllowedAt('typing') === false`).
   * The old version of this helper filled the field and waited, which worked only
   * while a 300ms debounce existed to do the same job less deliberately.
   */
  await textarea.blur();
  /*
   * 읽기가 도착했다는 표식은 **눌린 칸**이다 (§13.1, 2026-08-23).
   *
   * 앞선 판은 `emotion-suggestion-review` -- 제안을 한 줄씩 확인하던 목록 -- 를
   * 기다렸다. V4는 그 목록을 없애고 감정 여섯을 컴포저에 늘 펼쳐 두며, 기계가 읽은
   * 것은 눌린 채로 보인다. 그러므로 "읽었는가"는 곧 "칸이 눌렸는가"다.
   */
  await expect(page.getByRole('group', { name: '오늘 마음' })).toBeVisible();
  await expect(face(page, '화났어')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
}

/** 감정 한 칸. 이름으로 부른다 -- 생성된 id 가 아니라 사람이 읽는 말이다. */
function face(page: import('@playwright/test').Page, label: string) {
  return page.getByRole('group', { name: '오늘 마음' }).getByRole('button', { name: label });
}

/*
 * §13.1 이 강제하는 네 가지 (PRODUCT_V3, 2026-08-23 개정).
 *
 * 개정은 "제안 하나하나에 확인 동작" 을 "저장하는 순간 화면이 말하고 있었다" 로
 * 바꿨다. 그 교환이 성립하려면 아래 넷이 **전부** 참이어야 한다. 하나라도 깨지면
 * §13 이 막으려던 것 -- 보이지 않는 기본값이 파트너에게 가는 것 -- 이 돌아온다.
 * 그래서 넷을 각각 테스트 하나로 둔다.
 */

test('§13.1-1 읽은 것은 눌린 채로 보이고, 눌린 것만 저장된다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  /*
    쓰기를 관찰하는 테스트는 **연결 전 소유자** 상태를 쓴다.

    연결된 커플의 온라인 저장은 실제 E2EE 의식이 바닥을 확정하기 전까지
    `protection_required` 로 거절되고, 거절은 POST 를 아예 내지 않는다 -- 그러면
    payload 를 볼 수 없다. 여기서 보려는 것은 보호 경로가 아니라 **무엇이 실려
    나가는가**이므로 합법적으로 저장이 되는 상태를 쓴다.
  */
  const { dailyRecordWrites } = await installMockBackend(context, CREATOR_PENDING);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openComposer(page);

  // 읽은 것은 눌려 있고, 읽지 않은 것은 눌려 있지 않다 -- 여섯이 모두 보이는 채로.
  await expect(face(page, '화났어')).toHaveAttribute('aria-pressed', 'true');
  await expect(face(page, '기뻤어')).toHaveAttribute('aria-pressed', 'true');
  await expect(face(page, '걱정됐어')).toHaveAttribute('aria-pressed', 'false');
  await expect(face(page, '놀랐어')).toBeVisible();

  await page.getByRole('button', { name: '남기기', exact: true }).click();
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });

  /*
    저장된 목록이 화면에 눌려 있던 목록과 **정확히** 같다. 숨은 칸에서 하나가 더
    따라오면 사용자가 본 적 없는 감정이 파트너에게 가는 것이고, 그것이 개정 전후를
    막론하고 §13 이 금지하는 유일한 일이다.
  */
  expect(dailyRecordWrites.length).toBe(1);
  const flow = dailyRecordWrites[0].emotion_flow as Array<Record<string, unknown>>;
  expect(flow.map((item) => item.displayLabel).sort()).toEqual(['화났어', '기뻤어'].sort());

  expect(errors).toEqual([]);
  await context.close();
});

test('§13.1-2 끈 칸을 앱이 다시 켜지 않는다 — 글을 고쳐 다시 읽혀도', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { dailyRecordWrites } = await installMockBackend(context, CREATOR_PENDING);
  const page = await context.newPage();
  await openComposer(page);

  // 한 번의 탭으로 끈다.
  await face(page, '화났어').click();
  await expect(face(page, '화났어')).toHaveAttribute('aria-pressed', 'false');

  /*
    그리고 글을 고쳐 **읽기를 다시 일으킨다.**

    이것이 이 테스트의 전부다. 후보 목록만 비교하면 새 후보가 올 때마다 꺼 놓은 칸이
    되살아나고, 되살아난 칸은 사용자가 본 적 없는 상태다 -- 저장 순간에 화면이 말하고
    있었다는 §13.1 의 근거가 바로 거기서 무너진다.
  */
  const textarea = page.getByPlaceholder('오늘 어땠어?');
  await textarea.fill(`${REPORTED} 그리고 오늘은 좀 무서웠어`);
  await textarea.blur();
  await page.waitForTimeout(1_500);

  await expect(face(page, '화났어')).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: '남기기', exact: true }).click();
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });

  const flow = dailyRecordWrites[0].emotion_flow as Array<Record<string, unknown>>;
  expect(flow.map((item) => item.displayLabel)).not.toContain('화났어');
  await context.close();
});

test('§13.1-3 감정만 따로 공개하는 길은 없다 — 상한은 기록의 공개 범위다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await openComposer(page);

  /*
    개정의 다른 절반은 `상대에게도 이 마음 보여주기` 스위치를 없앤 것이다. 없앤 대가로
    **기록의 공개 범위가 감정의 상한**이 되어야 하고, 그러려면 감정에만 걸리는 공개
    설정이 화면 어디에도 없어야 한다. 하나라도 남아 있으면 글과 감정이 어긋난 상태가
    생기고, 그 상태는 사용자도 상대도 무엇을 뜻하는지 알 수 없다.

    이 화면에서 공개 범위를 정하는 곳은 정확히 하나다.
  */
  await expect(page.getByRole('radiogroup')).toHaveCount(1);
  await expect(page.getByRole('radiogroup', { name: '누가 볼 수 있나' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(2);

  // 그리고 그 하나는 실제로 움직인다.
  await expect(page.getByRole('radio', { name: '우리에게 공유' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '나만 보기' }).click();
  await expect(page.getByRole('radio', { name: '나만 보기' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: '우리에게 공유' })).toHaveAttribute('aria-checked', 'false');

  /*
    감정 여섯은 그 사이에도 그대로 눌려 있다 -- 공개 범위를 바꾸는 것이 감정을 지우거나
    되살리지 않는다. 저장되는 값이 `author_only` 로 따라가는 것은 순수한 파생이라
    `composeEmotionVisibility.test.tsx` 가 소유한다.
  */
  await expect(face(page, '화났어')).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test('§13.1-4 저장하지 않은 글에서 읽은 감정은 아무 데도 남지 않는다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { dailyRecordWrites } = await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await openComposer(page);

  // 읽혔지만 저장하지 않고 나간다.
  await page.getByRole('button', { name: '닫기' }).click();
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });

  expect(dailyRecordWrites.length, '저장하지 않았는데 쓰기가 나갔다').toBe(0);

  /*
    그리고 기기에도 남지 않는다. 초안은 글과 공개 범위만 메모리에 들고 있고 감정은
    들지 않으므로, 다시 열면 여섯 칸은 처음 상태여야 한다.
  */
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(stored.local).not.toContain('화났어');
  expect(stored.session).not.toContain('화났어');

  await page.reload();
  await page.getByRole('button', { name: '기록 남기기' }).click();
  await expect(page.getByRole('group', { name: '오늘 마음' })).toBeVisible();
  await expect(face(page, '화났어')).toHaveAttribute('aria-pressed', 'false');
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
  /*
    앱이 떴다는 표식은 **하단 내비게이션 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 하단 내비게이션에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  const navigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(navigation).toBeVisible({ timeout: 20_000 });
  await expect(navigation.getByRole('link')).toHaveCount(5);
  await page.getByRole('button', { name: '기록 남기기' }).click();
  await page.getByPlaceholder('오늘 어땠어?').fill(REPORTED);

  const write = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/rest/v1/daily_records'),
    { timeout: 15_000 },
  );
  // 인스타의 `공유` 자리. `기록 남기기` 와 이름이 겹치므로 정확히 일치시킨다.
  await page.getByRole('button', { name: '남기기', exact: true }).click();
  await write;

  // And the composer really did hand the entry off.
  await expect(page.getByPlaceholder('오늘 어땠어?')).toHaveCount(0);
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
          { id: 'f1', group: 'joy', displayLabel: '기뻤어', basic: 'happiness', sequence: 1, source: 'user_confirmed', visibility: 'shared' },
          { id: 'f2', group: 'sadness', displayLabel: '속상했어', basic: 'sadness', sequence: 2, source: 'user_confirmed', visibility: 'shared' },
        ],
      }),
    ],
  });
  const page = await context.newPage();
  await page.goto('/record');
  /*
    앱이 떴다는 표식은 **하단 내비게이션 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 하단 내비게이션에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  const navigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(navigation).toBeVisible({ timeout: 20_000 });
  await expect(navigation.getByRole('link')).toHaveCount(5);

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

test("군화의 홈은 곰신과 같은 화면이고, 먼저 가리키는 링만 다르다", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, PARTNER);
  const page = await context.newPage();
  await page.goto('/');
  /*
    앱이 떴다는 표식은 **하단 내비게이션 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 하단 내비게이션에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  const navigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(navigation).toBeVisible({ timeout: 20_000 });
  await expect(navigation.getByRole('link')).toHaveCount(5);

  /*
   * 이 테스트가 지키던 것이 무엇이었고, 지금은 무엇인가 (2026-08-23).
   *
   * 앞선 판은 군화의 홈이 **통화 브리핑으로 시작하는가**를 지켰다. 브리핑이 상단에
   * 고정되고 마음 흐름·요약은 그 안의 펼침으로 들어가, 40초짜리 확인이 스크롤 없이
   * 끝나야 한다는 계약이었다.
   *
   * V4는 그 계약을 **다른 방법으로** 지킨다. 두 역할에게 서로 다른 화면을 주는 대신
   * 같은 화면을 주고, 먼저 누르는 링만 다르게 한다 -- 왼쪽 링의 `+` 가 곰신의 1차
   * 행동(기록), 오른쪽 링이 군화의 1차 행동(놓친 하루)이다(`HomePage.tsx`, §5.2).
   * 통화 브리핑 위젯과 위젯 편집은 그 결정과 함께 홈에서 걷혔다.
   *
   * 그래서 여기서 지키는 것은 순서가 아니라 **도달**이다: 군화가 홈을 열었을 때
   * 놓친 하루로 가는 링이 거기 있고, 아직 안 봤다고 말하고 있고, 한 번에 열리는가.
   * 이것이 꺼지면 군화의 홈은 아무 데도 가리키지 않는 화면이 된다.
   */
  const mine = page.getByRole('button', { name: '내 스토리' });
  const theirs = page.getByRole('button', { name: '춘향의 스토리' });
  await expect(mine).toBeVisible();
  await expect(theirs).toBeVisible();

  // 링은 **내 쪽의 사실**만 말한다: 아직 안 본 것이 있는가.
  await expect(theirs.locator('[data-ring]')).toHaveAttribute('data-ring', 'new');
  // 내 것은 내가 이미 아는 것이므로 안 본 것일 수 없다.
  await expect(mine.locator('[data-ring]')).toHaveAttribute('data-ring', 'seen');

  // 그리고 한 번 누르면 열린다.
  await theirs.click();
  await expect(page).toHaveURL(/\/story\/partner$/);

  /*
   * `여기까지 확인` 은 사라지지 않았다 -- **읽기의 끝으로 옮겨갔다.**
   *
   * 앞선 판에서는 브리핑에 고정된 버튼이었고, north-star 가 시간을 재는 동작이
   * 그것이었다. V4에서 CONFIRMED 를 쓰는 유일한 경로는 스토리를 끝까지 읽는 것이다
   * (`StoryRoute.confirm`). 이 동작이 없어지면 링을 끄는 방법 자체가 사라지고,
   * 군화의 홈은 영원히 "안 본 것이 있다"고 말하는 화면이 된다 -- 브리핑을 걷어낸
   * 결정이 남긴 가장 큰 위험이 그것이므로 여기서 지킨다.
   */
  const ack = page.getByTestId('story-acknowledge');
  for (let i = 0; i < 10 && (await ack.count()) === 0; i += 1) {
    await page.getByRole('button', { name: '다음 순간' }).click();
  }
  await expect(ack).toBeVisible({ timeout: 10_000 });
  await ack.click();

  // 홈으로 돌아오면 링이 더 이상 안 봤다고 말하지 않는다.
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: '춘향의 스토리' }).locator('[data-ring]'))
    .toHaveAttribute('data-ring', 'seen', { timeout: 15_000 });

  await context.close();
});

test('the 일정 destination exists and stays current on 여행 and on a trip detail', async ({ browser }) => {
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
  /*
    앱이 떴다는 표식은 **하단 내비게이션 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 하단 내비게이션에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  const navigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(navigation).toBeVisible({ timeout: 20_000 });
  await expect(navigation.getByRole('link')).toHaveCount(5);

  /**
   * Scoped to the bottom bar by its own aria-label.
   *
   * During a lazy-route swap the outgoing and incoming screens can both be in the
   * tree for a frame, and an unscoped role query hits strict mode instead of
   * retrying. Re-locating through the navigation each time is both stable and a more
   * honest description of what is being asserted.
   */
  const bottomLink = (name: string) =>
    page.getByRole('navigation', { name: '하단 내비게이션' }).getByRole('link', { name });

  // 일정 is reachable from the bottom navigation -- it had no destination link at all before.
  await expect(bottomLink('일정')).toBeVisible();
  await bottomLink('일정').click();
  await page.waitForURL(/\/schedule$/, { timeout: 20_000 });
  await expect(bottomLink('일정')).toHaveAttribute('aria-current', 'page');

  // 여행 is one tap from there, and the 일정 link stays current.
  await page.getByRole('tab', { name: '여행 목록' }).click();
  await page.waitForURL(/\/trips$/, { timeout: 20_000 });
  await expect(bottomLink('일정')).toHaveAttribute('aria-current', 'page');

  // Past, present and future are all visible at once.
  await expect(page.getByTestId('trip-phase-current')).toContainText('지금 여행');
  await expect(page.getByTestId('trip-phase-upcoming')).toContainText('다음 여행');
  await expect(page.getByTestId('trip-phase-past')).toContainText('지난 여행');

  // A trip detail keeps the section lit rather than going dark.
  await page.getByTestId('trip-card-trip-now').click();
  await page.waitForURL(/\/trips\/trip-now$/, { timeout: 20_000 });
  await expect(bottomLink('일정')).toHaveAttribute('aria-current', 'page');
  await context.close();
});
