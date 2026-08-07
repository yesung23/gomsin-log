import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A short status, said in words.
 *
 * WCAG 1.4.1: colour is never the only carrier. Every tone below is paired with
 * text the caller has to supply, so a badge still reads correctly in greyscale,
 * for a colour-blind reader, and to a screen reader -- which is the same rule the
 * record author cues follow (src/lib/recordAuthor.ts).
 *
 * The tones map onto the semantic roles fixed in DESIGN_V2 §3.2, so a badge
 * cannot invent a meaning: `accent` for the relationship, `info` for planning,
 * `success` for done, `warning` for private / needs-checking / delayed,
 * `destructive` for failure.
 */
type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'destructive';

const TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-coral-strong text-coral-strong-foreground',
  info: 'bg-info-surface text-info-foreground',
  success: 'bg-success-surface text-foreground',
  warning: 'bg-warning-surface text-warning-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
};

export type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  tone?: Tone;
  /** Decoration that precedes the text. Never the only content. */
  icon?: ReactNode;
  children: ReactNode;
};

export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-bold',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {icon ? <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span> : null}
      {children}
    </span>
  );
}
