import type { CoupleEvent, MilitaryInfo } from '@/types';
import { daysBetweenLocal, parseLocalDate, toLocalDateString } from '@/lib/utils';

/**
 * 하이라이트 — 인스타의 원형 커버 자리에 마일스톤을 놓는다.
 *
 * ## 인스타 하이라이트는 과거만 담는다. 여기는 다르다
 *
 * 이 앱은 **기다림이 제품**이다. 그래서 아직 오지 않은 마일스톤을 맨 뒤에 흐리게 놓는다 --
 * `전역 D-302`처럼. 도착하면 색이 들어오고 그날의 스토리가 담긴다.
 *
 * 인스타에서 형태를 가져오되 **의미를 뒤집는** 예이며, 이 제품에서만 성립한다. 남의
 * 하이라이트는 자랑이고 여기 것은 함께 기다린 것의 목록이다.
 *
 * ## 관계 점수를 만들지 않는다
 *
 * 개수를 세지 않고 순위를 매기지 않는다. 하이라이트는 날짜의 목록이지 성취의 목록이
 * 아니다(§10 "관계 점수는 넣지 않는다").
 *
 * ## 지어내지 않는다
 *
 * 기념일을 정하지 않은 커플에게는 날짜 마일스톤이 없다. `DDayWidget`이 지어낸 기념일을
 * 지운 것과 같은 규칙이고, 여기서는 빈 목록이 정답이다.
 */

export type HighlightSourceKind = 'anniversary' | 'event' | 'discharge';

export interface Highlight {
  /** `100일` `1주년` `첫 면회` `전역`. 앱이 만드는 라벨이며 사용자 콘텐츠가 아니다. */
  label: string;
  /** `YYYY-MM-DD`. 도착한 것이든 아직 아닌 것이든 날짜는 정확하다. */
  date: string;
  /** 도착했나. 아직이면 흐리게 그리고 스토리로 가지 않는다. */
  reached: boolean;
  /** 아직 오지 않은 것에만. `D-302`. */
  countdown?: string;
  /** 이 하이라이트가 파생된 기존 원본의 종류. */
  sourceKind: HighlightSourceKind;
  /** 일정에서 파생된 경우에만. 원본 일정의 정확한 id. */
  sourceEventId?: string;
}

const DAY_MILESTONES = [100, 200, 300, 500, 1000, 2000, 3000];

/** 이 종류의 일정만 하이라이트가 된다. 범용 캘린더의 모든 항목이 기억이 되지는 않는다. */
const MEMORABLE = new Set(['visit', 'vacation', 'trip']);

const FIRST_LABEL: Record<string, string> = {
  visit: '첫 면회',
  vacation: '첫 휴가',
  trip: '첫 여행',
};

function addDays(dateStr: string, days: number): string {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

function addYears(dateStr: string, years: number): string {
  const date = parseLocalDate(dateStr);
  date.setFullYear(date.getFullYear() + years);
  return toLocalDateString(date);
}

/**
 * 도착한 것들과, 아직 오지 않은 것 하나.
 *
 * 미래를 하나만 두는 이유는 그것이 지금 기다리는 것이기 때문이다. 앞으로 올 모든
 * 마일스톤을 늘어놓으면 목록이 계획표가 되고, 이 화면은 계획이 아니라 축적을 다룬다.
 */
export function buildHighlights({
  anniversaryDate,
  events,
  military,
  todayStr,
  limit = 8,
}: {
  anniversaryDate?: string;
  events: CoupleEvent[];
  military?: MilitaryInfo;
  todayStr: string;
  limit?: number;
}): Highlight[] {
  const reached: Highlight[] = [];

  if (anniversaryDate) {
    for (const days of DAY_MILESTONES) {
      // 사귄 날이 1일이므로 100일은 99일 뒤다.
      const date = addDays(anniversaryDate, days - 1);
      if (date <= todayStr) {
        reached.push({ label: `${days}일`, date, reached: true, sourceKind: 'anniversary' });
      }
    }
    for (let year = 1; year <= 30; year += 1) {
      const date = addYears(anniversaryDate, year);
      if (date <= todayStr) {
        reached.push({ label: `${year}주년`, date, reached: true, sourceKind: 'anniversary' });
      }
    }
  }

  /*
    "첫" 것만 담는다.

    면회를 스무 번 갔으면 하이라이트가 스무 개가 되고, 그러면 목록이 일정 사본이 된다.
    처음이 기억이고 나머지는 일정이다.
  */
  const byType = new Map<string, CoupleEvent>();
  for (const event of events) {
    if (!MEMORABLE.has(event.eventType)) continue;
    if (!event.startDate || event.startDate > todayStr) continue;
    const current = byType.get(event.eventType);
    if (!current || event.startDate < current.startDate) byType.set(event.eventType, event);
  }
  for (const [type, event] of byType) {
    reached.push({
      label: FIRST_LABEL[type] ?? '처음',
      date: event.startDate,
      reached: true,
      sourceKind: 'event',
      sourceEventId: event.id,
    });
  }

  reached.sort((a, b) => a.date.localeCompare(b.date));

  /*
    아직 오지 않은 것 하나.

    전역이 있으면 전역이고, 없으면 다음 날짜 마일스톤이다. 전역은 이 제품에서 비대칭이
    끝나는 날이자 아카이브 가치가 최대인 날이라 다른 무엇보다 앞선다.
  */
  const upcoming: Highlight | null = (() => {
    const discharge = military?.expectedDischargeDate;
    if (discharge && discharge > todayStr && military?.militaryStatus !== 'discharged') {
      return {
        label: '전역', date: discharge, reached: false,
        countdown: `D-${daysBetweenLocal(todayStr, discharge)}`,
        sourceKind: 'discharge',
      };
    }
    if (!anniversaryDate) return null;
    const candidates: Highlight[] = [];
    for (const days of DAY_MILESTONES) {
      const date = addDays(anniversaryDate, days - 1);
      if (date > todayStr) {
        candidates.push({ label: `${days}일`, date, reached: false, sourceKind: 'anniversary' });
      }
    }
    for (let year = 1; year <= 30; year += 1) {
      const date = addYears(anniversaryDate, year);
      if (date > todayStr) {
        candidates.push({ label: `${year}주년`, date, reached: false, sourceKind: 'anniversary' });
      }
    }
    candidates.sort((a, b) => a.date.localeCompare(b.date));
    const next = candidates[0];
    return next
      ? { ...next, countdown: `D-${daysBetweenLocal(todayStr, next.date)}` }
      : null;
  })();

  // 도착한 것은 최신이 오른쪽에 오도록 최근 것부터 잘라 낸다.
  const trimmed = reached.slice(Math.max(reached.length - (limit - (upcoming ? 1 : 0)), 0));
  return upcoming ? [...trimmed, upcoming] : trimmed;
}
