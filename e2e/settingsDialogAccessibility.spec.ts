import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

test('Settings keeps its profile editor usable on a short iPhone viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();

  await page.goto('/settings');
  const opener = page.getByRole('button', { name: '내 프로필 수정' });
  await opener.scrollIntoViewIfNeeded();
  await opener.click();

  const dialog = page.getByRole('dialog', { name: '내 프로필 수정' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('textbox', { name: /내 닉네임/ })).toBeFocused();

  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      pageWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.scrollWidth - geometry.pageWidth).toBeLessThanOrEqual(1);

  const close = dialog.getByRole('button', { name: '프로필 수정 닫기' });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '저장하기' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await context.close();
});
