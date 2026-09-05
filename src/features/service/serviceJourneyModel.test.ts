import { describe, expect, it } from 'vitest';
import type { Branch, MilitaryInfo } from '@/types';
import { serviceDateAtMs, SECONDS_PER_DAY } from '@/lib/serviceLevel';
import { computeServiceJourney } from './serviceJourneyModel';

const military: MilitaryInfo = {
  branch: 'army', militaryStatus: 'serving', enlistmentDate: '2025-01-01',
  expectedDischargeDate: '2026-07-02', dischargeDateSource: 'manual',
};
const start = serviceDateAtMs(military.enlistmentDate!)!;
const atSecond = (seconds: number) => start + seconds * 1000;
const atDay = (days: number) => atSecond(days * SECONDS_PER_DAY);

describe('service journey presentation contract', () => {
  it.each([
    [3599, 1, 35990, 1],
    [3600, 2, 0, 3600],
    [3661, 2, 610, 3539],
  ])('turns %i elapsed seconds into hourly level %i and %i EXP', (seconds, level, levelExp, nextLevelInSec) => {
    expect(computeServiceJourney(military, atSecond(seconds))).toMatchObject({
      elapsedSec: seconds,
      level,
      levelExp,
      expPerLevel: 36000,
      nextLevelInSec,
    });
  });

  it('uses actual elapsed time and the fixed service timezone, not visit counts or local midnight', () => {
    const first = computeServiceJourney(military, atDay(100))!;
    const next = computeServiceJourney(military, atDay(100) + 1000)!;
    expect(next.elapsedSec - first.elapsedSec).toBe(1);
    expect(next.levelExp - first.levelExp).toBe(10);
    expect(computeServiceJourney(military, Date.parse('2025-01-01T15:00:00.000Z'))).toMatchObject({
      elapsedSec: SECONDS_PER_DAY,
      level: 25,
      levelExp: 0,
    });
  });

  it.each([
    ['army', '2026-07-02', 35, 547],
    ['marine', '2026-07-02', 49, 547],
    ['navy', '2026-09-01', 42, 608],
    ['airforce', '2026-10-02', 49, 639],
    ['reserve', '2026-07-02', 35, 547],
  ] as const)('uses rank boundaries for every %s nickname stage', (branch, endDate, trainingDays, totalDays) => {
    const info: MilitaryInfo = { ...military, branch, expectedDischargeDate: endDate };
    const day = SECONDS_PER_DAY;
    const pfcThird = ((243 - 61) * day) / 3;
    const cplThird = ((425 - 243) * day) / 3;
    const sgtThird = ((totalDays - 425) * day) / 3;
    const boundaries: Array<[number, string, string]> = [
      [0, '훈련병', '훈련병'],
      [trainingDays * day, '신병', '이등병'],
      [61 * day, '일초', '일병'],
      [61 * day + pfcThird, '일꺾', '일병'],
      [61 * day + pfcThird * 2, '일말', '일병'],
      [243 * day, '상초', '상병'],
      [243 * day + cplThird, '상꺾', '상병'],
      [243 * day + cplThird * 2, '상말', '상병'],
      [425 * day, '병초', '병장'],
      [425 * day + sgtThird, '왕고', '병장'],
      [425 * day + sgtThird * 2, '말년', '병장'],
    ];

    for (const [index, [seconds, stageLabel, estimatedRankLabel]] of boundaries.entries()) {
      // Bracket at millisecond precision: unrounded legacy scaling can put a
      // nominal integer-second boundary a fraction of a nanosecond after it.
      expect(computeServiceJourney(info, atSecond(seconds) + 1)).toMatchObject({
        stageLabel,
        estimatedRankLabel,
        estimatedRanks: true,
      });
      if (index > 0) {
        expect(computeServiceJourney(info, atSecond(seconds) - 1)).toMatchObject({
          stageLabel: boundaries[index - 1][1],
          estimatedRankLabel: boundaries[index - 1][2],
        });
      }
    }
    expect(computeServiceJourney(info, atSecond(totalDays * day))).toMatchObject({
      stageLabel: '전역',
      isDischarged: true,
    });
  });

  it.each(['social_service', 'other'] as const)('retains a rank-free journey and hourly levels for %s', branch => {
    const info: MilitaryInfo = { ...military, branch };
    expect(computeServiceJourney(info, atDay(0))).toMatchObject({ stageLabel: '시작', level: 1, estimatedRanks: false });
    expect(computeServiceJourney(info, atDay(136.75))).toMatchObject({ stageLabel: '적응', level: 3283, estimatedRanks: false });
    expect(computeServiceJourney(info, atDay(273.5))).toMatchObject({ stageLabel: '반환점', level: 6565, estimatedRanks: false });
    expect(computeServiceJourney(info, atDay(410.25))).toMatchObject({ stageLabel: '마지막 여정', level: 9847, estimatedRanks: false });
    expect(computeServiceJourney(info, atDay(547))).toMatchObject({ stageLabel: '복무 완료', level: 13129, estimatedRanks: false });
  });

  it('caps the final level at total service hours plus one and has no next level at MAX', () => {
    expect(computeServiceJourney(military, atSecond(547 * SECONDS_PER_DAY - 1))).toMatchObject({
      level: 13128,
      levelExp: 35990,
      maxLevel: 13129,
      isDischarged: false,
    });
    expect(computeServiceJourney(military, atDay(547))).toMatchObject({
      level: 13129,
      levelExp: 0,
      maxLevel: 13129,
      nextLevelInSec: null,
      isDischarged: true,
      nextStageLabel: null,
    });
    expect(computeServiceJourney(military, atDay(600))).toMatchObject({ level: 13129, isDischarged: true });
  });

  it('handles waiting without earning EXP', () => {
    expect(computeServiceJourney(military, atDay(-1))).toMatchObject({
      level: 0,
      levelExp: 0,
      elapsedSec: 0,
      isBeforeEnlistment: true,
    });
  });

  it('honors a manually entered discharge date', () => {
    const result = computeServiceJourney({ ...military, expectedDischargeDate: '2025-04-11' }, atDay(50))!;
    expect(result.totalDays).toBe(100);
    expect(result.totalPercent).toBe(50);
    expect(result.maxLevel).toBe(2401);
  });

  it('rejects invalid input instead of rendering NaN or default military data', () => {
    expect(computeServiceJourney(undefined, start)).toBeNull();
    expect(computeServiceJourney({ ...military, militaryStatus: 'unknown' }, start)).toBeNull();
    expect(computeServiceJourney({ ...military, enlistmentDate: '2025-02-30' }, start)).toBeNull();
    expect(computeServiceJourney(military, NaN)).toBeNull();
    expect(computeServiceJourney(military, Infinity)).toBeNull();
    expect(computeServiceJourney({ ...military, branch: 'invalid' as Branch }, start)).toBeNull();
  });

  it.each([
    [963510000, '신병', '이등병', 1],
    [963510054, '신병', '이등병', 1],
    [963510055, '일초', '일병', 2],
    [963510999, '일초', '일병', 2],
  ] as const)('keeps nickname, estimated rank and insignia aligned at custom-duration millisecond %i', (elapsedMs, stageLabel, estimatedRankLabel, bars) => {
    // 100-day custom service: pfc begins at 61/547 * 100 days = 963510054.844... ms.
    const info = { ...military, expectedDischargeDate: '2025-04-11' };
    expect(computeServiceJourney(info, start + elapsedMs)).toMatchObject({
      stageLabel, estimatedRankLabel, bars, level: 268, levelExp: 23100,
    });
  });

  it('does not award future EXP when a discharged flag contradicts the entered dates', () => {
    expect(computeServiceJourney({ ...military, militaryStatus: 'discharged' }, atDay(1))).toBeNull();
  });

  it('works on runtimes without Object.hasOwn (supported older iOS WebViews)', () => {
    const original = Object.getOwnPropertyDescriptor(Object, 'hasOwn')!;
    Object.defineProperty(Object, 'hasOwn', { ...original, value: undefined });
    try {
      expect(computeServiceJourney(military, atDay(100))!.stageLabel).toBe('일초');
    } finally {
      Object.defineProperty(Object, 'hasOwn', original);
    }
  });
});
