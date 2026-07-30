import { useState } from 'react';
import { useStore } from '@/lib/store';
import { MobileShell } from '@/components/MobileShell';
import { 
  ArrowLeft, User, Bell, Download, Shield, Unlink, Trash2, 
  Link, Clock, LogOut, FileText, Smartphone, Lock, AlertTriangle, ChevronRight, Settings,
  Sun, Moon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { consumeCoupleInvitation, supabase } from '@/lib/supabase';

export function SettingsPage() {
  const {
    state,
    updateProfile,
    disconnect,
    deleteAccount,
    signOut,
    reset,
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

  const handleToast = (msg: string) => {
    toast(msg);
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
            onClick={() => handleToast('프로필 편집 기능 준비 중입니다.')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <User size={18} className="text-coral" />
              <span>내 프로필 수정</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

          {hasCoupleSpace && !profile.couple.connected && profile.couple.coupleCode && (
            <button
              onClick={() => handleToast(`초대 코드: ${profile.couple.coupleCode}`)}
              className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
            >
              <span className="flex items-center gap-3 text-foreground">
                <Link size={18} className="text-coral" />
                <span>우리 공간 초대 코드</span>
              </span>
              <span className="text-xs text-coral font-bold bg-coral/10 px-2.5 py-1 rounded-lg">
                {profile.couple.coupleCode}
              </span>
            </button>
          )}

          <button 
            onClick={() => handleToast('알림 설정이 저장되었습니다.')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Bell size={18} className="text-coral" />
              <span>푸시 알림 설정</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

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

          <button 
            onClick={() => handleToast('곰신로그의 기록은 1:1 연결된 상대에게만 안전하게 공유됩니다.')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Shield size={18} className="text-coral" />
              <span>1:1 비공개 로그 및 보안 원칙</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

          <button 
            onClick={() => handleToast('생체인증 잠금 기능 준비 중입니다.')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Lock size={18} className="text-coral" />
              <span>민감 기록 생체인증 잠금</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
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
            onClick={() => handleToast('내 기록 PDF/JSON 내보내기 기능이 곧 출시됩니다.')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Download size={18} className="text-navy" />
              <span>내 기록 백업 & 내보내기</span>
            </span>
            <span className="text-[11px] text-muted-foreground">준비 중</span>
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
            onClick={() => handleToast('서비스 이용약관 준비 중')}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <FileText size={18} className="text-muted-foreground" />
              <span>서비스 이용약관</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

          <button 
            onClick={() => handleToast('개인정보 처리방침 준비 중')}
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

        {/* Reset App State */}
        <button 
          onClick={reset}
          className="w-full py-4 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground font-medium text-xs min-h-[44px]"
        >
          앱 상태 초기화 (처음 온보딩 화면으로 돌아가기)
        </button>

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
                    const deleted = await deleteAccount();
                    setIsDeletingAccount(false);

                    if (deleted) {
                      setShowDeleteAccountModal(false);
                      setDeleteAccountConfirmation('');
                      toast.success('계정과 데이터가 삭제되었습니다.');
                    } else {
                      toast.error('계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
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
