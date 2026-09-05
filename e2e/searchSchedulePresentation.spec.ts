import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';
import { PARTNER, TODAY, record } from './scenarios';

const OUT = process.env.SHOT_DIR || './e2e/.artifacts/search-schedule-presentation';

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
] as const;

const LONG_RECORD = `기다리는날을함께준비한이야기${'아주긴한국어기록'.repeat(16)}`;
const LONG_EVENT = `함께준비하는아주긴일정제목${'돌아오는날'.repeat(12)}`;
const LONG_TASK = `빠뜨리지않고챙길아주긴할일${'준비물'.repeat(18)}`;

const PRESENTATION_SCENARIO: Scenario = {
  ...PARTNER,
  anniversaryDate: '2025-01-01',
  records: [
    record({
      id: 'long-search-record',
      user_id: PARTNER.userId,
      log_text: LONG_RECORD,
    }),
  ],
  events: [
    {
      id: 'long-schedule-event',
      couple_id: PARTNER.coupleId,
      created_by: PARTNER.userId,
      title: LONG_EVENT,
      event_type: 'visit',
      start_date: TODAY,
      end_date: null,
      is_private: false,
      talk_about: true,
      created_at: `${TODAY}T09:00:00Z`,
    },
  ],
  coupleTasks: [
    {
      id: 'long-schedule-task',
      couple_id: PARTNER.coupleId,
      created_by: PARTNER.userId,
      title: LONG_TASK,
      due_date: TODAY,
      due_time: '18:30',
      assignee_id: PARTNER.userId,
      completed: false,
      is_private: false,
      created_at: `${TODAY}T09:00:00Z`,
    },
  ],
};

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

async function open(
  browser: Browser,
  scenario: Scenario,
  viewport: { width: number; height: number },
  theme: 'light' | 'dark',
) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const { unrouted } = await installMockBackend(context, scenario);
  await context.addInitScript((value) => {
    const key = 'gomsinlog.state.v2';
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(key, JSON.stringify({ ...stored, theme: value }));
  }, theme);
  const page = await context.newPage();
  return { context, page, unrouted };
}

async function ready(page: Page) {
  await expect(page.getByRole('navigation', { name: '하단 내비게이션' }))
    .toBeVisible({ timeout: 20_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectTouchTarget(locator: ReturnType<Page['getByRole']>) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function close(context: BrowserContext, unrouted: string[]) {
  await context.close();
  expect(unrouted).toEqual([]);
}

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Search와 Schedule ${viewport.name} ${theme} presentation`, async ({ browser }) => {
      const { context, page, unrouted } = await open(
        browser,
        PRESENTATION_SCENARIO,
        { width: viewport.width, height: viewport.height },
        theme,
      );

      await page.goto('/search');
      await ready(page);
      await expect(page.getByRole('heading', { name: '찾기', level: 1 })).toBeVisible();
      await expect(page.getByTestId('soldier-service-info')).toBeVisible();
      await expectTouchTarget(page.getByRole('button', { name: '기록 남기기' }));
      await expectTouchTarget(page.getByRole('searchbox', { name: '쓴 말이나 날짜로 찾기' }));
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${OUT}/search-${viewport.name}-${theme}.png` });

      const searchbox = page.getByRole('searchbox', { name: '쓴 말이나 날짜로 찾기' });
      await searchbox.fill('기다리는날');
      await expect(page.getByRole('list', { name: '검색 결과' })).toContainText('기다리는날');
      await expectNoHorizontalOverflow(page);
      if (viewport.width === 320) {
        await page.screenshot({ path: `${OUT}/search-long-${viewport.name}-${theme}.png` });
      }

      await page.goto('/schedule');
      await ready(page);
      await expect(page.getByRole('heading', { name: '우리의 계획', level: 1 })).toBeVisible();
      await expectTouchTarget(page.getByRole('button', { name: '일정 추가' }));
      await expectTouchTarget(page.locator(`[data-cal-date="${TODAY}"]`));
      await expect(page.locator(`[data-cal-date="${TODAY}"]`)).toHaveAttribute('aria-current', 'date');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `${OUT}/schedule-${viewport.name}-${theme}.png` });

      const longEvent = page.getByText(LONG_EVENT).first();
      const longTask = page.getByText(LONG_TASK).first();
      await expect(longEvent).toBeAttached();
      await expect(longTask).toBeAttached();
      await longEvent.scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      if (viewport.width === 320) {
        await page.screenshot({ path: `${OUT}/schedule-long-${viewport.name}-${theme}.png` });
      }

      await close(context, unrouted);
    });
  }
}

test('Search와 Schedule의 empty 상태가 분명히 보인다', async ({ browser }) => {
  const empty = await open(
    browser,
    { ...PARTNER, records: [], events: [], coupleTasks: [] },
    { width: 390, height: 844 },
    'light',
  );
  await empty.page.goto('/search');
  await ready(empty.page);
  await empty.page.getByRole('searchbox', { name: '쓴 말이나 날짜로 찾기' }).fill('없는기록');
  await expect(empty.page.locator('#record-search-results [role="status"]'))
    .toContainText('그 말이 들어간 기록이 없어요');
  await empty.page.screenshot({ path: `${OUT}/search-empty-390x844-light.png` });
  await empty.page.goto('/schedule');
  await ready(empty.page);
  await expect(empty.page.getByText('다가오는 일정이 없어요.')).toBeVisible();
  await empty.page.screenshot({ path: `${OUT}/schedule-empty-390x844-light.png` });
  await close(empty.context, empty.unrouted);
});

test('Schedule의 route loading 상태가 분명히 보인다', async ({ browser }) => {
  test.setTimeout(30_000);
  const loading = await open(browser, PRESENTATION_SCENARIO, { width: 390, height: 844 }, 'light');
  try {
    await loading.page.goto('/home');
    await ready(loading.page);
    await loading.context.route('**/rest/v1/events*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fallback();
    });
    await loading.page.goto('/schedule', { waitUntil: 'domcontentloaded' });
    await expect(loading.page.getByText('일정을 불러오는 중이에요'))
      .toBeVisible({ timeout: 5_000 });
    await loading.page.screenshot({ path: `${OUT}/schedule-loading-390x844-light.png` });
  } finally {
    await loading.context.close();
  }
  expect(loading.unrouted).toEqual([]);
});

test('Schedule의 할 일 error 상태가 empty와 구분된다', async ({ browser }) => {
  const error = await open(
    browser,
    {
      ...PARTNER,
      failures: { couple_tasks: { status: 500, code: 'PGRST500', message: 'mock failure' } },
    },
    { width: 390, height: 844 },
    'light',
  );
  await error.page.goto('/schedule');
  await ready(error.page);
  await expect(error.page.getByText('할 일을 불러오지 못했어요')).toBeVisible();
  await error.page.screenshot({ path: `${OUT}/schedule-error-390x844-light.png` });
  await close(error.context, error.unrouted);
});
