import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { PARTNER, TODAY } from './scenarios';
import { mkdir } from 'node:fs/promises';

const OUT = 'ui-audit-results/us';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

for (const width of [320, 390]) {
  test(`us archive ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await installMockBackend(context, {
      ...PARTNER,
      // 게시물 격자는 사용자가 프로필에 명시적으로 발행한 사진 기록만 보여준다.
      // 여행 목록도 함께 검증하기 위해 같은 날짜의 여행 fixture를 둔다.
      trips: [{
        id: 'trip-browser',
        couple_id: 'couple-1',
        created_by: 'user-partner',
        title: '이번 여행',
        start_date: TODAY,
        end_date: TODAY,
        status: 'planned',
        created_at: `${TODAY}T00:00:00Z`,
      }],
      records: (PARTNER.records ?? []).map((record) => record.id === 'rec-shared'
        ? {
          ...record,
          // Record media paths use the same canonical ASCII filename rule as
          // production storage; a Korean filename would be rejected before the
          // photo ever reaches the grid.
          is_profile_post: true,
          attachments: [{ type: 'photo', name: 'trip-photo.jpg', path: 'couple-1/rec-shared/trip-photo.jpg' }],
        }
        : record),
    });
    const page = await context.newPage();
    await page.goto('/us');
    /*
      `우리` 의 첫 탭이 하루 격자에서 **게시물 격자**로 바뀌었다 (2026-08-23).

      앞선 판은 `month-texture-*` 를 기다렸다 -- 한 달의 모든 날을 7열로 그리던 것이고,
      날짜가 적혀 있고 빈 칸이 있어 쓰는 사람에게는 달력으로 읽혔다. 칸의 단위가 하루가
      아니라 **기록**이 되면서 그 노드는 사라졌다.

      지키는 것은 그대로다 -- 이 화면이 320·390 에서 실제로 격자를 그리는가, 그리고 그
      결과를 눈으로 볼 수 있게 남기는가.
    */
    await expect(page.getByTestId('post-grid')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('post-grid').locator('[data-kind="photo"]')).toHaveCount(1);
    await expect(page.getByTestId('post-grid').locator('[data-kind="text"]')).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/us-${width}.png`, fullPage: true });

    await page.getByTestId('post-tile-rec-shared').click();
    await expect(page.getByTestId('photo-post-viewer')).toBeVisible();
    await page.screenshot({ path: `${OUT}/us-post-detail-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('photo-post-viewer')).toHaveCount(0);

    const photoTab = page.getByRole('button', { name: '사진', exact: true });
    await photoTab.click();
    await expect(photoTab).toHaveAttribute('aria-pressed', 'true');
    const tabSizes = await page.locator('.profile-tab').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    expect(new Set(tabSizes.map(({ height }) => height)).size, 'the selected tab must keep the same height as its siblings').toBe(1);
    expect(Math.max(...tabSizes.map(({ width }) => width)) - Math.min(...tabSizes.map(({ width }) => width)))
      .toBeLessThan(0.1);
    await page.screenshot({ path: `${OUT}/us-photo-tab-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: '여행' }).click();
    await expect(page.getByTestId('profile-trips-list')).toBeVisible();
    await expect(page.getByTestId('profile-trip-trip-browser')).toBeVisible();
    await page.screenshot({ path: `${OUT}/us-trips-${width}.png`, fullPage: true });

    await context.close();
  });
}
