import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';
import { AUTH_CALLBACK_TIMEOUT_MS } from '@/lib/async';

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
    let unsubscribe: (() => void) | undefined;
    let timeoutId: number | undefined;

    const fail = (message: string) => {
      if (cancelled) return;
      cancelled = true;
      setErrorMsg(message);
      toast.error(message);
      window.setTimeout(() => navigate('/', { replace: true }), 2500);
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

      // 2. A session may already exist (e.g. the user re-opened the callback URL).
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session) {
        succeed();
        return;
      }

      // 3. Watch for the session arriving. `detectSessionInUrl` performs the code
      //    exchange asynchronously, so polling getSession() once (the previous
      //    behaviour) frequently observed `null` and reported a false failure.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) succeed();
      });
      unsubscribe = () => sub.subscription.unsubscribe();

      // 4. Explicitly exchange the PKCE code. This is idempotent with
      //    detectSessionInUrl: whichever completes first wins, and the
      //    "already used" error is expected when detectSessionInUrl won.
      const code = readAuthParam('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error && !cancelled) {
          const { data: after } = await supabase.auth.getSession();
          if (after.session) {
            succeed();
            return;
          }
          console.error('[AuthCallback] Code exchange failed:', error);
          fail('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
          return;
        }
      }

      // 5. Give the implicit flow / in-flight exchange a bounded amount of time.
      timeoutId = window.setTimeout(async () => {
        if (cancelled) return;
        const { data: late } = await supabase!.auth.getSession();
        if (late.session) succeed();
        else fail('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.');
      }, AUTH_CALLBACK_TIMEOUT_MS);
    }

    void handleAuthCallback();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
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
