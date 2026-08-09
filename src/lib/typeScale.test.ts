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
    /*
     * 14px for anything you press, 20px for a card or sheet that groups one
     * subject.
     *
     * Retuned 2026-08-09 from 12px / 16px. Those values removed the 24px blobs and
     * kept going: on an 8px root every badge and chip went angular and the app read
     * hard, which is the opposite of the warmth this product is for. 14px is also
     * where this app started.
     *
     * Both are still asserted exactly, so a drift back to 24px blobs or forward to
     * hard corners fails here rather than in a review.
     */
    expect(css).toContain('--radius-control: 0.875rem;');
    expect(css).toContain('--radius-surface: 1.25rem;');
    // The root the numbered ladder is based on.
    expect(css).toContain('--radius: 0.625rem;');
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

describe('spacing stays on the six-step rhythm', () => {
  /*
   * DESIGN_V2 정보 밀도와 레이아웃 토큰 fixes the spacing rhythm at
   * 4 / 8 / 12 / 16 / 20 / 24px -- Tailwind's `1 2 3 4 5 6`. The point is not
   * tidiness for its own sake: an off-ladder gap is how a screen drifts back
   * toward "hierarchy made out of large empty space between large cards", which
   * is the exact reading the 2026-08-08 revision was opened to remove.
   *
   * The steps that are NOT on the ladder and are reachable by a plain utility:
   * `7`=28px, `9`=36px, `10`=40px, `11`=44px, `14`=56px. `11` is deliberately
   * included: 44px is the hit-target floor and belongs in `min-h-11` / `w-11`,
   * never in padding or margin, where it silently doubles a section gap.
   *
   * Scoped to padding, margin and gap. Sizing utilities (`w-`, `h-`, `min-h-`)
   * are excluded because the 44px hit target and fixed column widths legitimately
   * need values off this ladder -- `TimelineRow`'s 44px time column is the whole
   * grammar of the record screen.
   *
   * Block and line comments are stripped first: three of these files explain in
   * prose which value they replaced, and naming the old one is not a regression.
   */
  const OFF_LADDER = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(?:7|9|10|11|14)\b/g;

  it('uses no off-ladder padding, margin or gap anywhere under src/', () => {
    const offenders: string[] = [];
    for (const file of CONVERTED_FILES) {
      const withoutComments = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const found = withoutComments.match(OFF_LADDER);
      if (found) offenders.push(`${file}: ${[...new Set(found)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('still allows the ladder itself, so the guard is not vacuous', () => {
    /*
     * A regex that matched nothing would pass the test above forever. Prove the
     * pattern fires on the values it is meant to catch and stays silent on the
     * six that are allowed, including `min-h-11` -- 44px as a hit target, which
     * must NOT be reported.
     */
    expect('py-10 pb-10'.match(OFF_LADDER)).toHaveLength(2);
    expect('p-7 gap-9 mt-14'.match(OFF_LADDER)).toHaveLength(3);
    expect('p-1 p-2 p-3 p-4 p-5 p-6 gap-3 space-y-6'.match(OFF_LADDER)).toBeNull();
    expect('min-h-11 w-11 h-10 min-w-[44px]'.match(OFF_LADDER)).toBeNull();
  });
});

describe('prose leading is not tightened below the reflow floor', () => {
  /*
   * `text-body` (15/22 = 1.467) and `text-emphasis` (16/24 = 1.5) carry their own
   * leading. Tailwind's `leading-snug` is 1.375, so pairing it with either one
   * silently drops the rendered leading BELOW the 1.4 floor that
   * `e2e/renderedTypeScale.spec.ts` measures on the real render.
   *
   * This is not a style preference. Korean sets no inter-word space the way Latin
   * does, so a crowded leading costs more legibility here than it would in
   * English, and the sentence the user wrote is the one thing on the record screen
   * that must never be the hardest thing to read.
   *
   * Caught in the real browser, not in jsdom: jsdom does not resolve
   * `line-height` from a utility class at all, so only a rendered measurement or
   * a source guard like this one can see it. This guard is the fast half.
   */
  const TIGHTENED = /class(?:Name)?=(?:"|'|\{`)[^"'`]*(?:(?:text-body|text-emphasis)[^"'`]*leading-(?:snug|tight|none)|leading-(?:snug|tight|none)[^"'`]*(?:text-body|text-emphasis))/;

  it('never pairs a prose step with leading-snug, tight or none', () => {
    const offenders = CONVERTED_FILES.filter((file) => {
      const withoutComments = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      return TIGHTENED.test(withoutComments);
    });
    expect(offenders).toEqual([]);
  });

  it('fires on the pairing it is meant to catch, in both orders', () => {
    expect(TIGHTENED.test('className="text-body text-foreground leading-snug"')).toBe(true);
    expect(TIGHTENED.test('className="leading-tight text-emphasis"')).toBe(true);
    // Headings and labels legitimately run tight; they are not prose.
    expect(TIGHTENED.test('className="text-heading leading-tight"')).toBe(false);
    expect(TIGHTENED.test('className="text-caption leading-none"')).toBe(false);
    expect(TIGHTENED.test('className="text-body text-foreground break-keep"')).toBe(false);
  });
});

describe('the app has exactly one typeface', () => {
  /*
   * Pretendard, and nothing else.
   *
   * A handwriting accent (Nanum Pen Script) was added on 2026-08-09 and removed the
   * same day. Two things were learned and are worth not re-learning:
   *
   *   1. Rendered beside it, the plain figure read better. That was the deciding
   *      reason, and it is a judgement someone may reasonably revisit.
   *   2. It only ever worked on all-latin strings. Shipping the Korean subset costs
   *      588 kB against 16 kB for latin, so with latin only, `8월 6일 화요일` came
   *      out as handwritten digits inside Pretendard Korean -- two faces colliding
   *      in one short line. That is a fact about the font, not a preference.
   *
   * So this guard is not "handwriting is banned forever". It fails if a second face
   * appears WITHOUT the import that would make it work, which is the specific way
   * this would break: a `font-hand` class surviving a revert, or being added while
   * only the latin subset is imported.
   */
  const css = read('src/styles/index.css');

  it('declares one font family and no second face', () => {
    expect(css).toContain('--font-sans:');
    expect(css).not.toContain('--font-hand:');
  });

  it('imports no font other than the self-hosted Pretendard subset', () => {
    const imports = [...css.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
    const fontImports = imports.filter((s) => /font|pretendard|fontsource/i.test(s));
    expect(fontImports).toEqual(['pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css']);
  });

  it('leaves no orphaned handwriting class behind in the tree', () => {
    /*
     * The failure this catches is a partial revert: the token removed but a
     * `font-hand` class left on an element, which then silently renders in the body
     * face. Comments are stripped -- index.css and this file both explain the
     * history in prose, and naming the class there is not a regression.
     */
    const offenders = CONVERTED_FILES.filter((file) => {
      const withoutComments = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      return /\bfont-hand\b/.test(withoutComments);
    });
    expect(offenders).toEqual([]);
  });
});
