import { useEffect } from 'react';

/**
 * Registers a document-level `keydown` listener that calls `handler` when the
 * Escape key is pressed. The listener is only active while `enabled` is true.
 */
export function useEscapeKey(handler: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handler();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [handler, enabled]);
}
