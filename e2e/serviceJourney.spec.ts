import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER } from './scenarios';

test('Service EXP really ticks, pauses, resumes, and opens the rank journey', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, reducedMotion: 'no-preference' });
  await installMockBackend(context, PARTNER);
  const page = await context.newPage();
  await page.goto('/service');
  const readout = page.getByTestId('service-exp-readout');
  await expect(readout).toBeVisible();
  const first = await readout.innerText();
  await expect.poll(() => readout.innerText()).not.toBe(first);
  await page.getByRole('button', { name: 'EXP 실시간 표시 멈추기' }).click();
  const paused = await readout.innerText();
  await page.waitForTimeout(1200);
  await expect(readout).toHaveText(paused);
  await page.getByRole('button', { name: 'EXP 실시간 표시 켜기' }).click();
  await expect.poll(() => readout.innerText()).not.toBe(paused);
  await page.screenshot({ path: testInfo.outputPath('service-live-402.png'), fullPage: true });
  await page.getByText('계급별 여정', { exact: true }).click();
  await expect(page.getByRole('list', { name: '복무 단계' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('service-stages-402.png'), fullPage: true });
  await context.close();
});

test('Both roles see a paper journey; partner never gets the service editor', async ({ browser }, testInfo) => {
  for (const scenario of [CREATOR, PARTNER]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    await installMockBackend(context, scenario);
    const page = await context.newPage();
    await page.goto('/search');
    await expect(page.getByTestId('service-level')).toBeVisible();
    await expect(page.getByText('예상 계급', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '복무 정보 수정' })).toHaveCount(scenario.role === 'soldier' ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`search-${scenario.role}-375.png`), fullPage: true });
    await context.close();
  }
});

test('Service remains usable at 200% text, in dark mode and small landscape', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' });
  await installMockBackend(context, PARTNER);
  const page = await context.newPage();
  await page.goto('/service');
  await expect(page.getByTestId('service-level')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByText('계급별 여정', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  const control = page.getByRole('button', { name: '현재 EXP 확인' });
  const box = await control.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('service-dark-200pct-320.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  await page.setViewportSize({ width: 568, height: 320 });
  await page.getByRole('button', { name: '복무 정보 수정' }).click();
  await expect(page.getByRole('dialog', { name: '복무 정보 수정' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await context.close();
});
