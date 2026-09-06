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
    // Home now follows the photo's natural ratio. Make scroll travel come from
    // genuinely long content, not the former fixed portrait frame.
    log_text: index === 0 ? '사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장 '.repeat(24) : `스크롤 검증 기록 ${index}`,
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
    const measureHome = () => homeHeader.evaluate((header) => {
      const main = document.querySelector<HTMLElement>('#main-content')!;
      const sheet = header.parentElement!;
      const mainBox = main.getBoundingClientRect();
      return {
        headerY: header.getBoundingClientRect().top,
        mainViewportY: mainBox.top + main.clientTop,
        stickyInset: Number.parseFloat(getComputedStyle(header).top),
        position: getComputedStyle(header).position,
        sheetMarginTop: getComputedStyle(sheet).marginTop,
        sheetBorderTop: getComputedStyle(sheet).borderTopWidth,
        scrollTop: main.scrollTop,
        maxScroll: main.scrollHeight - main.clientHeight,
      };
    });
    const initial = await measureHome();
    expect(initial.position).toBe('sticky');
    expect(Number.isFinite(initial.stickyInset)).toBe(true);
    expect(initial.scrollTop).toBe(0);
    const pinnedTop = initial.mainViewportY + initial.stickyInset;
    const travel = initial.headerY - pinnedTop;
    expect(travel).toBeGreaterThanOrEqual(0);
    // The sheet's margin and border precede the header in normal flow. Sticky
    // may travel through that space before clamping to the main scrollport.
    expect(initial.maxScroll / 2).toBeGreaterThan(travel);
    await page.locator('#main-content').evaluate((node) => {
      node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
    });
    await expect.poll(async () => (await measureHome()).headerY).toBeCloseTo(pinnedTop, 0);
    const middle = await measureHome();
    await page.locator('#main-content').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect.poll(async () => {
      const measurement = await measureHome();
      return measurement.maxScroll - measurement.scrollTop;
    }).toBe(0);
    await expect.poll(async () => (await measureHome()).headerY).toBeCloseTo(pinnedTop, 0);
    const deep = await measureHome();
    expect(middle.scrollTop).toBeGreaterThan(travel);
    expect(deep.scrollTop).toBeGreaterThan(middle.scrollTop);
    for (const measurement of [middle, deep]) {
      const expectedTop = Math.max(
        initial.headerY - measurement.scrollTop,
        measurement.mainViewportY + measurement.stickyInset,
      );
      expect(measurement.headerY).toBeCloseTo(expectedTop, 0);
    }
    expect(deep.headerY).toBeCloseTo(middle.headerY, 0);
    await test.info().attach(`home-sticky-geometry-${width}`, {
      body: JSON.stringify({ width, initial, middle, deep }, null, 2),
      contentType: 'application/json',
    });

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
    const largeHomeCopy = page.getByText('사진과 함께 남긴 조금 더 크게 읽히는 스토리 문장 '.repeat(24).trim(), { exact: true });
    await expect(largeHomeCopy).toBeVisible();
    expect(await largeHomeCopy.evaluate((node) => getComputedStyle(node).fontSize)).toBe('20px');
    await expect(page.getByText('스크롤 검증 기록 1', { exact: true })).toHaveCount(0);

    await context.close();
  });
}
