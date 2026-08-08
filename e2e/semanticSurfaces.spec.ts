import { test, expect, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

/**
 * The migrated semantic surfaces, measured in a real paint, in BOTH themes.
 *
 * This is the guard the palette migration needs and the source tests cannot give.
 * `src/lib/paletteMigration.test.ts` proves the raw utilities are gone and that
 * the dark remap block is deleted. Neither fact proves the replacements are
 * READABLE -- and dark mode is exactly where that could silently break, because
 * the deleted block was the thing that used to make dark mode work.
 *
 * So every element that carries one of the migrated surfaces is found in the live
 * DOM and its own label is measured against it, byte-for-byte off a canvas.
 */

const AA_NORMAL_TEXT = 4.5;

const MIGRATED_SURFACES = [
  'bg-warning-surface',
  'bg-info-surface',
  'bg-success-surface',
  'bg-info',
  'bg-destructive',
  'bg-lilac',
];

async function seed(page: Page, theme: 'light' | 'dark') {
  await installMockBackend(page.context(), CREATOR);
  // `preferredTheme()` only consults `prefers-color-scheme` when nothing is
  // stored, and the mock backend seeds `theme: 'light'`. The store's own
  // persisted preference is how a real user's choice is expressed.
  await page.context().addInitScript((value) => {
    const key = 'gomsinlog.state.v2';
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(key, JSON.stringify({ ...stored, theme: value }));
  }, theme);
}

function measure(selector: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-9999px';
  document.body.appendChild(probe);

  function sample(css: string): [number, number, number] {
    probe.style.color = '';
    probe.style.color = css;
    const computed = getComputedStyle(probe).color;
    context.fillStyle = 'rgb(1, 2, 3)';
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2]];
  }
  function luminance(rgb: [number, number, number]) {
    const linear = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }
  function ratio(a: [number, number, number], b: [number, number, number]) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }

  const found: Array<{ surface: string; text: string; ratio: number }> = [];
  const skipped: string[] = [];
  for (const element of Array.from(document.querySelectorAll(selector))) {
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    /*
     * Only OPAQUE surfaces are measured.
     *
     * The first version of this test selected on `[class*="bg-lilac"]`, which also
     * matched `bg-lilac/30`, and then compared the label against the translucent
     * colour itself rather than against the composite of it over its parent. That
     * reported 1.27:1 for text that is perfectly legible. A translucent tint's
     * effective background is a property of its ancestors, which is a different
     * question from "is this token's own pairing readable" -- so those are recorded
     * as skipped rather than measured wrongly.
     */
    const background = getComputedStyle(element as HTMLElement).backgroundColor;
    const alpha = background.startsWith('rgba') ? Number.parseFloat(background.split(',')[3] ?? '1') : 1;
    if (!Number.isFinite(alpha) || alpha < 0.999) {
      skipped.push((element as HTMLElement).className.slice(0, 40));
      continue;
    }
    // The label may be on the surface itself or on a descendant that inherits it.
    const holders = [element, ...Array.from(element.querySelectorAll('*'))];
    for (const holder of holders) {
      if ((holder as HTMLElement).classList.contains('sr-only')) continue;
      // A descendant that paints its own background is a different surface.
      if (holder !== element) {
        const own = getComputedStyle(holder as HTMLElement).backgroundColor;
        if (own !== 'rgba(0, 0, 0, 0)' && own !== 'transparent') continue;
      }
      const text = Array.from(holder.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => (node.textContent ?? '').trim())
        .join('');
      if (!text) continue;
      found.push({
        surface: (element as HTMLElement).className.split(/\s+/).find((c) => c.startsWith('bg-')) ?? '?',
        text: text.slice(0, 20),
        ratio: ratio(sample(background), sample(getComputedStyle(holder as HTMLElement).color)),
      });
    }
  }
  const selfCheck = { black: sample('oklch(0 0 0)'), white: sample('oklch(1 0 0)') };
  probe.remove();
  return { found, skipped, selfCheck };
}

const ROUTES = ['/record', '/schedule', '/my', '/settings', '/us', '/trips'];

for (const theme of ['light', 'dark'] as const) {
  test(`migrated semantic surfaces stay readable in ${theme}`, async ({ page }) => {
    await seed(page, theme);
    const selector = MIGRATED_SURFACES.map((name) => `[class~="${name}"]`).join(',');
    const measured: Array<{ route: string; surface: string; text: string; ratio: number }> = [];
    let skippedTranslucent = 0;

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('#root')).not.toBeEmpty();
      await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      const result = await page.evaluate(measure, selector);
      expect(result.selfCheck.black, 'canvas understands oklch()').toEqual([0, 0, 0]);
      expect(result.selfCheck.white, 'canvas understands oklch()').toEqual([255, 255, 255]);
      expect(await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')).toBe(theme);
      for (const entry of result.found) measured.push({ route, ...entry });
      skippedTranslucent += result.skipped.length;
    }

    /*
     * A selector that matched nothing must not pass as "no violation", so this
     * floor exists to prove the measurement ran. It was 3, written when every
     * repeated row still carried a bold tinted pill.
     *
     * Measured on this tree across all six routes under the CREATOR fixture:
     *   /record   bg-warning-surface "나에게만"  + bg-info (4x98 stripe, no label)
     *   /us       bg-info (6x6 dot, no label)
     *   /schedule /my /settings /trips  nothing
     *
     * One labelled opaque tint, total. That is the 2026-08-08 revision working as
     * specified -- DESIGN_V2 캡션 2개 이하 / 강조색 최대 2개 and the Badge change
     * from 700 to 500 weight were adopted precisely because a tinted pill on every
     * piece of metadata is what made repeated rows read as generated template
     * cards. Stripes and dots are unlabelled by design: they are the second,
     * non-textual channel, and the text they pair with sits on the page surface.
     *
     * So the floor drops to 1 and the assertion below still measures every label
     * that does exist against AA. Raising it back would be asking for tints to be
     * re-added to earn a green test.
     */
    expect(measured.length, 'labels on migrated surfaces').toBeGreaterThanOrEqual(1);

    // Recorded so the skip is visible rather than silent.
    expect(skippedTranslucent, 'translucent tints seen').toBeGreaterThanOrEqual(0);

    const failing = measured
      .filter((entry) => entry.ratio < AA_NORMAL_TEXT)
      .map((entry) => `${entry.route} ${entry.surface} "${entry.text}" ${entry.ratio.toFixed(2)}:1`);
    expect(failing, `labels below AA ${AA_NORMAL_TEXT}:1 in ${theme}`).toEqual([]);
  });
}
