import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Mail } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { usePartnerDay } from '@/lib/usePartnerDay';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { withReadableContent } from '@/lib/recordAvailability';
import { InkRing, type InkRingState } from '@/components/paper';
import { CoupleAvatar } from '@/components/CoupleAvatar';

/**
 * 홈 맨 위의 봉투 두 개.
 *
 * ## 링은 정확히 둘이다
 *
 * 인스타그램의 링은 N개라서 가로 스크롤이 생기고, 스크롤이 있어서 정렬이 필요하고,
 * 정렬이 있어서 알고리즘이 생긴다. 여기서는 상대와 나, 둘뿐이라 그 사슬이 시작되지 않는다.
 * 이 컴포넌트가 배열을 렌더하지 않는 것이 "SNS가 아니다"의 구현이다.
 *
 * ## 높이가 콘텐츠에 흔들리지 않는다
 *
 * 상대가 아무것도 남기지 않았어도 링은 그 자리에 있다. 사라지면 화면이 "없는 것"이 되고,
 * 남아 있으면 "아직 오지 않은 것"이 된다. 홈이 위젯 수에 따라 300~500px씩 비던 구조적
 * 결함(CURRENT_STATE Phase 0 미해결 항목)을 이 고정 높이가 없앤다.
 *
 * ## 미읽음은 나만 아는 사실이다
 *
 * `unread`는 `usePartnerDay`의 surface -- 즉 이 기기가 아직 확인하지 않은 것 -- 에서
 * 나온다. 뷰어 로컬 상태이며 서버로 가지 않고, 작성자에게 전달되는 경로도 없다.
 * 곰신이 아는 것은 `오늘 3개 남김`까지, 즉 "닿았다"까지다(PRODUCT_V3 §14.3).
 *
 * ## 두 역할이 같은 화면을 본다
 *
 * 왼쪽은 상대의 하루로, 오른쪽 `+`는 컴포저로 간다. 곰신의 1차 행동과 군화의 1차 행동이
 * 한 표면에 함께 있으므로, 역할차가 "다른 화면"이 아니라 "어느 링을 먼저 누르는가"로
 * 줄어든다. 서로가 무엇을 보고 있는지 상상할 수 있다는 것이 커플 제품에서 중요하다.
 */
export function StoryRailWidget() {
  const navigate = useNavigate();
  const { state } = useStore();
  const { profile } = state;
  const connected = profile.couple.connected;
  const partnerName = profile.couple.partnerName || '상대방';

  /*
    `persist: false`.

    영수증을 쓰는 화면은 스토리 뷰어 하나여야 한다. 레일은 읽기만 한다 -- 홈을 스쳐
    지나간 것만으로 확인이 되면, 확인이 "다 읽었다"는 뜻을 잃는다.
  */
  const { surface, todayStr } = usePartnerDay();

  const viewer = useMemo(
    () => ({ userId: profile.id, role: profile.role }),
    [profile.id, profile.role],
  );

  const myTodayCount = useMemo(() => {
    const visible = visibleRecordsForViewer(state.records ?? [], viewer);
    return visible.filter((record) => isOwnRecord(record, viewer) && record.date === todayStr).length;
  }, [state.records, viewer, todayStr]);

  const partnerReadable = useMemo(() => withReadableContent(surface), [surface]);
  const partnerState: InkRingState = !connected
    ? 'idle'
    : partnerReadable.length > 0 ? 'unread' : 'read';

  /**
   * 링 아래에 적는 말.
   *
   * 사실만 적는다. `읽지 않음`이나 `새 소식 3건` 같은 부채 표현을 쓰지 않는다 --
   * 개수는 부채이고 초대가 아니다(§14.3의 알림 문구 원칙을 화면에도 적용한다).
   */
  const partnerCaption = !connected
    ? '아직 혼자예요'
    : partnerReadable.length > 0
      ? `${partnerReadable.at(-1)?.time ?? ''} 업데이트`
      : '아직 오늘 이야기가 없어요';

  return (
    <section aria-label="오늘의 봉투" data-testid="story-rail">
      <div className="flex items-start justify-center gap-8 py-2">
        <RailItem
          label={connected ? `${partnerName}의 오늘` : `${partnerName} 초대하기`}
          caption={partnerCaption}
          onClick={() => navigate(connected ? '/story/partner' : '/settings')}
          disabled={connected && partnerReadable.length === 0}
          disabledHint="아직 열어볼 이야기가 없어요"
        >
          <InkRing state={partnerState}>
            {connected ? <CoupleAvatar size={68} /> : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Mail size={22} aria-hidden="true" />
              </span>
            )}
          </InkRing>
        </RailItem>

        {/* 두 사람 사이. 하트 하나가 여기가 둘의 공간이라고 말한다. */}
        <span aria-hidden="true" className="mt-8 select-none text-caption text-border">♥</span>

        <div className="relative">
          <RailItem
            label="나의 오늘"
            caption={myTodayCount > 0 ? `오늘 ${myTodayCount}개 남김` : '하루 남기기'}
            onClick={() => navigate(myTodayCount > 0 ? '/story/mine' : '/record?compose=1')}
          >
            <InkRing state="read">
              <CoupleAvatar size={68} />
            </InkRing>
          </RailItem>
          <button
            type="button"
            onClick={() => navigate('/record?compose=1')}
            aria-label="지금 남기기"
            className="press-response absolute right-0 top-14 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-foreground text-background"
          >
            <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function RailItem({
  label,
  caption,
  onClick,
  disabled = false,
  disabledHint,
  children,
}: {
  label: string;
  caption: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // 빈 전체화면으로 보내지 않는다. 통화 모드가 0개일 때 진입점을 숨기는 것과 같은 규칙.
      aria-label={disabled && disabledHint ? `${label} — ${disabledHint}` : label}
      className="press-response flex w-24 flex-col items-center gap-2 rounded-control disabled:cursor-default"
    >
      {children}
      <span className="text-center">
        <span className="block text-label font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 block text-caption text-muted-foreground">{caption}</span>
      </span>
    </button>
  );
}
