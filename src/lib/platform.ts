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

/** Custom scheme registered by both native shells. Must match capacitor.config.ts. */
export const NATIVE_URL_SCHEME = 'gomsinlog';

/**
 * The one and only deep-link route the app answers.
 *
 * Android pins this exactly in its intent-filter (`android:scheme` +
 * `android:host` + `android:path`), so the OS never hands the activity any other
 * `gomsinlog://` URL. iOS has no path filtering for custom schemes at all --
 * `CFBundleURLTypes` can only register the scheme -- so on iOS this constant,
 * and `isNativeAuthCallbackUrl` below, are what make the two platforms behave
 * the same.
 */
export const NATIVE_AUTH_CALLBACK_URL = `${NATIVE_URL_SCHEME}://auth/callback`;

/**
 * True only for the exact callback route, with an optional query or fragment.
 *
 * Deliberately strict: a sibling path (`gomsinlog://auth/callbackx`), a deeper
 * path (`gomsinlog://auth/callback/extra`) and a different host
 * (`gomsinlog://evil/callback`) are all rejected, which is exactly what the
 * Android intent-filter's exact `android:path` match does. Anything else would
 * let another app -- or a web page -- push an arbitrary URL at the OAuth
 * handler.
 */
export function isNativeAuthCallbackUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url.startsWith(NATIVE_AUTH_CALLBACK_URL)) return false;
  const remainder = url.slice(NATIVE_AUTH_CALLBACK_URL.length);
  return remainder === '' || remainder.startsWith('?') || remainder.startsWith('#');
}

/** Where Supabase should send the user back to after authenticating. */
export function authRedirectUrl(): string {
  if (isNativePlatform()) return NATIVE_AUTH_CALLBACK_URL;
  return `${window.location.origin}/auth/callback`;
}
