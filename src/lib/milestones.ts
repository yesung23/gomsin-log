import type { CoupleEvent, DailyRecord, EventType, MilitaryInfo } from '@/types';
import { daysBetweenLocal, parseLocalDate, toLocalDateString } from '@/lib/utils';

/**
 * Derived values for the home widgets.
 *
 * Everything here replaces a hardcoded number that used to be rendered as if it
 * were real (a 45% service bar, "1주년 D-45", "첫 휴가 D-12"). Each function
 * returns `null` when the underlying data is missing so the widget can show an
 * honest empty state instead of an invented one.
 */

export interface Milestone {
  label: string;
  date: string;
  daysRemaining: number;
}

/** Day-count milestones couples typically celebrate. */
const DAY_MILESTONES = [100, 200, 300, 500, 1000, 2000, 3000];

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
 * The next day-count or yearly milestone strictly after `todayStr`.
 *
 * Day 1 is the anniversary date itself, matching the Korean convention where
 * the first day of the relationship counts as 1일.
 */
export function nextAnniversaryMilestone(
  anniversaryDate: string | undefined,
  todayStr: string,
): Milestone | null {
  if (!anniversaryDate) return null;

  const candidates: Milestone[] = [];

  for (const days of DAY_MILESTONES) {
    // "100일" is 99 days after day 1.
    const date = addDays(anniversaryDate, days - 1);
    const daysRemaining = daysBetweenLocal(todayStr, date);
    if (daysRemaining > 0) candidates.push({ label: `${days}일`, date, daysRemaining });
  }

  for (let year = 1; year <= 30; year += 1) {
    const date = addYears(anniversaryDate, year);
    const daysRemaining = daysBetweenLocal(todayStr, date);
    if (daysRemaining > 0) candidates.push({ label: `${year}주년`, date, daysRemaining });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return candidates[0];
}

export interface ServiceProgress {
  percent: number;
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  isDischarged: boolean;
  /** Days until enlistment when today is before the entered enlistment date. */
  daysUntilEnlistment?: number;
  /** True when today is before the entered enlistment date. */
  isBeforeEnlistment?: boolean;
}

/** Prefer an explicitly recorded actual discharge date over an estimate. */
export function effectiveDischargeDate(military: MilitaryInfo | undefined): string | undefined {
  return military?.dischargeDate || military?.expectedDischargeDate;
}

/**
 * How far through their service the soldier is.
 * Returns null when the dates needed to compute it are not known.
 */
export function computeServiceProgress(
  military: MilitaryInfo | undefined,
  todayStr: string,
): ServiceProgress | null {
  const enlistment = military?.enlistmentDate;
  const discharge = effectiveDischargeDate(military);
  if (!enlistment || !discharge) return null;
  if (military?.militaryStatus === 'unknown') return null;

  const totalDays = daysBetweenLocal(enlistment, discharge);
  if (totalDays <= 0) return null;

  const elapsedRaw = daysBetweenLocal(enlistment, todayStr);
  const elapsedDays = Math.min(Math.max(elapsedRaw, 0), totalDays);
  const remainingDays = Math.max(daysBetweenLocal(todayStr, discharge), 0);
  const daysUntilEnlistment = Math.max(-elapsedRaw, 0);

  return {
    percent: Math.round((elapsedDays / totalDays) * 1000) / 10,
    elapsedDays,
    totalDays,
    remainingDays,
    isDischarged: remainingDays === 0 && elapsedRaw >= totalDays,
    daysUntilEnlistment,
    isBeforeEnlistment: elapsedRaw < 0,
  };
}

/**
 * The soonest upcoming event of one of `types`, on or after today.
 */
export function nextUpcomingEvent(
  events: CoupleEvent[],
  todayStr: string,
  types?: EventType[],
): CoupleEvent | null {
  const upcoming = events
    .filter((event) => !types || types.includes(event.eventType))
    .filter((event) => !!event.startDate && event.startDate >= todayStr)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return upcoming[0] ?? null;
}

export interface MemoryGroup {
  label: string;
  records: DailyRecord[];
}

/**
 * Records written on the same calendar day in a previous year, newest first.
 * Used by the "추억 다시보기" widget, which previously rendered a heading with
 * no data behind it at all.
 */
export function findMemories(
  records: DailyRecord[],
  todayStr: string,
  maxYearsBack = 5,
): MemoryGroup | null {
  for (let yearsBack = 1; yearsBack <= maxYearsBack; yearsBack += 1) {
    const target = addYears(todayStr, -yearsBack);
    const matching = records.filter((record) => record.date === target);
    if (matching.length > 0) {
      return { label: `${yearsBack}년 전 오늘`, records: matching };
    }
  }
  return null;
}
