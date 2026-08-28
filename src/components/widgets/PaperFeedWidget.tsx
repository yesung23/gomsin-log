import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { usePartnerDay } from '@/lib/usePartnerDay';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { isRecordContentAvailable } from '@/lib/recordAvailability';
import { localToday, toLocalDateString } from '@/lib/utils';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import { PaperCard, Bookmark, FoldDivider } from '@/components/paper';
import type { DailyRecord } from '@/types';

/**
 * 우리의 지면 — 둘이 함께 쌓아 온 최근.
 *
 * ## 같은 기록이 두 자리에 있지 않다
 *
 * 이것이 이 위젯에서 가장 중요한 규칙이다. 인스타에서 스토리는 지금이고 피드는 쌓인
 * 것이며, 같은 게시물이 두 곳에 동시에 있지 않다. 2026-08-20에 되돌린 대화형 홈은
 * 요약 카드가 바로 아래 말풍선을 그대로 반복해서 실패했다.
 *
 * 처음에는 날짜로만 갈랐다 -- 오늘은 스토리에, 어제부터는 지면에. **그것으로는 부족했고
 * 테스트가 잡았다.** `상대방의 오늘`이 다루는 것은 오늘이 아니라 **마지막 확인 이후 놓친
 * 구간**(§6.1)이라, 사흘 못 본 사람에게는 그 구간이 어제·그제까지 뻗는다. 날짜로 자르면
 * 그 겹치는 이틀이 두 자리에 동시에 나온다.
 *
 * 그래서 경계를 날짜가 아니라 **확인 여부**로 긋는다.
 *
 *     아직 확인하지 않은 것   →  스토리 · 상대방의 오늘
 *     확인했고 오늘이 아닌 것 →  지면
 *     지난 달                 →  우리 탭 격자
 *
 * 이 규칙이 더 정확할 뿐 아니라 더 옳다. 지면은 "따라잡을 것"이 아니라 "쌓인 것"을 보는
 * 곳이고, 아직 못 본 기록은 쌓인 것이 아니라 밀린 것이다.
 *
 * ## 끝이 있다
 *
 * 무한 스크롤이 아니다. 최근 7일에서 멈추고 마침 카드가 그것을 말한다. 그래서 기록이
 * 적은 커플의 화면은 *빈 화면*이 아니라 *다 읽은 화면*이 된다 -- 되돌린 피드가 실패한
 * 두 번째 이유(밀도)에 대한 답이 이것이다.
 *
 * ## 둘의 기록이 섞인다
 *
 * 스토리는 한 사람의 시점이고 지면은 둘의 것이다. 그래서 같은 기록을 두 번 보여주는 것이
 * 아니라 서로 다른 일을 한다 -- 스토리는 상대를 따라잡는 곳, 지면은 둘이 쌓은 것을
 * 보는 곳이다.
 */

/** 지면이 담는 기간. 그 앞은 `우리` 탭이 소유한다. */
export const FEED_DAYS = 7;

function daysAgo(todayStr: string, days: number): string {
  const date = localToday();
  date.setDate(date.getDate() - days);
  return toLocalDateString(date) <= todayStr ? toLocalDateString(date) : todayStr;
}

export function PaperFeedWidget() {
  const navigate = useNavigate();
  const { state, markTalkAbout, unmarkTalkAbout } = useStore();
  const { profile } = state;

  /*
    `persist: false`. 지면은 무엇이 아직 안 읽혔는지 **읽기만** 한다.

    영수증을 쓰는 화면은 스토리 뷰어 하나여야 한다. 홈을 스쳐 지나간 것만으로 확인이
    되면 확인이 "다 읽었다"는 뜻을 잃는다.
  */
  const { surface } = usePartnerDay();

  const todayStr = toLocalDateString(localToday());
  const since = daysAgo(todayStr, FEED_DAYS);

  const viewer = useMemo(
    () => ({ userId: profile.id, role: profile.role }),
    [profile.id, profile.role],
  );

  /** 아직 확인하지 않은 것. 이것들은 스토리와 `상대방의 오늘`이 소유한다. */
  const outstandingIds = useMemo(
    () => new Set(surface.map((record) => record.id)),
    [surface],
  );

  const entries = useMemo(() => {
    const visible = visibleRecordsForViewer(state.records ?? [], viewer);
    return visible
      // 오늘은 스토리가 소유한다.
      .filter((record) => record.date < todayStr && record.date >= since)
      // 아직 못 본 것도 스토리가 소유한다. 놓친 구간은 어제까지 뻗을 수 있다.
      .filter((record) => !outstandingIds.has(record.id))
      .filter(isRecordContentAvailable)
      .sort((a, b) => `${b.date}T${b.time || ''}`.localeCompare(`${a.date}T${a.time || ''}`));
  }, [state.records, viewer, todayStr, since, outstandingIds]);

  const markedRecordIds = useMemo(
    () => new Set(
      (state.talkAboutMarks ?? []).filter((mark) => !mark.isCompleted).map((mark) => mark.recordId),
    ),
    [state.talkAboutMarks],
  );

  return (
    <section aria-label="우리의 지면" data-testid="paper-feed" className="space-y-4">
      {entries.map((record) => (
        <FeedPost
          key={record.id}
          record={record}
          mine={isOwnRecord(record, viewer)}
          myName={profile.myName}
          partnerName={profile.couple.partnerName || '상대방'}
          coupleId={profile.couple.coupleId || undefined}
          marked={markedRecordIds.has(record.id)}
          onOpen={() => navigate(`/story/day/${record.date}?at=${record.id}`)}
          onToggleBookmark={() => {
            void (markedRecordIds.has(record.id)
              ? unmarkTalkAbout(record.id)
              : markTalkAbout(record.id));
          }}
        />
      ))}

      {/*
        마침 카드.

        끝을 말하지 않으면 짧은 화면은 "비어 있다"로 읽히고, 말하면 "다 읽었다"로 읽힌다.
        무한 스크롤이 없기 때문에 할 수 있는 처리다.
      */}
      <PaperCard className="text-center">
        <p className="text-caption text-muted-foreground">
          {entries.length > 0 ? '여기까지가 지난 7일이에요' : '아직 함께 쌓은 지면이 없어요'}
        </p>
        <button
          type="button"
          onClick={() => navigate('/us')}
          className="press-response mt-4 inline-flex min-h-11 items-center gap-1 rounded-control px-3 text-label font-semibold text-foreground"
        >
          지난 날 보기
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </PaperCard>
    </section>
  );
}

function FeedPost({
  record,
  mine,
  myName,
  partnerName,
  coupleId,
  marked,
  onOpen,
  onToggleBookmark,
}: {
  record: DailyRecord;
  mine: boolean;
  myName: string;
  partnerName: string;
  coupleId?: string;
  marked: boolean;
  onOpen: () => void;
  onToggleBookmark: () => void;
}) {
  const attachments = record.attachments ?? [];
  const body = (record.log ?? '').trim();
  const [, month, day] = record.date.split('-');

  return (
    <article className="space-y-2">
      <header className="flex items-baseline gap-2">
        <span className="text-label font-semibold text-foreground">{mine ? myName : partnerName}</span>
        {/* 시간은 앱이 아는 사실이므로 인쇄체다. */}
        <span className="text-caption text-muted-foreground tabular-nums">
          {Number(month)}월 {Number(day)}일 {record.time}
        </span>
      </header>

      {attachments.length > 0 ? (
        <RecordMediaGallery attachments={attachments} recordId={record.id} coupleId={coupleId} />
      ) : null}

      {body ? (
        // 사람이 쓴 글이므로 손글씨다.
        <p className="hand-text record-copy whitespace-pre-wrap break-keep text-foreground">{body}</p>
      ) : null}

      <div className="flex items-center gap-1">
        {/*
          내 기록에는 책갈피를 붙이지 않는다. `이따 이야기하기`는 상대와의 대화 예고이지
          나 자신에게 남기는 메모가 아니다. 비공개 기록에 붙지 않는 것과 같은 이유다.
        */}
        {!mine && !record.isPrivate ? (
          <Bookmark marked={marked} onToggle={onToggleBookmark} />
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpen}
          className="press-response inline-flex min-h-11 items-center rounded-control px-3 text-label font-semibold text-muted-foreground"
        >
          그날 보기
        </button>
      </div>
      <FoldDivider />
    </article>
  );
}
