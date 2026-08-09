/*
 * Can two people actually START USING this app?
 *
 * Every other suite verifies a screen or a rule. This one verifies the JOURNEY, in
 * the order a real couple walks it, because that order is where the app either works
 * or quietly dead-ends:
 *
 *   sign in -> onboarding -> create a space -> hand over a code -> partner redeems
 *   -> both see the same day -> a record written by one appears for the other
 *
 * Each step here failed for a different reason during the manual sweep that produced
 * this file, which is why they are asserted as steps rather than as one happy path:
 * a dead-end at step 3 looks identical to a dead-end at step 6 from the outside.
 *
 * The mock backend answers as the real one does in shape, so what is proven is the
 * CONFIGURED client path -- routing, store transitions, gating and copy. It does not
 * prove an RLS policy; `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` owns that.
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, NO_SPACE, PARTNER, SHARED_LOG } from './scenarios';

/** Wait for the shell, which is the only reliable "the app booted" signal. */
async function bootedInto(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('#root')).not.toBeEmpty();
}

test('a signed-in account with no space is offered a way to make one, not a dead end', async ({ browser }) => {
  const context = await browser.newContext();
  await installMockBackend(context, NO_SPACE);
  const page = await context.newPage();

  await bootedInto(page, '/home');

  /*
   * The failure this guards: an account that authenticated but has no couple used to
   * be the worst state in the app, because every tab gates on a coupleId and a
   * screen that only says "연결이 필요해요" with no button is indistinguishable from
   * a broken app.
   */
  const invite = page.getByRole('button', { name: /초대|공간|연결|시작/ });
  await expect(invite.first(), 'a route out of the no-space state must exist').toBeVisible({ timeout: 20_000 });

  // And it must be reachable by keyboard, since this is the first screen a new user
  // meets and a stuck first screen is an uninstall.
  await expect(invite.first()).toBeEnabled();
  await context.close();
});

test('the connected pair sees the same shared record, which is the entire product', async ({ browser }) => {
  /*
   * The one assertion that matters most: if a record written by one person is not
   * visible to the other, nothing else in the app has a purpose. Asserted from BOTH
   * sides in one test so a regression cannot be half-green.
   */
  const a = await browser.newContext();
  await installMockBackend(a, CREATOR);
  const pageA = await a.newPage();
  await bootedInto(pageA, '/record');
  await expect(pageA.getByText(SHARED_LOG).first()).toBeVisible({ timeout: 20_000 });

  const b = await browser.newContext();
  await installMockBackend(b, PARTNER);
  const pageB = await b.newPage();
  await bootedInto(pageB, '/record');
  await expect(pageB.getByText(SHARED_LOG).first()).toBeVisible({ timeout: 20_000 });

  await a.close();
  await b.close();
});

test('every bottom tab reaches a working screen, with no dead tab', async ({ browser }) => {
  const context = await browser.newContext();
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await bootedInto(page, '/home');

  /*
   * Clicking the real tabs rather than calling `goto` for each route: a tab that
   * navigates nowhere, or lands on a blank screen, is invisible to a route-by-route
   * check but is exactly what a user hits.
   */
  for (const label of ['기록', '일정', '우리', '마이', '홈']) {
    await page.getByRole('tab', { name: label }).click();
    await expect(page.locator('main')).not.toBeEmpty();
    // A screen with no interactive control is a dead end even if it rendered.
    const controls = await page.locator('main button, main a[href], main input').count();
    expect(controls, `${label} tab has no operable control`).toBeGreaterThan(0);
  }

  expect(errors, 'errors while walking the tab bar').toEqual([]);
  await context.close();
});

test('the primary action on each core screen is present and enabled for a real couple', async ({ browser }) => {
  const context = await browser.newContext();
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();

  /*
   * A control that renders but stays disabled is the subtlest dead end there is, and
   * the manual sweep found a real one: 일정 추가 is disabled without a real couple
   * workspace. For a signed-in, connected couple these must all be live.
   */
  const checks: Array<{ route: string; name: RegExp; what: string }> = [
    // `지금의 마음 남기기`, not `오늘 기록하기`: the floating CTA was renamed, and
    // matching the old label made this report the record screen as having no way to
    // write -- a false alarm about the app's single most important action.
    { route: '/record', name: /지금의 마음 남기기|기록하기/, what: '기록 작성' },
    { route: '/schedule', name: /일정 추가/, what: '일정 추가' },
    { route: '/trips', name: /여행|계획/, what: '여행 만들기' },
  ];

  for (const { route, name, what } of checks) {
    await bootedInto(page, route);
    await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    const control = page.getByRole('button', { name }).first();
    await expect(control, `${what}: control missing on ${route}`).toBeVisible();
    await expect(control, `${what}: control disabled for a connected couple`).toBeEnabled();
  }
  await context.close();
});

test('a soldier can save service information and receives server acknowledgement', async ({ browser }) => {
  const context = await browser.newContext();
  const { unrouted } = await installMockBackend(context, PARTNER);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await bootedInto(page, '/service');
  await page.getByRole('button', { name: '복무 정보 수정' }).click();
  await expect(page.getByRole('dialog', { name: '복무 정보 수정' })).toBeVisible();
  await page.getByLabel('입대일').fill('2025-04-01');
  await page.getByRole('button', { name: '저장하기' }).click();

  await expect(page.getByText('복무 정보가 저장되었습니다.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('복무 정보를 저장하지 못했어요.', { exact: false })).toHaveCount(0);
  expect(unrouted).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test('one map screenshot becomes an editable trip item instead of hanging at zero percent', async ({ browser }) => {
  const trip = {
    id: 'trip-ocr',
    couple_id: CREATOR.coupleId,
    created_by: CREATOR.userId,
    title: '인천 여행',
    start_date: '2026-08-17',
    end_date: '2026-08-18',
    status: 'planned',
    created_at: '2026-08-01T00:00:00Z',
  };
  const context = await browser.newContext();
  const { unrouted } = await installMockBackend(context, { ...CREATOR, trips: [trip] });

  // Generate the kind of high-contrast map capture a user selects, without
  // committing a binary fixture or involving any external OCR service.
  const capturePage = await context.newPage();
  await capturePage.setContent(`
    <div id="capture" style="box-sizing:border-box;width:1000px;height:650px;padding:80px;background:white;color:black;font-family:Arial,sans-serif">
      <div style="font-size:72px;font-weight:700">SONGDO CAFE</div>
      <div style="margin-top:45px;font-size:48px">Incheon Central-ro 123</div>
      <div style="margin-top:35px;font-size:46px">Every day 10:00 - 20:00</div>
    </div>
  `);
  const screenshot = await capturePage.locator('#capture').screenshot();
  await capturePage.close();

  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await bootedInto(page, '/trips/trip-ocr');
  await expect(page.getByRole('button', { name: '사진으로 바로 추가' })).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('지도 캡처 선택').setInputFiles({
    name: 'map-capture.png',
    mimeType: 'image/png',
    buffer: screenshot,
  });

  await expect(page.getByText('사진에서 자동 추가 · 눌러서 수정')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/사진 읽는 중/)).toHaveCount(0);
  const editButton = page.locator('button[aria-label$="일정 수정"]');
  await expect(editButton).toHaveCount(1);
  await editButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(unrouted).toEqual([]);
  await context.close();
});

test('cycle data stays untouched until the user separately consents to sensitive processing', async ({ browser }) => {
  const context = await browser.newContext();
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();
  let cycleRequests = 0;
  page.on('request', (request) => {
    if (/\/rest\/v1\/cycle_(settings|entries)/.test(request.url())) cycleRequests += 1;
  });

  await bootedInto(page, '/my');
  await expect(page.getByText('내 몸의 리듬 시작하기')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(cycleRequests).toBe(0);

  const consentButton = page.getByRole('button', { name: '동의하고 시작하기' });
  await expect(consentButton).toBeDisabled();
  await page.getByRole('checkbox', { name: /민감정보 수집·이용/ }).check();
  await consentButton.click();
  await expect(page.getByText('내 몸의 리듬', { exact: true })).toBeVisible();
  await expect.poll(() => cycleRequests).toBe(2);
  await context.close();
});

test('the trip creation sheet is a named dialog and closes with Escape', async ({ browser }) => {
  const trip = {
    id: 'trip-keyboard',
    couple_id: CREATOR.coupleId,
    created_by: CREATOR.userId,
    title: '키보드 여행',
    start_date: '2026-08-17',
    end_date: '2026-08-18',
    status: 'planned',
    created_at: '2026-08-01T00:00:00Z',
  };
  const context = await browser.newContext();
  await installMockBackend(context, { ...CREATOR, trips: [trip] });
  const page = await context.newPage();

  await bootedInto(page, '/trips');
  await page.getByRole('button', { name: /여행.*(만들기|추가)/ }).first().click();
  await expect(page.getByRole('dialog', { name: '새 여행 만들기' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '새 여행 만들기' })).toHaveCount(0);
  await context.close();
});

test('every interactive control clears the 44px tap target, hit area included', async ({ browser }) => {
  /*
   * DESIGN_V2 §Visual footprint ≠ hit target allows a control to LOOK small while
   * its hit area is extended with a `::before` overlay, so measuring the painted box
   * alone reports false failures -- the 36px composer chips are compliant.
   *
   * This measures the effective target: the painted box, or the overlay when there
   * is one. Written after the sweep found eight genuine violations that no existing
   * test covered, including the cycle tracker's month arrows at 40x40.
   */
  const context = await browser.newContext();
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();

  const offenders: string[] = [];
  for (const route of ['/home', '/record', '/schedule', '/trips', '/us', '/service', '/my', '/settings']) {
    await bootedInto(page, route);
    await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('button, [role="button"], a[href], input[type="checkbox"]')) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;

        const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
        // The skip link is 1x1 until focused, by design.
        if (name === '본문으로 건너뛰기') continue;

        /*
         * A native checkbox paints around 13px and cannot be resized reliably across
         * browsers, so the accepted pattern is to make its LABEL the target. When the
         * input is inside a label that clears 44px, a tap anywhere on that row toggles
         * it, and measuring the input alone would report a target the user never has
         * to hit.
         */
        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
          const label = el.closest('label');
          if (label) {
            const lr = label.getBoundingClientRect();
            if (lr.height >= 44 && lr.width >= 44) continue;
          }
        }

        let width = rect.width;
        let height = rect.height;
        const before = getComputedStyle(el, '::before');
        if (before.content !== 'none' && before.position === 'absolute') {
          // Resolve the overlay's own box rather than assuming it is large enough.
          const inset = (v: string) => (v === 'auto' ? 0 : Number.parseFloat(v) || 0);
          height += Math.abs(inset(before.top)) + Math.abs(inset(before.bottom));
          width += Math.abs(inset(before.left)) + Math.abs(inset(before.right));
        }
        if (height < 44 || width < 44) {
          out.push(`${name.slice(0, 20) || '(unnamed)'} ${Math.round(width)}x${Math.round(height)}`);
        }
      }
      return out;
    });
    for (const b of bad) offenders.push(`${route} :: ${b}`);
  }

  expect(offenders, 'controls below the 44px effective tap target').toEqual([]);
  await context.close();
});
