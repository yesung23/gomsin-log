/**
 * Resolve with `fallback` if `promise` has not settled within `ms`.
 *
 * Used to make sure a slow or hanging network call can never keep the app
 * stuck behind its loading splash screen.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[gomsinlog] operation timed out after ${ms}ms, continuing with fallback`);
      resolve(fallback);
    }, ms);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error('[gomsinlog] operation failed, continuing with fallback', error);
        resolve(fallback);
      });
  });
}

/** Milliseconds we are willing to wait for the initial server sync before rendering the app. */
export const AUTH_SYNC_TIMEOUT_MS = 12_000;

/** Milliseconds we are willing to wait for an OAuth code exchange to complete. */
export const AUTH_CALLBACK_TIMEOUT_MS = 15_000;

/**
 * Milliseconds the callback page waits for the client's own `detectSessionInUrl`
 * exchange before attempting one itself.
 *
 * A PKCE authorization code may be redeemed exactly once. `detectSessionInUrl:
 * true` means the client is already redeeming the code in the callback URL, so a
 * second, concurrent `exchangeCodeForSession` for the same code is guaranteed to
 * lose with an `invalid_grant`-class error. Waiting here keeps the explicit
 * exchange a strictly sequential fallback instead of a competitor.
 */
export const AUTH_CALLBACK_DETECT_GRACE_MS = 2_000;
