import { Capacitor } from '@capacitor/core';

/**
 * Platform helpers.
 *
 * The same bundle runs as a PWA and inside the Capacitor Android shell, and the
 * two need different OAuth flows: on the web Supabase can redirect the page,
 * but Google refuses to serve its sign-in page inside an embedded WebView, so
 * the native build must use the system browser and a deep link back.
 */

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Custom scheme registered by the Android shell. Must match capacitor.config.ts. */
export const NATIVE_URL_SCHEME = 'gomsinlog';

/** Where Supabase should send the user back to after authenticating. */
export function authRedirectUrl(): string {
  if (isNativePlatform()) return `${NATIVE_URL_SCHEME}://auth/callback`;
  return `${window.location.origin}/auth/callback`;
}
