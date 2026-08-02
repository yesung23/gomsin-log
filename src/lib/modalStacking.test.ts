import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Bug condition:
 *   isBugCondition(overlay) = isBottomAnchored(overlay)
 *                             && zIndexOf(overlay) <= zIndexOf(MobileShell tab bar)
 *
 * MobileShell renders the tab bar as `<nav class="fixed bottom-0 ... z-50">`
 * AFTER `<main>`, so an overlay rendered from a page (inside `<main>`) with the
 * SAME z-index loses the paint order and the tab bar ends up on top. For a
 * centred dialog that is usually invisible; for a BOTTOM-ANCHORED sheet the tab
 * bar lands squarely on the sheet's action row.
 *
 * Measured in a real headless Chromium at 390x844 before the fix, via
 * `document.elementFromPoint` at each control's centre point:
 *
 *   RecordPage detail modal   "수정"  (72,788)  -> <a>   inside nav[role=tablist]
 *   RecordPage detail modal   "삭제"  (144,788) -> <svg> inside nav[role=tablist]
 *   TripsPage new-trip        "취소" / "만들기"  -> <a>  inside nav[role=tablist]
 *   TripDetailPage item sheet "취소" / "저장"    -> <a>  inside nav[role=tablist]
 *   AddWidgetBottomSheet      "다음 휴가·면회" row (y 749..821) -> tab bar
 *
 * The owner-only 수정 / 삭제 controls were therefore not merely clipped: a tap
 * aimed at them navigated to a tab instead. SchedulePage's event modal already
 * used `z-[60]`, which is the precedent this guard generalises.
 */

const SHELL = 'src/components/MobileShell.tsx';

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

/**
 * Every `z-<n>` / `z-[<n>]` in a class string, as numbers.
 *
 * The trailing boundary is `(?![\w-])` rather than `\b`: after the `]` of
 * `z-[60]` both neighbours are non-word characters, so `\b` does not match there
 * and the arbitrary-value syntax would be silently skipped -- which would make
 * this whole guard pass vacuously.
 */
function zIndexesIn(classAttr: string): number[] {
  return [...classAttr.matchAll(/\bz-(?:\[(\d+)\]|(\d+))(?![\w-])/g)]
    .map((match) => Number(match[1] ?? match[2]));
}

/** The tab bar's own stacking order, read from the shell rather than hardcoded. */
function tabBarZIndex(): number {
  const source = read(SHELL);
  const nav = source.match(/<nav[\s\S]*?>/);
  expect(nav, 'MobileShell must still render a <nav> tab bar').not.toBeNull();
  const zs = zIndexesIn(nav![0]);
  expect(zs, 'the tab bar must declare a z-index').toHaveLength(1);
  return zs[0];
}

/**
 * Overlay roots that anchor their content to the bottom of the viewport, which
 * is exactly the geometry that collides with the tab bar.
 *
 * Two shapes exist in this codebase:
 *   `fixed inset-0 ... items-end`   - full-viewport flex container, sheet at the bottom
 *   `fixed bottom-0 ... `           - the sheet itself, pinned to the bottom
 */
const BOTTOM_ANCHORED_OVERLAY =
  /className="([^"]*\bfixed\b[^"]*)"/g;

function isBottomAnchored(classAttr: string): boolean {
  const fixed = /\bfixed\b/.test(classAttr);
  if (!fixed) return false;
  const fullViewportSheet = /\binset-0\b/.test(classAttr) && /\bitems-end\b/.test(classAttr);
  const pinnedSheet = /\bbottom-0\b/.test(classAttr) && /\bleft-0\b/.test(classAttr);
  return fullViewportSheet || pinnedSheet;
}

/**
 * Files that render a bottom-anchored overlay from inside MobileShell.
 * `AddWidgetBottomSheet` reaches the shell indirectly, through WidgetDashboard.
 */
const GUARDED_FILES = [
  'src/pages/RecordPage.tsx',
  'src/pages/TripsPage.tsx',
  'src/pages/TripDetailPage.tsx',
  'src/components/widgets/AddWidgetBottomSheet.tsx',
];

/**
 * Overlays deliberately left at the tab bar's z-index, each with the reason.
 * All of these are CENTRED dialogs whose controls were confirmed hit-testable at
 * 390x844 in a real browser, so they are not in the bug condition.
 */
const CENTRED_DIALOGS_LEFT_ALONE: Array<{ file: string; reason: string }> = [
  {
    file: 'src/pages/SettingsPage.tsx',
    reason: 'All five Settings dialogs are `items-center` and short, so no control '
      + 'lands in the tab bar band. Verified in headless Chromium at 390x844: the '
      + 'profile-edit, disconnect-couple, delete-account and purge-records dialogs '
      + 'each reported every control hit-testable via elementFromPoint.',
  },
  {
    file: 'src/pages/ServicePage.tsx',
    reason: 'Centred military-info editor dialog, same reasoning as SettingsPage: it '
      + 'is `items-center`, so its controls never reach the bottom band where the tab '
      + 'bar sits, and no control was reported blocked in the browser sweep.',
  },
];

describe('bottom-anchored overlays stack above the tab bar', () => {
  const navZ = tabBarZIndex();

  it('MobileShell still pins the tab bar with a z-index we can compare against', () => {
    expect(navZ).toBeGreaterThan(0);
    // The tab bar also has to keep coming after <main>, which is what makes an
    // equal z-index lose.
    const shell = read(SHELL);
    expect(shell.indexOf('<main')).toBeLessThan(shell.indexOf('<nav'));
  });

  for (const file of GUARDED_FILES) {
    it(`${file} declares every bottom-anchored overlay above z-${navZ}`, () => {
      const source = read(file);
      const offenders: string[] = [];
      let found = 0;
      for (const match of source.matchAll(BOTTOM_ANCHORED_OVERLAY)) {
        const classAttr = match[1];
        if (!isBottomAnchored(classAttr)) continue;
        found += 1;
        for (const z of zIndexesIn(classAttr)) {
          if (z <= navZ) offenders.push(`z-${z} in "${classAttr.slice(0, 90)}"`);
        }
      }
      // A guard that silently matches nothing is not a guard.
      expect(found, `${file} should still contain a bottom-anchored overlay`).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });
  }

  it('records a reason for every centred dialog left at the tab bar z-index', () => {
    for (const entry of CENTRED_DIALOGS_LEFT_ALONE) {
      const source = read(entry.file);
      expect(source, entry.file).toContain('fixed inset-0');
      expect(entry.reason.length).toBeGreaterThan(60);
    }
  });

  it('classifies overlay geometry the way the collision actually works', () => {
    // Bottom-anchored: in the bug condition.
    expect(isBottomAnchored('fixed inset-0 z-50 flex items-end justify-center bg-black/40')).toBe(true);
    expect(isBottomAnchored('fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl')).toBe(true);
    // Centred or not fixed: not in the bug condition.
    expect(isBottomAnchored('fixed inset-0 z-50 flex items-center justify-center')).toBe(false);
    expect(isBottomAnchored('absolute inset-0 items-end')).toBe(false);
    expect(isBottomAnchored('mx-4 mt-3 flex items-center')).toBe(false);
  });

  /**
   * Same collision, non-modal case.
   *
   * MobileShell documents the offline indicator as sitting "visually above the
   * tab bar", but it was `z-50` like the bar and rendered EARLIER in the DOM, so
   * the bar won. Measured at 390 / 412 / 430 x 844: the banner pill occupied
   * y 746..784 while the tab bar started at y 775, and `elementFromPoint` three
   * pixels above the pill's bottom edge returned an element inside
   * nav[role=tablist] -- i.e. 9px of the pill, including its bottom border and
   * rounded corners, were painted over.
   */
  it('the offline banner is not painted over by the tab bar', () => {
    const source = read('src/components/OfflineBanner.tsx');
    const alert = source.match(/className="([^"]*\bfixed\b[^"]*)"/);
    expect(alert, 'OfflineBanner must still render a fixed layer').not.toBeNull();
    const zs = zIndexesIn(alert![1]);
    expect(zs, 'the offline banner must declare a z-index').toHaveLength(1);
    expect(zs[0]).toBeGreaterThan(navZ);
  });

  it('reads both z-50 and the arbitrary z-[60] syntax', () => {
    expect(zIndexesIn('fixed inset-0 z-50 items-end')).toEqual([50]);
    expect(zIndexesIn('fixed inset-0 z-[60] items-end')).toEqual([60]);
    expect(zIndexesIn('fixed bottom-20 z-40')).toEqual([40]);
    expect(zIndexesIn('rounded-xl bg-card')).toEqual([]);
  });
});
