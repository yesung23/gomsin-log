import { test, expect } from '@playwright/test';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';
import { CREATOR, CREATOR_PENDING, NO_SPACE, TODAY } from './scenarios';

/**
 * Regression cover for the four defects found by walking the v1 journeys in a real
 * browser. BROWSER-WITH-MOCKS: every server answer comes from the fixture, so
 * nothing here proves an RLS policy.
 */

/** A genuinely new account: authenticated, but no `profiles` row yet. */
const NEW_ACCOUNT: Scenario = {
  userId: 'user-new',
  displayName: '',
  role: 'gomsin',
  coupleId: null,
  partnerPresent: false,
  newAccount: true,
  createCoupleId: 'couple-fresh',
  records: [],
};

const PLACEHOLDER = '오늘 어땠어?';

async function settle(page: import('@playwright/test').Page) {
  await expect(page.locator('#root')).not.toBeEmpty();
}

// ---------------------------------------------------------------------------
// D-1: sign-up was impossible
// ---------------------------------------------------------------------------
test('a newly signed-in account starts the wizard, not the sign-in screen again', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { unrouted } = await installMockBackend(context, NEW_ACCOUNT);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await settle(page);

  // The defect: this rendered the landing screen, whose only controls sign you in
  // again -- and step 0 has no 다음, so no new account could ever get past it.
  await expect(page.getByText('Google로 계속하기')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '곰신로그를 어떻게 사용할까요?' }))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('1 / 5')).toBeVisible();

  expect(errors).toEqual([]);
  expect(unrouted).toEqual([]);
  await context.close();
});

test('the whole wizard completes: role, nickname, space with a code, anniversary, contact hours', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, NEW_ACCOUNT);
  const page = await context.newPage();
  await page.goto('/');
  await settle(page);

  // 1 role. Five steps for 곰신 since contact hours became a question for both
  // roles -- migration 048 sends each person inside their OWN declared window,
  // so a 곰신 who was never asked would inherit a soldier's default day.
  await expect(page.getByText('1 / 5')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '다음' }).click();

  // 2 nickname
  await expect(page.getByText('2 / 5')).toBeVisible();
  const next = page.getByRole('button', { name: '다음' });
  // D-4: the button must not invite a tap it will refuse.
  await expect(next).toBeDisabled();
  await page.getByPlaceholder('예) 춘향').fill('춘향');
  await expect(next).toBeEnabled();
  await next.click();

  // 3 couple space -- minting a code keeps the user here so they can read it
  await expect(page.getByText('3 / 5')).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByText('내 초대 코드 (24시간 유효)')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('text=/^\\d{6}$/').first()).toBeVisible();

  // 4 anniversary
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByText('4 / 5')).toBeVisible();

  // 5 contact hours -- asked of 곰신 too, and phrased as what it decides for them
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByText('언제 알려드리면 좋을까요?')).toBeVisible();
  // Not the soldier's framing: a 곰신 can look any time, so the question is when
  // the app may interrupt, not when a phone is reachable.
  await expect(page.getByText('주로 언제 오늘의 로그를 확인할 수 있나요?')).toHaveCount(0);

  // This IS the last input step for both roles now, so its button says so.
  await page.getByRole('button', { name: '완료하기' }).click();
  await context.close();
});

// ---------------------------------------------------------------------------
// D-2: 마이 invented a pending invitation
// ---------------------------------------------------------------------------
const STATUS_CASES: Array<[string, Scenario, string, string[]]> = [
  ['connected', CREATOR, '몽룡님과 연결됨', ['연결 대기 중']],
  ['pending', CREATOR_PENDING, '연결 대기 중', []],
  ['no space', NO_SPACE, '아직 우리 공간이 없어요', ['연결 대기 중', '님과 연결됨']],
];

for (const [name, scenario, expected, forbidden] of STATUS_CASES) {
  test(`마이 states the real couple status (${name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await installMockBackend(context, scenario);
    const page = await context.newPage();
    await page.goto('/my');
    await settle(page);

    await expect(page.getByText(expected).first()).toBeVisible({ timeout: 20_000 });
    const body = await page.locator('body').innerText();
    for (const phrase of forbidden) {
      expect(body, `${name} must not say "${phrase}"`).not.toContain(phrase);
    }
    // Never a connection diagnosis for a membership question.
    expect(body).not.toContain('연결 상태를 확인');
    await context.close();
  });
}

// ---------------------------------------------------------------------------
// D-3: an unsent draft was thrown away on bottom navigation
// ---------------------------------------------------------------------------
test('an unsent draft survives a bottom-navigation round-trip and is never written to storage', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await page.goto('/');
  await settle(page);

  const DRAFT = '오늘 진짜 힘들었는데 네 생각하니까 나아졌어';
  /*
    V4 에서 컴포저는 홈 안에 접혀 있던 카드가 아니라 `/compose` 전체 화면이다. 여는
    문은 스토리 레일 내 스토리에 붙은 `+` 이며, 그 접근 이름이 `기록 남기기` 다.
    지키는 성질은 그대로다 -- 탭을 한 바퀴 돌아도 쓰던 글이 사라지지 않는가.
  */
  const openComposer = () => page.getByRole('button', { name: '기록 남기기' }).click();
  await openComposer();
  const field = page.getByPlaceholder(PLACEHOLDER);
  await field.fill(DRAFT);
  /*
   * Synchronise on the draft itself, not on the emotion reader.
   *
   * This used to wait for `emotion-chip-list`, which coupled a draft-persistence
   * regression to an unrelated subsystem: when the reader became
   * `emotion-suggestion-review` and moved to a composition boundary, this test
   * failed for a reason it was never written to detect. What it actually needs is
   * that the field holds the draft before navigating away.
   */
  await expect(field).toHaveValue(DRAFT);

  /*
    컴포저는 전체 화면이라 그 위에는 하단 내비게이션이 없다. 그래서 내비게이션을 도는 경로는 반드시
    한 번 닫고 시작한다 -- 실제 사용자도 그렇게 한다.
  */
  await page.getByRole('button', { name: '닫기' }).click();
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });

  const destination = (name: string) =>
    page.getByRole('navigation', { name: '하단 내비게이션' }).getByRole('link', { name });
  await destination('우리').click();
  await page.waitForURL(/\/us$/, { timeout: 20_000 });
  await destination('홈').click();
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });

  // 다시 열면 쓰던 글이 그대로 있다.
  await openComposer();
  const restored = page.getByPlaceholder(PLACEHOLDER);
  await expect(restored).toBeVisible({ timeout: 20_000 });
  await expect(restored).toHaveValue(DRAFT);

  // The diary body must never reach storage: persisted state stays a strict
  // device-preference whitelist, which is what makes a purge meaningful.
  const stored = await page.evaluate(() => ({
    v2: window.localStorage.getItem('gomsinlog.state.v2') || '',
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(stored.v2).not.toContain('힘들었는데');
  expect(stored.session).not.toContain('힘들었는데');

  /*
    ...그러므로 새로고침 뒤에는 의도적으로 없다. `/compose` 는 언제나 필드를 그리므로
    사라지는 것은 필드가 아니라 **그 안의 글**이다.
  */
  await page.reload();
  await settle(page);
  await expect(page.getByPlaceholder(PLACEHOLDER)).toHaveValue('');
  await context.close();
});

test('a saved record clears the draft instead of leaving it to be re-sent', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, {
    // Connected couples are protection-required until a real E2EE ceremony
    // confirms the floor. This regression targets successful legacy record
    // persistence and draft clearing, so use the legitimate owner-before-join
    // state rather than fabricating a trusted device or CSK in the browser mock.
    ...CREATOR_PENDING,
    trips: [{ id: 't1', couple_id: 'couple-1', created_by: 'user-creator', title: 'x', start_date: TODAY, end_date: TODAY, status: 'planned', created_at: `${TODAY}T00:00:00Z` }],
  });
  const page = await context.newPage();
  await page.goto('/');
  await settle(page);

  const openComposer = () => page.getByRole('button', { name: '기록 남기기' }).click();
  await openComposer();
  await page.getByPlaceholder(PLACEHOLDER).fill('저장될 기록');
  // V4 컴포저의 확정은 인스타의 `공유` 자리에 있는 `남기기` 다.
  await page.getByRole('button', { name: '남기기', exact: true }).click();

  // 남긴 뒤에는 컴포저가 닫히고 홈으로 돌아온다.
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });

  const destination = (name: string) =>
    page.getByRole('navigation', { name: '하단 내비게이션' }).getByRole('link', { name });
  await destination('우리').click();
  await page.waitForURL(/\/us$/, { timeout: 20_000 });
  await destination('홈').click();
  await page.waitForURL(/\/(home)?$/, { timeout: 20_000 });

  // A saved record is not unsent work, so nothing should be waiting.
  await openComposer();
  await expect(page.getByPlaceholder(PLACEHOLDER)).toHaveValue('');
  await context.close();
});
