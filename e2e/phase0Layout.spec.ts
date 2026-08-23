import { test, expect, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

/**
 * Three Phase 0 layout defects, measured in a real browser.
 *
 * Each was found by LOOKING at the app: the 2026-08-21 UI audit captured 112
 * screenshots and no unit test had anything to say about any of them. The guards
 * are geometric and run against the production bundle, because "does this screen
 * look finished" is not answerable from jsdom, where every element reports a
 * height of zero.
 *
 * Anchored on `data-testid` rather than on copy. These assertions are about where
 * things sit and how much room they take, and a reworded sentence should not fail
 * a layout guard.
 */

const VIEWPORT = { width: 390, height: 844 };

async function ready(page: Page) {
  /*
    앱이 떴다는 표식은 **탭바 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 탭바에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tab')).toHaveCount(5);
}

test('an empty day gives the message the space instead of leaving it blank', async ({ browser }) => {
  /*
    A day with nothing on it. This used to render a content-height card near the
    top with roughly 420px of bare background beneath it, which reads as a screen
    that failed to finish loading rather than a day nobody wrote on.

    The assertion is on the empty state's OWN height rather than on the gap below
    it: the gap is shared with whatever else the page renders underneath, so it
    would pass or fail for reasons that have nothing to do with this defect.
  */
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installMockBackend(context, { ...CREATOR, records: [] });
  const page = await context.newPage();
  await page.goto('/record');
  await ready(page);

  const empty = page.getByTestId('record-day-empty');
  await expect(empty).toBeVisible();

  const box = await empty.boundingBox();
  expect(box, 'the empty state must have a measurable box').not.toBeNull();
  expect(
    box!.height,
    `the empty day should own its share of the screen, but it was ${Math.round(box!.height)}px tall`,
  ).toBeGreaterThan(VIEWPORT.height * 0.3);

  await context.close();
});

test('the derived emotion summary renders below the records it is derived from', async ({ browser }) => {
  /*
    PRODUCT_V3 §3.1 -- 원본이 주인공이다. The app's summary of a period may not
    precede the entries it summarises. It used to open the 기록 tab, so at 320px a
    person's own writing began below the fold.
  */
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  await page.goto('/record');
  await ready(page);

  const firstRecord = page.getByText('공개기록입니다', { exact: true }).first();
  await expect(firstRecord).toBeVisible({ timeout: 20_000 });

  // Always rendered, in every one of its four states, so this cannot pass vacuously.
  const summary = page.getByTestId('emotion-flow-summary');
  await expect(summary).toHaveCount(1);

  const recordBox = await firstRecord.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(recordBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();

  expect(
    summaryBox!.y,
    'the period summary must sit below the first original record, not above it',
  ).toBeGreaterThan(recordBox!.y);

  await context.close();
});

test('a server failure never shows the user a raw diagnostic code', async ({ browser }) => {
  /*
    A person cannot act on a PostgREST code, and a screen that shows one reads as
    the app breaking rather than the server refusing. `classifyServerError` maps
    every known code to a sentence; this is the guard that the mapping is actually
    what reaches the screen.
  */
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installMockBackend(context, {
    ...CREATOR,
    failures: { daily_records: { status: 500, code: 'PGRST500', message: 'boom' } },
  });
  const page = await context.newPage();
  await page.goto('/record');
  await page.waitForTimeout(2000);

  /*
    Vendor and database codes only. `RECORDS-SERVER` is this codebase's own
    vocabulary for stage and classified kind -- it is what a support conversation
    needs and it names no backend, so it is allowed to stay. `PGRST500` is not:
    nobody outside this repository can act on it, and printing it tells any reader
    which stack this runs on, on a screen shown before anyone has authenticated.
  */
  const body = (await page.locator('body').innerText()).toUpperCase();
  for (const leak of ['PGRST', 'POSTGREST', '42501', 'SUPABASE']) {
    expect(body, `a raw diagnostic (${leak}) reached the screen`).not.toContain(leak);
  }

  await context.close();
});
