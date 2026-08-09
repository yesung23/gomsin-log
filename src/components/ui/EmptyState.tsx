import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Nothing here yet -- said in a way that is not a failure.
 *
 * DESIGN_V2 §3.8 asks an empty state for three things: what this space is for,
 * why it is empty, and the one action that fills it. The wording matters more
 * than the layout, so `title` and `description` are separate: the title names the
 * space, the description carries the reason, and neither is allowed to imply the
 * user did something wrong.
 *
 * It deliberately does NOT claim emptiness on the caller's behalf. When a shared
 * workspace is merely unconfirmed, "아직 없어요" is a false statement about the
 * user's own data -- that case belongs to `Skeleton`, and the widgets check it
 * FIRST (see PartnerDayTimelineWidget).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  /** Decorative. The title carries the meaning. */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** The single action that resolves the emptiness. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-5 text-center', className)}>
      {icon ? <div className="mb-2 flex justify-center" aria-hidden="true">{icon}</div> : null}
      {/*
        Body face, not handwriting. Every empty-state line in this app is Korean, and
        only the latin subset of Nanum Pen Script ships, so `font-hand` here would
        render the Korean in Pretendard anyway -- the class would be a lie in the
        source. Handwriting is limited to all-latin strings; see `--font-hand`.
      */}
      <p className="text-body font-semibold text-foreground break-keep">{title}</p>
      {description ? (
        <p className="mt-1 text-caption text-muted-foreground leading-relaxed break-keep">{description}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}
