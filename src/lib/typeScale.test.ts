import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
 * The scale is six steps and lives in src/styles/index.css. This guard holds
 * converted files to it, file by file, the same way the C4 palette guard grows.
 * A file is added here only once it is fully converted, so the list is a record
 * of progress rather than an aspiration.
 */

/** DESIGN_V2 §3.3. `caption` is the floor: nothing in this app may be smaller. */
const SCALE = {
  display: { size: '1.75rem', px: 28 },
  title: { size: '1.25rem', px: 20 },
  heading: { size: '1.0625rem', px: 17 },
  body: { size: '1rem', px: 16 },
  label: { size: '0.875rem', px: 14 },
  caption: { size: '0.8125rem', px: 13 },
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
  /\btext-\[[^\]]*(?:px|rem|em)\]|\btext-(?:xs|sm|base|lg|xl|[2-9]xl|display|title|heading|body|label|caption)\b/g;

const ALLOWED = new Set(Object.keys(SCALE).map((name) => `text-${name}`));

/**
 * Files converted to the scale. Each entry is a promise that the file contains no
 * size outside the six steps.
 */
const CONVERTED_FILES = [
  'src/components/ui/Button.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/Badge.tsx',
  'src/components/ui/EmptyState.tsx',
  'src/components/ui/Skeleton.tsx',
  'src/components/widgets/CallBriefingWidget.tsx',
  'src/components/widgets/PartnerDayTimelineWidget.tsx',
  'src/components/widgets/DDayWidget.tsx',
  // The record screen. It is the destination every briefing summary points at,
  // so the partner's own sentence had to stop being 14px while the app's own
  // chrome around it was the same size or larger.
  'src/pages/RecordPage.tsx',
  // The planning surfaces. A schedule is read at a glance, so the time and the
  // title were the two things that had to stop being the same size as the legend
  // underneath them.
  'src/pages/SchedulePage.tsx',
  'src/pages/TripsPage.tsx',
  'src/pages/TripDetailPage.tsx',
];

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file.split('/').join(sep)), 'utf8');
}

function offScaleSizesIn(file: string): string[] {
  return (read(file).match(FONT_SIZE_UTILITY) ?? []).filter((match) => !ALLOWED.has(match));
}

describe('C8 - the type scale is the only font-size vocabulary in converted files', () => {
  for (const file of CONVERTED_FILES) {
    it(`${file} uses no size outside the six named steps`, () => {
      expect(offScaleSizesIn(file)).toEqual([]);
    });
  }

  it('each converted file actually uses the scale, so an empty file cannot pass', () => {
    for (const file of CONVERTED_FILES) {
      const used = (read(file).match(FONT_SIZE_UTILITY) ?? []).filter((match) => ALLOWED.has(match));
      expect(used.length, file).toBeGreaterThan(0);
    }
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

  it('accepts the six scale names', () => {
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

  it('gives every step a line height, so leading is not left to the browser', () => {
    for (const name of Object.keys(SCALE)) {
      expect(css, name).toContain(`--text-${name}--line-height:`);
    }
  });

  it('keeps caption as the floor and body at 16px', () => {
    // Korean at 12px is the defect this scale exists to end. `caption` is 13px
    // and is only for times and metadata; prose starts at `body`.
    expect(SCALE.caption.px).toBe(13);
    expect(SCALE.body.px).toBe(16);
    const sizes = Object.values(SCALE).map((step) => step.px);
    expect(Math.min(...sizes)).toBe(13);
    // Strictly descending, so no two steps collide and the hierarchy is legible.
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});
