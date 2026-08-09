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
 *   - `primary` is the only filled-coral variant and it uses `--coral-fill`, the
 *     measured-readable pink pair. DESIGN_V2 §3.2 allows ONE primary per screen.
 *     `--coral-strong` is the darker sibling for coral INK on a card; a fill light
 *     enough to look pink measures 2.00:1 as text, which is why they are separate.
 *   - `lg` paints the 48px primary CTA, `md` the 40-44px ordinary control, and
 *     `sm` a 36px compact control whose hit area is still 44px -- so a tap target
 *     cannot be lost by choosing a size (WCAG 2.5.5, and 표면·컨트롤 규칙).
 *   - the label is text. An icon-only button must pass `aria-label`, which is why
 *     `children` is required and `aria-label` is surfaced in the type.
 *   - no palette literal appears here; src/lib/themeTokens.test.ts guards it.
 */

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-coral-fill text-coral-fill-foreground',
  secondary: 'bg-muted text-foreground',
  outline: 'bg-transparent text-foreground border border-border',
  ghost: 'bg-transparent text-muted-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
};

/**
 * Visual height, and separately the hit target.
 *
 * DESIGN_V2 (2026-08-08) 표면·컨트롤 규칙: primary CTA paints at 48px, an ordinary
 * control at 40-44px, and EVERY control keeps a 44px hit target. Those two
 * numbers used to be the same number, which is why the old `md` at 44px and `lg`
 * at 52px made a screen of four buttons look like a remote control.
 *
 * `sm` is how the two are separated. It paints 36px and grows its own hit area to
 * 44px with a `::before` overlay, so a compact chip-height control is still legal
 * under WCAG 2.5.5. The overlay is inset horizontally by zero and vertically by
 * -4px, i.e. 36 + 4 + 4 = 44, and it is `-z-10` so it never covers the label.
 */
const SIZE: Record<Size, string> = {
  sm: [
    'min-h-9 px-3 text-label',
    'relative isolate',
    "before:absolute before:content-[''] before:inset-x-0 before:-inset-y-1 before:-z-10",
  ].join(' '),
  md: 'min-h-11 px-4 text-label',
  lg: 'min-h-12 px-5 text-emphasis',
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
        'inline-flex items-center justify-center gap-1.5 rounded-control font-semibold',
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
