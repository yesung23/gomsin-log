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
  // Inclusive Korean couple-day counting: 99 days before TODAY is 함께한 100일.
  anniversaryDate: shiftCalendarDate(TODAY, -99),
};

const NOMINAL_PAIR_GAP_PX = 4;
const SUBPIXEL_MEASUREMENT_EPSILON_PX = 0.001;
const MIN_MEASURED_PAIR_GAP_PX = NOMINAL_PAIR_GAP_PX - SUBPIXEL_MEASUREMENT_EPSILON_PX;

async function openGarden(context: BrowserContext, page: Page) {
  const { unrouted } = await installMockBackend(context, GARDEN_SCENARIO);
  await page.goto('/diary/garden');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByText('함께한 100일')).toBeVisible({ timeout: 20_000 });
  return unrouted;
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
  const liftedFrame = companion.locator('.garden-character-frame--lift');
  expect(await liftedFrame.evaluate((node) => getComputedStyle(node).animationName)).toContain('garden-lift-frame');
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
  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');
  const peachPosition = page.getByTestId('garden-companion-position-peach');
  const sagePosition = page.getByTestId('garden-companion-position-sage');
  const [peachMoving, sageMoving, peachBox, sageBox] = await Promise.all([
    peach.getAttribute('data-wandering'),
    sage.getAttribute('data-wandering'),
    peachPosition.boundingBox(),
    sagePosition.boundingBox(),
  ]);
  const gapPx = peachBox && sageBox
    ? Math.max(
      sageBox.x - (peachBox.x + peachBox.width),
      peachBox.x - (sageBox.x + sageBox.width),
      sageBox.y - (peachBox.y + peachBox.height),
      peachBox.y - (sageBox.y + sageBox.height),
    )
    : Number.NEGATIVE_INFINITY;
  return {
    movingCount: [peachMoving, sageMoving].filter((value) => value === 'true').length,
    gapPx,
  };
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

  await expect.poll(async () => (
    Number(await peach.getAttribute('data-move-count'))
    + Number(await sage.getAttribute('data-move-count'))
  ), { timeout: 10_000 }).toBeGreaterThan(0);
  let sawAutonomousMove = false;
  for (let sampleIndex = 0; sampleIndex < 20; sampleIndex += 1) {
    const sample = await companionMotionSample(page);
    sawAutonomousMove ||= sample.movingCount === 1;
    expect(sample.movingCount).toBeLessThanOrEqual(1);
    expect(sample.gapPx).toBeGreaterThanOrEqual(MIN_MEASURED_PAIR_GAP_PX);
    await page.waitForTimeout(150);
  }
  expect(sawAutonomousMove).toBe(true);
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
  expect(visualBox?.width ?? 0).toBeLessThanOrEqual(55);
  expect(visualBox?.height ?? 0).toBeLessThanOrEqual(62);
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

  const box = await peach.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Companion geometry unavailable');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await expect(peach).toHaveAttribute('data-lifted', 'true');
  expect(await peach.locator('.garden-character-frame--walk').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  expect(await peach.locator('.garden-character-frame--lift').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  expect(await peach.evaluate((node) => getComputedStyle(node).filter)).not.toBe('none');
  await page.mouse.up();
  await expect(peach).toHaveAttribute('data-lifted', 'false');

  expect(unrouted).toEqual([]);
  await context.close();
});
