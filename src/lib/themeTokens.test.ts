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
  'src/components/EmotionFlowInsightCard.tsx',
  'src/pages/RecordPage.tsx',
  'src/pages/TripsPage.tsx',
  // Emits Tailwind classes for the record timeline even though it is a lib file,
  // so the same rule has to apply to it.
  'src/lib/recordAuthor.ts',
  // The shared primitives. Every screen will eventually render through these, so
  // a palette literal here would reintroduce the defect everywhere at once.
  'src/components/ui/Button.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/Badge.tsx',
  'src/components/ui/EmptyState.tsx',
  'src/components/ui/Skeleton.tsx',
  // Converted to the primitives and the type scale, so they are held to the rule
  // from here on. DDayWidget is the reason this matters: its decorative heart was
  // `text-white/40` and its shield sat on a `teal-500` gradient.
  'src/components/widgets/CallBriefingWidget.tsx',
  'src/components/widgets/PartnerDayTimelineWidget.tsx',
  'src/components/widgets/DDayWidget.tsx',
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
      + '`bg-coral-foreground`. The four `bg-coral text-white` controls later moved to '
      + '`bg-coral-strong text-coral-strong-foreground` for WCAG AA (see '
      + 'coralContrast.test.ts). What remains is `bg-indigo-500 text-white` on the '
      + '할 일 button, which belongs to the raw-palette migration, and a `bg-black/50` '
      + 'modal scrim.',
  },
  {
    file: 'src/pages/OnboardingPage.tsx',
    decision: 'PARTIALLY CONVERTED. The six `bg-coral text-white` buttons became '
      + '`text-coral-foreground` and the spinner `border-white` became '
      + '`border-coral-foreground`; all ten coral fills later moved again to '
      + '`bg-coral-strong text-coral-strong-foreground`, because coral with a light '
      + 'label measured 2.09:1 against AA 4.5:1. `bg-black text-white` on the Apple '
      + 'sign-in button is KEPT: it is mandated by Apple\'s Human Interface '
      + 'Guidelines and must not be themed. `bg-navy text-white` is kept for the same '
      + 'reason as ServicePage -- navy is dark in both themes.',
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
      'bg-coral-foreground/40', 'bg-coral-strong', 'text-coral-strong-foreground',
      'bg-coral-strong-foreground/80', 'border-coral-strong',
      'text-primary-foreground', 'bg-navy', 'text-mint-foreground',
      'border-mint-foreground/20', 'bg-indigo-50', 'text-indigo-600', 'text-indigo-50',
      'bg-amber-50', 'text-destructive', 'bg-background',
    ]) {
      expect(allowed.match(PALETTE_LITERAL), allowed).toBeNull();
    }
  });
});

describe('C4 - PRESERVATION: token definitions and the light theme are untouched', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

  it('src/styles/index.css keeps every light value this cluster relied on', () => {
    // `--coral-strong` was added later as a deliberate accessibility fix and is
    // asserted by coralContrast.test.ts. Everything below must still be byte
    // identical, because the C4 conversions were chosen to be no-ops in light mode.
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

  it('the dark palette remap has been deleted, and white is still not remapped', () => {
    // Recorded honestly: the `gray-*` conversions in this cluster were a
    // maintainability fix, not a dark-mode bug fix -- the remaps that used to sit
    // in index.css already made the gray utilities render correctly in dark mode.
    //
    // Those remaps are gone now. Every raw palette utility in this app became a
    // semantic token, so nothing is left for them to compensate for, and
    // src/lib/paletteMigration.test.ts fails if either the utilities or the block
    // come back.
    expect(css).not.toContain('--color-gray-50: var(--muted);');
    expect(css).not.toContain('--color-gray-900: var(--foreground);');
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


/**
 * C5 bug condition:
 *   isBugConditionC5(file) = occurrenceCount(`text-navy` utility, INCLUDING
 *                           opacity variants) > 0
 *
 * `--navy` is a DARK ink in both themes -- oklch(0.28 0.06 265) light,
 * oklch(0.29 0.055 265) dark -- because it doubles as a surface and border
 * colour (`bg-navy/10`, `border-navy`, `from-navy`). That makes it correct as a
 * FILL and wrong as a FOREGROUND: in dark mode `text-navy` paints dark ink on a
 * dark background.
 *
 * The C4 guard above could not catch this: `navy` is a theme token, not a
 * palette literal, so it was on C4's allow-list. Measured in headless Chromium
 * at 390x844 with dark theme active, before the fix:
 *
 *   OnboardingPage tagline        1.22:1  (needs 4.5)  -- effectively invisible
 *   CycleTrackerSection note      1.12:1
 *   MyPage soldier benefits box   1.16:1 / 1.13:1
 *   UsPage 일정 chip              1.34:1
 *   ServicePage lilac badge icon  1.15:1
 *
 * The fix is `text-foreground`, which is `var(--navy)` in the light theme, so
 * every light-mode ratio is unchanged (re-measured: 5.47 / 7.40 / 13.53 / 11.61,
 * identical to the pre-fix values) while dark mode flips to the light ink
 * (8.48 / 9.46 / 14.31 / 16.44).
 */
const NAVY_AS_TEXT = /\btext-navy(?:\/\d{1,3})?\b/g;

/** Everything that renders app UI. Surfaces and borders are deliberately excluded. */
const ALL_UI_SOURCES = [
  'src/components/CycleTrackerSection.tsx',
  'src/components/SharedSyncBanner.tsx',
  'src/components/widgets/DDayWidget.tsx',
  'src/components/widgets/UpcomingScheduleWidget.tsx',
  'src/features/home/WidgetDashboard.tsx',
  'src/components/widgets/PartnerEmotionWidgets.tsx',
  'src/components/widgets/CareHintWidget.tsx',
  'src/components/EmotionChipEditor.tsx',
  'src/components/RecordEmotionCorrection.tsx',
  'src/components/PlanSectionNav.tsx',
  'src/lib/recordAuthor.ts',
  'src/pages/MyPage.tsx',
  'src/pages/OnboardingPage.tsx',
  'src/pages/RecordPage.tsx',
  'src/pages/SchedulePage.tsx',
  'src/pages/ServicePage.tsx',
  'src/pages/SettingsPage.tsx',
  'src/pages/TripDetailPage.tsx',
  'src/pages/TripsPage.tsx',
  'src/pages/UsPage.tsx',
];

describe('C5 - --navy is never used as a foreground colour', () => {
  for (const file of ALL_UI_SOURCES) {
    it(`${file} uses no text-navy utility`, () => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source.match(NAVY_AS_TEXT) ?? []).toEqual([]);
    });
  }

  it('keeps --navy dark in BOTH themes, which is why it cannot be a foreground', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');
    expect(css).toContain('--navy: oklch(0.28 0.06 265);');
    expect(css).toContain('--navy: oklch(0.29 0.055 265);');
  });

  it('the replacement token is identical to --navy in the light theme', () => {
    // This is what makes the swap a pure dark-mode fix with no light-mode delta.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');
    expect(css).toContain('--foreground: var(--navy);');
    // ...and genuinely different in dark, otherwise the fix would be a no-op.
    expect(css).toContain('--foreground: oklch(0.95 0.012 85);');
  });

  it('still permits --navy as a surface, border or gradient stop', () => {
    for (const allowed of ['bg-navy', 'bg-navy/10', 'border-navy', 'from-navy', 'to-navy/80', 'ring-navy']) {
      expect(allowed.match(NAVY_AS_TEXT), allowed).toBeNull();
    }
    for (const flagged of ['text-navy', 'text-navy/70', 'text-navy/80', 'text-navy/50', 'text-navy/30']) {
      expect(flagged.match(NAVY_AS_TEXT), flagged).toEqual([flagged]);
    }
  });
});

/**
 * C6 bug condition:
 *   isBugConditionC6(control) = renderedWidth < 44 || renderedHeight < 44
 *
 * Measured in headless Chromium at 390x844:
 *
 *   SharedSyncBanner retry            22x22  -- the ONLY way to recover a frozen
 *                                                shared workspace
 *   UpcomingScheduleWidget 일정 추가   58x16
 *   DDayWidget 복무 현황 보기          45x32
 *   SettingsPage 뒤로가기              36x44  -- declared min-h but not min-w
 *   ServicePage 뒤로가기 / 복무 정보 수정  36x44 / 34x44  -- same omission
 *
 * Only these are guarded. The app has other sub-44px controls (calendar day
 * cells at 42x42, month arrows at 34x34, the compact composer row) which are a
 * deliberate density choice spanning many components; changing them is a design
 * decision and is recorded in the report rather than forced by this guard.
 */
describe('C6 - repaired controls keep a 44px minimum tap target', () => {
  const GUARDED_CONTROLS: Array<{ file: string; anchor: string; label: string }> = [
    { file: 'src/components/SharedSyncBanner.tsx', anchor: '공유 정보 다시 확인', label: 'shared-sync retry' },
    { file: 'src/components/widgets/UpcomingScheduleWidget.tsx', anchor: "navigate('/schedule')", label: '일정 추가' },
    { file: 'src/components/widgets/DDayWidget.tsx', anchor: "navigate('/service')", label: '복무 현황 보기' },
    { file: 'src/pages/SettingsPage.tsx', anchor: '뒤로가기', label: 'settings back' },
    { file: 'src/pages/ServicePage.tsx', anchor: '뒤로가기', label: 'service back' },
    { file: 'src/pages/ServicePage.tsx', anchor: '복무 정보 수정', label: 'service edit' },
  ];

  for (const control of GUARDED_CONTROLS) {
    it(`${control.label} declares both a 44px min-height and min-width`, () => {
      const source = readFileSync(resolve(process.cwd(), control.file), 'utf8');
      const at = source.indexOf(control.anchor);
      expect(at, `${control.file} should still contain ${control.anchor}`).toBeGreaterThan(-1);
      // The className sits within the same JSX element as the anchor.
      const window_ = source.slice(Math.max(0, at - 400), at + 400);
      expect(window_, `${control.label} min-height`).toContain('min-h-[44px]');
      expect(window_, `${control.label} min-width`).toContain('min-w-[44px]');
    });
  }
});
