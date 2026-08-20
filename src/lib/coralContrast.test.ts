import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * C7 bug condition:
 *   isBugConditionC7(line) = declaresBareCoralFill(line) && carriesLightLabel(line)
 *
 * `--coral` is the brand colour and it is not readable as a button fill. Measured
 * in a real Chromium paint (docs/kiro/AI_HANDOFF.md §4.1, reproduced by
 * e2e/tokenContrast.spec.ts):
 *
 *   light  bg-coral + text-white              2.09:1   (WCAG AA needs 4.5:1)
 *   dark   bg-coral + text-coral-foreground   2.29:1
 *
 * On the unfixed tree this held for 51 lines across 16 files -- every primary
 * button in the app, the onboarding CTA chain, the selected date cell, the record
 * screen's floating CTA and both save buttons in every modal.
 *
 * The fix is a SECOND token rather than a new value for the first one: `--coral`
 * stays exactly as it is for the ~46 tints, the progress fill, the timeline
 * stripe, the tab indicator and the calendar dots, where nothing is written on
 * top and the ratio does not apply. `--coral-strong` is the coral you are allowed
 * to write on.
 *
 * This guard is the reason the split cannot silently rot back: any new
 * `bg-coral` that carries a light label fails here, and any new bare `bg-coral`
 * at all has to be added to the decoration inventory below with a reason.
 *
 * The inventory shrinks as well as grows. The active-tab indicator bar was removed
 * outright by the 2026-08-08 visual revision -- a 20x3px coral rule under a label
 * that is already coral is duplicated signal, and Low-chrome interface asks for the
 * decoration to go rather than for a third cue.
 */

const BARE_CORAL_FILL = /\bbg-coral(?![\w/-])/g;

/** The two light labels that were measured against a coral fill. */
const LIGHT_LABEL = /\btext-(?:white|coral-foreground)(?![\w/-])/;

/**
 * Every surviving bare `bg-coral`, each with the reason no contrast ratio applies
 * to it. An unexplained survivor is not acceptable, so this table is the
 * documentation -- the same discipline as ACCEPTED_EXCEPTIONS in themeTokens.test.ts.
 */
const DECORATIVE_CORAL_FILLS: Array<{ file: string; anchor: string; occurrences: number; reason: string }> = [
  {
    file: 'src/lib/recordAuthor.ts',
    anchor: "stripe: 'bg-coral'",
    occurrences: 1,
    reason: 'Author stripe down the left edge of a 곰신 record. It is a 3px rule, '
      + 'never a text surface, and recordAuthorDistinction.test.ts asserts this '
      + 'exact class because the stripe is one of the three redundant author cues.',
  },
  {
    file: 'src/components/ui/List.tsx',
    anchor: 'w-1.5 h-1.5 rounded-full bg-coral',
    occurrences: 1,
    reason: 'Editorial timeline node: a 6px dot on the connecting rail, marked '
      + 'aria-hidden and sitting on the page surface. It carries no label, and the '
      + 'row it belongs to states its time and author in text.',
  },
  {
    file: 'src/components/MobileShell.tsx',
    anchor: 'w-4 h-0.5 rounded-full bg-coral',
    occurrences: 1,
    reason: 'The bar under the active tab: 16x2px, aria-hidden, on the tab bar '
      + 'surface. Restored 2026-08-09 after the density pass removed it as a '
      + 'duplicate signal -- it was, and it was also the only saturated brand '
      + 'colour on every screen, which is why the app read cold without it. It is '
      + 'decoration on top of aria-selected, the text-coral-strong tint and the '
      + 'label weight, so it is never the only signal (WCAG 1.4.1) and it never '
      + 'has a label on it.',
  },
  {
    file: 'src/pages/RecordPage.tsx',
    anchor: "isSelected ? 'bg-coral-strong-foreground/80' : 'bg-coral'",
    occurrences: 1,
    reason: 'Record-count dot on an UNSELECTED calendar cell, so the dot sits on '
      + 'the page surface rather than on a coral fill. When the cell is selected '
      + 'the dot flips to the coral-strong label colour, which is the pairing that '
      + 'now has to hold.',
  },
  {
    file: 'src/pages/SchedulePage.tsx',
    anchor: "isToday && !isSelected ? 'bg-coral-strong-foreground' : 'bg-coral'",
    occurrences: 1,
    reason: 'Event dot on a calendar cell. Same pairing as RecordPage: coral on '
      + 'the page surface, and the label colour once the cell itself is filled.',
  },
  {
    file: 'src/pages/ServicePage.tsx',
    anchor: 'h-full bg-coral rounded-full',
    occurrences: 1,
    reason: 'Service progress bar fill. The percentage is printed OUTSIDE the bar, '
      + 'so no text is ever laid over this surface.',
  },
  {
    file: 'src/features/us/MonthGrid.tsx',
    anchor: 'rounded-full bg-coral',
    occurrences: 1,
    reason: 'Activity dot inside a day cell of the 우리 texture. It replaced the '
      + 'two calendar dots that used to live in UsPage, and like those it carries '
      + 'no text -- the day number sits above it, on the cell surface rather than '
      + 'on the dot.',
  },
];

/** Everything under src/ that can emit a class name, tests excluded. */
function uiSources(dir = 'src'): string[] {
  const absolute = resolve(process.cwd(), dir);
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...uiSources(relative));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    found.push(relative);
  }
  return found;
}

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file.split('/').join(sep)), 'utf8');
}

const SOURCES = uiSources();

describe('C7 - no light label sits on a --coral fill', () => {
  it('scans a non-empty set of sources, so a silent glob failure cannot pass', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES).toContain('src/pages/RecordPage.tsx');
    expect(SOURCES).toContain('src/components/widgets/CallBriefingWidget.tsx');
  });

  it('no source line declares a bare coral fill together with a light label', () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      read(file).split(/\r?\n/).forEach((line, index) => {
        BARE_CORAL_FILL.lastIndex = 0;
        if (!BARE_CORAL_FILL.test(line)) return;
        if (!LIGHT_LABEL.test(line)) return;
        offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every surviving bare coral fill is accounted for as decoration', () => {
    const expected = new Map<string, number>();
    for (const entry of DECORATIVE_CORAL_FILLS) {
      expected.set(entry.file, (expected.get(entry.file) ?? 0) + entry.occurrences);
    }
    const actual = new Map<string, number>();
    for (const file of SOURCES) {
      const count = read(file).match(BARE_CORAL_FILL)?.length ?? 0;
      if (count > 0) actual.set(file, count);
    }
    expect(Object.fromEntries([...actual].sort())).toEqual(Object.fromEntries([...expected].sort()));
  });

  it('every decoration entry still exists and still carries its reason', () => {
    for (const entry of DECORATIVE_CORAL_FILLS) {
      const source = read(entry.file);
      const occurrences = source.split(entry.anchor).length - 1;
      expect(occurrences, `${entry.file} :: ${entry.anchor}`).toBe(entry.occurrences);
      expect(entry.reason.length, entry.file).toBeGreaterThan(60);
    }
  });

  /** Guard soundness: the two regexes flag what they must and nothing they must not. */
  it('separates a coral FILL from a coral tint, border or foreground', () => {
    for (const flagged of ['bg-coral', 'bg-coral"', 'bg-coral ', "bg-coral'"]) {
      expect(flagged.match(BARE_CORAL_FILL), flagged).not.toBeNull();
    }
    for (const allowed of [
      'bg-coral/10', 'bg-coral/5', 'bg-coral-strong', 'bg-coral-foreground',
      'bg-coral-strong-foreground/80', 'border-coral', 'text-coral', 'hover:bg-coral/5',
    ]) {
      expect(allowed.match(BARE_CORAL_FILL), allowed).toBeNull();
    }
    for (const label of ['text-white', 'text-coral-foreground']) {
      expect(label.match(LIGHT_LABEL), label).not.toBeNull();
    }
    for (const notALabel of ['text-coral-strong-foreground', 'text-white/60', 'text-foreground']) {
      expect(notALabel.match(LIGHT_LABEL), notALabel).toBeNull();
    }
  });
});

describe('C7 - the token pair is defined in both themes and documented with its measurement', () => {
  const css = read('src/styles/index.css');

  it('defines --coral-strong and its label colour in light and dark', () => {
    for (const declaration of [
      '--coral-strong: oklch(0.52 0.16 14);',
      '--coral-strong-foreground: oklch(0.99 0.005 85);',
      '--coral-strong: oklch(0.8 0.13 14);',
      '--coral-strong-foreground: oklch(0.18 0.018 265);',
    ]) {
      expect(css, declaration).toContain(declaration);
    }
  });

  it('defines a separate --coral-fill for the pink primary button', () => {
    /*
     * Added 2026-08-09. `--coral-strong` does two jobs: it fills primary controls
     * AND it is coral ink on a card in 87 places. Ink has to clear 4.5:1 on a
     * near-white surface, so it must stay dark -- a pink light enough to look
     * cheerful as a button fill measures 2.00:1 as text.
     *
     * Retuning the shared token to pink was tried first and failed exactly there,
     * caught by `e2e/tokenContrast.spec.ts` measuring a real paint. Splitting the
     * fill out is what actually lets the CTA be pink, so the two uses no longer
     * have to compromise on one lightness.
     *
     * In dark both jobs genuinely want the same light value -- a dark fill on a
     * dark background reads as disabled -- so the tokens converge there rather
     * than being forced apart.
     */
    for (const declaration of [
      '--coral-fill: oklch(0.74 0.14 18);',
      '--coral-fill-foreground: oklch(0.3 0.1 18);',
      '--coral-fill: oklch(0.72 0.16 18);',
      '--coral-fill-foreground: oklch(0.2 0.05 18);',
      '--color-coral-fill: var(--coral-fill);',
      '--color-coral-fill-foreground: var(--coral-fill-foreground);',
    ]) {
      expect(css, declaration).toContain(declaration);
    }
  });

  it('routes the Button primitive at the fill token, not the ink token', () => {
    // The primitive is the one place a filled primary is defined, so this is the
    // single assertion that keeps every CTA pink.
    const button = read('src/components/ui/Button.tsx');
    expect(button).toContain('primary: \'bg-coral-fill text-coral-fill-foreground\'');
    expect(button).not.toContain('primary: \'bg-coral-strong');
  });

  it('exposes the pair to Tailwind so bg-/text- utilities exist for it', () => {
    expect(css).toContain('--color-coral-strong: var(--coral-strong);');
    expect(css).toContain('--color-coral-strong-foreground: var(--coral-strong-foreground);');
  });

  it('keeps --coral as a hue rotation, never a replacement, because ~46 tints depend on it', () => {
    /*
     * What this guard is for: `--coral-strong` was added so that "text sits on
     * this" uses could pass AA WITHOUT swapping the brand colour out from under
     * ~46 tints, borders, fills and dots. That intent is unchanged.
     *
     * The hue moved 22 -> 12 on 2026-08-09 (light) and 22 -> 12 (dark) to make the
     * brand coral PINK rather than orange-leaning. Lightness and chroma are
     * asserted here at their original numbers precisely because those two are what
     * every tint's contrast behaviour depends on -- a hue rotation at fixed L and C
     * moves no ratio meaningfully, and e2e/tokenContrast.spec.ts re-measures both
     * themes in a real paint regardless.
     *
     * Asserted exactly rather than loosened to a pattern: a future change to L or C
     * still has to come here and re-measure.
     */
    expect(css).toContain('--coral: oklch(0.78 0.12 12);');
    expect(css).toContain('--coral-foreground: oklch(1 0 0);');
    expect(css).toContain('--coral: oklch(0.75 0.13 12);');
  });

  it('records the measured ratios next to the token, not in a commit message', () => {
    // The numbers are the justification for the values. If someone retunes the
    // token they have to re-measure, and this fails until the comment agrees.
    expect(css).toContain('5.87:1');
    expect(css).toContain('9.25:1');
    // The fill pair carries its own measurements.
    expect(css).toContain("5.78:1");
    expect(css).toContain("6.87:1");
    expect(css).toMatch(/2\.09:1/);
  });

  it('inverts in dark rather than darkening, which is why the two labels differ', () => {
    const light = css.indexOf('--coral-strong: oklch(0.52 0.16 14);');
    const dark = css.indexOf('--coral-strong: oklch(0.8 0.13 14);');
    expect(light).toBeGreaterThan(-1);
    expect(dark).toBeGreaterThan(light);
  });

  it('keeps the fill light enough to read as coral pink rather than brick', () => {
    /*
     * LIGHTNESS is the load-bearing number on this token, and it is load-bearing in
     * the opposite direction from what a contrast rule would suggest.
     *
     * Three attempts landed here. A white label forces the fill down to about
     * L0.585, and nothing at that lightness reads as coral pink -- rendered side by
     * side, `oklch(0.585 0.15 22)` is #C55052, a dusty brick, and pushing chroma up
     * instead gives #DD1B57, a magenta. The only way to get coral pink is to keep
     * the fill light and make the LABEL dark, which is the trade the reference app
     * makes too.
     *
     * So the guard is a floor on lightness, not on chroma: the regression it catches
     * is someone darkening the fill to fit a white label and silently returning to
     * the brick red this replaced. Hue is bounded on both sides -- below 14 a filled
     * surface reads magenta, above 24 it turns orange.
     */
    const fills = [...css.matchAll(/--coral-fill: oklch\(([0-9.]+) ([0-9.]+) ([0-9.]+)\);/g)];
    expect(fills.length, 'both themes declare a fill').toBe(2);
    for (const [, L, , H] of fills) {
      expect(Number(L), 'fill stays light enough to be coral pink').toBeGreaterThanOrEqual(0.7);
      expect(Number(H), 'fill hue stays in the coral range').toBeGreaterThanOrEqual(14);
      expect(Number(H), 'fill hue stays in the coral range').toBeLessThanOrEqual(24);
    }

    // The label is correspondingly dark, and is a deep coral rather than navy: navy
    // is the app's other brand colour and two of them inside one button stop it
    // reading as a single object.
    const labels = [...css.matchAll(/--coral-fill-foreground: oklch\(([0-9.]+) ([0-9.]+) ([0-9.]+)\);/g)];
    expect(labels.length, 'both themes declare a label').toBe(2);
    for (const [, L, , H] of labels) {
      expect(Number(L), 'label is dark').toBeLessThanOrEqual(0.35);
      expect(Number(H), 'label shares the fill hue, not navy 265').toBeLessThanOrEqual(24);
    }
  });
});
