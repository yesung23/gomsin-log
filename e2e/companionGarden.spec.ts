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

async function openGarden(context: BrowserContext, page: Page) {
  const { unrouted } = await installMockBackend(context, GARDEN_SCENARIO);
  await page.goto('/diary/garden');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByText('함께한 100일')).toBeVisible({ timeout: 20_000 });
  return unrouted;
}

async function longPressAndDrag(page: Page, companionTestId: string) {
  const companion = page.getByTestId(companionTestId);
  const scene = page.getByTestId('garden-scene');
  const companionBox = await companion.boundingBox();
  const sceneBox = await scene.boundingBox();
  expect(companionBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  if (!companionBox || !sceneBox) throw new Error('Garden geometry unavailable');

  const startX = companionBox.x + companionBox.width / 2;
  const startY = companionBox.y + companionBox.height / 2;
  const targetX = sceneBox.x + sceneBox.width * 0.62;
  const targetY = sceneBox.y + sceneBox.height * 0.68;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await expect(companion).toHaveAttribute('data-pressed', 'true');
  await page.waitForTimeout(520);
  await expect(companion).toHaveAttribute('data-lifted', 'true');
  const liftedFrame = companion.locator('.garden-character-frame--lift');
  expect(await liftedFrame.evaluate((node) => getComputedStyle(node).animationName)).toContain('garden-lift-frame');
  expect(await companion.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');

  await page.mouse.move(targetX, targetY, { steps: 4 });
  await expect.poll(async () => Number(await companion.getAttribute('data-x'))).toBeGreaterThan(50);
  await page.mouse.up();
  await expect(companion).toHaveAttribute('data-lifted', 'false');
  await expect(companion).toHaveAttribute('data-pressed', 'false');
}

test('full-screen garden uses the exact characters, hides persistent nav, wanders independently, and supports long-press drag', async ({ browser }) => {
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

  await expect.poll(async () => Number(await peach.getAttribute('data-move-count')), { timeout: 4_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await sage.getAttribute('data-move-count')), { timeout: 4_000 }).toBeGreaterThan(0);

  // A normal click is deliberately not a pickup interaction.
  await sage.click();
  await expect(sage).toHaveAttribute('data-lifted', 'false');

  await longPressAndDrag(page, 'garden-companion-peach');

  const visualBox = await peach.locator('.garden-exact-character').boundingBox();
  const hitBox = await peach.boundingBox();
  expect(visualBox?.width ?? 0).toBeLessThanOrEqual(55);
  expect(visualBox?.height ?? 0).toBeLessThanOrEqual(62);
  expect(hitBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(hitBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  // Keyboard users get a finite equivalent interaction.
  await sage.focus();
  await sage.press('Enter');
  await expect(sage).toHaveAttribute('data-lifted', 'true');
  await expect.poll(async () => sage.getAttribute('data-lifted'), { timeout: 2_000 }).toBe('false');

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
  expect(unrouted).toEqual([]);
  await context.close();
});

test('reduced-motion stops autonomous wandering and repeated squirm while preserving direct pickup feedback', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const unrouted = await openGarden(context, page);

  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');
  await page.waitForTimeout(1_400);
  await expect(peach).toHaveAttribute('data-move-count', '0');
  await expect(sage).toHaveAttribute('data-move-count', '0');
  await expect(peach).toHaveAttribute('data-wandering', 'false');
  await expect(sage).toHaveAttribute('data-wandering', 'false');

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
