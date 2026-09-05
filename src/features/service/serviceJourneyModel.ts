import type { MilitaryInfo } from '@/types';
import { BRANCH_SPECS, computeServiceExp, serviceDateAtMs } from '@/lib/serviceLevel';
import { effectiveDischargeDate } from '@/lib/milestones';

/** A display projection, never a military personnel/promotion record. */
export function computeServiceJourney(military: MilitaryInfo | undefined, nowMs: number) {
  if (!Number.isFinite(nowMs)) return null;
  if (!military || !Object.hasOwn(BRANCH_SPECS, military.branch)) return null;
  const endMs = serviceDateAtMs(effectiveDischargeDate(military) ?? '');
  if (military.militaryStatus === 'discharged' && endMs !== null && endMs > nowMs) return null;
  const exp = computeServiceExp(military, nowMs);
  if (!exp) return null;
  const estimatedRanks = exp.branch !== 'social_service' && exp.branch !== 'other';
  const neutralLabels = ['시작', '적응', '반환점', '마지막 여정', '복무 완료'];
  const neutralIndex = Math.min(4, Math.floor(exp.totalPercent / 25));
  const stages = estimatedRanks
    ? exp.stages.map(stage => ({
      label: stage.key === 'vet' ? '전역' : stage.label,
      percent: stage.thresholdPercent, current: stage.isCurrent, past: stage.isPast,
    }))
    : neutralLabels.map((label, index) => ({
      label, percent: index * 25,
      current: !exp.isBeforeEnlistment && index === neutralIndex,
      past: !exp.isBeforeEnlistment && index < neutralIndex,
    }));
  const neutralExactLevel = 1 + exp.totalPercent / 100 * 199;
  const level = estimatedRanks ? exp.level
    : exp.isBeforeEnlistment ? 0 : exp.isDischarged ? 200 : Math.min(199, Math.floor(neutralExactLevel));
  const secPerLevel = estimatedRanks ? exp.secPerLevel : exp.totalSec / 199;
  const intoLevelSec = estimatedRanks ? exp.intoLevelSec
    : exp.isBeforeEnlistment || exp.isDischarged ? 0 : (neutralExactLevel - level) * secPerLevel;
  const levelExpPercent = estimatedRanks ? exp.levelExpPercent
    : exp.isDischarged ? 100 : Math.max(0, Math.min(100, intoLevelSec / secPerLevel * 100));
  const stageLabel = exp.isBeforeEnlistment ? '시작을 기다리며'
    : exp.isDischarged ? (estimatedRanks ? '전역' : '복무 완료')
    : estimatedRanks ? exp.rank.label : neutralLabels[neutralIndex];
  const currentIndex = stages.findIndex(stage => stage.current);
  const next = exp.isDischarged ? null : stages[exp.isBeforeEnlistment ? 0 : currentIndex + 1];
  return {
    branchName: exp.branchName,
    isBeforeEnlistment: exp.isBeforeEnlistment,
    isDischarged: exp.isDischarged,
    totalPercent: exp.totalPercent,
    totalDays: exp.totalDays,
    elapsedDays: exp.elapsedDays,
    elapsedSec: exp.elapsedSec,
    remainingDays: exp.remainingDays,
    daysUntilEnlistment: exp.daysUntilEnlistment,
    level, secPerLevel, intoLevelSec, levelExpPercent, stages, stageLabel, estimatedRanks,
    bars: estimatedRanks ? exp.rank.bars : 0,
    nextStageLabel: next?.label ?? null,
    nextStageDays: exp.isBeforeEnlistment ? exp.daysUntilEnlistment
      : estimatedRanks ? exp.remainingDaysToNextPromo
      : next ? Math.max(0, Math.ceil((next.percent - exp.totalPercent) / 100 * exp.totalDays)) : null,
  };
}
