import type { ServiceProgress } from '@/lib/milestones';

export interface ServiceLevel {
  level: number;
  label: string;
  nextLevel: number | null;
  nextLabel: string | null;
  nextPercent: number | null;
}

const SERVICE_LEVELS = [
  { level: 1, label: '시작', thresholdPercent: 0 },
  { level: 2, label: '적응', thresholdPercent: 25 },
  { level: 3, label: '중반', thresholdPercent: 50 },
  { level: 4, label: '후반', thresholdPercent: 75 },
  { level: 5, label: '완주', thresholdPercent: 100 },
] as const;

/** Personal service progress stages; this never compares one person with another. */
export function computeServiceLevel(progress: ServiceProgress | null): ServiceLevel | null {
  if (!progress) return null;

  const current = progress.isDischarged
    ? SERVICE_LEVELS[SERVICE_LEVELS.length - 1]
    : [...SERVICE_LEVELS].reverse().find(({ thresholdPercent }) => progress.percent >= thresholdPercent)
      || SERVICE_LEVELS[0];
  const next = SERVICE_LEVELS.find(({ level }) => level === current.level + 1) ?? null;

  return {
    level: current.level,
    label: current.label,
    nextLevel: next?.level ?? null,
    nextLabel: next?.label ?? null,
    nextPercent: next?.thresholdPercent ?? null,
  };
}
