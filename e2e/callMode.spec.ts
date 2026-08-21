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
 * no tab bar, and that nothing on it offers to dial.
 *
 * The tab-bar assertion in particular is not expressible in jsdom -- it is about
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
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
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

  const entry = page.getByTestId('talk-about-call-mode');
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await entry.click();

  await expect(page).toHaveURL(/\/call$/);
  await expect(page.getByTestId('call-mode-topic')).toBeVisible();
  await expect(page.getByText(SHARED_LOG, { exact: true })).toBeVisible();

  /*
    No tab bar. This screen is used one-handed with a phone against an ear, and
    the completion control sits exactly where the tab bar would be.
  */
  await expect(page.locator('nav')).toHaveCount(0);

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

  // Hidden rather than disabled: an entry to a screen that opens on "nothing to
  // talk about" is worse than no entry.
  await expect(page.getByTestId('talk-about-call-mode')).toHaveCount(0);

  // Reached directly anyway -- a stale link, a back button -- it must not break.
  await page.goto('/call');
  await expect(page.getByTestId('call-mode-done')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('call-mode-complete')).toHaveCount(0);

  await context.close();
});
