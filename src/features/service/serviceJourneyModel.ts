import type { MilitaryInfo } from '@/types';
import { BRANCH_SPECS, computeServiceExp, SECONDS_PER_DAY, serviceDateAtMs } from '@/lib/serviceLevel';
import type { RankRailStop } from '@/lib/serviceLevel';
import { effectiveDischargeDate } from '@/lib/milestones';

export const SERVICE_EXP_PER_SECOND = 10;
export const SERVICE_EXP_PER_LEVEL = 36_000;
export const SERVICE_SECONDS_PER_LEVEL = SERVICE_EXP_PER_LEVEL / SERVICE_EXP_PER_SECOND;

interface JourneyStageSeed {
  label: string;
  atSec: number;
  estimatedRankLabel?: string;
}

function finishStages(seeds: JourneyStageSeed[], elapsedSec: number, totalSec: number, waiting: boolean, complete: boolean) {
  let currentIndex = -1;
  if (complete) currentIndex = seeds.length - 1;
  else if (!waiting) {
    for (let index = 0; index < seeds.length; index += 1) {
      if (elapsedSec >= seeds[index].atSec) currentIndex = index;
    }
  }

  return seeds.map((stage, index) => ({
    ...stage,
    percent: totalSec > 0 ? stage.atSec / totalSec * 100 : 0,
    current: index === currentIndex,
    past: index < currentIndex,
  }));
}

function buildMilitaryStages(
  rankStops: readonly RankRailStop[],
  elapsedSec: number,
  totalSec: number,
  waiting: boolean,
  complete: boolean,
) {
  const seeds: JourneyStageSeed[] = [];
  const labelsByRank = {
    trainee: ['훈련병'],
    pvt: ['신병'],
    pfc: ['일초', '일꺾', '일말'],
    cpl: ['상초', '상꺾', '상말'],
    sgt: ['병초', '왕고', '말년'],
    vet: ['전역'],
  } as const;

  rankStops.forEach((stop, index) => {
    const labels = labelsByRank[stop.key];
    const startSec = Math.round(stop.day * SECONDS_PER_DAY);
    const nextSec = Math.round((rankStops[index + 1]?.day ?? stop.day) * SECONDS_PER_DAY);
    const intervalSec = Math.max(0, nextSec - startSec);
    labels.forEach((label, labelIndex) => {
      seeds.push({
        label,
        atSec: Math.round(startSec + intervalSec * labelIndex / labels.length),
        estimatedRankLabel: stop.key === 'vet' ? '전역' : stop.label,
      });
    });
  });

  return finishStages(seeds, elapsedSec, totalSec, waiting, complete);
}

function buildNeutralStages(elapsedSec: number, totalSec: number, waiting: boolean, complete: boolean) {
  const labels = ['시작', '적응', '반환점', '마지막 여정', '복무 완료'];
  return finishStages(labels.map((label, index) => ({
    label,
    atSec: totalSec * index / (labels.length - 1),
  })), elapsedSec, totalSec, waiting, complete);
}

/** A local-time display projection, never earned state or a military promotion record. */
export function computeServiceJourney(military: MilitaryInfo | undefined, nowMs: number) {
  if (!Number.isFinite(nowMs)) return null;
  if (!military || !Object.prototype.hasOwnProperty.call(BRANCH_SPECS, military.branch)) return null;
  const endMs = serviceDateAtMs(effectiveDischargeDate(military) ?? '');
  if (military.militaryStatus === 'discharged' && endMs !== null && endMs > nowMs) return null;
  const exp = computeServiceExp(military, nowMs);
  if (!exp) return null;

  const estimatedRanks = exp.branch !== 'social_service' && exp.branch !== 'other';
  const elapsedSec = Math.floor(exp.elapsedSec);
  const maxLevel = Math.floor(exp.totalSec / SERVICE_SECONDS_PER_LEVEL) + 1;
  const level = exp.isBeforeEnlistment
    ? 0
    : exp.isDischarged
      ? maxLevel
      : Math.min(maxLevel - 1, Math.floor(elapsedSec / SERVICE_SECONDS_PER_LEVEL) + 1);
  const intoLevelSec = exp.isBeforeEnlistment || exp.isDischarged
    ? 0
    : elapsedSec % SERVICE_SECONDS_PER_LEVEL;
  const levelExp = intoLevelSec * SERVICE_EXP_PER_SECOND;
  const levelExpPercent = exp.isDischarged ? 100 : levelExp / SERVICE_EXP_PER_LEVEL * 100;
  const nextLevelInSec = exp.isBeforeEnlistment || exp.isDischarged
    ? null
    : SERVICE_SECONDS_PER_LEVEL - intoLevelSec;
  const stages = estimatedRanks
    ? buildMilitaryStages(exp.stages, elapsedSec, exp.totalSec, exp.isBeforeEnlistment, exp.isDischarged)
    : buildNeutralStages(elapsedSec, exp.totalSec, exp.isBeforeEnlistment, exp.isDischarged);
  const currentIndex = stages.findIndex(stage => stage.current);
  const currentStage = currentIndex >= 0 ? stages[currentIndex] : null;
  const nextStage = exp.isDischarged ? null : stages[exp.isBeforeEnlistment ? 0 : currentIndex + 1];
  const stageLabel = exp.isBeforeEnlistment
    ? '시작을 기다리며'
    : currentStage?.label ?? (estimatedRanks ? '훈련병' : '시작');
  const estimatedRankLabel = exp.isBeforeEnlistment
    ? '입대 대기'
    : currentStage?.estimatedRankLabel ?? null;
  const nextStageDays = exp.isBeforeEnlistment
    ? exp.daysUntilEnlistment
    : nextStage
      ? Math.max(0, Math.ceil((nextStage.atSec - elapsedSec) / SECONDS_PER_DAY))
      : null;

  return {
    branchName: exp.branchName,
    isBeforeEnlistment: exp.isBeforeEnlistment,
    isDischarged: exp.isDischarged,
    totalPercent: exp.totalPercent,
    totalDays: exp.totalDays,
    elapsedDays: exp.elapsedDays,
    elapsedSec,
    remainingDays: exp.remainingDays,
    daysUntilEnlistment: exp.daysUntilEnlistment,
    level,
    maxLevel,
    levelExp,
    expPerLevel: SERVICE_EXP_PER_LEVEL,
    expPerSecond: SERVICE_EXP_PER_SECOND,
    secPerLevel: SERVICE_SECONDS_PER_LEVEL,
    intoLevelSec,
    nextLevelInSec,
    levelExpPercent,
    stages,
    stageLabel,
    estimatedRankLabel,
    estimatedRanks,
    bars: estimatedRanks ? exp.rank.bars : 0,
    nextStageLabel: nextStage?.label ?? null,
    nextStageDays,
  };
}
