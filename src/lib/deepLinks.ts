import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/lib/supabase';
import { isNativeAuthCallbackUrl, isNativePlatform } from '@/lib/platform';

/**
 * Completes an OAuth sign-in inside either Capacitor shell.
 *
 * Google refuses to render its sign-in page in an embedded WebView, so the
 * native build opens the provider in a Custom Tab / SFSafariViewController and
 * Supabase redirects back to `gomsinlog://auth/callback?code=...`. Android
 * delivers that URL through the intent-filter and iOS through
 * `application(_:open:options:)`; both surface as an `appUrlOpen` event, which
 * is where the PKCE code has to be exchanged -- the browser that performed the
 * redirect is a different context, so `detectSessionInUrl` never sees it.
 *
 * This is also the only path by which `signInWithApple()` can complete: it uses
 * the same `startOAuth` flow as Google, so without a registered scheme on both
 * platforms the Apple button is dead.
 *
 * No-op on the web, where the normal redirect flow already works.
 */
export function registerAuthDeepLinkHandler(): () => void {
  const client = supabase;
  if (!isNativePlatform() || !client) return () => {};

  const listenerPromise = App.addListener('appUrlOpen', async ({ url }) => {
    // Only the exact callback route, not "anything with our scheme". The Android
    // intent-filter already pins scheme + host + path, but iOS can only register
    // the scheme, so without this check a WKWebView build would hand any
    // `gomsinlog://...` URL -- from any app, or from a tapped link -- to the
    // token-exchange path below.
    if (!isNativeAuthCallbackUrl(url)) return;

    try {
      // The custom scheme is not a hierarchical URL everywhere, so parse
      // defensively rather than relying on `new URL().searchParams`.
      const queryStart = url.indexOf('?');
      const hashStart = url.indexOf('#');
      const params = new URLSearchParams(
        queryStart >= 0
          ? url.slice(queryStart + 1)
          : hashStart >= 0
            ? url.slice(hashStart + 1)
            : '',
      );

      const errorCode = params.get('error') || params.get('error_code');
      if (errorCode) {
        console.error('[gomsinlog] OAuth deep link returned an error:', errorCode);
        return;
      }

      const code = params.get('code');
      if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) console.error('[gomsinlog] Deep link code exchange failed:', error);
        return;
      }

      // Implicit flow fallback.
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) console.error('[gomsinlog] Deep link setSession failed:', error);
      }
    } finally {
      // Dismiss the Custom Tab so the user lands back on the app.
      try {
        await Browser.close();
      } catch {
        // Already closed, or the platform does not support closing it.
      }
    }
  });

  return () => {
    void listenerPromise.then((listener) => listener.remove());
  };
}
