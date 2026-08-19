import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeAnnouncement, routeScreenName } from '@/lib/routeAnnouncement';

/**
 * Bug condition:
 *   isBugCondition(app) = a screen change is not announced or does not move focus
 *                      OR a control that exists only in widget edit mode cannot be
 *                         reached without a pointer
 *                      OR an interactive control has no accessible name
 *                      OR continuous motion ignores `prefers-reduced-motion`.
 *
 * Measured on the unfixed tree:
 *  - `grep -rn "aria-live" src` found three banners and no route announcer;
 *    `<main>` had no `tabIndex`, and there was no skip link anywhere
 *    (`grep -rn "skip" src` → matches only in unrelated prose).
 *  - `WidgetDashboard` entered edit mode ONLY from `handleTouchStart`, a 500 ms
 *    hold on `onTouchStart`/`onMouseDown`. The drag handle and the delete button
 *    exist only inside edit mode, so dnd-kit's `KeyboardSensor` -- which IS wired
 *    -- was unreachable. A keyboard user could never reorder or remove a widget.
 *  - `AddWidgetBottomSheet` rows were `<div onClick>`: no role, no tabIndex, no
 *    key handler. Adding a widget was pointer-only.
 *  - `grep -rn "prefers-reduced-motion" src` → 0 hits, while `.animate-wiggle`
 *    rotates every widget INFINITELY in edit mode.
 *
 * Nothing caught any of it: 1,101 tests, typecheck, lint and both build
 * directions all pass with the app unusable by keyboard in these places.
 *
 * The DOM-level assertions are made against source text rather than a render,
 * because these are structural attributes on components whose render needs the
 * whole store; the router mapping below is a pure function and is tested directly.
 */

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('a route change is announced and moves focus', () => {
  it('names every screen the tab bar and the router can reach', () => {
    expect(routeScreenName('/')).toBe('홈');
    expect(routeScreenName('/home')).toBe('홈');
    expect(routeScreenName('/record')).toBe('기록');
    expect(routeScreenName('/schedule')).toBe('일정');
    // Prefix-matched for the same reason the tab highlight is.
    expect(routeScreenName('/trips')).toBe('일정');
    expect(routeScreenName('/trips/abc-123')).toBe('일정');
    expect(routeScreenName('/us')).toBe('우리');
    expect(routeScreenName('/my')).toBe('마이');
    expect(routeScreenName('/settings')).toBe('설정');
    expect(routeScreenName('/legal/privacy')).toBe('약관 및 정책');
  });

  it('stays silent rather than guessing at an unknown path', () => {
    // A wrong screen name is worse than no announcement.
    expect(routeScreenName('/nope')).toBeNull();
    expect(routeAnnouncement('/nope')).toBeNull();
    // `/` must be matched exactly; as a prefix it would name every path 홈.
    expect(routeScreenName('/recordx')).toBeNull();
  });

  it('announces the screen it named', () => {
    expect(routeAnnouncement('/record')).toBe('기록 화면입니다');
  });

  it('MobileShell ships the live region, the skip link and a focusable main', () => {
    const shell = read('src/components/MobileShell.tsx');
    expect(shell).toContain('aria-live="polite"');
    expect(shell).toContain('routeAnnouncement(pathname)');
    // The skip link must target the main region and be the first focusable thing.
    expect(shell).toContain('href="#main-content"');
    expect(shell).toContain('id="main-content"');
    expect(shell).toContain('tabIndex={-1}');
    expect(shell).toContain('mainRef.current?.focus()');
    expect(shell.indexOf('href="#main-content"')).toBeLessThan(shell.indexOf('id="main-content"'));
    // The first render is not a navigation and must not steal focus.
    expect(shell).toContain('isFirstRender');
  });

  it('PRESERVATION: the tab bar keeps its label and its prefix matching', () => {
    const shell = read('src/components/MobileShell.tsx');
    expect(shell).toContain('aria-label="하단 내비게이션"');
    expect(shell).toContain('matchPrefixes');
    expect(shell).toContain('aria-selected={active}');
  });
});

describe('widget editing is reachable without a pointer', () => {
  const dashboard = read('src/features/home/WidgetDashboard.tsx');

  it('offers a real button that enters edit mode', () => {
    expect(dashboard).toContain('aria-label="위젯 편집"');
    expect(dashboard).toContain('onClick={() => setIsEditMode(true)}');
  });

  it('PRESERVATION: long-press still works, and still only outside edit mode', () => {
    expect(dashboard).toContain('onTouchStart={!isEditMode ? handleTouchStart : undefined}');
    expect(dashboard).toContain('onMouseDown={!isEditMode ? handleTouchStart : undefined}');
    expect(dashboard).toContain('}, 500);');
  });

  it('PRESERVATION: the keyboard sensor that button makes reachable is still wired', () => {
    expect(dashboard).toContain('useSensor(KeyboardSensor');
    expect(dashboard).toContain('coordinateGetter: sortableKeyboardCoordinates');
  });

  it('announces drag and drop in Korean, naming the widget', () => {
    expect(dashboard).toContain('accessibility={{ announcements }}');
    for (const hook of ['onDragStart', 'onDragOver', 'onDragEnd', 'onDragCancel']) {
      expect(dashboard, hook).toContain(`${hook}:`);
    }
    // The raw sortable id is what the English defaults read out.
    expect(dashboard).toContain('WIDGET_REGISTRY[String(id)]?.label');
    expect(dashboard).toContain('위젯을 집었습니다');
  });
});

describe('every edit-mode control has a name and a big enough target', () => {
  const wrapper = read('src/components/widgets/WidgetWrapper.tsx');

  it('names the remove control and the drag handle after their widget', () => {
    expect(wrapper).toContain('aria-label={`${label} 위젯 삭제`}');
    expect(wrapper).toContain('aria-label={`${label} 위젯 위치 변경`}');
  });

  it('makes the drag handle a real button, not a bare div', () => {
    // A div with dnd-kit listeners is not focusable, so the keyboard sensor could
    // never receive a key event even once edit mode was reachable.
    expect(wrapper).toMatch(/<button\s+type="button"\s+\{\.\.\.attributes\}\s+\{\.\.\.listeners\}/);
  });

  it('meets the 44px target the rest of the app already meets', () => {
    // Was `w-8 h-8` (32px) for remove and `w-12 h-8` (32px tall) for the handle.
    expect(wrapper).toContain('w-11 h-11 bg-muted');
    expect(wrapper).toContain('w-14 h-11 bg-card');
    expect(wrapper).not.toContain('w-8 h-8');
  });

  it('hides the decorative icons from the accessibility tree', () => {
    expect(wrapper).toContain('<X className="w-5 h-5" aria-hidden="true" />');
    expect(wrapper).toContain('<GripHorizontal className="w-5 h-5 text-muted-foreground" aria-hidden="true" />');
  });
});

describe('the add-widget sheet behaves like every other overlay in the app', () => {
  const sheet = read('src/components/widgets/AddWidgetBottomSheet.tsx');

  it('is announced as a modal dialog with a name', () => {
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
    expect(sheet).toContain('aria-labelledby="add-widget-sheet-title"');
    expect(sheet).toContain('id="add-widget-sheet-title"');
  });

  it('closes on Escape, like the other overlays do', () => {
    expect(sheet).toContain('useEscapeKey(onClose, isOpen)');
    // The hook must sit above the `!isOpen` early return or it is conditional.
    expect(sheet.indexOf('useEscapeKey(onClose, isOpen)'))
      .toBeLessThan(sheet.indexOf('if (!isOpen) return null;'));
  });

  it('names its close button', () => {
    expect(sheet).toContain('aria-label="위젯 추가 닫기"');
  });

  it('makes each widget row a keyboard-operable button', () => {
    // Line-ending tolerant: the working tree may be checked out with CRLF.
    expect(sheet).toMatch(/<button\s+key=\{id\}\s+type="button"\s+onClick=\{\(\) => handleAddWidget\(id\)\}/);
    expect(sheet).not.toMatch(/<div\s+key=\{id\}\s+onClick=/);
  });

  it('PRESERVATION: the z-index that keeps the tab bar off this sheet is unchanged', () => {
    // Pinned by `modalStacking.test.ts` for a defect measured in a real browser.
    expect(sheet).toContain('z-[60]');
  });

  it('PRESERVATION: role filtering still decides what may be added', () => {
    expect(sheet).toContain('isWidgetAllowedForRole(id, role)');
    expect(sheet).toContain('widgetsForRole(role)');
  });
});

describe('motion respects the operating-system preference', () => {
  const css = read('src/styles/index.css');

  it('stops the infinite edit-mode wiggle', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.animate-wiggle');
    expect(block).toContain('animation: none !important');
  });

  it('collapses entrances instead of removing them', () => {
    // `animation: none` on a keyframe ending at opacity 1 can leave an element
    // stuck at its `from` state; a 1ms run lands on the final frame.
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation-duration: 1ms !important');
    expect(block).toContain('.animate-fade-in');
    expect(block).toContain('.animate-slide-up');
  });

  it('keeps the loading spinner turning, slower', () => {
    // A frozen spinner reads as a hang, which is worse than the motion.
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.animate-spin\s*\{\s*animation-duration: 2s !important;/);
  });

  it('honours the preference for the scrolls CSS cannot reach', () => {
    // `scrollIntoView({ behavior: 'smooth' })` is a JS argument; a CSS
    // `scroll-behavior` declaration does not override it.
    //
    // Asserted as "the module calls matchMedia AND names this query" rather than as
    // one adjacent string. The previous form pinned those two together, so it broke
    // when the preference readers were given a shared helper -- a refactor that
    // changed nothing about whether the preference is honoured. What matters is that
    // the query is read, not the shape of the call site that reads it.
    const motion = read('src/lib/motion.ts');
    expect(motion).toContain('window.matchMedia(');
    expect(motion).toContain("'(prefers-reduced-motion: reduce)'");
    const recordPage = read('src/pages/RecordPage.tsx');
    expect(recordPage).toContain("behavior: scrollBehavior(), block: 'start'");
    expect(recordPage).toContain("behavior: scrollBehavior(), block: 'center'");
    expect(recordPage).not.toContain("behavior: 'smooth'");
  });

  it('the press response stops moving without going inert', () => {
    // Reduced motion asks for less movement, not for less feedback. A control that
    // stops answering the finger entirely reads as broken, and the person who set
    // this preference is the last one who should have to guess whether a tap landed.
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.press-response:active');
    expect(block).toContain('transform: none');
    // The tint survives; only the scale is dropped.
    expect(block).toMatch(/\.press-response\s*\{[^}]*background-color/);
  });
});

describe('translucency and contrast answer the operating system too', () => {
  const css = read('src/styles/index.css');

  /*
   * These two queries had NO handling at all while fourteen surfaces in this app
   * used `backdrop-blur`. Behind blurred glass, text contrast depends on whatever
   * happens to be scrolling underneath, which is unknowable at design time and
   * worst exactly when the content is dense.
   */
  it('drops the blur when the user asks for less transparency', () => {
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    const block = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(block).toContain('backdrop-filter: none !important');
    expect(block).toContain('-webkit-backdrop-filter: none !important');
  });

  it('also makes the surface opaque, because removing blur alone is not enough', () => {
    // `bg-card/95` over moving content is still moving content at 5%. The blur was
    // compensating for the tint, so the two have to change together.
    const block = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(block).toContain('background-color: var(--card) !important');
    expect(block).toContain('background-color: var(--background) !important');
  });

  it('leaves the modal scrim translucent, which is the one that should stay', () => {
    // The black wash behind a sheet exists to show you have not left the screen.
    const block = css.slice(
      css.indexOf('@media (prefers-reduced-transparency: reduce)'),
      css.indexOf('@media (prefers-contrast: more)'),
    );
    expect(block).not.toContain('bg-black\\/40');
    expect(block).not.toContain('bg-black\\/50');
  });

  it('draws a real border when the user asks for more contrast', () => {
    expect(css).toContain('@media (prefers-contrast: more)');
    const block = css.slice(css.indexOf('@media (prefers-contrast: more)'));
    expect(block).toContain('border-color: var(--foreground)');
  });

  it('never lets an unsupported query throw on first paint', () => {
    // `prefers-reduced-transparency` is younger than browsers this app still runs
    // on, and `matchMedia` throws on a query the engine cannot parse.
    const motion = read('src/lib/motion.ts');
    expect(motion).toContain("'(prefers-reduced-transparency: reduce)'");
    expect(motion).toContain("'(prefers-contrast: more)'");
    expect(motion).toMatch(/try\s*\{[\s\S]*matchMedia[\s\S]*\}\s*catch/);
  });

  it('PRESERVATION: the scroll-to-record emphasis still runs', () => {
    // README section 1 promises 1~2 seconds of visual emphasis. It is a
    // box-shadow pulse, not movement, so it is shortened rather than removed.
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.record-highlighted');
    expect(block).toContain('highlight-pulse 0.8s ease-out 1 !important');
  });
});

describe('the main composer has a name, not just a placeholder', () => {
  it('labels the home composer textarea', () => {
    expect(read('src/components/widgets/TodayLogWidget.tsx'))
      .toContain('aria-label="오늘의 기록"');
  });

  it('labels the record edit textarea', () => {
    expect(read('src/pages/RecordPage.tsx')).toContain('aria-label="기록 내용 수정"');
  });
});

describe('every control answers the finger, not the release', () => {
  const css = read('src/styles/index.css');
  /** The screens the 2026-08-20 press-response sweep touched. */
  const SWEPT = [
    'src/pages/UsPage.tsx', 'src/pages/MyPage.tsx', 'src/pages/ServicePage.tsx',
    'src/pages/TripsPage.tsx', 'src/pages/TripDetailPage.tsx', 'src/pages/SchedulePage.tsx',
    'src/pages/OnboardingPage.tsx', 'src/pages/SettingsPage.tsx', 'src/pages/RecordPage.tsx',
  ];

  it('drops the double-tap wait on all pressables, not only the opted-in ones', () => {
    /*
     * `press-response` carried `touch-action: manipulation` for the surfaces that
     * adopted it, which left roughly a hundred buttons across 일정 · 우리 · 마이 ·
     * 온보딩 · 설정 · 여행 still paying ~300ms per tap while the browser waited to
     * see whether a second one was coming. This app has no double-tap gesture
     * anywhere, so that wait bought nothing.
     *
     * Base-layer, so it is not something a screen can forget to opt into.
     */
    const base = css.slice(css.indexOf('@layer base'));
    expect(base).toContain('touch-action: manipulation');
    expect(base).toContain('-webkit-tap-highlight-color: transparent');
    expect(base).toMatch(/button,\s*\n\s*\[role='button'\]/);
  });

  it('still has no double-tap gesture for that rule to break', () => {
    // The premise, checked rather than assumed. If a double-tap is ever added,
    // `manipulation` becomes wrong and this fails first.
    for (const file of SWEPT) {
      expect(read(file), file).not.toContain('onDoubleClick');
    }
  });

  it('lets a drag handle override it, and the widget handle does', () => {
    // `manipulation` still allows panning, so a drag handle that inherited it would
    // let a touch-drag scroll the page instead of moving the widget.
    const wrapper = read('src/components/widgets/WidgetWrapper.tsx');
    expect(wrapper).toContain("touchAction: 'none'");
  });

  it('a full-width filled button scales rather than tinting itself grey', () => {
    /*
     * `press-response-row` sets the pressed background to `--muted`, which is right
     * for a row on a card and wrong for a coral CTA -- it would flash grey. The
     * sweep that added these classified by width alone at first and produced exactly
     * that on seventeen buttons.
     */
    for (const file of SWEPT) {
      const source = read(file);
      const rows = source.match(/className="press-response-row [^"]*"/g) ?? [];
      for (const row of rows) {
        expect(row, `${file}: ${row}`).not.toMatch(
          /bg-(coral|navy|destructive|foreground|primary)\b/,
        );
      }
    }
  });

  it('left no half-stripped class behind', () => {
    // The first pass ate `active:scale-[0.98]` and left the bracket.
    for (const file of SWEPT) {
      expect(read(file), file).not.toMatch(/className="[^"]*\s\]\s/);
    }
  });
});
