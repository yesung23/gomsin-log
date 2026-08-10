import type {
  CycleDailyLog,
  CycleFlow,
  CycleMood,
  CyclePainLevel,
  CycleSymptom,
} from '@/types';

/**
 * Editor draft shapes, kept apart on purpose.
 *
 * `CycleDailyLogDraft` has no `startDate` / `endDate` and `CyclePeriodDraft` has
 * no symptoms or note, so neither editor can express the other's record. This is
 * the type-level half of the V3 invariant: logging a condition cannot create a
 * period because there is no field in which to put one.
 *
 * In their own module rather than beside the components so the component files
 * export components only, which keeps fast-refresh working.
 */

export interface CycleDailyLogDraft {
  logDate: string;
  flow?: CycleFlow;
  painLevel?: CyclePainLevel;
  symptoms: CycleSymptom[];
  mood?: CycleMood;
  note: string;
}

export interface CyclePeriodDraft {
  startDate: string;
  endDate?: string;
}

/** Seed a daily-log draft from the stored row, or blank when there is none. */
export function draftFromDailyLog(date: string, log: CycleDailyLog | null): CycleDailyLogDraft {
  return {
    logDate: date,
    flow: log?.flow,
    painLevel: log?.painLevel,
    symptoms: log ? [...log.symptoms] : [],
    mood: log?.mood,
    note: log?.note || '',
  };
}
