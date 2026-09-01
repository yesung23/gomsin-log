import { expect, test, type Page } from '@playwright/test';
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

async function bootedInto(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toBeVisible({ timeout: 20_000 });
}

test('two garden companions actually wander, wear accessories, persist them, and wriggle when lifted', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { unrouted } = await installMockBackend(context, GARDEN_SCENARIO);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await bootedInto(page, '/diary');
  await page.getByRole('button', { name: '우리 정원 보기' }).click();
  await page.waitForURL(/\/diary\/garden$/);
  await expect(page.getByRole('tab', { name: '일기장' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('함께한 100일')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '든든한 나무' })).toBeVisible();

  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');
  await expect(peach).toBeVisible();
  await expect(sage).toBeVisible();
  await expect(page.getByRole('button', { name: /친구 들어올리기/ })).toHaveCount(2);

  const peachStart = await peach.boundingBox();
  const sageStart = await sage.boundingBox();
  expect(peachStart).not.toBeNull();
  expect(sageStart).not.toBeNull();

  // The startup delay is <=900ms. Both state machines must independently choose a destination.
  await expect.poll(async () => Number(await peach.getAttribute('data-move-count')), { timeout: 4_000 }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await sage.getAttribute('data-move-count')), { timeout: 4_000 }).toBeGreaterThan(0);

  const peachPoint = {
    x: Number(await peach.getAttribute('data-x')),
    y: Number(await peach.getAttribute('data-y')),
  };
  const sagePoint = {
    x: Number(await sage.getAttribute('data-x')),
    y: Number(await sage.getAttribute('data-y')),
  };
  for (const point of [peachPoint, sagePoint]) {
    expect(point.x).toBeGreaterThanOrEqual(12);
    expect(point.x).toBeLessThanOrEqual(88);
    expect(point.y).toBeGreaterThanOrEqual(48);
    expect(point.y).toBeLessThanOrEqual(80);
  }
  expect(Math.hypot(peachPoint.x - sagePoint.x, peachPoint.y - sagePoint.y)).toBeGreaterThanOrEqual(16);

  // CSS interpolation means a real box should also visibly leave its initial position, not only change data attributes.
  await page.waitForTimeout(650);
  const peachMoved = await peach.boundingBox();
  const sageMoved = await sage.boundingBox();
  expect(peachMoved).not.toBeNull();
  expect(sageMoved).not.toBeNull();
  expect(Math.hypot((peachMoved?.x ?? 0) - (peachStart?.x ?? 0), (peachMoved?.y ?? 0) - (peachStart?.y ?? 0))).toBeGreaterThan(1);
  expect(Math.hypot((sageMoved?.x ?? 0) - (sageStart?.x ?? 0), (sageMoved?.y ?? 0) - (sageStart?.y ?? 0))).toBeGreaterThan(1);

  await page.getByRole('button', { name: '정원 꾸미기' }).click();
  await page.getByRole('radio', { name: '분홍 친구 모자' }).click();
  await page.getByRole('radio', { name: '초록 친구 꽃' }).click();
  await expect(peach).toHaveAttribute('data-accessory', 'cap');
  await expect(sage).toHaveAttribute('data-accessory', 'flower');
  await expect(page.getByTestId('garden-accessory-peach-cap')).toBeAttached();
  await expect(page.getByTestId('garden-accessory-sage-flower')).toBeAttached();

  await page.reload();
  await expect(page.getByTestId('garden-companion-peach')).toHaveAttribute('data-accessory', 'cap');
  await expect(page.getByTestId('garden-companion-sage')).toHaveAttribute('data-accessory', 'flower');

  const peachAfterReload = page.getByRole('button', { name: '분홍 친구 들어올리기' });
  await peachAfterReload.click();
  await expect(peachAfterReload).toHaveAttribute('data-lifted', 'true');
  const animationName = await peachAfterReload.evaluate((node) => getComputedStyle(node).animationName);
  expect(animationName).toContain('garden-lift-wriggle');
  await expect.poll(async () => peachAfterReload.getAttribute('data-lifted'), { timeout: 2_000 }).toBe('false');

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(unrouted).toEqual([]);
  await context.close();
});

for (const width of [320, 390, 430]) {
  test(`garden stays contained and usable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const { unrouted } = await installMockBackend(context, GARDEN_SCENARIO);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await bootedInto(page, '/diary/garden');
    const scene = page.getByTestId('garden-scene');
    const sceneBox = await scene.boundingBox();
    expect(sceneBox).not.toBeNull();

    for (const id of ['peach', 'sage'] as const) {
      const companion = page.getByTestId(`garden-companion-${id}`);
      const box = await companion.boundingBox();
      expect(box).not.toBeNull();
      if (sceneBox && box) {
        expect(box.x).toBeGreaterThanOrEqual(sceneBox.x - 1);
        expect(box.y).toBeGreaterThanOrEqual(sceneBox.y - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(sceneBox.y + sceneBox.height + 1);
      }
      const size = await companion.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole('button', { name: '정원 꾸미기' }).click();
    await expect(page.getByRole('region', { name: '정원 꾸미기' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    expect(errors).toEqual([]);
    expect(unrouted).toEqual([]);
    await context.close();
  });
}

test('reduced-motion keeps the two companions stationary but lift remains understandable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const { unrouted } = await installMockBackend(context, GARDEN_SCENARIO);
  const page = await context.newPage();
  await bootedInto(page, '/diary/garden');

  const peach = page.getByTestId('garden-companion-peach');
  const sage = page.getByTestId('garden-companion-sage');
  await page.waitForTimeout(1_400);
  await expect(peach).toHaveAttribute('data-move-count', '0');
  await expect(sage).toHaveAttribute('data-move-count', '0');
  await expect(peach).toHaveAttribute('data-wandering', 'false');
  await expect(sage).toHaveAttribute('data-wandering', 'false');

  await peach.click();
  await expect(peach).toHaveAttribute('data-lifted', 'true');
  const reducedAnimation = await peach.evaluate((node) => getComputedStyle(node).animationName);
  expect(reducedAnimation).toBe('none');
  const transform = await peach.evaluate((node) => getComputedStyle(node).transform);
  expect(transform).not.toBe('none');
  await expect.poll(async () => peach.getAttribute('data-lifted'), { timeout: 2_000 }).toBe('false');

  expect(unrouted).toEqual([]);
  await context.close();
});
