import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * C4 bug condition:
 *   isBugConditionC4(file) = occurrenceCount(palette-literal surface/border/text
 *                           utility, INCLUDING opacity variants) > 0
 *
 * Measured on the unfixed tree: 18 / 2 / 16 / 24 matches in
 * InstallPromptBanner.tsx, CycleSupportSection.tsx, RecordPage.tsx and
 * TripsPage.tsx respectively.
 *
 * Nothing caught a reintroduced light-only surface before this guard existed.
 */

/**
 * Palette literals for surfaces, borders and text, with optional numeric shade
 * and optional opacity variant. Opacity variants matter: Tailwind v4 compiles
 * `bg-white/60` to a `color-mix` over `--color-white`, so a class-name guard
 * that ignored `/60` would miss exactly the cases that broke the record
 * timeline.
 */
const PALETTE_LITERAL =
  /\b(?:bg|text|border|from|to|via|ring|divide|placeholder)-(?:white|black|gray|slate|zinc|neutral|stone)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;

/** Files the guard protects. */
const GUARDED_FILES = [
  'src/components/InstallPromptBanner.tsx',
  'src/components/CycleSupportSection.tsx',
  'src/pages/RecordPage.tsx',
  'src/pages/TripsPage.tsx',
];

/**
 * Every accepted exception, each with the reason it is theme-invariant. An
 * unexplained exclusion is not acceptable, so this table is the documentation.
 */
const ACCEPTED_EXCEPTIONS: Array<{ file: string; match: string; reason: string }> = [
  {
    file: 'src/pages/RecordPage.tsx',
    match: 'bg-black/40',
    reason: 'Modal scrim. A dimming overlay is conventionally theme-invariant: it '
      + 'darkens whatever is behind it in both themes, and theming it would make '
      + 'the dark-mode dialog float on an undimmed background.',
  },
  {
    file: 'src/pages/TripsPage.tsx',
    match: 'bg-black/40',
    reason: 'Modal scrim, same reasoning as RecordPage.tsx.',
  },
];

/**
 * Files that match the regex but are deliberately NOT guarded. Recorded with the
 * decision and its reason, because clause 2.22 forbids an unexplained exclusion.
 */
const RESOLVED_UNGUARDED_FILES: Array<{ file: string; decision: string }> = [
  {
    file: 'src/pages/ServicePage.tsx',
    decision: 'KEPT as theme-invariant accent overlays on a fixed-hue surface. The '
      + 'hero is `bg-gradient-to-br from-navy to-navy/80`, and `--navy` is dark in '
      + 'BOTH themes (oklch 0.28 light / 0.29 dark), so `text-white`, `text-white/80`, '
      + '`text-white/60`, `text-white/10`, `bg-white/20`, `bg-white/10` and `bg-black/25` '
      + 'are all correct in both. `bg-black/50` is a modal scrim.',
  },
  {
    file: 'src/pages/SchedulePage.tsx',
    decision: 'PARTIALLY CONVERTED. `bg-slate-500` (private-event dot) became '
      + '`bg-muted-foreground`, because the dark palette remap covers `gray-*` only '
      + 'and left slate untouched; the today marker `bg-white` on a coral cell became '
      + '`bg-coral-foreground`. Remaining `text-white` sits on coral/navy accents and '
      + '`bg-black/50` is a modal scrim.',
  },
  {
    file: 'src/pages/OnboardingPage.tsx',
    decision: 'PARTIALLY CONVERTED. The six `bg-coral text-white` buttons became '
      + '`text-coral-foreground` and the spinner `border-white` became '
      + '`border-coral-foreground`. `bg-black text-white` on the Apple sign-in button '
      + 'is KEPT: it is mandated by Apple\'s Human Interface Guidelines and must not '
      + 'be themed.',
  },
];

function matchesIn(file: string): string[] {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  return source.match(PALETTE_LITERAL) ?? [];
}

function unexplainedMatchesIn(file: string): string[] {
  const allowed = ACCEPTED_EXCEPTIONS
    .filter((exception) => exception.file === file)
    .map((exception) => exception.match);
  return matchesIn(file).filter((match) => !allowed.includes(match));
}

describe('C4 - no palette literal survives in a guarded file', () => {
  for (const file of GUARDED_FILES) {
    it(`${file} has zero unexplained palette literals`, () => {
      expect(unexplainedMatchesIn(file)).toEqual([]);
    });
  }

  it('every accepted exception is still present and still explained', () => {
    for (const exception of ACCEPTED_EXCEPTIONS) {
      expect(matchesIn(exception.file), exception.file).toContain(exception.match);
      expect(exception.reason.length).toBeGreaterThan(40);
    }
  });

  it('records a decision for every unguarded file that still matches', () => {
    for (const entry of RESOLVED_UNGUARDED_FILES) {
      expect(matchesIn(entry.file).length, entry.file).toBeGreaterThan(0);
      expect(entry.decision.length).toBeGreaterThan(60);
    }
  });

  it('accepts a paired accent foreground and still rejects a translucent surface', () => {
    // The exception rule must be legible rather than accidental.
    expect('bg-coral text-coral-foreground'.match(PALETTE_LITERAL)).toBeNull();
    expect('bg-white/60'.match(PALETTE_LITERAL)).toEqual(['bg-white/60']);
    expect('bg-coral text-white'.match(PALETTE_LITERAL)).toEqual(['text-white']);
  });

  /** Guard soundness: the regex flags what it must and nothing it must not. */
  it('flags palette literals with and without numeric and opacity suffixes', () => {
    for (const flagged of [
      'bg-white', 'bg-white/60', 'bg-white/5', 'bg-black/40', 'bg-gray-50', 'bg-gray-100/80',
      'text-gray-900', 'text-gray-400', 'border-gray-200', 'border-white/20', 'bg-slate-500',
      'text-zinc-600', 'bg-neutral-100', 'ring-gray-300', 'divide-gray-200',
      'placeholder-gray-400', 'from-gray-50', 'to-white', 'via-black/10',
    ]) {
      expect(flagged.match(PALETTE_LITERAL), flagged).toEqual([flagged]);
    }
  });

  it('never flags a theme token, including its opacity variants', () => {
    for (const allowed of [
      'bg-card', 'bg-card/60', 'bg-card/80', 'bg-muted', 'bg-muted/30', 'border-border',
      'text-foreground', 'text-card-foreground', 'text-muted-foreground',
      'text-muted-foreground/80', 'bg-coral', 'bg-coral/10', 'text-coral-foreground',
      'bg-coral-foreground/40', 'text-primary-foreground', 'bg-navy', 'text-mint-foreground',
      'border-mint-foreground/20', 'bg-indigo-50', 'text-indigo-600', 'text-indigo-50',
      'bg-amber-50', 'text-destructive', 'bg-background',
    ]) {
      expect(allowed.match(PALETTE_LITERAL), allowed).toBeNull();
    }
  });
});

describe('C4 - PRESERVATION: token definitions and the light theme are untouched', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

  it('src/styles/index.css defines no new token and keeps the light values', () => {
    for (const declaration of [
      '--card: oklch(1 0 0);',
      '--card-foreground: var(--navy);',
      '--muted: oklch(0.96 0.006 85);',
      '--muted-foreground: oklch(0.55 0.03 260);',
      '--border: oklch(0.92 0.008 85);',
      '--coral: oklch(0.78 0.12 22);',
      '--coral-foreground: oklch(1 0 0);',
      '--mint-foreground: var(--navy);',
      '--navy: oklch(0.28 0.06 265);',
    ]) {
      expect(css, declaration).toContain(declaration);
    }
  });

  it('keeps the theme-colour constants in sync with --background', () => {
    const store = readFileSync(resolve(process.cwd(), 'src/lib/store.tsx'), 'utf8');
    expect(store).toContain("const LIGHT_THEME_COLOR = '#FAF8F5'");
    expect(store).toContain("const DARK_THEME_COLOR = '#16181D'");
  });

  it('keeps the dark palette remap that already covered the gray utilities', () => {
    // Recorded honestly: the `gray-*` conversions in this cluster are a
    // maintainability fix, not a dark-mode bug fix -- these remaps already made
    // the gray utilities render correctly in dark mode.
    expect(css).toContain('--color-gray-50: var(--muted);');
    expect(css).toContain('--color-gray-900: var(--foreground);');
    // `--color-white` is deliberately NOT remapped, which is why `bg-white`
    // surfaces were the genuine defect.
    expect(css).not.toMatch(/^\s*--color-white:/m);
  });

  it('converted surfaces use tokens whose LIGHT values match what they replaced', () => {
    // `--card` is oklch(1 0 0), which is exactly Tailwind's `white`, so every
    // `bg-white/NN -> bg-card/NN` conversion is byte-identical in light mode.
    expect(css).toContain('--card: oklch(1 0 0);');
    // `--coral-foreground` is also oklch(1 0 0) in light, so the calendar
    // indicator dots on a selected cell are unchanged in light mode too.
    expect(css).toContain('--coral-foreground: oklch(1 0 0);');
  });
});
