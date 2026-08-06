import { describe, expect, it } from 'vitest';
import type { CoupleEvent } from '@/types';
import {
  dDayLabel,
  eventOccursOnDate,
  upcomingEvents,
  validateEventDraft,
} from '@/lib/calendar';

function event(overrides: Partial<CoupleEvent> = {}): CoupleEvent {
  return {
    id: 'event-1',
    coupleId: 'couple-1',
    createdBy: 'user-1',
    title: '면회',
    eventType: 'visit',
    startDate: '2026-08-10',
    endDate: undefined,
    isPrivate: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('calendar event helpers', () => {
  it('paints every day in a multi-day event range inclusively', () => {
    const trip = event({ startDate: '2026-08-10', endDate: '2026-08-12' });

    expect(eventOccursOnDate(trip, '2026-08-09')).toBe(false);
    expect(eventOccursOnDate(trip, '2026-08-10')).toBe(true);
    expect(eventOccursOnDate(trip, '2026-08-11')).toBe(true);
    expect(eventOccursOnDate(trip, '2026-08-12')).toBe(true);
    expect(eventOccursOnDate(trip, '2026-08-13')).toBe(false);
  });

  it('keeps ongoing and future events sorted while excluding completed events', () => {
    const result = upcomingEvents([
      event({ id: 'future', startDate: '2026-08-20' }),
      event({ id: 'past', startDate: '2026-08-01', endDate: '2026-08-02' }),
      event({ id: 'ongoing', startDate: '2026-08-05', endDate: '2026-08-12' }),
    ], '2026-08-10');

    expect(result.map(({ id }) => id)).toEqual(['ongoing', 'future']);
  });

  it('validates title, required start date, and date order', () => {
    expect(validateEventDraft({ title: '  ', startDate: '2026-08-10' })).toContain('제목');
    expect(validateEventDraft({ title: '데이트', startDate: '' })).toContain('시작일');
    expect(validateEventDraft({
      title: '여행',
      startDate: '2026-08-10',
      endDate: '2026-08-09',
    })).toContain('종료일');
    expect(validateEventDraft({
      title: '여행',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
    })).toBeNull();
  });

  it('calculates D-Day using local calendar dates', () => {
    expect(dDayLabel('2026-08-10', '2026-08-10')).toBe('D-DAY');
    expect(dDayLabel('2026-08-12', '2026-08-10')).toBe('D-2');
    expect(dDayLabel('2026-08-08', '2026-08-10')).toBe('D+2');
  });
});
