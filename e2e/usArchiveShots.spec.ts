import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { PARTNER } from './scenarios';
import { mkdir } from 'node:fs/promises';

const OUT = 'ui-audit-results/us';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

for (const width of [320, 390]) {
  test(`us archive ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await installMockBackend(context, PARTNER);
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
    await page.screenshot({ path: `${OUT}/us-${width}.png`, fullPage: true });
    await context.close();
  });
}
