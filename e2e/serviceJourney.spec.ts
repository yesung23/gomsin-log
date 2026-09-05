import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER } from './scenarios';
import type { MilitaryInfo } from '../src/types';

test('Hourly service EXP ticks by ten, pauses, resumes, and opens the growth journey', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, reducedMotion: 'no-preference' });
  await installMockBackend(context, PARTNER);
  const page = await context.newPage();
  await page.goto('/service');
  const readout = page.getByTestId('service-exp-readout');
  await expect(readout).toBeVisible();
  const first = await readout.innerText();
  await expect.poll(() => readout.innerText()).not.toBe(first);
  await expect(readout).toContainText('/ 36,000 EXP');
  await expect(page.getByText('1초에 +10 EXP', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'EXP 실시간 표시 멈추기' }).click();
  const paused = await readout.innerText();
  await page.waitForTimeout(1200);
  await expect(readout).toHaveText(paused);
  await page.getByRole('button', { name: 'EXP 실시간 표시 켜기' }).click();
  await expect.poll(() => readout.innerText()).not.toBe(paused);
  await page.screenshot({ path: testInfo.outputPath('service-live-402.png'), fullPage: true });
  await page.getByText('성장 여정', { exact: true }).click();
  await expect(page.getByRole('list', { name: '복무 성장 단계' })).toBeVisible();
  await expect(page.getByText(/한 시간에 한 레벨\. 앱을 닫아도 자라요\./)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('service-stages-402.png'), fullPage: true });
  await context.close();
});

test('Both roles see a paper journey; partner never gets the service editor', async ({ browser }, testInfo) => {
  const projectedLevels: string[] = [];
  const sharedMilitary: MilitaryInfo = {
    branch: 'army', militaryStatus: 'serving', enlistmentDate: '2026-01-01',
    expectedDischargeDate: '2027-07-01', dischargeDateSource: 'manual',
  };
  for (const scenario of [CREATOR, PARTNER]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => { Date.now = () => Date.parse('2026-09-05T12:34:56+09:00'); });
    await installMockBackend(context, { ...scenario, partnerMilitary: sharedMilitary });
    // Both the partner projection and the owner's profile use this exact source.
    await context.route('**/rest/v1/profiles*', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const profile = {
        id: scenario.userId, display_name: scenario.displayName, role: scenario.role,
        gender_identity: scenario.genderIdentity ?? null, avatar_path: null,
        onboarding_completed_at: '2026-01-02T00:00:00Z', military_info: sharedMilitary,
      };
      const single = route.request().headers()['accept']?.includes('pgrst.object');
      return route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Range': '0-0/*' },
        json: single ? profile : [profile],
      });
    });
    const page = await context.newPage();
    await page.goto('/search');
    await expect(page.getByTestId('service-level')).toBeVisible();
    await expect(page.getByTestId('service-level')).toHaveText('Lv.5941');
    await expect(page.getByTestId('service-rank-estimate')).toContainText('예상 계급 ·');
    projectedLevels.push((await page.getByTestId('service-level').innerText()).trim());
    await expect(page.getByRole('button', { name: '복무 정보 수정' })).toHaveCount(scenario.role === 'soldier' ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`search-${scenario.role}-375.png`), fullPage: true });
    await context.close();
  }
  expect(projectedLevels[0]).toBe(projectedLevels[1]);
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
  await page.getByText('성장 여정', { exact: true }).click();
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
