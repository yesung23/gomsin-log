import { test, expect, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

/**
 * The type scale, as the browser actually paints it.
 *
 * src/lib/typeScale.test.ts reads source text: it proves no off-scale utility is
 * WRITTEN. It cannot prove the utilities RESOLVE -- a scale entry Tailwind failed
 * to generate would leave every element at the browser default and the source
 * guard would still pass. This measures the rendered result instead.
 *
 * The subject is the record timeline because that is where the claim matters:
 * every briefing summary points here, and the partner's own sentence used to be
 * 14px while the chrome around it was the same size or larger.
 *
 * Measured at 320px, the narrowest supported width -- if a 12px floor is going to
 * break a layout, it breaks there first.
 *
 * DESIGN_V2 (2026-08-08) revised the scale: `caption` at 12px is the floor for
 * metadata (times, secondary labels). The couple's own words are protected at
 * 15-16px (`body` / `body-emphasis`) — this is the range where Korean prose stays
 * comfortable to read on small screens without requiring zoom.
 */

/** DESIGN_V2 §3.3 (revised 2026-08-08). `caption` (12px) is the floor; prose starts at `body` (15px). */
const CAPTION_FLOOR_PX = 12;
const BODY_PX = 15;

async function seed(page: Page) {
  // The context fixture already owns a page, so the mocks go on it and take
  // effect from the next navigation. Creating a second context inside the test
  // made Playwright's own fixture bookkeeping fail with an internal error.
  await installMockBackend(page.context(), CREATOR);
  await page.setViewportSize({ width: 320, height: 568 });
}

test('the record timeline paints prose at body and nothing below caption', async ({ page }) => {
  await seed(page);
  await page.goto('/record');
  await expect(page.locator('#root')).not.toBeEmpty();
  /*
    앱이 떴다는 표식은 **탭바 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 탭바에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tab')).toHaveCount(5);

  const result = await page.evaluate(() => {
    /** Every record card. The label is built from the author attribution. */
    const cards = Array.from(document.querySelectorAll('button[aria-label$="자세히 보기"]'));
    const sizes: Array<{ text: string; px: number }> = [];
    for (const card of cards) {
      for (const element of [card, ...Array.from(card.querySelectorAll('*'))]) {
        /*
         * Visually hidden text is skipped.
         *
         * The author attribution is rendered as an `sr-only` sentence: read
         * aloud, the sighted-reader chip `🌸 곰신 · 춘향` becomes "cherry blossom
         * 곰신 middle dot 춘향", so assistive tech gets prose instead. It is also
         * the LONGEST string in a card, which is how the first version of this
         * test reported the attribution as the record's own words. Nobody sees
         * it, so no rendered size applies to it.
         */
        if ((element as HTMLElement).classList.contains('sr-only')) continue;
        // Only elements that paint their OWN text: a wrapper inherits a size it
        // does not use, and counting it would report a size nobody can see.
        const own = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => (node.textContent ?? '').trim())
          .join('');
        if (!own) continue;
        sizes.push({
          text: own.slice(0, 24),
          px: Number.parseFloat(getComputedStyle(element as HTMLElement).fontSize),
        });
      }
    }

    const log = document.querySelector('[data-testid="record-log"]');
    if (!log) return { cardCount: cards.length, sizes, log: null };
    const style = getComputedStyle(log);
    return {
      cardCount: cards.length,
      sizes,
      log: {
        text: (log.textContent ?? '').slice(0, 24),
        px: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      },
    };
  });

  // A selector that matched nothing must not pass as "no violation".
  expect(result.cardCount, 'record cards rendered').toBeGreaterThan(0);
  expect(result.sizes.length, 'text-bearing elements measured').toBeGreaterThan(2);

  const belowFloor = result.sizes
    .filter((entry) => entry.px < CAPTION_FLOOR_PX)
    .map((entry) => `"${entry.text}" ${entry.px}px`);
  expect(belowFloor, `rendered text below the ${CAPTION_FLOOR_PX}px floor`).toEqual([]);

  // The record's own words, found by a hook rather than by guessing which string
  // in the card is longest.
  expect(result.log, 'the record log paragraph').not.toBeNull();
  expect(result.log!.px, `record prose "${result.log!.text}"`).toBeGreaterThanOrEqual(BODY_PX);
  // 16/24 from the scale. A leading below 1.4 is what makes Korean prose crowd.
  expect(result.log!.lineHeight / result.log!.px).toBeGreaterThanOrEqual(1.4);
});
