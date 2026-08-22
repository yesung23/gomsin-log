import { useState } from 'react';
import { X, Check, ChevronRight } from 'lucide-react';
import { FIXTURE_RECORDS } from '../fixtures';

/**
 * 통화 모드 — 루프의 마지막 화살표.
 *
 * 인스타의 DM 자리에서 열린다. 이 앱의 출구가 앱 밖의 통화이므로, 인스타가 대화를 두는
 * 자리에 "통화하는 동안 옆에 있는 화면"이 온다.
 *
 * ## 절대 하지 않는 것 셋 (§8, 2026-08-21 개정)
 *
 *   1. **전화를 걸지 않는다.** `tel:` 이 어디에도 없다. 통화는 사용자가 알아서 하고
 *      이 화면은 그동안 옆에 있을 뿐이다.
 *   2. **통화에 관한 어떤 것도 기록하지 않는다.** 시각·길이·횟수 전부. 통화 기록은
 *      §16이 배제한 감시 표면 그 자체다.
 *   3. **`다음`은 건너뛰기이지 완료가 아니다.** 지나친 항목은 그대로 남는다.
 *
 * ## 왜 하나씩 크게 보여주나
 *
 * 표시는 하루 중 한 번의 탭이면 되는데, 지우는 것은 통화가 끝난 뒤 앱을 열고 목록을
 * 찾아 내려가는 일이었다. 아무도 그걸 하지 않아서 보관함이 쌓이기만 했고, 표시가
 * "이야기할 것"에서 "몇 달 전에 이야기한 것"으로 뜻이 바뀌었다. 그래서 완료를
 * **대화가 있는 자리**로 옮긴다.
 *
 * ## 각 완료는 독립적인 쓰기다
 *
 * 통화는 끝날 때 끝난다 -- 누가 끊거나, 신호가 끊기거나, 누가 들어오거나. 마지막에
 * 한 번에 저장하면 가장 흔한 이탈이 전부를 버린다. 세 개를 넘기고 나갔으면 세 개가 남는다.
 */

const TOPICS = FIXTURE_RECORDS.filter((r) => ['p-3', 'p-5'].includes(r.id));

export function InstaCall({ onClose }: { onClose?: () => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [position, setPosition] = useState(0);

  const remaining = TOPICS.filter((topic) => !done.has(topic.id));
  const current = remaining[position];
  /** 끝까지 넘겼는데 남은 것이 있다. 완료와 같지 않다. */
  const wrapped = !current && remaining.length > 0;

  return (
    <div className="notebook flex h-full flex-col">
      <header className="flex h-14 items-center px-3">
        <span className="print flex-1 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          통화 모드
        </span>
        <button type="button" aria-label="닫기" onClick={onClose} className="tap flex h-11 w-11 items-center justify-center">
          <X size={22} className="pen-icon" color="var(--ink)" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        {current ? (
          <>
            <p className="print pb-4 text-[12px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>
              {position + 1} / {remaining.length}
            </p>
            {/* 한 번에 하나, 폰을 귀에 댄 채로 읽을 수 있게 크게. */}
            <p className="hand text-[24px] leading-relaxed" style={{ color: 'var(--ink)' }}>
              {current.log.split('\n')[0]}
            </p>
          </>
        ) : remaining.length === 0 ? (
          <p className="hand text-[20px]" style={{ color: 'var(--ink)' }}>다 이야기했어요</p>
        ) : (
          <>
            <p className="hand text-[20px]" style={{ color: 'var(--ink)' }}>끝까지 봤어요</p>
            <p className="print pt-2 text-[12px]" style={{ color: 'var(--ink-soft)' }}>
              {remaining.length}개가 아직 남아 있어요
            </p>
          </>
        )}
      </div>

      <div className="space-y-2 px-5 pb-8">
        {current ? (
          <>
            <button
              type="button"
              onClick={() => setDone((set) => new Set(set).add(current.id))}
              className="tap ink-fill flex w-full items-center justify-center gap-2 py-4"
            >
              <Check size={17} strokeWidth={2.4} />
              <span className="print text-[15px] font-semibold">이야기했어요</span>
            </button>
            {/*
              `다음`은 건너뛰기다. 완료가 아니고 아무것도 쓰지 않는다.
              그래서 자리만 옮기고 목록은 그대로 둔다.
            */}
            <button
              type="button"
              onClick={() => setPosition(position + 1)}
              className="tap ink-box flex w-full items-center justify-center gap-1.5 py-3.5"
            >
              <span className="print text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>다음</span>
              <ChevronRight size={15} className="pen-icon" color="var(--ink)" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => (wrapped ? setPosition(0) : onClose?.())}
            className="tap ink-box flex w-full items-center justify-center py-3.5"
          >
            <span className="print text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
              {wrapped ? '처음부터 다시 보기' : '닫기'}
            </span>
          </button>
        )}

        <p className="print pt-1 text-center text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          전화는 직접 걸어요. 통화한 시각이나 길이는 남기지 않아요.
        </p>
      </div>
    </div>
  );
}
