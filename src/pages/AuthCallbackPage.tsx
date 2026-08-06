import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';
import { AUTH_CALLBACK_DETECT_GRACE_MS, AUTH_CALLBACK_TIMEOUT_MS } from '@/lib/async';

/**
 * Reads a parameter from either the query string or the URL fragment.
 * Supabase uses the query string for the PKCE flow and the fragment for the
 * implicit flow, and returns provider errors in whichever one it used.
 */
function readAuthParam(name: string): string | null {
  const search = new URLSearchParams(window.location.search);
  if (search.has(name)) return search.get(name);
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const fragment = new URLSearchParams(hash);
  return fragment.get(name);
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const hasHandledCallback = useRef(false);

  useEffect(() => {
    if (hasHandledCallback.current) return;
    hasHandledCallback.current = true;

    let cancelled = false;
    let signedIn = false;
    let unsubscribe: (() => void) | undefined;
    const timers: number[] = [];

    /** Resolved by the auth listener the instant a session exists. */
    let announceSession: (() => void) | undefined;
    const sessionAnnounced = new Promise<void>((resolve) => {
      announceSession = resolve;
    });

    const fail = (message: string) => {
      if (cancelled) return;
      cancelled = true;
      setErrorMsg(message);
      toast.error(message);
      timers.push(window.setTimeout(() => navigate('/', { replace: true }), 2500));
    };

    /**
     * Hand control back to the router. We deliberately do NOT decide here whether
     * onboarding is complete: the store's `onAuthStateChange` listener owns that,
     * and having two writers caused a race that could show the onboarding screen
     * to fully-onboarded users.
     */
    const succeed = () => {
      if (cancelled) return;
      cancelled = true;
      navigate('/', { replace: true });
    };

    /**
     * Resolve `true` as soon as a session exists, or after `ms` if none arrives.
     *
     * The wait ends early on the listener's announcement rather than by polling,
     * so a session that is already in flight costs no extra latency.
     */
    const sessionArrivesWithin = async (ms: number): Promise<boolean> => {
      await Promise.race([
        sessionAnnounced,
        new Promise<void>((resolve) => {
          timers.push(window.setTimeout(resolve, ms));
        }),
      ]);
      if (signedIn) return true;
      if (cancelled) return false;
      const { data } = await supabase!.auth.getSession();
      return !!data.session;
    };

    async function handleAuthCallback() {
      if (!isSupabaseConfigured || !supabase) {
        fail('Supabase 환경설정이 필요합니다.');
        return;
      }

      // 1. The provider may have redirected back with an error instead of a code.
      const providerError = readAuthParam('error') || readAuthParam('error_code');
      if (providerError) {
        const description = readAuthParam('error_description');
        console.error('[AuthCallback] Provider returned an error:', providerError, description);
        fail(
          providerError === 'access_denied'
            ? '로그인이 취소되었습니다. 다시 시도해 주세요.'
            : '로그인 제공자에서 오류가 발생했습니다. 다시 시도해 주세요.',
        );
        return;
      }

      // 2. Read the code BEFORE anything can strip it: a successful
      //    `detectSessionInUrl` exchange rewrites the URL to remove it.
      const code = readAuthParam('code');

      // 3. A session may already exist (e.g. the user re-opened the callback URL).
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session) {
        succeed();
        return;
      }

      // 4. Watch for the session arriving. `detectSessionInUrl` performs the code
      //    exchange asynchronously, so polling getSession() once (the previous
      //    behaviour) frequently observed `null` and reported a false failure.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) return;
        signedIn = true;
        announceSession?.();
        succeed();
      });
      unsubscribe = () => sub.subscription.unsubscribe();

      // 5. A PKCE authorization code may be redeemed exactly ONCE, and
      //    `detectSessionInUrl: true` means this client is already redeeming the
      //    one in the URL. So wait for that to land first and only redeem it here
      //    if it produced nothing -- this call is a sequential fallback (the
      //    deep-link shape, or a client that never ran the detection), never a
      //    competitor. Racing it guaranteed that one of the two exchanges lost
      //    with an `invalid_grant`-class error.
      if (code) {
        if (await sessionArrivesWithin(AUTH_CALLBACK_DETECT_GRACE_MS)) {
          succeed();
          return;
        }
        if (cancelled) return;

        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;

        if (error) {
          // NOT terminal, and this is the bug that told successfully signed-in
          // users their login had failed: a losing exchange still leaves the
          // winner's session about to land. Only the absence of a session at the
          // deadline is a real failure, so keep waiting instead of giving up on
          // the first error.
          console.error('[AuthCallback] Code exchange failed:', error);
          if (await sessionArrivesWithin(AUTH_CALLBACK_TIMEOUT_MS)) {
            succeed();
            return;
          }
          if (cancelled) return;
          fail('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
          return;
        }
      }

      // 6. Give the implicit flow / in-flight exchange a bounded amount of time.
      if (await sessionArrivesWithin(AUTH_CALLBACK_TIMEOUT_MS)) {
        succeed();
        return;
      }
      if (cancelled) return;
      fail('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.');
    }

    void handleAuthCallback();

    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 border-4 border-coral border-t-transparent rounded-full animate-spin mx-auto" />
        <h2 className="text-lg font-bold text-foreground">인증 정보를 확인하는 중입니다...</h2>
        <p className="text-xs text-muted-foreground">잠시만 기다려주세요.</p>
        {errorMsg && (
          <p className="text-xs text-destructive font-medium pt-2">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
