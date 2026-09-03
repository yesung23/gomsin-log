import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, TODAY } from './scenarios';

function shiftCalendarDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

const GARDEN_SCENARIO = {
  ...CREATOR,
  // A valid shared anniversary unlocks the garden without exposing a day counter.
  anniversaryDate: shiftCalendarDate(TODAY, -99),
};

const NOMINAL_PAIR_GAP_PX = 4;
const SUBPIXEL_MEASUREMENT_EPSILON_PX = 0.001;
const MIN_MEASURED_PAIR_GAP_PX = NOMINAL_PAIR_GAP_PX - SUBPIXEL_MEASUREMENT_EPSILON_PX;

async function openGarden(
  context: BrowserContext,
  page: Page,
  theme?: 'light' | 'dark',
) {
  const { unrouted } = await installMockBackend(context, GARDEN_SCENARIO);
  if (theme) {
    await context.addInitScript((value) => {
      const key = 'gomsinlog.state.v2';
      const raw = window.localStorage.getItem(key);
      const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      window.localStorage.setItem(key, JSON.stringify({ ...stored, theme: value }));
    }, theme);
  }
  await page.goto('/diary/garden');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByTestId('garden-scene')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('garden-exact-character-peach')).toBeVisible();
  await expect(page.getByText(/함께한 \d+일/)).toHaveCount(0);
  return unrouted;
}

function contrastRatio(foreground: string, background: string): number {
  const rgb = (value: string): [number, number, number] => {
    const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
    return channels as [number, number, number];
  };
  const luminance = (value: string) => {
    const linear = rgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function longPressAndDrag(page: Page, companionTestId: string) {
  const companion = page.getByTestId(companionTestId);
  const otherCompanion = page.getByTestId(
    companionTestId.endsWith('peach') ? 'garden-companion-sage' : 'garden-companion-peach',
  );
  const scene = page.getByTestId('garden-scene');
  const companionBox = await companion.boundingBox();
  const sceneBox = await scene.boundingBox();
  expect(companionBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  if (!companionBox || !sceneBox) throw new Error('Garden geometry unavailable');

  const startX = companionBox.x + companionBox.width / 2;
  const startY = companionBox.y + companionBox.height / 2;
  const beforeX = Number(await companion.getAttribute('data-x'));
  const otherX = Number(await otherCompanion.getAttribute('data-x'));
  const targetPercentX = beforeX <= otherX
    ? Math.max(18, beforeX - 12)
    : Math.min(82, beforeX + 12);
  const targetX = sceneBox.x + sceneBox.width * targetPercentX / 100;
  const targetY = companionBox.y + companionBox.height;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await expect(companion).toHaveAttribute('data-pressed', 'true');
  await page.waitForTimeout(520);
  await expect(companion).toHaveAttribute('data-lifted', 'true');
  const liftedLimbs = companion.locator('.garden-limb');
  await expect(liftedLimbs).toHaveCount(4);
  const liftedAnimations = await liftedLimbs.evaluateAll((nodes) => (
    nodes.map((node) => getComputedStyle(node).animationName)
  ));
  expect(liftedAnimations).toHaveLength(4);
  expect(liftedAnimations.every((name) => name.startsWith('garden-flail-'))).toBe(true);
  expect(new Set(liftedAnimations).size).toBe(4);
  expect(await companion.locator('.garden-companion-body').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  expect(await companion.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');

  await page.mouse.move(targetX, targetY, { steps: 4 });
  await expect.poll(async () => Math.abs(
    Number(await companion.getAttribute('data-x')) - beforeX,
  )).toBeGreaterThanOrEqual(1);
  await page.mouse.up();
  await expect(companion).toHaveAttribute('data-lifted', 'false');
  await expect(companion).toHaveAttribute('data-pressed', 'false');
}

async function companionMotionSample(page: Page) {
  // Read both moving characters in one browser task. Four separate protocol
  // reads could straddle a React motion commit and occasionally return one null
  // Playwright bounding box even though both persistent DOM nodes were visible.
  return page.evaluate(() => {
    const peach = document.querySelector<HTMLElement>('[data-testid="garden-companion-peach"]');
    const sage = document.querySelector<HTMLElement>('[data-testid="garden-companion-sage"]');
    const peachPosition = document.querySelector<HTMLElement>('[data-testid="garden-companion-position-peach"]');
    const sagePosition = document.querySelector<HTMLElement>('[data-testid="garden-companion-position-sage"]');
    if (!peach || !sage || !peachPosition || !sagePosition) {
      throw new Error('Garden pair unavailable during motion sample');
    }
    const peachBox = peachPosition.getBoundingClientRect();
    const sageBox = sagePosition.getBoundingClientRect();
    return {
      movingCount: [peach.dataset.wandering, sage.dataset.wandering]
        .filter((value) => value === 'true').length,
      gapPx: Math.max(
        sageBox.x - (peachBox.x + peachBox.width),
        peachBox.x - (sageBox.x + sageBox.width),
        sageBox.y - (peachBox.y + peachBox.height),
        peachBox.y - (sageBox.y + sageBox.height),
      ),
    };
  });
}

async function companionYAnchors(page: Page) {
  return page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>('[data-testid="garden-scene"]');
    if (!scene) throw new Error('Garden scene unavailable');
    const sceneTop = scene.getBoundingClientRect().top + scene.clientTop;
    const read = (id: 'peach' | 'sage') => {
      const control = document.querySelector<HTMLElement>(`[data-testid="garden-companion-${id}"]`);
      const position = document.querySelector<HTMLElement>(`[data-testid="garden-companion-position-${id}"]`);
      if (!control || !position) throw new Error(`Garden companion ${id} unavailable`);
      return {
        dataY: Number(control.dataset.y),
        renderedY: position.getBoundingClientRect().bottom - sceneTop,
      };
    };
    return { peach: read('peach'), sage: read('sage') };
  });
}

async function startAnimationFramePairSampling(page: Page) {
  await page.evaluate(() => {
    type GardenSampleState = { running: boolean; gaps: number[] };
    const gardenWindow = window as typeof window & { __gardenPairSamples?: GardenSampleState };
    const state: GardenSampleState = { running: true, gaps: [] };
    gardenWindow.__gardenPairSamples = state;
    const sample = () => {
      if (!state.running) return;
      const peach = document.querySelector<HTMLElement>('[data-testid="garden-companion-position-peach"]');
      const sage = document.querySelector<HTMLElement>('[data-testid="garden-companion-position-sage"]');
      if (peach && sage) {
        const a = peach.getBoundingClientRect();
        const b = sage.getBoundingClientRect();
        state.gaps.push(Math.max(
          b.left - a.right,
          a.left - b.right,
          b.top - a.bottom,
          a.top - b.bottom,
        ));
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function stopAnimationFramePairSampling(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    type GardenSampleState = { running: boolean; gaps: number[] };
    const gardenWindow = window as typeof window & { __gardenPairSamples?: GardenSampleState };
    if (!gardenWindow.__gardenPairSamples) return [];
    gardenWindow.__gardenPairSamples.running = false;
    return gardenWindow.__gardenPairSamples.gaps;
  });
}

test('full-screen garden uses the exact characters, serializes pair-safe wandering, and supports long-press drag', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const unrouted = await openGarden(context, page);

  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toHaveCount(0);
  await expect(page.getByTestId('garden-scene')).not.toHaveClass(/aspect-\[4\/3\]/);
  await expect(page.getByTestId('garden-exact-character-peach')).toHaveAttribute('viewBox', '20 515 136 155');
  await expect(page.getByTestId('garden-exact-character-sage')).toHaveAttribute('viewBox', '156 514 138 155');

  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');
  await expect(peach).toBeVisible();
  await expect(sage).toBeVisible();

  const pageSurface = await page.locator('#main-content').evaluate((node) => getComputedStyle(node).backgroundColor);
  const sceneSurface = await page.getByTestId('garden-scene').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(sceneSurface).toBe('rgb(255, 255, 255)');
  expect(pageSurface).toBe('rgb(255, 255, 255)');

  await expect.poll(async () => (
    Number(await peach.getAttribute('data-move-count'))
    + Number(await sage.getAttribute('data-move-count'))
  ), { timeout: 10_000 }).toBeGreaterThan(0);
  let sawAutonomousMove = false;
  let sawLimbWalk = false;
  for (let sampleIndex = 0; sampleIndex < 20; sampleIndex += 1) {
    const sample = await companionMotionSample(page);
    sawAutonomousMove ||= sample.movingCount === 1;
    for (const companion of [peach, sage]) {
      if (await companion.getAttribute('data-wandering') !== 'true') continue;
      const limbAnimations = await companion.locator('.garden-limb').evaluateAll((nodes) => (
        nodes.map((node) => getComputedStyle(node).animationName)
      ));
      sawLimbWalk ||= limbAnimations.length === 4
        && limbAnimations.every((name) => name.startsWith('garden-walk-'));
    }
    expect(sample.movingCount).toBeLessThanOrEqual(1);
    expect(sample.gapPx).toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
    await page.waitForTimeout(150);
  }
  expect(sawAutonomousMove).toBe(true);
  expect(sawLimbWalk).toBe(true);
  await expect.poll(async () => Math.min(
    Number(await peach.getAttribute('data-move-count')),
    Number(await sage.getAttribute('data-move-count')),
  ), { timeout: 25_000 }).toBeGreaterThan(0);

  // A normal click exposes the same non-drag interaction available to assistive technology.
  await sage.click();
  await expect(sage).toHaveAttribute('data-lifted', 'false');
  await expect(page.getByRole('dialog', { name: '둘째 친구와 함께 놀기' })).toBeVisible();
  await page.getByRole('button', { name: '둘째 친구와 함께 놀기 닫기' }).click();

  const sageBox = await sage.boundingBox();
  expect(sageBox).not.toBeNull();
  if (sageBox) {
    const startX = sageBox.x + sageBox.width / 2;
    const startY = sageBox.y + sageBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY);
    await page.waitForTimeout(50);
    await page.mouse.up();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await longPressAndDrag(page, 'garden-companion-peach');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const visualBox = await peach.locator('.garden-exact-character').boundingBox();
  const hitBox = await peach.boundingBox();
  expect(visualBox?.width ?? 0).toBeLessThanOrEqual(26);
  expect(visualBox?.height ?? 0).toBeLessThanOrEqual(29);
  expect(hitBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(hitBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  // Keyboard users reach the same action sheet and can move the character without dragging.
  await sage.focus();
  await sage.press('Enter');
  await expect(sage).toHaveAttribute('data-lifted', 'false');
  await expect(page.getByRole('dialog', { name: '둘째 친구와 함께 놀기' })).toBeVisible();
  const beforeKeyboardMove = Number(await sage.getAttribute('data-x'));
  await page.getByRole('button', { name: '둘째 친구 왼쪽으로 이동' }).click();
  await expect.poll(async () => Number(await sage.getAttribute('data-x'))).toBeLessThan(beforeKeyboardMove);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(sage).toBeFocused();

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(unrouted).toEqual([]);
  await context.close();
});

test('care actions create distinct one-shot reactions without adding a garden score surface', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const unrouted = await openGarden(context, page);
  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');

  await sage.click();
  const wave = page.getByRole('button', { name: '둘째 친구에게 인사하기' });
  const waveBox = await wave.boundingBox();
  expect(waveBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await wave.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(sage).toHaveAttribute('data-care-reaction', 'wave');
  await expect(page.getByTestId('garden-care-reaction-sage')).toBeVisible();
  await expect(page.getByTestId('garden-live-region')).toContainText('둘째 친구가 반갑게 손을 흔들어요');
  expect(await sage.locator('.garden-limb-arm-right').evaluate((node) => getComputedStyle(node).animationName))
    .toBe('garden-care-wave-arm');

  const firstWaveArt = await page.getByTestId('garden-companion-art-sage').elementHandle();
  expect(firstWaveArt).not.toBeNull();
  await sage.click();
  await page.getByRole('button', { name: '둘째 친구에게 인사하기' }).click();
  await expect.poll(async () => firstWaveArt?.evaluate((node) => node.isConnected))
    .toBe(false);
  await expect(sage).toHaveAttribute('data-care-reaction', 'wave');
  expect(await sage.locator('.garden-limb-arm-right').evaluate((node) => getComputedStyle(node).animationName))
    .toBe('garden-care-wave-arm');
  await expect(sage).toHaveAttribute('data-care-reaction', 'none', { timeout: 3_000 });

  await page.getByRole('button', { name: '꾸미기와 함께 놀기' }).click();
  await page.getByRole('button', { name: '두 친구 같이 놀기' }).click();
  await expect(peach).toHaveAttribute('data-care-reaction', 'play');
  await expect(sage).toHaveAttribute('data-care-reaction', 'play');
  expect(await peach.locator('.garden-companion-body').evaluate((node) => getComputedStyle(node).animationName))
    .toBe('garden-care-play');
  expect(await sage.locator('.garden-companion-body').evaluate((node) => getComputedStyle(node).animationName))
    .toBe('garden-care-play');

  await expect(page.getByText(/레벨|경험치|점수|출석|배고픔/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(unrouted).toEqual([]);
  await context.close();
});

for (const theme of ['light', 'dark'] as const) {
  test(`garden stays white and readable in ${theme} mode`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const unrouted = await openGarden(context, page, theme);

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const surface of [
      page.locator('[data-astryx-theme="gomsin"]'),
      page.locator('#main-content'),
      page.locator('header'),
      page.getByTestId('garden-scene'),
    ]) {
      expect(await surface.evaluate((node) => getComputedStyle(node).backgroundColor))
        .toBe('rgb(255, 255, 255)');
      expect(await surface.evaluate((node) => getComputedStyle(node).backgroundImage))
        .toBe('none');
    }

    await expect(page.getByText(/함께한 \d+일/)).toHaveCount(0);

    for (const name of ['이전 화면으로', '꾸미기와 함께 놀기']) {
      const control = page.getByRole('button', { name });
      const colors = await control.evaluate((node) => ({
        foreground: getComputedStyle(node).color,
        background: getComputedStyle(node.closest('header')!).backgroundColor,
      }));
      expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(3);
    }

    expect(unrouted).toEqual([]);
    await context.close();
  });
}

test('quiet garden remains usable in landscape', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 812, height: 375 } });
  const page = await context.newPage();
  const unrouted = await openGarden(context, page);

  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toHaveCount(0);
  const scene = page.getByTestId('garden-scene');
  const sceneBox = await scene.boundingBox();
  expect(sceneBox).not.toBeNull();
  expect(sceneBox?.width ?? 0).toBeGreaterThan(300);

  for (const id of ['peach', 'sage'] as const) {
    const companion = page.getByTestId(`garden-companion-${id}`);
    const box = await companion.boundingBox();
    expect(box).not.toBeNull();
    if (sceneBox && box) {
      expect(box.x).toBeGreaterThanOrEqual(sceneBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(sceneBox.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(sceneBox.y + sceneBox.height + 1);
    }
  }

  const mainMetrics = await page.locator('#main-content').evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(mainMetrics.scrollHeight).toBeLessThanOrEqual(mainMetrics.clientHeight + 1);

  await expect(page.getByRole('button', { name: '상점 열기' })).toHaveCount(0);

  const peach = page.getByTestId('garden-companion-peach');
  await peach.click();
  for (let step = 0; step < 10; step += 1) {
    await page.getByRole('button', { name: '첫째 친구 오른쪽으로 이동' }).click();
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 430, height: 375 });
  await expect.poll(async () => (await companionMotionSample(page)).gapPx)
    .toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
  const resizedScene = await scene.boundingBox();
  expect(resizedScene).not.toBeNull();
  for (const id of ['peach', 'sage'] as const) {
    const box = await page.getByTestId(`garden-companion-position-${id}`).boundingBox();
    expect(box).not.toBeNull();
    if (resizedScene && box) {
      expect(box.x).toBeGreaterThanOrEqual(resizedScene.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(resizedScene.x + resizedScene.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(resizedScene.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(resizedScene.y + resizedScene.height + 1);
    }
  }
  expect(unrouted).toEqual([]);
  await context.close();
});

test('inner scene geometry keeps Y stable through repeated landscape resize freezes and horizontal moves', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 812, height: 375 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const unrouted = await openGarden(context, page);
  const before = await companionYAnchors(page);

  for (let event = 0; event < 10; event += 1) {
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
  }

  const afterResize = await companionYAnchors(page);
  for (const id of ['peach', 'sage'] as const) {
    expect(Math.abs(afterResize[id].dataY - before[id].dataY)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(afterResize[id].renderedY - before[id].renderedY)).toBeLessThanOrEqual(0.01);
  }

  await page.getByTestId('garden-companion-peach').click();
  for (let move = 0; move < 5; move += 1) {
    await page.getByRole('button', { name: '첫째 친구 오른쪽으로 이동' }).click();
    await page.getByRole('button', { name: '첫째 친구 왼쪽으로 이동' }).click();
  }
  await page.getByRole('button', { name: '둘째 친구', exact: true }).click();
  for (let move = 0; move < 5; move += 1) {
    await page.getByRole('button', { name: '둘째 친구 왼쪽으로 이동' }).click();
    await page.getByRole('button', { name: '둘째 친구 오른쪽으로 이동' }).click();
  }

  const afterMoves = await companionYAnchors(page);
  for (const id of ['peach', 'sage'] as const) {
    expect(Math.abs(afterMoves[id].dataY - before[id].dataY)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(afterMoves[id].renderedY - before[id].renderedY)).toBeLessThanOrEqual(0.01);
  }
  expect((await companionMotionSample(page)).gapPx).toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
  expect(unrouted).toEqual([]);
  await context.close();
});

test('short-landscape drag and resumed wandering preserve the four-pixel DOM gap', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 812, height: 375 } });
  const page = await context.newPage();
  const unrouted = await openGarden(context, page);
  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');

  const peachBox = await peach.boundingBox();
  expect(peachBox).not.toBeNull();
  if (!peachBox) throw new Error('Garden companion unavailable');
  await page.mouse.move(peachBox.x + peachBox.width / 2, peachBox.y + peachBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await expect(peach).toHaveAttribute('data-lifted', 'true');

  const frozenSageBox = await sage.boundingBox();
  expect(frozenSageBox).not.toBeNull();
  if (!frozenSageBox) throw new Error('Other garden companion unavailable');
  const movesBeforeRelease = Number(await peach.getAttribute('data-move-count'))
    + Number(await sage.getAttribute('data-move-count'));

  await startAnimationFramePairSampling(page);
  await page.mouse.move(
    frozenSageBox.x + frozenSageBox.width / 2,
    frozenSageBox.y + frozenSageBox.height,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(peach).toHaveAttribute('data-lifted', 'false');
  await expect.poll(async () => (
    Number(await peach.getAttribute('data-move-count'))
      + Number(await sage.getAttribute('data-move-count'))
  ), { timeout: 12_000 }).toBeGreaterThan(movesBeforeRelease);
  await page.waitForTimeout(500);

  const gaps = await stopAnimationFramePairSampling(page);
  expect(gaps.length).toBeGreaterThan(5);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
  expect((await companionMotionSample(page)).gapPx).toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
  expect(unrouted).toEqual([]);
  await context.close();
});

test('rapid directional transitions and a companion switch preserve the four-pixel pair gap every frame', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const unrouted = await openGarden(context, page);
  const peach = page.getByTestId('garden-companion-peach');

  await peach.click();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: '첫째 친구 오른쪽으로 이동' }).click();
    await page.waitForTimeout(220);
  }
  await expect(peach).toHaveAttribute('data-x', '58.00');

  await startAnimationFramePairSampling(page);
  await page.getByRole('button', { name: '첫째 친구 위쪽으로 이동' }).click();
  await page.getByRole('button', { name: '첫째 친구 위쪽으로 이동' }).click();
  await page.getByRole('button', { name: '첫째 친구 오른쪽으로 이동' }).click();
  await page.getByRole('button', { name: '둘째 친구', exact: true }).click();
  await page.getByRole('button', { name: '둘째 친구 왼쪽으로 이동' }).click();
  await page.waitForTimeout(260);
  const gaps = await stopAnimationFramePairSampling(page);

  expect(gaps.length).toBeGreaterThan(5);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
  expect((await companionMotionSample(page)).gapPx).toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
  expect(unrouted).toEqual([]);
  await context.close();
});

test('small-phone action sheet equips only owned accessories and reaches the Shop without overflow', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  await context.addInitScript(() => {
    window.localStorage.setItem('gomsin.diary.shop.user-creator', JSON.stringify({
      version: 1,
      ownedAccessories: ['flower'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    }));
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const unrouted = await openGarden(context, page);

  await page.getByRole('button', { name: '꾸미기와 함께 놀기' }).click();
  const dialog = page.getByRole('dialog', { name: '첫째 친구와 함께 놀기' });
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(320);
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(568);
  expect(await dialog.evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingBottom)))
    .toBeGreaterThanOrEqual(16);
  for (const name of ['첫째 친구 쓰다듬기', '첫째 친구에게 인사하기', '두 친구 같이 놀기']) {
    const careBox = await page.getByRole('button', { name }).boundingBox();
    expect(careBox?.height ?? 0, `${name} keeps a 44px touch target`).toBeGreaterThanOrEqual(44);
  }

  const flowerRadio = page.getByRole('radio', { name: '첫째 친구 꽃' });
  const flowerTarget = flowerRadio.locator('..');
  const flowerTargetBox = await flowerTarget.boundingBox();
  expect(flowerTargetBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(flowerTargetBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await flowerTarget.click();
  await expect(flowerRadio).toBeChecked();
  await expect(page.getByTestId('garden-companion-peach')).toHaveAttribute('data-accessory', 'flower');
  await expect(page.getByTestId('garden-accessory-peach-flower')).toBeVisible();

  await page.getByRole('button', { name: '장식 더 받으러 가기' }).click();
  await expect(page.getByRole('heading', { name: '상점' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(unrouted).toEqual([]);
  await context.close();
});

test('reduced-motion stops autonomous wandering and repeated squirm while preserving direct pickup feedback', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const unrouted = await openGarden(context, page);

  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');
  await expect.poll(async () => [
    await peach.getAttribute('data-wandering'),
    await sage.getAttribute('data-wandering'),
  ], { timeout: 10_000 }).toContain('true');
  const movingId = await peach.getAttribute('data-wandering') === 'true' ? 'peach' : 'sage';
  const movingPosition = page.getByTestId(`garden-companion-position-${movingId}`);
  await page.waitForTimeout(180);
  const beforeReduce = await movingPosition.boundingBox();
  expect(beforeReduce).not.toBeNull();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const afterReduce = await movingPosition.boundingBox();
  expect(afterReduce).not.toBeNull();
  if (beforeReduce && afterReduce) {
    expect(Math.hypot(afterReduce.x - beforeReduce.x, afterReduce.y - beforeReduce.y)).toBeLessThanOrEqual(12);
  }
  await expect(peach).toHaveAttribute('data-wandering', 'false');
  await expect(sage).toHaveAttribute('data-wandering', 'false');
  const moveCount = Number(await peach.getAttribute('data-move-count'))
    + Number(await sage.getAttribute('data-move-count'));
  const peachFrozen = await page.getByTestId('garden-companion-position-peach').boundingBox();
  const sageFrozen = await page.getByTestId('garden-companion-position-sage').boundingBox();
  await page.waitForTimeout(1_400);
  expect(
    Number(await peach.getAttribute('data-move-count'))
    + Number(await sage.getAttribute('data-move-count')),
  ).toBe(moveCount);
  expect(await page.getByTestId('garden-companion-position-peach').boundingBox()).toEqual(peachFrozen);
  expect(await page.getByTestId('garden-companion-position-sage').boundingBox()).toEqual(sageFrozen);

  await page.getByRole('button', { name: '꾸미기와 함께 놀기' }).click();
  await page.getByRole('button', { name: '첫째 친구 쓰다듬기' }).click();
  await expect(peach).toHaveAttribute('data-care-reaction', 'pet');
  await expect(page.getByTestId('garden-care-reaction-peach')).toBeVisible();
  expect(await peach.locator('.garden-companion-body').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  expect(await page.getByTestId('garden-care-reaction-peach').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await expect(peach).toHaveAttribute('data-care-reaction', 'none', { timeout: 3_000 });

  const box = await peach.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Companion geometry unavailable');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await expect(peach).toHaveAttribute('data-lifted', 'true');
  const reducedLimbAnimations = await peach.locator('.garden-limb').evaluateAll((nodes) => (
    nodes.map((node) => getComputedStyle(node).animationName)
  ));
  expect(reducedLimbAnimations).toEqual(['none', 'none', 'none', 'none']);
  expect(await peach.locator('.garden-companion-body').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  expect(await peach.evaluate((node) => getComputedStyle(node).filter)).not.toBe('none');
  await page.mouse.up();
  await expect(peach).toHaveAttribute('data-lifted', 'false');

  expect(unrouted).toEqual([]);
  await context.close();
});
