import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The Astryx foundation's two silent failure modes, and the ones that follow.
 *
 * Astryx is wired in as a component layer under this app's own tokens rather than
 * as a replacement for them. Three of the decisions that make that work are
 * invisible at runtime -- reversing them produces an app that still builds, still
 * passes every other test, and looks wrong. Those are the ones worth a guard.
 */

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

/**
 * Both CSS files document these rules in prose, and the prose necessarily names
 * the very imports the rules forbid. Scanning the raw text therefore fails on the
 * explanation rather than on the code -- which is exactly what happened when this
 * file was first written, and is why `src/lib/typeScale.test.ts` strips comments
 * before it scans too.
 */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const indexCss = withoutComments(read('src/styles/index.css'));
const themeCss = withoutComments(read('src/styles/astryx-gomsin.css'));

describe('the Astryx bridge maps toward this app, never away from it', () => {
  it('never imports the Tailwind bridge, which would repoint bg-card at Astryx grey', () => {
    /*
     * `@astryxdesign/core/tailwind-theme.css` declares `--color-card`,
     * `--color-muted`, `--color-border` and `--color-primary` -- four names
     * `index.css` already owns. Importing it silently repoints every `bg-card`,
     * `bg-muted`, `border-border` and `text-primary` in the app at Astryx's
     * palette. Nothing throws; the app just stops being coral.
     */
    expect(indexCss).not.toContain('tailwind-theme.css');
  });

  it('never imports the Astryx reset, which is a second unscoped Preflight', () => {
    // Same job as Tailwind's Preflight, applied globally to bare elements.
    // Loading both restyles headings, lists and form controls app-wide.
    expect(indexCss).not.toMatch(/@astryxdesign\/core\/reset\.css/);
  });

  it('orders the layers so Tailwind utilities still beat Astryx component styles', () => {
    const statement = indexCss.match(/@layer\s+([^;]+);/)?.[1];
    expect(statement, 'a @layer order statement must come first').toBeTruthy();

    const order = statement!.split(',').map((name) => name.trim());
    const base = order.indexOf('base');
    const astryxBase = order.indexOf('astryx-base');
    const astryxTheme = order.indexOf('astryx-theme');
    const utilities = order.indexOf('utilities');

    for (const [name, index] of Object.entries({ base, astryxBase, astryxTheme, utilities })) {
      expect(index, `${name} must be named in the layer order`).toBeGreaterThanOrEqual(0);
    }

    // After base: Astryx component styling beats Preflight.
    expect(astryxBase).toBeGreaterThan(base);
    // The app's theme overrides Astryx's own `:root` defaults, which live in
    // `astryx-base` at the same specificity -- layer order is what decides it.
    expect(astryxTheme).toBeGreaterThan(astryxBase);
    // Before utilities: `<Card className="p-0">` still wins without `!`.
    expect(utilities).toBeGreaterThan(astryxTheme);
  });

  it('imports the component layer and the theme, in that order', () => {
    /*
     * Doubles as the anti-vacuity check for the two `not.toContain` guards above.
     * If `withoutComments` ever ate the whole file, those two would pass on an
     * empty string and report the foundation as sound while it was gone; this one
     * fails first.
     */
    const componentLayer = indexCss.indexOf('@astryxdesign/core/astryx.css');
    const theme = indexCss.indexOf('./astryx-gomsin.css');
    expect(componentLayer).toBeGreaterThanOrEqual(0);
    expect(theme).toBeGreaterThan(componentLayer);
  });
});

describe('the theme carries no colour of its own', () => {
  /*
   * Every colour in the theme file is a `var()` onto a token `index.css` already
   * redefines under `[data-theme='dark']`. That is the whole reason there is no
   * dark block here. A literal colour would be a second copy of a value that has
   * an owner, and it would be a copy that does not change when the theme does --
   * so it would look correct in light mode and wrong in dark, which is the
   * hardest version of this bug to notice.
   */
  it('declares no hex, rgb, hsl or oklch literal', () => {
    const declarations = themeCss
      .split('\n')
      .filter((line) => /^\s*--/.test(line))
      .filter((line) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/.test(line));

    expect(declarations).toEqual([]);
  });

  it('has no dark-mode block redefining its colours', () => {
    /*
     * `color-scheme` is the one property that legitimately differs by theme here,
     * because `light-dark()` in Astryx's own defaults reads it and nothing else.
     * Any OTHER property appearing in a dark selector means a colour was copied.
     */
    const darkBlocks = [...themeCss.matchAll(/\[data-theme='dark'\][^{]*\{([^}]*)\}/g)];
    for (const [, body] of darkBlocks) {
      const properties = [...body.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((match) => match[1]);
      expect(properties).toEqual(['color-scheme']);
    }
  });

  it('keeps the accent on the fill coral and the ink on the ink coral', () => {
    /*
     * `--coral-strong` is coral INK on a card in 87 places and `--coral-fill` is
     * the filled CTA. Swapping them puts a 2.09:1 pink on white text, which
     * `e2e/tokenContrast.spec.ts` measures for this app's own components but
     * cannot see inside an Astryx one.
     */
    expect(themeCss).toMatch(/--color-accent:\s*var\(--coral-fill\)/);
    expect(themeCss).toMatch(/--color-on-accent:\s*var\(--coral-fill-foreground\)/);
    expect(themeCss).toMatch(/--color-text-accent:\s*var\(--coral-strong\)/);
  });

  it('names Pretendard and no webfont, which the CSP would block', () => {
    expect(themeCss).toContain('Pretendard Variable');
    expect(themeCss).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import/);
  });

  it('keeps card elevation flat, so Astryx cards match this app’s bordered ones', () => {
    // DESIGN_V2 §3.6: shadow is reserved for layers that actually float.
    expect(themeCss).toMatch(/--shadow-low:\s*none/);
  });
});

describe('every frame that renders Astryx components is themed', () => {
  /*
   * The attribute is what scopes the mapping. A frame without it renders Astryx's
   * own blue-and-grey defaults beside this app's coral, and `OnboardingPage`
   * hand-copies `MobileShell`'s frame rather than reusing it -- so the two can
   * drift apart, and onboarding is the first screen anyone sees.
   */
  const FRAMES = ['src/components/MobileShell.tsx', 'src/pages/OnboardingPage.tsx'] as const;

  for (const frame of FRAMES) {
    it(`${frame} carries data-astryx-theme`, () => {
      expect(read(frame)).toContain('data-astryx-theme="gomsin"');
    });
  }

  it('finds every hand-copied phone frame, so a third one cannot be added unthemed', () => {
    /*
     * The frame is identifiable by its width constraint. If a new screen copies
     * it again, this fails until that screen is either themed or added above with
     * a reason -- which is cheaper than discovering it from a screenshot.
     */
    const framed = FRAMES.filter((frame) => read(frame).includes('max-w-[430px]'));
    expect(framed).toEqual([...FRAMES]);
  });
});
