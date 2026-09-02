import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { PARTNER } from './scenarios';

test('Service stays legible and keyboard-complete on a small iPhone', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    reducedMotion: 'reduce',
  });
  await installMockBackend(context, PARTNER);
  const page = await context.newPage();

  await page.goto('/service');

  const progressbar = page.getByRole('progressbar', { name: '몽룡 복무 진행률' });
  await expect(progressbar).toBeVisible({ timeout: 20_000 });
  const progressValue = Number(await progressbar.getAttribute('aria-valuenow'));
  expect(progressValue).toBeGreaterThanOrEqual(0);
  expect(progressValue).toBeLessThanOrEqual(100);

  const layout = await page.evaluate(() => ({
    pageWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth - layout.pageWidth).toBeLessThanOrEqual(1);

  const progressFill = progressbar.locator(':scope > div');
  await expect(progressFill).toHaveCSS('transition-duration', '0s');
  await page.screenshot({ path: testInfo.outputPath('service-light.png'), fullPage: true });

  const opener = page.getByRole('button', { name: '복무 정보 수정' });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: '복무 정보 수정' });
  await expect(dialog).toBeVisible();
  const status = dialog.getByRole('combobox', { name: '복무 상태' });
  await expect(status).toBeFocused();
  const dialogGeometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(dialogGeometry.top).toBeGreaterThanOrEqual(0);
  expect(dialogGeometry.bottom).toBeLessThanOrEqual(dialogGeometry.viewportHeight);
  expect(dialogGeometry.scrollHeight).toBeGreaterThanOrEqual(dialogGeometry.clientHeight);
  await expect(dialog).toHaveCSS('overflow-y', 'auto');

  await status.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '저장하기' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const darkContrast = await page.locator('section[aria-labelledby="service-progress-title"]').evaluate((hero) => {
    function rgb(value: string): [number, number, number] {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
      return channels as [number, number, number];
    }
    function luminance(value: [number, number, number]) {
      const linear = value.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    function ratio(a: [number, number, number], b: [number, number, number]) {
      const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
      return (high + 0.05) / (low + 0.05);
    }

    const heroStyle = getComputedStyle(hero);
    const bar = hero.querySelector<HTMLElement>('[role="progressbar"]');
    const fill = bar?.firstElementChild;
    if (!bar || !(fill instanceof HTMLElement)) throw new Error('Service progress paint is missing');
    return {
      text: ratio(rgb(heroStyle.color), rgb(heroStyle.backgroundColor)),
      progress: ratio(
        rgb(getComputedStyle(bar).backgroundColor),
        rgb(getComputedStyle(fill).backgroundColor),
      ),
    };
  });
  expect(darkContrast.text).toBeGreaterThanOrEqual(4.5);
  expect(darkContrast.progress).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: testInfo.outputPath('service-dark.png'), fullPage: true });
  await context.close();
});
