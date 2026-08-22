import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The bar at the top of a screen.
 *
 * ## Why this exists
 *
 * There was no header component. Twelve screens each hand-wrote
 * `flex items-center justify-between` with an `<h1>` and one or two 44px icon
 * buttons, and they had drifted the way copied markup does: 기록 padded
 * `pt-4 pb-3` and rounded its action `rounded-2xl`, 마이 padded `pt-4 pb-1` and
 * rounded its action `rounded-control`, and six screens used a semantic
 * `<header>` while the rest used a plain `<div>`. Nothing was broken, and no two
 * screens started at the same height.
 *
 * Centralising it also gives the redesign one place to own the sticky
 * translucent treatment, rather than thirteen.
 *
 * ## The scroll behaviour
 *
 * `sticky` with a translucent blurred background, so content passing underneath
 * stays partly visible instead of disappearing behind an opaque block. The
 * hairline is always present rather than appearing on scroll: an edge that
 * materialises mid-gesture is a second moving thing competing with the content,
 * and `prefers-reduced-motion` users would get it as a jump.
 *
 * `z-40` sits under the tab bar's `z-50`, which `src/lib/modalStacking.test.ts`
 * requires of anything that is not a bottom-anchored overlay.
 */

export interface AppBarProps extends Omit<ComponentPropsWithoutRef<'header'>, 'title'> {
  title: ReactNode;
  /** Small line under the title -- account name, date range, a count. */
  caption?: ReactNode;
  /** Right-hand controls. Use `AppBarAction` so the 44px target stays consistent. */
  actions?: ReactNode;
  /** Renders a back control on the left. */
  onBack?: () => void;
  /** Accessible name for the back control; say where it goes, not "back". */
  backLabel?: string;
  /**
   * `false` for screens that own their own scroll container or that already pin
   * something else to the top.
   */
  sticky?: boolean;
}

export function AppBar({
  title,
  caption,
  actions,
  onBack,
  backLabel = '이전 화면으로',
  sticky = true,
  className,
  ...props
}: AppBarProps) {
  return (
    <header
      className={cn(
        /*
          공책 위의 헤더 (2026-08-22, §5).

          `backdrop-blur` 를 걷어냈다. 괘선 위에서 흐려지면 종이가 젖은 것처럼 읽힌다.
          대신 종이색으로 덮는다 -- 이 바만 종이를 가리고 나머지는 그 위에 그려진다.

          아래 경계는 실선이 아니라 손으로 그은 선(`ink-rule`)이다. 자로 그은 1px 은
          이 화면에서 유일한 기계 선이 되어 눈에 띈다.
        */
        'relative flex items-center gap-2 px-4 pt-3 pb-3',
        sticky && 'sticky top-0 z-40',
        className,
      )}
      style={sticky ? { background: 'var(--paper)', ...props.style } : props.style}
      {...props}
    >
      {sticky ? (
        <span
          aria-hidden="true"
          className="ink-rule absolute inset-x-0 bottom-0"
        />
      ) : null}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="press-response shrink-0 -ml-2 min-h-11 min-w-[44px] flex items-center justify-center rounded-control"
        >
          <ChevronLeft size={22} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
      )}

      <div className="min-w-0 flex-1">
        {/*
          `text-title` is 22/30/700 from the scale. Truncated rather than wrapped:
          a two-line title changes the bar's height, and every bottom-pinned layer
          on the screen is positioned off measured chrome that assumes it does not.
        */}
        <h1 className="text-title text-foreground truncate">{title}</h1>
        {caption && (
          <p className="text-caption text-muted-foreground truncate">{caption}</p>
        )}
      </div>

      {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
    </header>
  );
}

export interface AppBarActionProps extends ComponentPropsWithoutRef<'button'> {
  /** Required: these are icon-only, so there is no visible text to fall back on. */
  'aria-label': string;
  /** Filled treatment for a control that is currently on. */
  active?: boolean;
  children: ReactNode;
}

/**
 * One icon control in an `AppBar`.
 *
 * 44×44 with no visual box by default. The screens this replaced drew a bordered
 * card around every header icon, which put two or three framed objects in a bar
 * whose job is to name the screen -- `DESIGN_V2.md` §3.6 budgets three elevated
 * surfaces for the WHOLE screen, and the header was spending them before the
 * content started. `active` still fills, because a toggle that does not show its
 * state is not a toggle.
 */
export function AppBarAction({ active = false, className, children, ...props }: AppBarActionProps) {
  return (
    <button
      type="button"
      className={cn(
        'press-response min-h-11 min-w-[44px] flex items-center justify-center rounded-control',
        active ? 'bg-coral-fill text-coral-fill-foreground' : 'text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
