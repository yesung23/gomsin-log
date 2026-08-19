import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * The grab bar at the top of a bottom sheet.
 *
 * Two jobs, and the visible one matters more.
 *
 * It is the drag surface, and it is the ONLY drag surface. Not the sheet body,
 * because a downward swipe inside a scrolling panel has to stay a scroll, and a
 * sheet that competes with its own content for that gesture feels like it is
 * trying to get away. Not the header either: a header usually holds the close
 * button, and a pointer capture taken on an ancestor swallows the `click` that
 * button needs.
 *
 * It is also the only reason anyone would guess the sheet can be dragged. A
 * gesture with no affordance is not a feature.
 *
 * `aria-hidden`, deliberately: it is a shortcut on top of routes that already
 * work -- the close button, Escape, and the backdrop -- never a replacement for
 * them. Nothing here is the only way out of anything.
 *
 * `sm:hidden` because above that breakpoint the sheet is a centred dialog rather
 * than something anchored to the bottom edge, and dragging a centred card
 * downward means nothing.
 */
export function SheetHandle({
  className,
  ...handleProps
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...handleProps}
      className={cn(
        '-mt-1 mb-1.5 pt-1.5 pb-1 flex justify-center sm:hidden cursor-grab active:cursor-grabbing',
        className,
      )}
    >
      <span aria-hidden="true" className="block w-9 h-1 rounded-full bg-border" />
    </div>
  );
}
