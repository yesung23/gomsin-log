import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"])',
  '[href]:not([tabindex="-1"]):not([aria-hidden="true"])',
  'input:not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"])',
  'select:not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"])',
  'textarea:not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"])',
  '[tabindex]:not([tabindex="-1"]):not([aria-hidden="true"])',
].join(', ');

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.closest('[hidden], [aria-hidden="true"], [inert]') === null);
}

interface DialogFocusOptions {
  active: boolean;
  panelRef: RefObject<HTMLElement | null>;
  restoreFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeDisabled?: boolean;
}

/**
 * Gives a modal its keyboard contract: enter it, stay inside it, leave it, and
 * return to the control that opened it.
 */
export function useDialogFocus({
  active,
  panelRef,
  restoreFocusRef,
  onClose,
  initialFocusRef,
  closeDisabled = false,
}: DialogFocusOptions): void {
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!active) return;

    const panel = panelRef.current;
    const restoreTarget = restoreFocusRef.current;
    (initialFocusRef?.current ?? (panel ? focusableElements(panel)[0] : undefined))?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = focusableElements(panel);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [active, initialFocusRef, panelRef, restoreFocusRef]);
}
