import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bookmark, ChevronLeft, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import type { DailyRecord } from '@/types';

/**
 * 이야기할 것 — 인스타의 `저장됨` 자리.
 *
 * 인스타의 저장은 나중에 볼 것을 모아 두는 곳이고, 여기 책갈피도 같은 개념이다. 다른
 * 점은 **이것이 다음 통화의 목차**라는 것 -- 그래서 목록 끝에 통화 모드로 가는 길이 있다.
 *
 * ## 완료 버튼이 없는 이유
 *
 * `이야기했어요` 를 두지 않는다. 체크에 "했어요"는 정확히 할 일 목록의 문법이고, §8이
 * **작업 관리자로 만들지 않는다**고 못 박은 모양이다. 목록을 비우는 일이 숙제가 되면
 * 표시하는 일도 숙제가 된다.
 *
 * 인스타에는 완료가 없다 -- **저장과 저장 취소**뿐이고, 다 본 것은 책갈피를 눌러 뺀다.
 * 여기서도 같다. 동사가 없으므로 잘한 일도 못 한 일도 되지 않고, 그냥 자리를 정리하는
 * 동작이 된다.
 *
 * §8: 자유 텍스트 메모 없음, 담당자 지정 없음, 마감일 없음, 별도 하단 탭 없음, 앱 아이콘
 * 배지 없음. **자동 만료도 없다** -- 날짜가 지나도 남고 독촉하지 않는다. 이야기하지 못한
 * 것은 밀린 일이 아니라 아직 이야기하지 않은 것이다.
 *
 * 개수를 부채처럼 적지 않는다. `3개 밀림` 같은 말을 쓰지 않고 숫자는 사실로만 적는다.
 */

export function SavedTopicsPage() {
  const navigate = useNavigate();
  const { state, unmarkTalkAbout } = useStore();
  const { profile, talkAboutMarks } = state;

  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: profile.id,
      role: profile.role,
    }),
    [state.records, profile.id, profile.role],
  );

  /*
    표시된 기록을 원본과 이어 붙인다.

    표시는 `record_id` 만 들고 있고 본문은 서버가 모른다(§17). 본문이 이 기기에 없으면
    -- 지워졌거나 비공개로 바뀌었거나 열쇠가 없으면 -- **다른 기록으로 대체하지 않는다.**
    그 줄은 사실대로 비운다.
  */
  const topics = useMemo(() => {
    const byId = new Map(records.map((record) => [record.id, record]));
    return (talkAboutMarks ?? []).map((mark) => ({
      id: mark.recordId,
      record: byId.get(mark.recordId) ?? null,
    }));
  }, [records, talkAboutMarks]);

  const remove = async (recordId: string) => {
    const result = await unmarkTalkAbout(recordId);
    if (!result.ok) toast.error(result.error || '책갈피를 빼지 못했어요.');
  };

  return (
    <div className="notebook flex min-h-screen min-h-[100dvh] flex-col">
      <header
        className="flex h-14 items-center gap-1 px-3"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button
          type="button"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
          className="flex h-11 w-11 items-center justify-center"
        >
          <ChevronLeft size={22} className="pen-icon" color="var(--ink)" aria-hidden="true" />
        </button>
        <span className="flex-1 text-body font-semibold" style={{ color: 'var(--ink)' }}>
          이야기할 것
        </span>
      </header>

      <div className="min-h-0 flex-1 px-4 pb-24">
        {topics.length === 0 ? (
          <p className="pt-12 text-center text-label" style={{ color: 'var(--ink-soft)' }}>
            책갈피가 비었어요
          </p>
        ) : (
          <ul>
            {topics.map(({ id, record }) => (
              <Topic
                key={id}
                recordId={id}
                record={record}
                partnerName={profile.couple.partnerName || '상대'}
                myName={profile.myName || '나'}
                viewerId={profile.id}
                onOpen={() => navigate(`/record?record=${encodeURIComponent(id)}`)}
                onRemove={() => void remove(id)}
              />
            ))}
          </ul>
        )}

        {/* 남은 것이 없으면 통화 모드로 보내지 않는다 -- 빈 화면으로 들어가게 된다(§8). */}
        {topics.length > 0 ? (
          <button
            type="button"
            onClick={() => navigate('/call')}
            className="ink-fill mt-4 flex w-full items-center justify-center gap-2 py-3.5"
          >
            <Phone size={16} strokeWidth={2} aria-hidden="true" />
            <span className="text-label font-semibold">통화하면서 하나씩 보기</span>
          </button>
        ) : null}

        <p
          className="whitespace-pre-line pt-4 text-center text-caption leading-relaxed"
          style={{ color: 'var(--ink-soft)' }}
        >
          이야기 나눈 건 책갈피를 빼면 여기서 사라져요.{'\n'}날짜가 지나도 저절로 없어지지 않고, 재촉하지 않아요.
        </p>
      </div>
    </div>
  );
}

function Topic({
  recordId,
  record,
  partnerName,
  myName,
  viewerId,
  onOpen,
  onRemove,
}: {
  recordId: string;
  record: DailyRecord | null;
  partnerName: string;
  myName: string;
  viewerId?: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const author = record ? (record.userId === viewerId ? myName : partnerName) : null;
  const [, month, day] = record ? record.date.split('-') : [null, null, null];

  return (
    <li className="py-4">
      <p className="pb-1 text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>
        {record && author
          ? `${author} · ${Number(month)}월 ${Number(day)}일 ${record.time}`
          : '표시해 둔 기록'}
      </p>

      {/*
        원문 그대로. 앱이 주제를 지어내지 않는다 -- 서버는 이 글을 모른다(§17).

        본문이 없으면 그 사실을 말한다. 다른 기록으로 채우면 사용자는 자기가 표시한 것이
        무엇이었는지 영영 알 수 없게 된다.
      */}
      {record && !record.contentUnavailable ? (
        <p className="hand-text text-body" style={{ color: 'var(--ink)' }}>
          {record.log.split('\n')[0]}
        </p>
      ) : (
        <p className="text-label" style={{ color: 'var(--ink-soft)' }}>
          {record?.contentUnavailable === 'key_unavailable'
            ? '이 기기에서 아직 열 수 없어요'
            : '이 기록은 더 이상 볼 수 없어요'}
        </p>
      )}

      <div className="flex items-center gap-1 pt-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-11 items-center gap-1 px-1"
          aria-label={`${recordId} 원본 보기`}
        >
          <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>원본 보기</span>
          <ArrowUpRight size={13} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
        </button>
        <span className="flex-1" />
        {/*
          채워진 책갈피. 누르면 이 줄이 빠진다.

          인스타의 저장 취소와 같은 자리, 같은 아이콘, 같은 동작이다. 동사를 붙이지 않는
          것이 요점 -- `했어요` 가 붙는 순간 숙제가 된다.
        */}
        <button
          type="button"
          aria-label="책갈피 빼기"
          onClick={onRemove}
          className="flex min-h-11 w-11 items-center justify-center"
        >
          <Bookmark
            size={19}
            className="pen-icon"
            color="var(--ink-accent)"
            fill="var(--ink-accent)"
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="ink-rule mt-3" aria-hidden="true" />
    </li>
  );
}
