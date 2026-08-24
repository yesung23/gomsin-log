import { describe, expect, it } from 'vitest';
import {
  computeServiceExp,
  computeServiceLevel,
  buildPhases,
  buildRankRailStops,
  formatExpNumber,
  formatExpPercent,
  formatShortSpan,
  SECONDS_PER_DAY,
  SERVICE_RANKS,
  SERVICE_TIERS,
  serviceDateAtMs,
} from './serviceLevel';
import type { MilitaryInfo, Branch } from '@/types';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';

const ARMY_SAMPLE: MilitaryInfo = {
  branch: 'army',
  militaryStatus: 'serving',
  enlistmentDate: '2025-01-01',
  expectedDischargeDate: '2026-07-02', // 547 days (army standard)
  dischargeDateSource: 'calculated',
};

describe('computeServiceExp', () => {
  it('returns null when military info or dates are missing or unknown', () => {
    expect(computeServiceExp(undefined)).toBeNull();
    expect(computeServiceExp({ branch: 'army', militaryStatus: 'unknown' })).toBeNull();
    expect(computeServiceExp({ branch: 'army', militaryStatus: 'serving' })).toBeNull();
    expect(computeServiceExp({ branch: 'army', militaryStatus: 'serving', enlistmentDate: '2025-01-01' })).toBeNull();
  });

  it('accurately advances elapsed seconds and EXP 1-for-1 with nowMs injection', () => {
    const startMs = serviceDateAtMs(ARMY_SAMPLE.enlistmentDate!)!;

    // t = 0
    const s0 = computeServiceExp(ARMY_SAMPLE, startMs);
    expect(s0).not.toBeNull();
    expect(s0?.elapsedSec).toBe(0);
    expect(s0?.level).toBe(1);
    expect(s0?.rank.key).toBe('trainee');
    expect(s0?.totalSec).toBe(547 * SECONDS_PER_DAY);

    // t = 1 second later -> exactly +1 EXP
    const s1 = computeServiceExp(ARMY_SAMPLE, startMs + 1000);
    expect(s1?.elapsedSec).toBe(1);
    expect(s1?.todayExp).toBe(1);

    // t = 100 seconds later -> exactly +100 EXP
    const s100 = computeServiceExp(ARMY_SAMPLE, startMs + 100 * 1000);
    expect(s100?.elapsedSec).toBe(100);
    expect(s100?.todayExp).toBe(100);
  });

  it('supports 4 decimal places for total percentage', () => {
    const startMs = serviceDateAtMs(ARMY_SAMPLE.enlistmentDate!)!;
    // After 100 days
    const s = computeServiceExp(ARMY_SAMPLE, startMs + 100 * SECONDS_PER_DAY * 1000);
    expect(s).not.toBeNull();
    expect(formatExpPercent(s!.totalPercent, 4)).toBe(( (100 / 547) * 100 ).toFixed(4) + '%');
  });

  it('maps the visible service journey to seven slang tiers at fixed progress boundaries', () => {
    const startMs = serviceDateAtMs(ARMY_SAMPLE.enlistmentDate!)!;
    const expected = [
      [0, 'recruit', '신병'],
      [10, 'ilcho', '일초'],
      [25, 'ilkkak', '일꺾'],
      [40, 'ilmal', '일말'],
      [55, 'sangcho', '상초'],
      [70, 'sangkkak', '상꺾'],
      [85, 'wanggo', '왕고'],
    ] as const;

    expect(SERVICE_TIERS.map((tier) => tier.minPercent)).toEqual([0, 10, 25, 40, 55, 70, 85]);
    expect(SERVICE_TIERS.map((tier) => tier.level)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(SERVICE_TIERS.filter((tier) => tier.isBent).map((tier) => tier.key)).toEqual(['ilkkak', 'sangkkak']);

    expected.forEach(([percent, key, label]) => {
      const result = computeServiceExp(ARMY_SAMPLE, startMs + (547 * SECONDS_PER_DAY * percent) / 100 * 1000);
      expect(result?.tier.key).toBe(key);
      expect(result?.tier.label).toBe(label);
      expect(result?.tierStops).toHaveLength(7);
    });
  });

  it('correctly maps all 7 phases and rank transitions for army (547 days)', () => {
    const startMs = serviceDateAtMs(ARMY_SAMPLE.enlistmentDate!)!;

    // D+0: 훈련병, 입영 첫날 (Lv.1)
    const d0 = computeServiceExp(ARMY_SAMPLE, startMs);
    expect(d0?.rank.key).toBe('trainee');
    expect(d0?.level).toBe(1);
    expect(d0?.phaseTag).toBe('입영 첫날');

    // D+1: 훈련병, 훈련 1주차 (Lv.10)
    const d1 = computeServiceExp(ARMY_SAMPLE, startMs + 1 * SECONDS_PER_DAY * 1000);
    expect(d1?.rank.key).toBe('trainee');
    expect(d1?.level).toBe(10);
    expect(d1?.phaseTag).toBe('훈련 1주차');

    // D+7: 훈련병, 수료 준비 (Lv.25)
    const d7 = computeServiceExp(ARMY_SAMPLE, startMs + 7 * SECONDS_PER_DAY * 1000);
    expect(d7?.rank.key).toBe('trainee');
    expect(d7?.level).toBe(25);
    expect(d7?.phaseTag).toBe('수료 준비');

    // D+35: 이등병, 자대 적응 (Lv.45)
    const d35 = computeServiceExp(ARMY_SAMPLE, startMs + 35 * SECONDS_PER_DAY * 1000);
    expect(d35?.rank.key).toBe('pvt');
    expect(d35?.level).toBe(45);
    expect(d35?.phaseTag).toBe('자대 적응');

    // D+61: 일병, 일병 구간 (Lv.60)
    const d61 = computeServiceExp(ARMY_SAMPLE, startMs + 61 * SECONDS_PER_DAY * 1000);
    expect(d61?.rank.key).toBe('pfc');
    expect(d61?.level).toBe(60);
    expect(d61?.phaseTag).toBe('일병 구간');

    // D+243: 상병, 상병 구간 (Lv.115)
    const d243 = computeServiceExp(ARMY_SAMPLE, startMs + 243 * SECONDS_PER_DAY * 1000);
    expect(d243?.rank.key).toBe('cpl');
    expect(d243?.level).toBe(115);
    expect(d243?.phaseTag).toBe('상병 구간');

    // D+425: 병장, 말년 (Lv.165)
    const d425 = computeServiceExp(ARMY_SAMPLE, startMs + 425 * SECONDS_PER_DAY * 1000);
    expect(d425?.rank.key).toBe('sgt');
    expect(d425?.level).toBe(165);
    expect(d425?.phaseTag).toBe('말년');

    // D+547: 전역 (Lv.200 MAX, 예비역)
    const d547 = computeServiceExp(ARMY_SAMPLE, startMs + 547 * SECONDS_PER_DAY * 1000);
    expect(d547?.isDischarged).toBe(true);
    expect(d547?.level).toBe(200);
    expect(d547?.levelBadge).toBe('MAX');
    expect(d547?.rank.key).toBe('vet');
    expect(d547?.totalPercent).toBe(100);
    expect(d547?.tier.key).toBe('wanggo');
    expect(d547?.tier.level).toBe(7);
    expect(d547?.nextTier).toBeNull();
  });

  it('handles before enlistment cleanly with Lv.0 대기 and countdown', () => {
    const startMs = serviceDateAtMs(ARMY_SAMPLE.enlistmentDate!)!;
    const beforeMs = startMs - 45 * SECONDS_PER_DAY * 1000;

    const res = computeServiceExp(ARMY_SAMPLE, beforeMs);
    expect(res?.isBeforeEnlistment).toBe(true);
    expect(res?.level).toBe(0);
    expect(res?.levelBadge).toBe('대기');
    expect(res?.daysUntilEnlistment).toBe(45);
    expect(res?.totalPercent).toBe(0);
    expect(res?.elapsedSec).toBe(0);
  });

  it('does not let a stale planned status freeze EXP after the enlistment date', () => {
    const plannedMilitary: MilitaryInfo = {
      ...ARMY_SAMPLE,
      militaryStatus: 'planned',
    };
    const startMs = serviceDateAtMs(plannedMilitary.enlistmentDate!)!;

    const atEnlistment = computeServiceExp(plannedMilitary, startMs);
    const oneSecondLater = computeServiceExp(plannedMilitary, startMs + 1000);

    expect(atEnlistment?.isBeforeEnlistment).toBe(false);
    expect(atEnlistment?.elapsedSec).toBe(0);
    expect(oneSecondLater?.elapsedSec).toBe(1);
    expect(oneSecondLater?.level).toBe(1);
  });

  it('handles post-discharge cleanly with Lv.200 MAX and 100%', () => {
    const startMs = serviceDateAtMs(ARMY_SAMPLE.enlistmentDate!)!;
    const afterMs = startMs + 600 * SECONDS_PER_DAY * 1000; // Past 547 days

    const res = computeServiceExp(ARMY_SAMPLE, afterMs);
    expect(res?.isDischarged).toBe(true);
    expect(res?.level).toBe(200);
    expect(res?.levelBadge).toBe('MAX');
    expect(res?.rank.key).toBe('vet');
    expect(res?.totalPercent).toBe(100);
    expect(res?.remainingDays).toBe(0);
  });

  it('handles multi-branch specifications (marine, navy, airforce, social_service)', () => {
    const branches: Branch[] = ['marine', 'navy', 'airforce', 'social_service', 'reserve', 'other'];

    branches.forEach((branch) => {
      const military: MilitaryInfo = {
        branch,
        militaryStatus: 'serving',
        enlistmentDate: '2025-01-01',
        expectedDischargeDate: '2026-10-01',
        dischargeDateSource: 'manual',
      };

      const startMs = serviceDateAtMs(military.enlistmentDate!)!;
      const res = computeServiceExp(military, startMs + 10 * SECONDS_PER_DAY * 1000);
      expect(res).not.toBeNull();
      expect(res?.branch).toBe(branch);
      expect(res?.level).toBeGreaterThan(0);
      expect(res?.stages.length).toBe(6);
    });
  });

  it('preserves user custom discharge date without overriding', () => {
    const customMilitary: MilitaryInfo = {
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2025-01-01',
      expectedDischargeDate: '2026-06-25', // 540 days instead of 547
      dischargeDateSource: 'manual',
    };

    const startMs = serviceDateAtMs(customMilitary.enlistmentDate!)!;
    const res = computeServiceExp(customMilitary, startMs + 540 * SECONDS_PER_DAY * 1000);
    expect(res?.totalDays).toBe(540);
    expect(res?.isDischarged).toBe(true);
    expect(res?.level).toBe(200);
  });

  it('scales game stages to a shorter custom service period without duplicate milestones', () => {
    const enlistmentDate = '2025-01-01';
    const discharge = parseLocalDate(enlistmentDate);
    discharge.setDate(discharge.getDate() + 300);
    const shortMilitary: MilitaryInfo = {
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate,
      expectedDischargeDate: toLocalDateString(discharge),
      dischargeDateSource: 'manual',
    };
    const startMs = serviceDateAtMs(enlistmentDate)!;
    const beforeDischarge = computeServiceExp(shortMilitary, startMs + (300 * SECONDS_PER_DAY) * 1000 - 1000);
    const atDischarge = computeServiceExp(shortMilitary, startMs + 300 * SECONDS_PER_DAY * 1000);

    expect(beforeDischarge?.isDischarged).toBe(false);
    expect(beforeDischarge?.rank.key).toBe('sgt');
    expect(beforeDischarge?.level).toBe(199);
    expect(beforeDischarge?.stages.map((stage) => stage.day)).toEqual(
      [...(beforeDischarge?.stages ?? [])].map((stage) => stage.day).sort((a, b) => a - b),
    );
    expect(new Set(beforeDischarge?.stages.map((stage) => stage.day)).size).toBe(6);
    expect(atDischarge?.isDischarged).toBe(true);
    expect(atDischarge?.levelBadge).toBe('MAX');
  });

  it('prefers the actual discharge date and stops the daily gauge after discharge', () => {
    const actualMilitary: MilitaryInfo = {
      ...ARMY_SAMPLE,
      dischargeDate: '2026-06-25',
      dischargeDateSource: 'manual',
    };
    const startMs = serviceDateAtMs(actualMilitary.enlistmentDate!)!;
    const result = computeServiceExp(actualMilitary, startMs + 540 * SECONDS_PER_DAY * 1000);

    expect(result?.totalDays).toBe(540);
    expect(result?.isDischarged).toBe(true);
    expect(result?.todayExp).toBe(0);
  });

  it('returns null for malformed calendar dates instead of normalizing them', () => {
    expect(
      computeServiceExp({
        ...ARMY_SAMPLE,
        enlistmentDate: '2025-02-31',
      }),
    ).toBeNull();
  });

  it('uses a fixed Seoul calendar timeline across daylight-saving date boundaries', () => {
    const springBoundary = serviceDateAtMs('2025-03-09')!;
    const nextCalendarDay = serviceDateAtMs('2025-03-10')!;

    expect(nextCalendarDay - springBoundary).toBe(SECONDS_PER_DAY * 1000);
    expect(serviceDateAtMs('2025-02-31')).toBeNull();
  });

  it('EXP is strictly monotonically non-decreasing over time', () => {
    const startMs = serviceDateAtMs(ARMY_SAMPLE.enlistmentDate!)!;
    let lastExp = -1;

    for (let day = 0; day <= 550; day += 25) {
      const res = computeServiceExp(ARMY_SAMPLE, startMs + day * SECONDS_PER_DAY * 1000);
      expect(res?.elapsedSec).toBeGreaterThanOrEqual(lastExp);
      lastExp = res!.elapsedSec;
    }
  });
});

describe('formatters', () => {
  it('formats numbers and spans properly', () => {
    expect(formatExpNumber(47260800)).toBe('47,260,800');
    expect(formatExpPercent(56.123456, 4)).toBe('56.1235%');
    expect(formatShortSpan(86400 * 3 + 3600 * 4 + 60 * 22 + 7)).toBe('3일 04:22:07');
    expect(formatShortSpan(3600 * 2 + 60 * 5 + 9)).toBe('02:05:09');
  });
});
