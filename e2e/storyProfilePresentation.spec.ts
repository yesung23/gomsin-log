import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installMockBackend } from './fixtures/mockBackend';
import { PARTNER, TODAY } from './scenarios';

const OUT = 'ui-audit-results/story-profile-presentation';

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

function longRecords() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `long-${index}`,
    user_id: index === 0 ? 'user-creator' : 'user-partner',
    couple_id: 'couple-1',
    record_date: TODAY,
    record_time: `${String(9 + index).padStart(2, '0')}:07:59`,
    log_text: index === 0 ? '사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장' : `스크롤 검증 기록 ${index}`,
    is_private: false,
    is_profile_post: true,
    attachments: [{
      type: 'photo',
      name: `story-photo-${index}.jpg`,
      path: `couple-1/long-${index}/story-photo-${index}.jpg`,
    }],
    emotion_flow: [],
    created_at: `${TODAY}T10:00:00Z`,
  }));
}

for (const width of [320, 390]) {
  test(`story and fixed headers render at ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 700 } });
    await installMockBackend(context, { ...PARTNER, records: longRecords() });
    const page = await context.newPage();

    await page.goto('/home');
    const homeHeader = page.getByTestId('home-sticky-header');
    await expect(homeHeader).toBeVisible({ timeout: 20_000 });
    const homeTop = (await homeHeader.boundingBox())!.y;
    await page.locator('#main-content').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect((await homeHeader.boundingBox())!.y).toBeCloseTo(homeTop, 0);

    await page.goto('/us');
    const profileHeader = page.getByTestId('profile-sticky-header');
    await expect(profileHeader).toBeVisible();
    const profileTop = (await profileHeader.boundingBox())!.y;
    await page.locator('#main-content').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect((await profileHeader.boundingBox())!.y).toBeCloseTo(profileTop, 0);

    await page.goto('/story/partner?at=long-0');
    const dialog = page.getByRole('dialog', { name: '오늘' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('09:07', { exact: true })).toBeVisible();
    const storyCopy = dialog.getByText('사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장');
    await expect(storyCopy).toHaveClass(/record-copy/);
    expect(await storyCopy.evaluate((node) => getComputedStyle(node).fontSize)).toBe('17px');
    const original = dialog.getByRole('button', { name: /원본 보기/ });
    const actions = original.locator('xpath=..');
    expect((await actions.boundingBox())!.y).toBeGreaterThan((await dialog.getByText('사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장').boundingBox())!.y);
    await page.screenshot({ path: `${OUT}/story-${width}.png`, fullPage: true });

    await page.goto('/settings');
    const sizeButtons = ['작게', '기본', '크게'].map((name) => page.getByRole('button', { name, exact: true }));
    for (const button of sizeButtons) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await sizeButtons[2].click();
    await expect(page.locator('html')).toHaveAttribute('data-record-text-size', 'large');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-record-text-size', 'large');
    await expect(page.getByRole('button', { name: '크게', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByText('게시물·스토리 글자 크기', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/text-size-settings-${width}.png` });

    await page.goto('/story/partner?at=long-0');
    const largeStoryCopy = page.getByRole('dialog', { name: '오늘' }).getByText('사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장');
    expect(await largeStoryCopy.evaluate((node) => getComputedStyle(node).fontSize)).toBe('20px');
    await page.screenshot({ path: `${OUT}/large-story-${width}.png`, fullPage: true });

    await page.goto('/home');
    // Home is partner-oriented: for this fixture long-0 belongs to the signed-in
    // user's partner, while long-1 is the signed-in user's own record.
    const largeHomeCopy = page.getByText('사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장', { exact: true });
    await expect(largeHomeCopy).toBeVisible();
    expect(await largeHomeCopy.evaluate((node) => getComputedStyle(node).fontSize)).toBe('20px');
    await expect(page.getByText('스크롤 검증 기록 1', { exact: true })).toHaveCount(0);

    await context.close();
  });
}
