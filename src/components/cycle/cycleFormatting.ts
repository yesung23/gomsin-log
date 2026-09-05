import type { CycleDailyLog, CycleFlow, CycleMood, CyclePainLevel, CycleSymptom } from '@/types';

/**
 * Shared copy for the cycle surface.
 *
 * Kept in one module so the quick chips, the detail sheet and the day sheet
 * cannot drift into three different words for the same symptom.
 */

/**
 * What a single calendar day can be marked as.
 *
 * Lives here rather than beside the drawing in `CycleDayMarker` so the legend, the
 * `aria-label` and the glyph cannot drift into three different words for the same
 * day -- the same reason the symptom labels are here.
 */
export type CycleDayMark = 'period' | 'period_predicted';

export const cycleDayMarkLabels: Record<CycleDayMark, string> = {
  period: '생리 기록',
  /*
   * `기간`, not just `예상`. It names a WINDOW rather than a day, which is what the
   * estimate actually is -- and it is the wording the calendar's accessible name
   * has always used, pinned by `cycleV3DataPath.test.tsx`. One string for both the
   * legend and the label, so the two cannot drift.
   */
  period_predicted: '생리 예상 기간',
};

export const symptomLabels: Record<CycleSymptom, string> = {
  cramps: '복부 불편감',
  headache: '두통',
  fatigue: '피로',
  bloating: '더부룩함',
  mood_changes: '기분 변화',
  backache: '허리 불편감',
  nausea: '메스꺼움',
  // `불편감`, not `통증`, for the same reason as 복부 and 허리 above: this surface
  // says how a day feels, and naming it as pain reads as a diagnosis.
  breast_tenderness: '가슴 불편감',
};

/**
 * The four chips offered on the main screen.
 *
 * Not all six: the first screen is for the one-tap case, and the remaining
 * symptoms are one tap away in the detail sheet. Ordered by how often they are
 * reported alongside a period.
 */
export const QUICK_SYMPTOMS: CycleSymptom[] = ['cramps', 'headache', 'fatigue', 'bloating'];

export const flowLabels: Record<CycleFlow, string> = {
  spotting: '점상',
  light: '적음',
  medium: '보통',
  heavy: '많음',
};

export const painLabels: Record<CyclePainLevel, string> = {
  none: '없음',
  mild: '약함',
  moderate: '보통',
  severe: '심함',
};

export const moodLabels: Record<CycleMood, string> = {
  calm: '편안',
  sensitive: '예민',
  sad: '울적',
  tired: '피곤',
  good: '괜찮음',
};

/** `2026-08-14` -> `8월 14일`. Parsed by field, never through `new Date(string)`. */
export function formatKoreanDate(date: string): string {
  const [, month, day] = date.split('-');
  if (!month || !day) return date;
  return `${Number(month)}월 ${Number(day)}일`;
}

/** A short human summary of a day's log, for the day sheet. */
export function summariseDailyLog(log: CycleDailyLog): string[] {
  const lines: string[] = [];
  if (log.symptoms.length > 0) {
    lines.push(log.symptoms.map((symptom) => symptomLabels[symptom]).join(' · '));
  }
  return lines;
}
