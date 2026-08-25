import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/lib/supabase';
import { isNativeAuthCallbackUrl, isNativePlatform } from '@/lib/platform';
import { validatePkceFlowId } from '@/lib/oauthPkce';

/**
 * What the user is told when the return half of an OAuth sign-in fails.
 */
export const OAUTH_RETURN_MESSAGES = {
  refused: '로그인이 취소되었습니다. 다시 시도해 주세요.',
  exchangeFailed: '로그인을 마치지 못했어요. 다시 시도해 주세요.',
} as const;

const REMEMBERED_CODES = 16;
const MAX_QUEUED_FAILURES = 8;
const MAX_PENDING_CALLBACKS = 8;

function reportSafely(report: (message: string) => void, message: string): void {
  try {
    report(message);
  } catch {
    console.error('[gomsinlog] Could not display an OAuth failure message.');
  }
}

async function closeBrowserSafely(): Promise<void> {
  try {
    // Dismiss the Custom Tab so the user lands back on the app.
    await Browser.close();
  } catch {
    // Already closed, or the platform does not support closing it.
  }
}

export function createDeferredFailureSink(): {
  report: (message: string) => void;
  activate: (sink: (message: string) => void) => void;
} {
  const queued: string[] = [];
  let delivered: ((message: string) => void) | null = null;

  return {
    report(message) {
      if (delivered) {
        reportSafely(delivered, message);
        return;
      }
      if (queued.length >= MAX_QUEUED_FAILURES) return;
      queued.push(message);
    },
    activate(sink) {
      if (delivered) return;
      delivered = sink;
      for (const message of queued.splice(0)) {
        reportSafely(sink, message);
      }
    },
  };
}

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
export function registerAuthDeepLinkHandler(
  onFailure: (message: string) => void,
): () => void {
  const client = supabase;
  if (!isNativePlatform() || !client) return () => {};

  const auth = client.auth;
  const handled = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  let pendingCount = 0;

  async function handleCallback(url: string): Promise<void> {
    let failure: string | null = null;

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
        console.error('[gomsinlog] OAuth deep link returned an error.');
        failure =
          errorCode === 'access_denied'
            ? OAUTH_RETURN_MESSAGES.refused
            : OAUTH_RETURN_MESSAGES.exchangeFailed;
        return;
      }

      const code = params.get('code');
      if (!code) {
        console.error('[gomsinlog] OAuth callback carried no authorization code.');
        failure = OAUTH_RETURN_MESSAGES.exchangeFailed;
        return;
      }

      const flowId = validatePkceFlowId(params.get('sb_flow_id'));
      if (!flowId) {
        console.error('[gomsinlog] OAuth callback carried no valid flow identifier.');
        failure = OAUTH_RETURN_MESSAGES.exchangeFailed;
        return;
      }

      const callbackKey = `${flowId}:${code}`;
      if (handled.has(callbackKey)) {
        console.warn('[gomsinlog] Ignoring a repeated OAuth callback for one code.');
        return;
      }
      handled.add(callbackKey);
      if (handled.size > REMEMBERED_CODES) {
        const oldest = handled.values().next().value;
        if (oldest !== undefined) handled.delete(oldest);
      }

      const { error } = await auth.exchangeCodeForSession(code, { flowId });
      if (error) {
        console.error('[gomsinlog] Deep link code exchange failed.');
        failure = OAUTH_RETURN_MESSAGES.exchangeFailed;
      }
    } catch {
      console.error('[gomsinlog] OAuth deep link handling threw.');
      failure = OAUTH_RETURN_MESSAGES.exchangeFailed;
    } finally {
      await closeBrowserSafely();
      if (failure) {
        reportSafely(onFailure, failure);
      }
    }
  }

  const listenerPromise = App.addListener('appUrlOpen', ({ url }) => {
    if (!isNativeAuthCallbackUrl(url)) return;

    if (pendingCount >= MAX_PENDING_CALLBACKS) {
      console.warn('[gomsinlog] Pending OAuth callback queue full; dropping callback.');
      // Deliberately not chained onto `queue`: the drop must neither extend the
      // bounded queue nor wait behind the stalled callback that filled it. The
      // user still gets their Custom Tab dismissed and one generic failure, so
      // they can retry instead of staring at a browser that never returns.
      return closeBrowserSafely().then(() => {
        reportSafely(onFailure, OAUTH_RETURN_MESSAGES.exchangeFailed);
      });
    }

    pendingCount += 1;
    const done = queue.then(() => handleCallback(url));
    queue = done
      .catch(() => {
        console.error('[gomsinlog] An OAuth callback failed unexpectedly.');
      })
      .finally(() => {
        pendingCount -= 1;
      });
    return queue;
  }).catch(() => {
    // Without this listener the native OAuth return can never complete, so say
    // so once rather than leaving an unhandled rejection and a silent dead end.
    console.error('[gomsinlog] Could not register the OAuth deep link listener.');
    reportSafely(onFailure, OAUTH_RETURN_MESSAGES.exchangeFailed);
    return null;
  });

  return () => {
    void listenerPromise
      .then((listener) => listener?.remove())
      .catch(() => {
        console.error('[gomsinlog] Could not remove the OAuth deep link listener.');
      });
  };
}
