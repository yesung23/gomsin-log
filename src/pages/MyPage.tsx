import { useNavigate } from 'react-router-dom';
import { ChevronRight, Settings } from 'lucide-react';
import { MobileShell } from '@/components/MobileShell';
import { AvatarPicker } from '@/components/AvatarPicker';
import { RowGroup, PressableRow, SectionHeader } from '@/components/ui/List';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { CycleSupportSection } from '@/components/CycleSupportSection';
import { CycleTrackerSection } from '@/components/CycleTrackerSection';
import { CyclePartnerCard } from '@/components/cycle/CyclePartnerCard';
import { useStore } from '@/lib/useStore';

export function MyPage() {
  const navigate = useNavigate();
  const { state, coupleLifecycle } = useStore();
  const { profile, authenticatedUser } = state;

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
      <AppBar
        title="마이"
        actions={
          <AppBarAction onClick={() => navigate('/settings')} aria-label="설정 페이지로 이동">
            <Settings size={20} aria-hidden="true" />
          </AppBarAction>
        }
      />
      <div className="px-4 pt-4 pb-28 space-y-5">

        <div className="flex items-center gap-3 py-2">
          {/*
            The role glyph doubles as this screen's profile picture, so it can be
            replaced with a photo. Device-local; see `src/lib/avatarImage.ts` for why
            it is not uploaded. The emoji stays as the fallback: it is the one place
            an emoji is fine, because it stands in for a face rather than decorating
            a sentence.
          */}
          <AvatarPicker
            userId={state.authenticatedUser?.id || profile.id}
            slot="me"
            size={44}
            label="내 사진"
          >
            <span className="text-coral-strong font-extrabold text-heading">
              {isGomsin ? '🌸' : '🪖'}
            </span>
          </AvatarPicker>
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

        {/*
          The receiving end of the owner's three sharing toggles. Only the
          partner sees it, and it renders nothing unless the owner turned
          something on, so a partner who is shown nothing cannot infer whether
          the owner considered sharing and declined.
        */}
        {!isGomsin && (
          <CyclePartnerCard
            key={authenticatedUser?.id || 'signed-out'}
            authenticated={Boolean(authenticatedUser?.id)}
            userId={authenticatedUser?.id}
            connected={connected}
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
            <SectionHeader title="복무와 일정" caption="필요할 때 바로 확인" />
            <RowGroup boxed>
              <PressableRow
                onClick={() => navigate('/service')}
                leading={<span className="text-body">🎖️</span>}
                trailing={<ChevronRight size={16} className="text-muted-foreground" />}
              >
                <span className="text-label font-bold text-foreground">복무 현황 · D-Day</span>
                <p className="text-caption text-muted-foreground">복무율과 남은 기간 확인</p>
              </PressableRow>
              <PressableRow
                onClick={() => navigate('/schedule')}
                leading={<span className="text-body">🏖️</span>}
                trailing={<ChevronRight size={16} className="text-muted-foreground" />}
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
