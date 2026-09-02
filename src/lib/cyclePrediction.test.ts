import { describe, expect, it } from 'vitest';
import { MAX_INTERVALS_CONSIDERED, predictCycle } from '@/lib/cyclePrediction';
import type { CyclePeriod } from '@/types';

function starts(values: string[]): CyclePeriod[] {
  return values.map((startDate, index) => ({
    id: `period-${index}`,
    userId: 'owner-1',
    startDate,
  }));
}

describe('Prediction Engine V4 bounded-history details', () => {
  it('uses at most the 12 most recent consecutive intervals', () => {
    const periods: CyclePeriod[] = [];
    const cursor = new Date(Date.UTC(2024, 0, 1));
    for (let index = 0; index < 20; index += 1) {
      periods.push({
        id: `period-${index}`,
        userId: 'owner-1',
        startDate: cursor.toISOString().slice(0, 10),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 28);
    }

    const result = predictCycle({ periods, today: '2025-06-01' });
    expect(result.status).toBe('personalized');
    expect(result.intervalsUsed).toBe(MAX_INTERVALS_CONSIDERED);
    expect(result.periodsUsed).toBe(MAX_INTERVALS_CONSIDERED + 1);
  });

  it('crosses a leap-year and year boundary with calendar-day arithmetic', () => {
    const result = predictCycle({
      periods: starts(['2027-12-19', '2028-01-16', '2028-02-13']),
      today: '2028-02-20',
    });

    expect(result.status).toBe('personalized');
    expect(result.expectedStartDate).toBe('2028-03-12');
    expect(result.windowStart).toBe('2028-03-10');
    expect(result.windowEnd).toBe('2028-03-14');
  });

  it('returns byte-equivalent output across host timezone changes', () => {
    const originalTimezone = process.env.TZ;
    const periods = starts(['2026-05-01', '2026-05-29', '2026-06-26']);
    try {
      const outputs = ['UTC', 'Asia/Seoul', 'America/Los_Angeles'].map((timezone) => {
        process.env.TZ = timezone;
        return JSON.stringify(predictCycle({ periods, today: '2026-07-01' }));
      });
      expect(new Set(outputs).size).toBe(1);
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it('uses start dates only, so end-date or daily-log changes cannot move it', () => {
    const open = starts(['2026-05-01', '2026-05-29', '2026-06-26']);
    const closed = open.map((period, index) => ({
      ...period,
      endDate: ['2026-05-05', '2026-06-02', '2026-06-30'][index],
    }));

    expect(predictCycle({ periods: open, today: '2026-07-01' }))
      .toEqual(predictCycle({ periods: closed, today: '2026-07-01' }));
    // The input type has no daily log, symptom, pain, flow, mood or note field.
  });

  it('identifies the owner-only algorithm version', () => {
    const result = predictCycle({
      periods: starts(['2026-05-01', '2026-05-29', '2026-06-26']),
      today: '2026-07-01',
    });
    expect(result.methodVersion).toBe('v4.0.0-owner-only');
  });
});
