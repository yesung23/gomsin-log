import { cn } from '@/lib/utils';

/**
 * Waiting, stated as waiting.
 *
 * The distinction this primitive exists to keep is not visual. When a shared
 * workspace has not been confirmed yet, an empty list is NOT "nothing was
 * shared" -- saying so is a false statement about the user's own data, and
 * `EmotionFlowSummarySection` and `PartnerDayTimelineWidget` both check that
 * condition before they check emptiness. This is what they render instead.
 *
 * So the label is required. A bare shimmer says "wait" but not "wait for what",
 * and `aria-busy` alone tells a screen reader nothing about the subject.
 *
 * `animate-pulse` is stopped outright under `prefers-reduced-motion` by
 * src/styles/index.css, which leaves a static block plus the label -- still a
 * correct loading state, which is why the label cannot be optional.
 */
export function Skeleton({
  label,
  description,
  lines = 2,
  className,
}: {
  /** What is being waited for, in words. */
  label: string;
  /** Optional second line: what will be true once the wait ends. */
  description?: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('py-2', className)} role="status" aria-busy="true">
      <p className="text-body font-semibold text-foreground break-keep">{label}</p>
      {description ? (
        <p className="mt-1 text-caption text-muted-foreground leading-relaxed break-keep">{description}</p>
      ) : null}
      <div className="mt-2 space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="h-4 rounded-lg bg-muted animate-pulse"
            /* Descending width reads as text rather than as a block. */
            style={{ width: `${100 - index * 18}%` }}
          />
        ))}
      </div>
    </div>
  );
}
