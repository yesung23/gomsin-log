import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ArrowRight, Copy, Check } from 'lucide-react';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { useStore } from '@/lib/useStore';
import {
  authRepository,
  createCoupleInvitation,
  consumeCoupleInvitation,
  saveCoupleAnniversary,
  supabase,
} from '@/lib/supabase';
import { toast } from 'sonner';
import type { Role, Branch, MilitaryStatus, DischargeDateSource } from '@/types';
import { addMonths } from '@/lib/utils';

export function OnboardingPage() {
  const { state, updateProfile, setSetupComplete, startDemo: runStartDemo } = useStore();
  const onboardingIdentityKey = state.isDemoMode
    ? `demo:${state.authenticatedUser?.id || ''}`
    : `user:${state.authenticatedUser?.id || ''}`;
  const identityRef = useRef(onboardingIdentityKey);
  const identityGenerationRef = useRef(0);
  const instanceActiveRef = useRef(true);
  if (identityRef.current !== onboardingIdentityKey) {
    identityRef.current = onboardingIdentityKey;
    identityGenerationRef.current += 1;
  }
  const captureIdentity = useCallback(
    () => ({ key: onboardingIdentityKey, generation: identityGenerationRef.current }),
    [onboardingIdentityKey],
  );
  const isCurrentIdentity = useCallback(
    (identity: { key: string; generation: number }) =>
      instanceActiveRef.current
      && identity.key === identityRef.current
      && identity.generation === identityGenerationRef.current,
    [],
  );
  const [step, setStep] = useState(state.onboardingStep || 0); // 0: Landing, 1: Role, 2: Nickname, 3: Space, 4: Anniversary, 5: Military, 6: Contact, 7: Complete

  // Detect iOS environment for conditional Apple Login UI
  const isIOS = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);

  // Form State
  const [emailInput, setEmailInput] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [role, setRole] = useState<Role>('gomsin');
  const [nickname, setNickname] = useState('');
  const [spaceMode, setSpaceMode] = useState<'create' | 'join'>('create');
  const [createdCoupleId, setCreatedCoupleId] = useState('');
  const [createdInviteCode, setCreatedInviteCode] = useState('');
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [joinedPartnerName, setJoinedPartnerName] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);
  const [anniversary, setAnniversary] = useState('');
  const [skipAnniversary, setSkipAnniversary] = useState(false);

  // Military Info State (Soldier only)
  const [branch, setBranch] = useState<Branch>('army');
  const [militaryStatus, setMilitaryStatus] = useState<MilitaryStatus>('serving');
  const [enlistmentDate, setEnlistmentDate] = useState('2025-03-10');
  const [expectedDischargeDate, setExpectedDischargeDate] = useState('2026-09-09');
  const [dischargeDateSource, setDischargeDateSource] = useState<DischargeDateSource>('calculated');

  // Contact Hours State (Soldier only)
  const [weekdayStart, setWeekdayStart] = useState('18:00');
  const [weekdayEnd, setWeekdayEnd] = useState('21:00');
  const [weekendStart, setWeekendStart] = useState('12:00');
  const [weekendEnd, setWeekendEnd] = useState('21:00');

  useLayoutEffect(() => {
    instanceActiveRef.current = true;
    return () => {
      instanceActiveRef.current = false;
      identityGenerationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    setCreatedCoupleId('');
    setCreatedInviteCode('');
    setJoinedPartnerName('');
    setCopiedCode(false);
    setIsGeneratingCode(false);
    setIsVerifyingCode(false);
    setIsFinishing(false);
  }, [onboardingIdentityKey]);

  // Total steps based on role
  const totalSteps = role === 'gomsin' ? 4 : 6;

  // Handle Google OAuth Login
  const handleGoogleLogin = async () => {
    const res = await authRepository.signInWithGoogle();
    if (res.error) {
      toast.error(res.error);
    }
  };

  // Handle Apple OAuth Login
  const handleAppleLogin = async () => {
    const res = await authRepository.signInWithApple();
    if (res.error) {
      toast.error(res.error);
    }
  };

  const handleStartDemo = () => {
    runStartDemo();
  };

  const handleNext = async () => {
    // Auth Gate: Cannot advance from Step 0 without login or demo mode
    if (step === 0 && !state.authenticatedUser && !state.isDemoMode) {
      toast.error('로그인이 필요합니다. Google 또는 Apple로 진행해 주세요.');
      return;
    }

    if (step === 2 && nickname.trim().length < 2) {
      toast.error('닉네임은 2자 이상 입력해주세요.');
      return;
    }

    // Step 3: Couple Space Invitation Generation / Consumption
    if (step === 3) {
      if (isGeneratingCode || isVerifyingCode) return;
      const identity = captureIdentity();

      if (spaceMode === 'create' && !createdInviteCode) {
        setIsGeneratingCode(true);
        try {
          const res = await createCoupleInvitation(role);
          if (!isCurrentIdentity(identity)) return;
          if (res.error || !res.coupleId || !res.code) {
            toast.error(res.error || '초대 코드를 생성하지 못했습니다.');
            return;
          }
          setCreatedCoupleId(res.coupleId);
          setCreatedInviteCode(res.code);
          toast.success('초대 코드가 생성되었습니다!');
        } catch (error) {
          if (!isCurrentIdentity(identity)) return;
          console.error('[Onboarding] Invitation creation failed:', error);
          toast.error('초대 코드를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.');
          return;
        } finally {
          if (isCurrentIdentity(identity)) setIsGeneratingCode(false);
        }
      } else if (spaceMode === 'join') {
        const cleanCode = inviteCodeInput.trim();
        if (!/^\d{6}$/.test(cleanCode)) {
          toast.error('숫자 6자리 초대 코드를 입력해 주세요.');
          return;
        }
        setIsVerifyingCode(true);
        try {
          const res = await consumeCoupleInvitation(cleanCode);
          if (!isCurrentIdentity(identity)) return;
          if (res.error || !res.coupleId) {
            toast.error(res.error || '커플 공간에 연결하지 못했습니다.');
            return;
          }

          setCreatedCoupleId(res.coupleId);
          if (supabase) {
            try {
              const { data: partnerRows, error: partnerError } = await supabase.rpc('get_partner_profile');
              if (!isCurrentIdentity(identity)) return;
              if (partnerError) {
                console.error('[Onboarding] Partner profile lookup failed:', partnerError);
              } else if (partnerRows?.[0]?.display_name) {
                setJoinedPartnerName(partnerRows[0].display_name);
              }
            } catch (error) {
              if (!isCurrentIdentity(identity)) return;
              console.error('[Onboarding] Partner profile lookup failed:', error);
            }
          }
          if (!isCurrentIdentity(identity)) return;
          toast.success('커플 공간 연결 성공!');
        } catch (error) {
          if (!isCurrentIdentity(identity)) return;
          console.error('[Onboarding] Invitation verification failed:', error);
          toast.error('커플 공간에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
          return;
        } finally {
          if (isCurrentIdentity(identity)) setIsVerifyingCode(false);
        }
      }

      if (!isCurrentIdentity(identity)) return;
    }

    // If Gomshin reaches Step 4 (Anniversary), skip Steps 5 & 6 and jump directly to Step 7 (Completion)!
    if (role === 'gomsin' && step === 4) {
      setStep(7);
      return;
    }
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    if (role === 'gomsin' && step === 7) {
      setStep(4);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  };

  const handleCopyCode = () => {
    if (createdInviteCode) {
      navigator.clipboard.writeText(createdInviteCode);
      setCopiedCode(true);
      toast.success('초대 코드가 클립보드에 복사되었습니다.');
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  // Branch months calculation
  const calculateDischarge = (enlistStr: string, mBranch: Branch) => {
    if (!enlistStr) return '';
    const monthsMap: Record<Branch, number> = {
      army: 18,
      marine: 18,
      reserve: 18,
      navy: 20,
      airforce: 21,
      social_service: 21,
      other: 0,
    };
    const m = monthsMap[mBranch] || 18;
    if (m === 0) return enlistStr;
    return addMonths(enlistStr, m);
  };

  const handleEnlistmentChange = (val: string) => {
    setEnlistmentDate(val);
    if (dischargeDateSource === 'calculated') {
      setExpectedDischargeDate(calculateDischarge(val, branch));
    }
  };

  const handleBranchChange = (newBranch: Branch) => {
    setBranch(newBranch);
    if (dischargeDateSource === 'calculated' && enlistmentDate) {
      setExpectedDischargeDate(calculateDischarge(enlistmentDate, newBranch));
    }
  };

  const handleManualDischargeChange = (val: string) => {
    setExpectedDischargeDate(val);
    setDischargeDateSource('manual');
  };

  const finishSetup = async () => {
    if (isFinishing) return;
    const identity = captureIdentity();
    const nowIso = new Date().toISOString();
    const finalNickname = nickname.trim();
    if (finalNickname.length < 2) {
      toast.error('닉네임을 2자 이상 입력해 주세요.');
      setStep(2);
      return;
    }

    const anniversaryDate = skipAnniversary ? undefined : anniversary || undefined;
    const military = {
      branch,
      militaryStatus,
      enlistmentDate:
        role === 'soldier' && militaryStatus !== 'unknown' ? enlistmentDate : undefined,
      expectedDischargeDate:
        role === 'soldier' && militaryStatus !== 'unknown' ? expectedDischargeDate : undefined,
      dischargeDateSource,
      memo: '',
    };
    const contact = { weekdayStart, weekdayEnd, weekendStart, weekendEnd, enabled: true };

    setIsFinishing(true);
    try {
      // Persist to the server FIRST. Previously the client marked onboarding as
      // complete even when the write failed, so the next login sent the user
      // straight back through onboarding.
      if (supabase && state.authenticatedUser && !state.isDemoMode) {
        const userId = state.authenticatedUser.id;
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: userId,
          display_name: finalNickname,
          role,
          military_info: military,
          onboarding_completed_at: nowIso,
          updated_at: nowIso,
        });
        if (!isCurrentIdentity(identity)) return;

        if (profileError) {
          console.error('[Onboarding] Profile save failed:', profileError);
          toast.error('프로필을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
          return;
        }

        const { error: contactError } = await supabase.from('contact_preferences').upsert({
          user_id: userId,
          weekday_start: weekdayStart,
          weekday_end: weekdayEnd,
          weekend_start: weekendStart,
          weekend_end: weekendEnd,
        });
        if (!isCurrentIdentity(identity)) return;
        if (contactError) {
          // Non-blocking: contact hours are editable later from settings.
          console.error('[Onboarding] Contact preferences save failed:', contactError);
        }

        if (createdCoupleId && anniversaryDate) {
          const anniversarySaved = await saveCoupleAnniversary(createdCoupleId, anniversaryDate);
          if (!isCurrentIdentity(identity)) return;
          if (!anniversarySaved) {
            console.error('[Onboarding] Anniversary save failed.');
          }
        }
      }

      if (!isCurrentIdentity(identity)) return;
      // Only now mirror it into local state.
      updateProfile({
        myName: finalNickname,
        role,
        onboardingCompletedAt: nowIso,
        couple: {
          ...state.profile.couple,
          coupleId: createdCoupleId || undefined,
          // No invented partner name: it is filled in for real once the partner joins.
          partnerName: joinedPartnerName || '',
          anniversaryDate,
          // Only the space creator holds a shareable code.
          coupleCode: spaceMode === 'create' ? createdInviteCode : '',
          connected: spaceMode === 'join',
          status: spaceMode === 'join' ? 'active' : 'pending',
        },
        military,
        contact,
      });

      if (!isCurrentIdentity(identity)) return;
      setSetupComplete(true);
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[Onboarding] Final setup failed:', error);
      toast.error('설정을 완료하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsFinishing(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex justify-center bg-muted">
      <div className="relative w-full max-w-[430px] min-h-screen min-h-[100dvh] bg-background shadow-[0_0_60px_-30px_rgba(27,35,64,0.18)] flex flex-col pt-[env(safe-area-inset-top,0px)]">
        
        {/* Step Header (Steps 1~6) */}
        {step > 0 && step < 7 && (
          <header className="flex items-center justify-between px-4 h-14 border-b border-border/40 shrink-0">
            <button onClick={handleBack} className="p-2 -ml-2 text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="이전 단계">
              <ChevronLeft size={24} />
            </button>
            <div className="text-xs font-bold text-muted-foreground">
              {Math.min(step, totalSteps)} / {totalSteps}
            </div>
            <div className="w-10" />
          </header>
        )}

        <main className="flex-1 overflow-y-auto px-6 py-6 flex flex-col justify-between">
          
          {/* STEP 0: Landing / Login Selection */}
          {step === 0 && (
            <div className="flex-1 flex flex-col justify-between py-6">
              <div className="text-center pt-8 space-y-3">
                <div className="flex justify-center mb-3">
                  <CoupleAvatar size={84} />
                </div>
                <h1 className="text-4xl font-black tracking-tight text-foreground">곰신로그</h1>
                <p className="text-muted-foreground text-sm font-medium whitespace-pre-line leading-relaxed">
                  {"답장이 늦어도, 오늘의 순간은 놓치지 않도록."}
                </p>
                <p className="text-xs text-navy/70 font-normal">
                  군화와 곰신, 둘만의 하루를 사진과 짧은 기록으로 남겨요.
                </p>
              </div>

              <div className="space-y-3 my-6">
                {/* Primary Auth CTAs */}
                {isIOS && (
                  <button
                    onClick={handleAppleLogin}
                    className="w-full h-13 py-3.5 rounded-2xl bg-black text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition min-h-[48px] shadow-sm"
                  >
                    <span>Apple로 계속하기</span>
                  </button>
                )}

                <button
                  onClick={handleGoogleLogin}
                  className="w-full h-13 py-3.5 rounded-2xl bg-card border border-border text-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition min-h-[48px] shadow-sm"
                >
                  <span>Google로 계속하기</span>
                </button>

                {/* Secondary Demo Start CTA */}
                <button
                  onClick={handleStartDemo}
                  className="w-full py-3 rounded-2xl bg-coral/15 border border-coral/30 text-coral font-bold text-sm flex items-center justify-center gap-1.5 active:scale-[0.99] transition min-h-[44px] mt-2"
                >
                  <span>데모 공간 먼저 둘러보기</span>
                  <ArrowRight size={16} />
                </button>

                {/* Temporary Email Login */}
                <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-border">
                  <p className="text-[11px] text-muted-foreground text-center font-bold">임시 이메일 로그인 (테스트용)</p>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="이메일 주소 입력"
                    className="w-full h-12 px-4 rounded-xl bg-card border border-border text-sm outline-none focus:ring-2 focus:ring-coral/40"
                  />
                  <button
                    onClick={async () => {
                      if (!emailInput.includes('@')) return toast.error('유효한 이메일을 입력하세요.');
                      setIsSendingEmail(true);
                      const res = await authRepository.signInWithEmail(emailInput);
                      setIsSendingEmail(false);
                      if (res.error) toast.error(res.error);
                      else toast.success('이메일로 매직링크가 전송되었습니다! 메일함을 확인해주세요.');
                    }}
                    disabled={isSendingEmail}
                    className="w-full h-12 rounded-xl bg-navy text-white font-bold text-sm disabled:opacity-50"
                  >
                    {isSendingEmail ? '전송 중...' : '이메일로 계속하기 (매직링크)'}
                  </button>
                </div>

                <p className="text-[11px] text-muted-foreground text-center pt-2">
                  계속하면 서비스 이용약관 및 개인정보 처리방침에 동의하는 것으로 봅니다.
                </p>
              </div>
            </div>
          )}

          {/* STEP 1: Role Selection */}
          {step === 1 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">곰신로그를 어떻게 사용할까요?</h2>
                  <p className="text-sm text-muted-foreground mt-1">역할에 따라 맞춤 기능이 제공돼요.</p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => setRole('gomsin')}
                    className={`w-full p-5 rounded-2xl border text-left flex items-start gap-4 transition min-h-[80px] ${
                      role === 'gomsin'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <span className="text-3xl">🌸</span>
                    <div className="flex-1">
                      <div className="font-bold text-base text-foreground">나는 곰신이에요</div>
                      <div className="text-xs text-muted-foreground mt-1">하루의 순간을 편하게 남길게요</div>
                    </div>
                  </button>

                  <button
                    onClick={() => setRole('soldier')}
                    className={`w-full p-5 rounded-2xl border text-left flex items-start gap-4 transition min-h-[80px] ${
                      role === 'soldier'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <span className="text-3xl">🪖</span>
                    <div className="flex-1">
                      <div className="font-bold text-base text-foreground">나는 군화예요</div>
                      <div className="text-xs text-muted-foreground mt-1">연인의 오늘을 놓치지 않고 볼게요</div>
                    </div>
                  </button>
                </div>
              </div>

              <button
                onClick={handleNext}
                className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[48px]"
              >
                다음
              </button>
            </div>
          )}

          {/* STEP 2: Nickname */}
          {step === 2 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">어떻게 불러드리면 될까요?</h2>
                  <p className="text-sm text-muted-foreground mt-1">상대에게 보이는 이름이에요. 실명이 아니어도 괜찮아요.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">내 닉네임 (2~12자)</label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder={role === 'gomsin' ? '예) 춘향' : '예) 몽룡'}
                    maxLength={12}
                    className="w-full h-13 px-4 rounded-2xl bg-card border border-border text-base outline-none focus:ring-2 focus:ring-coral/40"
                  />
                  {nickname.trim().length > 0 && nickname.trim().length < 2 && (
                    <p className="text-xs text-red-500 font-medium">닉네임은 2자 이상 입력해주세요.</p>
                  )}
                </div>
              </div>

              <button
                onClick={handleNext}
                className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[48px]"
              >
                다음
              </button>
            </div>
          )}

          {/* STEP 3: Couple Space */}
          {step === 3 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">우리 둘만의 로그를 시작해볼까요?</h2>
                  <p className="text-sm text-muted-foreground mt-1">커플 공간을 만들거나 이미 있는 공간에 참여하세요.</p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => setSpaceMode('create')}
                    className={`w-full p-5 rounded-2xl border text-left flex items-start gap-4 transition min-h-[72px] ${
                      spaceMode === 'create'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="font-bold text-base text-foreground">새로운 우리 공간 만들기</div>
                      <div className="text-xs text-muted-foreground mt-1">먼저 시작하고, 상대방을 초대할게요</div>
                    </div>
                  </button>

                  {spaceMode === 'create' && createdInviteCode && (
                    <div className="p-4 bg-coral/10 border border-coral/30 rounded-2xl space-y-2">
                      <div className="text-xs text-coral font-semibold">내 초대 코드 (24시간 유효)</div>
                      <div className="flex items-center justify-between bg-card px-4 py-3 rounded-xl border border-coral/20">
                        <span className="font-mono text-2xl font-bold tracking-widest text-foreground">{createdInviteCode}</span>
                        <button
                          onClick={handleCopyCode}
                          className="p-2 text-coral hover:bg-coral/10 rounded-lg transition"
                          title="코드 복사"
                        >
                          {copiedCode ? <Check size={20} /> : <Copy size={20} />}
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground text-center">
                        상대방이 앱을 설치하고 [초대 코드가 있어요] 메뉴에 위 코드를 입력하면 1:1 커플 공간이 연결됩니다.
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => setSpaceMode('join')}
                    className={`w-full p-5 rounded-2xl border text-left flex items-start gap-4 transition min-h-[72px] ${
                      spaceMode === 'join'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="font-bold text-base text-foreground">초대 코드가 있어요</div>
                      <div className="text-xs text-muted-foreground mt-1">상대가 만든 우리 공간에 들어갈게요</div>
                    </div>
                  </button>

                  {spaceMode === 'join' && (
                    <div className="pt-2 space-y-2">
                      <input
                        type="text"
                        value={inviteCodeInput}
                        onChange={(e) => setInviteCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="숫자 6자리 초대 코드"
                        aria-label="숫자 6자리 초대 코드"
                        className="w-full h-12 px-4 rounded-xl bg-card border border-border text-foreground font-mono text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-coral/40"
                      />
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleNext}
                disabled={isGeneratingCode || isVerifyingCode}
                className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[48px] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isGeneratingCode || isVerifyingCode ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>처리 중...</span>
                  </>
                ) : (
                  <span>다음</span>
                )}
              </button>
            </div>
          )}

          {/* STEP 4: Anniversary Date */}
          {step === 4 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">둘은 언제부터 함께였나요?</h2>
                  <p className="text-sm text-muted-foreground mt-1">정확하지 않아도 괜찮아요. 나중에 우리 탭에서 바꿀 수 있어요.</p>
                </div>

                {!skipAnniversary ? (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground">사귄 날짜</label>
                    <input
                      type="date"
                      value={anniversary}
                      onChange={(e) => setAnniversary(e.target.value)}
                      className="w-full h-13 px-4 rounded-2xl bg-card border border-border text-base outline-none"
                    />
                  </div>
                ) : (
                  <div className="p-4 bg-muted/40 rounded-2xl text-xs text-muted-foreground text-center">
                    사귄 날짜는 나중에 언제든지 설정할 수 있습니다.
                  </div>
                )}

                <button
                  onClick={() => setSkipAnniversary(!skipAnniversary)}
                  className="text-xs text-coral font-semibold underline min-h-[36px]"
                >
                  {skipAnniversary ? '사귄 날짜 입력하기' : '아직 정확히 기억나지 않아요'}
                </button>
              </div>

              <button
                onClick={handleNext}
                className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[48px]"
              >
                {role === 'gomsin' ? '완료' : '다음'}
              </button>
            </div>
          )}

          {/* STEP 5: Military Info (Soldier ONLY) */}
          {step === 5 && role === 'soldier' && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">복무 정보를 알려주세요.</h2>
                  <p className="text-sm text-muted-foreground mt-1">전역 D-Day 및 복무 진행률에 사용돼요. (나중에 입력 가능)</p>
                </div>

                <div className="space-y-4">
                  {/* Status */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">현재 복무 상태</label>
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      {[
                        { key: 'planned', label: '입대 예정' },
                        { key: 'serving', label: '복무 중' },
                        { key: 'discharge_soon', label: '전역 예정' },
                        { key: 'discharged', label: '전역했어요' },
                      ].map((st) => (
                        <button
                          key={st.key}
                          onClick={() => setMilitaryStatus(st.key as MilitaryStatus)}
                          className={`py-2 px-2 rounded-xl text-xs font-semibold border transition min-h-[40px] ${
                            militaryStatus === st.key ? 'bg-coral text-white border-coral' : 'bg-card border-border text-muted-foreground'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Branch */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">군종 선택</label>
                    <div className="grid grid-cols-3 gap-1.5 mt-1">
                      {[
                        { key: 'army', label: '육군' },
                        { key: 'navy', label: '해군' },
                        { key: 'airforce', label: '공군' },
                        { key: 'marine', label: '해병대' },
                        { key: 'reserve', label: '상근예비역' },
                        { key: 'social_service', label: '사회복무' },
                        { key: 'other', label: '기타' },
                      ].map((b) => (
                        <button
                          key={b.key}
                          onClick={() => handleBranchChange(b.key as Branch)}
                          className={`py-2 px-1 rounded-xl text-xs font-semibold border transition min-h-[40px] ${
                            branch === b.key ? 'bg-coral text-white border-coral' : 'bg-card border-border text-muted-foreground'
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Enlistment date */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">입대일 / 입대 예정일</label>
                    <input
                      type="date"
                      value={enlistmentDate}
                      onChange={(e) => handleEnlistmentChange(e.target.value)}
                      className="w-full h-11 px-3 mt-1 rounded-xl bg-card border border-border text-sm outline-none"
                    />
                  </div>

                  {/* Expected Discharge */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">예상 전역일 (자동 계산 / 수동 수정 가능)</label>
                    <input
                      type="date"
                      value={expectedDischargeDate}
                      onChange={(e) => handleManualDischargeChange(e.target.value)}
                      className="w-full h-11 px-3 mt-1 rounded-xl bg-card border border-border text-sm outline-none"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleNext}
                className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[48px]"
              >
                다음
              </button>
            </div>
          )}

          {/* STEP 6: Contact Hours (Soldier ONLY) */}
          {step === 6 && role === 'soldier' && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">주로 언제 오늘의 로그를 확인할 수 있나요?</h2>
                  <p className="text-sm text-muted-foreground mt-1">상대의 로그 표시 및 부드러운 확인 안내용입니다.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">평일 확인 가능 시간</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="time"
                        value={weekdayStart}
                        onChange={(e) => setWeekdayStart(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-xl bg-card border border-border text-sm outline-none"
                      />
                      <span>~</span>
                      <input
                        type="time"
                        value={weekdayEnd}
                        onChange={(e) => setWeekdayEnd(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-xl bg-card border border-border text-sm outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">주말·휴일 확인 가능 시간</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="time"
                        value={weekendStart}
                        onChange={(e) => setWeekendStart(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-xl bg-card border border-border text-sm outline-none"
                      />
                      <span>~</span>
                      <input
                        type="time"
                        value={weekendEnd}
                        onChange={(e) => setWeekendEnd(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-xl bg-card border border-border text-sm outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleNext}
                  className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[48px]"
                >
                  완료하기
                </button>
                <button
                  onClick={handleNext}
                  className="w-full py-3 text-xs text-muted-foreground font-medium text-center min-h-[36px]"
                >
                  지금은 설정하지 않을래요
                </button>
              </div>
            </div>
          )}

          {/* STEP 7: Completion Screen */}
          {step === 7 && (
            <div className="flex-1 flex flex-col justify-between py-8 text-center">
              <div className="pt-12 space-y-4">
                <div className="w-20 h-20 bg-coral/15 rounded-full flex items-center justify-center mx-auto text-4xl">
                  {role === 'gomsin' ? '🌸' : '🪖'}
                </div>
                <h2 className="text-2xl font-bold text-foreground">
                  우리 둘만의 곰신로그가 준비됐어요.
                </h2>
                <p className="text-sm text-muted-foreground">
                  {role === 'gomsin'
                    ? '오늘부터 편하게 하루의 순간을 남겨보세요.'
                    : '곰신이 남긴 오늘 하루를 놓치지 않고 따라잡아볼까요?'}
                </p>
              </div>

              <button
                onClick={finishSetup}
                disabled={isFinishing}
                className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[52px] shadow-md disabled:opacity-60"
              >
                {isFinishing
                  ? '저장 중...'
                  : role === 'gomsin'
                    ? '오늘의 첫 순간 남기기'
                    : '오늘의 로그 기다리기'}
              </button>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
