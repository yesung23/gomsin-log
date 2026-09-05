import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, record } from './scenarios';

test('Korean handwriting stays legible beside interface text and reflows at 200%', async ({ browser }, testInfo) => {
  const sample = '오늘 산책하면서 예쁜 하늘을 봤어. 같이 보고 싶었어.';
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  await installMockBackend(context, { ...CREATOR, records: [record({ id: 'legibility', user_id: 'user-partner', log_text: sample })] });
  const page = await context.newPage();
  await page.goto('/home');
  const body = page.getByText(sample);
  await expect(body).toBeVisible();
  await page.evaluate(async (text) => {
    await document.fonts.load('17px "Gomsin Hand"', text);
    await document.fonts.load('17px "Pretendard Variable"', text);
    await document.fonts.ready;
  }, sample);
  const metrics = await body.evaluate((element, text) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement('canvas').getContext('2d')!;
    const inkHeight = (family: string) => {
      canvas.font = `${style.fontSize} ${family}`;
      const result = canvas.measureText(text);
      return result.actualBoundingBoxAscent + result.actualBoundingBoxDescent;
    };
    return { hand: inkHeight('"Gomsin Hand"'), sans: inkHeight('"Pretendard Variable"') };
  }, sample);
  // Compare visible glyphs, not CSS em sizes: the latter missed the original defect.
  expect(metrics.hand / metrics.sans).toBeGreaterThanOrEqual(0.95);
  expect(metrics.hand / metrics.sans).toBeLessThanOrEqual(1.15);
  await page.screenshot({ path: testInfo.outputPath('handwriting.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await expect(body).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('handwriting-200.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.setAttribute('data-hand', 'off'); });
  await expect(body).not.toHaveCSS('font-family', /Gomsin Hand/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await context.close();
});
