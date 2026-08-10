import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface CycleSheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Blocks Escape and the close button while a write is in flight. */
  busy?: boolean;
}

/**
 * The bottom sheet used by every cycle editor.
 *
 * Written here rather than pulled from a UI library because the repository has
 * no dialog primitive and adding one for this screen is not in scope. It covers
 * the four things a dialog must do: label itself, close on Escape, keep focus
 * inside, and return focus to whatever opened it.
 */
export function CycleSheet({ title, onClose, children, busy = false }: CycleSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Remember the opener so focus can go back to it on close.
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )?.focus();

    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy) onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus trap: cycle within the panel instead of escaping to the page
      // behind the scrim.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
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
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  return (
    // z-[60] so the bottom tab bar cannot intercept the sheet's actions.
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-5">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-card w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-surface border border-border p-4 space-y-4 animate-in slide-in-from-bottom-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-heading text-foreground font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
            className="min-h-11 min-w-11 -mr-2 -mt-2 flex items-center justify-center rounded-control text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
