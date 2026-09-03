import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark as BookmarkIcon, Phone, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { usePartnerDay } from '@/lib/usePartnerDay';
import { localToday } from '@/lib/cycle';
import { isRecordContentAvailable } from '@/lib/recordAvailability';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';
import { Bookmark, InkCircle, PenFace } from '@/components/paper';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import { usePartnerCareNote } from '@/lib/usePartnerCareNote';
import { selectOnThisDay, onThisDayLabel } from '@/lib/onThisDay';
import { selectHomeFocus } from '@/features/home/homeFocus';
import type { DailyRecord } from '@/types';
import {
  buildTalkAboutTopics,
  getTalkAboutActorState,
  type TalkAboutActorState,
} from '@/lib/talkAboutList';
import { OFFLINE_READONLY_MESSAGE, useOnlineStatus } from '@/lib/useOnlineStatus';
import { TALK_ABOUT_SYNC_PENDING_MESSAGE } from '@/lib/talkAbout';

/**
 * 홈 — 노트에 그린 인스타그램.
 *
 *     헤더 56px        곰신로그 · 이야기할 것 · 통화
 *     스토리 레일 106px 내 스토리(+) · 상대
 *     ─────────────
 *     포스트           사진/글 → 캡션 → 시간·원본·책갈피 44px
 *
 * 이 숫자들이 인스타를 인스타로 보이게 한다. 글자 크기는 임의 픽셀이 아니라 앱의 타입
 * 스케일을 쓴다 -- 둘이 거의 겹치기 때문이다(22 title · 17 heading · 15 body · 13 label ·
 * 12 caption). 겹치지 않는 곳까지 픽셀로 박으면 이 화면만 다른 서체 체계를 갖게 된다. 바뀌는 것은 그 안이 **무엇으로 그려졌는가**
 * 뿐이다 -- 그라디언트 링 대신 펜으로 그은 원, 채운 카드 대신 손으로 그린 상자.
 *
 * ## 위젯 대시보드를 대신한다
 *
 * 앞선 홈은 끌어 옮기는 위젯 목록이었다. 종이를 뒤에 깔아도 그것은 위젯 대시보드였고,
 * "노트에 그린 인스타그램"이 아니었다. 인스타의 홈에는 배치할 것이 없다 -- 레일과
 * 피드가 있을 뿐이다.
 *
 * ## 인스타에서 가져오지 않은 것
 *
 * 좋아요 **수**, 조회 수, 본 사람 목록, 팔로워. §16이 금지한다. 액션은 있고 숫자가
 * 없다 -- 반응은 전하되 세지 않는다. 헤더의 점도 개수를 적지 않는다: 개수는 부채다.
 *
 * ## 피드가 담는 구간
 *
 * 최근 이레 동안 현재 상대가 공유한 기록을 보여 준다. 스토리는 아직 읽지 않은 구간을
 * 알려 주지만, 그 사실이 홈에서 상대의 기록을 숨기는 조건이 되지는 않는다.
 */

/** 지면이 담는 구간. 그 앞은 `우리` 의 격자가 갖는다. */
const FEED_DAYS = 7;

function timeAgo(record: DailyRecord, todayStr: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(record.time.trim());
  const time = match ? `${match[1].padStart(2, '0')}:${match[2]}` : record.time;
  if (record.date === todayStr) return `오늘 ${time}`;
  const days = Math.round(
    (Date.parse(`${todayStr}T00:00:00`) - Date.parse(`${record.date}T00:00:00`)) / 86400000,
  );
  if (days === 1) return `어제 ${time}`;
  if (days < 7) return `${days}일 전`;
  const [, month, day] = record.date.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

export function PaperHome() {
  const navigate = useNavigate();
  const {
    state,
    coupleLifecycle,
    sharedSyncStatus,
    markTalkAbout,
    unmarkTalkAbout,
  } = useStore();
  const { profile, talkAboutMarks } = state;
  const isOnline = useOnlineStatus();
  const pendingTalkAboutRef = useRef<string | null>(null);
  const [pendingTalkAboutRecordId, setPendingTalkAboutRecordId] = useState<string | null>(null);
  const todayStr = localToday();

  const partnerDay = usePartnerDay();

  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: profile.id,
      role: profile.role,
    }),
    [state.records, profile.id, profile.role],
  );

  const activePartnerUserId = coupleLifecycle === 'connected'
    && profile.couple.connected
    && profile.couple.status === 'active'
    && profile.couple.partnerUserId
    && profile.couple.partnerUserId !== profile.id
    ? profile.couple.partnerUserId
    : undefined;
  const sharedPartnerContentAvailable = !!activePartnerUserId
    && sharedSyncStatus !== 'unavailable';

  const feed = useMemo(() => {
    if (!sharedPartnerContentAvailable) return [];
    const from = parseLocalDate(todayStr);
    from.setDate(from.getDate() - (FEED_DAYS - 1));
    const fromStr = toLocalDateString(from);
    return records
      .filter((record) => (
        record.date >= fromStr
        && record.date <= todayStr
        && record.userId === activePartnerUserId
        && isRecordContentAvailable(record)
      ))
      .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
  }, [records, activePartnerUserId, sharedPartnerContentAvailable, todayStr]);

  /*
    1년 전 오늘. 지면 위 조용한 한 줄(계획 #29).

    내 기록은 연결 상태와 무관하게 남기되, 상대 기록은 서버가 현재 연결을 확인하고 그
    상대의 id가 정확히 일치할 때만 남긴다. 로컬 캐시에 이전 상대의 공유 기록이 남아도
    홈으로 되돌아오지 않아야 한다. 피드의 7일 창과 달리 이것은 **오래된 것일수록 값이
    있으므로** 날짜 창은 두지 않는다.
  */
  const memoryRecords = useMemo(() => records.filter((record) => (
    isRecordContentAvailable(record)
    && (
      isOwnRecord(record, { userId: profile.id, role: profile.role })
      || (sharedPartnerContentAvailable && record.userId === activePartnerUserId)
    )
  )), [
    records,
    profile.id,
    profile.role,
    activePartnerUserId,
    sharedPartnerContentAvailable,
  ]);
  const onThisDay = useMemo(
    () => selectOnThisDay(memoryRecords, todayStr),
    [memoryRecords, todayStr],
  );

  const talkTopics = useMemo(
    () => buildTalkAboutTopics(talkAboutMarks ?? [], records, {
      userId: profile.id,
      role: profile.role,
    }),
    [talkAboutMarks, records, profile.id, profile.role],
  );
  const talkAboutStateByRecordId = useMemo(() => {
    const marks = talkAboutMarks ?? [];
    const states = new Map<string, TalkAboutActorState>();
    for (const topic of talkTopics) {
      states.set(topic.recordId, getTalkAboutActorState(marks, topic.recordId, profile.id));
    }
    return states;
  }, [talkAboutMarks, talkTopics, profile.id]);

  const toggleTalkAbout = useCallback((recordId: string, actorState: TalkAboutActorState) => {
    if (pendingTalkAboutRef.current) return;
    if (!isOnline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }

    pendingTalkAboutRef.current = recordId;
    setPendingTalkAboutRecordId(recordId);
    void (async () => {
      try {
        const result = actorState === 'mine' || actorState === 'both'
          ? await unmarkTalkAbout(recordId)
          : await markTalkAbout(recordId);
        if (!result.ok) toast.error(result.error || '책갈피를 바꾸지 못했어요.');
        else if (result.syncPending) toast.warning(TALK_ABOUT_SYNC_PENDING_MESSAGE);
      } catch {
        toast.error('책갈피를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
      } finally {
        pendingTalkAboutRef.current = null;
        setPendingTalkAboutRecordId(null);
      }
    })();
  }, [isOnline, markTalkAbout, unmarkTalkAbout]);

  const partnerName = activePartnerUserId
    ? profile.couple.partnerName?.trim() || '상대'
    : null;
  /*
    상대가 오늘 보낸 배려 신호. 계획서 #30이 이 자리를 요구했고, 지금까지는
    `우리 → 오늘 내 상태` 로 두 번 들어가야 나왔다.
  */
  const careNote = usePartnerCareNote({
    coupleId: profile.couple.coupleId,
    connected: sharedPartnerContentAvailable,
    userId: profile.id,
  });
  const hasUnseen = sharedPartnerContentAvailable && partnerDay.surface.length > 0;
  const hasMarks = sharedPartnerContentAvailable && talkTopics.length > 0;
  const hasOwnRecordToday = records.some((record) => (
    record.date === todayStr
    && isRecordContentAvailable(record)
    && isOwnRecord(record, { userId: profile.id, role: profile.role })
  ));
  const focus = selectHomeFocus({
    partnerName: partnerName ?? '',
    careKind: activePartnerUserId ? careNote?.kind ?? null : null,
    hasPartnerDay: hasUnseen,
    hasTalkAboutMarks: hasMarks,
    hasOwnRecordToday,
  });

  const feedStatus = coupleLifecycle === 'unknown'
    || (coupleLifecycle === 'connected' && !activePartnerUserId)
    ? 'identity'
    : coupleLifecycle === 'connected'
      && activePartnerUserId
      && sharedSyncStatus === 'unavailable'
      ? 'unavailable'
      : coupleLifecycle === 'connected'
        && activePartnerUserId
        && feed.length === 0
        ? 'empty'
        : null;

  return (
    /*
      `home-core` -- 홈이 실제로 그려졌다는 표식.

      V4 이전에는 `RoleHome` 의 역할별 코어 표면이 이 이름을 달았고, e2e 의 홈 스크린샷이
      그것을 기다렸다. 홈이 피드가 되면서 그 노드는 사라졌지만 **표식이 지키는 것**은
      바뀌지 않았다: 스플래시도 온보딩도 아닌 홈이 떴는가. 그래서 이름을 지우지 않고
      새 홈의 뿌리로 옮긴다.
    */
    <div className="min-h-full pb-6" data-testid="home-core">
      <header
        data-testid="home-sticky-header"
        className="paper-texture-layer sticky top-0 z-40 flex h-14 items-center justify-between px-4"
      >
        {/*
          로고 자리. 이 앱의 이름은 손글씨다 -- 인스타의 로고가 그 앱의 손글씨인 것과
          같은 자리이고, 사람이 쓴 글은 아니지만 **간판**이라 인쇄체로 두면 서식이 된다.
        */}
        <span className="hand-text shrink-0 text-title leading-none" style={{ color: 'var(--ink)' }}>
          곰신로그
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="이야기할 것"
            onClick={() => navigate('/saved')}
            className="press-response inline-flex min-h-11 items-center justify-center gap-1 px-2"
          >
            <BookmarkIcon
              size={18}
              className="pen-icon"
              color="var(--ink)"
              fill={hasMarks ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap text-label font-semibold" style={{ color: 'var(--ink)' }}>
              이야기
            </span>
          </button>
          {hasMarks ? (
            <button
              type="button"
              aria-label="통화 모드"
              onClick={() => navigate('/call')}
              className="press-response flex h-11 w-11 items-center justify-center"
            >
              <Phone size={21} className="pen-icon" color="var(--ink)" fill="none" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="px-4">
        <CoupleStatusBanner />
      </div>

      {/*
        스토리 레일 — 인스타와 같은 106px, 같은 순서.

        **내 스토리가 맨 왼쪽이다.** 인스타에서 왼쪽 끝은 언제나 자기 자신이고 `+` 배지가
        거기 붙는다. 손이 기억하는 자리를 바꾸면 인스타 문법을 빌려 온 이유가 사라진다.

        링은 둘에서 끝난다. 인스타라면 여기부터 팔로우한 사람들이 이어지지만 이 앱에는
        두 사람뿐이라 그 자리가 비고, **비는 것이 맞다**(§5.2: 링은 정확히 두 개다).
      */}
      <section aria-label="스토리" className="flex min-h-[106px] items-start gap-5 px-4 pb-2 pt-1">
        <div className="relative">
          <button
            type="button"
            onClick={() => navigate('/story/mine')}
            className="press-response flex w-[72px] flex-col items-center gap-1.5"
          >
            <InkCircle size={66} ring="seen"><PenFace size={44} tone="b" /></InkCircle>
            <span className="text-caption leading-none" style={{ color: 'var(--ink-soft)' }}>내 스토리</span>
          </button>
          <button
            type="button"
            aria-label="기록 남기기"
            onClick={() => navigate('/compose')}
            /*
              눈에 보이는 것은 22px 이지만 **누르는 곳은 46px** 이다.

              인스타의 `+` 배지도 이만큼 작게 그려진다 -- 작게 보이는 것이 이 배지의
              일이다. 하지만 그리는 크기와 닿는 크기는 다른 값이어야 한다(DESIGN_V2
              §Visual footprint ≠ hit target). 이 배지는 곰신의 1차 행동으로 가는
              문이므로, 22px 그대로 두면 앱에서 가장 중요한 동작이 가장 놓치기 쉬운
              표적이 된다.
            */
            className="press-response absolute left-[46px] top-[42px] flex h-[22px] w-[22px] items-center justify-center rounded-full before:absolute before:-inset-3 before:content-['']"
            style={{ background: 'var(--ink)', border: '2px solid var(--paper)' }}
          >
            <Plus size={13} color="var(--paper)" strokeWidth={2.6} aria-hidden="true" />
          </button>
        </div>

        <div className="relative">
          {activePartnerUserId && partnerName ? (
            <button
              type="button"
              onClick={() => navigate('/story/partner')}
              aria-label={`${partnerName}의 스토리`}
              className="press-response flex w-[72px] flex-col items-center gap-1"
            >
              {/*
                링의 상태가 유일하게 말하는 것: 아직 안 본 것이 있는가.

                열람 시각도, 본 사람 목록도, 읽음 표시도 아니다(§16). 링은 **내 쪽의 사실**만
                말한다 -- 상대는 내가 봤는지 알 수 없다.
              */}
              <InkCircle size={66} ring={hasUnseen ? 'new' : 'seen'}><PenFace size={44} /></InkCircle>
              <span
                className="max-w-[72px] truncate text-caption leading-none"
                style={{ color: hasUnseen ? 'var(--ink)' : 'var(--ink-soft)' }}
              >
                {partnerName}
              </span>
              {hasUnseen ? (
                <span className="text-caption font-semibold leading-none" style={{ color: 'var(--ink-accent)' }}>
                  이어 보기
                </span>
              ) : null}
            </button>
          ) : (
            <div className="flex w-[72px] flex-col items-center gap-1" aria-hidden="true">
              <InkCircle size={66} ring="seen"><PenFace size={44} /></InkCircle>
              <span className="text-caption leading-none" style={{ color: 'var(--ink-soft)' }}>
                확인 중
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="ink-rule mx-4" aria-hidden="true" />

      {focus ? (
        <section aria-label="지금 가장 필요한 것" className="px-4">
          <button
            type="button"
            onClick={() => navigate(focus.to)}
            className="press-response flex min-h-[60px] w-full items-center gap-3 py-2 text-left"
          >
            <span
              className="min-w-0 flex-1 break-words text-body font-semibold [overflow-wrap:anywhere]"
              style={{ color: 'var(--ink)' }}
            >
              {focus.title}
            </span>
            <span className="ml-auto shrink-0 text-label font-semibold" style={{ color: 'var(--ink-accent)' }}>
              {focus.actionLabel}
            </span>
          </button>
          <div className="ink-rule" aria-hidden="true" />
        </section>
      ) : null}

      {sharedPartnerContentAvailable && partnerName ? (
        <section aria-labelledby="home-partner-feed-title">
          <div className="px-4 pb-2 pt-5">
            <h2
              id="home-partner-feed-title"
              className="break-words text-headline font-semibold [overflow-wrap:anywhere]"
              style={{ color: 'var(--ink)' }}
            >
              {partnerName}의 최근 기록
            </h2>
          </div>

          {feedStatus === 'empty' ? (
            <p className="px-8 py-10 text-center text-label leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
              최근 {FEED_DAYS}일에 공유된 기록이 없어요
            </p>
          ) : (
            feed.map((record, index) => (
              <Post
                key={record.id}
                record={record}
                index={index}
                mine={record.userId === profile.id}
                myName={profile.myName || '나'}
                partnerName={partnerName}
                todayStr={todayStr}
                onOpen={() => navigate(`/record?record=${encodeURIComponent(record.id)}`)}
                talkAboutState={talkAboutStateByRecordId.get(record.id) ?? 'none'}
                talkAboutBusy={pendingTalkAboutRecordId !== null}
                talkAboutDisabled={!isOnline || pendingTalkAboutRecordId !== null}
                talkAboutDisabledReason={!isOnline
                  ? OFFLINE_READONLY_MESSAGE
                  : pendingTalkAboutRecordId !== null
                    ? '다른 책갈피를 바꾸는 중이에요.'
                    : undefined}
                onToggleTalkAbout={() => toggleTalkAbout(
                  record.id,
                  talkAboutStateByRecordId.get(record.id) ?? 'none',
                )}
              />
            ))
          )}

        </section>
      ) : feedStatus ? (
        <p
          role="status"
          className="px-8 py-10 text-center text-label leading-relaxed"
          style={{ color: 'var(--ink-soft)' }}
        >
          {feedStatus === 'identity'
            ? '상대 정보를 확인하고 있어요'
            : '공유 정보를 아직 확인하지 못했어요'}
        </p>
      ) : null}

      {/*
        쌓인 것이 스스로 돌아오는 유일한 자리.

        **조용해야 한다.** 카드로 만들면 오늘 남길 것보다 작년이 위에 오고, 그러면 이
        앱은 추억을 파는 앱이 된다 -- 오늘을 남기게 하는 앱이 아니라. 배지도, 아이콘도,
        느낌표도 없다. 한 줄이고, 누르면 그날로 간다.

        없으면 자리도 없다. "아직 1년이 안 됐어요" 같은 말은 아무에게도 쓸모가 없고,
        시작한 지 얼마 안 된 커플에게 매일 그 사실을 알리는 일이 된다.
      */}
      {onThisDay ? (
        <button
          type="button"
          onClick={() => navigate(`/record?record=${encodeURIComponent(onThisDay.record.id)}`)}
          className="press-response flex min-h-11 w-full items-baseline gap-2 px-4 text-left"
        >
          <span className="shrink-0 text-caption" style={{ color: 'var(--ink-soft)' }}>
            {onThisDayLabel(onThisDay)}
          </span>
          <span
            className="hand-text min-w-0 truncate text-caption"
            style={{ color: 'var(--ink-soft)' }}
          >
            {onThisDay.record.log}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function Post({
  record,
  index,
  mine,
  myName,
  partnerName,
  todayStr,
  onOpen,
  talkAboutState,
  talkAboutBusy,
  talkAboutDisabled,
  talkAboutDisabledReason,
  onToggleTalkAbout,
}: {
  record: DailyRecord;
  index: number;
  mine: boolean;
  myName: string;
  partnerName: string;
  todayStr: string;
  onOpen: () => void;
  talkAboutState: TalkAboutActorState;
  talkAboutBusy: boolean;
  talkAboutDisabled: boolean;
  talkAboutDisabledReason?: string;
  onToggleTalkAbout: () => void;
}) {
  const author = mine ? myName : partnerName;
  const hasMedia = (record.attachments?.length ?? 0) > 0;
  const marked = talkAboutState === 'mine' || talkAboutState === 'both';
  const partnerMarked = talkAboutState === 'partner_only' || talkAboutState === 'both';

  return (
    <article
      aria-busy={talkAboutBusy || undefined}
      className={index === 0 ? 'pb-2 pt-3' : 'pb-2'}
    >
      {/*
        작성자 이름은 홈 상단과 스토리 레일에 이미 있다. 포스트마다 반복하지 않고 사진부터
        보여 준다. 사진이 없으면 **글이 그 자리를 차지한다.**

        빈 사진 틀을 남기면 화면이 로딩 실패처럼 보인다. 글이 주인공인 하루는 구멍이 아니다.
      */}
      <div className="px-4">
        {hasMedia ? (
          <RecordMediaGallery attachments={record.attachments ?? []} recordId={record.id} />
        ) : record.contentUnavailable ? (
          <div
            className="flex items-center px-5 py-6"
            style={{ border: 'var(--stroke) solid var(--ink-faint)', borderRadius: '10px 3px 12px 3px / 3px 12px 3px 10px' }}
          >
            <p className="text-label" style={{ color: 'var(--ink-soft)' }}>
              {record.contentUnavailable === 'key_unavailable'
                ? '이 기기에서 아직 이 기록을 열 수 없어요. 기기 연결이 끝나면 보여요.'
                : '이 기록을 열 수 없어요. 내용은 그대로 있지만 이 기기의 열쇠로는 읽을 수 없어요.'}
            </p>
          </div>
        ) : (
          <div
            className="flex items-center px-5 py-6"
            style={{
              border: 'var(--stroke) solid var(--ink-faint)',
              borderRadius: index % 2
                ? '10px 3px 12px 3px / 3px 12px 3px 10px'
                : '3px 12px 3px 10px / 12px 3px 10px 3px',
            }}
          >
            <p
              className="hand-text record-copy whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
              style={{ color: 'var(--ink)' }}
            >
              {record.log}
            </p>
          </div>
        )}
      </div>

      {hasMedia && record.log ? (
        <p
          className="hand-text record-copy whitespace-pre-wrap break-words px-4 pt-3 [overflow-wrap:anywhere]"
          style={{ color: 'var(--ink)' }}
        >
          {record.log}
        </p>
      ) : null}

      {/*
        글 아래의 액션 줄. 시간은 초를 버리고 분까지만, 원본과 책갈피는 44px 표적이다.
        **숫자가 없다.**

        좋아요 수·조회 수·본 사람은 §16의 비목표다. 세는 순간 두 사람 사이에 점수가
        생기고, 이 제품은 관계에 점수를 매기지 않는다.

        ## 공감·토닥이기가 아직 없는 이유

        상대의 기록에 남기는 반응은 **데이터 모델에 없다.** `record.reaction` 은 작성자가
        자기 기록에 다는 표식이지 보는 사람의 반응이 아니고, 보는 사람의 반응을 만들려면
        테이블과 RLS가 필요해 migration gate 가 판정한다.

        그래서 그 자리에 눌리는 버튼을 두지 않았다. 눌러도 아무 일이 없는 하트는 **보낸
        줄 아는 사람에게 거짓말**이고, 이 제품에서 그것은 상대가 내 반응을 봤을 것이라고
        믿게 만드는 종류의 거짓말이다. 자리는 비워 두고 되는 것만 답한다.
      */}
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-2 px-3 py-1">
        <p
          className="mr-auto flex min-h-11 items-center px-1 text-caption tabular-nums"
          style={{ color: 'var(--ink-soft)' }}
        >
          {timeAgo(record, todayStr)}
        </p>
        <button
          type="button"
          aria-label={`${author}의 기록 열기`}
          onClick={onOpen}
          className="press-response inline-flex min-h-11 items-center justify-center px-2 text-label font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          원문 보기
        </button>
        <Bookmark
          marked={marked}
          partnerMarked={partnerMarked}
          partnerName={partnerName}
          onToggle={onToggleTalkAbout}
          disabled={talkAboutDisabled}
          disabledReason={talkAboutDisabledReason}
          visibleLabel="이야기"
        />
      </div>
    </article>
  );
}
