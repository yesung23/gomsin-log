import { describe, expect, it } from 'vitest';
import {
  activePeriodOnDate,
  dailyLogHasContent,
  dailyLogOnDate,
  isPeriodImplausiblyLong,
  periodDayNumber,
  periodOccursOnDate,
  periodRangesOnDate,
} from '@/lib/cycle';
import type { CycleDailyLog, CyclePeriod } from '@/types';

/**
 * `endDate` is spread through explicitly so `{ endDate: undefined }` actually
 * clears it. A plain `...overrides` after a default leaves the default in place
 * for an explicit `undefined`, which silently turned "open period" cases into
 * closed ones.
 */
function period(overrides: Partial<CyclePeriod> = {}): CyclePeriod {
  const base: CyclePeriod = {
    id: 'p1',
    userId: 'u1',
    startDate: '2026-08-01',
    endDate: '2026-08-05',
  };
  const merged = { ...base, ...overrides };
  if ('endDate' in overrides) merged.endDate = overrides.endDate;
  return merged;
}

function log(overrides: Partial<CycleDailyLog> = {}): CycleDailyLog {
  return { id: 'l1', userId: 'u1', logDate: '2026-08-14', symptoms: [], ...overrides };
}

describe('V3 period helpers read periods only', () => {
  it('treats a closed period as covering its inclusive range', () => {
    const p = period();
    expect(periodOccursOnDate(p, '2026-07-31')).toBe(false);
    expect(periodOccursOnDate(p, '2026-08-01')).toBe(true);
    expect(periodOccursOnDate(p, '2026-08-05')).toBe(true);
    expect(periodOccursOnDate(p, '2026-08-06')).toBe(false);
  });

  it('covers an ongoing period from its start through today, and no further', () => {
    /*
     * An ongoing period must paint every day so far: with only the start day
     * marked, the calendar showed one cell while the hero said "생리 3일째". It
     * must also stop at today rather than colouring the rest of the year.
     */
    const p = period({ endDate: undefined, startDate: '2026-08-12' });
    expect(periodOccursOnDate(p, '2026-08-11', '2026-08-14')).toBe(false);
    expect(periodOccursOnDate(p, '2026-08-12', '2026-08-14')).toBe(true);
    expect(periodOccursOnDate(p, '2026-08-13', '2026-08-14')).toBe(true);
    expect(periodOccursOnDate(p, '2026-08-14', '2026-08-14')).toBe(true);
    expect(periodOccursOnDate(p, '2026-08-15', '2026-08-14')).toBe(false);
    expect(periodOccursOnDate(p, '2026-12-31', '2026-08-14')).toBe(false);
  });

  it('falls back to the start day alone when no clock context is given', () => {
    const p = period({ endDate: undefined, startDate: '2026-08-12' });
    expect(periodOccursOnDate(p, '2026-08-12')).toBe(true);
    expect(periodOccursOnDate(p, '2026-08-13')).toBe(false);
  });

  it('marks an end day only when an end was actually recorded', () => {
    const ongoing = periodRangesOnDate(
      [period({ endDate: undefined, startDate: '2026-08-12' })],
      '2026-08-14',
      '2026-08-14',
    );
    expect(ongoing[0]).toMatchObject({ isStart: false, isEnd: false });
  });

  it('flags start and end days for calendar rendering', () => {
    expect(periodRangesOnDate([period()], '2026-08-01')[0]).toMatchObject({
      isStart: true,
      isEnd: false,
    });
    expect(periodRangesOnDate([period()], '2026-08-05')[0]).toMatchObject({
      isStart: false,
      isEnd: true,
    });
  });

  it('reports no active period once the recorded end has passed', () => {
    expect(activePeriodOnDate([period()], '2026-08-14')).toBeNull();
  });

  it('picks the most recent open period, not the first in array order', () => {
    /*
     * An old period the user never closed stays open forever. Returning the first
     * match made a February period read as "today's", hiding the current one and
     * reporting an absurd day count.
     */
    const stale = period({ id: 'old', startDate: '2026-02-01', endDate: undefined });
    const current = period({ id: 'now', startDate: '2026-08-13', endDate: undefined });
    expect(activePeriodOnDate([stale, current], '2026-08-14')?.id).toBe('now');
    expect(activePeriodOnDate([current, stale], '2026-08-14')?.id).toBe('now');
  });

  it('counts the first day as day 1', () => {
    expect(periodDayNumber(period({ startDate: '2026-08-14' }), '2026-08-14')).toBe(1);
    expect(periodDayNumber(period({ startDate: '2026-08-12' }), '2026-08-14')).toBe(3);
  });

  it('counts across a month boundary', () => {
    expect(periodDayNumber(period({ startDate: '2026-07-30' }), '2026-08-02')).toBe(4);
  });

  it('asks about an implausibly long open period but never about a closed one', () => {
    expect(isPeriodImplausiblyLong(period({ endDate: undefined, startDate: '2026-07-01' }), '2026-08-14')).toBe(true);
    expect(isPeriodImplausiblyLong(period({ endDate: undefined, startDate: '2026-08-12' }), '2026-08-14')).toBe(false);
    // A closed period is never "still running", however long it was.
    expect(isPeriodImplausiblyLong(period({ startDate: '2026-01-01', endDate: '2026-06-01' }), '2026-08-14')).toBe(false);
  });
});

describe('V3 daily-log helpers read daily logs only', () => {
  it('finds the single log for a date', () => {
    expect(dailyLogOnDate([log()], '2026-08-14')?.id).toBe('l1');
    expect(dailyLogOnDate([log()], '2026-08-13')).toBeNull();
  });

  it('treats an empty log as having no content, so no calendar marker appears', () => {
    expect(dailyLogHasContent(null)).toBe(false);
    expect(dailyLogHasContent(log())).toBe(false);
    expect(dailyLogHasContent(log({ note: '   ' }))).toBe(false);
  });

  it('recognises every field that counts as content', () => {
    expect(dailyLogHasContent(log({ symptoms: ['headache'] }))).toBe(true);
    expect(dailyLogHasContent(log({ flow: 'heavy' }))).toBe(true);
    expect(dailyLogHasContent(log({ painLevel: 'severe' }))).toBe(true);
    expect(dailyLogHasContent(log({ mood: 'tired' }))).toBe(true);
    expect(dailyLogHasContent(log({ note: '메모' }))).toBe(true);
  });
});
