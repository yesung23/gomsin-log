import { describe, expect, it } from 'vitest';
import { computeServiceLevel } from './serviceLevel';
import type { ServiceProgress } from './milestones';

function progress(percent: number, isDischarged = false): ServiceProgress {
  return {
    percent,
    elapsedDays: percent,
    totalDays: 100,
    remainingDays: Math.max(100 - percent, 0),
    isDischarged,
  };
}

describe('computeServiceLevel', () => {
  it('returns no level before real service progress exists', () => {
    expect(computeServiceLevel(null)).toBeNull();
  });

  it.each([
    [0, 1, '시작', 2, '적응', 25],
    [25, 2, '적응', 3, '중반', 50],
    [50, 3, '중반', 4, '후반', 75],
    [75, 4, '후반', 5, '완주', 100],
    [99.9, 4, '후반', 5, '완주', 100],
    [100, 5, '완주', null, null, null],
  ])('maps %s%% to the personal service stage', (percent, level, label, nextLevel, nextLabel, nextPercent) => {
    expect(computeServiceLevel(progress(percent as number))).toEqual({
      level,
      label,
      nextLevel,
      nextLabel,
      nextPercent,
    });
  });

  it('marks a real discharged progress as complete', () => {
    expect(computeServiceLevel(progress(42, true))).toMatchObject({
      level: 5,
      label: '완주',
      nextLevel: null,
    });
  });
});
