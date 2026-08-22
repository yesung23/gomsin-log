import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Bookmark, Heart } from 'lucide-react';
import { InkCircle, PenFace, PhotoFrame } from './common';
import { FIXTURE_RECORDS, TODAY } from '../fixtures';

/**
 * 스토리 — 인스타 뷰어와 같은 구조.
 *
 *     상단 세그먼트 진행 바
 *     아바타 + 이름 + 시간          우측 ✕
 *     전체화면 콘텐츠
 *     하단 액션
 *
 * 인스타와 다른 것은 둘이다.
 *
 *   1. **자동으로 넘어가지 않는다.** 인스타는 6초마다 넘어가는데, 자동 진행은 원본을
 *      스치게 만들고 사흘 놓친 사람의 순간들을 지나가게 하며 WCAG 2.2.2에 걸린다.
 *      상단 막대는 시간이 아니라 **위치**다.
 *   2. **답장 입력창이 없다.** 인스타는 하단에 메시지 입력이 있다. 이 앱의 출구는
 *      앱 밖의 통화이고, 자체 채팅은 만들지 않는다.
 */

const moments = FIXTURE_RECORDS.filter((r) => r.userId === 'partner-fixture' && r.date === TODAY);

export function InstaStory({ onClose }: { onClose?: () => void }) {
  const [index, setIndex] = useState(0);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const moment = moments[index];
  const last = index === moments.length - 1;

  const toggle = () => {
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(moment.id)) next.delete(moment.id);
      else next.add(moment.id);
      return next;
    });
  };

  return (
    <div className="notebook flex h-full flex-col">
      {/* 진행 바 — 채워지는 애니메이션이 없다. 시간이 흐르지 않기 때문이다. */}
      <div className="flex gap-1 px-3 pt-3">
        {moments.map((_, position) => (
          <span
            key={position}
            className="h-[3px] flex-1 rounded-full"
            style={{ background: position <= index ? 'var(--ink)' : 'var(--ink-faint)' }}
          />
        ))}
      </div>

      <header className="flex h-14 items-center gap-2.5 px-3">
        <InkCircle size={34}><PenFace size={24} /></InkCircle>
        <span className="print text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>춘향</span>
        <span className="print text-[12px]" style={{ color: 'var(--ink-soft)' }}>{moment.time}</span>
        <span className="flex-1" />
        <button type="button" aria-label="스토리 닫기" onClick={onClose} className="tap flex h-11 w-11 items-center justify-center">
          <X size={22} className="pen-icon" color="var(--ink)" />
        </button>
      </header>

      {/*
        미디어는 남는 공간에 맞춘다.

        인스타의 스토리는 화면을 채우되 하단 컨트롤을 밀어내지 않는다. `min-h-0` 이 없으면
        flex 자식이 콘텐츠 크기 아래로 줄지 않아서, 사진 틀이 화면을 다 먹고 액션 줄과
        좌우 이동이 화면 밖으로 밀린다 -- 실제로 그렇게 만들었다가 스크린샷에서 잡혔다.
      */}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-5 pb-2">
        {index % 2 === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <PhotoFrame ratio="4 / 5" fit />
          </div>
        ) : null}
        {/*
          사진이 없으면 글이 화면의 주인공이 된다.

          사진 자리를 비워 두면 구멍이 되고, 글이 그 자리를 차지하면 글이 주인공인
          하루가 된다. 사진을 잘 올리지 않는 커플에게 구멍이 생기지 않는 이유다.
        */}
        <p className="hand shrink-0 overflow-y-auto text-[17px] whitespace-pre-wrap break-keep" style={{ color: 'var(--ink)' }}>
          {moment.log}
        </p>
      </div>

      <div className="flex h-14 items-center gap-1 px-3">
        <button type="button" aria-label="공감" className="tap flex h-11 w-11 items-center justify-center">
          <Heart size={22} className="pen-icon" color="var(--ink)" fill="none" />
        </button>
        <button
          type="button"
          aria-label="이따 이야기하기"
          onClick={toggle}
          className="tap flex h-11 w-11 items-center justify-center"
        >
          <Bookmark
            size={21}
            className="pen-icon"
            color={marked.has(moment.id) ? 'var(--accent)' : 'var(--ink)'}
            fill={marked.has(moment.id) ? 'var(--accent)' : 'none'}
          />
        </button>
        <span className="flex-1" />
        <button type="button" className="tap ink-chip px-3 py-1.5">
          <span className="print text-[12px]" style={{ color: 'var(--ink)' }}>원본 보기</span>
        </button>
      </div>

      {/* 좌우 이동. 화면 절반을 탭 영역으로 쓰지 않는다 -- 이름 없는 큰 영역 둘이 된다. */}
      <div className="flex items-center justify-between px-3 pb-4">
        <button
          type="button" aria-label="이전 순간" disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          className="tap flex h-11 w-11 items-center justify-center disabled:opacity-25"
        >
          <ChevronLeft size={22} className="pen-icon" color="var(--ink)" />
        </button>

        {last ? (
          <button type="button" onClick={onClose} className="tap ink-fill px-5 py-2.5">
            <span className="print text-[13px] font-semibold">다 읽었어요</span>
          </button>
        ) : (
          <span className="print text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            {index + 1} / {moments.length}
          </span>
        )}

        <button
          type="button" aria-label="다음 순간" disabled={last}
          onClick={() => setIndex((i) => Math.min(i + 1, moments.length - 1))}
          className="tap flex h-11 w-11 items-center justify-center disabled:opacity-25"
        >
          <ChevronRight size={22} className="pen-icon" color="var(--ink)" />
        </button>
      </div>
    </div>
  );
}
