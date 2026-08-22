import { useState } from 'react';
import { X, Bookmark, Heart, Stamp as StampIcon } from 'lucide-react';
import { InkCircle, PenFace, PhotoFrame } from './common';
import { FIXTURE_RECORDS, TODAY } from '../fixtures';
import type { PreviewRecord } from '../fixtures';

/**
 * 스토리 — 인스타 뷰어와 같은 구조.
 *
 * ## 첫 장은 하루 요약이다
 *
 * 링을 누르면 순간이 바로 오지 않고 **그날 무슨 일이 있었는지 한 장**이 먼저 온다.
 * 줄을 고르면 그 순간으로 간다. §6.1의 두 층 -- 판단 화면(요약)과 근거 화면(원문) --
 * 이 하나의 흐름 안에서 두 깊이가 되는 방식이다.
 *
 * ## 원본 보기 버튼이 없는 이유
 *
 * 있었다가 뺐다. 순간 카드가 **이미 원문 전체**를 보여주므로 그 버튼이 갈 곳이 없었다.
 * 요약 → 원문의 이동은 첫 장의 줄이 담당한다.
 *
 * ## 화살표와 카운터가 없는 이유
 *
 * 인스타에는 둘 다 없다. 위치는 상단 막대가 이미 말하고, 이동은 화면을 누르는 것이다.
 * 처음에는 접근성 때문에 이름 있는 화살표를 뒀는데 그건 문제를 잘못 푼 것이었다 --
 * **탭 영역도 이름을 가질 수 있다.** 좌우를 `aria-label` 붙은 버튼으로 두면 인스타의
 * 제스처와 스크린리더 지원을 둘 다 얻고, 키보드 좌우도 그대로 동작한다.
 *
 * ## 자동으로 넘어가지 않는다
 *
 * 인스타는 6초마다 넘어간다. 자동 진행은 원본을 스치게 만들고, 사흘 놓친 사람의 순간을
 * 지나가게 하며, WCAG 2.2.2에 걸린다. 상단 막대는 시간이 아니라 **위치**다.
 */

/**
 * 진행 바가 감당하는 칸 수.
 *
 * 인스타는 순간이 많아져도 칸을 계속 쪼갠다. 그런데 390px 화면에서 20칸이면 칸 하나가
 * 15px, 40칸이면 6px이 되어 **위치를 읽을 수 없는 장식**이 된다. 그래서 상한을 두고,
 * 넘으면 현재 위치를 중심으로 창을 밀며 양 끝에 남은 수를 적는다.
 *
 * 12는 390px에서 칸 하나가 약 27px -- 손가락으로 짚을 수 있는 최소치다.
 */
const MAX_SEGMENTS = 12;

const moments = FIXTURE_RECORDS.filter(
  (r) => r.userId === 'partner-fixture' && r.date === TODAY,
);

/** 요약 한 줄. 원문 앞부분을 그대로 쓰고 앱이 문장을 만들지 않는다(§6.2). */
function summaryLine(log: string): string {
  const first = log.split('\n')[0].trim();
  return first.length <= 28 ? first : `${first.slice(0, 27).trimEnd()}…`;
}

export function InstaStory({
  onClose,
  momentCount,
}: {
  onClose?: () => void;
  /** 확인용. 진행 바가 칸 수에 따라 어떻게 되는지 기기에서 보기 위한 것이다. */
  momentCount?: number;
}) {
  const shown: PreviewRecord[] = momentCount
    ? Array.from({ length: momentCount }, (_, i) => ({
      ...moments[i % moments.length],
      id: `sim-${i}`,
      time: `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
    }))
    : moments;

  /** 0 = 요약, 1.. = 순간. 요약도 한 장이므로 진행 바가 세는 칸에 포함된다. */
  const [index, setIndex] = useState(0);
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const total = shown.length + 1;
  const moment = index === 0 ? null : shown[index - 1];
  const last = index === total - 1;

  const go = (next: number) => setIndex(Math.min(Math.max(next, 0), total - 1));

  const toggle = () => {
    if (!moment) return;
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(moment.id)) next.delete(moment.id);
      else next.add(moment.id);
      return next;
    });
  };

  return (
    <div
      className="notebook relative flex h-full flex-col"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        else if (event.key === 'Escape') { event.preventDefault(); onClose?.(); }
      }}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="춘향의 오늘"
    >
      <p className="sr-only" aria-live="polite">
        {index === 0 ? `${total}장 중 1장, 오늘 요약` : `${total}장 중 ${index + 1}장, ${moment?.time}`}
      </p>

      <ProgressBar total={total} index={index} />

      <header className="relative z-10 flex h-14 items-center gap-2.5 px-3">
        <InkCircle size={34}><PenFace size={24} /></InkCircle>
        <span className="print text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>춘향</span>
        <span className="print text-[12px]" style={{ color: 'var(--ink-soft)' }}>
          {moment ? moment.time : '오늘'}
        </span>
        <span className="flex-1" />
        <button type="button" aria-label="스토리 닫기" onClick={onClose} className="tap flex h-11 w-11 items-center justify-center">
          <X size={22} className="pen-icon" color="var(--ink)" />
        </button>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center gap-3 px-5 pb-2">
        {moment ? <Moment record={moment} /> : <DaySummary items={shown} onPick={(i) => go(i + 1)} />}
      </div>

      {/*
        좌우가 이동이다.

        진행 바 아래·액션 줄 위에만 깔린다. 액션 버튼을 덮으면 책갈피를 누르려던 손가락이
        다음 장으로 넘겨 버린다. 인스타도 왼쪽이 좁고 오른쪽이 넓다 -- 되돌아가는 것보다
        넘기는 일이 훨씬 잦기 때문이다.
      */}
      <button
        type="button" aria-label="이전 순간" onClick={() => go(index - 1)} disabled={index === 0}
        className="absolute left-0 top-20 bottom-20 z-0 w-1/3 disabled:pointer-events-none"
      />
      <button
        type="button" aria-label={last ? '스토리 닫기' : '다음 순간'}
        onClick={() => (last ? onClose?.() : go(index + 1))}
        className="absolute right-0 top-20 bottom-20 z-0 w-2/3"
      />

      {/* 액션 줄. 요약 장에는 없다 -- 대상이 되는 한 순간이 없기 때문이다. */}
      <div
        className="relative z-10 flex h-16 items-center gap-1 px-3"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {moment ? (
          <>
            <button type="button" aria-label="공감" className="tap flex h-11 w-11 items-center justify-center">
              <Heart size={22} className="pen-icon" color="var(--ink)" fill="none" />
            </button>
            <button type="button" aria-label="토닥이기" className="tap flex h-11 w-11 items-center justify-center">
              <StampIcon size={21} className="pen-icon" color="var(--ink)" fill="none" />
            </button>
            <span className="flex-1" />
            <button type="button" aria-label="이따 이야기하기" onClick={toggle} className="tap flex h-11 w-11 items-center justify-center">
              <Bookmark
                size={21} className="pen-icon"
                color={marked.has(moment.id) ? 'var(--accent)' : 'var(--ink)'}
                fill={marked.has(moment.id) ? 'var(--accent)' : 'none'}
              />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ProgressBar({ total, index }: { total: number; index: number }) {
  /*
    칸이 상한을 넘으면 현재 위치를 중심으로 창을 민다.

    양 끝의 `+N` 은 잘려 나간 수다 -- 없으면 사용자는 자기가 몇 번째인지도, 얼마나 남았는지도
    모른 채 칸만 본다. 인스타는 이 경우를 그냥 얇게 처리하는데, 390px 에서 40칸은 칸 하나가
    6px 이라 위치를 읽을 수 없는 장식이 된다.
  */
  const windowed = total > MAX_SEGMENTS;
  const start = windowed ? Math.min(Math.max(index - Math.floor(MAX_SEGMENTS / 2), 0), total - MAX_SEGMENTS) : 0;
  const end = windowed ? start + MAX_SEGMENTS : total;

  return (
    <div
      className="relative z-10 flex items-center gap-1 px-3 pt-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      {windowed && start > 0 ? (
        <span className="print shrink-0 pr-0.5 text-[10px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>
          +{start}
        </span>
      ) : null}

      {Array.from({ length: end - start }, (_, offset) => {
        const position = start + offset;
        return (
          <span
            key={position}
            className="h-[3px] flex-1 rounded-full"
            // 손가락으로 짚을 수 있는 최소 폭. 이보다 얇아지면 장식이 된다.
            style={{
              minWidth: 6,
              background: position <= index ? 'var(--ink)' : 'var(--ink-faint)',
            }}
          />
        );
      })}

      {windowed && end < total ? (
        <span className="print shrink-0 pl-0.5 text-[10px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>
          +{total - end}
        </span>
      ) : null}
    </div>
  );
}

function Moment({ record }: { record: PreviewRecord }) {
  /*
    사진이 없으면 글이 화면의 주인공이 된다.

    사진 자리를 비워 두면 구멍이 되고, 글이 그 자리를 차지하면 글이 주인공인 하루가 된다.
    인스타의 텍스트 스토리와 같은 자리이되 배경이 그라디언트가 아니라 공책이다 -- 그래서
    글자를 키우고 가운데에 두는 것만으로 충분하다.

    사진 유무는 `index % 2` 같은 자리가 아니라 **기록의 성질**이 정한다. 자리로 정하면
    같은 기록이 순서에 따라 사진이 있었다 없었다 한다.
  */
  if (!record.hasPhoto) {
    return (
      <div className="flex min-h-0 flex-1 items-center overflow-y-auto py-4">
        <p
          className="hand w-full whitespace-pre-wrap break-keep text-center"
          style={{
            color: 'var(--ink)',
            // 짧은 글은 크게, 긴 글은 작게. 다섯 줄짜리가 화면을 넘지 않아야 한다.
            fontSize: record.log.length > 90 ? 19 : record.log.length > 40 ? 23 : 28,
            lineHeight: 1.7,
          }}
        >
          {record.log}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <PhotoFrame ratio="4 / 5" fit />
      </div>
      <p className="hand max-h-[28%] shrink-0 overflow-y-auto whitespace-pre-wrap break-keep text-[17px]" style={{ color: 'var(--ink)' }}>
        {record.log}
      </p>
    </>
  );
}

function DaySummary({
  items,
  onPick,
}: {
  items: PreviewRecord[];
  onPick: (index: number) => void;
}) {
  /*
    최대 5줄. 한 줄은 한 사건이다(§6.2).

    순간이 다섯을 넘으면 나머지는 넘겨서 본다 -- 요약이 스무 줄이면 그건 요약이 아니라
    목록이고, 목록은 화면을 넘긴다.
  */
  const lines = items.slice(0, 5);
  const rest = items.length - lines.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <p className="print pb-1 text-[12px]" style={{ color: 'var(--ink-soft)' }}>오늘</p>
      <div className="ink-rule mb-4" />
      <ul className="space-y-1">
        {lines.map((item, position) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onPick(position)}
              className="tap flex min-h-11 w-full items-baseline gap-3 text-left"
            >
              <span className="print shrink-0 text-[12px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                {item.time}
              </span>
              {/* 사람이 쓴 글이므로 손글씨. 시간은 앱이 아는 사실이라 인쇄체. */}
              <span className="hand text-[16px]" style={{ color: 'var(--ink)' }}>
                {summaryLine(item.log)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="print pt-5 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
        {rest > 0 ? `줄을 누르면 그 순간으로 가요 · 넘기면 ${rest}개 더 있어요` : '줄을 누르면 그 순간으로 가요'}
      </p>
    </div>
  );
}
