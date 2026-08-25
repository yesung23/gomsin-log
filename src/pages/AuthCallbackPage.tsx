import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';
import { AUTH_CALLBACK_TIMEOUT_MS, withTimeout } from '@/lib/async';
import { validatePkceFlowId } from '@/lib/oauthPkce';
import { ErrorNote } from '@/components/ui/ErrorNote';

/**
 * Reads a parameter from either the query string or the URL fragment.
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
      try {
        toast.error(message);
      } catch {
        console.error('[AuthCallback] Failed to display toast error.');
      }
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
      try {
        if (!isSupabaseConfigured || !supabase) {
          fail('Supabase 환경설정이 필요합니다.');
          return;
        }
        const client = supabase;

        // 1. The provider may have redirected back with an error instead of a code.
        const providerError = readAuthParam('error') || readAuthParam('error_code');
        if (providerError) {
          console.error('[AuthCallback] Provider returned an error.');
          fail(
            providerError === 'access_denied'
              ? '로그인이 취소되었습니다. 다시 시도해 주세요.'
              : '로그인 제공자에서 오류가 발생했습니다. 다시 시도해 주세요.',
          );
          return;
        }

        // 2. Read the PKCE callback parameters before replacing the callback URL.
        const code = readAuthParam('code');
        if (code) {
          const flowId = validatePkceFlowId(readAuthParam('sb_flow_id'));
          if (!flowId) {
            fail('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
            return;
          }

          // Keep the store informed when the explicit exchange publishes the
          // signed-in session.
          const { data: sub } = client.auth.onAuthStateChange((event, session) => {
            if (event !== 'SIGNED_IN' || !session) return;
            succeed();
          });
          unsubscribe = () => sub.subscription.unsubscribe();

          // Defer one microtask so StrictMode cleanup can cancel its first effect
          // before the single-use authorization code is consumed.
          await Promise.resolve();
          if (cancelled) return;

          const result = await client.auth.exchangeCodeForSession(code, { flowId });
          if (cancelled) return;

          if (result.error) {
            console.error('[AuthCallback] Code exchange failed.');
            fail('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
            return;
          }

          succeed();
          return;
        }

        // 3. A code-less callback may be a harmless re-open after login. Bound
        //    the session read so a broken storage adapter cannot strand the UI.
        const existing = await withTimeout(
          Promise.resolve()
            .then(() => client.auth.getSession())
            .catch(() => ({ data: { session: null } })),
          AUTH_CALLBACK_TIMEOUT_MS,
          { data: { session: null } },
        );
        if (cancelled) return;
        if (existing.data.session) {
          succeed();
          return;
        }

        fail('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.');
      } catch {
        console.error('[AuthCallback] Unexpected error during authentication callback.');
        fail('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
      }
    }

    void handleAuthCallback();

    return () => {
      cancelled = true;
      hasHandledCallback.current = false;
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
