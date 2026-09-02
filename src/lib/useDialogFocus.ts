import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    (initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
