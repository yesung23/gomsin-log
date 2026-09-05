import { test, expect, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER, TODAY, SHARED_LOG } from './scenarios';

/**
 * 통화 모드, in a real browser.
 *
 * The completion semantics are pinned in `src/pages/CallModePage.test.tsx`, where
 * the store can be driven directly. What this file adds is that the screen is
 * actually REACHABLE and correctly shaped: that the route exists, that the entry
 * point appears only when there is something to talk about, that the screen draws
 * no bottom navigation, and that nothing on it offers to dial.
 *
 * The bottom-navigation assertion in particular is not expressible in jsdom -- it is about
 * what sits under a thumb on a 390px screen while a phone is against an ear.
 */

const VIEWPORT = { width: 390, height: 844 };

function markRow(recordId: string, actor: string) {
  return {
    id: `mark-${recordId}`,
    record_id: recordId,
    couple_id: 'couple-1',
    actor_user_id: actor,
    created_at: `${TODAY}T12:00:00.000Z`,
    is_completed: false,
  };
}

async function ready(page: Page) {
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
}

test('the call screen is reachable from the list, and shows one topic at a time', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installMockBackend(context, {
    ...CREATOR,
    talkAboutMarks: [markRow('rec-shared', 'user-creator')],
  });
  const page = await context.newPage();
  await page.goto('/');
  await ready(page);

  /*
    목록은 홈 헤더의 `이야기할 것` 아이콘 뒤에 있다 (V4). 홈이 피드가 되면서 위젯
    목록이 `/saved` 로 옮겨 갔고, 통화 모드로 가는 문도 그 목록 끝에 있다.
  */
  await page.getByRole('button', { name: '이야기할 것' }).click();
  await page.waitForURL(/\/saved$/, { timeout: 20_000 });

  const entry = page.getByTestId('talk-about-call-mode');
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await entry.click();

  await expect(page).toHaveURL(/\/call$/);
  await expect(page.getByTestId('call-mode-topic')).toBeVisible();
  await expect(page.getByText(SHARED_LOG, { exact: true })).toBeVisible();

  /*
    No bottom navigation. This screen is used one-handed with a phone against an ear, and
    the completion control sits exactly where the bottom navigation would be.
  */
  await expect(page.getByRole('navigation', { name: '하단 내비게이션' })).toHaveCount(0);

  // Nothing here offers to place the call.
  expect(await page.locator('a[href^="tel:"]').count()).toBe(0);

  await context.close();
});

test('군화 can open it too', async ({ browser }) => {
  // §8: 양쪽 역할 모두 진입할 수 있다.
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installMockBackend(context, {
    ...PARTNER,
    talkAboutMarks: [markRow('rec-shared', 'user-creator')],
  });
  const page = await context.newPage();
  await page.goto('/call');
  await ready(page).catch(() => undefined);

  await expect(page.getByTestId('call-mode-topic')).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test('with nothing marked, the entry is hidden and the screen is still safe to open', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await page.goto('/');
  await ready(page);

  /*
    Hidden rather than disabled: an entry to a screen that opens on "nothing to
    talk about" is worse than no entry.

    목록 화면에서 확인한다. 홈에서 보면 표식이 없는 것이 당연해 아무것도 지키지 못한다.
  */
  await page.goto('/saved');
  await expect(page.getByTestId('talk-about-call-mode')).toHaveCount(0);

  // Reached directly anyway -- a stale link, a back button -- it must not break.
  await page.goto('/call');
  await expect(page.getByTestId('call-mode-done')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('call-mode-complete')).toHaveCount(0);

  await context.close();
});
