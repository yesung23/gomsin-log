import { useState } from 'react';
import { useStore } from '@/lib/store';
import { MobileShell } from '@/components/MobileShell';
import { 
  ArrowLeft, User, Bell, Download, Shield, Unlink, Trash2, 
  Link, Clock, LogOut, FileText, Smartphone, Lock, AlertTriangle, ChevronRight, Settings
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export function SettingsPage() {
  const { state, disconnect, signOut, reset, deleteRecord } = useStore();
  const navigate = useNavigate();
  const { profile, isDemoMode, records } = state;
  const myName = profile.myName || '나';
  const partnerName = profile.couple.partnerName || '상대방';
  const roleLabel = profile.role === 'gomsin' ? '곰신' : '군화';
  const ownRecords = records.filter((r) => r.authorRole === profile.role);

  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showDeleteRecordsModal, setShowDeleteRecordsModal] = useState(false);
  const [showPWAModal, setShowPWAModal] = useState(false);

  const handleToast = (msg: string) => {
    toast(msg);
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
                {profile.couple.connected ? `파트너 ${partnerName}님과 연결됨` : '개인 모드 이용 중'}
              </p>
            </div>
          </div>
        </section>

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

          <button 
            onClick={() => handleToast(`초대 코드: ${profile.couple.coupleCode || '123456'}`)}
            className="w-full p-4 text-left flex items-center justify-between hover:bg-muted/50 transition min-h-[48px]"
          >
            <span className="flex items-center gap-3 text-foreground">
              <Link size={18} className="text-coral" />
              <span>우리 공간 초대 코드</span>
            </span>
            <span className="text-xs text-coral font-bold bg-coral/10 px-2.5 py-1 rounded-lg">
              {profile.couple.coupleCode || '123456'}
            </span>
          </button>

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
                  onClick={() => {
                    disconnect();
                    setShowDisconnectModal(false);
                    toast.info('연결이 해제되었습니다.');
                  }}
                  className="py-2.5 rounded-xl bg-destructive text-white text-xs font-semibold min-h-[44px]"
                >
                  해제하기
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
                  onClick={() => {
                    ownRecords.forEach((r) => deleteRecord(r.id));
                    setShowDeleteRecordsModal(false);
                    toast.success('내 기록이 모두 삭제되었습니다.');
                  }}
                  className="flex-1 py-3 bg-destructive text-white font-bold rounded-xl text-xs active:scale-98 min-h-[44px]"
                >
                  전체 삭제
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
                <p>• 계정을 삭제하면 내 프로필과 1:1 공간 데이터가 완전 삭제됩니다.</p>
                <p>• 상대방과의 연결이 끊어지며 복원할 수 없습니다.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowDeleteAccountModal(false)}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs active:bg-muted/80 min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    reset();
                    setShowDeleteAccountModal(false);
                    toast.info('앱 상태가 초기화되었습니다.');
                  }}
                  className="flex-1 py-3 bg-destructive text-white font-bold rounded-xl text-xs active:scale-98 min-h-[44px]"
                >
                  계정 삭제 진행
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

