import { useEffect, useState } from 'react';

/**
 * Single source of truth for connectivity.
 *
 * Two reasons this is a shared hook rather than per-component listeners:
 *
 * 1. `OfflineBanner` used to own the only pair of `online`/`offline` listeners in
 *    the app, so every other component that cared had to duplicate them and could
 *    drift out of agreement about the current state.
 * 2. Offline is now a PRE-EMPTIVE read-only mode, not a post-hoc explanation.
 *    Mutation controls consult this hook and refuse to fire a request that can
 *    only fail -- which is what stops a dead network from producing a
 *    permission-shaped error message.
 *
 * `navigator.onLine === false` is trusted (the OS says there is no link).
 * `true` is treated as "probably reachable": it cannot be verified without a
 * request, so a write is still allowed to try and its failure is classified by
 * `serverErrors.ts`.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean'
      ? true
      : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Re-read on mount: the event may have fired between the initial render and
    // this effect, and a stale `true` would leave mutation controls enabled.
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      setOnline(navigator.onLine);
    }

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/** The one copy used everywhere a control is disabled for being offline. */
export const OFFLINE_READONLY_MESSAGE =
  '오프라인이라 지금은 읽기만 가능해요. 연결되면 다시 시도해 주세요.';
