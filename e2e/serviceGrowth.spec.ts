import { test, expect, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER } from './scenarios';

const OUT = 'ui-audit-results/service-growth';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

type Rgb = [number, number, number];

function cssRgb(value: string): Rgb {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
  return channels as Rgb;
}

function luminance(value: Rgb): number {
  const linear = value.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const [high, low] = [luminance(cssRgb(first)), luminance(cssRgb(second))]
    .sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
}

async function progressContrast(service: Locator): Promise<number[]> {
  const pairs = await service.getByRole('progressbar').evaluateAll((bars) => bars.map((bar) => {
    const fill = bar.firstElementChild;
    if (!(bar instanceof HTMLElement) || !(fill instanceof HTMLElement)) {
      throw new Error('Search progress paint is missing');
    }
    return {
      track: getComputedStyle(bar).backgroundColor,
      fill: getComputedStyle(fill).backgroundColor,
    };
  }));
  return pairs.map(({ track, fill }) => contrastRatio(track, fill));
}

async function placeholderContrast(input: Locator, field: Locator): Promise<number> {
  const placeholder = await input.evaluate((element) => (
    getComputedStyle(element, '::placeholder').color
  ));
  const background = await field.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ));
  return contrastRatio(placeholder, background);
}

test('곰신은 군인 파트너의 읽기 전용 레벨별 EXP를 실제 화면에서 본다', async ({ page }) => {
  let partnerServiceRpcCalls = 0;
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/get_partner_service_info')) {
      partnerServiceRpcCalls += 1;
    }
  });

  const { unrouted } = await installMockBackend(page.context(), CREATOR);
  await page.goto('/search');

  await expect(page.getByTestId('gomsin-search-surface')).toBeVisible();
  await expect(page.getByTestId('soldier-service-info')).toBeVisible();
  await expect(page.getByText('몽룡의 복무')).toBeVisible();
  await expect(page.getByTestId('service-exp-readout')).toContainText('EXP');
  await expect(page.getByRole('button', { name: '복무 정보 수정' })).toHaveCount(0);

  const toggle = page.getByRole('button', { name: '전체 단계' });
  await expect(toggle).toHaveCSS('min-height', '44px');
  await toggle.click();
  await expect(page.getByTestId('service-tier-rail')).toBeVisible();
  await expect(page.getByTestId('service-tier-step-7')).toContainText('왕고');
  await page.screenshot({ path: `${OUT}/gomsin-partner-service-390.png`, fullPage: true });
  expect(unrouted).toEqual([]);
  expect(partnerServiceRpcCalls).toBe(1);
});

test('군인은 자기 복무 카드를 수정할 수 있고 상대 projection 호출을 하지 않는다', async ({ page }) => {
  let partnerServiceRpcCalls = 0;
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/get_partner_service_info')) {
      partnerServiceRpcCalls += 1;
    }
  });

  const { unrouted } = await installMockBackend(page.context(), PARTNER);
  await page.goto('/search');

  await expect(page.getByTestId('soldier-search-surface')).toBeVisible();
  await expect(page.getByText('내 복무')).toBeVisible();
  await expect(page.getByRole('button', { name: '복무 정보 수정' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/soldier-own-service-390.png`, fullPage: true });
  expect(unrouted).toEqual([]);
  expect(partnerServiceRpcCalls).toBe(0);
});

test('찾기는 작은 iPhone과 reduced motion에서 검색과 복무 정보를 명확히 유지한다', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    reducedMotion: 'reduce',
  });
  try {
    await installMockBackend(context, PARTNER);
    const page = await context.newPage();
    await page.goto('/search');

    const search = page.getByRole('search', { name: '기록 찾기' });
    const input = search.getByRole('searchbox', { name: '쓴 말이나 날짜로 찾기' });
    const field = page.getByTestId('record-search-field');
    const service = page.getByTestId('soldier-service-info');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await expect(service).toBeVisible();
    await expect(input).toHaveAttribute('aria-describedby', 'record-search-help');
    await expect(input).toHaveAttribute('aria-controls', 'record-search-results');
    await expect(page.locator('#record-search-help')).toContainText('이 기기 안에서만 찾아요');
    await expect(page.locator('#record-search-results')).toBeAttached();
    await expect(field).toHaveCSS('background-color', 'rgb(252, 251, 247)');
    await expect(service.getByRole('progressbar', { name: '개인 복무 진행률' })).toBeVisible();
    await expect(service.getByRole('progressbar', { name: '현재 복무 레벨 경험치 진행률' })).toBeVisible();
    await expect(service.getByRole('progressbar')).toHaveCount(2);

    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ));
    expect(overflow).toBeLessThanOrEqual(1);
    expect((await progressContrast(service)).every((ratio) => ratio >= 3)).toBe(true);
    expect(await placeholderContrast(input, field)).toBeGreaterThanOrEqual(4.5);

    const progressLabels = service.getByTestId('service-level-progress-copy').locator('span');
    const [currentLevelBox, nextLevelBox] = await Promise.all([
      progressLabels.nth(0).boundingBox(),
      progressLabels.nth(1).boundingBox(),
    ]);
    expect(nextLevelBox?.y ?? 0).toBeGreaterThan((currentLevelBox?.y ?? 0) + 4);

    await page.getByRole('button', { name: '전체 단계' }).click();
    const transitionDurations = await service.locator('[class*="transition"]').evaluateAll((elements) => (
      elements.map((element) => getComputedStyle(element).transitionDuration)
    ));
    expect(transitionDurations.length).toBeGreaterThan(0);
    expect(transitionDurations.every((duration) => duration === '0s')).toBe(true);

    await input.fill('공개기록');
    await expect(page.locator('#record-search-results [role="status"]')).toContainText('1개 찾았어요');
    await page.getByRole('button', { name: '검색어 지우기' }).click();
    await expect(input).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('search-light-320.png'), fullPage: true });

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect(field).toHaveCSS('background-color', 'rgb(22, 21, 26)');
    expect((await progressContrast(service)).every((ratio) => ratio >= 3)).toBe(true);
    expect(await placeholderContrast(input, field)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath('search-dark-320.png'), fullPage: true });
  } finally {
    await context.close();
  }
});
