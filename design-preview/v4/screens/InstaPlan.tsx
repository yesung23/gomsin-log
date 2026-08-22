import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

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
 *
 * 달력 칸에 기록을 그리지 않는다. 기록은 과거이고 이 화면은 미래다. 칸에 찍히는 것은
 * 일정뿐이며, 지난 날짜를 누르면 그날의 기록으로 나간다.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 2026년 8월. 1일이 토요일이라 앞이 6칸 빈다. */
const LEADING = 6;
const DAYS = 31;
const MARKED: Record<number, string> = { 27: '면회', 30: '기념일' };

const UPCOMING = [
  { days: 12, label: '면회', when: '8월 27일 (목)' },
  { days: 33, label: '1주년', when: '9월 17일 (목)' },
];

export function InstaPlan() {
  return (
    <div className="notebook min-h-full pb-6">
      <header className="flex h-14 items-center gap-1 px-4">
        <span className="print flex-1 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
          2026년 8월
        </span>
        <button type="button" aria-label="이전 달" className="tap flex h-11 w-9 items-center justify-center">
          <ChevronLeft size={20} className="pen-icon" color="var(--ink)" />
        </button>
        <button type="button" aria-label="다음 달" className="tap flex h-11 w-9 items-center justify-center">
          <ChevronRight size={20} className="pen-icon" color="var(--ink)" />
        </button>
        <button type="button" aria-label="일정 추가" className="tap flex h-11 w-11 items-center justify-center">
          <Plus size={22} className="pen-icon" color="var(--ink)" />
        </button>
      </header>

      {/* 요일 줄. 이 앱에서 요일을 맞추는 화면은 여기뿐이다. */}
      <div className="grid grid-cols-7 px-3">
        {WEEKDAYS.map((day) => (
          <span key={day} className="print py-1 text-center text-[11px]" style={{ color: 'var(--ink-soft)' }}>
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1 px-3">
        {Array.from({ length: LEADING }, (_, i) => <span key={`lead-${i}`} />)}
        {Array.from({ length: DAYS }, (_, i) => {
          const day = i + 1;
          const mark = MARKED[day];
          const today = day === 22;
          return (
            <button key={day} type="button" className="tap flex flex-col items-center justify-start py-1">
              <span
                className="print flex h-8 w-8 items-center justify-center text-[13px] tabular-nums"
                style={
                  today
                    ? {
                      color: 'var(--paper)',
                      background: 'var(--ink)',
                      // 오늘 표시도 손으로 그린 동그라미다.
                      borderRadius: '60px 6px 66px 6px / 6px 66px 6px 60px',
                    }
                    : { color: 'var(--ink)' }
                }
              >
                {day}
              </span>
              {mark ? (
                <span className="print text-[9px] leading-none" style={{ color: 'var(--accent)' }}>
                  {mark}
                </span>
              ) : (
                <span className="h-[9px]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="ink-rule mx-4 my-4" />

      <p className="print px-4 pb-2 text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
        다가오는 일
      </p>

      {/* 홈의 포스트와 같은 문법. 화면마다 다른 카드를 만들지 않는다. */}
      <div className="space-y-2 px-4">
        {UPCOMING.map((item) => (
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

      {/* 복무율은 선택이다. 관계 점수가 아니라 본인이 입력한 두 날짜 사이의 시간 진행이다. */}
      <div className="px-4 pt-5">
        <div className="flex items-baseline justify-between">
          <span className="print text-[12px]" style={{ color: 'var(--ink-soft)' }}>전역까지 101일</span>
          <span className="print text-[12px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>76%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden" style={{ border: 'var(--stroke-thin) solid var(--ink-faint)', borderRadius: '40px 4px 44px 4px / 4px 44px 4px 40px' }}>
          {/* 단색 잉크 바 하나. 색으로 재촉하지 않는다. */}
          <div className="h-full" style={{ width: '76%', background: 'var(--ink-faint)' }} />
        </div>
      </div>
    </div>
  );
}
