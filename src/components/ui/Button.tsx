import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one button in this app.
 *
 * Before this, every screen wrote its own: eleven different roundings, four
 * different heights, and the filled variant hard-coded the brand coral with a
 * white label in 51 places -- which is how the primary action in this app ended
 * up at 2.09:1 against WCAG AA's 4.5:1 (see src/lib/coralContrast.test.ts). A
 * primitive is the only way that cannot happen one file at a time.
 *
 * Rules this encodes rather than documents:
 *
 *   - `primary` is the only filled-coral variant and it uses `--coral-strong`,
 *     the measured-readable pair. DESIGN_V2 §3.2 allows ONE primary per screen.
 *   - every variant clears 44px, and `lg` clears 52px, so a tap target cannot be
 *     lost by choosing a size (WCAG 2.5.5, and §3.5).
 *   - the label is text. An icon-only button must pass `aria-label`, which is why
 *     `children` is required and `aria-label` is surfaced in the type.
 *   - no palette literal appears here; src/lib/themeTokens.test.ts guards it.
 */

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type Size = 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-coral-strong text-coral-strong-foreground',
  secondary: 'bg-muted text-foreground',
  outline: 'bg-transparent text-foreground border border-border',
  ghost: 'bg-transparent text-muted-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
};

const SIZE: Record<Size, string> = {
  md: 'min-h-11 px-4 text-label',
  lg: 'min-h-13 px-5 text-body font-semibold',
};

export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: Variant;
  size?: Size;
  /** Stretches to the container. Bottom-anchored actions are full width. */
  full?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  full = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-bold',
        'transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100',
        VARIANT[variant],
        SIZE[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
