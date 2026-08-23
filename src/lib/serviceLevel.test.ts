import { describe, expect, it } from 'vitest';
import { computeServiceLevel, SERVICE_RANK_STAGES } from './serviceLevel';
import type { ServiceProgress } from './milestones';

function progress(percent: number, isDischarged = false, totalDays = 100, elapsedDays?: number): ServiceProgress {
  const elapsed = elapsedDays ?? Math.round((percent / 100) * totalDays);
  return {
    percent,
    elapsedDays: elapsed,
    totalDays,
    remainingDays: Math.max(totalDays - elapsed, 0),
    isDischarged,
  };
}

describe('computeServiceLevel', () => {
  it('returns no level before real service progress exists', () => {
    expect(computeServiceLevel(null)).toBeNull();
  });

  it.each([
    [0, 1, 'Lv.1', '이등병', 0, 2, '일병', 25, 25, 25],
    [25, 2, 'Lv.2', '일병', 0, 3, '상병', 50, 25, 25],
    [45, 2, 'Lv.2', '일병', 80, 3, '상병', 50, 5, 5],
    [50, 3, 'Lv.3', '상병', 0, 4, '병장', 75, 25, 25],
    [75, 4, 'Lv.4', '병장', 0, 5, '전역', 100, 25, 25],
    [99.9, 4, 'Lv.4', '병장', 99.6, 5, '전역', 100, 0.1, 1],
    [100, 5, 'MAX', '전역', 100, null, null, null, null, null],
  ])('maps %s%% to the military rank stage with tier exp', (percent, level, levelBadge, label, rankExpPercent, nextLevel, nextLabel, nextPercent, remainingPercent, remainingDaysToNext) => {
    const p = percent === 99.9 ? progress(99.9, false, 1000, 999) : progress(percent as number);
    expect(computeServiceLevel(p)).toEqual({
      level,
      levelBadge,
      label,
      rankExpPercent,
      nextLevel,
      nextLabel,
      nextPercent,
      remainingPercent,
      remainingDaysToNext,
      isDischarged: level === 5,
      isPreEnlistment: false,
      stages: SERVICE_RANK_STAGES,
    });
  });

  it('marks a real discharged progress as complete', () => {
    expect(computeServiceLevel(progress(42, true))).toEqual({
      level: 5,
      levelBadge: 'MAX',
      label: '전역',
      rankExpPercent: 100,
      nextLevel: null,
      nextLabel: null,
      nextPercent: null,
      remainingPercent: null,
      remainingDaysToNext: null,
      isDischarged: true,
      isPreEnlistment: false,
      stages: SERVICE_RANK_STAGES,
    });
  });

  it('provides the 4 rank stages for the step rail', () => {
    expect(SERVICE_RANK_STAGES).toEqual([
      { level: 1, label: '이등병', levelBadge: 'Lv.1', thresholdPercent: 0 },
      { level: 2, label: '일병', levelBadge: 'Lv.2', thresholdPercent: 25 },
      { level: 3, label: '상병', levelBadge: 'Lv.3', thresholdPercent: 50 },
      { level: 4, label: '병장', levelBadge: 'Lv.4', thresholdPercent: 75 },
    ]);
  });

  it('handles planned/before enlistment (0%) correctly with remaining days to next rank', () => {
    const beforeEnlistment: ServiceProgress = {
      percent: 0,
      elapsedDays: 0,
      totalDays: 540,
      remainingDays: 540,
      isDischarged: false,
    };
    const level = computeServiceLevel(beforeEnlistment);
    expect(level).toMatchObject({
      level: 1,
      levelBadge: 'Lv.1',
      label: '이등병',
      rankExpPercent: 0,
      nextLevel: 2,
      nextLabel: '일병',
      nextPercent: 25,
      remainingPercent: 25,
      remainingDaysToNext: 135,
      isDischarged: false,
      isPreEnlistment: false,
    });
  });

  it('keeps planned service out of the military rank progression', () => {
    const level = computeServiceLevel({
      percent: 0,
      elapsedDays: 0,
      totalDays: 540,
      remainingDays: 540,
      daysUntilEnlistment: 98,
      isDischarged: false,
      isBeforeEnlistment: true,
    });

    expect(level).toMatchObject({
      level: 0,
      levelBadge: '대기',
      label: '입대 대기',
      nextLabel: '이등병',
      remainingDaysToNext: 98,
      isPreEnlistment: true,
    });
  });
});
