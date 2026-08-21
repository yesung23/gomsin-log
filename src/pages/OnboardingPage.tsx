import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Copy, Check } from 'lucide-react';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { Button } from '@/components/ui/Button';
import { serverCallBlockedByPendingDeletion } from '@/lib/accountDeletion';
import { clearAuthErrorFromUrl, readAuthErrorFromUrl } from '@/lib/authErrorFromUrl';
import { useStore } from '@/lib/useStore';
import {
  authRepository,
  createCoupleInvitation,
  consumeCoupleInvitation,
  fetchAuthProviderAvailability,
  fetchMyCoupleState,
  regenerateCoupleInvitation,
  saveCoupleAnniversary,
  supabase,
} from '@/lib/supabase';
import { invitationExpiryLabel } from '@/lib/coupleLifecycle';
import { classifyServerError } from '@/lib/serverErrors';

import { toast } from 'sonner';
import type { Role, Branch, MilitaryStatus, DischargeDateSource } from '@/types';
import { addMonths } from '@/lib/utils';

export function OnboardingPage() {
  const {
    state,
    updateProfile,
    setSetupComplete,
    setOnboardingStep,
    recoverExpiredSession,
  } = useStore();
  const onboardingIdentityKey = `user:${state.authenticatedUser?.id || ''}`;
  const identityRef = useRef(onboardingIdentityKey);

  /**
   * An OAuth failure reported on this url by GoTrue.
   *
   * Read once on mount and then stripped from the address bar, so the message does
   * not survive a reload or ride along in a shared link. Read state is initialised
   * from the url rather than set in an effect: an effect would paint the login screen
   * without the message for one frame, which is long enough to look like the app
   * ignored the attempt -- the exact impression this fixes.
   */
  const [authUrlError] = useState(() => readAuthErrorFromUrl());
  useEffect(() => {
    if (authUrlError) {
      console.error('[Onboarding] OAuth failure returned to the app root:', authUrlError.code);
      clearAuthErrorFromUrl();
    }
  }, [authUrlError]);
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
  /**
   * Step 0 is the LANDING/SIGN-IN screen, so it is only correct for a visitor who
   * has not signed in yet.
   *
   * A brand-new account arrives here already authenticated: `/auth/callback`
   * exchanges the code, hydration finds no `profiles` row, `setupComplete` stays
   * false and `App` renders this wizard. Opening at step 0 meant the first thing a
   * user saw after signing in was "Google로 계속하기" again -- and because step 0
   * has no "다음" and nothing ever wrote a non-zero `onboardingStep`, pressing it
   * just repeated the same round trip. No new account could reach role selection.
   *
   * A stored step is still honoured, so a creator who was already shown an
   * invitation code is not dropped back to the beginning.
   */
  const FIRST_WIZARD_STEP = 1;
  const hasIdentity = !!state.authenticatedUser;
  const [step, setStep] = useState(() => {
    const stored = state.onboardingStep || 0;
    return stored === 0 && hasIdentity ? FIRST_WIZARD_STEP : stored;
  }); // 0: Landing, 1: Role, 2: Nickname, 3: Space, 4: Anniversary, 5: Military, 6: Contact, 7: Complete

  // Detect iOS environment for conditional Apple Login UI
  const isIOS = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);
  // Safe fallbacks for the current production setup. Apple starts hidden and is
  // revealed only after GoTrue confirms it is enabled, preventing a dead button
  // on iPhone when the provider has not been configured yet.
  const [authProviders, setAuthProviders] = useState({
    google: true,
    apple: false,
    email: true,
  });

  useEffect(() => {
    if (step !== 0) return;
    let active = true;
    void fetchAuthProviderAvailability().then((availability) => {
      if (active && availability) setAuthProviders(availability);
    });
    return () => {
      active = false;
    };
  }, [step]);

  // Form State
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [isStartingSocialLogin, setIsStartingSocialLogin] = useState(false);
  const socialLoginInFlightRef = useRef(false);
  const [role, setRole] = useState<Role>('gomsin');
  const [nickname, setNickname] = useState('');
  const [spaceMode, setSpaceMode] = useState<'create' | 'join'>('create');
  const [createdCoupleId, setCreatedCoupleId] = useState('');
  const [createdInviteCode, setCreatedInviteCode] = useState('');
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  /** ISO expiry of the code on screen, when the server told us one. */
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  /**
   * An owned couple space with a LIVE invitation, awaiting the user's decision.
   *
   * Non-null only between discovering that space and the user choosing whether to
   * invalidate the code that may already be with their partner.
   */
  const [pendingSpaceRecovery, setPendingSpaceRecovery] = useState<
    { coupleId: string; expiresAt: string | null } | null
  >(null);
  const [joinedPartnerName, setJoinedPartnerName] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);
  const [anniversary, setAnniversary] = useState('');
  const [skipAnniversary, setSkipAnniversary] = useState(false);

  // Military Info State (Soldier only)
  const [branch, setBranch] = useState<Branch>('army');
  const [militaryStatus, setMilitaryStatus] = useState<MilitaryStatus>('serving');
  /**
   * M-1: no invented service period, on this path either.
   *
   * These two fields used to open on the same fabricated `2025-03-10` /
   * `2026-09-09` pair that `sync.ts` and `DEFAULT_STATE` were cleaned of. This
   * step tells the user it is optional ("나중에 입력 가능"), so touching nothing
   * is a supported path -- and it silently wrote those literals to
   * `profiles.military_info` with a `'calculated'` provenance, which is the very
   * claim M-1 exists to prevent. Empty until the user states a real date.
   */
  const [enlistmentDate, setEnlistmentDate] = useState('');
  const [expectedDischargeDate, setExpectedDischargeDate] = useState('');
  const [dischargeDateSource, setDischargeDateSource] = useState<DischargeDateSource>('calculated');

  // Contact Hours State (Soldier only)
  const [weekdayStart, setWeekdayStart] = useState('18:00');
  const [weekdayEnd, setWeekdayEnd] = useState('21:00');
  const [weekendStart, setWeekendStart] = useState('12:00');
  const [weekendEnd, setWeekendEnd] = useState('21:00');

  const legalGatePassed = ageConfirmed && legalAccepted;
  const requireLegalGate = () => {
    if (legalGatePassed) return true;
    toast.error(!ageConfirmed ? '만 14세 이상인지 확인해 주세요.' : '이용약관과 개인정보 처리방침에 동의해 주세요.');
    return false;
  };

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
    setPendingSpaceRecovery(null);
  }, [onboardingIdentityKey]);

  /**
   * Mirror the step into the store.
   *
   * `setOnboardingStep` existed, was exposed on the context and was read back at
   * mount (`useState(state.onboardingStep || 0)`) -- but nothing ever CALLED it,
   * so it was a dead write path and every navigation away from onboarding sent
   * the user back to step 0, including a creator who had just been shown a code.
   * Nothing about at-rest persistence changes here: authenticated browser storage
   * stays a strict device-preference whitelist.
   */
  useEffect(() => {
    setOnboardingStep(step);
  }, [step, setOnboardingStep]);

  /**
   * Leave the landing screen the moment an identity exists.
   *
   * The initial state above cannot cover this on its own: the OAuth round trip
   * resolves AFTER this component has mounted, so a visitor who signs in while the
   * landing screen is open would otherwise stay on it.
   */
  useEffect(() => {
    if (hasIdentity) setStep((current) => (current === 0 ? FIRST_WIZARD_STEP : current));
  }, [hasIdentity]);

  // Total steps based on role
  const totalSteps = role === 'gomsin' ? 4 : 6;

  // Handle Google OAuth Login
  const handleGoogleLogin = async () => {
    if (!requireLegalGate()) return;
    if (socialLoginInFlightRef.current) return;
    socialLoginInFlightRef.current = true;
    setIsStartingSocialLogin(true);
    try {
      const res = await authRepository.signInWithGoogle();
      if (res.error) toast.error(res.error);
    } finally {
      socialLoginInFlightRef.current = false;
      setIsStartingSocialLogin(false);
    }
  };

  // Handle Apple OAuth Login
  const handleAppleLogin = async () => {
    if (!requireLegalGate()) return;
    if (socialLoginInFlightRef.current) return;
    socialLoginInFlightRef.current = true;
    setIsStartingSocialLogin(true);
    try {
      const res = await authRepository.signInWithApple();
      if (res.error) toast.error(res.error);
    } finally {
      socialLoginInFlightRef.current = false;
      setIsStartingSocialLogin(false);
    }
  };

  /**
   * Recover into a couple space this account already owns.
   *
   * Reached when `create_couple_and_invitation` reports the caller is already in
   * an active couple. Before this existed the screen dead-ended on that error
   * message with no affordance of any kind, and the user could neither reach the
   * space they owned nor create a new one.
   *
   * Regenerating is mandatory rather than optional: the server holds only a hash
   * of the original code, so there is no way to display the old one.
   */
  /**
   * Mint a fresh code for a space this account already owns.
   *
   * The server holds only a hash of the previous code, so this is the only
   * possible way to obtain a usable one -- and it is why the caller has to be
   * sure the previous code is expendable.
   */
  const regenerateForExistingSpace = useCallback(async (
    identity: { key: string; generation: number },
    coupleId: string,
  ): Promise<{ ok: boolean; mintedCode: boolean }> => {
    const regenerated = await regenerateCoupleInvitation();
    if (!isCurrentIdentity(identity)) return { ok: false, mintedCode: false };
    if (regenerated.error || !regenerated.code) {
      toast.error(regenerated.error || '초대 코드를 새로 발급하지 못했어요.');
      return { ok: false, mintedCode: false };
    }

    setCreatedCoupleId(coupleId);
    setCreatedInviteCode(regenerated.code);
    // A freshly minted code is valid for 24h. Re-read the authoritative expiry
    // rather than computing one locally.
    const refreshed = await fetchMyCoupleState();
    if (!isCurrentIdentity(identity)) return { ok: true, mintedCode: true };
    setInviteExpiresAt(
      refreshed.ok && refreshed.state?.invitationActive
        ? refreshed.state.invitationExpiresAt
        : null,
    );
    toast.success('이미 만든 공간을 찾아 새 초대 코드를 발급했어요.');
    return { ok: true, mintedCode: true };
  }, [isCurrentIdentity]);

  const recoverExistingCoupleSpace = useCallback(async (
    identity: { key: string; generation: number },
  ): Promise<{ ok: boolean; mintedCode: boolean }> => {
    const lifecycleResult = await fetchMyCoupleState();
    if (!isCurrentIdentity(identity)) return { ok: false, mintedCode: false };

    if (!lifecycleResult.ok || !lifecycleResult.state?.coupleId) {
      toast.error(
        '이미 만들어진 커플 공간이 있는데 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
      return { ok: false, mintedCode: false };
    }

    const existing = lifecycleResult.state;
    if (existing.partnerPresent) {
      // Already connected: there is nothing to invite anyone to.
      setCreatedCoupleId(existing.coupleId!);
      setCreatedInviteCode('');
      setInviteExpiresAt(null);
      toast.success('이미 연결된 커플 공간을 찾았어요. 이어서 진행할게요.');
      return { ok: true, mintedCode: false };
    }

    if (existing.invitationActive) {
      /**
       * There is a LIVE invitation, which means a code may already be in the
       * partner's hands. Regenerating invalidates it (015 keeps at most one
       * unused hash), and this path used to do that unconditionally with nothing
       * but a success toast -- silently breaking a code the user had already
       * sent. The banner path always warned; this one did not.
       *
       * So it asks. Not a modal: `modalStacking.test.ts` guards bottom-anchored
       * overlays, and an inline block inside the step is both simpler and
       * reachable by the same 다음 button flow.
       */
      setPendingSpaceRecovery({
        coupleId: existing.coupleId!,
        expiresAt: existing.invitationExpiresAt,
      });
      return { ok: false, mintedCode: false };
    }

    // No outstanding invitation, so nothing can be invalidated: mint without
    // asking, exactly as before.
    return regenerateForExistingSpace(identity, existing.coupleId!);
  }, [isCurrentIdentity, regenerateForExistingSpace]);

  /** The user accepted that the previously sent code stops working. */
  const handleRegenerateExistingSpace = async () => {
    const pending = pendingSpaceRecovery;
    if (!pending || isGeneratingCode) return;
    const identity = captureIdentity();
    setIsGeneratingCode(true);
    try {
      const result = await regenerateForExistingSpace(identity, pending.coupleId);
      if (!isCurrentIdentity(identity)) return;
      if (result.ok) setPendingSpaceRecovery(null);
    } finally {
      if (isCurrentIdentity(identity)) setIsGeneratingCode(false);
    }
  };

  /**
   * The user keeps the code they already sent.
   *
   * The space is adopted so onboarding can finish against it; no code is shown,
   * because this device does not have one and the server only holds a hash. The
   * lifecycle banner offers regeneration later if the partner never arrives.
   */
  const handleKeepExistingCode = () => {
    const pending = pendingSpaceRecovery;
    if (!pending) return;
    setCreatedCoupleId(pending.coupleId);
    setCreatedInviteCode('');
    setInviteExpiresAt(pending.expiresAt);
    setPendingSpaceRecovery(null);
    toast.success('이전에 보낸 초대 코드를 그대로 사용해요. 이어서 진행할게요.');
  };

  /**
   * Whether 다음 can actually do anything from the current step.
   *
   * The button was always enabled, so on the nickname step it invited a tap and
   * then answered with an error toast. `handleNext` keeps every one of its checks
   * -- this only stops the affordance promising a step it is going to refuse,
   * which is the same rule already applied to 저장 in the composer.
   */
  const canAdvanceFromStep = step === 2 ? nickname.trim().length >= 2 : true;

  const handleNext = async () => {
    // Auth gate: step 0 cannot advance without a verified account.
    if (step === 0 && !state.authenticatedUser) {
      toast.error('Google로 로그인해 주세요.');
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
      /**
       * Did this invocation produce a code the user has not seen yet?
       *
       * If so we STAY on step 3. Previously the first tap generated the code and
       * advanced in the same handler, so the code block, its copy button and the
       * "give this to your partner" explanation were rendered and left behind
       * within one frame -- the creator never actually saw the code they now had
       * to deliver. A second tap continues.
       */
      let mintedCodeToShow = false;

      if (spaceMode === 'create' && pendingSpaceRecovery) {
        // A decision about the existing code is outstanding. Advancing would
        // either lose the space or silently invalidate the code.
        toast.error('이미 만든 공간의 초대 코드를 어떻게 할지 먼저 선택해 주세요.');
        return;
      }

      // `createdCoupleId` without a code is a real state: the user chose to keep
      // the code they already sent. Re-running creation there would raise
      // "already in an active couple" all over again.
      if (spaceMode === 'create' && !createdInviteCode && !createdCoupleId) {
        setIsGeneratingCode(true);
        try {
          const res = await createCoupleInvitation(role);
          if (!isCurrentIdentity(identity)) return;
          if (res.error || !res.coupleId || !res.code) {
            // `User already in an active couple` is not a dead end: the couple
            // space exists and this account owns it. That happens whenever
            // onboarding was abandoned after step 3, because the membership is
            // written before the `profiles` row. Recover into the existing space
            // and mint a fresh code -- the server stores only a hash, so the old
            // plaintext is unrecoverable by any other means.
            if (res.reason === 'already_in_couple') {
              const recovery = await recoverExistingCoupleSpace(identity);
              if (!isCurrentIdentity(identity)) return;
              if (!recovery.ok) return;
              mintedCodeToShow = recovery.mintedCode;
            } else {
              toast.error(res.error || '초대 코드를 생성하지 못했습니다.');
              return;
            }
          } else {
            setCreatedCoupleId(res.coupleId);
            setCreatedInviteCode(res.code);
            setInviteExpiresAt(null);
            mintedCodeToShow = true;
            toast.success('초대 코드가 생성되었습니다!');
          }
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
            // The server can report that the SESSION, not the code, is the
            // problem. Retrying the code cannot fix that, so hand the session to
            // the store's recovery instead of only showing copy about it.
            if (res.reason === 'auth_expired') void recoverExpiredSession();
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
      // Let the creator read and copy the code before moving on.
      if (mintedCodeToShow) return;
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

  const handleCopyCode = async () => {
    if (createdInviteCode) {
      try {
        await navigator.clipboard.writeText(createdInviteCode);
        setCopiedCode(true);
        toast.success('초대 코드가 클립보드에 복사되었습니다.');
        setTimeout(() => setCopiedCode(false), 2000);
      } catch {
        toast.error('코드를 복사하지 못했어요. 직접 입력해 전달해 주세요.');
      }
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
    const statesServicePeriod = role === 'soldier' && militaryStatus !== 'unknown';
    const statedEnlistment = statesServicePeriod ? enlistmentDate || undefined : undefined;
    const statedDischarge = statesServicePeriod ? expectedDischargeDate || undefined : undefined;
    const military = {
      branch,
      militaryStatus,
      enlistmentDate: statedEnlistment,
      expectedDischargeDate: statedDischarge,
      // Provenance describes a derivation that actually happened. With no
      // enlistment date there is nothing to derive from, so neither
      // 'calculated' nor 'manual' is true of the absent value.
      dischargeDateSource: statedEnlistment ? dischargeDateSource : 'unknown',
      memo: '',
    };
    const contact = { weekdayStart, weekdayEnd, weekendStart, weekendEnd, enabled: true };

    setIsFinishing(true);
    // Set when the shared anniversary row could not be written, so the success
    // path can tell the truth instead of implying the partner will see it.
    let anniversaryNotSaved = false;
    try {
      // Persist to the server FIRST. Previously the client marked onboarding as
      // complete even when the write failed, so the next login sent the user
      // straight back through onboarding.
      if (supabase && state.authenticatedUser) {
        const userId = state.authenticatedUser.id;
        // Pre-flight: a pending deletion aborts every write below before the
        // first one is issued, so onboarding cannot recreate a `profiles` row
        // for an account whose data the server has already removed.
        if (await serverCallBlockedByPendingDeletion()) return;
        if (!isCurrentIdentity(identity)) return;
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
          // Classified from the real error: an RLS or session failure must not be
          // reported as a connectivity problem.
          toast.error(`프로필을 저장하지 못했어요. ${classifyServerError(profileError).message}`);
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
            // The anniversary lives on the SHARED `couples` row, so a failure here
            // means the partner will never see it -- while the local mirror below
            // would still show it to this user. Staying silent made the app report
            // a success it had not achieved. Onboarding is not aborted (the date is
            // editable from settings), but the user is told the truth.
            anniversaryNotSaved = true;
          }
        }
      }

      if (!isCurrentIdentity(identity)) return;
      // Only now mirror it into local state.
      await updateProfile({
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
      }, { persist: false });

      if (!isCurrentIdentity(identity)) return;
      if (anniversaryNotSaved) {
        toast.warning(
          '기념일을 두 사람의 공간에 저장하지 못했어요. 설정에서 다시 입력해 주세요.',
        );
      }
      setSetupComplete(true);
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[Onboarding] Final setup failed:', error);
      toast.error(`설정을 완료하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentIdentity(identity)) setIsFinishing(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex justify-center bg-muted">
      {/*
        This frame is a deliberate copy of `MobileShell`'s -- onboarding must not
        render a tab bar -- so it also carries the Astryx theme attribute. Without
        it, every Astryx component on the wizard would fall back to Astryx's own
        blue-and-grey defaults while the rest of the app is coral, and onboarding
        is the first screen anyone sees.
      */}
      <div
        data-astryx-theme="gomsin"
        className="relative w-full max-w-[430px] min-h-screen min-h-[100dvh] bg-background shadow-[0_0_60px_-30px_rgba(27,35,64,0.18)] flex flex-col pt-[env(safe-area-inset-top,0px)]"
      >
        
        {/*
          Step Header (Steps 1~6).

          The fraction stays, and a bar joins it. "4 / 6" is precise and it is also
          arithmetic: it tells you where you are only after you work out how much is
          left. On the app's very first screens -- where someone is still deciding
          whether this is worth finishing -- how much further to go is the question
          being asked, and a filled bar answers it without being read.

          The two are not redundant. The bar is `aria-hidden` and the fraction is
          the accessible text, so a screen reader hears the exact position rather
          than a percentage, and `role="progressbar"` carries the same numbers for
          anything that prefers them.

          The counts are already role-correct: `totalSteps` is 4 for 곰신, who skip
          복무 정보 and 연락 시간, and 6 for 군화.
        */}
        {step > 0 && step < 7 && (
          <header className="border-b border-border/40 shrink-0">
            <div className="flex items-center justify-between px-4 h-14">
              <button onClick={handleBack} className="press-response p-2 -ml-2 text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="이전 단계">
                <ChevronLeft size={24} />
              </button>
              <div className="text-caption font-bold text-muted-foreground">
                {Math.min(step, totalSteps)} / {totalSteps}
              </div>
              <div className="w-10" />
            </div>
            <div
              role="progressbar"
              aria-valuenow={Math.min(step, totalSteps)}
              aria-valuemin={1}
              aria-valuemax={totalSteps}
              aria-label="온보딩 진행률"
              className="h-1 w-full bg-muted"
            >
              <div
                aria-hidden="true"
                className="onboarding-progress h-full bg-coral-strong"
                style={{ width: `${(Math.min(step, totalSteps) / totalSteps) * 100}%` }}
              />
            </div>
          </header>
        )}

        <main className="flex-1 overflow-y-auto px-6 py-6 flex flex-col justify-between">
          
          {/* STEP 0: Landing / Login Selection */}
          {step === 0 && (
            /*
              Centred, not spread.

              `justify-between` was right when this screen carried three sign-in
              routes and a magic-link field. With one route left it pushed the
              wordmark to the ceiling and the consent box to the floor with a hand's
              width of nothing between them -- the same void that made a two-record
              conversation read as broken. The content is short now, so it should
              look short rather than stretched to fill.
            */
            <div className="flex-1 flex flex-col justify-center gap-8 py-6">
              {/*
                One sentence, and it names the PROBLEM rather than the category.

                This opened with two lines that said roughly the same thing, and the
                one doing the work -- "답장이 늦어도" -- was the subtitle. "군화와
                곰신, 둘만의 하루를 사진과 짧은 기록으로 남겨요" describes a diary
                app; every couple app could print it. What someone recognises
                themselves in is the asymmetry: one person can reply now and the
                other cannot, so the day gets lost between them. That is the line
                that belongs at the top.
              */}
              <div className="text-center space-y-3">
                <div className="flex justify-center mb-3">
                  <CoupleAvatar size={84} />
                </div>
                <h1 className="text-display tracking-tight text-foreground">곰신로그</h1>
                <p className="text-muted-foreground text-body font-medium leading-relaxed break-keep">
                  답장이 늦어도, 서로의 하루는 놓치지 않도록.
                </p>

                {/*
                  What signing in actually commits you to.

                  A first-run visitor could not tell from this screen that the app
                  needs a PARTNER -- they signed in, met a role picker, and only
                  discovered at step 3 that the thing is unusable alone. Three lines
                  is enough to set that expectation before the decision, and it is a
                  real sequence, so it is numbered.
                */}
                <ol className="pt-2 mx-auto w-fit text-left space-y-1.5">
                  {['역할과 닉네임을 고르고', '상대를 초대하면', '둘만의 공간이 열려요'].map(
                    (line, index) => (
                      <li key={line} className="flex items-center gap-2 text-caption text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="w-5 h-5 shrink-0 rounded-full bg-muted text-foreground font-bold flex items-center justify-center tabular-nums"
                        >
                          {index + 1}
                        </span>
                        {line}
                      </li>
                    ),
                  )}
                </ol>
              </div>

              <div className="space-y-3">
                {/*
                  A failed Google sign-in lands HERE, not on /auth/callback.

                  GoTrue sends a successful exchange to the requested `redirect_to`
                  and a failed one to the project's Site URL, which is the app root --
                  measured on the live project as
                  `?error=invalid_request&error_code=bad_oauth_state`. `AuthCallbackPage`
                  reads those parameters correctly and never sees them, so before this
                  the user was dropped back on this screen with no message: the app
                  looked like it had ignored the attempt.
                */}
                {authUrlError ? (
                  <div
                    role="alert"
                    className="rounded-control border border-destructive/30 bg-destructive/10 px-3 py-2.5"
                  >
                    <p className="text-label font-semibold text-destructive break-keep">
                      {authUrlError.message}
                    </p>
                  </div>
                ) : null}

                {/*
                  Consent BEFORE the buttons, not under them.

                  Korean law requires the age check and the terms agreement before an
                  account exists, so this cannot be deferred -- but it used to sit
                  BELOW three enabled-looking sign-in buttons. Tapping one with the
                  boxes unticked did nothing except raise a toast at the edge of the
                  screen, which on a first run reads as the app being broken rather
                  than as a step being missed. Putting the requirement first, and
                  marking the buttons while it is unmet, means the control never
                  claims it will do something it will not.
                */}
                <div className="rounded-control border border-border bg-muted/40 p-3 space-y-2">
                  <label className="flex items-start gap-2 text-caption text-foreground leading-relaxed min-h-11">
                    <input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} className="mt-1 accent-coral" />
                    <span><strong>[필수]</strong> 만 14세 이상입니다.</span>
                  </label>
                  <label className="flex items-start gap-2 text-caption text-foreground leading-relaxed min-h-11">
                    <input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} className="mt-1 accent-coral" />
                    <span>
                      <strong>[필수]</strong>{' '}
                      <a href="/legal/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2">서비스 이용약관</a>
                      {' 및 '}
                      <a href="/legal/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">개인정보 처리방침</a>
                      을 확인하고 동의합니다.
                    </span>
                  </label>
                </div>

                {/*
                  `aria-disabled`, not `disabled`.

                  A truly disabled button drops out of the tab order, so a keyboard or
                  screen-reader user meets a control that is simply absent and is told
                  nothing about why. This one stays reachable and still fires, and the
                  handler's existing gate raises the message naming which box is
                  missing -- so the explanation is available to everyone by the same
                  action, rather than only to people who can see it greyed out.
                */}
                {!legalGatePassed && (
                  <p id="legal-gate-reason" className="text-caption text-muted-foreground text-center break-keep">
                    위 두 항목에 동의하면 로그인할 수 있어요.
                  </p>
                )}

                {/* Primary Auth CTAs */}
                {isIOS && authProviders.apple && (
                  <button
                    onClick={handleAppleLogin}
                    disabled={isStartingSocialLogin}
                    aria-disabled={!legalGatePassed}
                    aria-describedby={legalGatePassed ? undefined : 'legal-gate-reason'}
                    className={`press-response-row w-full h-13 py-3.5 rounded-control bg-black text-white font-bold text-label flex items-center justify-center gap-2 min-h-[48px] disabled:opacity-60 ${legalGatePassed ? '' : 'opacity-50'}`}
                  >
                    <span>{isStartingSocialLogin ? '로그인 연결 중...' : 'Apple로 계속하기'}</span>
                  </button>
                )}

                {authProviders.google && (
                  <button
                    onClick={handleGoogleLogin}
                    disabled={isStartingSocialLogin}
                    aria-disabled={!legalGatePassed}
                    aria-describedby={legalGatePassed ? undefined : 'legal-gate-reason'}
                    className={`press-response-row w-full h-13 py-3.5 rounded-control bg-card border border-border text-foreground font-bold text-label flex items-center justify-center gap-2 min-h-[48px] disabled:opacity-60 ${legalGatePassed ? '' : 'opacity-50'}`}
                  >
                    <span>{isStartingSocialLogin ? '로그인 연결 중...' : 'Google로 계속하기'}</span>
                  </button>
                )}

                {/* `email` is deliberately absent: a provider the screen does not
                    offer must not count as a way in, or a project configured for
                    email alone would show no button and no explanation either. */}
                {!authProviders.google && !authProviders.apple && (
                  <p role="alert" className="text-caption text-destructive text-center font-semibold">
                    현재 사용할 수 있는 로그인 방법을 확인하지 못했어요. 잠시 후 다시 열어 주세요.
                  </p>
                )}

              </div>
            </div>
          )}

          {/* STEP 1: Role Selection */}
          {step === 1 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-title">곰신로그를 어떻게 사용할까요?</h2>
                  <p className="text-body text-muted-foreground mt-1">역할에 따라 맞춤 기능이 제공돼요.</p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => setRole('gomsin')}
                    className={`press-response-row w-full p-5 rounded-surface border text-left flex items-start gap-4 min-h-[80px] ${
                      role === 'gomsin'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <span className="text-display">🌸</span>
                    <div className="flex-1">
                      <div className="text-heading text-foreground">나는 곰신이에요</div>
                      <div className="text-caption text-muted-foreground mt-1">하루의 순간을 편하게 남길게요</div>
                    </div>
                  </button>

                  <button
                    onClick={() => setRole('soldier')}
                    className={`press-response-row w-full p-5 rounded-surface border text-left flex items-start gap-4 min-h-[80px] ${
                      role === 'soldier'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <span className="text-display">🪖</span>
                    <div className="flex-1">
                      <div className="text-heading text-foreground">나는 군화예요</div>
                      <div className="text-caption text-muted-foreground mt-1">연인의 오늘을 놓치지 않고 볼게요</div>
                    </div>
                  </button>
                </div>
              </div>

              <Button variant="primary" size="lg" full
                onClick={handleNext}>
                다음
              </Button>
            </div>
          )}

          {/* STEP 2: Nickname */}
          {step === 2 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-title">어떻게 불러드리면 될까요?</h2>
                  <p className="text-body text-muted-foreground mt-1">상대에게 보이는 이름이에요. 실명이 아니어도 괜찮아요.</p>
                </div>

                <div className="space-y-2">
                  {/*
                    `htmlFor`/`id`, which this pair did not have.

                    The label was floating text next to a field, so a screen reader
                    announced an unnamed edit box -- on the only step of the wizard
                    that asks the user to type something. Tapping the label did
                    nothing either.
                  */}
                  <label htmlFor="onboarding-nickname" className="text-label font-semibold text-muted-foreground">
                    내 닉네임 (2~12자)
                  </label>
                  <input
                    id="onboarding-nickname"
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    /*
                      This step has exactly one field and nothing else to decide, so
                      arriving with it unfocused costs a tap and a keyboard-open
                      before anyone can answer. Focusing it also raises the keyboard,
                      which is what fills the gap this step otherwise leaves between
                      the field and the button.
                    */
                    autoFocus
                    /*
                      The phone keyboard's action key now says 다음 and does what it
                      says. Without this it read 완료 and did nothing at all, so the
                      keyboard had to be dismissed before the real button was
                      reachable.
                    */
                    enterKeyHint="next"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canAdvanceFromStep) {
                        e.preventDefault();
                        void handleNext();
                      }
                    }}
                    aria-invalid={nickname.trim().length > 0 && nickname.trim().length < 2}
                    aria-describedby={
                      nickname.trim().length > 0 && nickname.trim().length < 2
                        ? 'onboarding-nickname-error'
                        : undefined
                    }
                    placeholder={role === 'gomsin' ? '예) 춘향' : '예) 몽룡'}
                    maxLength={12}
                    className="w-full h-13 px-4 rounded-control bg-card border border-border text-body outline-none focus:ring-2 focus:ring-coral/40"
                  />
                  {nickname.trim().length > 0 && nickname.trim().length < 2 && (
                    <p id="onboarding-nickname-error" className="text-caption text-destructive font-medium">
                      닉네임은 2자 이상 입력해주세요.
                    </p>
                  )}
                </div>
              </div>

              <Button variant="primary" size="lg" full
                onClick={handleNext}
                disabled={!canAdvanceFromStep}>
                다음
              </Button>
            </div>
          )}

          {/* STEP 3: Couple Space */}
          {step === 3 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-title">우리 둘만의 로그를 시작해볼까요?</h2>
                  <p className="text-body text-muted-foreground mt-1">커플 공간을 만들거나 이미 있는 공간에 참여하세요.</p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => setSpaceMode('create')}
                    className={`press-response-row w-full p-5 rounded-surface border text-left flex items-start gap-4 min-h-[72px] ${
                      spaceMode === 'create'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="text-heading text-foreground">새로운 우리 공간 만들기</div>
                      <div className="text-caption text-muted-foreground mt-1">먼저 시작하고, 상대방을 초대할게요</div>
                    </div>
                  </button>

                  {/* An owned space with a LIVE invitation. Regenerating would
                      invalidate a code that may already be with the partner, so
                      the choice belongs to the user, not to the recovery path. */}
                  {spaceMode === 'create' && pendingSpaceRecovery && (
                    <div
                      data-testid="space-recovery-confirm"
                      className="p-4 bg-card border border-coral/30 rounded-surface space-y-3"
                    >
                      <p className="text-label font-bold text-foreground">
                        이미 만든 우리 공간이 있어요
                      </p>
                      <p className="text-caption text-muted-foreground">
                        아직 사용할 수 있는 초대 코드가 남아 있어요
                        {pendingSpaceRecovery.expiresAt
                          && invitationExpiryLabel(pendingSpaceRecovery.expiresAt)
                          ? ` (${invitationExpiryLabel(pendingSpaceRecovery.expiresAt)})`
                          : ''}
                        . 보안을 위해 서버에는 코드가 저장되지 않아서 이 기기에서는 다시
                        보여줄 수 없어요. 새 코드를 발급하면 이전에 보낸 코드는 사용할 수
                        없게 돼요.
                      </p>
                      <Button variant="primary" full
                onClick={() => void handleRegenerateExistingSpace()}
                        disabled={isGeneratingCode}>
                        {isGeneratingCode ? '발급 중...' : '새 코드 발급하기'}
                      </Button>
                      <button
                        type="button"
                        onClick={handleKeepExistingCode}
                        disabled={isGeneratingCode}
                        className="press-response-row w-full min-h-[44px] rounded-control border border-border px-4 text-label font-bold text-foreground disabled:opacity-50"
                      >
                        이전에 보낸 코드 그대로 쓰기
                      </button>
                    </div>
                  )}

                  {spaceMode === 'create' && createdInviteCode && (
                    <div className="p-4 bg-coral/10 border border-coral/30 rounded-surface space-y-2">
                      <div className="text-caption text-coral-strong font-semibold">
                        내 초대 코드 (24시간 유효)
                        {/* The authoritative expiry, when the server supplied one.
                            "24시간 유효" alone told the user nothing about the
                            actual deadline. */}
                        {inviteExpiresAt && invitationExpiryLabel(inviteExpiresAt) && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            · {invitationExpiryLabel(inviteExpiresAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between bg-card px-4 py-3 rounded-control border border-coral/20">
                        <span className="font-mono text-display tracking-widest text-foreground">{createdInviteCode}</span>
                        <button
                          onClick={handleCopyCode}
                          // Icon-only control: `title` alone is not an accessible
                          // name on touch devices, where it never surfaces.
                          aria-label="초대 코드 복사"
                          className="press-response min-h-[44px] min-w-[44px] flex items-center justify-center text-coral hover:bg-coral/10 rounded-lg"
                          title="코드 복사"
                        >
                          {copiedCode ? <Check size={20} /> : <Copy size={20} />}
                        </button>
                      </div>
                      <p className="text-caption text-muted-foreground text-center">
                        상대방이 앱을 설치하고 [초대 코드가 있어요] 메뉴에 위 코드를 입력하면 1:1 커플 공간이 연결됩니다.
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => setSpaceMode('join')}
                    className={`press-response-row w-full p-5 rounded-surface border text-left flex items-start gap-4 min-h-[72px] ${
                      spaceMode === 'join'
                        ? 'border-coral bg-coral/10 ring-2 ring-coral/40'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="text-heading text-foreground">초대 코드가 있어요</div>
                      <div className="text-caption text-muted-foreground mt-1">상대가 만든 우리 공간에 들어갈게요</div>
                    </div>
                  </button>

                  {/* The code-entry field is rendered ONLY in join mode. A creator
                      must never be offered it: `redeem_invitation` rejects their
                      own code as `self_invitation`, so showing the field can only
                      produce a confusing failure. */}
                  {spaceMode === 'join' && (
                    <div className="pt-2 space-y-2">
                      <input
                        type="text"
                        value={inviteCodeInput}
                        onChange={(e) => setInviteCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        /*
                          Six digits and then done. The keyboard's action key
                          submits rather than sitting over the button the user then
                          has to dismiss it to reach -- and a six-digit code is
                          exactly the case where someone types the last digit and
                          expects it to go.
                        */
                        enterKeyHint="done"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isGeneratingCode && !isVerifyingCode) {
                            e.preventDefault();
                            void handleNext();
                          }
                        }}
                        placeholder="숫자 6자리 초대 코드"
                        aria-label="숫자 6자리 초대 코드"
                        className="w-full h-12 px-4 rounded-control bg-card border border-border text-foreground font-mono text-center text-title tracking-widest outline-none focus:ring-2 focus:ring-coral/40"
                      />
                    </div>
                  )}
                </div>
              </div>

              <Button variant="primary" size="lg" full
                onClick={handleNext}
                disabled={isGeneratingCode || isVerifyingCode}>
                {isGeneratingCode || isVerifyingCode ? (
                  <>
                    <div className="w-5 h-5 border-2 border-coral-foreground border-t-transparent rounded-full animate-spin" />
                    <span>처리 중...</span>
                  </>
                ) : (
                  <span>다음</span>
                )}
              </Button>
            </div>
          )}

          {/* STEP 4: Anniversary Date */}
          {step === 4 && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-title">둘은 언제부터 함께였나요?</h2>
                  <p className="text-body text-muted-foreground mt-1">정확하지 않아도 괜찮아요. 나중에 우리 탭에서 바꿀 수 있어요.</p>
                </div>

                {!skipAnniversary ? (
                  <div className="space-y-2">
                    <label className="text-label font-semibold text-muted-foreground">사귄 날짜</label>
                    <input
                      type="date"
                      value={anniversary}
                      onChange={(e) => setAnniversary(e.target.value)}
                      className="w-full h-13 px-4 rounded-control bg-card border border-border text-body outline-none"
                    />
                  </div>
                ) : (
                  <div className="p-4 bg-muted/40 rounded-surface text-caption text-muted-foreground text-center">
                    사귄 날짜는 나중에 언제든지 설정할 수 있습니다.
                  </div>
                )}

                <button
                  onClick={() => setSkipAnniversary(!skipAnniversary)}
                  className="press-response text-label text-coral-strong font-semibold underline min-h-[36px]"
                >
                  {skipAnniversary ? '사귄 날짜 입력하기' : '아직 정확히 기억나지 않아요'}
                </button>
              </div>

              <Button variant="primary" size="lg" full
                onClick={handleNext}>
                {role === 'gomsin' ? '완료' : '다음'}
              </Button>
            </div>
          )}

          {/* STEP 5: Military Info (Soldier ONLY) */}
          {step === 5 && role === 'soldier' && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-title">복무 정보를 알려주세요.</h2>
                  <p className="text-body text-muted-foreground mt-1">전역 D-Day 및 복무 진행률에 사용돼요. (나중에 입력 가능)</p>
                </div>

                <div className="space-y-4">
                  {/* Status */}
                  <div>
                    <label className="text-label font-semibold text-muted-foreground">현재 복무 상태</label>
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
                          className={`press-response py-2 px-2 rounded-control text-label font-semibold border transition min-h-11 ${
                            militaryStatus === st.key ? 'bg-coral-fill text-coral-fill-foreground border-coral-strong' : 'bg-card border-border text-muted-foreground'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Branch */}
                  <div>
                    <label className="text-label font-semibold text-muted-foreground">군종 선택</label>
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
                          className={`press-response py-2 px-1 rounded-control text-label font-semibold border transition min-h-11 ${
                            branch === b.key ? 'bg-coral-fill text-coral-fill-foreground border-coral-strong' : 'bg-card border-border text-muted-foreground'
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Enlistment date */}
                  <div>
                    <label className="text-label font-semibold text-muted-foreground">입대일 / 입대 예정일</label>
                    <input
                      type="date"
                      value={enlistmentDate}
                      onChange={(e) => handleEnlistmentChange(e.target.value)}
                      className="w-full h-11 px-3 mt-1 rounded-control bg-card border border-border text-body outline-none"
                    />
                  </div>

                  {/* Expected Discharge */}
                  <div>
                    <label className="text-label font-semibold text-muted-foreground">예상 전역일 (자동 계산 / 수동 수정 가능)</label>
                    <input
                      type="date"
                      value={expectedDischargeDate}
                      onChange={(e) => handleManualDischargeChange(e.target.value)}
                      className="w-full h-11 px-3 mt-1 rounded-control bg-card border border-border text-body outline-none"
                    />
                  </div>
                </div>
              </div>

              <Button variant="primary" size="lg" full
                onClick={handleNext}>
                다음
              </Button>
            </div>
          )}

          {/* STEP 6: Contact Hours (Soldier ONLY) */}
          {step === 6 && role === 'soldier' && (
            <div className="flex-1 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <div>
                  <h2 className="text-title">주로 언제 오늘의 로그를 확인할 수 있나요?</h2>
                  <p className="text-body text-muted-foreground mt-1">상대의 로그 표시 및 부드러운 확인 안내용입니다.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-label font-semibold text-muted-foreground">평일 확인 가능 시간</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="time"
                        value={weekdayStart}
                        onChange={(e) => setWeekdayStart(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-control bg-card border border-border text-body outline-none"
                      />
                      <span>~</span>
                      <input
                        type="time"
                        value={weekdayEnd}
                        onChange={(e) => setWeekdayEnd(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-control bg-card border border-border text-body outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-label font-semibold text-muted-foreground">주말·휴일 확인 가능 시간</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="time"
                        value={weekendStart}
                        onChange={(e) => setWeekendStart(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-control bg-card border border-border text-body outline-none"
                      />
                      <span>~</span>
                      <input
                        type="time"
                        value={weekendEnd}
                        onChange={(e) => setWeekendEnd(e.target.value)}
                        className="flex-1 h-11 px-3 rounded-control bg-card border border-border text-body outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Button variant="primary" size="lg" full
                onClick={handleNext}>
                  완료하기
                </Button>
                <button
                  onClick={handleNext}
                  className="press-response-row w-full py-3 text-label text-muted-foreground font-medium text-center min-h-[36px]"
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
                <div className="w-20 h-20 bg-coral/15 rounded-full flex items-center justify-center mx-auto text-display">
                  {role === 'gomsin' ? '🌸' : '🪖'}
                </div>
                <h2 className="text-title text-foreground">
                  우리 둘만의 곰신로그가 준비됐어요.
                </h2>
                <p className="text-body text-muted-foreground">
                  {role === 'gomsin'
                    ? '오늘부터 편하게 하루의 순간을 남겨보세요.'
                    : '곰신이 남긴 오늘 하루를 놓치지 않고 따라잡아볼까요?'}
                </p>
              </div>

              <Button variant="primary" size="lg" full
                onClick={finishSetup}
                disabled={isFinishing}>
                {isFinishing
                  ? '저장 중...'
                  : role === 'gomsin'
                    ? '오늘의 첫 순간 남기기'
                    : '오늘의 로그 기다리기'}
              </Button>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
