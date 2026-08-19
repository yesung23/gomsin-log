import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one way this app tells someone something went wrong.
 *
 * ## What it replaces
 *
 * The same job was being done in four different shapes: a bare red caption
 * (`TripsPage`, `TripDetailPage`, `CycleSharingSettings`), a tinted pill
 * (`SchedulePage`), a bordered block (`OnboardingPage`), and a centred grey panel
 * (`CycleTrackerSection`, `CycleSupportSection`). Nineteen `role="alert"` sites, no
 * two agreeing on what a failure looks like -- so the app looked least consistent
 * exactly when the user was already having a bad time.
 *
 * ## The contract, from `design-preview/ui.tsx`
 *
 * > Errors name the cause, what survived, and the retry -- never "check your
 * > internet".
 *
 * That is three separate things, and the props are three separate things, because
 * a single `message` string is how they collapse back into one sentence that
 * blames the network:
 *
 *   - `children` is the CAUSE, stated as what happened rather than as a category.
 *   - `kept` is WHAT SURVIVED. Almost always the most useful line and almost
 *     always the one omitted -- a person who has just seen a save fail wants to
 *     know whether their words are gone before they want anything else.
 *   - `retry` is the way out, and only appears when retrying could actually work.
 *     A retry button on a permanently-refused write teaches people to press it
 *     forever, which the cycle surface has already done once (see
 *     `CycleFetchFailureReason`, where `not_deployed` was split out of `error`
 *     precisely because retrying could never help).
 *
 * `tone` distinguishes the two cases that need different colour: a `blocked`
 * failure is red because something the user asked for did not happen, while a
 * `degraded` one is amber because the app is still working, just not fully.
 * Neither is a bare red string, and both carry a real border so the block is
 * findable by someone scanning rather than reading.
 */
export interface ErrorNoteProps {
  /** What happened. Name the cause, not the category. */
  children: ReactNode;
  /** What survived, when anything did. Say it before the retry. */
  kept?: ReactNode;
  /** Offered ONLY when retrying could plausibly succeed. */
  retry?: { label: string; onRetry: () => void; pending?: boolean };
  /** `blocked`: the action failed. `degraded`: it worked, partially. */
  tone?: 'blocked' | 'degraded';
  className?: string;
}

export function ErrorNote({
  children,
  kept,
  retry,
  tone = 'blocked',
  className,
}: ErrorNoteProps) {
  return (
    <div
      // `alert` so a screen reader interrupts with it. The whole block is the
      // alert, not just the first line: "what survived" is the part people most
      // need to hear and would otherwise never be announced.
      role="alert"
      className={cn(
        'rounded-control border px-3 py-2.5 space-y-1',
        tone === 'blocked'
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-warning/40 bg-warning-surface',
        className,
      )}
    >
      <p
        className={cn(
          'text-caption font-semibold leading-relaxed',
          tone === 'blocked' ? 'text-destructive' : 'text-warning-foreground',
        )}
      >
        {children}
      </p>

      {kept ? (
        <p
          className={cn(
            'text-caption leading-relaxed',
            tone === 'blocked' ? 'text-destructive/80' : 'text-warning-foreground',
          )}
        >
          {kept}
        </p>
      ) : null}

      {retry ? (
        <button
          type="button"
          onClick={retry.onRetry}
          disabled={retry.pending}
          className={cn(
            // `press-response` rather than a bare underline: this is the one
            // control on the screen at the moment the app has already failed once,
            // so it is the last place that should feel unresponsive.
            'press-response min-h-11 -mx-1 px-1 text-caption font-bold underline underline-offset-2 disabled:opacity-50',
            tone === 'blocked' ? 'text-destructive' : 'text-warning-foreground',
          )}
        >
          {retry.pending ? '다시 시도하는 중' : retry.label}
        </button>
      ) : null}
    </div>
  );
}
