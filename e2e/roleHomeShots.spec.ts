import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER } from './scenarios';
import { mkdir } from 'node:fs/promises';

/**
 * The two homes, side by side.
 *
 * Gate 2 asked that these not be the same screen with different cards. V4 answers
 * that differently: 한 화면에 두 개의 링을 두고 **역할마다 먼저 누르는 링이 다르다**
 * (`HomePage.tsx` 참고). 화면이 갈리지 않으므로 이 스펙이 증명할 수 있는 것은 줄었다 --
 * 두 역할 모두에서 홈이 320·390 에서 실제로 그려지는가, 그리고 그 결과를 눈으로 볼 수
 * 있게 남기는가. 역할차 자체는 링을 보는 `emotionRedesign` 쪽이 소유한다.
 */
const OUT = 'ui-audit-results/home';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

const ROLES = [
  { name: 'sender-gomsin', scenario: CREATOR },
  { name: 'receiver-gunhwa', scenario: PARTNER },
];

for (const { name, scenario } of ROLES) {
  for (const width of [320, 390]) {
    test(`${name} ${width}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await installMockBackend(context, scenario);
      const page = await context.newPage();
      await page.goto('/home');
      await expect(page.getByTestId('home-core')).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
      await context.close();
    });
  }
}
