import { useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { usePartnerDay } from '@/lib/usePartnerDay';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { isCalendarDate } from '@/lib/trips';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { recordProductEvent } from '@/lib/productEvents';
import { projectStory } from '@/features/story/storyProjection';
import { StoryViewer, type StoryMode } from '@/features/story/StoryViewer';

/**
 * 스토리로 들어가는 세 개의 문.
 *
 *     /story/partner            상대의 현재 구간, 속표지부터
 *     /story/partner?at=<id>    그 정확한 순간부터
 *     /story/mine               내가 오늘 남긴 것
 *     /story/day/<YYYY-MM-DD>   보관 스토리 (우리 격자)
 *     /story/highlight/<id>     사용자가 고른 공유 사진 묶음
 *
 * ## 왜 라우트여야 하는가
 *
 * PRODUCT_V3 §7.5: 기록은 라우트로 주소 지정 가능해야 한다. 휘발성 앱 상태로만 대상을
 * 지정하면 새로고침·딥링크·알림에서 원본에 도달할 수 없다. `?at=`이 `recordId`인 것도
 * 같은 이유다 -- 인덱스는 기록 하나가 지워지면 다른 것을 가리킨다.
 *
 * ## 권한을 여기서 다시 판정하지 않는다
 *
 * 무엇을 볼 수 있는지는 `visibleRecordsForViewer`가, 놓친 구간이 어디부터인지는
 * `usePartnerDay`가 이미 판정했다. 이 파일은 그것을 카드로 투영하고 화면을 붙일 뿐이다.
 * 판정을 두 곳에서 하면 두 곳이 어긋나는 날이 온다.
 */
export function StoryRoute({ mode }: { mode: StoryMode }) {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, sharedSyncStatus, setHighlightedRecordId, markTalkAbout, unmarkTalkAbout } = useStore();
  const isOffline = !useOnlineStatus();

  const { profile } = state;
  const partnerName = profile.couple.partnerName || '상대방';
  const viewer = useMemo(
    () => ({ userId: profile.id, role: profile.role }),
    [profile.id, profile.role],
  );

  /*
    `persist`는 상대 스토리에서만 켠다.

    영수증을 쓰는 화면이 둘이면 어느 쪽이 진실인지 알 수 없어진다. 이 화면이 확인
    버튼을 가진 유일한 곳이므로 이 화면이 소유자다. 내 스토리와 보관 스토리는 읽기만 한다.
  */
  const { surface, todayStr, acknowledge } = usePartnerDay({ persist: mode === 'today' });

  const dateParam = params.date;
  const highlightId = params.highlightId;
  const focusRecordId = searchParams.get('at') || undefined;

  const visible = useMemo(
    () => visibleRecordsForViewer(state.records ?? [], viewer),
    [state.records, viewer],
  );

  const records = useMemo(() => {
    if (mode === 'today') return surface;
    if (mode === 'mine') {
      return visible
        .filter((record) => isOwnRecord(record, viewer) && record.date === todayStr)
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    if (mode === 'highlight') {
      const highlight = (state.coupleHighlights ?? []).find((item) => item.id === highlightId);
      if (!highlight) return [];
      const order = new Map(highlight.recordIds.map((id, index) => [id, index]));
      return visible
        .filter((record) => !record.isPrivate && order.has(record.id))
        .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    }
    // 보관: 그 날짜의 기록 전부. 내 비공개 기록도 나에게는 보인다 --
    // 본인에게 본인 기록을 숨기는 것은 프라이버시가 아니다.
    if (!dateParam || !isCalendarDate(dateParam)) return [];
    return visible
      .filter((record) => record.date === dateParam)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }, [dateParam, highlightId, mode, state.coupleHighlights, surface, todayStr, visible, viewer]);

  const projection = useMemo(
    () => projectStory({
      records,
      todayStr,
      focusRecordId,
      // 보관 스토리에는 목차를 붙이지 않는다. 지나간 하루는 훑는 것이 아니라 넘기는 것이다.
      withCover: mode !== 'archive' && mode !== 'highlight',
    }),
    [records, todayStr, focusRecordId, mode],
  );

  const title = useMemo(() => {
    if (mode === 'mine') return '나의 오늘';
    if (mode === 'highlight') {
      return (state.coupleHighlights ?? []).find((item) => item.id === highlightId)?.title || '하이라이트';
    }
    if (mode === 'archive' && dateParam) {
      const [, month, day] = dateParam.split('-');
      return `${Number(month)}월 ${Number(day)}일`;
    }
    const multiDay = records.some((record) => record.date !== todayStr);
    return multiDay ? `${partnerName}의 놓친 하루` : `${partnerName}의 오늘`;
  }, [highlightId, mode, dateParam, records, state.coupleHighlights, todayStr, partnerName]);

  const markedRecordIds = useMemo(
    () => new Set(
      (state.talkAboutMarks ?? []).filter((mark) => !mark.isCompleted).map((mark) => mark.recordId),
    ),
    [state.talkAboutMarks],
  );

  const close = useCallback(() => navigate(-1), [navigate]);

  const openRecord = useCallback((recordId: string) => {
    /*
      요약에서 원본으로. §19가 허용하는 것은 이벤트 종류와 불투명 id뿐이며, 기록 본문은
      읽지 않고 실어 보낼 필드도 없다.
    */
    void recordProductEvent({ kind: 'briefing_to_original', screen: 'story', subjectId: recordId });
    setHighlightedRecordId(recordId);
    navigate(`/record?record=${recordId}`);
  }, [navigate, setHighlightedRecordId]);

  /** 속표지의 줄 → 그 카드. 라우트를 바꿔야 새로고침에도 같은 자리가 열린다. */
  const jumpToRecord = useCallback((recordId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('at', recordId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const toggleBookmark = useCallback((recordId: string, nextMarked: boolean) => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    void (async () => {
      const result = nextMarked ? await markTalkAbout(recordId) : await unmarkTalkAbout(recordId);
      if (!result.ok) toast.error(result.error || '처리하지 못했어요.');
    })();
  }, [isOffline, markTalkAbout, unmarkTalkAbout]);

  const confirm = useCallback(() => {
    /*
      CONFIRMED를 쓰는 유일한 경로.

      사람이 하는 일은 "확인 처리"가 아니라 다 읽는 것이고, 읽기의 끝이 확인이어야 한다.
      닫기로 나가면 아무것도 확정되지 않는다 -- 그 계약은 그대로다.

      확인에는 전용 계측 이벤트를 만들지 않는다. §19의 종류를 늘리는 것은 LV 판독 항목을
      늘리는 결정이고, 그 결정은 이 화면이 내릴 것이 아니다.
    */
    if (!acknowledge(records)) {
      toast.error('확인을 저장하지 못했어요. 기록은 그대로 남아 있어요.');
      return;
    }
    close();
  }, [acknowledge, records, close]);

  /*
    빈 전체화면으로 보내지 않는다.

    통화 모드가 남은 항목 0일 때 진입점을 숨기는 것과 같은 규칙이다. 여기까지 왔다면
    링크를 직접 열었거나 그 사이에 기록이 사라진 것이므로, 사실대로 말하고 돌려보낸다.
  */
  if (projection.cards.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-8 text-center">
        <p className="text-body text-muted-foreground">
          {mode === 'mine' ? '오늘 남긴 기록이 아직 없어요' : mode === 'highlight' ? '이 하이라이트에는 볼 수 있는 사진이 없어요' : '여기에는 볼 수 있는 기록이 없어요'}
        </p>
        <button
          type="button"
          onClick={close}
          className="press-response inline-flex min-h-11 items-center rounded-control border border-border px-5 text-label font-semibold text-foreground"
        >
          돌아가기
        </button>
      </div>
    );
  }

  return (
    <StoryViewer
      cards={projection.cards}
      initialIndex={projection.initialIndex}
      mode={mode}
      title={title}
      coupleId={profile.couple.coupleId || undefined}
      markedRecordIds={markedRecordIds}
      onClose={close}
      onOpenRecord={openRecord}
      onJumpToRecord={jumpToRecord}
      onToggleBookmark={mode === 'archive' || mode === 'highlight' ? undefined : toggleBookmark}
      onAcknowledge={mode === 'today' ? confirm : undefined}
      bookmarkDisabledReason={isOffline ? '연결되면 표시할 수 있어요' : undefined}
      acknowledgeDisabledReason={
        sharedSyncStatus === 'unavailable' ? '지금은 확인을 저장할 수 없어요' : undefined
      }
    />
  );
}
