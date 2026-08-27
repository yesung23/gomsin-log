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
    await expect(dialog.getByText('사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장')).toHaveClass(/text-heading/);
    const original = dialog.getByRole('button', { name: /원본 보기/ });
    const actions = original.locator('xpath=..');
    expect((await actions.boundingBox())!.y).toBeGreaterThan((await dialog.getByText('사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장').boundingBox())!.y);
    await page.screenshot({ path: `${OUT}/story-${width}.png`, fullPage: true });

    await page.goto('/settings');
    await page.getByRole('button', { name: '무지 종이' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-paper', 'plain');
    const background = await page.locator('#main-content').evaluate((node) => getComputedStyle(node).backgroundImage);
    expect(background).toBe('none');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-paper', 'plain');
    await expect(page.getByRole('button', { name: '무지 종이' })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `${OUT}/plain-paper-${width}.png`, fullPage: true });

    await context.close();
  });
}
