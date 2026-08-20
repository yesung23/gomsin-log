import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';
import { AUTH_CALLBACK_TIMEOUT_MS, withTimeout } from '@/lib/async';
import { ErrorNote } from '@/components/ui/ErrorNote';

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
    const timers: number[] = [];

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

      // 2. Read the PKCE code before replacing the callback URL.
      const code = readAuthParam('code');

      // 3. A session may already exist (e.g. the user re-opened the callback URL).
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session) {
        succeed();
        return;
      }

      // 4. Keep the store informed when the explicit exchange publishes the
      //    signed-in session. The callback page itself owns the exchange; the
      //    Supabase client has detectSessionInUrl disabled so this listener can
      //    never race a second consumer of the same one-time code.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) return;
        succeed();
      });
      unsubscribe = () => sub.subscription.unsubscribe();

      // 5. Exchange a PKCE authorization code exactly once. Bound the request so
      //    a network failure cannot leave the user on a permanent spinner.
      if (code) {
        const result = await withTimeout<{ error: unknown }>(
          supabase.auth.exchangeCodeForSession(code),
          AUTH_CALLBACK_TIMEOUT_MS,
          { error: new Error('OAuth code exchange timed out') },
        );
        if (cancelled) return;

        if (result.error) {
          console.error('[AuthCallback] Code exchange failed:', result.error);
          fail('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
          return;
        }

        succeed();
        return;
      }

      // 6. Defensive support for an old implicit-flow link. New Google, Apple
      //    and email links use PKCE, but accepting a complete legacy token pair
      //    avoids breaking a link that was issued before this deployment.
      const accessToken = readAuthParam('access_token');
      const refreshToken = readAuthParam('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (error) {
          console.error('[AuthCallback] Legacy token session failed:', error);
          fail('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
          return;
        }
        succeed();
        return;
      }

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
        <h2 className="text-heading text-foreground">인증 정보를 확인하는 중입니다...</h2>
        <p className="text-caption text-muted-foreground">잠시만 기다려주세요.</p>
        {/*
          The failure someone is most likely to hit and least able to interpret: a
          sign-in that did not complete, on a screen with no navigation. It was a
          bare red caption -- the same words the rest of the app now says inside
          `ErrorNote`, but with neither the border that makes a failure findable nor
          the `role="alert"` that announces it.

          `kept` earns its place here more than almost anywhere else: the account is
          fine and only this attempt failed, and someone watching a sign-in fail
          assumes the worse of those two.
        */}
        {errorMsg && (
          <ErrorNote
            className="text-left"
            kept="계정은 그대로예요. 다시 로그인하면 이어서 사용할 수 있어요."
          >
            {errorMsg}
          </ErrorNote>
        )}
      </div>
    </div>
  );
}
