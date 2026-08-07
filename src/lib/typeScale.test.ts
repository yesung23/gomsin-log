import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * C8 bug condition:
 *   isBugConditionC8(file) = occurrenceCount(font-size utility outside the named
 *                           scale, INCLUDING arbitrary values) > 0
 *
 * Measured on the unfixed tree, in the three files this cluster converts:
 *
 *   CallBriefingWidget.tsx        text-lg x1, text-sm x2, text-xs x4,
 *                                 text-[11px] x4, text-[10px] x2
 *   PartnerDayTimelineWidget.tsx  text-sm x1, text-xs x4, text-[11px] x1,
 *                                 text-[10px] x1
 *   DDayWidget.tsx                text-3xl x1, text-lg x1, text-sm x1,
 *                                 text-xs x1, text-[11px] x3
 *
 * Twelve different sizes across three files, nine of them below 13px. The record
 * excerpt, the timestamp above it and the legend beneath were all 12px or less,
 * so the hierarchy the briefing depends on -- the partner's own sentence being
 * the largest thing on the card -- did not exist in the type at all.
 *
 * The scale is seven steps and lives in src/styles/index.css. This guard holds
 * converted files to it, file by file, the same way the C4 palette guard grows.
 * A file is added here only once it is fully converted, so the list is a record
 * of progress rather than an aspiration.
 */

/** DESIGN_V2 개정 타이포그래피 (2026-08-08). Seven steps, weights included. */
const SCALE = {
  display: { size: '1.625rem', px: 26, lineHeight: '2rem', weight: '700' },
  title: { size: '1.375rem', px: 22, lineHeight: '1.875rem', weight: '700' },
  heading: { size: '1.0625rem', px: 17, lineHeight: '1.5rem', weight: '600' },
  emphasis: { size: '1rem', px: 16, lineHeight: '1.5rem', weight: '600' },
  body: { size: '0.9375rem', px: 15, lineHeight: '1.375rem', weight: '400' },
  label: { size: '0.8125rem', px: 13, lineHeight: '1.125rem', weight: '500' },
  caption: { size: '0.75rem', px: 12, lineHeight: '1rem', weight: '400' },
} as const;

/**
 * Any Tailwind font-size utility. Colour utilities share the `text-` prefix, so
 * this deliberately matches only the size vocabulary plus arbitrary lengths.
 *
 * The arbitrary form is a separate alternative on purpose: a trailing `\b` after
 * `text-[10px]` never matches, because `]` and end-of-string are both non-word
 * characters -- so a single-branch pattern silently missed exactly the values
 * this guard exists to catch.
 */
const FONT_SIZE_UTILITY =
  /\btext-\[[^\]]*(?:px|rem|em)\]|\btext-(?:xs|sm|base|lg|xl|[2-9]xl|display|title|heading|emphasis|body|label|caption)\b/g;

const ALLOWED = new Set(Object.keys(SCALE).map((name) => `text-${name}`));

/**
 * Every file under src/ that can emit a class name, tests excluded.
 *
 * This started as a hand-written list of converted files, grown one PR at a time
 * while 550 off-scale sizes were migrated. It is a whole-tree walk now because
 * the count reached zero: a list would let the next new file opt out of the scale
 * silently, and a walk cannot.
 */
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

const CONVERTED_FILES = uiSources();

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file.split('/').join(sep)), 'utf8');
}

function offScaleSizesIn(file: string): string[] {
  return (read(file).match(FONT_SIZE_UTILITY) ?? []).filter((match) => !ALLOWED.has(match));
}

describe('C8 - the type scale is the only font-size vocabulary in src/', () => {
  it('scans a non-empty set of sources, so a silent glob failure cannot pass', () => {
    expect(CONVERTED_FILES.length).toBeGreaterThan(40);
    expect(CONVERTED_FILES).toContain('src/pages/RecordPage.tsx');
    expect(CONVERTED_FILES).toContain('src/components/MobileShell.tsx');
    expect(CONVERTED_FILES).toContain('src/components/ui/Button.tsx');
    expect(CONVERTED_FILES).toContain('src/components/ui/List.tsx');
  });

  it('no file uses a size outside the six named steps', () => {
    const offenders: string[] = [];
    for (const file of CONVERTED_FILES) {
      const found = offScaleSizesIn(file);
      if (found.length > 0) offenders.push(`${file}: ${[...new Set(found)].join(' ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the scale is actually in use, so deleting every size would not pass', () => {
    // 550 off-scale sizes were migrated to get here. If this total collapses,
    // the utilities have been removed rather than converted.
    const used = CONVERTED_FILES.reduce(
      (total, file) => total + (read(file).match(FONT_SIZE_UTILITY) ?? []).filter((m) => ALLOWED.has(m)).length,
      0,
    );
    expect(used).toBeGreaterThan(400);
  });

  /** Guard soundness: it must flag every off-scale size and no colour utility. */
  it('flags off-scale sizes including arbitrary values', () => {
    for (const flagged of [
      'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl',
      'text-[10px]', 'text-[11px]', 'text-[12px]', 'text-[0.7rem]',
    ]) {
      const matched = flagged.match(FONT_SIZE_UTILITY) ?? [];
      expect(matched, flagged).toEqual([flagged]);
      expect(ALLOWED.has(flagged), flagged).toBe(false);
    }
  });

  it('never flags a colour utility or a non-size text- class', () => {
    for (const allowed of [
      'text-foreground', 'text-muted-foreground', 'text-coral-strong', 'text-center',
      'text-left', 'text-coral-strong-foreground', 'text-background', 'text-info',
    ]) {
      expect(allowed.match(FONT_SIZE_UTILITY), allowed).toBeNull();
    }
  });

  it('accepts the seven scale names', () => {
    for (const name of Object.keys(SCALE)) {
      const utility = `text-${name}`;
      expect(utility.match(FONT_SIZE_UTILITY), utility).toEqual([utility]);
      expect(ALLOWED.has(utility)).toBe(true);
    }
  });
});

describe('C8 - the scale is defined once, in the token file', () => {
  const css = read('src/styles/index.css');

  it('declares every step with the documented size', () => {
    for (const [name, step] of Object.entries(SCALE)) {
      expect(css, name).toContain(`--text-${name}: ${step.size};`);
    }
  });

  it('gives every step a line height and a weight, so neither is left to the browser', () => {
    for (const [name, step] of Object.entries(SCALE)) {
      expect(css, name).toContain(`--text-${name}--line-height: ${step.lineHeight};`);
      expect(css, name).toContain(`--text-${name}--font-weight: ${step.weight};`);
    }
  });

  it('holds the floor at 12px and protects the couple\'s own words at 15-16px', () => {
    /*
     * The 2026-08-08 revision moved the floor DOWN, on purpose, and this is the
     * assertion that says what that is allowed to mean.
     *
     * The previous scale put the floor at 13px and, to keep the steps apart, every
     * ceiling above it too: 28px figures, a 20px title, 16px for all prose. The
     * result read as senior mode and pushed the partner's real day below the fold.
     * So metadata is allowed 12px again -- but ONLY metadata. `body` at 15 and
     * `emphasis` at 16 are the two steps the user's own sentences use, and they are
     * asserted here so a future "let's tighten it a bit more" cannot reach them.
     */
    expect(SCALE.caption.px).toBe(12);
    expect(SCALE.label.px).toBe(13);
    expect(SCALE.body.px).toBe(15);
    expect(SCALE.emphasis.px).toBe(16);

    const sizes = Object.values(SCALE).map((step) => step.px);
    expect(Math.min(...sizes)).toBe(12);
    // Strictly descending, so no two steps collide and the hierarchy is legible.
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it('keeps a leading of at least 1.4 on the two prose steps', () => {
    // Korean crowds below 1.4. Metadata may be tighter; prose may not.
    for (const name of ['body', 'emphasis'] as const) {
      const step = SCALE[name];
      const lineHeightPx = Number.parseFloat(step.lineHeight) * 16;
      expect(lineHeightPx / step.px, name).toBeGreaterThanOrEqual(1.4);
    }
  });
});

describe('surface radius has two meanings, both named', () => {
  const css = read('src/styles/index.css');

  it('declares the control and surface radii', () => {
    // DESIGN_V2 정보 밀도와 레이아웃 토큰: 12px for anything you press, 16px for a
    // card or sheet that groups one subject.
    expect(css).toContain('--radius-control: 0.75rem;');
    expect(css).toContain('--radius-surface: 1rem;');
  });

  it('does not leave a 24px blob radius anywhere under src/', () => {
    /*
     * `rounded-3xl` is Tailwind's own 24px and is not part of this app's ladder.
     * Forty of them were the single biggest contributor to the "every screen is a
     * stack of soft rectangles" reading, so they are now `rounded-surface`.
     *
     * Block comments are stripped before scanning: several of the files that were
     * converted explain the conversion, and naming the old utility in prose is not
     * a regression.
     */
    const offenders: string[] = [];
    for (const file of CONVERTED_FILES) {
      const withoutComments = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      if (withoutComments.includes('rounded-3xl')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
