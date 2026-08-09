import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  Settings,
  Sparkles,
} from 'lucide-react';
import { MobileShell } from '@/components/MobileShell';
import { RowGroup, PressableRow, SectionHeader } from '@/components/ui/List';
import { CycleSupportSection } from '@/components/CycleSupportSection';
import { CycleTrackerSection } from '@/components/CycleTrackerSection';
import { useStore } from '@/lib/useStore';

export function MyPage() {
  const navigate = useNavigate();
  const { state, switchRole, coupleLifecycle } = useStore();
  const { profile, isDemoMode, authenticatedUser } = state;

  const isGomsin = profile.role === 'gomsin';
  const roleLabel = isGomsin ? '곰신' : '군화';
  const connected = Boolean(
    profile.couple.coupleId
      && profile.couple.connected
      && profile.couple.status === 'active',
  );

  /**
   * Say which state this actually is.
   *
   * This line used to be `connected ? "…님과 연결됨" : "연결 대기 중"`, so a user
   * with no couple space, a user who had just disconnected, and a user whose
   * membership had not been confirmed yet were all told an invitation was
   * outstanding. "대기 중" means someone may still join; for three of those four
   * states that is an invented fact.
   *
   * `coupleLifecycle` is the store's authoritative five-state answer and is what
   * CoupleStatusBanner already renders, so this reuses it rather than re-deriving
   * a second, disagreeing version from the profile snapshot.
   */
  const coupleStatusLabel = connected
    ? `${profile.couple.partnerName}님과 연결됨`
    : coupleLifecycle === 'pending'
      ? '연결 대기 중'
      : coupleLifecycle === 'disconnected'
        ? '연결이 해제된 상태예요'
        : coupleLifecycle === 'personal'
          ? '아직 우리 공간이 없어요'
          // Worded as a COUPLE-SPACE check, not a connection check. "연결 상태를
          // 확인" reads as a network diagnosis, and `serverErrorCopy` guards
          // against exactly that phrasing outside the classified error paths.
          // This mirrors CoupleStatusBanner's "커플 공간 상태를 확인하고 있어요".
          : '우리 공간 상태를 확인하는 중이에요';

  return (
    <MobileShell>
      <div className="p-4 pb-28 space-y-5">
        <div className="flex items-center justify-between px-1 pt-4 pb-1">
          <h1 className="text-title text-foreground">마이</h1>
          <button
            onClick={() => navigate('/settings')}
            className="p-2.5 rounded-control bg-card border border-border text-foreground hover:bg-muted active:scale-95 transition flex items-center justify-center min-h-[44px] min-w-[44px]"
            aria-label="설정 페이지로 이동"
          >
            <Settings size={20} />
          </button>
        </div>

        <div className="flex items-center gap-3 py-2">
          <div className="w-11 h-11 rounded-full bg-coral/15 text-coral-strong font-extrabold flex items-center justify-center text-heading border border-coral/30">
            {isGomsin ? '🌸' : '🪖'}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-heading text-foreground">{profile.myName || '나'}</h2>
            <div className="flex items-center gap-2 mt-0.5 text-caption text-muted-foreground">
              <span className="text-coral-strong font-bold text-caption">
                {roleLabel}
              </span>
              {connected ? (
                <span className="text-foreground font-semibold">{coupleStatusLabel}</span>
              ) : (
                <span className="text-muted-foreground">{coupleStatusLabel}</span>
              )}
            </div>
          </div>
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
          <section className="space-y-3">
            <SectionHeader title="병역 관련 도움 정보" caption="군 생활가이드" />
            <RowGroup boxed>
              <PressableRow
                leading={<span className="text-body">🎖️</span>}
                trailing={<ChevronRight size={16} className="text-muted-foreground" />}
              >
                <span className="text-label font-bold text-foreground">전역일 계산기</span>
                <p className="text-caption text-muted-foreground">복무율과 남은 일수를 한눈에</p>
              </PressableRow>
              <PressableRow
                leading={<span className="text-body">🏖️</span>}
                trailing={<ChevronRight size={16} className="text-muted-foreground" />}
              >
                <span className="text-label font-bold text-foreground">휴가 일정 가이드</span>
                <p className="text-caption text-muted-foreground">정기/포상 휴가 계획</p>
              </PressableRow>
            </RowGroup>

            <div className="bg-card border border-border p-3 rounded-surface space-y-1">
              <div className="flex items-center gap-1.5 text-label font-bold text-foreground">
                <Sparkles className="w-4 h-4 text-foreground" />
                <span>군 복무자 혜택 및 긴급 연락처</span>
              </div>
              <p className="text-caption text-foreground leading-relaxed break-keep">
                • 병사 적금 연 6% 이상 우대 금리 안내<br />
                • 국방 헬프콜 24시간 상담: 1303<br />
                • 군 장병 전용 할인 혜택 모음
              </p>
            </div>
          </section>
        )}

        {isDemoMode && (
          <div className="bg-warning-surface border border-warning/30 p-4 rounded-surface text-caption space-y-2">
            <div className="flex items-center justify-between font-bold text-warning-foreground">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-warning-foreground" />
                <span>데모 역할 전환</span>
              </span>
              <span className="text-caption bg-warning-surface px-2 py-0.5 rounded-full">로컬 데모</span>
            </div>
            <p className="text-warning-foreground text-caption">
              곰신/군화 각 역할별 전용 홈과 마이페이지를 바로 전환하여 체험해보세요.
            </p>
            <button
              onClick={switchRole}
              className="w-full py-2.5 rounded-control bg-warning-surface text-warning-foreground font-bold active:scale-98 transition min-h-[40px]"
            >
              현재 {roleLabel} 모드 → {isGomsin ? '군화' : '곰신'} 모드로 전환하기
            </button>
          </div>
        )}

        <section className="space-y-2">
          <RowGroup boxed>
            <PressableRow
              onClick={() => navigate('/settings')}
              leading={<Settings className="w-4 h-4 text-coral" />}
              trailing={<ChevronRight className="w-4 h-4 text-muted-foreground" />}
            >
              <span className="text-label font-bold text-foreground">설정 및 계정 관리</span>
              <p className="text-caption text-muted-foreground">프로필, 연결, 내보내기, 로그아웃</p>
            </PressableRow>
          </RowGroup>
        </section>
      </div>
    </MobileShell>
  );
}
