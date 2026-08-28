import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useStore } from '@/lib/useStore';
import { Button } from '@/components/ui/Button';
import { invitationExpiryLabel } from '@/lib/coupleLifecycle';
import { classifyServerError } from '@/lib/serverErrors';
import { MobileShell } from '@/components/MobileShell';
import { AppBar } from '@/components/ui/AppBar';
import {
  Shield, Unlink, Trash2, User, FileText, LogOut, Smartphone, AlertTriangle, ChevronRight,
  Sun, Moon, Copy, Check, RefreshCw, Download,
  CalendarDays, Plane, X, HelpCircle,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RowGroup, PressableRow, SectionHeader } from '@/components/ui/List';
import { ContactHoursSection } from '@/components/ContactHoursSection';
import { HandwritingSection } from '@/components/HandwritingSection';
import {
  consumeCoupleInvitation,
  createCoupleInvitation,
  regenerateCoupleInvitation,
  supabase,
} from '@/lib/supabase';
import { useEscapeKey } from '@/lib/hooks';
import { buildPersonalExport } from '@/lib/dataExport';
import { DeviceProtectionSection } from '@/components/DeviceProtectionSection';
import { activeCoupleScopeId, loadSettingsBootstrapFacts } from '@/app/e2ee/settingsFacts';
import type { DeviceProtectionSnapshot } from '@/app/e2ee/deviceProtectionStatus';
import { createSupabaseE2eeRepository } from '@/data/e2ee/SupabaseE2eeRepository';
import { createProtectedE2eeLocalState } from '@/app/e2ee/protectedLocalState';
import { E2EE_RUNTIME_INSTALLATION_ID } from '@/app/e2ee/runtimeSession';
import {
  createDeviceProtectionFlow,
  getDeviceProtectionPorts,
  type DeviceProtectionPlatform,
} from '@/app/e2ee/deviceProtectionFlow';
import {
  confirmCoupleProtectionCeremony,
  prepareCoupleProtectionCeremony,
  type CoupleProtectionCeremony,
} from '@/app/e2ee/coupleProtectionFlow';
import { installE2eeRuntimeForAuthenticatedSession } from '@/app/e2ee/runtimeSession';
import { isDeviceProtectionEnabled } from '@/app/e2ee/featureFlag';
import { formatRecoveryKitArtifact, parseRecoveryKitArtifact } from '@/app/e2ee/recoveryKitArtifact';
import type { BootstrapResult } from '@/app/e2ee/useCases';
import { NotificationPreferencesSection } from '@/components/NotificationPreferencesSection';
import { ProfileCaptionEditor } from '@/components/ProfileCaptionEditor';
import { isValidUsername, normalizeUsername } from '@/lib/profileCaption';
import type { ProfileDateType } from '@/types';

function nativeProtectionPlatform(): DeviceProtectionPlatform | null {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

function PartnerUsernameEditor({
  inputId,
  value,
  currentUsername,
  partnerLabel,
  isSaving,
  onChange,
  onSave,
}: {
  inputId: string;
  value: string;
  currentUsername?: string;
  partnerLabel: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-caption text-muted-foreground">
        현재 아이디: @{currentUsername || '아직 정해지지 않았어요'}
      </p>
      <label htmlFor={inputId} className="sr-only">{partnerLabel} 영어 아이디</label>
      <input
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase().slice(0, 20))}
        maxLength={20}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder={`${partnerLabel} 아이디 입력`}
        className="h-11 w-full rounded-control border border-border bg-background px-3 text-body text-foreground outline-none focus:ring-2 focus:ring-coral/40"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving || !value.trim()}
        className="press-response w-full min-h-11 rounded-control bg-foreground px-4 text-label font-semibold text-background disabled:opacity-50"
      >
        {isSaving ? '저장 중…' : '상대방 아이디 저장'}
      </button>
    </div>
  );
}

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
    setPartnerUsername,
  } = useStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const protectionCoupleId = activeCoupleScopeId(profile.couple);
  const deviceProtectionEnabled = isDeviceProtectionEnabled();
  const [protectionSnapshot, setProtectionSnapshot] = useState<DeviceProtectionSnapshot>({
    status: 'TEMPORARILY_UNAVAILABLE',
  });
  const [isProtectionBusy, setIsProtectionBusy] = useState(false);
  const [setupResult, setSetupResult] = useState<BootstrapResult | null>(null);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [recoveryArtifactInput, setRecoveryArtifactInput] = useState('');
  const [showProtectionDialog, setShowProtectionDialog] = useState(false);
  const [protectionDialogMode, setProtectionDialogMode] = useState<'setup' | 'recover'>('setup');
  const [pairingCeremony, setPairingCeremony] = useState<CoupleProtectionCeremony | null>(null);
  const [showPairingDialog, setShowPairingDialog] = useState(false);
  const dialogIdentityRef = useRef(settingsIdentityKey);

  useLayoutEffect(() => {
    if (dialogIdentityRef.current === settingsIdentityKey) return;
    dialogIdentityRef.current = settingsIdentityKey;
    // A SAS belongs to one exact authenticated account and couple. Never leave
    // the previous account's ceremony visible across a session transition.
    setShowPairingDialog(false);
    setPairingCeremony(null);
    setShowProtectionDialog(false);
    setSetupResult(null);
    setRecoveryCodeInput('');
    setRecoveryArtifactInput('');
    setIsProtectionBusy(false);
  }, [settingsIdentityKey]);

  useEffect(() => {
    if (!deviceProtectionEnabled) return;
    let cancelled = false;
    setProtectionSnapshot({ status: 'TEMPORARILY_UNAVAILABLE' });
    const userId = settingsIdentityKey;
    if (!userId || !supabase) return () => { cancelled = true; };
    void (async () => {
      try {
        const snapshot = await loadSettingsBootstrapFacts({
          userId,
          coupleId: protectionCoupleId,
          supabaseClient: supabase,
        });
        if (!cancelled) setProtectionSnapshot(snapshot);
      } catch {
        if (!cancelled) setProtectionSnapshot({ status: 'TEMPORARILY_UNAVAILABLE' });
      }
    })();
    return () => { cancelled = true; };
  }, [deviceProtectionEnabled, protectionCoupleId, settingsIdentityKey]);

  const loadDeviceProtectionDependencies = async (identity = captureIdentity()) => {
    if (!identity.userId || !supabase || !isCurrentIdentity(identity)) {
      throw new Error('E_PROTECTION_SESSION');
    }
    const platform = nativeProtectionPlatform();
    if (!platform) throw new Error('E_PROTECTION_NATIVE_REQUIRED');
    const { deviceKeys, localKeys } = getDeviceProtectionPorts();
    if (!deviceKeys || !localKeys) throw new Error('E_PROTECTION_STORAGE_UNAVAILABLE');
    const localState = await createProtectedE2eeLocalState({
      installationId: E2EE_RUNTIME_INSTALLATION_ID,
      userId: identity.userId,
      localKeys,
    });
    if (!isCurrentIdentity(identity)) throw new Error('E_PROTECTION_SESSION_STALE');
    if (!localState) throw new Error('E_PROTECTION_STORAGE_UNAVAILABLE');
    return {
      platform,
      localKeys,
      deps: {
        repository: createSupabaseE2eeRepository(supabase),
        localState,
        deviceKeys,
        flag: { isEnabled: isDeviceProtectionEnabled },
        now: () => Date.now(),
        newId: () => crypto.randomUUID(),
      },
    };
  };

  const loadDeviceProtectionFlow = async (identity = captureIdentity()) => {
    const loaded = await loadDeviceProtectionDependencies(identity);
    return createDeviceProtectionFlow({
      userId: identity.userId,
      platform: loaded.platform,
      localKeys: loaded.localKeys,
      isCurrentSession: () => isCurrentIdentity(identity),
      deps: loaded.deps,
    });
  };

  const refreshProtectionSnapshot = async (identity = captureIdentity()) => {
    if (!deviceProtectionEnabled) return;
    if (!identity.userId || !supabase) return;
    const snapshot = await loadSettingsBootstrapFacts({
      userId: identity.userId,
      coupleId: protectionCoupleId,
      supabaseClient: supabase,
    });
    if (isCurrentIdentity(identity)) setProtectionSnapshot(snapshot);
  };

  const startProtectionSetup = async () => {
    if (isProtectionBusy) return;
    if (!deviceProtectionEnabled) {
      toast.error('이 빌드에서는 기록 보호 설정이 아직 열려 있지 않아요.');
      return;
    }
    const identity = captureIdentity();
    setIsProtectionBusy(true);
    try {
      const flow = await loadDeviceProtectionFlow(identity);
      const result = await flow.beginFirstDevice();
      if (!isCurrentIdentity(identity)) return;
      setSetupResult(result);
      setRecoveryCodeInput('');
      setProtectionDialogMode('setup');
      setShowProtectionDialog(true);
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      const code = error instanceof Error ? error.message : '';
      toast.error(code.includes('E_PROTECTION_NATIVE_REQUIRED')
        ? '기록 보호 설정은 현재 iPhone 또는 Android 앱에서 진행할 수 있어요.'
        : code.includes('E_PROTECTION_STORAGE_UNAVAILABLE')
          ? '이 기기에서 필요한 보안 저장소를 사용할 수 없어요.'
          : '기록 보호 설정을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsProtectionBusy(false);
    }
  };

  const confirmProtectionSetup = async () => {
    if (!setupResult || isProtectionBusy) return;
    if (recoveryCodeInput.trim() !== setupResult.recoveryCode) {
      toast.error('저장한 복구 코드를 다시 입력해 주세요.');
      return;
    }
    const identity = captureIdentity();
    setIsProtectionBusy(true);
    try {
      const flow = await loadDeviceProtectionFlow(identity);
      await flow.confirmFirstDevice({
        recoveryCode: recoveryCodeInput,
        kitAnchor: setupResult.kitAnchor,
      });
      if (!isCurrentIdentity(identity)) return;
      setShowProtectionDialog(false);
      setSetupResult(null);
      setRecoveryCodeInput('');
      await refreshProtectionSnapshot(identity);
      toast.success('이 기기에서 기록 보호를 설정했어요.');
    } catch {
      if (isCurrentIdentity(identity)) toast.error('복구 수단을 확인하지 못했어요. 입력한 정보를 다시 확인해 주세요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsProtectionBusy(false);
    }
  };

  const startProtectionRecovery = () => {
    if (!deviceProtectionEnabled) return;
    setSetupResult(null);
    setRecoveryCodeInput('');
    setRecoveryArtifactInput('');
    setProtectionDialogMode('recover');
    setShowProtectionDialog(true);
  };

  const finishPairingRuntime = async (
    identity: { userId: string; generation: number },
  ) => {
    const result = await installE2eeRuntimeForAuthenticatedSession({
      userId: identity.userId,
      supabaseClient: supabase,
      activeCoupleId: protectionCoupleId,
      isCurrentSession: () => isCurrentIdentity(identity),
    });
    if (result.status !== 'installed' || result.coupleProtection !== 'activated') {
      throw new Error('E_COUPLE_RUNTIME_NOT_ACTIVE');
    }
    await refreshProtectionSnapshot(identity);
  };

  const openCoupleProtection = async () => {
    if (!deviceProtectionEnabled) return;
    if (!protectionCoupleId || isProtectionBusy) return;
    const identity = captureIdentity();
    setIsProtectionBusy(true);
    try {
      const { deps } = await loadDeviceProtectionDependencies(identity);
      let ceremony = await prepareCoupleProtectionCeremony(deps, {
        coupleId: protectionCoupleId,
        ownUserId: identity.userId,
        startIfMissing: true,
      });
      if (ceremony.canonicalOwner && ceremony.ownConfirmed
          && ceremony.partnerConfirmed && !ceremony.cryptoActive) {
        ceremony = await confirmCoupleProtectionCeremony(deps, {
          coupleId: protectionCoupleId,
          ownUserId: identity.userId,
        });
      }
      if (!isCurrentIdentity(identity)) return;
      setPairingCeremony(ceremony);
      setShowPairingDialog(true);
      if (ceremony.cryptoActive) {
        await finishPairingRuntime(identity);
        setShowPairingDialog(false);
        toast.success('둘의 기록 보호를 연결했어요.');
      }
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      const code = error instanceof Error ? error.message : '';
      toast.error(code.includes('E_PARTNER_PROTECTION_REQUIRED')
        ? '상대방도 자기 기기에서 기록 보호 설정을 먼저 마쳐야 해요.'
        : code.includes('E_PAIRING_TRANSCRIPT_MISMATCH')
          ? '두 기기의 보호 정보가 달라 연결을 멈췄어요. 앱을 다시 열고 확인해 주세요.'
          : '둘의 기록 보호 연결을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsProtectionBusy(false);
    }
  };

  const confirmCoupleProtection = async () => {
    if (!deviceProtectionEnabled) return;
    if (!protectionCoupleId || isProtectionBusy) return;
    const identity = captureIdentity();
    setIsProtectionBusy(true);
    try {
      const { deps } = await loadDeviceProtectionDependencies(identity);
      const ceremony = await confirmCoupleProtectionCeremony(deps, {
        coupleId: protectionCoupleId,
        ownUserId: identity.userId,
      });
      if (!isCurrentIdentity(identity)) return;
      setPairingCeremony(ceremony);
      if (ceremony.cryptoActive) {
        await finishPairingRuntime(identity);
        setShowPairingDialog(false);
        toast.success('둘의 기록 보호를 연결했어요.');
      } else {
        toast.success('내 확인을 저장했어요. 상대방의 확인을 기다릴게요.');
      }
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      const code = error instanceof Error ? error.message : '';
      toast.error(code.includes('E_TRANSCRIPT_EXPIRED')
        ? '보호 코드가 만료됐어요. 창을 닫고 다시 시작해 주세요.'
        : '보호 코드 확인을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsProtectionBusy(false);
    }
  };

  const recoverProtection = async () => {
    if (!deviceProtectionEnabled) return;
    if (isProtectionBusy) return;
    const identity = captureIdentity();
    setIsProtectionBusy(true);
    try {
      const kitAnchor = parseRecoveryKitArtifact(recoveryArtifactInput);
      const flow = await loadDeviceProtectionFlow(identity);
      await flow.recover({ recoveryCode: recoveryCodeInput, kitAnchor });
      if (!isCurrentIdentity(identity)) return;
      setShowProtectionDialog(false);
      toast.success('기록 보호를 복구했어요. 안전하게 확인한 뒤 앱을 다시 열어 주세요.');
    } catch {
      if (isCurrentIdentity(identity)) toast.error('기록 보호를 복구하지 못했어요. 복구 코드와 복구 정보를 확인해 주세요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsProtectionBusy(false);
    }
  };

  const copyProtectionText = async (value: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('E_CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(value);
      toast.success(`${label}를 복사했어요.`);
    } catch {
      toast.error('복사하지 못했어요. 직접 저장해 주세요.');
    }
  };

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
  const [isSavingPartnerUsername, setIsSavingPartnerUsername] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(() => searchParams.get('profile') === 'edit');
  const [editName, setEditName] = useState(profile.myName);
  const [editAnniversary, setEditAnniversary] = useState(profile.couple.anniversaryDate || '');
  const [editProfileCaption, setEditProfileCaption] = useState(profile.profileCaption || '');
  const [editProfileDateType, setEditProfileDateType] = useState<ProfileDateType | ''>(profile.profileDateType || '');
  const [editPartnerUsername, setEditPartnerUsername] = useState(profile.couple.partnerUsername || '');

  const closeProfileModal = useCallback(() => {
    setShowProfileModal(false);
    if (searchParams.get('profile') === 'edit') {
      navigate('/settings', { replace: true });
    }
  }, [navigate, searchParams]);

  useEscapeKey(() => {
    if (showPairingDialog) {
      if (!isProtectionBusy) setShowPairingDialog(false);
    } else if (showProtectionDialog) {
      if (!isProtectionBusy) setShowProtectionDialog(false);
    } else if (showDeleteAccountModal) {
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
      if (!isSavingProfile) closeProfileModal();
    }
  }, showPairingDialog || showProtectionDialog || showDeleteAccountModal
    || showDeleteRecordsModal || showDisconnectModal || showPWAModal || showProfileModal);

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
        profileCaption: editProfileCaption.trim() || undefined,
        profileDateType: editProfileDateType || undefined,
      });
      if (!isCurrentIdentity(identity)) return;
      if (!saved) {
        toast.error('프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      closeProfileModal();
      toast.success('프로필이 저장되었습니다.');
    } finally {
      if (isCurrentIdentity(identity)) setIsSavingProfile(false);
    }
  };

  const handleSavePartnerUsername = async () => {
    if (isSavingPartnerUsername) return;
    const nextUsername = normalizeUsername(editPartnerUsername);
    if (!isValidUsername(nextUsername)) {
      toast.error('아이디는 소문자 영문으로 시작하는 3~20자여야 해요.');
      return;
    }
    const identity = captureIdentity();
    setIsSavingPartnerUsername(true);
    try {
      const saved = await setPartnerUsername(nextUsername);
      if (!isCurrentIdentity(identity)) return;
      if (!saved) {
        toast.error('상대방 아이디를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setEditPartnerUsername(nextUsername);
      toast.success('상대방 아이디를 바꿨어요.');
    } finally {
      if (isCurrentIdentity(identity)) setIsSavingPartnerUsername(false);
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
        <AppBar
          sticky={false}
          className="px-0 pt-0"
          title="설정"
          onBack={() => navigate(-1)}
          backLabel="뒤로가기"
        />

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

        {deviceProtectionEnabled && (
          <DeviceProtectionSection
            status={protectionSnapshot.status}
            onStart={startProtectionSetup}
            onPair={openCoupleProtection}
            onRecover={startProtectionRecovery}
            busy={isProtectionBusy}
          />
        )}

        <NotificationPreferencesSection userId={settingsIdentityKey} />

        <section className="space-y-2">
          <h2 className="text-heading text-foreground">화면 테마</h2>
          <div className="grid grid-cols-2 gap-2 rounded-surface bg-muted p-1.5">
            <button
              type="button"
              onClick={() => setTheme('light')}
              aria-pressed={(state.theme || 'light') === 'light'}
              className={`press-response h-11 rounded-control text-label font-bold flex items-center justify-center gap-2 ${ (state.theme || 'light') === 'light' ? 'bg-card text-coral' : 'text-muted-foreground' }`}
            >
              <Sun size={16} />
              라이트
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              aria-pressed={state.theme === 'dark'}
              className={`press-response h-11 rounded-control text-label font-bold flex items-center justify-center gap-2 ${ state.theme === 'dark' ? 'bg-card text-coral' : 'text-muted-foreground' }`}
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
                  className="press-response p-2 text-coral hover:bg-coral/10 rounded-control min-h-[44px] min-w-[44px] flex items-center justify-center"
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
              className="press-response-row w-full h-11 rounded-control border border-coral/40 text-coral-strong text-label font-bold flex items-center justify-center gap-2 disabled:opacity-50"
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
            <Button variant="primary" size="lg" full
                onClick={handleJoinCouple}
              disabled={isJoiningCouple || inviteCodeInput.length !== 6}>
              {isJoiningCouple ? '연결 중...' : '초대 코드로 연결하기'}
            </Button>

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
              className="press-response-row w-full h-11 rounded-control border border-coral/40 text-coral-strong text-label font-bold disabled:opacity-50"
            >
              {isCreatingSpace ? '만드는 중...' : '새 우리 공간 만들기'}
            </button>
          </section>
        )}

        <HandwritingSection userId={state.authenticatedUser?.id || profile.id || ''} />

        {/* General Settings */}
        <section className="space-y-2">
          <SectionHeader title="일반" />
          <RowGroup boxed>
            <PressableRow
              onClick={() => {
                setEditName(profile.myName);
                setEditAnniversary(profile.couple.anniversaryDate || '');
                setEditProfileCaption(profile.profileCaption || '');
                setEditProfileDateType(profile.profileDateType || '');
                setEditPartnerUsername(profile.couple.partnerUsername || '');
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

        {profile.couple.connected ? (
          <section className="space-y-2" data-testid="partner-username-settings">
            <SectionHeader title="상대방 아이디" />
            <div className="rounded-surface border border-border bg-card p-4 space-y-3">
              <div>
                <h2 className="text-label font-semibold text-foreground">{profile.role === 'gomsin' ? '군화' : '곰신'}의 아이디 정하기</h2>
                <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
                  상대방 계정의 아이디를 이 화면에서 정해요. 내 아이디는 상대방이 정해요.
                </p>
              </div>
              <PartnerUsernameEditor
                inputId="partner-username"
                value={editPartnerUsername}
                currentUsername={profile.couple.partnerUsername}
                partnerLabel={profile.role === 'gomsin' ? '군화' : '곰신'}
                isSaving={isSavingPartnerUsername}
                onChange={setEditPartnerUsername}
                onSave={() => void handleSavePartnerUsername()}
              />
            </div>
          </section>
        ) : null}

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

        {/*
          Both roles, and editable.

          This was 군화-only, read-only, and described as feeding briefing
          recommendations. Migration 048 made two of those three wrong: it now
          decides when each person's own notification is allowed to arrive, so a
          role that could not see it had no control over being interrupted, and a
          value nobody can change is a preference in name only.
        */}
        <ContactHoursSection />

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
              onClick={() => navigate('/support')}
              leading={<HelpCircle size={18} className="text-muted-foreground" />}
              trailing={<ChevronRight size={16} className="text-muted-foreground" />}
            >
              <span className="text-label font-semibold text-foreground">고객지원</span>
            </PressableRow>

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
              <div className="flex items-center justify-between">
                <h3 id="profile-modal-title" className="text-heading text-foreground">내 프로필 수정</h3>
                <button
                  type="button"
                  onClick={closeProfileModal}
                  disabled={isSavingProfile}
                  className="press-response inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="프로필 수정 닫기"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>

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

              <div className="rounded-control border border-border bg-muted px-3 py-2">
                <p className="text-caption text-muted-foreground">내 아이디</p>
                <p className="mt-0.5 text-label font-semibold text-foreground">@{profile.username || '아직 정해지지 않았어요'}</p>
                <p className="mt-1 text-caption text-muted-foreground">아이디는 상대방이 정해요. 별명은 이 화면에서 바꿀 수 있어요.</p>
              </div>

              {profile.couple.connected ? (
                <div className="rounded-control border border-border bg-muted p-3 space-y-2">
                  <div>
                    <p className="text-caption text-muted-foreground">상대방 아이디 정하기</p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {profile.role === 'gomsin' ? '군화' : '곰신'}의 아이디를 내가 정해요.
                    </p>
                  </div>
                  <PartnerUsernameEditor
                    inputId="profile-modal-partner-username"
                    value={editPartnerUsername}
                    currentUsername={profile.couple.partnerUsername}
                    partnerLabel={profile.role === 'gomsin' ? '군화' : '곰신'}
                    isSaving={isSavingPartnerUsername}
                    onChange={setEditPartnerUsername}
                    onSave={() => void handleSavePartnerUsername()}
                  />
                </div>
              ) : null}

              <ProfileCaptionEditor
                caption={editProfileCaption}
                dateType={editProfileDateType}
                onCaptionChange={setEditProfileCaption}
                onDateTypeChange={setEditProfileDateType}
              />

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
                  onClick={closeProfileModal}
                  disabled={isSavingProfile}
                  className="press-response-row flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label min-h-[44px]"
                >
                  취소
                </button>
                <Button variant="primary" className="flex-1"
                onClick={handleSaveProfile}
                  disabled={isSavingProfile}>
                  {isSavingProfile ? '저장 중…' : '저장하기'}
                </Button>
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
                  className="press-response py-2.5 rounded-control border border-border text-label font-semibold min-h-[44px] disabled:opacity-50"
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
                  className="press-response py-2.5 rounded-control bg-destructive text-destructive-foreground text-label font-semibold min-h-[44px]"
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
                  className="press-response-row flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label active:bg-muted/80 min-h-[44px] disabled:opacity-50"
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
                  className="press-response flex-1 py-3 bg-destructive text-destructive-foreground font-bold rounded-control text-label min-h-[44px]"
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
                  className="press-response-row flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label active:bg-muted/80 min-h-[44px]"
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
                  className="press-response flex-1 py-3 bg-destructive text-destructive-foreground font-bold rounded-control text-label min-h-[44px] disabled:opacity-50"
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
              <Button variant="primary" full
                onClick={() => setShowPWAModal(false)}>
                확인
              </Button>
            </div>
          </div>
        )}

        {deviceProtectionEnabled && showPairingDialog && pairingCeremony && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="pairing-dialog-title" className="bg-card rounded-surface p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <div className="flex items-center gap-2 text-foreground text-heading">
                <Shield size={20} className="text-coral" aria-hidden="true" />
                <span id="pairing-dialog-title">둘의 보호 코드 확인</span>
              </div>
              <p className="text-caption text-muted-foreground leading-relaxed">
                상대방 기기에도 이 화면을 열고, 아래 코드의 모든 묶음이 같은지 직접 확인해 주세요.
                하나라도 다르면 확인하지 마세요.
              </p>
              <p className="rounded-control bg-muted px-4 py-4 text-center font-mono text-heading font-bold tracking-wider text-foreground select-text" data-testid="couple-protection-sas">
                {pairingCeremony.sas}
              </p>
              <div className="grid grid-cols-2 gap-2 text-caption">
                <p className="rounded-control border border-border px-3 py-2 text-center text-foreground">
                  내 기기 {pairingCeremony.ownConfirmed ? '확인 완료' : '확인 전'}
                </p>
                <p className="rounded-control border border-border px-3 py-2 text-center text-foreground">
                  상대 기기 {pairingCeremony.partnerConfirmed ? '확인 완료' : '확인 전'}
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowPairingDialog(false)}
                  disabled={isProtectionBusy}
                  className="press-response-row flex-1 min-h-11 rounded-control bg-muted px-3 text-label font-bold text-foreground"
                >
                  닫기
                </button>
                {pairingCeremony.ownConfirmed ? (
                  <Button variant="primary" className="flex-1" onClick={openCoupleProtection} disabled={isProtectionBusy}>
                    {isProtectionBusy ? '확인 중…' : '상태 새로고침'}
                  </Button>
                ) : (
                  <Button variant="primary" className="flex-1" onClick={confirmCoupleProtection} disabled={isProtectionBusy}>
                    {isProtectionBusy ? '확인 중…' : '코드가 같아요'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {deviceProtectionEnabled && showProtectionDialog && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="protection-dialog-title" className="bg-card rounded-surface p-6 max-w-sm w-full space-y-4 shadow-xl border border-border max-h-[90vh] overflow-y-auto">
              {protectionDialogMode === 'setup' && setupResult ? (
                <>
                  <div className="flex items-center gap-2 text-foreground text-heading">
                    <Shield size={20} className="text-coral" />
                    <span id="protection-dialog-title">복구 수단을 안전하게 보관해 주세요</span>
                  </div>
                  <p className="text-caption text-muted-foreground leading-relaxed">
                    이 정보는 새 기기에서 기록 보호를 복구할 때 필요해요. 곰신로그는 이 정보를 대신 보관하거나 다시 보여드릴 수 없어요.
                  </p>
                  <div className="space-y-1">
                    <p className="text-label font-semibold text-foreground">복구 코드</p>
                    <p className="font-mono text-caption break-all bg-muted p-3 rounded-control select-text">{setupResult.recoveryCode}</p>
                    <button
                      type="button"
                      onClick={() => void copyProtectionText(setupResult.recoveryCode, '복구 코드')}
                      className="press-response text-caption text-coral font-semibold"
                    >
                      복구 코드 복사
                    </button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-label font-semibold text-foreground">복구 정보</p>
                    <p className="font-mono text-caption break-all bg-muted p-3 rounded-control select-text">{formatRecoveryKitArtifact(setupResult.kitAnchor)}</p>
                    <button
                      type="button"
                      onClick={() => void copyProtectionText(formatRecoveryKitArtifact(setupResult.kitAnchor), '복구 정보')}
                      className="press-response text-caption text-coral font-semibold"
                    >
                      복구 정보 복사
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="protection-confirm-code" className="text-label font-semibold text-foreground">
                      저장한 복구 코드를 다시 입력해 주세요
                    </label>
                    <input
                      id="protection-confirm-code"
                      value={recoveryCodeInput}
                      onChange={(event) => setRecoveryCodeInput(event.target.value)}
                      autoComplete="off"
                      className="w-full h-11 px-3 rounded-control bg-muted border border-border text-body text-foreground outline-none focus:ring-2 focus:ring-coral/40"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => { setShowProtectionDialog(false); setRecoveryCodeInput(''); }}
                      disabled={isProtectionBusy}
                      className="press-response-row flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label min-h-[44px]"
                    >
                      나중에 하기
                    </button>
                    <Button variant="primary" className="flex-1"
                onClick={confirmProtectionSetup}
                      disabled={isProtectionBusy || !recoveryCodeInput}>
                      {isProtectionBusy ? '확인 중…' : '저장했고 계속하기'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-foreground text-heading">
                    <Shield size={20} className="text-coral" />
                    <span id="protection-dialog-title">기록 보호 복구</span>
                  </div>
                  <p className="text-caption text-muted-foreground leading-relaxed">
                    기존 보호 정보를 덮어쓰지 않습니다. 보관한 복구 코드와 복구 정보를 입력해 새 기기에서 확인해 주세요.
                  </p>
                  <div className="space-y-2">
                    <label htmlFor="protection-recovery-code" className="text-label font-semibold text-foreground">복구 코드</label>
                    <input id="protection-recovery-code" value={recoveryCodeInput} onChange={(event) => setRecoveryCodeInput(event.target.value)} autoComplete="off" className="w-full h-11 px-3 rounded-control bg-muted border border-border text-body text-foreground outline-none focus:ring-2 focus:ring-coral/40" />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="protection-recovery-artifact" className="text-label font-semibold text-foreground">복구 정보</label>
                    <textarea id="protection-recovery-artifact" value={recoveryArtifactInput} onChange={(event) => setRecoveryArtifactInput(event.target.value)} autoComplete="off" className="w-full min-h-24 p-3 rounded-control bg-muted border border-border text-caption font-mono text-foreground outline-none focus:ring-2 focus:ring-coral/40" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={() => setShowProtectionDialog(false)} disabled={isProtectionBusy} className="press-response-row flex-1 py-3 bg-muted text-foreground font-bold rounded-control text-label min-h-[44px]">취소</button>
                    <Button variant="primary" className="flex-1"
                onClick={recoverProtection} disabled={isProtectionBusy || !recoveryCodeInput || !recoveryArtifactInput}>
                      {isProtectionBusy ? '복구 중…' : '복구하기'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
