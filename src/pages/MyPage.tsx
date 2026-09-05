import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Heart, Settings, Shield } from 'lucide-react';
import { MobileShell } from '@/components/MobileShell';
import { AvatarPicker } from '@/components/AvatarPicker';
import { PenFace } from '@/components/paper';
import { RowGroup, PressableRow, SectionHeader } from '@/components/ui/List';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { useStore } from '@/lib/useStore';
import { resolveRelationshipContext } from '@/lib/relationshipContext';

export function MyPage() {
  const navigate = useNavigate();
  const { state, coupleLifecycle } = useStore();
  const { profile } = state;

  const isGomsin = profile.role === 'gomsin';
  const isMilitaryRelationship = resolveRelationshipContext(
    profile.couple.relationshipContext,
  ) === 'military';
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
      <AppBar
        title="마이"
        actions={
          <AppBarAction onClick={() => navigate('/settings')} aria-label="설정 페이지로 이동">
            <Settings size={20} aria-hidden="true" />
          </AppBarAction>
        }
      />
      {/* 마이도 공책 위로 (2026-08-22, §5). 탭은 잃었지만 화면은 그대로다 -- `우리 → ☰`. */}
      <div className="notebook min-h-full px-4 pt-4 pb-28 space-y-5">

        <div className="flex items-center gap-3 py-2">
          {/* One account photo, also shown in both partners' story rings. */}
          <AvatarPicker
            userId={state.authenticatedUser?.id || profile.id}
            slot="me"
            size={44}
            label="내 사진"
          >
            <span className="text-coral-strong font-extrabold text-heading">
              {isMilitaryRelationship
                ? <PenFace size={32} tone={isGomsin ? 'b' : 'a'} />
                : <Heart size={22} aria-hidden="true" />}
            </span>
          </AvatarPicker>
          <div className="min-w-0 flex-1">
            <h2 className="text-heading text-foreground">{profile.myName || '나'}</h2>
            <div className="flex items-center gap-2 mt-0.5 text-caption text-muted-foreground">
              {isMilitaryRelationship ? (
                <span className="text-coral-strong font-bold text-caption">
                  {roleLabel}
                </span>
              ) : null}
              {connected ? (
                <span className="text-foreground font-semibold">{coupleStatusLabel}</span>
              ) : (
                <span className="text-muted-foreground">{coupleStatusLabel}</span>
              )}
            </div>
            <p className="mt-1 text-caption text-muted-foreground">프로필 사진은 서로에게 보여요</p>
          </div>
        </div>

        {/*
          주기 · 배려 신호 · 상대 주기 카드는 `나` 탭으로 **옮겼다**(2026-08-22, §5.4).

          여기 있는 동안 그것들은 설정 안에 있었고, 매일 답해야 하는 질문("지금 연락해도
          되나")의 답이 설정 안에 있으면 그 기능은 없는 것과 같다. 복사하지 않고 옮긴
          이유는 같은 것을 두 곳에서 켜고 끄면 어느 쪽이 진짜인지 알 수 없게 되기
          때문이다.
        */}

        {isMilitaryRelationship && !isGomsin && (
          <section className="space-y-3">
            <SectionHeader title="복무와 일정" caption="필요할 때 바로 확인" />
            <RowGroup boxed>
              <PressableRow
                onClick={() => navigate('/service')}
                leading={<Shield size={18} className="text-coral" aria-hidden="true" />}
                trailing={<ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />}
              >
                <span className="text-label font-bold text-foreground">복무 현황 · D-Day</span>
                <p className="text-caption text-muted-foreground">복무율과 남은 기간 확인</p>
              </PressableRow>
              <PressableRow
                onClick={() => navigate('/schedule')}
                leading={<CalendarDays size={18} className="text-coral" aria-hidden="true" />}
                trailing={<ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />}
              >
                <span className="text-label font-bold text-foreground">휴가·면회 일정</span>
                <p className="text-caption text-muted-foreground">둘이 함께 볼 일정으로 이동</p>
              </PressableRow>
            </RowGroup>
          </section>
        )}

        <section className="space-y-2">
          <RowGroup boxed>
            <PressableRow
              onClick={() => navigate('/settings')}
              leading={<Settings className="w-4 h-4 text-coral" aria-hidden="true" />}
              trailing={<ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
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
