import { describe, expect, it } from 'vitest';
import {
  inclusiveTripDates,
  parseTripPeriodParams,
  reconcileParentTrips,
  recordsInInclusiveRange,
  validateTripDraft,
  validateTripItemUrl,
} from '@/lib/trips';

describe('trip planner helpers', () => {
  it('validates required trip fields and chronological dates', () => {
    expect(validateTripDraft({ title: '  ', startDate: '2026-08-10', endDate: '2026-08-12' })).toContain('이름');
    expect(validateTripDraft({ title: '부산', startDate: '', endDate: '2026-08-12' })).toContain('가는 날');
    expect(validateTripDraft({ title: '부산', startDate: '2026-08-10', endDate: '' })).toContain('오는 날');
    expect(validateTripDraft({ title: '부산', startDate: '2026-08-12', endDate: '2026-08-10' })).toContain('빠를');
    expect(validateTripDraft({ title: ' 부산 ', startDate: '2026-08-10', endDate: '2026-08-10' })).toBeNull();
  });

  it('accepts only optional http and https itinerary links', () => {
    expect(validateTripItemUrl('')).toBeNull();
    expect(validateTripItemUrl('https://example.com/place')).toBeNull();
    expect(validateTripItemUrl('http://example.com')).toBeNull();
    expect(validateTripItemUrl('javascript:alert(1)')).toContain('http');
    expect(validateTripItemUrl('not a url')).toContain('올바른');
  });

  it('builds inclusive date tabs across a month boundary', () => {
    expect(inclusiveTripDates('2026-08-31', '2026-09-02')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('reconciles parent trip snapshots by id without duplicate rows', () => {
    const base = {
      coupleId: 'couple-1',
      createdBy: 'user-a',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      status: 'planned' as const,
      createdAt: '2026-08-01T00:00:00Z',
    };
    expect(reconcileParentTrips([
      { ...base, id: 'trip-1', title: '이전 제목' },
      { ...base, id: 'trip-2', title: '부산' },
      { ...base, id: 'trip-1', title: '새 제목' },
    ])).toEqual([
      { ...base, id: 'trip-1', title: '새 제목' },
      { ...base, id: 'trip-2', title: '부산' },
    ]);
  });

  it('parses valid period queries and filters records inclusively', () => {
    const period = parseTripPeriodParams(new URLSearchParams('from=2026-08-10&to=2026-08-12&trip=trip-1'));
    expect(period).toEqual({ from: '2026-08-10', to: '2026-08-12', tripId: 'trip-1' });
    expect(recordsInInclusiveRange([
      { date: '2026-08-09' },
      { date: '2026-08-10' },
      { date: '2026-08-12' },
      { date: '2026-08-13' },
    ], period!.from, period!.to)).toEqual([
      { date: '2026-08-10' },
      { date: '2026-08-12' },
    ]);
    expect(parseTripPeriodParams(new URLSearchParams('from=2026-02-30&to=2026-03-01&trip=trip-1'))).toBeNull();
    expect(parseTripPeriodParams(new URLSearchParams('from=2026-08-12&to=2026-08-10&trip=trip-1'))).toBeNull();
  });
});
