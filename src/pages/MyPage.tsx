import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  Settings,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { MobileShell } from '@/components/MobileShell';
import { CycleSupportSection } from '@/components/CycleSupportSection';
import { CycleTrackerSection } from '@/components/CycleTrackerSection';
import { useStore } from '@/lib/useStore';

export function MyPage() {
  const navigate = useNavigate();
  const { state, switchRole } = useStore();
  const { profile, isDemoMode, authenticatedUser } = state;

  const isGomsin = profile.role === 'gomsin';
  const roleLabel = isGomsin ? '곰신' : '군화';
  const connected = Boolean(
    profile.couple.coupleId
      && profile.couple.connected
      && profile.couple.status === 'active',
  );

  return (
    <MobileShell>
      <div className="p-4 pb-28 space-y-5">
        <div className="flex items-center justify-between px-1 pt-4 pb-1">
          <h1 className="text-2xl font-extrabold text-foreground">마이</h1>
          <button
            onClick={() => navigate('/settings')}
            className="p-2.5 rounded-2xl bg-card border border-border text-foreground hover:bg-muted active:scale-95 transition flex items-center justify-center min-h-[44px] min-w-[44px]"
            aria-label="설정 페이지로 이동"
          >
            <Settings size={20} />
          </button>
        </div>

        <div className="bg-card rounded-3xl p-5 shadow-sm border border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-coral/15 text-coral font-extrabold flex items-center justify-center text-xl border border-coral/30">
              {isGomsin ? '🌸' : '🪖'}
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{profile.myName || '나'}</h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                <span className="bg-coral/10 text-coral px-2 py-0.5 rounded-md font-bold text-[11px]">
                  {roleLabel}
                </span>
                {connected ? (
                  <span className="text-emerald-600 font-semibold">{profile.couple.partnerName}님과 연결됨</span>
                ) : (
                  <span className="text-muted-foreground">연결 대기 중</span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/settings')}
            className="text-xs font-semibold text-coral bg-coral/10 px-3 py-2 rounded-xl active:scale-95 transition"
          >
            설정
          </button>
        </div>

        {isGomsin && (
          <CycleTrackerSection
            key={authenticatedUser?.id || 'signed-out'}
            userId={authenticatedUser?.id}
          />
        )}

        <CycleSupportSection
          role={profile.role}
          authenticated={Boolean(authenticatedUser?.id)}
          userId={authenticatedUser?.id}
          coupleId={profile.couple.coupleId}
          connected={connected}
        />

        {!isGomsin && (
          <section className="bg-card rounded-3xl p-5 border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-coral" />
                <h3 className="text-base font-extrabold text-foreground">병역 관련 도움 정보</h3>
              </div>
              <span className="text-[10px] text-muted-foreground font-medium">군 생활가이드</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 border border-border/60 p-3.5 rounded-2xl space-y-1">
                <span className="text-lg">🎖️</span>
                <h4 className="text-xs font-bold text-foreground">전역일 계산기</h4>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  복무율과 남은 일수를 한눈에 확인해요.
                </p>
              </div>

              <div className="bg-muted/40 border border-border/60 p-3.5 rounded-2xl space-y-1">
                <span className="text-lg">🏖️</span>
                <h4 className="text-xs font-bold text-foreground">휴가 일정 가이드</h4>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  정기/포상 휴가 계획을 세워보세요.
                </p>
              </div>
            </div>

            <div className="bg-mint/40 border border-mint-foreground/20 p-4 rounded-2xl space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Sparkles className="w-4 h-4 text-foreground" />
                <span>군 복무자 혜택 및 긴급 연락처</span>
              </div>
              <p className="text-[11px] text-foreground/80 leading-relaxed pt-1">
                • 병사 적금(장병내일준비적금) 연 6% 이상 우대 금리 안내<br />
                • 국방 헬프콜 24시간 상담: 1303<br />
                • 군 장병 전용 할인 혜택 모음
              </p>
            </div>
          </section>
        )}

        {isDemoMode && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-xs space-y-2">
            <div className="flex items-center justify-between font-bold text-amber-900">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <span>데모 역할 전환</span>
              </span>
              <span className="text-[10px] bg-amber-200 px-2 py-0.5 rounded-md">로컬 데모</span>
            </div>
            <p className="text-amber-800 text-[11px]">
              곰신/군화 각 역할별 전용 홈과 마이페이지를 바로 전환하여 체험해보세요.
            </p>
            <button
              onClick={switchRole}
              className="w-full py-2.5 rounded-xl bg-amber-200 text-amber-950 font-bold active:scale-98 transition min-h-[40px]"
            >
              현재 {roleLabel} 모드 → {isGomsin ? '군화' : '곰신'} 모드로 전환하기
            </button>
          </div>
        )}

        <section className="bg-card rounded-3xl border border-border p-4 shadow-sm">
          <button
            onClick={() => navigate('/settings')}
            className="w-full py-3 px-2 flex items-center justify-between text-xs font-bold text-foreground hover:text-coral transition"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-coral" />
              <span>설정 및 계정 관리 (프로필, 연결, 내보내기, 로그아웃)</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </section>
      </div>
    </MobileShell>
  );
}
