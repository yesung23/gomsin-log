import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, CREATOR_PENDING, record } from './scenarios';

const LONG_LOG = '긴 기록 '.repeat(300);
const LONG_TOKEN = 'unbroken-record-content-'.repeat(80);

async function openRecordDetail(page: import('@playwright/test').Page) {
  const opener = page.getByRole('button', { name: /자세히 보기/ }).first();
  await expect(opener).toBeVisible({ timeout: 20_000 });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return { dialog, opener };
}

test('Record detail and composer keep focus inside and restore their openers', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 667 } });
  await installMockBackend(context, { ...CREATOR, records: [record({ id: 'record-a11y', user_id: CREATOR.userId })] });
  const page = await context.newPage();
  await page.goto('/record');

  const { dialog, opener } = await openRecordDetail(page);
  const close = dialog.getByRole('button', { name: '닫기' });
  await expect(close).toBeFocused();

  const focusables = dialog.locator('button:not([disabled]), textarea');
  const first = focusables.first();
  const last = focusables.last();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  const reopened = await openRecordDetail(page);
  await reopened.dialog.getByRole('button', { name: '수정' }).click();
  await expect(reopened.dialog.getByRole('textbox', { name: '기록 내용 수정' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(reopened.dialog.getByRole('textbox', { name: '기록 내용 수정' })).toHaveCount(0);

  await reopened.dialog.getByRole('button', { name: '삭제' }).click();
  await expect(reopened.dialog.getByText('이 기록을 삭제할까요?')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(reopened.dialog.getByText('이 기록을 삭제할까요?')).toHaveCount(0);

  await reopened.dialog.getByRole('button', { name: '닫기' }).click();
  await expect(opener).toBeFocused();

  await page.getByRole('button', { name: '기록 남기기' }).click();
  const composer = page.getByRole('dialog', { name: '기록 남기기' });
  await expect(composer).toBeVisible();
  await expect(composer.locator('button').first()).toBeFocused();

  const composerFocusables = composer.locator([
    'button:not([disabled]):visible',
    'input:not([disabled]):visible',
    'textarea:not([disabled]):visible',
    'a[href]:visible',
  ].join(', '));
  const composerFirst = composerFocusables.first();
  const composerLast = composerFocusables.last();
  await composerFirst.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(composerLast).toBeFocused();
  await composerLast.focus();
  await page.keyboard.press('Tab');
  await expect(composerFirst).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(composer).toHaveCount(0);
  await expect(page.getByRole('button', { name: '기록 남기기' })).toBeFocused();

  await page.goto('/record?compose=1');
  const directComposer = page.getByRole('dialog', { name: '기록 남기기' });
  await expect(directComposer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(directComposer).toHaveCount(0);
  await expect(page.getByRole('button', { name: '기록 남기기' })).toBeFocused();

  await context.close();
});

test('Record detail stays inside a short viewport and keeps compact controls tappable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 667 } });
  await installMockBackend(context, { ...CREATOR, records: [record({ id: 'record-long', user_id: CREATOR.userId, log_text: LONG_LOG })] });
  const page = await context.newPage();
  await page.goto('/record');

  await page.getByRole('button', { name: '달력 보기' }).click();
  await page.getByRole('button', { name: '이전 달' }).click();
  const today = page.getByRole('button', { name: '오늘', exact: true });
  const todayBox = await today.boundingBox();
  expect(todayBox?.height).toBeGreaterThanOrEqual(44);
  await today.click();

  const { dialog } = await openRecordDetail(page);
  const metrics = await dialog.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      scrollable: node.scrollHeight > node.clientHeight,
    };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.maxHeight).not.toBe('none');
  expect(['auto', 'scroll']).toContain(metrics.overflowY);
  expect(metrics.scrollable).toBe(true);

  const edit = dialog.getByRole('button', { name: '수정' });
  await edit.click();
  const editCancel = dialog.getByRole('button', { name: '취소', exact: true });
  expect((await editCancel.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await editCancel.click();
  await dialog.getByRole('button', { name: '삭제' }).click();
  const confirmDelete = dialog.getByRole('button', { name: '삭제', exact: true });
  const cancelDelete = dialog.getByRole('button', { name: '취소', exact: true });
  expect((await confirmDelete.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await cancelDelete.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await context.close();
});

test('Record wraps a single long token without horizontal overflow', async ({ browser }) => {
  // This is presentation evidence only. Protected-record decryption is covered
  // by the crypto integration suite; this fixture intentionally isolates layout.
  const context = await browser.newContext({ viewport: { width: 320, height: 667 } });
  await installMockBackend(context, {
    ...CREATOR,
    records: [record({ id: 'record-long-token', user_id: CREATOR.userId, log_text: LONG_TOKEN })],
  });
  const page = await context.newPage();
  await page.goto('/record');

  const rowText = page.locator('#record-record-long-token [data-testid="record-log"]');
  await expect(rowText).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const { dialog } = await openRecordDetail(page);
  const detailText = dialog.locator('p').filter({ hasText: LONG_TOKEN.slice(0, 30) });
  const detailMetrics = await detailText.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(detailMetrics.scrollWidth).toBeLessThanOrEqual(detailMetrics.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await context.close();
});

test('Record and Compose focus styles respect reduced motion and visible focus', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 667 }, reducedMotion: 'reduce' });
  await installMockBackend(context, { ...CREATOR, records: [record({ id: 'record-styles', user_id: CREATOR.userId })] });
  const page = await context.newPage();
  await page.goto('/record?record=record-styles');
  const card = page.locator('#record-record-styles');
  await expect(card).toBeVisible({ timeout: 20_000 });
  const cardMotion = await card.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      transitionDuration: style.transitionDuration,
      animationName: style.animationName,
      animationDuration: Number.parseFloat(style.animationDuration),
      animationIterations: style.animationIterationCount,
    };
  });
  expect(cardMotion.transitionDuration).toBe('0s');
  // Exact-record navigation keeps one short, non-moving highlight as essential
  // orientation feedback; reduced motion shortens it to a single 0.8s pass.
  expect(cardMotion.animationName).toBe('highlight-pulse');
  expect(cardMotion.animationDuration).toBeLessThanOrEqual(0.8);
  expect(cardMotion.animationIterations).toBe('1');

  const { dialog } = await openRecordDetail(page);
  await dialog.getByRole('button', { name: '수정' }).click();
  const editField = dialog.getByRole('textbox', { name: '기록 내용 수정' });
  await expect(editField).toBeFocused();
  const editFocus = await editField.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(editFocus.outlineStyle).not.toBe('none');
  expect(editFocus.outlineWidth).toBeGreaterThanOrEqual(2);

  await page.goto('/compose');
  const composeField = page.getByRole('textbox', { name: '오늘 남길 글' });
  await composeField.focus();
  const composeFocus = await composeField.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(composeFocus.outlineStyle).not.toBe('none');
  expect(composeFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  await context.close();
});

test('Garden settled unavailability is announced without claiming it is busy', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 667 } });
  await installMockBackend(context, CREATOR_PENDING);
  const page = await context.newPage();
  await page.goto('/diary/garden');
  const region = page.getByRole('region', { name: '정원 준비 안내' });
  const status = region.getByRole('status');
  await expect(status).toBeVisible({ timeout: 20_000 });
  await expect(status).toContainText('정원이 자라기 시작해요');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).not.toHaveAttribute('aria-busy');

  await context.close();
});
