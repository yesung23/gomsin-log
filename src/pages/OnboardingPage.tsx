import React, { useState, useMemo } from 'react';
import { ChevronLeft, Heart, Shield, Lock, Check, Mail, ArrowRight } from 'lucide-react';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import type { Role, Branch, MilitaryStatus, DischargeDateSource } from '@/types';
import { addMonths } from '@/lib/utils';

export function OnboardingPage() {
  const { updateProfile, setSetupComplete, startDemo: runStartDemo } = useStore();
  const [step, setStep] = useState(0); // 0: Landing, 1: Role, 2: Nickname, 3: Space, 4: Anniversary, 5: Military, 6: Contact, 7: Complete

  // Detect iOS environment for conditional Apple Login UI
  const isIOS = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);

  // Form State
  const [role, setRole] = useState<Role>('gomsin');
  const [nickname, setNickname] = useState('');
  const [spaceMode, setSpaceMode] = useState<'create' | 'join'>('create');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [anniversary, setAnniversary] = useState('');
  const [skipAnniversary, setSkipAnniversary] = useState(false);

  // Email Magic Link Sub-view State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSent, setEmailSent] = useState(false);

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

  // Total steps based on role
  const totalSteps = role === 'gomsin' ? 4 : 6;

  const handleNext = () => {
    if (step === 2 && nickname.trim().length < 2) {
      toast.error('닉네임은 2자 이상 입력해주세요.');
      return;
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

  const handleAuthNotice = (provider: string) => {
    if (provider === '이메일 Magic Link') {
      setShowEmailModal(true);
      return;
    }
    toast.info(`${provider} 인증 설정 전입니다. UI 테스트를 위해 온보딩 흐름으로 진입합니다.`);
    setStep(1);
  };

  const handleSendMagicLink = () => {
    if (!emailInput.trim() || !emailInput.includes('@')) {
      toast.error('올바른 이메일 주소를 입력해주세요.');
      return;
    }
    toast.info('이메일 로그인은 연결 전입니다. UI 테스트를 위해 온보딩 흐름으로 진입합니다.');
    setEmailSent(true);
    setTimeout(() => {
      setShowEmailModal(false);
      setStep(1);
    }, 1500);
  };

  const handleStartDemo = () => {
    runStartDemo();
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

  const finishSetup = () => {
    const nowIso = new Date().toISOString();
    updateProfile({
      myName: nickname || (role === 'gomsin' ? '춘향' : '몽룡'),
      role,
      onboardingCompletedAt: nowIso,
      couple: {
        partnerName: role === 'gomsin' ? '몽룡' : '춘향',
        anniversaryDate: skipAnniversary ? undefined : (anniversary || '2024-02-14'),
        coupleCode: spaceMode === 'create' ? '123456' : (inviteCodeInput || '123456'),
        connected: true,
        status: 'active',
      },
      military: {
        branch,
        militaryStatus,
        enlistmentDate: role === 'soldier' && militaryStatus !== 'unknown' ? enlistmentDate : undefined,
        expectedDischargeDate: role === 'soldier' && militaryStatus !== 'unknown' ? expectedDischargeDate : undefined,
        dischargeDateSource,
        memo: '',
      },
      contact: {
        weekdayStart,
        weekdayEnd,
        weekendStart,
        weekendEnd,
        enabled: true,
      },
    });
    setSetupComplete(true);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex justify-center bg-[oklch(0.95_0.008_85)]">
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
                    onClick={() => handleAuthNotice('Apple')}
                    className="w-full h-13 py-3.5 rounded-2xl bg-black text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition min-h-[48px] shadow-sm"
                  >
                    <span>Apple로 계속하기</span>
                  </button>
                )}

                <button
                  onClick={() => handleAuthNotice('Google')}
                  className="w-full h-13 py-3.5 rounded-2xl bg-white border border-border text-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition min-h-[48px] shadow-sm"
                >
                  <span>Google로 계속하기</span>
                </button>

                <button
                  onClick={() => handleAuthNotice('이메일 Magic Link')}
                  className="w-full h-13 py-3.5 rounded-2xl bg-navy text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition min-h-[48px] shadow-sm"
                >
                  <Mail size={18} />
                  <span>이메일로 시작하기</span>
                </button>

                {/* Secondary Demo Start CTA */}
                <button
                  onClick={handleStartDemo}
                  className="w-full py-3 rounded-2xl bg-coral/15 border border-coral/30 text-coral font-bold text-sm flex items-center justify-center gap-1.5 active:scale-[0.99] transition min-h-[44px] mt-2"
                >
                  <span>데모 공간 먼저 둘러보기</span>
                  <ArrowRight size={16} />
                </button>

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
                        onChange={(e) => setInviteCodeInput(e.target.value)}
                        placeholder="6자리 초대 코드 입력 (데모: 123456)"
                        className="w-full h-12 px-4 rounded-xl bg-card border border-border text-sm outline-none"
                      />
                    </div>
                  )}

                  <div className="p-3 bg-muted/50 rounded-xl text-xs text-muted-foreground text-center">
                    데모 모드에서는 곰신과 군화의 연결 흐름을 자유롭게 시뮬레이션할 수 있어요.
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
                className="w-full py-4 rounded-2xl bg-coral text-white font-bold text-base min-h-[52px] shadow-md"
              >
                {role === 'gomsin' ? '오늘의 첫 순간 남기기' : '오늘의 로그 기다리기'}
              </button>
            </div>
          )}

        </main>

        {/* Email Magic Link Modal */}
        {showEmailModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl">
              <div className="flex items-center gap-2 text-navy font-bold text-base">
                <Mail size={20} className="text-coral" />
                <span>이메일로 시작하기</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                이메일 주소를 입력하시면 로그인 링크를 보내드립니다.
              </p>

              {!emailSent ? (
                <div className="space-y-3">
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="example@email.com"
                    className="w-full h-12 px-4 rounded-xl bg-card border border-border text-sm outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowEmailModal(false)}
                      className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs active:bg-gray-200 min-h-[44px]"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSendMagicLink}
                      className="flex-1 py-3 bg-navy text-white font-bold rounded-xl text-xs active:scale-[0.99] min-h-[44px]"
                    >
                      로그인 링크 보내기
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-50 rounded-xl text-xs text-amber-900 border border-amber-200">
                    현재 인증 서버 설정 전입니다. 데모 모드로 먼저 둘러보실 수 있습니다.
                  </div>
                  <button
                    onClick={() => {
                      setShowEmailModal(false);
                      handleStartDemo();
                    }}
                    className="w-full py-3 bg-coral text-white font-bold rounded-xl text-xs active:scale-[0.99] min-h-[44px]"
                  >
                    데모 모드로 시작하기
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
