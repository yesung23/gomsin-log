import { useState } from 'react';
import { ChevronLeft, Bookmark, ArrowUpRight, Phone } from 'lucide-react';
import { FIXTURE_RECORDS } from '../fixtures';

/**
 * 이야기거리 보관함 — 인스타의 `저장됨` 자리.
 *
 * 인스타의 저장은 나중에 볼 것을 모아 두는 곳이고, 여기 책갈피도 같은 개념이다.
 * 다른 점은 **이것이 다음 통화의 목차**라는 것 -- 그래서 목록 끝에 통화 모드로 가는
 * 길이 있다.
 *
 * ## 완료 버튼이 없는 이유
 *
 * 처음에는 `이야기했어요` 버튼을 뒀다가 뺐다. 체크 아이콘에 "했어요"는 정확히 할 일
 * 목록의 문법이고, §8이 **작업 관리자로 만들지 않는다**고 못 박은 바로 그 모양이다.
 * 목록을 비우는 일이 숙제가 되면 표시하는 일도 숙제가 된다.
 *
 * 인스타에는 완료가 없다. **저장과 저장 취소**뿐이고, 다 본 것은 책갈피를 눌러 뺀다.
 * 여기서도 같다 -- 채워진 책갈피를 누르면 그 줄이 목록에서 빠진다. 동사가 없으므로
 * 잘한 일도 못 한 일도 되지 않고, 그냥 자리를 정리하는 동작이 된다.
 *
 * §8: 자유 텍스트 메모 없음, 담당자 지정 없음, 마감일 없음, 별도 하단 탭 없음,
 * 앱 아이콘 배지 없음. **자동 만료도 없다** -- 날짜가 지나도 남고, 독촉하지 않는다.
 * 이야기하지 못한 것은 밀린 일이 아니라 아직 이야기하지 않은 것이다.
 *
 * ## 개수를 부채처럼 적지 않는다
 *
 * `3개 밀림` 같은 말을 쓰지 않는다. 숫자는 사실로만 적는다.
 */

const TOPICS = FIXTURE_RECORDS.filter((r) => ['p-3', 'p-5'].includes(r.id));

export function InstaSaved({ onClose, onCall }: { onClose?: () => void; onCall?: () => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const remaining = TOPICS.filter((topic) => !done.has(topic.id));

  return (
    <div className="notebook flex h-full flex-col">
      <header className="flex h-14 items-center gap-1 px-3">
        <button type="button" aria-label="뒤로" onClick={onClose} className="tap flex h-11 w-11 items-center justify-center">
          <ChevronLeft size={22} className="pen-icon" color="var(--ink)" />
        </button>
        <span className="print flex-1 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          이야기할 것
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {remaining.length === 0 ? (
          <p className="print pt-10 text-center text-[13px]" style={{ color: 'var(--ink-soft)' }}>
책갈피가 비었어요
          </p>
        ) : (
          <ul>
            {remaining.map((topic) => {
              const [, month, day] = topic.date.split('-');
              return (
                <li key={topic.id} className="py-4">
                  <p className="print pb-1 text-[11px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                    춘향 · {Number(month)}월 {Number(day)}일 {topic.time}
                  </p>
                  {/* 원문 그대로. 앱이 주제를 지어내지 않는다 -- 서버는 이 글을 모른다. */}
                  <p className="hand text-[16px]" style={{ color: 'var(--ink)' }}>
                    {topic.log.split('\n')[0]}
                  </p>
                  <div className="flex items-center gap-1 pt-2">
                    <button type="button" className="tap flex min-h-11 items-center gap-1 px-1">
                      <span className="print text-[12px]" style={{ color: 'var(--ink-soft)' }}>원본 보기</span>
                      <ArrowUpRight size={13} className="pen-icon" color="var(--ink-soft)" />
                    </button>
                    <span className="flex-1" />
                    {/*
                      채워진 책갈피. 누르면 이 줄이 빠진다.

                      인스타의 저장 취소와 같은 자리, 같은 아이콘, 같은 동작이다. 동사를
                      붙이지 않는 것이 요점 -- `했어요`가 붙는 순간 숙제가 된다.
                    */}
                    <button
                      type="button"
                      aria-label="책갈피 빼기"
                      onClick={() => setDone((current) => new Set(current).add(topic.id))}
                      className="tap flex min-h-11 w-11 items-center justify-center"
                    >
                      <Bookmark size={19} className="pen-icon" color="var(--accent)" fill="var(--accent)" />
                    </button>
                  </div>
                  <div className="ink-rule mt-3" />
                </li>
              );
            })}
          </ul>
        )}

        {/*
          통화 모드로 가는 길.

          남은 항목이 0이면 숨긴다 -- 빈 화면으로 보내지 않는다(§8 통화 모드 절).
        */}
        {remaining.length > 0 ? (
          <button type="button" onClick={onCall} className="tap ink-fill mt-4 flex w-full items-center justify-center gap-2 py-3.5">
            <Phone size={16} strokeWidth={2} />
            <span className="print text-[14px] font-semibold">통화하면서 하나씩 보기</span>
          </button>
        ) : null}

        <p className="print whitespace-pre-line pt-4 text-center text-[11px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
          이야기 나눈 건 책갈피를 빼면 여기서 사라져요.{'\n'}날짜가 지나도 저절로 없어지지 않고, 재촉하지 않아요.
        </p>
      </div>
    </div>
  );
}
