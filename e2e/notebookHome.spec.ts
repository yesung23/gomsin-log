/**
 * Approved Notebook Home, exercised through the real /home route.
 *
 * All people, records and photos here are isolated synthetic QA fixtures. The
 * browser never contacts Production or a real Supabase project.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';
import { CREATOR, record, TODAY } from './scenarios';

const RUN_ID = process.env.GOMSINLOG_NOTEBOOK_SCREENSHOT_RUN?.trim() || 'local';
const SCREENSHOT_DIR = join(process.cwd(), 'ui-audit-results', `notebook-home-${RUN_ID}`);
const PHOTO_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photos');

const PHOTO_BY_FRAGMENT: Record<string, string> = {
  'notebook-cafe': 'cafe.jpg',
  'notebook-letter': 'letter.jpg',
  'notebook-sky': 'sky.jpg',
  'notebook-sunset': 'sunset.jpg',
  'notebook-food': 'food.jpg',
  'notebook-night': 'night.jpg',
};

const partnerRecords = [
  record({
    id: 'notebook-photo',
    user_id: 'user-partner',
    record_time: '21:08',
    log_text: '오늘 훈련 끝나고 잠깐 본 카페가 참 따뜻했어. 다음 휴가에는 같이 천천히 앉아 있자.',
    attachments: [
      { type: 'photo', name: '따뜻한 카페', path: 'couple-1/notebook-photo/notebook-cafe.jpg' },
    ],
  }),
  record({
    id: 'notebook-long',
    user_id: 'user-partner',
    record_time: '18:42',
    log_text: '오늘은 아침부터 일정이 길었는데 중간중간 네가 남겨 준 말을 떠올렸어. '.repeat(12),
  }),
  record({
    id: 'notebook-multi',
    user_id: 'user-partner',
    record_time: '12:24',
    log_text: '같이 보고 싶은 오늘의 하늘과 노을을 모아 두었어.',
    attachments: [
      { type: 'photo', name: '낮 하늘', path: 'couple-1/notebook-multi/notebook-sky.jpg' },
      { type: 'photo', name: '저녁 노을', path: 'couple-1/notebook-multi/notebook-sunset.jpg' },
      { type: 'photo', name: '밤 하늘', path: 'couple-1/notebook-multi/notebook-night.jpg' },
    ],
  }),
];

const talkMark = {
  id: 'notebook-mark',
  record_id: 'notebook-photo',
  couple_id: 'couple-1',
  actor_user_id: 'user-creator',
  created_at: `${TODAY}T21:10:00.000Z`,
  is_completed: false,
};

const NOTEBOOK_SCENARIO: Scenario = {
  ...CREATOR,
  records: partnerRecords,
  talkAboutMarks: [talkMark],
};

async function serveQaPhotos(context: BrowserContext) {
  const cache = new Map<string, Buffer>();
  await context.route('**/storage/v1/object/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || request.url().includes('/object/sign/')) {
      return route.fallback();
    }
    const filename = Object.entries(PHOTO_BY_FRAGMENT)
      .find(([fragment]) => request.url().includes(fragment))?.[1] ?? 'cafe.jpg';
    if (!cache.has(filename)) cache.set(filename, await readFile(join(PHOTO_DIR, filename)));
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: cache.get(filename)! });
  });
}

async function openNotebookHome(
  browser: Browser,
  options: {
    width: number;
    height: number;
    theme: 'light' | 'dark';
    mode?: 'horizontal' | 'vertical';
    reducedMotion?: 'reduce' | 'no-preference';
    scenario?: Scenario;
  },
) {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    colorScheme: options.theme,
    reducedMotion: options.reducedMotion ?? 'no-preference',
    hasTouch: true,
    isMobile: true,
  });
  await installMockBackend(context, options.scenario ?? NOTEBOOK_SCENARIO, { theme: options.theme });
  await context.addInitScript(({ mode }) => {
    if (mode) localStorage.setItem('gomsin.home.readingMode.v1', mode);
  }, { mode: options.mode });
  await serveQaPhotos(context);
  const page = await context.newPage();
  await page.goto('/home');
  await expect(page.getByTestId('home-core')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', options.theme);
  return { context, page };
}

async function settlePhotos(page: Page) {
  const photos = page.locator('[data-record-media-region] img');
  await expect(photos.first(), 'the intended real QA photo must render before capture')
    .toBeVisible({ timeout: 20_000 });
  await expect.poll(
    () => photos.first().evaluate((image: HTMLImageElement) => image.naturalWidth),
    { message: 'the intended real QA photo must decode before capture', timeout: 20_000 },
  ).toBeGreaterThan(0);
}

test.beforeAll(async () => mkdir(SCREENSHOT_DIR, { recursive: true }));

test('time rail opens the exact chronological source without acknowledging the story', async ({ browser }) => {
  const { context, page } = await openNotebookHome(browser, {
    width: 402, height: 874, theme: 'light',
  });
  const rail = page.getByRole('region', { name: '스토리', exact: true });
  await expect(rail.getByRole('link')).toHaveCount(3);
  expect(await rail.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href'))))
    .toEqual(['/record?record=notebook-multi', '/record?record=notebook-long', '/record?record=notebook-photo']);
  await expect(rail.getByRole('button', { name: /의 스토리/ })).toBeVisible();
  const source = rail.getByRole('link', { name: /18:42 기록 열기/ });
  const box = await source.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await source.click();
  await expect(page).toHaveURL(/\/record\?record=notebook-long$/);
  await expect(page.getByText(partnerRecords[1].log_text, { exact: true }).first()).toBeVisible();
  await context.close();
});

for (const theme of ['light', 'dark'] as const) {
  test(`text-only scrap has no photo placeholder ${theme}`, async ({ browser }) => {
    const { context, page } = await openNotebookHome(browser, {
      width: theme === 'light' ? 402 : 320, height: 874, theme,
      scenario: { ...NOTEBOOK_SCENARIO, records: [{ ...partnerRecords[1], log_text: '오늘은 잠깐 쉬면서 네 생각을 했어.' }] },
    });
    const scrap = page.locator('.notebook-home__post');
    await expect(scrap.getByText('오늘은 잠깐 쉬면서 네 생각을 했어.')).toBeVisible();
    await expect(scrap.locator('[data-record-media-region]')).toHaveCount(0);
    const panel = scrap.locator('.notebook-home__text-panel');
    await expect(panel).toHaveCSS('min-height', '0px');
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${theme === 'light' ? 402 : 320}-${theme}-text-only.png`) });
    await context.close();
  });
}

for (const shot of [
  { name: '402-light-horizontal', width: 402, height: 874, theme: 'light', mode: 'horizontal' },
  { name: '402-light-vertical', width: 402, height: 874, theme: 'light', mode: 'vertical' },
  { name: '402-dark-horizontal', width: 402, height: 874, theme: 'dark', mode: 'horizontal' },
  { name: '402-dark-vertical', width: 402, height: 874, theme: 'dark', mode: 'vertical' },
  { name: '375-light-horizontal', width: 375, height: 812, theme: 'light', mode: 'horizontal' },
  { name: '375-light-vertical', width: 375, height: 812, theme: 'light', mode: 'vertical' },
  { name: '375-dark-horizontal', width: 375, height: 812, theme: 'dark', mode: 'horizontal' },
  { name: '375-dark-vertical', width: 375, height: 812, theme: 'dark', mode: 'vertical' },
  { name: '320-light-horizontal', width: 320, height: 568, theme: 'light', mode: 'horizontal' },
  { name: '320-light-vertical', width: 320, height: 568, theme: 'light', mode: 'vertical' },
  { name: '320-dark-horizontal', width: 320, height: 568, theme: 'dark', mode: 'horizontal' },
  { name: '320-dark-vertical', width: 320, height: 568, theme: 'dark', mode: 'vertical' },
] as const) {
  test(`Notebook Home screenshot ${shot.name}`, async ({ browser }) => {
    const { context, page } = await openNotebookHome(browser, shot);
    await settlePhotos(page);

    const photo = page.locator('[data-record-media-region] img').first();
    const photoRatio = await photo.evaluate((img: HTMLImageElement) => {
      const box = img.getBoundingClientRect();
      return Math.abs(box.width / box.height - img.naturalWidth / img.naturalHeight);
    });
    expect(photoRatio, 'the scrap shows the full photo without portrait letterboxing').toBeLessThan(0.02);

    const sheet = page.getByTestId('home-core');
    await expect(sheet).toHaveCSS('position', 'relative');
    await expect(page.locator('.notebook-home__header')).toHaveCSS('position', 'sticky');
    await expect(page.getByRole('button', {
      name: shot.mode === 'horizontal' ? '세로로 읽기' : '가로로 읽기',
    })).toBeVisible();
    await expect(page.getByText(partnerRecords[0].log_text, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    if (shot.width === 402 && shot.height === 874 && shot.mode === 'horizontal') {
      const active = page.getByTestId('notebook-record-notebook-photo');
      const timeBox = await active.getByRole('link', { name: '오늘 21:08 기록 열기' }).boundingBox();
      const talkBox = await active.getByRole('button', { name: '이따 이야기하기 표시 해제' }).boundingBox();
      const navigationBox = await page.getByRole('navigation', { name: '하단 내비게이션' }).boundingBox();
      expect(timeBox, 'the short record time should have a layout box').not.toBeNull();
      expect(talkBox, 'the short record action should have a layout box').not.toBeNull();
      expect(navigationBox, 'the bottom navigation should have a layout box').not.toBeNull();
      expect(timeBox!.y + timeBox!.height).toBeLessThanOrEqual(navigationBox!.y);
      expect(talkBox!.y + talkBox!.height).toBeLessThanOrEqual(navigationBox!.y);
    }

    await page.screenshot({ path: join(SCREENSHOT_DIR, `${shot.name}.png`) });
    await context.close();
  });
}

test('horizontal/vertical modes preserve exact order, source, talk state, persistence and active id', async ({ browser }) => {
  const { context, page } = await openNotebookHome(browser, {
    width: 402,
    height: 874,
    theme: 'light',
  });
  await settlePhotos(page);

  await expect(page.getByTestId('notebook-record-notebook-photo')).toBeVisible();
  const firstArticle = page.getByTestId('notebook-record-notebook-photo');
  await expect(firstArticle.getByRole('link', { name: '오늘 21:08 기록 열기' }))
    .toHaveAttribute('href', '/record?record=notebook-photo');
  await expect(firstArticle.getByRole('button', { name: '이따 이야기하기 표시 해제' }))
    .toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '다음 기록' }).click();
  await expect(page.getByTestId('notebook-record-notebook-long')).toBeVisible();
  await page.getByRole('button', { name: '세로로 읽기' }).click();

  const verticalIds = await page.locator('[data-notebook-record-id]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-notebook-record-id'))
  ));
  expect(verticalIds).toEqual(partnerRecords.map((item) => item.id));
  await expect(page.getByTestId('notebook-record-notebook-photo')
    .getByRole('button', { name: '이따 이야기하기 표시 해제' }))
    .toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('notebook-record-notebook-multi').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: '가로로 읽기' }).click();
  await expect(page.getByTestId('notebook-record-notebook-multi')).toBeVisible();
  await expect(page.getByTestId('record-media-carousel')).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOT_DIR, '402-light-multiphoto-active.png') });

  await page.getByRole('button', { name: '세로로 읽기' }).click();
  await page.reload();
  await expect(page.getByTestId('notebook-vertical-reader')).toBeVisible({ timeout: 20_000 });
  const persisted = await page.evaluate(() => localStorage.getItem('gomsin.home.readingMode.v1'));
  expect(persisted).toBe('vertical');
  expect(persisted).not.toContain('notebook-');

  await page.evaluate(() => localStorage.setItem('gomsin.home.readingMode.v1', '{"uid":"old-user"}'));
  await page.reload();
  await expect(page.getByTestId('notebook-horizontal-reader')).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test('record swipe guards leave media, edges, pinch and outside release alone', async ({ browser }) => {
  const { context, page } = await openNotebookHome(browser, {
    width: 402,
    height: 874,
    theme: 'light',
  });
  await settlePhotos(page);
  const region = page.getByTestId('record-swipe-region');
  const media = page.locator('[data-record-media-region]').first();
  const box = await region.boundingBox();
  if (!box) throw new Error('record swipe region has no layout box');

  await media.dispatchEvent('pointerdown', {
    pointerId: 1, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.75, clientY: box.y + 180,
  });
  await media.dispatchEvent('pointerup', {
    pointerId: 1, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.25, clientY: box.y + 180,
  });
  await expect(page.getByTestId('notebook-record-notebook-photo')).toBeVisible();

  await region.dispatchEvent('pointerdown', {
    pointerId: 2, pointerType: 'touch', isPrimary: true,
    clientX: box.x + 8, clientY: box.y + 40,
  });
  await region.dispatchEvent('pointerup', {
    pointerId: 2, pointerType: 'touch', isPrimary: true,
    clientX: box.x + 110, clientY: box.y + 40,
  });
  await expect(page.getByTestId('notebook-record-notebook-photo')).toBeVisible();

  await region.dispatchEvent('pointerdown', {
    pointerId: 3, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.75, clientY: box.y + 40,
  });
  await region.dispatchEvent('pointerdown', {
    pointerId: 4, pointerType: 'touch', isPrimary: false,
    clientX: box.x + box.width * 0.7, clientY: box.y + 44,
  });
  await region.dispatchEvent('pointerup', {
    pointerId: 3, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.25, clientY: box.y + 40,
  });
  await region.dispatchEvent('pointerup', {
    pointerId: 4, pointerType: 'touch', isPrimary: false,
    clientX: box.x + box.width * 0.2, clientY: box.y + 44,
  });
  await expect(page.getByTestId('notebook-record-notebook-photo')).toBeVisible();

  await region.dispatchEvent('pointerdown', {
    pointerId: 5, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.75, clientY: box.y + 40,
  });
  await page.locator('body').dispatchEvent('pointerup', {
    pointerId: 5, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.25, clientY: box.y + 40,
  });
  await expect(page.getByTestId('notebook-record-notebook-photo')).toBeVisible();

  await region.dispatchEvent('pointerdown', {
    pointerId: 6, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.75, clientY: box.y + 40,
  });
  await region.dispatchEvent('pointerup', {
    pointerId: 6, pointerType: 'touch', isPrimary: true,
    clientX: box.x + box.width * 0.25, clientY: box.y + 44,
  });
  await expect(page.getByTestId('notebook-record-notebook-long')).toBeVisible();

  await region.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('notebook-record-notebook-multi')).toBeVisible();
  await context.close();
});

test('long text at 200%, reduced motion and keyboard controls remain readable', async ({ browser }) => {
  const { context, page } = await openNotebookHome(browser, {
    width: 320,
    height: 568,
    theme: 'dark',
    reducedMotion: 'reduce',
  });
  await page.getByRole('button', { name: '다음 기록' }).click();
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });

  const longCopy = page.getByText(partnerRecords[1].log_text, { exact: true });
  await expect(longCopy).toBeVisible();
  await expect(longCopy).toHaveCSS('white-space', 'pre-wrap');
  await expect(page.getByRole('button', { name: '이전 기록' })).toBeVisible();
  await expect(page.getByRole('button', { name: '다음 기록' })).toBeVisible();
  const callBox = await page.getByRole('button', { name: '통화 모드' }).boundingBox();
  expect(callBox, 'the existing call action must remain on-screen at 200%').not.toBeNull();
  expect(callBox!.x).toBeGreaterThanOrEqual(0);
  expect(callBox!.x + callBox!.width).toBeLessThanOrEqual(320);
  const brandGeometry = await page.locator('.notebook-home__header').evaluate((header) => {
    const brand = header.querySelector('h1')!;
    const brandBox = brand.getBoundingClientRect();
    const actionsBox = header.lastElementChild!.getBoundingClientRect();
    return { brandRight: brandBox.right, actionsLeft: actionsBox.left,
      clientWidth: brand.clientWidth, scrollWidth: brand.scrollWidth, fontSize: getComputedStyle(brand).fontSize };
  });
  await test.info().attach('320-200-brand-geometry', {
    body: JSON.stringify(brandGeometry), contentType: 'application/json',
  });
  console.info('QA 320px/200% brand geometry', brandGeometry);
  expect(brandGeometry.brandRight).toBeLessThanOrEqual(brandGeometry.actionsLeft);
  expect(brandGeometry.scrollWidth).toBeLessThanOrEqual(brandGeometry.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '320-dark-longtext-200-reduced.png'), fullPage: true });
  await context.close();
});

test('empty, loading and load-error recovery states stay truthful', async ({ browser }) => {
  const empty = await openNotebookHome(browser, {
    width: 402,
    height: 874,
    theme: 'light',
    scenario: { ...CREATOR, records: [] },
  });
  await expect(empty.page.getByText('최근 7일에 공유된 기록이 없어요')).toBeVisible();
  await empty.page.screenshot({ path: join(SCREENSHOT_DIR, '402-light-empty.png') });
  await empty.context.close();

  const loadingContext = await browser.newContext({ viewport: { width: 402, height: 874 } });
  await installMockBackend(loadingContext, NOTEBOOK_SCENARIO, { theme: 'light' });
  let releaseRecords!: () => void;
  const recordsReleased = new Promise<void>((resolve) => { releaseRecords = resolve; });
  await loadingContext.route('**/rest/v1/daily_records*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await recordsReleased;
    return route.fallback();
  });
  const loadingPage = await loadingContext.newPage();
  await loadingPage.goto('/home', { waitUntil: 'domcontentloaded' });
  await expect(loadingPage.getByText('곰신로그를 준비하고 있어요')).toBeVisible();
  await loadingPage.screenshot({ path: join(SCREENSHOT_DIR, '402-light-loading.png') });
  releaseRecords();
  await expect(loadingPage.getByTestId('home-core')).toBeVisible({ timeout: 20_000 });
  await loadingContext.close();

  const errorContext = await browser.newContext({ viewport: { width: 402, height: 874 } });
  await installMockBackend(errorContext, {
    ...NOTEBOOK_SCENARIO,
    failures: {
      daily_records: { status: 500, code: 'QA_ONLY', message: 'synthetic QA failure' },
    },
  }, { theme: 'dark' });
  const errorPage = await errorContext.newPage();
  await errorPage.goto('/home');
  const alert = errorPage.getByRole('alert');
  await expect(alert).toContainText('기록을 불러오지 못했어요', { timeout: 20_000 });
  const retry = alert.getByRole('button', { name: '다시 시도' });
  const retryBox = await retry.boundingBox();
  expect(retryBox?.height).toBeGreaterThanOrEqual(44);
  await errorPage.screenshot({ path: join(SCREENSHOT_DIR, '402-dark-error-retry.png') });
  await errorContext.close();
});
