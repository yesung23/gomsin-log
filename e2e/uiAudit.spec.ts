import { test, expect, type Page } from '@playwright/test';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';
import { CREATOR, PARTNER, NO_SPACE } from './scenarios';

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
  { path: '/record', name: 'record' },
  { path: '/schedule', name: 'schedule' },
  { path: '/us', name: 'us' },
  { path: '/my', name: 'my' },
];

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
  const context = await browser.newContext();
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
 * fixed sleep is not a readiness signal. The tab bar only exists once `isReady` is
 * true and a real screen has rendered, so waiting for it is the honest gate.
 */
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
  await page2.goto('/record');
  await page2.waitForTimeout(2000);
  await shot(page2, 'error-record');
  await page2.context().close();
});

/** The sub-screens that are not tabs. */
test('sub-screens', async ({ browser }) => {
  const page = await boot(browser, CREATOR);
  for (const [path, name] of [
    ['/trips', 'trips'],
    ['/settings', 'settings'],
    ['/service', 'service'],
    ['/legal/privacy', 'legal'],
  ] as const) {
    await page.goto(path);
    await page.waitForTimeout(900);
    await shot(page, `sub-${name}`);
  }
  await page.context().close();
});
