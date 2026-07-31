import { useState } from 'react';
import { useStore } from '@/lib/useStore';
import { MobileShell } from '@/components/MobileShell';
import {
  ArrowLeft, Shield, Unlink, Trash2, User, FileText,
  Clock, LogOut, Smartphone, AlertTriangle, ChevronRight,
  Sun, Moon, Copy, Check, RefreshCw, Download,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  consumeCoupleInvitation,
  regenerateCoupleInvitation,
  supabase,
} from '@/lib/supabase';

export function SettingsPage() {
  const {
    state,
    updateProfile,
    disconnect,
    deleteAccount,
    signOut,
    deleteRecord,
    setTheme,
  } = useStore();
  const navigate = useNavigate();
  const { profile, isDemoMode, records } = state;
  const myName = profile.myName || '나';
  const partnerName = profile.couple.partnerName || '상대방';
  const roleLabel = profile.role === 'gomsin' ? '곰신' : '군화';
  const ownRecords = records.filter((r) => r.authorRole === profile.role);
  const hasCoupleSpace = !!profile.couple.coupleId;

  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showDeleteRecordsModal, setShowDeleteRecordsModal] = useState(false);
  const [showPWAModal, setShowPWAModal] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDeletingRecords, setIsDeletingRecords] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [isJoiningCouple, setIsJoiningCouple] = useState(false);
  const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editName, setEditName] = useState(profile.myName);
  const [editAnniversary, setEditAnniversary] = useState(profile.couple.anniversaryDate || '');

  /**
   * Export the records this user authored as a JSON file.
   * Runs entirely on the device so it also works offline and in demo mode.
   */
  const handleExportMyData = () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        app: 'gomsinlog',
        schemaVersion: 1,
        profile: {
          myName: profile.myName,
          role: profile.role,
          anniversaryDate: profile.couple.anniversaryDate ?? null,
          military: profile.role === 'soldier' ? profile.military : null,
        },
        // Only the caller's own records; the partner's content is not theirs to export.
        records: ownRecords.map((record) => ({
          date: record.date,
          time: record.time,
          log: record.log,
          reaction: record.reaction ?? null,
          isPrivate: record.isPrivate,
          emotionFlow: record.emotionFlow ?? [],
          // Storage paths only: signed URLs expire and would be useless in a backup.
          attachments: (record.attachments ?? []).map((a) => ({
            type: a.type,
            name: a.name,
            path: a.path ?? null,
          })),
          createdAt: record.createdAt,
        })),
        events: state.events.map((e) => ({
          title: e.title,
          eventType: e.eventType,
          startDate: e.startDate,
          endDate: e.endDate ?? null,
          isPrivate: e.isPrivate,
        })),
      };

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
      toast.success(`내 기록 ${ownRecords.length}개를 내보냈어요.`);
    } catch (error) {
      console.error('[gomsinlog] Export failed:', error);
      toast.error('내보내기에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveProfile = () => {
    const nextName = editName.trim();
    if (nextName.length < 2 || nextName.length > 12) {
      toast.error('닉네임은 2~12자로 입력해 주세요.');
      return;
    }
    updateProfile({
      myName: nextName,
      couple: { ...profile.couple, anniversaryDate: editAnniversary || undefined },
    });
    setShowProfileModal(false);
    toast.success('프로필이 저장되었습니다.');
  };

  const handleJoinCouple = async () => {
    const code = inviteCodeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      toast.error('6자리 초대 코드를 입력해 주세요.');
      return;
    }

    setIsJoiningCouple(true);
    const result = await consumeCoupleInvitation(code);
    if (result.error || !result.coupleId) {
      setIsJoiningCouple(false);
      toast.error(result.error || '커플 공간에 연결하지 못했습니다.');
      return;
    }

    const userId = state.authenticatedUser?.id;
    const [{ data: membership }, { data: partnerRows }] = await Promise.all([
      userId && supabase
        ? supabase
            .from('couple_members')
            .select('role')
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        ? supabase.rpc('get_partner_profile')
        : Promise.resolve({ data: null }),
    ]);

    updateProfile({
      role: membership?.role || profile.role,
      couple: {
        ...profile.couple,
        coupleId: result.coupleId,
        coupleCode: '',
        connected: true,
        status: 'active',
        partnerName: partnerRows?.[0]?.display_name || '파트너',
      },
    });
    setIsJoiningCouple(false);
    setInviteCodeInput('');
    toast.success('우리 공간에 연결되었습니다.');
  };

  return (
    <MobileShell>
      <div className="pb-28 px-5 pt-8 space-y-6">
        {/* Header with Back Button */}
        <header className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-xl hover:bg-muted text-muted-foreground min-h-[44px] flex items-center justify-center active:scale-95 transition"
            aria-label="뒤로가기"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold text-foreground">설정</h1>
          <div className="w-8" />
        </header>

        {/* User Profile Overview */}
        <section className="rounded-3xl bg-card border border-border p-5 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-coral/20 text-coral font-bold flex items-center justify-center text-lg">
              {profile.role === 'gomsin' ? '🌸' : '🪖'}
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">{myName}님 ({roleLabel})</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {profile.couple.connected
                  ? `파트너 ${partnerName}님과 연결됨`
                  : hasCoupleSpace
                    ? '상대방 참여 대기 중'
                    : '개인 모드 이용 중'}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-card border border-border p-4 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">화면 테마</h2>
            <p className="text-[11px] text-muted-foreground mt-1">
              눈과 상황에 편한 화면을 선택하세요. 선택은 이 기기에 저장됩니다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1.5">
            <button
              type="button"
              onClick={() => setTheme('light')}
              aria-pressed={(state.theme || 'light') === 'light'}
              className={`h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
                (state.theme || 'light') === 'light'
                  ? 'bg-card text-coral shadow-sm'
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
              className={`h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
                state.theme === 'dark'
                  ? 'bg-card text-coral shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              <Moon size={16} />
              다크
            </button>
          </div>
        </section>

        {/* Invite code for the space creator, until the partner actually joins. */}
        {hasCoupleSpace && !profile.couple.connected && !isDemoMode && (
          <section className="rounded-3xl bg-card border border-coral/30 p-5 shadow-sm space-y-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">우리 공간 초대 코드</h2>
              <p className="text-xs text-muted-foreground mt-1">
                상대방이 앱에서 이 코드를 입력하면 두 사람의 공간이 연결됩니다. 코드는 24시간 동안 유효해요.
              </p>
            </div>

            {profile.couple.coupleCode ? (
              <div className="flex items-center justify-between bg-muted px-4 py-3 rounded-2xl border border-border">
                <span className="font-mono text-2xl font-bold tracking-[0.2em] text-foreground">
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
                  className="p-2 text-coral hover:bg-coral/10 rounded-xl transition min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  {copiedInvite ? <Check size={20} /> : <Copy size={20} />}
                </button>
              </div>
            ) : (
              <p className="text-xs text-warning-foreground bg-warning-surface border border-warning/30 rounded-2xl p-3 leading-relaxed">
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
                updateProfile({
                  couple: { ...profile.couple, coupleCode: result.code },
                });
                toast.success('새 초대 코드가 발급되었습니다. 이전 코드는 더 이상 사용할 수 없어요.');
              }}
              disabled={isRegenerating}
              className="w-full h-12 rounded-xl border border-coral/40 text-coral text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={15} className={isRegenerating ? 'animate-spin' : undefined} />
              {isRegenerating ? '발급 중...' : '새 초대 코드 발급하기'}
            </button>
          </section>
        )}

        {!hasCoupleSpace && !isDemoMode && (
          <section className="rounded-3xl bg-card border border-coral/30 p-5 shadow-sm space-y-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">우리 공간 연결하기</h2>
              <p className="text-xs text-muted-foreground mt-1">
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
              className="w-full h-12 px-4 rounded-xl bg-background border border-border text-sm tracking-[0.3em] outline-none focus:ring-2 focus:ring-coral/40"
            />
            <button
              type="button"
              onClick={handleJoinCouple}
              disabled={isJoiningCouple || inviteCodeInput.length !== 6}
              className="w-full h-12 rounded-xl bg-coral text-white text-sm font-bold disabled:opacity-50"
            >
              {isJoiningCouple ? '연결 중...' : '초대 코드로 연결하기'}
            </button>
          </section>
        )}

        {/* General Settings */}
        <section className="rounded-3xl bg-card border border-border overflow-hidden shadow-sm divide-y divide-border/40 text-xs font-semibold">
          <button
            onClick={() => {
              setEditName(profile.myName);
              setEditAnniversary(profile.couple.anniversaryDate || '');
              setShowProfileModal(true);
            }}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <User size={18} className="text-coral" />
              <span>내 프로필 수정</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

          {profile.role === 'soldier' && (
            <button
              onClick={() => navigate('/service')}
              className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
            >
              <span className="flex items-center gap-3 text-foreground">
                <Shield size={18} className="text-coral" />
                <span>복무 정보 수정</span>
              </span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>
          )}

          <button 
            onClick={() => setShowPWAModal(true)}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Smartphone size={18} className="text-coral" />
              <span>PWA 홈 화면 설치 방법</span>
            </span>
            <span className="text-[11px] text-muted-foreground font-normal">Safari/Chrome</span>
          </button>
        </section>

        {/* Contact Hours */}
        {profile.role === 'soldier' && (
          <section className="rounded-3xl bg-card border border-border overflow-hidden shadow-sm p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-foreground">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-coral" />
                <span>군화 연락 가능 시간 설정</span>
              </div>
              <span className="text-[11px] text-coral font-bold bg-coral/10 px-2.5 py-0.5 rounded-md">
                {profile.contact.weekdayStart} ~ {profile.contact.weekdayEnd}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              평일 저녁 연락 가능 시간을 등록하면 브리핑 추천에 반영돼요.
            </p>
          </section>
        )}

        {/* Couple & Data Management */}
        <section className="rounded-3xl bg-card border border-border overflow-hidden shadow-sm divide-y divide-border/40 text-xs font-semibold">
          <button
            onClick={handleExportMyData}
            disabled={isExporting}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px] disabled:opacity-50"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Download size={18} className="text-navy" />
              <span>내 기록 JSON으로 내보내기</span>
            </span>
            <span className="text-[11px] text-muted-foreground font-normal">
              {isExporting ? '내보내는 중...' : `${ownRecords.length}개`}
            </span>
          </button>

          <button 
            onClick={() => setShowDeleteRecordsModal(true)}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Trash2 size={18} className="text-navy" />
              <span>내 작성 기록 전체 삭제</span>
            </span>
            <span className="text-[11px] text-muted-foreground font-normal">{ownRecords.length}개 보유</span>
          </button>

          <button 
            onClick={() => setShowDisconnectModal(true)}
            className="w-full p-4 text-left flex items-center justify-between text-destructive hover:bg-destructive/10 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3">
              <Unlink size={18} />
              <span>커플 연결 해제</span>
            </span>
            <ChevronRight size={16} className="text-destructive/60" />
          </button>
        </section>

        {/* Account Management & Reset */}
        <section className="rounded-3xl bg-card border border-border overflow-hidden shadow-sm divide-y divide-border/40 text-xs font-semibold">
          <button
            onClick={() => navigate('/legal/terms')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <FileText size={18} className="text-muted-foreground" />
              <span>서비스 이용약관</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

          <button
            onClick={() => navigate('/legal/privacy')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Shield size={18} className="text-muted-foreground" />
              <span>개인정보 처리방침</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

          <button 
            onClick={signOut}
            className="w-full p-4 text-left flex items-center justify-between text-muted-foreground hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3">
              <LogOut size={18} />
              <span>로그아웃</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground/60" />
          </button>

          <button 
            onClick={() => setShowDeleteAccountModal(true)}
            className="w-full p-4 text-left flex items-center justify-between text-destructive hover:bg-destructive/10 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3">
              <Trash2 size={18} />
              <span>계정 삭제 (회원 탈퇴)</span>
            </span>
            <ChevronRight size={16} className="text-destructive/60" />
          </button>
        </section>

        <p className="text-center text-[11px] text-muted-foreground leading-relaxed px-4">
          곰신로그의 기록은 1:1로 연결된 상대에게만 공유되며, '나만 보기'로 남긴 기록은
          상대방에게 전송되지 않습니다.
        </p>

        {/* Profile Edit Modal */}
        {showProfileModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <h3 className="text-base font-bold text-foreground">내 프로필 수정</h3>

              <div className="space-y-2">
                <label htmlFor="edit-nickname" className="text-xs font-semibold text-muted-foreground">
                  내 닉네임 (2~12자)
                </label>
                <input
                  id="edit-nickname"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value.slice(0, 12))}
                  maxLength={12}
                  className="w-full h-12 px-3 rounded-xl bg-muted border border-border text-sm text-foreground outline-none focus:ring-2 focus:ring-coral/40"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="edit-anniversary" className="text-xs font-semibold text-muted-foreground">
                  사귄 날짜
                </label>
                <input
                  id="edit-anniversary"
                  type="date"
                  value={editAnniversary}
                  onChange={(event) => setEditAnniversary(event.target.value)}
                  className="w-full h-12 px-3 rounded-xl bg-muted border border-border text-sm text-foreground outline-none focus:ring-2 focus:ring-coral/40"
                />
                <p className="text-[11px] text-muted-foreground">
                  두 사람이 함께 보는 날짜예요. 저장하면 상대방 화면의 디데이에도 반영됩니다.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveProfile}
                  className="flex-1 py-3 bg-coral text-white font-bold rounded-xl text-xs min-h-[44px]"
                >
                  저장하기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Disconnect Modal */}
        {showDisconnectModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-5 animate-in fade-in">
            <div className="bg-card rounded-3xl p-6 w-full max-w-sm border border-border space-y-4 shadow-xl text-center">
              <h3 className="text-base font-bold text-foreground">정말 커플 연결을 해제하시겠어요?</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                연결을 해제하면 상대방은 내 공유 기록을 더 이상 볼 수 없게 됩니다.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => setShowDisconnectModal(false)}
                  className="py-2.5 rounded-xl border border-border text-xs font-semibold min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (isDisconnecting) return;
                    setIsDisconnecting(true);
                    const disconnected = await disconnect();
                    setIsDisconnecting(false);

                    if (disconnected) {
                      setShowDisconnectModal(false);
                      toast.success('연결이 해제되었습니다.');
                    } else {
                      toast.error('연결을 해제하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
                    }
                  }}
                  disabled={isDisconnecting}
                  className="py-2.5 rounded-xl bg-destructive text-white text-xs font-semibold min-h-[44px]"
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
            <div className="bg-card rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <h3 className="text-base font-bold text-foreground">내 기록 전체 삭제</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                내가 작성한 총 {ownRecords.length}개의 일상 기록이 삭제됩니다. 정말 삭제하시겠습니까?
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowDeleteRecordsModal(false)}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs active:bg-muted/80 min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (isDeletingRecords) return;
                    setIsDeletingRecords(true);
                    const results = await Promise.all(
                      ownRecords.map((record) => deleteRecord(record.id))
                    );
                    setIsDeletingRecords(false);

                    if (results.every(Boolean)) {
                      setShowDeleteRecordsModal(false);
                      toast.success('내 기록이 모두 삭제되었습니다.');
                    } else {
                      toast.error('일부 기록을 삭제하지 못했어요. 다시 시도해 주세요.');
                    }
                  }}
                  disabled={isDeletingRecords}
                  className="flex-1 py-3 bg-destructive text-white font-bold rounded-xl text-xs active:scale-98 min-h-[44px]"
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
            <div className="bg-card rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <div className="flex items-center gap-2 text-destructive font-bold text-base">
                <AlertTriangle size={20} />
                <span>계정 삭제 (회원 탈퇴)</span>
              </div>
              <div className="text-xs text-destructive bg-destructive/10 p-3.5 rounded-2xl space-y-1.5 leading-relaxed">
                <p>• 내 프로필, 내가 쓴 기록과 첨부파일, 로그인 계정이 삭제됩니다.</p>
                <p>• 상대방이 직접 작성한 기록은 삭제하지 않고 연결만 해제합니다.</p>
                <p>• 삭제한 계정과 데이터는 복원할 수 없습니다.</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="delete-account-confirmation" className="text-xs font-semibold text-foreground">
                  계속하려면 아래에 <b>탈퇴</b>를 입력하세요.
                </label>
                <input
                  id="delete-account-confirmation"
                  value={deleteAccountConfirmation}
                  onChange={(event) => setDeleteAccountConfirmation(event.target.value)}
                  placeholder="탈퇴"
                  autoComplete="off"
                  className="w-full h-11 px-3 rounded-xl bg-muted border border-border text-sm text-foreground outline-none focus:ring-2 focus:ring-destructive/30"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowDeleteAccountModal(false);
                    setDeleteAccountConfirmation('');
                  }}
                  disabled={isDeletingAccount}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs active:bg-muted/80 min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (isDeletingAccount || deleteAccountConfirmation !== '탈퇴') return;
                    setIsDeletingAccount(true);
                    const result = await deleteAccount();
                    setIsDeletingAccount(false);

                    if (!result.ok) {
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
                  }}
                  disabled={isDeletingAccount || deleteAccountConfirmation !== '탈퇴'}
                  className="flex-1 py-3 bg-destructive text-white font-bold rounded-xl text-xs active:scale-98 min-h-[44px] disabled:opacity-50"
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
            <div className="bg-card rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <div className="flex items-center gap-2 text-foreground font-bold text-base">
                <Smartphone size={20} className="text-coral" />
                <span>PWA 앱 설치 안내</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-2 leading-relaxed bg-muted/40 p-3.5 rounded-2xl border border-border">
                <p>• <b>iPhone Safari:</b> 하단 공유 아이콘 탭 → '홈 화면에 추가'</p>
                <p>• <b>Android Chrome:</b> 우측 상단 메뉴 탭 → '앱 설치' 또는 '홈 화면에 추가'</p>
              </div>
              <button
                onClick={() => setShowPWAModal(false)}
                className="w-full py-3 bg-coral text-white font-bold rounded-xl text-xs active:scale-[0.99] min-h-[44px]"
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
