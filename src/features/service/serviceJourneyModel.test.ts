import { describe, expect, it } from 'vitest';
import type { MilitaryInfo } from '@/types';
import { serviceDateAtMs, SECONDS_PER_DAY } from '@/lib/serviceLevel';
import { computeServiceJourney } from './serviceJourneyModel';

const military: MilitaryInfo = {
  branch: 'army', militaryStatus: 'serving', enlistmentDate: '2025-01-01',
  expectedDischargeDate: '2026-07-02', dischargeDateSource: 'manual',
};
const start = serviceDateAtMs(military.enlistmentDate!)!;
const atDay = (days: number) => start + days * SECONDS_PER_DAY * 1000;

describe('service journey presentation contract', () => {
  it('uses actual elapsed seconds, including time away, not visit counts', () => {
    const first = computeServiceJourney(military, atDay(100))!;
    const next = computeServiceJourney(military, atDay(100) + 1000)!;
    expect(next.elapsedSec - first.elapsedSec).toBe(1);
    expect(next.intoLevelSec - first.intoLevelSec).toBeCloseTo(1);
    expect(computeServiceJourney(military, atDay(120))!.elapsedSec).toBe(120 * SECONDS_PER_DAY);
  });
  it('has one coherent rank rail, explicit estimates and bounded levels', () => {
    const result = computeServiceJourney(military, atDay(243))!;
    expect(result.stageLabel).toBe('상병');
    expect(result.estimatedRanks).toBe(true);
    expect(result.level).toBe(115);
    expect(result.levelExpPercent).toBe(0);
    expect(result.stages.map(stage => stage.label)).toEqual(['훈련병', '이등병', '일병', '상병', '병장', '전역']);
  });
  it.each(['social_service', 'other'] as const)('does not invent military ranks for %s', branch => {
    const result = computeServiceJourney({ ...military, branch }, atDay(273.5))!;
    expect(result.estimatedRanks).toBe(false);
    expect(result.stageLabel).toBe('반환점');
    expect(result.level).toBe(100);
    expect(result.stages.map(stage => stage.label)).toEqual(['시작', '적응', '반환점', '마지막 여정', '복무 완료']);
  });
  it('handles waiting and completion without falsely earning or overfilling EXP', () => {
    expect(computeServiceJourney(military, atDay(-1))).toMatchObject({ level: 0, elapsedSec: 0, isBeforeEnlistment: true });
    expect(computeServiceJourney(military, atDay(600))).toMatchObject({ level: 200, totalPercent: 100, isDischarged: true, nextStageLabel: null });
  });
  it('honors a manually entered discharge date', () => {
    const result = computeServiceJourney({ ...military, expectedDischargeDate: '2025-04-11' }, atDay(50))!;
    expect(result.totalDays).toBe(100);
    expect(result.totalPercent).toBe(50);
  });
  it('rejects invalid input instead of rendering NaN or default military data', () => {
    expect(computeServiceJourney(undefined, start)).toBeNull();
    expect(computeServiceJourney({ ...military, militaryStatus: 'unknown' }, start)).toBeNull();
    expect(computeServiceJourney({ ...military, enlistmentDate: '2025-02-30' }, start)).toBeNull();
    expect(computeServiceJourney(military, NaN)).toBeNull();
    expect(computeServiceJourney(military, Infinity)).toBeNull();
    expect(computeServiceJourney({ ...military, branch: 'invalid' } as unknown as MilitaryInfo, start)).toBeNull();
  });
  it('does not award future EXP when a discharged flag contradicts the entered dates', () => {
    expect(computeServiceJourney({ ...military, militaryStatus: 'discharged' }, atDay(1))).toBeNull();
  });
  it('works on runtimes without Object.hasOwn (supported older iOS WebViews)', () => {
    const original = Object.getOwnPropertyDescriptor(Object, 'hasOwn')!;
    Object.defineProperty(Object, 'hasOwn', { ...original, value: undefined });
    try {
      expect(computeServiceJourney(military, atDay(100))!.stageLabel).toBe('일병');
    } finally {
      Object.defineProperty(Object, 'hasOwn', original);
    }
  });
});
