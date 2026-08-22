import { useMemo, useRef, useState } from 'react';
import type React from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Check } from 'lucide-react';

/**
 * 일정 — 인스타의 릴스 자리.
 *
 * 릴스가 "다른 종류의 것"을 보는 탭이듯, 여기는 이 앱에서 **유일하게 미래를 담는 탭**이다.
 * 다른 넷은 전부 과거와 현재다 -- 기록·탐색·작성·축적.
 *
 * ## 이 앱에서 달력은 여기뿐이다
 *
 *   일정 탭      월간 달력, 요일 정렬, 미래
 *   찾기 탭      날짜 피커(상시 노출 아님), 과거 탐색
 *   우리 격자    질감, 요일 비정렬, 과거 축적
 *
 * 달력 문법이 한 곳만 소유하지 않으면 일정과 우리가 섞인다. 그래서 여기만 요일을 맞춘다.
 * 달력 칸에 기록을 그리지 않는다 -- 기록은 과거이고 이 화면은 미래다.
 *
 * ## `+` 는 여러 날을 한 번에 고른다
 *
 * 커플 일정은 대부분 **연속된 날**이다 -- 휴가 3박 4일, 여행 닷새. 하루씩 네 번 넣게
 * 하면 같은 일정이 네 개가 되고, `우리` 격자에도 네 번 찍힌다.
 *
 * 그런데 흩어진 날도 있다 -- 이번 달 외출 세 번. 그래서 **둘 다** 된다: 탭하면 그 하루가
 * 토글되고, 누른 채 끌면 지나간 날이 전부 잡힌다. 인스타 갤러리의 다중 선택과 같은
 * 문법이되, 순서가 의미를 갖지 않으므로 번호 대신 채운 표시를 쓴다.
 *
 * ## 군 복무 커플이 아닐 때
 *
 * §11 -- 군 복무는 집중된 초기 사용 사례이지 제품의 정체성이 아니다. 복무율 줄은 끄는
 * 것이 아니라 **없고**, 일정 종류에서도 면회·외박이 빠진다. 비활성으로 남기면 그 커플에게
 * 이 앱은 자기 것이 아닌 앱이 된다.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 2026년 8월. 1일이 토요일이라 앞이 6칸 빈다. */
const LEADING = 6;
const DAYS = 31;

const MARKED = (military: boolean): Record<number, string> => (military
  ? { 27: '면회', 30: '기념일' }
  : { 27: '만나는 날', 30: '기념일' });

const UPCOMING = (military: boolean) => [
  { days: 12, label: military ? '면회' : '만나는 날', when: '8월 27일 (목)' },
  { days: 33, label: '1주년', when: '9월 17일 (목)' },
];

/**
 * 종류는 늘리지 않는다.
 *
 * §9 -- 범용 캘린더를 만들지 않는다. 커플에게 의미 있는 종류만 두고 그 목록을 늘리지
 * 않는다. 군 복무 커플이 아니면 면회·외박·외출이 빠진다 -- 그 커플의 달력에 없는 말이다.
 */
const KINDS = (military: boolean) => (military
  ? ['면회', '외박', '외출', '휴가', '데이트', '기념일', '여행']
  : ['만나는 날', '데이트', '기념일', '여행']);

export function InstaPlan({ military = true }: { military?: boolean }) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [kind, setKind] = useState<string | null>(null);

  /*
    끌어서 범위 잡기.

    `anchor` 는 끌기가 시작된 날이고, 지나가는 날마다 범위를 다시 계산한다. 끌기가 끝나기
    전에는 `draft` 에만 담아 두었다가 놓을 때 확정한다 -- 그래야 되돌아 끌면 잡혔던 날이
    풀린다. 지나간 자리를 그대로 두면 끌기가 취소 불가능한 동작이 된다.

    ## 왜 `onPointerEnter` 가 아니라 좌표로 찾는가

    터치에서는 `pointerdown` 이 일어난 요소로 포인터가 **암묵적으로 캡처된다**. 손가락이
    11일 위로 옮겨가도 이벤트의 target 은 여전히 10일이고, 11일의 `onPointerEnter` 는
    영영 오지 않는다. 처음에 그렇게 짰다가 브라우저에서 확인하고 고쳤다 -- 마우스로는
    되고 폰에서는 안 되는, 정확히 이 앱의 대상에서만 죽는 종류의 코드였다.

    그래서 격자가 `pointermove` 를 받아 손가락 좌표 아래에 있는 날을 직접 찾는다. 캡처가
    어디로 걸려 있든 좌표는 거짓말하지 않는다.
  */
  const grid = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  /* 끌기로 끝난 제스처의 뒤따르는 click 을 삼킨다. 안 그러면 놓은 날이 곧바로 풀린다. */
  const swallowClick = useRef(false);
  /*
    확정할 값은 state 가 아니라 여기서 읽는다.

    `pointermove` 는 React 의 continuous 이벤트여서 그 안의 setState 는 즉시 flush 되지
    않는다. 손가락을 빠르게 튕기면 `pointerup` 이 그 렌더보다 먼저 도착하고, 그때
    `draft` 는 아직 null 이라 방금 잡은 범위가 통째로 사라진다. state 는 그리기 위해서만
    쓰고, 확정은 렌더 시점과 무관한 ref 에서 읽는다.
  */
  const pending = useRef<Set<number> | null>(null);
  const [draft, setDraft] = useState<Set<number> | null>(null);

  const shown = draft ?? picked;

  const dayUnder = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest<HTMLElement>('[data-day]');
    const value = cell?.dataset.day;
    return value ? Number(value) : null;
  };

  const toggle = (day: number) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const onGridDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selecting) return;
    anchor.current = dayUnder(event.clientX, event.clientY);
    dragging.current = false;
    swallowClick.current = false;
  };

  const onGridMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selecting || anchor.current === null) return;
    const day = dayUnder(event.clientX, event.clientY);
    if (day === null || day === anchor.current) return;
    dragging.current = true;
    const from = Math.min(anchor.current, day);
    const to = Math.max(anchor.current, day);
    const range = new Set(picked);
    for (let d = from; d <= to; d += 1) range.add(d);
    pending.current = range;
    setDraft(range);
  };

  const onGridUp = () => {
    if (!selecting) return;
    if (dragging.current && pending.current) {
      setPicked(pending.current);
      swallowClick.current = true;
    }
    anchor.current = null;
    dragging.current = false;
    pending.current = null;
    setDraft(null);
  };

  const onDayClick = (day: number) => {
    // 끌기가 끝나며 브라우저가 보내는 click. 이미 범위로 확정했으므로 무시한다.
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    toggle(day);
  };

  const cancel = () => {
    setSelecting(false);
    setPicked(new Set());
    setKind(null);
    setDraft(null);
    anchor.current = null;
    dragging.current = false;
    swallowClick.current = false;
    pending.current = null;
  };

  /*
    목록에 없는 종류는 고른 것으로 치지 않는다.

    군 복무 커플에서 `휴가` 를 고른 뒤 일반 커플로 바뀌면 그 말은 목록에서 사라지지만
    상태에는 남는다. 그대로 두면 아무것도 눌려 있지 않은 화면에서 `일정 만들기` 만
    활성인, 사용자가 설명할 수 없는 상태가 된다. 프리뷰의 토글에서 발견했지만 실제
    앱에서도 **전역하는 순간** 똑같이 일어난다.
  */
  const kinds = KINDS(military);
  const activeKind = kind && kinds.includes(kind) ? kind : null;

  /** 고른 날을 사람이 읽는 말로. 연속이면 범위로, 흩어져 있으면 개수로. */
  const pickedLabel = useMemo(() => {
    const days = [...shown].sort((a, b) => a - b);
    if (days.length === 0) return '날짜를 골라 주세요';
    const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
    if (days.length === 1) return `8월 ${days[0]}일`;
    if (contiguous) return `8월 ${days[0]}일 – ${days[days.length - 1]}일 · ${days.length}일`;
    return `${days.length}일 선택`;
  }, [shown]);

  return (
    <div className="notebook flex h-full flex-col">
      <header
        className="flex h-14 shrink-0 items-center gap-1 px-4"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {selecting ? (
          <>
            <button type="button" aria-label="선택 취소" onClick={cancel} className="tap flex h-11 w-11 items-center justify-center">
              <X size={20} className="pen-icon" color="var(--ink)" />
            </button>
            <span className="print flex-1 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              날짜 고르기
            </span>
          </>
        ) : (
          <>
            <span className="print flex-1 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              2026년 8월
            </span>
            <button type="button" aria-label="이전 달" className="tap flex h-11 w-9 items-center justify-center">
              <ChevronLeft size={20} className="pen-icon" color="var(--ink)" />
            </button>
            <button type="button" aria-label="다음 달" className="tap flex h-11 w-9 items-center justify-center">
              <ChevronRight size={20} className="pen-icon" color="var(--ink)" />
            </button>
            <button
              type="button" aria-label="일정 추가" onClick={() => setSelecting(true)}
              className="tap flex h-11 w-11 items-center justify-center"
            >
              <Plus size={22} className="pen-icon" color="var(--ink)" />
            </button>
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="grid grid-cols-7 px-3">
          {WEEKDAYS.map((day) => (
            <span key={day} className="print py-1 text-center text-[11px]" style={{ color: 'var(--ink-soft)' }}>
              {day}
            </span>
          ))}
        </div>

        <div
          ref={grid}
          className="grid grid-cols-7 gap-y-1 px-3"
          onPointerDown={onGridDown}
          onPointerMove={onGridMove}
          onPointerUp={onGridUp}
          /* 손가락이 격자 밖에서 떨어져도 끌기는 끝나야 한다. 잡힌 채 남으면 유령 선택이 된다. */
          onPointerCancel={onGridUp}
          onPointerLeave={onGridUp}
          style={{ touchAction: selecting ? 'none' : undefined }}
        >
          {Array.from({ length: LEADING }, (_, i) => <span key={`lead-${i}`} />)}
          {Array.from({ length: DAYS }, (_, i) => {
            const day = i + 1;
            const mark = MARKED(military)[day];
            const today = day === 22;
            const on = shown.has(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selecting ? on : undefined}
                aria-label={selecting ? `8월 ${day}일${on ? ', 선택됨' : ''}` : `8월 ${day}일`}
                data-day={day}
                onClick={() => selecting && onDayClick(day)}
                className="tap flex flex-col items-center justify-start py-1"
              >
                <span
                  className="print flex h-8 w-8 items-center justify-center text-[13px] tabular-nums"
                  style={
                    on
                      ? {
                        color: 'var(--paper)',
                        background: 'var(--ink-accent)',
                        borderRadius: '60px 6px 66px 6px / 6px 66px 6px 60px',
                      }
                      : today
                        ? {
                          color: 'var(--paper)',
                          background: 'var(--ink)',
                          borderRadius: '60px 6px 66px 6px / 6px 66px 6px 60px',
                        }
                        : { color: 'var(--ink)' }
                  }
                >
                  {day}
                </span>
                {mark && !selecting ? (
                  <span className="print text-[9px] leading-none" style={{ color: 'var(--ink-accent)' }}>
                    {mark}
                  </span>
                ) : (
                  <span className="h-[9px]" />
                )}
              </button>
            );
          })}
        </div>

        {selecting ? null : (
          <>
            <div className="ink-rule mx-4 my-4" />
            <p className="print px-4 pb-2 text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
              다가오는 일
            </p>
            <div className="space-y-2 px-4">
              {UPCOMING(military).map((item) => (
                <button key={item.label} type="button" className="tap ink-box flex w-full items-center gap-3 px-4 py-3">
                  <span className="print text-[15px] font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                    D-{item.days}
                  </span>
                  <span className="flex-1 text-left">
                    <span className="hand block text-[15px]" style={{ color: 'var(--ink)' }}>{item.label}</span>
                    <span className="print block text-[11px]" style={{ color: 'var(--ink-soft)' }}>{item.when}</span>
                  </span>
                </button>
              ))}
            </div>

            {/*
              복무율은 군 복무 커플에게만 있다.

              끄는 것이 아니라 없다. 관계 점수가 아니라 본인이 입력한 두 날짜 사이의 시간
              진행이므로 §16에 걸리지 않는다. 단색 잉크 바 하나이며 색으로 재촉하지 않는다.
            */}
            {military ? (
              <div className="px-4 pt-5">
                <div className="flex items-baseline justify-between">
                  <span className="print text-[12px]" style={{ color: 'var(--ink-soft)' }}>전역까지 101일</span>
                  <span className="print text-[12px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>76%</span>
                </div>
                <div
                  className="mt-1.5 h-2 overflow-hidden"
                  style={{ border: 'var(--stroke-thin) solid var(--ink-faint)', borderRadius: '40px 4px 44px 4px / 4px 44px 4px 40px' }}
                >
                  <div className="h-full" style={{ width: '76%', background: 'var(--ink-faint)' }} />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* 고르는 동안의 하단. 인스타 갤러리의 다중 선택 바와 같은 자리다. */}
      {selecting ? (
        <div
          className="shrink-0 space-y-3 px-4 pb-4 pt-3"
          style={{
            borderTop: 'var(--stroke) solid var(--ink-faint)',
            background: 'var(--paper)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          }}
        >
          <p className="print text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
            {pickedLabel}
          </p>

          <div className="flex flex-wrap gap-2">
            {kinds.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={activeKind === item}
                onClick={() => setKind(activeKind === item ? null : item)}
                className="tap ink-chip min-h-11 px-3"
                style={activeKind === item ? { background: 'var(--ink)', color: 'var(--paper)' } : undefined}
              >
                <span className="hand text-[15px]">{item}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={shown.size === 0 || !activeKind}
            onClick={cancel}
            className="tap ink-fill flex w-full items-center justify-center gap-2 py-3.5 disabled:opacity-40"
          >
            <Check size={16} strokeWidth={2.4} />
            <span className="print text-[14px] font-semibold">일정 만들기</span>
          </button>

          <p className="print text-center text-[11px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            누르면 하루, 끌면 여러 날이 한 번에 잡혀요
          </p>
        </div>
      ) : null}
    </div>
  );
}
