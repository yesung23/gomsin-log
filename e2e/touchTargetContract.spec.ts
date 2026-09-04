import { expect, test, type Locator } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { PARTNER } from './scenarios';

async function expectPhysicalTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test('compact primary actions keep real 44px targets while the Home badge stays visually small', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const { unrouted } = await installMockBackend(context, PARTNER);
  const page = await context.newPage();

  await page.goto('/home');
  await expect(page.getByTestId('home-core')).toBeVisible({ timeout: 20_000 });

  const compose = page.getByRole('button', { name: '기록 남기기' });
  await expectPhysicalTouchTarget(compose);
  const badgeArt = compose.locator('[data-compose-badge-art]');
  await expect(badgeArt).toBeVisible();
  const badgeBox = await badgeArt.boundingBox();
  expect(badgeBox?.width).toBe(22);
  expect(badgeBox?.height).toBe(22);

  const composeBox = (await compose.boundingBox())!;
  for (const [x, y] of [
    [composeBox.x + 2, composeBox.y + 2],
    [composeBox.x + composeBox.width - 2, composeBox.y + 2],
    [composeBox.x + 2, composeBox.y + composeBox.height - 2],
    [composeBox.x + composeBox.width - 2, composeBox.y + composeBox.height - 2],
  ]) {
    const hitCompose = await page.evaluate(
      ({ x: pointX, y: pointY }) => document.elementFromPoint(pointX, pointY)
        ?.closest('button')
        ?.getAttribute('aria-label') === '기록 남기기',
      { x, y },
    );
    expect(hitCompose).toBe(true);
  }

  await page.goto('/schedule');
  await expect(page.getByRole('heading', { name: '우리의 계획', level: 1 })).toBeVisible();
  await expectPhysicalTouchTarget(page.getByRole('button', { name: '추가', exact: true }));

  await page.goto('/us');
  await expect(page.getByRole('tablist', { name: '우리의 기억 보기' })).toBeVisible();
  await expectPhysicalTouchTarget(page.getByRole('button', { name: '첫 게시물 만들기' }));

  await context.close();
  expect(unrouted).toEqual([]);
});
