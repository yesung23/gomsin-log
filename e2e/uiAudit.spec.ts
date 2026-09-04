import { test, expect, type Page } from '@playwright/test';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';
import { CREATOR, PARTNER, NO_SPACE, TODAY } from './scenarios';

/**
 * Photograph the whole app from the real production bundle.
 *
 * Not a regression suite -- it asserts almost nothing and captures a lot. It exists
 * because the checks that matter for this pass (does a screen look blank while it
 * loads, does the hierarchy read, is anything unreadable in dark) are the ones no
 * unit test can make.
 *
 * `SHOT_DIR` groups a run, so a before/after pair can be compared directly.
 */

const OUT = process.env.SHOT_DIR || './e2e/.artifacts/audit';

const TABS = [
  { path: '/home', name: 'home' },
  { path: '/search', name: 'search' },
  { path: '/diary', name: 'diary' },
  { path: '/schedule', name: 'schedule' },
  { path: '/us', name: 'us' },
];

const IPHONE_16_PRO_VIEWPORT = { width: 402, height: 874 } as const;
const SMALL_IPHONE_VIEWPORT = { width: 375, height: 667 } as const;

function shiftCalendarDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

/**
 * A context with the backend mocked and a theme chosen, and only THEN a page.
 *
 * Order matters and cost an entire wasted capture run to learn: the first version
 * created the page first and photographed the sign-in screen 37 times. Both the
 * session seeding and the theme are `addInitScript`, and the page has to be created
 * after them for the very first script evaluation to see either. `smoke.spec.ts`
 * has always done it in this order.
 */
async function boot(
  browser: import('@playwright/test').Browser,
  scenario: Scenario,
  theme: 'light' | 'dark' = 'light',
): Promise<Page> {
  const context = await browser.newContext({ viewport: IPHONE_16_PRO_VIEWPORT });
  await installMockBackend(context, scenario);
  await context.addInitScript((value) => {
    const key = 'gomsinlog.state.v2';
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(key, JSON.stringify({ ...stored, theme: value }));
  }, theme);
  return context.newPage();
}

/**
 * Wait for the app to actually be up before photographing it.
 *
 * The first version of this file waited a flat 500ms and captured the SIGN-IN
 * screen 37 times -- the store had not finished restoring the session yet, and a
 * fixed sleep is not a readiness signal. The bottom navigation only exists once `isReady` is
 * true and a real screen has rendered, so waiting for it is the honest gate.
 */
async function ready(page: Page) {
  /*
    앱이 떴다는 표식은 **하단 내비게이션 자체**다 (2026-08-23).

    이름이 아니라 **의미 구조**를 본다: `navigation` 안에 다섯 `link`가 있는가.
    보이는 라벨을 없애더라도 한국어 접근성 이름과 링크 의미는 남아야 하며, 칸 하나가
    사라지거나 링크 하나가 사라지면 여기서 걸린다.
  */
  const navigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(navigation).toBeVisible({ timeout: 20_000 });
  await expect(navigation.getByRole('link')).toHaveCount(5);
  await expect(navigation).not.toHaveAttribute('role', 'tablist');
  await expect(navigation.getByRole('tab')).toHaveCount(0);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

/** Every tab, for one role and one theme. */
for (const role of [
  { scenario: CREATOR, label: 'gomsin' },
  { scenario: PARTNER, label: 'soldier' },
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`tabs — ${role.label} ${theme}`, async ({ browser }) => {
      const page = await boot(browser, role.scenario, theme);
      for (const tab of TABS) {
        await page.goto(tab.path);
        await ready(page);
        await shot(page, `${tab.name}-${role.label}-${theme}`);
      }
      await page.context().close();
    });
  }
}

/**
 * The state this pass is actually about.
 *
 * Every backend response is held for two seconds, then the screen is photographed
 * mid-flight. A blank frame here is the defect: the app has decided it is ready and
 * has nothing to draw yet.
 */
test('loading — what the screen shows while data is still arriving', async ({ browser }) => {
  const page = await boot(browser, CREATOR);

  // Registered last, so it runs FIRST and can delay before falling through to the
  // mock backend's own handler.
  await page.context().route('**/rest/v1/**', async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.fallback();
  });

  for (const tab of TABS) {
    await page.goto(tab.path, { waitUntil: 'commit' });
    await page.waitForTimeout(700); // inside the 2s window: data has NOT landed
    await page.screenshot({ path: `${OUT}/loading-${tab.name}.png` });
  }
  await page.context().close();
});

/** Nothing recorded yet: the empty states, which a new pair sees first. */
test('empty — a connected pair with no content', async ({ browser }) => {
  const page = await boot(browser, { ...CREATOR, records: [], events: [], trips: [] });
  for (const tab of TABS) {
    await page.goto(tab.path);
    await ready(page);
    await shot(page, `empty-${tab.name}`);
  }
  await page.context().close();
});

/** A signed-in account with no partner, and a server that refuses. */
test('degraded — no couple space, and a failing table', async ({ browser }) => {
  const page = await boot(browser, NO_SPACE);
  await page.goto('/home');
  await page.waitForTimeout(1500);
  await shot(page, 'nospace-home');
  await page.goto('/us');
  await page.waitForTimeout(1200);
  await shot(page, 'nospace-us');
  await page.context().close();

  const page2 = await boot(browser, {
    ...CREATOR,
    failures: { daily_records: { status: 500, code: 'PGRST500', message: 'boom' } },
  });
  await page2.goto('/diary');
  await page2.waitForTimeout(2000);
  await shot(page2, 'error-diary');
  await page2.context().close();
});

/** Small iPhone: every primary tab must remain usable without horizontal overflow. */
test('primary tabs — small iPhone viewport', async ({ browser }) => {
  const page = await boot(browser, CREATOR);
  await page.setViewportSize(SMALL_IPHONE_VIEWPORT);

  for (const tab of TABS) {
    await page.goto(tab.path);
    await ready(page);
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return Math.max(0, doc.scrollWidth - doc.clientWidth);
    });
    expect(overflow, `${tab.path} should not overflow horizontally`).toBeLessThanOrEqual(1);
    await shot(page, `${tab.name}-gomsin-light-small`);
  }

  await page.context().close();
});

/** The sub-screens that are not tabs. */
test('sub-screens', async ({ browser }) => {
  const page = await boot(browser, CREATOR);
  for (const [path, name] of [
    ['/trips', 'trips'],
    ['/settings', 'settings'],
    ['/service', 'service'],
    ['/legal/privacy', 'legal'],
    ['/legal/terms', 'terms'],
    ['/support', 'support'],
  ] as const) {
    await page.goto(path);
    await page.waitForTimeout(900);
    await shot(page, `sub-${name}`);
  }
  await page.context().close();
});

/** Mobile 320/390 overflow and screenshot audit for public utility pages (/support and /legal/terms). */
for (const width of [320, 390] as const) {
  test(`public utility pages — /support & /legal/terms at ${width}px: no overflow and capture audit shot`, async ({ browser }) => {
    const page = await boot(browser, CREATOR);
    await page.setViewportSize({ width, height: 844 });

    for (const [path, name] of [
      ['/support', 'support'],
      ['/legal/terms', 'terms'],
    ] as const) {
      await page.goto(path);
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return Math.max(0, doc.scrollWidth - doc.clientWidth);
      });
      expect(overflow, `${path} at ${width}px should not overflow horizontally`).toBeLessThanOrEqual(1);
      await shot(page, `audit-${name}-${width}`);
    }
    await page.context().close();
  });
}

test('Home and My share the approved paper brand while onboarding keeps legal targets operable', async ({ browser }) => {
  const signedInPage = await boot(browser, CREATOR);

  await signedInPage.goto('/home');
  await ready(signedInPage);
  const homeMark = signedInPage.getByRole('img', { name: '곰신로그 브랜드 마크' });
  await expect(homeMark).toBeVisible();
  await expect(homeMark).toHaveAttribute('src', '/favicon.svg');
  await shot(signedInPage, 'brand-home');

  await signedInPage.goto('/us');
  await ready(signedInPage);
  const profileHeader = signedInPage.getByTestId('profile-sticky-header');
  await expect(profileHeader).toHaveClass(/paper-texture-layer/);
  await expect(profileHeader).toHaveClass(/sticky/);
  await shot(signedInPage, 'paper-us-header');
  await signedInPage.context().close();

  const onboardingContext = await browser.newContext({ viewport: SMALL_IPHONE_VIEWPORT });
  await installMockBackend(onboardingContext, NO_SPACE);
  await onboardingContext.addInitScript(() => window.localStorage.clear());
  const onboardingPage = await onboardingContext.newPage();
  await onboardingPage.goto('/');

  const onboardingMark = onboardingPage.getByRole('img', { name: '곰신로그 브랜드 마크' });
  await expect(onboardingMark).toBeVisible({ timeout: 20_000 });
  await expect(onboardingMark).toHaveAttribute('src', '/favicon.svg');
  const onboardingFrame = onboardingMark.locator('xpath=ancestor::*[@data-astryx-theme="gomsin"]');
  await expect(onboardingFrame).toHaveClass(/paper-texture-layer/);

  const targetSizes = await onboardingPage
    .getByRole('checkbox')
    .evaluateAll((controls) => controls.map((control) => {
      const bounds = control.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
  expect(targetSizes).toHaveLength(2);
  for (const target of targetSizes) {
    expect(target.width, 'each legal checkbox must keep a 44px-wide target').toBeGreaterThanOrEqual(44);
    expect(target.height, 'each legal checkbox must keep a 44px-tall target').toBeGreaterThanOrEqual(44);
  }

  for (const documentName of ['서비스 이용약관', '개인정보 처리방침']) {
    const documentAction = onboardingPage.getByRole('button', { name: documentName });
    const bounds = await documentAction.boundingBox();
    expect(bounds?.width ?? 0, `${documentName} must keep a 44px-wide target`).toBeGreaterThanOrEqual(44);
    expect(bounds?.height ?? 0, `${documentName} must keep a 44px-tall target`).toBeGreaterThanOrEqual(44);
  }

  const overflow = await onboardingPage.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflow, 'onboarding must not overflow after expanding legal targets').toBeLessThanOrEqual(1);
  await shot(onboardingPage, 'paper-onboarding-legal-targets');
  await onboardingContext.close();
});

test('the living garden is visually captured with the planted shared tree and exact companions', async ({ browser }) => {
  const gardenPage = await boot(browser, {
    ...CREATOR,
    anniversaryDate: shiftCalendarDate(TODAY, -99),
  });

  await gardenPage.goto('/diary/garden');
  await expect(gardenPage.getByTestId('garden-scene')).toBeVisible({ timeout: 20_000 });
  if (await gardenPage.getByRole('button', { name: '나무 심기' }).count()) {
    await gardenPage.getByRole('button', { name: '나무 심기' }).click();
  }

  await expect(gardenPage.getByTestId('garden-tree-stage-3')).toBeVisible();
  await expect(gardenPage.getByTestId('garden-exact-character-peach')).toBeVisible();
  await expect(gardenPage.getByTestId('garden-exact-character-sage')).toBeVisible();
  await expect(gardenPage.getByText(/함께한 \d+일/)).toHaveCount(0);
  await shot(gardenPage, 'living-garden');
  await gardenPage.context().close();
});
