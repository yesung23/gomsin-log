import { describe, it, expect } from 'vitest';
import {
  nextAnniversaryMilestone,
  computeServiceProgress,
  effectiveDischargeDate,
  nextUpcomingEvent,
  findMemories,
} from '@/lib/milestones';
import type { CoupleEvent, DailyRecord, MilitaryInfo } from '@/types';

describe('nextAnniversaryMilestone', () => {
  it('returns null without an anniversary date', () => {
    expect(nextAnniversaryMilestone(undefined, '2026-07-31')).toBeNull();
    expect(nextAnniversaryMilestone('', '2026-07-31')).toBeNull();
  });

  it('counts 100일 with the anniversary itself as day 1', () => {
    // 2026-01-01 is day 1, so day 100 is 2026-04-10.
    const milestone = nextAnniversaryMilestone('2026-01-01', '2026-01-02');
    expect(milestone?.label).toBe('100일');
    expect(milestone?.date).toBe('2026-04-10');
  });

  it('picks the soonest milestone still in the future', () => {
    // Just after 100일, the next milestone is 200일.
    const milestone = nextAnniversaryMilestone('2026-01-01', '2026-04-11');
    expect(milestone?.label).toBe('200일');
  });

  it('can return a yearly milestone when it is nearest', () => {
    // 300일 = 2026-10-27; 1주년 = 2027-01-01. Just after 300일, 1주년 is next.
    const milestone = nextAnniversaryMilestone('2026-01-01', '2026-10-28');
    expect(milestone?.label).toBe('1주년');
    expect(milestone?.date).toBe('2027-01-01');
  });

  it('never returns a milestone in the past and reports positive days remaining', () => {
    const milestone = nextAnniversaryMilestone('2020-05-05', '2026-07-31');
    expect(milestone).not.toBeNull();
    expect(milestone!.daysRemaining).toBeGreaterThan(0);
    expect(milestone!.date > '2026-07-31').toBe(true);
  });

  it('excludes a milestone that falls exactly today', () => {
    // 100일 for 2026-01-01 is 2026-04-10; on that day the next one must differ.
    const milestone = nextAnniversaryMilestone('2026-01-01', '2026-04-10');
    expect(milestone?.date).not.toBe('2026-04-10');
  });
});

function military(overrides: Partial<MilitaryInfo> = {}): MilitaryInfo {
  return {
    branch: 'army',
    militaryStatus: 'serving',
    enlistmentDate: '2026-01-01',
    expectedDischargeDate: '2027-07-01',
    dischargeDateSource: 'calculated',
    ...overrides,
  } as MilitaryInfo;
}

describe('computeServiceProgress', () => {
  it('prefers an actual discharge date over an estimate', () => {
    const militaryInfo = military({
      expectedDischargeDate: '2027-01-01',
      dischargeDate: '2026-12-15',
    });
    expect(effectiveDischargeDate(militaryInfo)).toBe('2026-12-15');
    expect(computeServiceProgress(militaryInfo, '2026-12-01')?.remainingDays).toBe(14);
  });

  it('returns null when the dates are unknown', () => {
    expect(computeServiceProgress(undefined, '2026-07-31')).toBeNull();
    expect(computeServiceProgress(military({ enlistmentDate: undefined }), '2026-07-31')).toBeNull();
    expect(
      computeServiceProgress(military({ expectedDischargeDate: undefined }), '2026-07-31'),
    ).toBeNull();
  });

  it('returns null when the user chose not to share service info', () => {
    expect(computeServiceProgress(military({ militaryStatus: 'unknown' }), '2026-07-31')).toBeNull();
  });

  it('returns null for a non-positive service span', () => {
    expect(
      computeServiceProgress(
        military({ enlistmentDate: '2027-01-01', expectedDischargeDate: '2026-01-01' }),
        '2026-07-31',
      ),
    ).toBeNull();
  });

  it('computes 0% on the enlistment day', () => {
    const progress = computeServiceProgress(military(), '2026-01-01');
    expect(progress?.percent).toBe(0);
    expect(progress?.elapsedDays).toBe(0);
    expect(progress?.isDischarged).toBe(false);
  });

  it('computes 100% on the discharge day', () => {
    const progress = computeServiceProgress(military(), '2027-07-01');
    expect(progress?.percent).toBe(100);
    expect(progress?.remainingDays).toBe(0);
    expect(progress?.isDischarged).toBe(true);
  });

  it('clamps to the 0-100 range outside the service window', () => {
    const before = computeServiceProgress(military(), '2025-06-01');
    expect(before?.percent).toBe(0);
    expect(before?.daysUntilEnlistment).toBe(214);
    expect(before?.isBeforeEnlistment).toBe(true);
    const after = computeServiceProgress(military(), '2030-01-01');
    expect(after?.percent).toBe(100);
    expect(after?.daysUntilEnlistment).toBe(0);
    expect(after?.isDischarged).toBe(true);
  });

  it('reports a plausible midpoint', () => {
    const progress = computeServiceProgress(
      military({ enlistmentDate: '2026-01-01', expectedDischargeDate: '2026-01-11' }),
      '2026-01-06',
    );
    expect(progress?.percent).toBe(50);
    expect(progress?.elapsedDays).toBe(5);
    expect(progress?.totalDays).toBe(10);
    expect(progress?.remainingDays).toBe(5);
  });
});

function event(overrides: Partial<CoupleEvent>): CoupleEvent {
  return {
    id: overrides.id ?? 'e1',
    coupleId: 'c1',
    createdBy: 'u1',
    title: overrides.title ?? '일정',
    eventType: overrides.eventType ?? 'vacation',
    startDate: overrides.startDate ?? '2026-08-01',
    isPrivate: false,
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  } as CoupleEvent;
}

describe('nextUpcomingEvent', () => {
  it('returns null when nothing is upcoming', () => {
    expect(nextUpcomingEvent([], '2026-07-31')).toBeNull();
    expect(
      nextUpcomingEvent([event({ startDate: '2026-07-01' })], '2026-07-31'),
    ).toBeNull();
  });

  it('returns the soonest matching event', () => {
    const result = nextUpcomingEvent(
      [
        event({ id: 'late', startDate: '2026-09-01' }),
        event({ id: 'soon', startDate: '2026-08-02' }),
      ],
      '2026-07-31',
    );
    expect(result?.id).toBe('soon');
  });

  it('includes an event starting today', () => {
    const result = nextUpcomingEvent([event({ id: 'today', startDate: '2026-07-31' })], '2026-07-31');
    expect(result?.id).toBe('today');
  });

  it('filters by event type when asked', () => {
    const result = nextUpcomingEvent(
      [
        event({ id: 'anniv', eventType: 'anniversary', startDate: '2026-08-01' }),
        event({ id: 'vac', eventType: 'vacation', startDate: '2026-08-05' }),
      ],
      '2026-07-31',
      ['vacation', 'visit'],
    );
    expect(result?.id).toBe('vac');
  });
});

function record(overrides: Partial<DailyRecord>): DailyRecord {
  return {
    id: overrides.id ?? 'r1',
    date: overrides.date ?? '2025-07-31',
    time: '10:00',
    authorRole: 'gomsin',
    log: overrides.log ?? '기록',
    isPrivate: false,
    createdAt: '2025-07-31T10:00:00Z',
    ...overrides,
  } as DailyRecord;
}

describe('findMemories', () => {
  it('returns null when there is nothing from a past year', () => {
    expect(findMemories([], '2026-07-31')).toBeNull();
    expect(findMemories([record({ date: '2026-07-30' })], '2026-07-31')).toBeNull();
  });

  it('finds records from exactly one year ago', () => {
    const memory = findMemories([record({ id: 'old', date: '2025-07-31' })], '2026-07-31');
    expect(memory?.label).toBe('1년 전 오늘');
    expect(memory?.records.map((r) => r.id)).toEqual(['old']);
  });

  it('prefers the most recent past year available', () => {
    const memory = findMemories(
      [record({ id: 'two', date: '2024-07-31' }), record({ id: 'one', date: '2025-07-31' })],
      '2026-07-31',
    );
    expect(memory?.label).toBe('1년 전 오늘');
    expect(memory?.records.map((r) => r.id)).toEqual(['one']);
  });

  it('falls back to an older year when last year has nothing', () => {
    const memory = findMemories([record({ id: 'two', date: '2024-07-31' })], '2026-07-31');
    expect(memory?.label).toBe('2년 전 오늘');
  });

  it('returns every record from that day', () => {
    const memory = findMemories(
      [record({ id: 'a', date: '2025-07-31' }), record({ id: 'b', date: '2025-07-31' })],
      '2026-07-31',
    );
    expect(memory?.records).toHaveLength(2);
  });
});
