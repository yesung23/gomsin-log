import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/useStore';
import { invitationExpiryLabel } from '@/lib/coupleLifecycle';
import { classifyServerError } from '@/lib/serverErrors';
import { MobileShell } from '@/components/MobileShell';
import {
  ArrowLeft, Shield, Unlink, Trash2, User, FileText,
  Clock, LogOut, Smartphone, AlertTriangle, ChevronRight,
  Sun, Moon, Copy, Check, RefreshCw, Download,
  CalendarDays, Plane,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RowGroup, PressableRow, SectionHeader } from '@/components/ui/List';
import {
  consumeCoupleInvitation,
  createCoupleInvitation,
  regenerateCoupleInvitation,
  supabase,
} from '@/lib/supabase';
import { useEscapeKey } from '@/lib/hooks';
import { buildPersonalExport } from '@/lib/dataExport';
import { DeviceProtectionSection } from '@/components/DeviceProtectionSection';

export function SettingsPage() {
  const {
    state,
    updateProfile,
    disconnect,
    deleteAccount,
    signOut,
    deleteRecord,
    setTheme,
    invitationExpiresAt,
    refreshCoupleLifecycle,
    recoverExpiredSession,
  } = useStore();
  const navigate = useNavigate();
  const { profile, records } = state;
  const settingsIdentityKey = state.authenticatedUser?.id || '';
  const identityRef = useRef(settingsIdentityKey);
  const identityGenerationRef = useRef(0);
  const instanceActiveRef = useRef(true);
  if (identityRef.current !== settingsIdentityKey) {
    identityRef.current = settingsIdentityKey;
    identityGenerationRef.current += 1;
  }
  const captureIdentity = useCallback(
    () => ({ userId: settingsIdentityKey, generation: identityGenerationRef.current }),
    [settingsIdentityKey],
  );
  const isCurrentIdentity = useCallback(
    (identity: { userId: string; generation: number }) =>
      instanceActiveRef.current
      && identity.userId === identityRef.current
      && identity.generation === identityGenerationRef.current,
    [],
  );
  const myName = profile.myName || '나';
  const partnerName = profile.couple.partnerName || '상대방';
  const roleLabel = profile.role === 'gomsin' ? '곰신' : '군화';
  const ownRecords = records.filter((record) => record.userId === settingsIdentityKey);
  const hasCoupleSpace = !!profile.couple.coupleId;

  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showDeleteRecordsModal, setShowDeleteRecordsModal] = useState(false);
  const [showPWAModal, setShowPWAModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDeletingRecords, setIsDeletingRecords] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [isJoiningCouple, setIsJoiningCouple] = useState(false);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editName, setEditName] = useState(profile.myName);
  const [editAnniversary, setEditAnniversary] = useState(profile.couple.anniversaryDate || '');

  useEscapeKey(() => {
    if (showDeleteAccountModal) {
      if (isDeletingAccount) return;
      setShowDeleteAccountModal(false);
      setDeleteAccountConfirmation('');
    } else if (showDeleteRecordsModal) {
      if (!isDeletingRecords) setShowDeleteRecordsModal(false);
    } else if (showDisconnectModal) {
      if (!isDisconnecting) setShowDisconnectModal(false);
    } else if (showPWAModal) {
      setShowPWAModal(false);
    } else if (showProfileModal) {
      if (!isSavingProfile) setShowProfileModal(false);
    }
  }, showDeleteAccountModal || showDeleteRecordsModal || showDisconnectModal || showPWAModal || showProfileModal);

  useLayoutEffect(() => {
    instanceActiveRef.current = true;
    return () => {
      instanceActiveRef.current = false;
      identityGenerationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    setInviteCodeInput('');
    setIsJoiningCouple(false);
  }, [settingsIdentityKey]);

  /**
   * Export the records this user authored as a JSON file.
   * Runs entirely on the device, using the authenticated state already loaded.
   */
  const handleExportMyData = () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      if (!settingsIdentityKey) throw new Error('No authenticated account to export.');
      const payload = buildPersonalExport(state, settingsIdentityKey);

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gomsinlog-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('내 데이터 목록을 JSON 파일로 내보냈어요.');
    } catch (error) {
      console.error('[gomsinlog] Export failed:', error);
      toast.error('내보내기에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveProfile = async () => {
    if (isSavingProfile) return;
    const nextName = editName.trim();
    if (nextName.length < 2 || nextName.length > 12) {
      toast.error('닉네임은 2~12자로 입력해 주세요.');
      return;
    }
    const identity = captureIdentity();
    setIsSavingProfile(true);
    try {
      const saved = await updateProfile({
        myName: nextName,
        couple: { ...profile.couple, anniversaryDate: editAnniversary || undefined },
      });
      if (!isCurrentIdentity(identity)) return;
      if (!saved) {
        toast.error('프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setShowProfileModal(false);
      toast.success('프로필이 저장되었습니다.');
    } finally {
      if (isCurrentIdentity(identity)) setIsSavingProfile(false);
    }
  };

  /**
   * Create a fresh couple space from Settings.
   *
   * This affordance was missing entirely. `createCoupleInvitation` had exactly one
   * caller -- the onboarding wizard -- so once onboarding was finished there was no
   * way back to it. Meanwhile `CoupleStatusBanner` told a `personal` user "우리
   * 공간을 만들거나 초대 코드를 입력해 보세요" and a `disconnected` user "다시
   * 연결하려면 새 공간을 만들거나..." and sent both here, where only a join form
   * existed. A user who disconnected could therefore never create a space again --
   * they could only join a code someone else minted.
   */
  const handleCreateCoupleSpace = async () => {
    if (isCreatingSpace) return;
    const identity = captureIdentity();
    if (!identity.userId) {
      toast.error('로그인한 계정에서만 커플 공간을 만들 수 있어요.');
      return;
    }

    setIsCreatingSpace(true);
    try {
      const result = await createCoupleInvitation(profile.role);
      if (!isCurrentIdentity(identity)) return;
      if (result.error || !result.coupleId || !result.code) {
        toast.error(result.error || '커플 공간을 만들지 못했어요.');
        return;
      }
      await updateProfile({
        couple: {
          ...profile.couple,
          coupleId: result.coupleId,
          coupleCode: result.code,
          connected: false,
          status: 'pending',
          partnerName: '',
        },
      });
      if (!isCurrentIdentity(identity)) return;
      // Pull the authoritative expiry for the code just minted, so the section
      // above can show a real deadline instead of only "24시간 동안 유효".
      void refreshCoupleLifecycle();
      toast.success('우리 공간을 만들었어요. 초대 코드를 상대방에게 전달해 주세요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[Settings] Couple space creation failed:', error);
      toast.error(`커플 공간을 만들지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentIdentity(identity)) setIsCreatingSpace(false);
    }
  };

  const handleJoinCouple = async () => {
    if (isJoiningCouple) return;
    const identity = captureIdentity();
    if (!identity.userId) {
      toast.error('로그인한 계정에서만 커플 공간에 연결할 수 있어요.');
      return;
    }
    const code = inviteCodeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      toast.error('6자리 초대 코드를 입력해 주세요.');
      return;
    }

    setIsJoiningCouple(true);
    try {
      const result = await consumeCoupleInvitation(code);
      if (!isCurrentIdentity(identity)) return;
      if (result.error || !result.coupleId) {
        // An unusable session is not a code problem: route it to the store's
        // single-flight session recovery rather than asking for another attempt.
        if (result.reason === 'auth_expired') void recoverExpiredSession();
        toast.error(result.error || '커플 공간에 연결하지 못했습니다.');
        return;
      }

      let nextRole = profile.role;
      let partnerName = '파트너';
      try {
        const [membershipResult, partnerResult] = await Promise.all([
          supabase
            ? supabase
                .from('couple_members')
                .select('role')
                .eq('user_id', identity.userId)
                .eq('status', 'active')
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase
            ? supabase.rpc('get_partner_profile')
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (!isCurrentIdentity(identity)) return;
        if (membershipResult.error) {
          console.error('[Settings] Membership lookup failed:', membershipResult.error);
        } else if (membershipResult.data?.role) {
          nextRole = membershipResult.data.role;
        }
        if (partnerResult.error) {
          console.error('[Settings] Partner profile lookup failed:', partnerResult.error);
        } else if (partnerResult.data?.[0]?.display_name) {
          partnerName = partnerResult.data[0].display_name;
        }
      } catch (error) {
        if (!isCurrentIdentity(identity)) return;
        // Redemption already succeeded; keep explicit safe fallbacks if enrichment failed.
        console.error('[Settings] Couple membership enrichment failed:', error);
      }

      if (!isCurrentIdentity(identity)) return;
      const profileMirrored = await updateProfile({
        role: nextRole,
        couple: {
          ...profile.couple,
          coupleId: result.coupleId,
          coupleCode: '',
          connected: true,
          status: 'active',
          partnerName,
        },
      });
      if (!profileMirrored) {
        toast.error('연결은 완료됐지만 프로필 동기화에 실패했어요. 화면을 새로고침해 주세요.');
        return;
      }
      if (!isCurrentIdentity(identity)) return;
      setInviteCodeInput('');
      toast.success('우리 공간에 연결되었습니다.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[Settings] Couple join failed:', error);
      toast.error('커플 공간에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsJoiningCouple(false);
    }
  };

  return (
    <MobileShell>
      <div className="pb-28 px-5 pt-8 space-y-6">
        {/* Header with Back Button */}
        <header className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-control hover:bg-muted text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95 transition"
            aria-label="뒤로가기"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-title text-foreground">설정</h1>
          <div className="w-8" />
        </header>

        {/* User Profile Overview */}
        <section className="flex items-center gap-3 py-2">
          <div className="w-11 h-11 rounded-full bg-coral/20 text-coral-strong font-bold flex items-center justify-center text-heading">
            {profile.role === 'gomsin' ? '🌸' : '🪖'}
          </div>
          <div>
            <h2 className="text-heading text-foreground">{myName}님 ({roleLabel})</h2>
            <p className="text-caption text-muted-foreground mt-0.5">
              {profile.couple.connected
                ? `파트너 ${partnerName}님과 연결됨`
                : hasCoupleSpace
                  ? '상대방 참여 대기 중'
                  : '개인 모드 이용 중'}
            </p>
          </div>
        </section>

        <DeviceProtectionSection
          state="UNAVAILABLE"
          errorMessage="보호 설정을 실제로 시작하려면 이 기기의 보안 저장소 연결이 먼저 필요해요. 현재는 설정 상태만 안전하게 보류하고 있어요."
        />

        <section className="space-y-2">
          <h2 className="text-heading text-foreground">화면 테마</h2>
          <div className="grid grid-cols-2 gap-2 rounded-surface bg-muted p-1.5">
            <button
              type="button"
              onClick={() => setTheme('light')}
              aria-pressed={(state.theme || 'light') === 'light'}
              className={`h-11 rounded-control text-label font-bold flex items-center justify-center gap-2 transition ${
                (state.theme || 'light') === 'light'
                  ? 'bg-card text-coral'
                  : 'text-muted-foreground'
              }`}
            >
              <Sun size={16} />
              라이트
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              aria-pressed={state.theme === 'dark'}
              className={`h-11 rounded-control text-label font-bold flex items-center justify-center gap-2 transition ${
                state.theme === 'dark'
                  ? 'bg-card text-coral'
                  : 'text-muted-foreground'
              }`}
            >
              <Moon size={16} />
              다크
            </button>
          </div>
        </section>

        {/* Invite code for the space creator, until the partner actually joins. */}
        {hasCoupleSpace && !profile.couple.connected && (
          <section className="rounded-surface bg-card border border-coral/30 p-4 space-y-3">
            <div>
              <h2 className="text-heading text-foreground">우리 공간 초대 코드</h2>
              <p className="text-caption text-muted-foreground mt-1">
                상대방이 앱에서 이 코드를 입력하면 두 사람의 공간이 연결됩니다. 코드는 24시간 동안 유효해요.
                {invitationExpiryLabel(invitationExpiresAt) && (
                  <span data-testid="settings-invitation-expiry" className="font-semibold text-foreground">
                    {' '}({invitationExpiryLabel(invitationExpiresAt)})
                  </span>
                )}
              </p>
            </div>

            {profile.couple.coupleCode ? (
              <div className="flex items-center justify-between bg-muted px-4 py-3 rounded-surface border border-border">
                <span className="font-mono text-display tracking-[0.2em] text-foreground">
                  {profile.couple.coupleCode}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(profile.couple.coupleCode);
                      setCopiedInvite(true);
                      toast.success('초대 코드를 복사했어요.');
                      setTimeout(() => setCopiedInvite(false), 2000);
                    } catch {
                      toast.error('복사에 실패했어요. 코드를 직접 입력해 주세요.');
                    }
                  }}
                  aria-label="초대 코드 복사"
                  className="p-2 text-coral hover:bg-coral/10 rounded-control transition min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  {copiedInvite ? <Check size={20} /> : <Copy size={20} />}
                </button>
              </div>
            ) : (
              <p className="text-caption text-warning-foreground bg-warning-surface border border-warning/30 rounded-surface p-3 leading-relaxed">
                이 기기에 저장된 초대 코드가 없습니다. 보안을 위해 서버에는 코드 원본을 저장하지 않으므로,
                아래에서 새 코드를 발급해 상대방에게 전달해 주세요.
              </p>
            )}

            <button
              type="button"
              onClick={async () => {
                if (isRegenerating) return;
                setIsRegenerating(true);
                const result = await regenerateCoupleInvitation();
                setIsRegenerating(false);
                if (result.error || !result.code) {
                  toast.error(result.error || '초대 코드를 재발급하지 못했습니다.');
                  return;
                }
                await updateProfile({
                  couple: { ...profile.couple, coupleCode: result.code },
                });
                void refreshCoupleLifecycle();
                toast.success('새 초대 코드가 발급되었습니다. 이전 코드는 더 이상 사용할 수 없어요.');
              }}
              disabled={isRegenerating}
              className="w-full h-11 rounded-control border border-coral/40 text-coral-strong text-label font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={15} className={isRegenerating ? 'animate-spin' : undefined} />
              {isRegenerating ? '발급 중...' : '새 초대 코드 발급하기'}
            </button>
          </section>
        )}

        {!hasCoupleSpace && (
          <section className="rounded-surface bg-card border border-coral/30 p-4 space-y-3">
            <div>
              <h2 className="text-heading text-foreground">우리 공간 연결하기</h2>
              <p className="text-caption text-muted-foreground mt-1">
                상대방 화면에 표시된 6자리 초대 코드를 입력하세요.
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={inviteCodeInput}
              onChange={(event) =>
                setInviteCodeInput(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="6자리 초대 코드"
              aria-label="6자리 초대 코드"
              className="w-full h-11 px-4 rounded-control bg-background border border-border text-body tracking-[0.3em] outline-none focus:ring-2 focus:ring-coral/40"
            />
            <button
              type="button"
              onClick={handleJoinCouple}
              disabled={isJoiningCouple || inviteCodeInput.length !== 6}
              className="w-full h-12 rounded-control bg-coral-fill text-coral-fill-foreground text-label font-bold disabled:opacity-50"
            >
              {isJoiningCouple ? '연결 중...' : '초대 코드로 연결하기'}
            </button>

            <div className="flex items-center gap-3 pt-1">
              <span className="h-px flex-1 bg-border" />
              <span className="text-caption text-muted-foreground">또는</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <p className="text-caption text-muted-foreground">
              내가 공간을 만들고 상대방을 초대할 수도 있어요.
            </p>
            <button
              type="button"
              onClick={handleCreateCoupleSpace}
              disabled={isCreatingSpace || isJoiningCouple}
              className="w-full h-11 rounded-control border border-coral/40 text-coral-strong text-label font-bold disabled:opacity-50"
            >
              {isCreatingSpace ? '만드는 중...' : '새 우리 공간 만들기'}
            </button>
          </section>
        )}

        {/* General Settings */}
        <section className="space-y-2">
          <SectionHeader title="일반" />
          <RowGroup boxed>
            <PressableRow
              onClick={() => {
                setEditName(profile.myName);
                setEditAnniversary(profile.couple.anniversaryDate || '');
                setShowProfileModal(true);
              }}
              leading={<User size={18} className="text-coral" />}
              trailing={<ChevronRight size={16} className="text-muted-foreground" />}
            >
              <span className="text-label font-semibold text-foreground">내 프로필 수정</span>
            </PressableRow>

            {profile.role === 'soldier' && (
              <PressableRow
                onClick={() => navigate('/service')}
                leading={<Shield size={18} className="text-coral" />}
                trailing={<ChevronRight size={16} className="text-muted-foreground" />}
              >
                <span className="text-label font-semibold text-foreground">복무 정보 수정</span>
              </PressableRow>
            )}

            <PressableRow
              onClick={() => setShowPWAModal(true)}
              leading={<Smartphone size={18} className="text-coral" />}
              trailing={<span className="text-caption text-muted-foreground">Safari/Chrome</span>}
            >
              <span className="text-label font-semibold text-foreground">PWA 홈 화면 설치 방법</span>
            </PressableRow>
          </RowGroup>
        </section>

        {/*
          Durable entry points to the non-tab routes.

          The tab bar only exposes /home, /record, /us and /my. /schedule and
          /trips were reachable ONLY from UpcomingScheduleWidget, and /service
          only from DDayWidget -- but the dashboard layout is user-editable, and
          App.tsx redirects an unknown path to `/` with no address bar in the
          native shell. Removing the schedule widget therefore stranded /schedule
          and /trips permanently, with no way back. Settings is always reachable
          (WidgetDashboard and DDayWidget both link here), so an always-present
          link list is the minimal durable fix; the tab bar is left alone.

          Unconditional on role on purpose: the pre-existing /service row below
          is soldier-only, so a 곰신 viewer had no non-widget route to it at all.
        */}
        <section className="space-y-2">
          <SectionHeader title="바로가기" />
          <RowGroup boxed>
            {[
              { to: '/schedule', label: '일정 관리', icon: CalendarDays },
              { to: '/trips', label: '여행 플래너', icon: Plane },
              { to: '/service', label: '복무 현황 · D-Day', icon: Shield },
            ].map(({ to, label, icon: Icon }) => (
              <PressableRow
                key={to}
                onClick={() => navigate(to)}
                aria-label={label}
                leading={<Icon size={18} className="text-coral" />}
                trailing={<ChevronRight size={16} className="text-muted-foreground" />}
              >
                <span className="text-label font-semibold text-foreground">{label}</span>
              </PressableRow>
            ))}
          </RowGroup>
        </section>

        {/* Contact Hours */}
        {profile.role === 'soldier' && (
          <section className="rounded-surface bg-card border border-border p-4 space-y-1">
            <div className="flex items-center justify-between text-label font-bold text-foreground">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-coral" />
                <span>연락 가능 시간</span>
              </div>
              <span className="text-caption text-coral-strong font-bold">
                {profile.contact.weekdayStart} ~ {profile.contact.weekdayEnd}
              </span>
            </div>
            <p className="text-caption text-muted-foreground">
              평일 저녁 연락 가능 시간을 등록하면 브리핑 추천에 반영돼요.
            </p>
          </section>
        )}

        {/* Couple & Data Management */}
        <section className="space-y-2">
          <SectionHeader title="데이터 관리" />
          <RowGroup boxed>
            <PressableRow
              onClick={handleExportMyData}
              disabled={isExporting}
              leading={<Download size={18} className="text-foreground" />}
              trailing={<span className="text-caption text-muted-foreground">{isExporting ? '내보내는 중...' : `${ownRecords.length}개`}</span>}
            >
              <span className="block">
                <span className="block text-label font-semibold text-foreground">내 데이터 목록 JSON으로 내보내기</span>
                <span className="block text-caption text-muted-foreground mt-0.5">글·내 일정·내 여행 목록 · 미디어 원본 제외</span>
              </span>
            </PressableRow>

            <PressableRow
              onClick={() => setShowDeleteRecordsModal(true)}
              leading={<Trash2 size={18} className="text-foreground" />}
              trailing={<span className="text-caption text-muted-foreground">{ownRecords.length}개 보유</span>}
            >
              <span className="text-label font-semibold text-foreground">내 작성 기록 전체 삭제</span>
            </PressableRow>
          </RowGroup>
        </section>

        {/* Destructive actions - visually separated */}
        <section className="space-y-2">
          <SectionHeader title="연결 해제" />
          <RowGroup boxed>
            <PressableRow
              onClick={() => setShowDisconnectModal(true)}
              leading={<Unlink size={18} className="text-destructive" />}
              trailing={<ChevronRight size={16} className="text-destructive/60" />}
            >
              <span className="text-label font-semibold text-destructive">커플 연결 해제</span>
            </PressableRow>
          </RowGroup>
        </section>

        {/* Account Management */}
        <section className="space-y-2">
          <SectionHeader title="계정" />
          <RowGroup boxed>
            <PressableRow
              onClick={() => navigate('/legal/terms')}
              leading={<FileText size={18} className="text-muted-foreground" />}
              trailing={<ChevronRight size={16} className="text-muted-foreground" />}
            >
              <span className="text-label font-semibold text-foreground">서비스 이용약관</span>
            </PressableRow>

            <PressableRow
              onClick={() => navigate('/legal/privacy')}
              leading={<Shield size={18} className="text-muted-foreground" />}
              trailing={<ChevronRight size={16} className="text-muted-foreground" />}
            >
              <span className="text-label font-semibold text-foreground">개인정보 처리방침</span>
            </PressableRow>

            <PressableRow
              onClick={signOut}
              leading={<LogOut size={18} className="text-muted-foreground" />}
              trailing={<ChevronRight size={16} className="text-muted-foreground/60" />}
            >
              <span className="text-label font-semibold text-muted-foreground">로그아웃</span>
            </PressableRow>

            <PressableRow
              onClick={() => setShowDeleteAccountModal(true)}
              leading={<Trash2 size={18} className="text-destructive" />}
              trailing={<ChevronRight size={16} className="text-destructive/60" />}
            >
              <span className="text-label font-semibold text-destructive">계정 삭제 (회원 탈퇴)</span>
            </PressableRow>
          </RowGroup>
        </section>

        <p className="text-center text-caption text-muted-foreground leading-relaxed px-4">
          곰신로그의 기록은 1:1로 연결된 상대에게만 공유되며, '나만 보기'로 남긴 기록은
          상대방에게 전송되지 않습니다.
        </p>

        {/* Profile Edit Modal */}
        {showProfileModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" className="bg-card rounded-surface p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <h3 id="profile-modal-title" className="text-heading text-foreground">내 프로필 수정</h3>

              <div className="space-y-2">
                <label htmlFor="edit-nickname" className="text-label font-semibold text-muted-foreground">
                  내 닉네임 (2~12자)
                </label>
                <input
                  id="edit-nickname"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value.slice(0, 12))}
                  maxLength={12}
                  className="w-full h-11 px-3 rounded-control bg-muted border border-border text-body text-foreground outline-none focus:ring-2 focus:ring-coral/40"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="edit-anniversary" className="text-label font-semibold text-muted-foreground">
                  사귄 날짜
                </label>
                <input
                  id="edit-anniversary"
                  type="date"
                  value={editAnniversary}
                  onChange={(event) => setEditAnniversary(event.target.value)}
                  className="w-full h-11 px-3 rounded-control bg-muted border border-border text-body text-foreground outline-none focus:ring-2 focus:ring-coral/40"
                />
                <p className="text-caption text-muted-foreground">
                  두 사람이 함께 보는 날짜예요. 저장하면 상대방 화면의 디데이에도 반영됩니다.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowProfileModal(false)}
                  disabled={isSavingProfile}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                  className="flex-1 py-3 bg-coral-fill text-coral-fill-foreground font-bold rounded-control text-label min-h-[44px] disabled:opacity-50"
                >
                  {isSavingProfile ? '저장 중…' : '저장하기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Disconnect Modal */}
        {showDisconnectModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-5 animate-in fade-in">
            <div role="dialog" aria-modal="true" aria-labelledby="disconnect-modal-title" className="bg-card rounded-surface p-6 w-full max-w-sm border border-border space-y-4 shadow-xl text-center">
              <h3 id="disconnect-modal-title" className="text-heading text-foreground">정말 커플 연결을 해제하시겠어요?</h3>
              <p className="text-caption text-muted-foreground leading-relaxed">
                연결을 해제하면 상대방은 내 공유 기록을 더 이상 볼 수 없게 됩니다.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => setShowDisconnectModal(false)}
                  disabled={isDisconnecting}
                  className="py-2.5 rounded-control border border-border text-label font-semibold min-h-[44px] disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (isDisconnecting) return;
                    setIsDisconnecting(true);
                    try {
                      const disconnected = await disconnect();
                      if (disconnected) {
                        setShowDisconnectModal(false);
                        toast.success('연결이 해제되었습니다.');
                      } else {
                        // `disconnect()` returns a bare boolean, so the cause is
                        // already gone by the time we get here. Stay honest and
                        // generic rather than inventing a network diagnosis.
                        toast.error('연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.');
                      }
                    } catch (error) {
                      console.error('[Settings] Couple disconnect failed:', error);
                      toast.error(`연결을 해제하지 못했어요. ${classifyServerError(error).message}`);
                    } finally {
                      setIsDisconnecting(false);
                    }
                  }}
                  disabled={isDisconnecting}
                  className="py-2.5 rounded-control bg-destructive text-destructive-foreground text-label font-semibold min-h-[44px]"
                >
                  {isDisconnecting ? '해제 중...' : '해제하기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Records Modal */}
        {showDeleteRecordsModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="delete-records-modal-title" className="bg-card rounded-surface p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <h3 id="delete-records-modal-title" className="text-heading text-foreground">내 기록 전체 삭제</h3>
              <p className="text-caption text-muted-foreground leading-relaxed">
                내가 작성한 총 {ownRecords.length}개의 일상 기록이 삭제됩니다. 정말 삭제하시겠습니까?
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowDeleteRecordsModal(false)}
                  disabled={isDeletingRecords}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label active:bg-muted/80 min-h-[44px] disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (isDeletingRecords) return;
                    setIsDeletingRecords(true);
                    try {
                      const results = await Promise.all(
                        ownRecords.map((record) => deleteRecord(record.id))
                      );
                      const firstFailure = results.find((result) => !result.ok);
                      if (!firstFailure) {
                        setShowDeleteRecordsModal(false);
                        toast.success('내 기록이 모두 삭제되었습니다.');
                      } else {
                        // Report the actual cause of the first failure rather than
                        // a generic retry prompt: a permission or session problem
                        // will not resolve by trying again.
                        toast.error(
                          `일부 기록을 삭제하지 못했어요. ${firstFailure.ok ? '' : firstFailure.error}`.trim(),
                        );
                      }
                    } catch (error) {
                      console.error('[Settings] Record deletion failed:', error);
                      toast.error('일부 기록을 삭제하지 못했어요. 다시 시도해 주세요.');
                    } finally {
                      setIsDeletingRecords(false);
                    }
                  }}
                  disabled={isDeletingRecords}
                  className="flex-1 py-3 bg-destructive text-destructive-foreground font-bold rounded-control text-label active:scale-98 min-h-[44px]"
                >
                  {isDeletingRecords ? '삭제 중...' : '전체 삭제'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Account Modal */}
        {showDeleteAccountModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="delete-account-modal-title" className="bg-card rounded-surface p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <div className="flex items-center gap-2 text-destructive text-heading">
                <AlertTriangle size={20} />
                <span id="delete-account-modal-title">계정 삭제 (회원 탈퇴)</span>
              </div>
              <div className="text-caption text-destructive bg-destructive/10 p-3.5 rounded-surface space-y-1.5 leading-relaxed">
                <p>• 내 프로필, 내가 쓴 기록과 첨부파일, 로그인 계정이 삭제됩니다.</p>
                <p>• 상대방이 직접 작성한 기록은 삭제하지 않고 연결만 해제합니다.</p>
                <p>• 삭제한 계정과 데이터는 복원할 수 없습니다.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="delete-account-confirmation" className="text-label font-semibold text-foreground">
                  계속하려면 아래에 <b>탈퇴</b>를 입력하세요.
                </label>
                <input
                  id="delete-account-confirmation"
                  value={deleteAccountConfirmation}
                  onChange={(event) => setDeleteAccountConfirmation(event.target.value)}
                  placeholder="탈퇴"
                  autoComplete="off"
                  className="w-full h-11 px-3 rounded-control bg-muted border border-border text-body text-foreground outline-none focus:ring-2 focus:ring-destructive/30"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowDeleteAccountModal(false);
                    setDeleteAccountConfirmation('');
                  }}
                  disabled={isDeletingAccount}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label active:bg-muted/80 min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (isDeletingAccount || deleteAccountConfirmation !== '탈퇴') return;
                    setIsDeletingAccount(true);
                    try {
                      const result = await deleteAccount();
                      if (result.status === 'partially_deleted') {
                        // Tell the truth: the generic message claims nothing was
                        // deleted, which is the opposite of what happened.
                        toast.error(
                          '기록과 프로필 데이터는 삭제되었지만 로그인 계정은 삭제되지 못했습니다. 탈퇴를 완료해 주세요.',
                          { duration: 12000 },
                        );
                        return;
                      }
                      if (result.status === 'failed') {
                        toast.error('계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                        return;
                      }

                      setShowDeleteAccountModal(false);
                      setDeleteAccountConfirmation('');

                      // Report a partial cleanup honestly rather than claiming
                      // everything was removed.
                      const mediaWarning = result.warnings.some((w) =>
                        w.startsWith('media_not_fully_removed'),
                      );
                      if (mediaWarning) {
                        toast.warning(
                          '계정은 삭제되었지만 일부 첨부파일이 남아 있을 수 있습니다. 문의해 주시면 완전히 삭제해 드립니다.',
                          { duration: 10000 },
                        );
                      } else if (result.warnings.length > 0) {
                        toast.warning('계정은 삭제되었지만 일부 정리 작업이 지연되었습니다.', {
                          duration: 8000,
                        });
                      } else {
                        toast.success('계정과 데이터가 삭제되었습니다.');
                      }
                    } catch (error) {
                      console.error('[Settings] Account deletion failed:', error);
                      toast.error('계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                    } finally {
                      setIsDeletingAccount(false);
                    }
                  }}
                  disabled={isDeletingAccount || deleteAccountConfirmation !== '탈퇴'}
                  className="flex-1 py-3 bg-destructive text-destructive-foreground font-bold rounded-control text-label active:scale-98 min-h-[44px] disabled:opacity-50"
                >
                  {isDeletingAccount ? '삭제 중...' : '영구 삭제'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PWA Modal */}
        {showPWAModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="pwa-modal-title" className="bg-card rounded-surface p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <div className="flex items-center gap-2 text-foreground text-heading">
                <Smartphone size={20} className="text-coral" />
                <span id="pwa-modal-title">PWA 앱 설치 안내</span>
              </div>
              <div className="text-caption text-muted-foreground space-y-2 leading-relaxed bg-muted/40 p-3.5 rounded-surface border border-border">
                <p>• <b>iPhone Safari:</b> 하단 공유 아이콘 탭 → '홈 화면에 추가'</p>
                <p>• <b>Android Chrome:</b> 우측 상단 메뉴 탭 → '앱 설치' 또는 '홈 화면에 추가'</p>
              </div>
              <button
                onClick={() => setShowPWAModal(false)}
                className="w-full py-3 bg-coral-fill text-coral-fill-foreground font-bold rounded-control text-label active:scale-[0.99] min-h-[44px]"
              >
                확인
              </button>
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
