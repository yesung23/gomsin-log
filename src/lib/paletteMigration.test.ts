import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * C9 bug condition:
 *   isBugConditionC9(file) = occurrenceCount(raw accent palette utility) > 0
 *
 * Measured before this migration: 102 utilities across 16 files, drawn from nine
 * palette families -- amber, indigo, blue, emerald, purple, pink, rose, red and
 * the gray group that an earlier pass had already cleared.
 *
 * The reason this matters is not tidiness. A raw palette utility has no dark
 * value, so `src/styles/index.css` carried a 90-line block that remapped
 * `--color-amber-50`, `--color-indigo-500`, `--color-blue-400` and thirty-odd
 * others to dark surfaces. Every line of that block was a component that had
 * opted out of the token system, and the remap made opting out invisible: dark
 * mode looked correct, so nothing pushed back.
 *
 * The migration is therefore two things at once, and this guard asserts both:
 * the utilities are gone, AND the block that compensated for them is gone. One
 * without the other is not finished.
 *
 * Where each family went (DESIGN_V2 §3.2 assigns the meanings):
 *
 *   amber   -> warning / warning-surface / warning-foreground   offline, OCR
 *                                                               unconfirmed, 나만 보기
 *   indigo  -> info / info-surface                              planning
 *   blue    -> info                                             planning, trips
 *   emerald -> success-surface                                  done, verified
 *   purple  -> lilac                                            anniversary
 *   pink    -> coral                                            the relationship
 *   rose    -> coral                                            personal cycle marker
 *   red     -> destructive                                      failure, deletion
 *
 * Every ink was checked against the surface it lands on, in a real Chromium
 * paint. Two results changed the mapping:
 *
 *   `text-success` on a card measures 4.04:1 -- BELOW AA's 4.5 -- so the two
 *   emerald inks became `text-foreground` on `bg-success-surface` (12.81:1)
 *   rather than `text-success`.
 *
 *   `bg-info` filled with `text-white` was replaced by `text-primary-foreground`
 *   (4.80:1 light, 8.69:1 dark), which inverts with the theme instead of staying
 *   white on a light-blue surface in dark mode.
 */

/** Every accent family Tailwind ships that this app has ever reached for. */
const RAW_ACCENT_UTILITY =
  /\b(?:bg|text|border|from|to|via|ring|divide|placeholder|accent|fill|stroke)-(?:amber|indigo|blue|emerald|teal|pink|purple|yellow|red|green|orange|violet|sky|cyan|lime|rose|fuchsia|gray|slate|zinc|neutral|stone)-\d{2,3}(?:\/\d{1,3})?\b/g;

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

describe('C9 - no raw accent palette utility survives anywhere under src/', () => {
  it('scans a non-empty set of sources, so a silent glob failure cannot pass', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES).toContain('src/pages/SchedulePage.tsx');
    expect(SOURCES).toContain('src/components/OfflineBanner.tsx');
  });

  it('every file uses semantic tokens only', () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const found = read(file).match(RAW_ACCENT_UTILITY) ?? [];
      if (found.length > 0) offenders.push(`${file}: ${[...new Set(found)].join(' ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the semantic tokens that replaced them are actually in use', () => {
    // If the utilities were deleted rather than converted, these counts collapse.
    const all = SOURCES.map(read).join('\n');
    for (const [token, minimum] of [
      ['bg-warning-surface', 8],
      ['text-warning-foreground', 10],
      ['bg-info-surface', 5],
      ['text-info', 15],
      ['bg-success-surface', 2],
      ['text-destructive', 10],
    ] as const) {
      const count = (all.match(new RegExp(`\\b${token}\\b`, 'g')) ?? []).length;
      expect(count, token).toBeGreaterThanOrEqual(minimum);
    }
  });

  /** Guard soundness: it flags a raw family and never a semantic token. */
  it('flags raw palette utilities, including opacity variants', () => {
    for (const flagged of [
      'bg-amber-50', 'text-amber-900', 'border-amber-200', 'bg-indigo-500',
      'text-indigo-600', 'bg-blue-400', 'bg-emerald-500/10', 'bg-purple-500/10',
      'bg-pink-500/10', 'bg-rose-100', 'text-red-400', 'bg-red-500', 'bg-gray-100',
      'ring-indigo-400/40', 'accent-indigo-500', 'text-indigo-50',
    ]) {
      expect(flagged.match(RAW_ACCENT_UTILITY), flagged).toEqual([flagged]);
    }
  });

  it('never flags a semantic token', () => {
    for (const allowed of [
      'bg-warning-surface', 'text-warning-foreground', 'border-warning/30',
      'bg-info', 'bg-info/10', 'text-info', 'bg-info-surface', 'text-info-foreground',
      'bg-success-surface', 'text-destructive', 'bg-destructive/10', 'bg-lilac',
      'text-lilac-foreground', 'bg-coral/15', 'text-coral-strong', 'text-primary-foreground',
      'bg-muted', 'text-foreground', 'accent-info', 'ring-info/40',
    ]) {
      expect(allowed.match(RAW_ACCENT_UTILITY), allowed).toBeNull();
    }
  });
});

describe('C9 - the dark palette remap is deleted, not merely unused', () => {
  const css = read('src/styles/index.css');

  it('defines no --color-<palette>-<shade> override', () => {
    const overrides = css.match(/^\s*--color-(?:gray|slate|zinc|neutral|stone|amber|indigo|blue|emerald|teal|pink|purple|yellow|red)-\d{2,3}\s*:/gm) ?? [];
    expect(overrides).toEqual([]);
  });

  it('still does not remap --color-white, which is deliberately theme-invariant', () => {
    // The Apple sign-in label, the navy service hero and the modal scrims all
    // depend on white staying white in both themes.
    expect(css).not.toMatch(/^\s*--color-white\s*:/m);
  });

  it('keeps every semantic token the migration relies on, in BOTH themes', () => {
    for (const declaration of [
      '--warning: oklch(0.52 0.11 75);',
      '--warning-foreground: oklch(0.35 0.09 75);',
      '--warning-surface: oklch(0.96 0.035 85);',
      '--info: oklch(0.55 0.14 265);',
      '--info-surface: oklch(0.96 0.02 265);',
      '--success-surface: oklch(0.95 0.04 155);',
      '--destructive: oklch(0.58 0.19 25);',
      // ...and the dark values, which are what the remap block was faking.
      '--warning-surface: oklch(0.27 0.04 80);',
      '--info-surface: oklch(0.26 0.04 265);',
      '--success-surface: oklch(0.25 0.04 155);',
      '--destructive: oklch(0.68 0.17 25);',
    ]) {
      expect(css, declaration).toContain(declaration);
    }
  });

  it('exposes them to Tailwind, so the utilities above exist at all', () => {
    for (const mapping of [
      '--color-warning-surface: var(--warning-surface);',
      '--color-warning-foreground: var(--warning-foreground);',
      '--color-info-surface: var(--info-surface);',
      '--color-success-surface: var(--success-surface);',
      '--color-destructive: var(--destructive);',
      '--color-lilac: var(--lilac);',
    ]) {
      expect(css, mapping).toContain(mapping);
    }
  });
});
