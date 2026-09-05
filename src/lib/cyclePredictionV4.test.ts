import { describe, expect, it } from 'vitest';
import { predictCycle } from '@/lib/cyclePrediction';
import type { CyclePeriod } from '@/types';

function period(id: string, startDate: string, endDate?: string): CyclePeriod {
  return { id, userId: 'owner-1', startDate, endDate };
}

describe('Prediction Engine V4 safety contract', () => {
  it.each([
    { periods: [] },
    { periods: [period('p1', '2026-07-15', '2026-07-19')] },
    {
      periods: [
        period('p1', '2026-06-10', '2026-06-14'),
        period('p2', '2026-07-08', '2026-07-12'),
      ],
    },
  ])('withholds a personalised date until three actual starts exist', ({ periods }) => {
    const result = predictCycle({
      periods,
      configuredCycleLength: 28,
      today: '2026-08-10',
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.expectedStartDate).toBeUndefined();
    expect(result.windowStart).toBeUndefined();
    expect(result.windowEnd).toBeUndefined();
  });

  it('uses the observed interval range with a two-day margin, without a narrow cap', () => {
    const result = predictCycle({
      periods: [
        period('p1', '2026-05-16', '2026-05-20'),
        period('p2', '2026-06-13', '2026-06-17'),
        period('p3', '2026-07-11', '2026-07-15'),
        period('p4', '2026-08-08', '2026-08-12'),
      ],
      today: '2026-08-14',
    });

    expect(result.status).toBe('personalized');
    expect(result.expectedStartDate).toBe('2026-09-05');
    expect(result.windowStart).toBe('2026-09-03');
    expect(result.windowEnd).toBe('2026-09-07');
    expect(result.shortestCycleLength).toBe(28);
    expect(result.longestCycleLength).toBe(28);
    expect(result.intervalsUsed).toBe(3);
  });

  it('withholds a date when recent variation would produce a window wider than 14 days', () => {
    const result = predictCycle({
      periods: [
        period('p1', '2026-03-01'),
        period('p2', '2026-03-22'), // 21 days
        period('p3', '2026-04-26'), // 35 days
        period('p4', '2026-05-20'), // 24 days
      ],
      today: '2026-06-01',
    });

    expect(result.status).toBe('withheld');
    expect(result.reviewReason).toBe('wide_variation');
    expect(result.expectedStartDate).toBeUndefined();
    expect(result.windowStart).toBeUndefined();
    expect(result.windowEnd).toBeUndefined();
  });

  it('withholds when an implausible latest interval leaves fewer than two consecutive gaps', () => {
    const result = predictCycle({
      periods: [
        period('p1', '2026-05-01'),
        period('p2', '2026-05-29'),
        period('p3', '2026-06-26'),
        period('p4', '2026-07-03'), // 7 days: likely duplicate or incorrect input
      ],
      today: '2026-07-10',
    });

    expect(result.status).toBe('withheld');
    expect(result.reviewReason).toBe('insufficient_recent_intervals');
    expect(result.expectedStartDate).toBeUndefined();
  });

  it('excludes malformed, duplicate and future starts without contaminating valid history', () => {
    const result = predictCycle({
      periods: [
        period('p1', '2026-05-01'),
        period('duplicate', '2026-05-01'),
        period('p2', '2026-05-29'),
        period('bad', 'not-a-date'),
        period('p3', '2026-06-26'),
        period('future', '2026-08-11'),
      ],
      today: '2026-07-01',
    });

    expect(result.status).toBe('personalized');
    expect(result.expectedStartDate).toBe('2026-07-24');
    expect(result.periodsUsed).toBe(3);
  });

  it('withholds an estimate after the entire window has passed', () => {
    const periods = [
      period('p1', '2026-05-01'),
      period('p2', '2026-05-29'),
      period('p3', '2026-06-26'),
    ];

    const insideWindow = predictCycle({ periods, today: '2026-07-25' });
    const afterWindow = predictCycle({ periods, today: '2026-07-27' });

    expect(insideWindow.windowEnd).toBe('2026-07-26');
    expect(insideWindow.status).toBe('personalized');
    expect(afterWindow.status).toBe('withheld');
    expect(afterWindow.reviewReason).toBe('stale_window');
    expect(afterWindow.expectedStartDate).toBeUndefined();
    expect(afterWindow.windowStart).toBeUndefined();
    expect(afterWindow.windowEnd).toBeUndefined();
  });

  it('uses a consecutive valid suffix instead of reaching across an older bad gap', () => {
    const result = predictCycle({
      periods: [
        period('p1', '2026-01-01'),
        period('p2', '2026-01-05'), // older bad gap: stop here
        period('p3', '2026-02-02'),
        period('p4', '2026-03-02'),
      ],
      today: '2026-03-10',
    });

    expect(result.status).toBe('personalized');
    expect(result.intervalsUsed).toBe(2);
    expect(result.periodsUsed).toBe(3);
    expect(result.expectedStartDate).toBe('2026-03-30');
  });

  it('allows a 14-day inclusive range and withholds a 15-day range', () => {
    const allowed = predictCycle({
      periods: [
        period('p1', '2026-01-01'),
        period('p2', '2026-01-21'), // 20
        period('p3', '2026-02-19'), // 29: spread 9, inclusive window 14
      ],
      today: '2026-02-20',
    });
    const withheld = predictCycle({
      periods: [
        period('p1', '2026-01-01'),
        period('p2', '2026-01-21'), // 20
        period('p3', '2026-02-20'), // 30: spread 10, inclusive window 15
      ],
      today: '2026-02-21',
    });

    expect(allowed.status).toBe('personalized');
    expect(allowed.windowStart).toBe('2026-03-09');
    expect(allowed.windowEnd).toBe('2026-03-22');
    expect(withheld.status).toBe('withheld');
    expect(withheld.reviewReason).toBe('wide_variation');
  });

  it('never emits pseudo-confidence or ovulation and fertility guesses', () => {
    const result = predictCycle({
      periods: [
        period('p1', '2026-05-01'),
        period('p2', '2026-05-29'),
        period('p3', '2026-06-26'),
      ],
      today: '2026-07-01',
    });

    expect(result).not.toHaveProperty('confidence');
    expect(result).not.toHaveProperty('estimatedOvulationDate');
    expect(result).not.toHaveProperty('fertilityWindowStart');
    expect(result).not.toHaveProperty('fertilityWindowEnd');
  });

  it.each([
    ['15-day lower boundary', ['2026-01-01', '2026-01-16', '2026-01-31'], '2026-02-01', 15],
    ['60-day upper boundary', ['2026-01-01', '2026-03-02', '2026-05-01'], '2026-05-02', 60],
  ])('accepts the inclusive plausible interval %s', (
    _label,
    startDates,
    today,
    expectedInterval,
  ) => {
    const result = predictCycle({
      periods: startDates.map((startDate, index) => period(`boundary-${index}`, startDate)),
      today,
    });

    expect(result.status).toBe('personalized');
    expect(result.shortestCycleLength).toBe(expectedInterval);
    expect(result.longestCycleLength).toBe(expectedInterval);
  });

  it('fails closed when today is not an exact calendar date', () => {
    const result = predictCycle({
      periods: [
        period('p1', '2026-05-01'),
        period('p2', '2026-05-29'),
        period('p3', '2026-06-26'),
      ],
      today: '2026-02-30',
    });

    expect(result.status).toBe('withheld');
    expect(result.reviewReason).toBe('invalid_today');
    expect(result.expectedStartDate).toBeUndefined();
    expect(result.windowStart).toBeUndefined();
    expect(result.windowEnd).toBeUndefined();
  });
});
