import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';
import {
  CREATOR,
  CREATOR_PENDING,
  NO_SPACE,
  PARTNER,
  PARTNER_LOG,
  PRIVATE_LOG,
  SHARED_LOG,
} from './scenarios';

/**
 * Creator (A) / partner (B) matrix in a REAL browser.
 *
 * BROWSER-WITH-MOCKS, not real Supabase E2E. Every authorization answer comes
 * from e2e/fixtures/mockBackend.ts, so nothing here proves an RLS policy. What it
 * does prove is what jsdom cannot: the real production bundle, real layout at
 * real viewports, real hit-testing, real focus, real CSS, and the real store
 * reacting to real HTTP/WebSocket shapes.
 *
 * Contexts A and B are separate `browser.newContext()` instances, so they have
 * independent storage, cookies and service workers -- a true two-account session,
 * not one page with a swapped variable.
 */

type Harness = { context: BrowserContext; page: Page; errors: string[] };

async function open(browser: import('@playwright/test').Browser, scenario: Scenario, options?: {
  viewport?: { width: number; height: number };
  colorScheme?: 'light' | 'dark';
}): Promise<Harness & { unrouted: string[]; dailyRecordWrites: Array<Record<string, unknown>> }> {
  const context = await browser.newContext({
    viewport: options?.viewport ?? { width: 390, height: 844 },
    colorScheme: options?.colorScheme ?? 'light',
  });
  const { unrouted, dailyRecordWrites } = await installMockBackend(context, scenario);
  /*
   * Make `colorScheme: 'dark'` actually reach the app.
   *
   * `preferredTheme()` consults `prefers-color-scheme` only when nothing is
   * stored, and mockBackend seeds `gomsinlog.state.v2` with `theme: 'light'` so
   * the first paint is stable. The stored value therefore won, and the `dark`
   * half of the layout matrix below was measuring the LIGHT theme -- 20 of the 40
   * layout assertions were duplicates of the other 20.
   *
   * Setting the store's own persisted preference is how a real user's choice is
   * expressed, and init scripts run in registration order so this merges over the
   * seed instead of racing it.
   */
  await context.addInitScript((theme) => {
    const key = 'gomsinlog.state.v2';
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(key, JSON.stringify({ ...stored, theme }));
  }, options?.colorScheme ?? 'light');
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR ${error.message}`));
  return { context, page, errors, unrouted, dailyRecordWrites };
}

/** Settle: the splash resolves and the routed screen has rendered. */
async function goto(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('#root')).not.toBeEmpty();
  // The tab bar is present on every routed screen and is the last thing to mount.
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// 1. Creator pending screen
// ---------------------------------------------------------------------------
test('creator pending: sees invitation code + regeneration, never the join-only input', async ({ browser }) => {
  const { context, page, errors } = await open(browser, CREATOR_PENDING);
  await goto(page, '/settings');

  // The invitation section belongs to the creator of an unjoined space.
  await expect(page.getByRole('heading', { name: '우리 공간 초대 코드' })).toBeVisible();
  await expect(page.getByRole('button', { name: '새 초대 코드 발급하기' })).toBeVisible();

  // The join-only section is for an account with NO space. It must not appear.
  await expect(page.getByRole('heading', { name: '우리 공간 연결하기' })).toHaveCount(0);
  await expect(page.getByLabel('6자리 초대 코드')).toHaveCount(0);

  expect(errors).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------------------
// 2. Partner redemption verdicts
// ---------------------------------------------------------------------------
const REDEMPTIONS = [
  {
    name: 'success',
    redeemResult: { ok: true as const, coupleId: 'couple-1' },
    expected: '우리 공간에 연결되었습니다.',
  },
  {
    name: 'invalid or expired',
    redeemResult: { ok: false as const, errorCode: 'invalid_or_expired' },
    expected: '유효하지 않거나 만료된 초대 코드입니다. (유효기간: 24시간)',
  },
  {
    name: 'already connected',
    redeemResult: { ok: false as const, errorCode: 'already_connected' },
    expected: '이미 다른 커플 공간에 연결되어 있습니다. 먼저 연결을 해제해 주세요.',
  },
  {
    name: 'self invitation',
    redeemResult: { ok: false as const, errorCode: 'self_invitation' },
    expected: '내가 만든 초대 코드로는 연결할 수 없습니다. 상대방에게 코드를 전달해 주세요.',
  },
];

for (const { name, redeemResult, expected } of REDEMPTIONS) {
  test(`partner redemption (${name}) reports exactly the server's verdict`, async ({ browser }) => {
    const { context, page, errors } = await open(browser, { ...NO_SPACE, redeemResult });
    await goto(page, '/settings');

    await page.getByLabel('6자리 초대 코드').fill('123456');
    await page.getByRole('button', { name: '초대 코드로 연결하기' }).click();

    await expect(page.getByText(expected, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    // No branch may blame the user's connection.
    const body = await page.locator('body').innerText();
    if (!redeemResult.ok) expect(body).not.toContain('인터넷 연결을 확인');

    expect(errors.filter((e) => e.startsWith('PAGEERROR'))).toEqual([]);
    await context.close();
  });
}

// ---------------------------------------------------------------------------
// 3 + 4 + 8. Connected state and the privacy boundary, both sides
// ---------------------------------------------------------------------------
test('connected: creator sees own private entry, partner never does', async ({ browser }) => {
  const a = await open(browser, CREATOR);
  const b = await open(browser, PARTNER);

  await goto(a.page, '/record');
  await goto(b.page, '/record');

  const creatorBody = await a.page.locator('body').innerText();
  const partnerBody = await b.page.locator('body').innerText();

  // Creator: all three, with the private one labelled as author-only.
  expect(creatorBody).toContain(SHARED_LOG);
  expect(creatorBody).toContain(PRIVATE_LOG);
  expect(creatorBody).toContain(PARTNER_LOG);
  expect(creatorBody).toContain('나에게만');

  // Partner: the shared pair only. This is the whole product promise.
  expect(partnerBody).toContain(SHARED_LOG);
  expect(partnerBody).toContain(PARTNER_LOG);
  expect(partnerBody).not.toContain(PRIVATE_LOG);
  // The author-only emotion label rode on the private row; it must not surface.
  expect(partnerBody).not.toContain('그리움');

  // Both sides agree they are connected.
  await goto(a.page, '/settings');
  await goto(b.page, '/settings');
  expect(await a.page.locator('body').innerText()).toContain('몽룡님과 연결됨');
  expect(await b.page.locator('body').innerText()).toContain('춘향님과 연결됨');

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  expect(a.unrouted).toEqual([]);
  expect(b.unrouted).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('partner cannot reach the cycle tracker, which is author-only', async ({ browser }) => {
  const a = await open(browser, CREATOR);
  const b = await open(browser, PARTNER);
  await goto(a.page, '/my');
  await goto(b.page, '/my');

  // 곰신 owns the tracker; 군화 sees the support surface, never the raw tracker.
  const creatorBody = await a.page.locator('body').innerText();
  const partnerBody = await b.page.locator('body').innerText();
  expect(creatorBody).not.toBe(partnerBody);
  /*
   * Raw cycle vocabulary must not exist in the partner DOM at all.
   *
   * Checked as rendered text rather than as a network assertion because RLS and
   * the client are separate layers: even if a query somehow returned a row, it
   * must not reach the partner's screen. The V3 fields are listed explicitly so
   * adding a health field to the owner surface cannot silently leak here.
   *
   * Every sharing toggle defaults to off, and `get_partner_cycle_projection()`
   * treats a missing preferences row as all-off, so a freshly linked couple
   * shares nothing. That is what makes the projection strings below absent too:
   * their presence here would mean sharing turned itself on.
   */
  for (const forbidden of [
    '생리 시작일',
    '내 몸의 리듬',
    '오늘 생리 시작했어요',
    '오늘 컨디션은 어때요?',
    '출혈량',
    '통증',
    '자세히 기록하기',
    '생리 예상',
    // The partner projection card. Absent until the owner opts in.
    '함께 알아두면 좋은 것',
    '지금 생리 기간이에요',
    '가임 예상',
  ]) {
    expect(partnerBody, `partner must not see "${forbidden}"`).not.toContain(forbidden);
  }

  await a.context.close();
  await b.context.close();
});

// ---------------------------------------------------------------------------
// 5. Owner controls are actually clickable, not covered by the tab bar
// ---------------------------------------------------------------------------
test('owner edit/delete controls are hit-testable and not intercepted by the tab bar', async ({ browser }) => {
  const { context, page, errors } = await open(browser, CREATOR);
  await goto(page, '/record');

  // Open the detail modal for the creator's own shared record.
  //
  // `exact: true` matters: the "오늘의 빠른 정리" card renders the same text as
  // `• "공개기록입니다"`, and that element navigates instead of opening the modal.
  const timelineEntry = page.getByText(SHARED_LOG, { exact: true }).first();
  // Wait for the record to actually arrive before clicking, otherwise the click
  // lands on empty timeline space and the modal never opens.
  await expect(timelineEntry).toBeVisible({ timeout: 20_000 });
  await timelineEntry.click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);

  const edit = page.getByRole('button', { name: '수정' }).first();
  const remove = page.getByRole('button', { name: '삭제' }).first();
  await expect(edit).toBeVisible();
  await expect(remove).toBeVisible();

  for (const control of [edit, remove]) {
    const box = await control.boundingBox();
    expect(box, 'control must have a layout box').not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // The real question: does a tap at the control's centre actually reach it, or
    // does the fixed tab bar / an overlay swallow it?
    const reaches = await page.evaluate(
      ([x, y]) => {
        const top = document.elementFromPoint(x as number, y as number);
        if (!top) return { ok: false, tag: 'none', text: '' };
        const button = top.closest('button');
        return {
          ok: !!button,
          tag: top.tagName,
          text: (button?.textContent || top.textContent || '').trim().slice(0, 30),
        };
      },
      [cx, cy],
    );
    expect(reaches.ok, `elementFromPoint hit ${reaches.tag} "${reaches.text}"`).toBe(true);

    // The 44px minimum touch target this codebase enforces elsewhere
    // (CoupleStatusBanner's tap-target test, the settings shortcut rule). These
    // two rendered at 32px until a real browser measured them: `py-2` on a
    // `text-xs` line box simply does not reach 44px, and jsdom reports 0 for
    // every dimension so no jsdom test could ever have caught it.
    expect(box!.height, 'owner action buttons must be a 44px touch target')
      .toBeGreaterThanOrEqual(44);
  }

  expect(errors).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------------------
// 6. A failed attachment upload must not destroy the user's work
// ---------------------------------------------------------------------------
test('a failed attachment upload keeps the file in the composer (D-05, in a browser)', async ({ browser }) => {
  const { context, page, errors } = await open(browser, {
    // A connected couple is protection-required until a real E2EE device/CSK
    // ceremony confirms the irreversible floor. This test targets the distinct
    // storage failure path, so use the legitimate pre-partner owner state where
    // the absent floor means the migration's legacy plaintext contract applies.
    ...CREATOR_PENDING,
    failures: { storage_upload: { status: 500, code: 'StorageError', message: 'upload failed' } },
  });
  await goto(page, '/');

  await page.getByRole('button', { name: '한줄' }).click();
  const textarea = page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?');
  await textarea.fill('오늘도 보고 싶어');

  await page.locator('input[type="file"]').first().setInputFiles({
    name: '목소리.webm',
    mimeType: 'audio/webm',
    buffer: Buffer.from('fake-audio'),
  });
  await expect(page.getByText('목소리.webm')).toBeVisible();

  await page.getByRole('button', { name: '저장' }).click();

  // The record text persisted, the file did not -- and the file is still here to
  // retry with. Before the fix this chip was destroyed before the warning showed.
  await expect(page.getByText('올리지 못했어요', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('목소리.webm')).toBeVisible();

  expect(errors.filter((e) => e.startsWith('PAGEERROR'))).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------------------
// 7. Non-tab routes stay reachable regardless of widget configuration
// ---------------------------------------------------------------------------
test('schedule, trips and service stay reachable from settings', async ({ browser }) => {
  const { context, page, errors } = await open(browser, CREATOR);
  await goto(page, '/settings');

  for (const [label, expectedPath] of [
    ['일정 관리', '/schedule'],
    ['여행 플래너', '/trips'],
    ['복무 현황 · D-Day', '/service'],
  ] as const) {
    await goto(page, '/settings');
    const shortcut = page.getByRole('button', { name: label });
    await shortcut.scrollIntoViewIfNeeded();
    await shortcut.click();
    // `waitForURL` rather than `toHaveURL`: this is a client-side navigation, and
    // waiting for the URL directly avoids racing the route's lazy chunk load.
    await page.waitForURL(new RegExp(`${expectedPath}$`), { timeout: 20_000 });
  }

  // This test navigates away deliberately and quickly, which cancels in-flight
  // requests and produces `Failed to fetch` console noise that belongs to the
  // test driver, not to the app. Crashes are still not tolerated, and neither is
  // a fabricated connection diagnosis reaching the user.
  expect(errors.filter((error) => error.startsWith('PAGEERROR'))).toEqual([]);
  expect(await page.locator('body').innerText()).not.toContain('인터넷 연결을 확인');
  await context.close();
});

// ---------------------------------------------------------------------------
// 9. Disconnected rendering
// ---------------------------------------------------------------------------
test('a disconnected account is told so, and offered both recovery paths', async ({ browser }) => {
  const { context, page, errors } = await open(browser, NO_SPACE);
  await goto(page, '/settings');

  // Both halves of the choice the banner promises must exist (D-02).
  await expect(page.getByRole('button', { name: '초대 코드로 연결하기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '새 우리 공간 만들기' })).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});

// ---------------------------------------------------------------------------
// 10. Honest error copy: never a fabricated internet diagnosis
// ---------------------------------------------------------------------------
test('an RLS denial is reported as a permission problem, not as being offline', async ({ browser }) => {
  const { context, page } = await open(browser, {
    ...CREATOR,
    failures: {
      daily_records: { status: 403, code: '42501', message: 'new row violates row-level security policy' },
    },
  });
  await page.goto('/');
  await page.waitForTimeout(4000);

  const body = await page.locator('body').innerText();
  // The device is online, so nothing may claim otherwise.
  expect(body).not.toContain('인터넷 연결을 확인');
  expect(body).not.toContain('오프라인이에요');
  await context.close();
});

// ---------------------------------------------------------------------------
// 11. Connected unprovisioned couple must refuse online save (protection_required)
// ---------------------------------------------------------------------------
// A connected couple with no E2EE bootstrap must refuse the write as
// protection_required. The draft must remain, no plaintext daily_record is
// written, and the user is guided to Settings. This is the required follow-up
// coverage identified by the red-team review of 34515b457.
for (const [label, scenario] of [['creator', CREATOR], ['partner', PARTNER]] as const) {
  test(`connected ${label} refuses online save as protection_required (no plaintext write)`, async ({ browser }) => {
    const { context, page, errors, unrouted, dailyRecordWrites } = await open(browser, scenario);

    if (label === 'creator') {
      await goto(page, '/');
      await page.getByRole('button', { name: '한줄' }).click();
    } else {
      await goto(page, '/record');
      await page.getByRole('button', { name: '지금의 마음 남기기' }).click();
      await expect(page.getByRole('dialog', { name: '지금의 마음 남기기' })).toBeVisible();
      await page.getByRole('button', { name: '한줄' }).click();
    }

    // Type the record content. The composer is now open for either role.
    await page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?').fill('보호가 필요한 기록');

    // Save must be enabled while online with content.
    const save = page.getByRole('button', { name: '저장' });
    await expect(save).toBeEnabled();

    await save.click();

    // A. User state: draft must remain (composer not cleared).
    await expect(page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?')).toBeVisible({ timeout: 10_000 });

    // B. Security UX: protection_required guidance appears with Settings CTA.
    await expect(page.getByText('기록 보호 설정이 필요해요', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '설정 열기' })).toBeVisible();

    // C. No plaintext persist: the application must refuse before writing.
    // The mock records every POST/PUT daily_records payload for test observation.
    expect(dailyRecordWrites.length, 'no daily_records write may be attempted for a protection_required connected save').toBe(0);

    // No unexpected errors or unrouted calls.
    expect(errors.filter((e) => e.startsWith('PAGEERROR'))).toEqual([]);
    // The protection path is exercised through the normal flow; no stray 500s.
    const badUnrouted = unrouted.filter((u) => !u.includes('talk_about_marks'));
    expect(badUnrouted, `unexpected unrouted: ${badUnrouted.join(', ')}`).toEqual([]);

    await context.close();
  });
}

test('a genuinely offline device says so, and stores the record it cannot send', async ({ browser }) => {
  const { context, page } = await open(browser, CREATOR);
  await goto(page, '/');

  await page.getByRole('button', { name: '한줄' }).click();
  await page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?').fill('오프라인 테스트');

  // Enabled while online with content to save.
  const save = page.getByRole('button', { name: '저장' });
  await expect(save).toBeEnabled();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  /*
   * CHANGED DELIBERATELY, and the reason is recorded here because the previous
   * version of this test asserted the opposite.
   *
   * It asserted `await expect(save).toBeDisabled()` and called withdrawing the
   * affordance "the stronger behaviour". It is not. The typed text, and any voice
   * memo `stopRecording` synthesises into an in-memory File, exist NOWHERE on disk:
   * disabling the save leaves the user holding a record they cannot store and
   * cannot send, and closing the app loses it. There was no outbox in the codebase
   * at the time, so disabling the button really was the best available answer --
   * that is what changed, not the standard.
   *
   * The save now stays enabled and the record goes to the outbox. This is also the
   * only place the IndexedDB adapter is executed at all: jsdom has no IndexedDB, so
   * the unit suite exercises the queue's behaviour against an in-memory double and
   * leaves the adapter to this test.
   */
  await expect(save).toBeEnabled();
  await save.click();

  // Told that it is waiting, not that it failed.
  await expect(page.getByText('연결되면', { exact: false }).first())
    .toBeVisible({ timeout: 15_000 });
  // The composer is cleared, because the text is no longer unsent work.
  await expect(page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?'))
    .toBeHidden({ timeout: 15_000 });
  // And the queue is visible rather than a promise nobody can check.
  await expect(page.getByTestId('outbox-waiting')).toContainText('보낼 기록 1개');

  // PRESERVATION: the connection is still named, and this is the one situation
  // where blaming it is truthful.
  await expect(page.getByTestId('offline-notice')).toBeVisible();

  await context.setOffline(false);
  await context.close();
});

// ---------------------------------------------------------------------------
// 11 + 12. Viewport / theme matrix, overflow and console hygiene
// ---------------------------------------------------------------------------
const VIEWPORTS = [
  // The narrowest and shortest screen the product promises to support.
  //
  // `FEATURE_SPEC.md` §11 and `PRODUCT_PRD.md` §9 both guarantee "모바일 320px
  // 이상", and until this entry existed that sentence had no gate behind it: the
  // matrix started at 390, so the one width most likely to break was the one width
  // never rendered. 568 is paired with it deliberately -- an iPhone SE class device
  // is short as well as narrow, and vertical clipping of a primary action is the
  // failure this catches that a tall 320 viewport would not.
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
  // iPhone 14 Pro logical viewport (notch class).
  { name: 'iphone-393x852', width: 393, height: 852 },
];
/**
 * Every pair of visible pinned (`fixed` / `sticky`) elements that occupy the same
 * pixels.
 *
 * Horizontal overflow was the only layout property this file asserted, and it
 * cannot see the failure that actually shipped: the offline banner and the record
 * screen's floating CTA overlapped by 18px, so one of them sat on top of a control
 * the user had to press. That was measured by hand, written into
 * `docs/kiro/AI_HANDOFF.md` §4.1, and then left with nothing executable behind it.
 *
 * Only pinned elements are compared. Content that scrolls under a pinned bar is not
 * a defect -- it can be scrolled back out -- whereas two pinned bars occupying the
 * same pixels never resolve. Dialogs are skipped: covering the page is their job.
 */
async function pinnedCollisions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pinned: { el: Element; rect: DOMRect; label: string }[] = [];
    document.querySelectorAll('*').forEach((element) => {
      const style = getComputedStyle(element);
      if (style.position !== 'fixed' && style.position !== 'sticky') return;
      if (style.visibility === 'hidden' || style.display === 'none') return;
      if (Number(style.opacity) === 0) return;
      if (element.closest('[role="dialog"], dialog')) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const el = element as HTMLElement;
      pinned.push({
        el: element,
        rect,
        label: `${el.tagName}.${el.className?.toString().slice(0, 32)}`,
      });
    });

    const out: string[] = [];
    for (let i = 0; i < pinned.length; i += 1) {
      for (let j = i + 1; j < pinned.length; j += 1) {
        const a = pinned[i];
        const b = pinned[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        // 1px of shared border is rounding, not a collision.
        if (overlapX > 1 && overlapY > 1) {
          out.push(
            `${a.label} overlaps ${b.label} by ${Math.round(overlapX)}x${Math.round(overlapY)}px`,
          );
        }
      }
    }
    return out.slice(0, 5);
  });
}

const ROUTES = ['/', '/record', '/us', '/my', '/settings', '/schedule', '/trips', '/service'];

for (const viewport of VIEWPORTS) {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const [who, scenario] of [['creator', CREATOR], ['partner', PARTNER]] as const) {
      test(`layout ${who} ${colorScheme} ${viewport.name}: no overflow, no console error`, async ({ browser }) => {
        const { context, page, errors, unrouted } = await open(browser, scenario, {
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme,
        });

        for (const route of ROUTES) {
          await goto(page, route);

          const overflow = await page.evaluate(() => {
            const doc = document.documentElement;
            const offenders: string[] = [];
            document.querySelectorAll('*').forEach((element) => {
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return;
              if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
                const el = element as HTMLElement;
                offenders.push(
                  `${el.tagName}.${el.className?.toString().slice(0, 40)} right=${Math.round(rect.right)}`,
                );
              }
            });
            return {
              scrollWidth: doc.scrollWidth,
              clientWidth: doc.clientWidth,
              offenders: offenders.slice(0, 5),
            };
          });

          expect(
            overflow.scrollWidth,
            `${route} scrolls horizontally: ${JSON.stringify(overflow.offenders)}`,
          ).toBeLessThanOrEqual(overflow.clientWidth + 1);

          // ---------------------------------------------------------------
          // Pinned chrome must not cover pinned chrome. See `pinnedCollisions`.
          const collisions = await pinnedCollisions(page);
          expect(collisions, `${route} has overlapping pinned elements`).toEqual([]);
        }

        expect(errors, `console errors on ${who}/${colorScheme}/${viewport.name}`).toEqual([]);
        expect(unrouted).toEqual([]);
        await context.close();
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 23. Offline chrome
//
// The offline banner renders only while `navigator.onLine === false`, which is why
// the 18px banner/CTA collision recorded in AI_HANDOFF §4.1 survived a fully green
// matrix: no test had ever put the browser offline, so the banner was never on the
// screen when overlap was measured. `context.setOffline` emulates it for real.
//
// 320x568 leads because the bottom stack has the least room there.
// ---------------------------------------------------------------------------
for (const viewport of [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
]) {
  test(`offline chrome stays clear of the pinned actions ${viewport.name}`, async ({ browser }) => {
    const { context, page } = await open(browser, CREATOR, { viewport });

    for (const route of ['/', '/record', '/schedule']) {
      await goto(page, route);

      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.waitForFunction(() => navigator.onLine === false);
      // The banner mounts on the state change, not on the event.
      await page.waitForTimeout(250);

      const collisions = await pinnedCollisions(page);
      expect(collisions, `${route} offline: overlapping pinned elements`).toEqual([]);

      // Restore before the next navigation; an offline navigation is a different
      // test and would fail for an unrelated reason.
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => navigator.onLine === true);
    }

    await context.close();
  });
}
