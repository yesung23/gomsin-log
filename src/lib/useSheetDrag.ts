import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SPRING_DEFAULT,
  SPRING_MOMENTUM,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  springAtRest,
  springStep,
  type SpringState,
} from '@/lib/motion';

/**
 * Drag-to-dismiss for a bottom sheet, tracking the finger 1:1.
 *
 * ## Why this is not a CSS transition
 *
 * The sheets in this app open with `animate-in slide-in-from-bottom-full` and close
 * by unmounting. That is a fixed keyframe: it plays for its duration, from where it
 * was told to start, and it cannot be argued with. Put a finger on it halfway and
 * nothing happens -- the sheet is an image of a sheet, not an object.
 *
 * This hook makes it an object. The sheet is wherever the finger put it, and when
 * the finger leaves, a spring takes over AT THE VELOCITY THE FINGER HAD. Change your
 * mind mid-flight and the next touch picks the sheet up from wherever it currently
 * is, because the spring is re-seeded from the live transform rather than restarted.
 *
 * ## Why it is additive, never the only way out
 *
 * Every sheet keeps its close button, its Escape handler and its backdrop tap. A
 * gesture nobody can see is not an affordance, and a sheet that can ONLY be swiped
 * is unusable by keyboard and invisible to a screen reader. The drag is a shortcut
 * for people who already expect it, on top of three routes that were always there.
 *
 * ## Why the handle, not the sheet body
 *
 * `onPointerDown` is returned separately so it can be attached to the grab handle
 * and the header only. Attaching it to the whole sheet would make every downward
 * swipe inside a scrolling list ambiguous -- the list would fight the sheet for the
 * same gesture, and on a short list the sheet would usually win, which is exactly
 * the behaviour that makes a sheet feel like it is trying to escape.
 */
export interface SheetDragOptions {
  /** Called once the sheet has travelled far enough, or fast enough, to be gone. */
  onDismiss: () => void;
  /** Turn the gesture off entirely (the sheet stays operable by button and Escape). */
  enabled?: boolean;
}

/**
 * Fraction of the sheet's own height the PROJECTED resting point must pass for the
 * gesture to count as a dismissal.
 *
 * Projected, not travelled. A short fast flick and a long slow drag are different
 * intentions and distance alone cannot tell them apart -- see `projectMomentum`.
 */
const DISMISS_FRACTION = 0.4;

export function useSheetDrag({ onDismiss, enabled = true }: SheetDragOptions) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /**
   * Live gesture and animation state, deliberately in refs.
   *
   * A ref rather than state because this changes every frame: routing 60-120
   * renders per second through React to move one element is work the compositor
   * would otherwise do for free. The transform is written straight to the node.
   */
  const offset = useRef(0);
  const grabOffset = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);
  const frame = useRef<number | null>(null);
  const dismissing = useRef(false);

  const paint = useCallback((y: number) => {
    offset.current = y;
    const node = sheetRef.current;
    if (node) node.style.transform = y === 0 ? '' : `translate3d(0, ${y}px, 0)`;
  }, []);

  const stopFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  /** Release the sheet to a spring, seeded from where it is and how fast it is moving. */
  const settle = useCallback(
    (target: number, initialVelocity: number, onArrive?: () => void) => {
      stopFrame();

      if (prefersReducedMotion()) {
        // The request was for less movement, so there is no journey -- only arrival.
        paint(target);
        onArrive?.();
        return;
      }

      let state: SpringState = { value: offset.current, velocity: initialVelocity };
      // A dismissal carries the user's own momentum, so it is allowed the softer
      // damping. A snap-back is the app correcting a gesture and stays critical.
      const config = target === 0 ? SPRING_DEFAULT : SPRING_MOMENTUM;
      let previous = performance.now();

      const tick = (now: number) => {
        // Clamped so a backgrounded tab does not resume with a 3-second timestep.
        const dt = Math.min((now - previous) / 1000, 1 / 30);
        previous = now;
        state = springStep(state, target, dt, config);

        if (springAtRest(state, target)) {
          paint(target);
          frame.current = null;
          onArrive?.();
          return;
        }

        paint(state.value);
        frame.current = requestAnimationFrame(tick);
      };

      frame.current = requestAnimationFrame(tick);
    },
    [paint, stopFrame],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled || dismissing.current) return;
      // Secondary buttons and multi-touch are not this gesture.
      if (event.button !== 0 && event.pointerType === 'mouse') return;

      /*
       * Interruption. The sheet may be mid-spring; the finger takes it from
       * wherever it is now, not from where the spring was heading. Without this
       * the sheet would jump to its target on touch -- the "brick wall".
       */
      stopFrame();

      grabOffset.current = event.clientY - offset.current;
      lastY.current = event.clientY;
      lastT.current = performance.now();
      velocity.current = 0;
      setIsDragging(true);

      /*
       * Capture means this element keeps receiving the move and up events even
       * when the finger leaves it -- which it will, because dragging a sheet down
       * moves the finger off the handle almost immediately.
       */
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [enabled, stopFrame],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isDragging) return;

      const raw = event.clientY - grabOffset.current;
      const height = sheetRef.current?.offsetHeight ?? 0;

      /*
       * Down is free and exactly 1:1. Up is resisted, because there is nothing
       * above the open position -- without resistance the sheet detaches from the
       * bottom of the screen and stops being an object with a place.
       */
      const next = raw >= 0 ? raw : rubberband(raw, height);
      paint(next);

      const now = performance.now();
      const dt = now - lastT.current;
      /*
       * Sampled over at least 8ms. Two pointer events in the same millisecond give
       * a divide-by-almost-zero and a velocity in the thousands, which then throws
       * the sheet off-screen on release.
       */
      if (dt >= 8) {
        velocity.current = ((event.clientY - lastY.current) / dt) * 1000;
        lastY.current = event.clientY;
        lastT.current = now;
      }
    },
    [isDragging, paint],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isDragging) return;
      setIsDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);

      const height = sheetRef.current?.offsetHeight ?? 0;
      const projected = projectMomentum(offset.current, velocity.current);

      if (height > 0 && projected > height * DISMISS_FRACTION) {
        dismissing.current = true;
        settle(height, velocity.current, onDismiss);
        return;
      }

      settle(0, velocity.current);
    },
    [isDragging, onDismiss, settle],
  );

  // A cancelled pointer (a system gesture, a call arriving) is not a dismissal.
  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isDragging) return;
      setIsDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      settle(0, velocity.current);
    },
    [isDragging, settle],
  );

  useEffect(() => stopFrame, [stopFrame]);

  return {
    sheetRef,
    isDragging,
    /** Spread onto the grab handle / header, never onto a scrolling region. */
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      // The browser must not also try to scroll or select from this gesture.
      style: { touchAction: 'none' as const },
    },
  };
}
