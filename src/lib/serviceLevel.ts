import type { ServiceProgress } from '@/lib/milestones';

export interface ServiceRankStage {
  level: number;
  label: string;
  levelBadge: string;
  thresholdPercent: number;
}

export interface ServiceLevel {
  level: number;
  levelBadge: string;
  label: string;
  rankExpPercent: number;
  nextLevel: number | null;
  nextLabel: string | null;
  nextPercent: number | null;
  remainingPercent: number | null;
  remainingDaysToNext: number | null;
  isDischarged: boolean;
  isPreEnlistment: boolean;
  stages: readonly ServiceRankStage[];
}

export const SERVICE_LEVELS: readonly ServiceRankStage[] = [
  { level: 1, label: '이등병', levelBadge: 'Lv.1', thresholdPercent: 0 },
  { level: 2, label: '일병', levelBadge: 'Lv.2', thresholdPercent: 25 },
  { level: 3, label: '상병', levelBadge: 'Lv.3', thresholdPercent: 50 },
  { level: 4, label: '병장', levelBadge: 'Lv.4', thresholdPercent: 75 },
  { level: 5, label: '전역', levelBadge: 'MAX', thresholdPercent: 100 },
] as const;

export const SERVICE_RANK_STAGES: readonly ServiceRankStage[] = SERVICE_LEVELS.slice(0, 4);

/**
 * Personal service rank stages and experience points within the current tier.
 * This never evaluates relationship scores, affection ratings, or social comparisons.
 */
export function computeServiceLevel(progress: ServiceProgress | null): ServiceLevel | null {
  if (!progress) return null;

  if (progress.isBeforeEnlistment) {
    return {
      level: 0,
      levelBadge: '대기',
      label: '입대 대기',
      rankExpPercent: 0,
      nextLevel: 1,
      nextLabel: SERVICE_LEVELS[0].label,
      nextPercent: SERVICE_LEVELS[0].thresholdPercent,
      remainingPercent: 0,
      remainingDaysToNext: progress.daysUntilEnlistment ?? 0,
      isDischarged: false,
      isPreEnlistment: true,
      stages: SERVICE_RANK_STAGES,
    };
  }

  const isCompleted = progress.isDischarged || progress.percent >= 100;
  const current = isCompleted
    ? SERVICE_LEVELS[SERVICE_LEVELS.length - 1]
    : [...SERVICE_LEVELS.slice(0, 4)].reverse().find(({ thresholdPercent }) => progress.percent >= thresholdPercent)
      || SERVICE_LEVELS[0];
  const next = isCompleted
    ? null
    : SERVICE_LEVELS.find(({ level }) => level === current.level + 1) ?? null;

  const nextPercent = next?.thresholdPercent ?? null;
  const remainingPercent = nextPercent !== null
    ? Math.max(0, Math.round((nextPercent - progress.percent) * 10) / 10)
    : null;
  const targetElapsedDays = nextPercent !== null
    ? Math.ceil((nextPercent / 100) * progress.totalDays)
    : null;
  const remainingDaysToNext = targetElapsedDays !== null
    ? Math.max(0, targetElapsedDays - progress.elapsedDays)
    : null;

  // Experience point (EXP) percentage within current rank tier (0 ~ 100%)
  let rankExpPercent: number;
  if (isCompleted) {
    rankExpPercent = 100;
  } else {
    const stageStart = current.thresholdPercent;
    const stageEnd = nextPercent ?? 100;
    const stageSpan = stageEnd - stageStart;
    if (stageSpan <= 0 || progress.percent <= stageStart) {
      rankExpPercent = 0;
    } else {
      const rawExp = ((progress.percent - stageStart) / stageSpan) * 100;
      rankExpPercent = Math.min(100, Math.max(0, Math.round(rawExp * 10) / 10));
    }
  }

  return {
    level: current.level,
    levelBadge: current.levelBadge,
    label: current.label,
    rankExpPercent,
    nextLevel: next?.level ?? null,
    nextLabel: next?.label ?? null,
    nextPercent: next?.thresholdPercent ?? null,
    remainingPercent,
    remainingDaysToNext,
    isDischarged: isCompleted,
    isPreEnlistment: false,
    stages: SERVICE_RANK_STAGES,
  };
}
