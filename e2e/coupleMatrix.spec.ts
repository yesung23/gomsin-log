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
}): Promise<Harness & { unrouted: string[] }> {
  const context = await browser.newContext({
    viewport: options?.viewport ?? { width: 390, height: 844 },
    colorScheme: options?.colorScheme ?? 'light',
  });
  const { unrouted } = await installMockBackend(context, scenario);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR ${error.message}`));
  return { context, page, errors, unrouted };
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
  // Raw cycle inputs must not exist in the partner DOM at all.
  expect(partnerBody).not.toContain('생리 시작일');

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
    ...CREATOR,
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

test('a genuinely offline device says so, and disables the save it cannot do', async ({ browser }) => {
  const { context, page } = await open(browser, CREATOR);
  await goto(page, '/');

  await page.getByRole('button', { name: '한줄' }).click();
  await page.getByPlaceholder('지금 이 순간, 어떤 생각을 하고 있나요?').fill('오프라인 테스트');

  // Enabled while online with content to save.
  const save = page.getByRole('button', { name: '저장' });
  await expect(save).toBeEnabled();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  // The app does not merely fail the write and explain afterwards -- it withdraws
  // the affordance, which is the stronger behaviour. Asserted as such rather than
  // asserting a toast that this path deliberately never reaches.
  await expect(save).toBeDisabled();
  // ...and the reason is stated somewhere the user can see, in Korean, and it is
  // the one situation where blaming the connection is truthful.
  await expect(page.getByText('오프라인', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  await context.setOffline(false);
  await context.close();
});

// ---------------------------------------------------------------------------
// 11 + 12. Viewport / theme matrix, overflow and console hygiene
// ---------------------------------------------------------------------------
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
  // iPhone 14 Pro logical viewport (notch class).
  { name: 'iphone-393x852', width: 393, height: 852 },
];
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
        }

        expect(errors, `console errors on ${who}/${colorScheme}/${viewport.name}`).toEqual([]);
        expect(unrouted).toEqual([]);
        await context.close();
      });
    }
  }
}
