import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER_LOG } from './scenarios';

for (const viewport of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
  { width: 430, height: 932 },
]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`Home and Diary open the exact source at ${viewport.width}px ${colorScheme}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce' });
      await installMockBackend(context, CREATOR, { theme: colorScheme });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto('/home');
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      const post = page.getByRole('article').filter({ hasText: PARTNER_LOG });
      const homeLink = post.getByRole('link', { name: /기록 열기$/ });
      await expect(homeLink).toHaveAttribute('href', '/record?record=rec-partner');
      const homeTarget = await homeLink.boundingBox();
      expect(homeTarget?.height).toBeGreaterThanOrEqual(44);
      expect(homeTarget?.width).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
      await homeLink.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/record\?record=rec-partner$/);
      await expect(page.locator('#record-rec-partner')).toBeVisible();
      await expect(page.locator('#record-rec-partner')).toHaveClass(/record-highlighted/);

      await page.goto('/diary');
      await page.getByRole('button', { name: /지면 열기$/ }).first().click();
      const diaryRow = page.getByTestId('diary-page-record').filter({ hasText: PARTNER_LOG });
      const diaryLink = diaryRow.getByRole('link', { name: /기록 열기$/ });
      await expect(diaryLink).toHaveAttribute('href', '/record?record=rec-partner');
      const diaryTarget = await diaryLink.boundingBox();
      expect(diaryTarget?.height).toBeGreaterThanOrEqual(44);
      expect(diaryTarget?.width).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath('diary.png'), fullPage: true });
      await diaryLink.click();
      await expect(page).toHaveURL(/\/record\?record=rec-partner$/);
      await expect(page.locator('#record-rec-partner')).toBeVisible();
      await expect(page.locator('#record-rec-partner')).toHaveClass(/record-highlighted/);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}
