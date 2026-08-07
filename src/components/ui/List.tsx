import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The vocabulary for repeated data: section headers, list rows, editorial
 * timeline rows, dividers.
 *
 * DESIGN_V2 "확정된 시각 개정 (2026-08-08)" · Surface economy: a card is for ONE
 * subject that needs a boundary, and a screen gets at most three of them. Records,
 * schedule entries, shared tasks, trip places and settings menus are none of those
 * -- they are repeated data, and wrapping each one in its own `rounded-3xl` +
 * `p-5` + `shadow-sm` surface is exactly what produced the "AI-generated template"
 * reading: twenty identical soft rectangles, three of which fit on a phone.
 *
 * So repetition is expressed by RHYTHM instead: a shared left edge, a 1px divider,
 * and 12px of internal padding. Structure comes from alignment and whitespace, not
 * from a container per item (Low-chrome interface).
 *
 * Every pressable row here keeps a 44px minimum height, so surface economy never
 * costs a tap target (Visual footprint ≠ hit target, WCAG 2.5.5).
 */

/* ------------------------------------------------------------------ headers */

export type SectionHeaderProps = {
  /** The section's name. Paints at `heading` (17/24/600). */
  title: ReactNode;
  /** `id` for the title, so a caller can point `aria-labelledby` at it. */
  titleId?: string;
  /** One line of supporting text under the title. Optional by design. */
  caption?: ReactNode;
  /**
   * Trailing control. A section's secondary action is a text button, never a
   * second filled button: 표면·컨트롤 규칙 allows one primary CTA per screen.
   */
  action?: ReactNode;
  className?: string;
  /** Render as `h2` (default) or `h3` when nested under another heading. */
  level?: 2 | 3;
};

export function SectionHeader({
  title,
  titleId,
  caption,
  action,
  className,
  level = 2,
}: SectionHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cn('flex items-end justify-between gap-3 mb-2', className)}>
      <div className="min-w-0">
        <Heading id={titleId} className="text-heading text-foreground break-keep">
          {title}
        </Heading>
        {caption ? (
          <p className="text-caption text-muted-foreground mt-0.5 break-keep">{caption}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- group */

export type RowGroupProps = ComponentPropsWithoutRef<'ul'> & {
  /**
   * Draw the group as a bounded surface. Off by default: on a page background,
   * rows need a divider and nothing else. Turn it on only for a settings-style
   * menu where the group itself is the subject.
   */
  boxed?: boolean;
  children: ReactNode;
};

/**
 * A list whose items are separated by 1px, not by a card each.
 *
 * `divide-y` rather than a border per row: a bottom border on every item paints a
 * line under the last one too, which reads as a truncated list.
 */
export function RowGroup({ boxed = false, className, children, ...rest }: RowGroupProps) {
  return (
    <ul
      className={cn(
        'divide-y divide-border',
        boxed && 'rounded-surface border border-border bg-card px-3',
        className,
      )}
      {...rest}
    >
      {children}
    </ul>
  );
}

/* ---------------------------------------------------------------------- row */

export type ListRowProps = {
  /** Time, icon or index. Fixed width so a column of rows aligns. */
  leading?: ReactNode;
  /** Status, chevron or control. */
  trailing?: ReactNode;
  /** The row's own content. Owns its type sizes. */
  children: ReactNode;
  className?: string;
  /** Vertical padding. `tight` for dense metadata lists, default otherwise. */
  density?: 'default' | 'tight';
};

/**
 * One item in a `RowGroup`. Not pressable -- see `PressableRow`.
 *
 * `min-h-11` is 44px: a row is the hit target even when its visible content is
 * two lines of 12px metadata.
 */
export function ListRow({ leading, trailing, children, className, density = 'default' }: ListRowProps) {
  return (
    <li className={cn('list-none', className)}>
      <div
        className={cn(
          'flex items-center gap-3 min-h-11',
          density === 'tight' ? 'py-1.5' : 'py-2.5',
        )}
      >
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0 flex-1">{children}</div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
    </li>
  );
}

export type PressableRowProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  density?: 'default' | 'tight';
};

/**
 * A row where the WHOLE row is the button.
 *
 * §2.10 #2 kept 34px chips at their compact size and made the row around them the
 * touch area; this is the same decision as a primitive. A row that only responds
 * on its 20px chevron is an affordance the spec calls broken.
 */
export function PressableRow({
  leading,
  trailing,
  children,
  className,
  density = 'default',
  type = 'button',
  ...rest
}: PressableRowProps) {
  return (
    <li className="list-none">
      <button
        type={type}
        className={cn(
          'w-full flex items-center gap-3 min-h-11 text-left',
          'transition active:bg-muted/60 rounded-control',
          density === 'tight' ? 'py-1.5' : 'py-2.5',
          className,
        )}
        {...rest}
      >
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0 flex-1">{children}</div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </button>
    </li>
  );
}

/* ----------------------------------------------------------------- timeline */

export type TimelineRowProps = {
  /**
   * The time, in the fixed left column. `caption` + `tabular-nums` so 08:12 and
   * 17:18 occupy the same width and the column reads as a column.
   */
  time: ReactNode;
  /**
   * Photo, video or audio surface. Omit entirely for a text-only record: the
   * revision says the media column is REMOVED then, not left as an empty box, so
   * the prose gets the full width.
   */
  media?: ReactNode;
  /** Author, the user's own words, then privacy and status. In that order. */
  children: ReactNode;
  /** Draw the connecting rail and dot. On for a date group, off for a preview. */
  rail?: boolean;
  className?: string;
};

/**
 * One row of the editorial timeline: `time → media → author + prose → metadata`.
 *
 * The column widths are from the 기록의 에디토리얼 타임라인 문법 table -- time 44px,
 * media 68px growing to 76px once the viewport clears 360px. They are viewport
 * media queries rather than container queries because the app frame is
 * `max-w-[430px]` and the phone width IS the viewport; at 320px the row still
 * leaves ~156px for prose, which holds two to three lines.
 */
export function TimelineRow({ time, media, children, rail = true, className }: TimelineRowProps) {
  return (
    <li className={cn('list-none flex gap-2.5', className)}>
      <div className="shrink-0 w-11 pt-0.5 flex flex-col items-end">
        <span className="text-caption text-muted-foreground tabular-nums">{time}</span>
      </div>

      {rail ? (
        <div className="shrink-0 flex flex-col items-center pt-1.5" aria-hidden="true">
          <span className="w-1.5 h-1.5 rounded-full bg-coral" />
          <span className="w-px flex-1 bg-border mt-1" />
        </div>
      ) : null}

      {media ? (
        <div className="shrink-0 w-[68px] min-[360px]:w-[76px]">{media}</div>
      ) : null}

      <div className="min-w-0 flex-1 pb-4">{children}</div>
    </li>
  );
}

/**
 * The date a run of timeline rows belongs to.
 *
 * Shown only when the date CHANGES, which is the whole point of the grammar: a
 * date on every row is the repetition the editorial timeline exists to remove.
 */
export function TimelineDateHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li className={cn('list-none pt-1 pb-2', className)}>
      <h3 className="text-label font-semibold text-foreground">{children}</h3>
    </li>
  );
}
