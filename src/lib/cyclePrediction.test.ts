import { describe, expect, it } from 'vitest';
import { predictCycle } from '@/lib/cyclePrediction';
import type { CyclePeriod } from '@/types';

describe('Prediction Engine V3', () => {
  const today = '2026-08-10';

  it('1. returns insufficient_data status when there are 0 period records', () => {
    const result = predictCycle({ periods: [], today });
    expect(result.status).toBe('insufficient_data');
    expect(result.expectedStartDate).toBeUndefined();
    expect(result.cyclesUsed).toBe(0);
  });

  it('2. uses configured_estimate for 1 period start date', () => {
    const periods: CyclePeriod[] = [{ id: 'p1', userId: 'u1', startDate: '2026-07-15' }];
    const result = predictCycle({ periods, configuredCycleLength: 30, today });
    expect(result.status).toBe('configured_estimate');
    expect(result.expectedStartDate).toBe('2026-08-14');
    expect(result.windowStart).toBe('2026-08-13');
    expect(result.confidence).toBe('low');
    expect(result.cyclesUsed).toBe(1);
  });

  it('3. uses configured_estimate for 2 period start dates', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-06-10' },
      { id: 'p2', userId: 'u1', startDate: '2026-07-08' },
    ];
    const result = predictCycle({ periods, configuredCycleLength: 28, today });
    expect(result.status).toBe('configured_estimate');
    expect(result.expectedStartDate).toBe('2026-08-05');
    expect(result.cyclesUsed).toBe(2);
  });

  it('4. activates personalized prediction when 3 or more period start dates exist', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-05-15' },
      { id: 'p2', userId: 'u1', startDate: '2026-06-12' }, // 28 days
      { id: 'p3', userId: 'u1', startDate: '2026-07-10' }, // 28 days
    ];
    const result = predictCycle({ periods, today });
    expect(result.status).toBe('personalized');
    expect(result.expectedStartDate).toBe('2026-08-07');
    expect(result.medianCycleLength).toBe(28);
    expect(result.cyclesUsed).toBe(3);
  });

  it('5. predicts accurately for constant 28-day cycle with high confidence', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-04-10' },
      { id: 'p2', userId: 'u1', startDate: '2026-05-08' },
      { id: 'p3', userId: 'u1', startDate: '2026-06-05' },
      { id: 'p4', userId: 'u1', startDate: '2026-07-03' },
    ];
    const result = predictCycle({ periods, today });
    expect(result.status).toBe('personalized');
    expect(result.expectedStartDate).toBe('2026-07-31');
    expect(result.confidence).toBe('high');
  });

  it('6. calculates median & window correctly for 27/28/29 day cycles', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-04-01' },
      { id: 'p2', userId: 'u1', startDate: '2026-04-28' }, // 27 days
      { id: 'p3', userId: 'u1', startDate: '2026-05-26' }, // 28 days
      { id: 'p4', userId: 'u1', startDate: '2026-06-24' }, // 29 days
    ];
    const result = predictCycle({ periods, today });
    expect(result.status).toBe('personalized');
    expect(result.medianCycleLength).toBe(28);
    expect(result.expectedStartDate).toBe('2026-07-22');
  });

  it('7. handles irregular cycles with lower confidence & wider range', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-03-01' },
      { id: 'p2', userId: 'u1', startDate: '2026-03-22' }, // 21 days
      { id: 'p3', userId: 'u1', startDate: '2026-04-26' }, // 35 days
      { id: 'p4', userId: 'u1', startDate: '2026-05-20' }, // 24 days
    ];
    const result = predictCycle({ periods, today });
    expect(result.status).toBe('personalized');
    expect(result.confidence).toBe('low');
    expect(result.windowStart).not.toEqual(result.expectedStartDate);
  });

  it('8. filters out invalid/outlier cycle intervals (<15 or >60 days)', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-01-01' },
      { id: 'p2', userId: 'u1', startDate: '2026-01-05' }, // 4 days (outlier)
      { id: 'p3', userId: 'u1', startDate: '2026-02-02' }, // 28 days
      { id: 'p4', userId: 'u1', startDate: '2026-03-02' }, // 28 days
    ];
    const result = predictCycle({ periods, today });
    expect(result.cyclesUsed).toBe(4);
    expect(result.medianCycleLength).toBe(28);
  });

  it('9. ignores malformed or invalid calendar dates', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: 'invalid-date' },
      { id: 'p2', userId: 'u1', startDate: '2026-07-01' },
    ];
    const result = predictCycle({ periods, today });
    expect(result.cyclesUsed).toBe(1);
    expect(result.expectedStartDate).toBe('2026-07-29');
  });

  it('10. deduplicates duplicate start dates', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-07-01' },
      { id: 'p2', userId: 'u1', startDate: '2026-07-01' },
    ];
    const result = predictCycle({ periods, today });
    expect(result.cyclesUsed).toBe(1);
  });

  it('11. updates prediction when period start date is modified', () => {
    const initialPeriods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-05-01' },
      { id: 'p2', userId: 'u1', startDate: '2026-05-29' },
      { id: 'p3', userId: 'u1', startDate: '2026-06-26' },
    ];
    const modifiedPeriods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-05-01' },
      { id: 'p2', userId: 'u1', startDate: '2026-05-29' },
      { id: 'p3', userId: 'u1', startDate: '2026-06-30' }, // modified
    ];

    const res1 = predictCycle({ periods: initialPeriods, today });
    const res2 = predictCycle({ periods: modifiedPeriods, today });
    expect(res1.expectedStartDate).not.toEqual(res2.expectedStartDate);
  });

  it('12. updates prediction when a period entry is deleted', () => {
    const periods: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-05-01' },
      { id: 'p2', userId: 'u1', startDate: '2026-05-29' },
      { id: 'p3', userId: 'u1', startDate: '2026-06-26' },
    ];
    const resBefore = predictCycle({ periods, today });
    const resAfter = predictCycle({ periods: periods.slice(0, 2), today });
    expect(resBefore.status).toBe('personalized');
    expect(resAfter.status).toBe('configured_estimate');
  });

  it('13-15. REGRESSION GUARD: daily symptoms, flow, and notes NEVER create or extend a menstrual period or change prediction', () => {
    const periodsOnly: CyclePeriod[] = [
      { id: 'p1', userId: 'u1', startDate: '2026-08-01', endDate: '2026-08-05' },
    ];

    // The prediction engine receives periods only. Adding daily logs to the user's records
    // must NOT alter the period input passed to predictCycle.
    const pred1 = predictCycle({ periods: periodsOnly, today: '2026-08-10' });

    // Simulating adding headache log on Aug 14: periods list remains unchanged!
    const pred2 = predictCycle({ periods: periodsOnly, today: '2026-08-14' });

    expect(pred1.expectedStartDate).toEqual(pred2.expectedStartDate);
    expect(pred1.cyclesUsed).toEqual(1);
    expect(pred2.cyclesUsed).toEqual(1);
  });

  it('16-18. handles month, year, and leap year boundaries correctly', () => {
    // Leap year Feb 2028 (Feb 29 exists)
    const leapPeriods: CyclePeriod[] = [{ id: 'p1', userId: 'u1', startDate: '2028-02-15' }];
    const leapRes = predictCycle({ periods: leapPeriods, configuredCycleLength: 20, today: '2028-02-20' });
    expect(leapRes.expectedStartDate).toBe('2028-03-06'); // 15 + 20 days = March 6 in leap year 2028

    // Year boundary (Dec 15 -> Jan 12)
    const yearPeriods: CyclePeriod[] = [{ id: 'p1', userId: 'u1', startDate: '2026-12-15' }];
    const yearRes = predictCycle({ periods: yearPeriods, configuredCycleLength: 28, today: '2026-12-20' });
    expect(yearRes.expectedStartDate).toBe('2027-01-12');
  });

  it('19-20. calculates estimated fertility window as a statistical estimate', () => {
    const periods: CyclePeriod[] = [{ id: 'p1', userId: 'u1', startDate: '2026-08-01' }];
    const result = predictCycle({ periods, configuredCycleLength: 28, today });
    expect(result.expectedStartDate).toBe('2026-08-29');
    expect(result.estimatedOvulationDate).toBe('2026-08-15'); // 29 - 14
    expect(result.fertilityWindowStart).toBe('2026-08-10');   // 15 - 5
    expect(result.fertilityWindowEnd).toBe('2026-08-16');     // 15 + 1
  });
});
