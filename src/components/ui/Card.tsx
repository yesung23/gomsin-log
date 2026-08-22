import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A surface that holds one subject.
 *
 * DESIGN_V2 §3.6: one card, one subject, and no card inside a card. The
 * elevation vocabulary is deliberately thin -- `background` for the page, `card`
 * plus a 1px `border` for a surface, and shadow reserved for layers that actually
 * float (sheets, modals). A gradient is not a level.
 *
 * `rail` is the one accent: a 4px coral edge marks a card the user is expected to
 * ACT on rather than read (§5.3). It replaced the briefing's
 * three-stop coral-to-indigo gradient, which put two accent
 * colours in one card -- the exact thing §3.2 rule 2 forbids -- and reached for a
 * raw `indigo-500` to do it.
 *
 * The 2026-08-08 visual revision tightened it: `rounded-3xl` (24px) + `p-5` +
 * `shadow-sm` was the shape that made every screen read as a stack of soft blobs,
 * and the shadow was elevation this surface does not have -- it sits ON the page.
 * Now `radius-surface` (16px) + 16px padding + border only. A card that really
 * floats asks for it explicitly.
 *
 * Density is also a question of COUNT, not just of shape: the revision caps a
 * screen at three elevated surfaces, so repeated data (records, schedule rows,
 * places) belongs in `ListRow` / `TimelineRow`, never in one card each.
 */
export type CardProps = ComponentPropsWithoutRef<'section'> & {
  /** Rendered as the card's heading when given. */
  title?: ReactNode;
  /** `id` for the heading, so a caller can point `aria-labelledby` at it. */
  titleId?: string;
  /** Trailing control or status on the heading row. */
  action?: ReactNode;
  /** Marks the card as a place to act, not just read. */
  rail?: boolean;
  /** Turn off the default padding when the body manages its own. */
  flush?: boolean;
  children: ReactNode;
};

export function Card({
  title,
  titleId,
  action,
  rail = false,
  flush = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section
      className={cn(
        /*
          카드가 종이를 덮지 않는다 (2026-08-22, §5).

          `bg-card` 로 채우는 순간 괘선이 사라지고 다시 앱 화면이 된다. 대신 손으로 그린
          상자(`ink-box`)가 그 위에 그려진다 -- 네 모서리 반경이 서로 달라 자로 그린
          상자가 아니고, 반복되는 카드가 전부 똑같이 삐뚤지 않도록 세 변형을 돌린다.
        */
        'ink-box',
        rail && 'border-l-4 border-l-coral',
        !flush && 'p-4',
        className,
      )}
      {...rest}
    >
      {title ? (
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <h2 id={titleId} className="text-heading min-w-0" style={{ color: 'var(--ink)' }}>
            {title}
          </h2>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
