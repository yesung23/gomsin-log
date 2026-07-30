import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { setAuthenticatedUser, setSetupComplete, setOnboardingStep } = useStore();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const hasHandledCallback = useRef(false);

  useEffect(() => {
    if (hasHandledCallback.current) return;
    hasHandledCallback.current = true;

    async function handleAuthCallback() {
      if (!isSupabaseConfigured || !supabase) {
        toast.error('Supabase 환경설정이 필요합니다.');
        navigate('/', { replace: true });
        return;
      }

      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error || !session) {
          console.error('[AuthCallback] Session retrieval error:', error);
          setErrorMsg(error?.message || '로그인 세션을 찾을 수 없습니다.');
          toast.error('로그인 처리에 실패했습니다. 다시 시도해주세요.');
          setTimeout(() => navigate('/', { replace: true }), 2000);
          return;
        }

        const user = session.user;
        const provider = (user.app_metadata?.provider as 'apple' | 'google') || 'google';

        setAuthenticatedUser({
          id: user.id,
          email: user.email,
          provider,
        });

        // Check if user has completed profile in DB
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (profile && profile.onboarding_completed_at) {
          setSetupComplete(true);
          navigate('/home', { replace: true });
        } else {
          toast.success('로그인 성공! 프로필 작성을 진행해주세요.');
          setSetupComplete(false);
          setOnboardingStep(1);
          navigate('/onboarding', { replace: true });
        }
      } catch (err: any) {
        console.error('[AuthCallback] Unexpected error:', err);
        setErrorMsg(err?.message || '로그인 처리 중 오류가 발생했습니다.');
        toast.error('오류가 발생했습니다.');
        setTimeout(() => navigate('/', { replace: true }), 2000);
      }
    }

    handleAuthCallback();
  }, [navigate, setAuthenticatedUser, setSetupComplete, setOnboardingStep]);

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-12 h-12 border-4 border-coral border-t-transparent rounded-full animate-spin mx-auto" />
        <h2 className="text-lg font-bold text-foreground">인증 정보를 확인하는 중입니다...</h2>
        <p className="text-xs text-muted-foreground">잠시만 기다려주세요.</p>
        {errorMsg && (
          <p className="text-xs text-red-500 font-medium pt-2">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}
