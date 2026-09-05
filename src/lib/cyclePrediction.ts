import type { CyclePeriod } from '@/types';

export type CyclePredictionStatus =
  | 'insufficient_data'
  | 'personalized'
  | 'withheld';

export type CyclePredictionReviewReason =
  | 'invalid_today'
  | 'insufficient_recent_intervals'
  | 'wide_variation'
  | 'stale_window';

export interface CyclePredictionInput {
  periods: Array<Pick<CyclePeriod, 'startDate' | 'endDate'>>;
  /** Kept as a settings input, but never used to invent a personalised date. */
  configuredCycleLength?: number;
  /** Period duration is intentionally unrelated to start-date prediction. */
  configuredPeriodLength?: number;
  today: string;
}

export interface CyclePrediction {
  status: CyclePredictionStatus;
  reviewReason?: CyclePredictionReviewReason;
  expectedStartDate?: string;
  windowStart?: string;
  windowEnd?: string;
  /** Distinct valid period starts present in the record set. */
  periodsUsed: number;
  /** Consecutive recent intervals actually used by the estimate (max 12). */
  intervalsUsed: number;
  averageCycleLength?: number;
  medianCycleLength?: number;
  shortestCycleLength?: number;
  longestCycleLength?: number;
  methodVersion: string;
}

/** Roughly one year of recent intervals, matching the prior bounded history. */
export const MAX_INTERVALS_CONSIDERED = 12;

const MIN_PLAUSIBLE_INTERVAL_DAYS = 15;
const MAX_PLAUSIBLE_INTERVAL_DAYS = 60;
const OBSERVED_RANGE_MARGIN_DAYS = 2;
const MAX_PREDICTION_WINDOW_DAYS = 14;
const METHOD_VERSION = 'v4.0.0-owner-only';

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function toCalendarDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarDateToTime(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(date: string, days: number): string {
  const shifted = new Date(calendarDateToTime(date));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toCalendarDateString(shifted);
}

function getDaysDifference(from: string, to: string): number {
  return Math.round((calendarDateToTime(to) - calendarDateToTime(from)) / 86_400_000);
}

function calculateMedian(numbers: number[]): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

function withheld(
  status: 'insufficient_data' | 'withheld',
  periodsUsed: number,
  reviewReason?: CyclePredictionReviewReason,
  details: Partial<Pick<
    CyclePrediction,
    'intervalsUsed' | 'averageCycleLength' | 'medianCycleLength'
      | 'shortestCycleLength' | 'longestCycleLength'
  >> = {},
): CyclePrediction {
  return {
    status,
    reviewReason,
    periodsUsed,
    intervalsUsed: details.intervalsUsed ?? 0,
    averageCycleLength: details.averageCycleLength,
    medianCycleLength: details.medianCycleLength,
    shortestCycleLength: details.shortestCycleLength,
    longestCycleLength: details.longestCycleLength,
    methodVersion: METHOD_VERSION,
  };
}

/**
 * Prediction Engine V4.
 *
 * This is a descriptive calendar estimate, not a fertility or medical model.
 * It consumes actual period ranges only; symptoms, mood, flow, pain and notes
 * never enter this boundary. When the record cannot support an honest range it
 * returns no date instead of narrowing or silently dropping inconvenient data.
 */
export function predictCycle(input: CyclePredictionInput): CyclePrediction {
  const { periods, today } = input;

  if (!isCalendarDate(today)) {
    return withheld('withheld', 0, 'invalid_today');
  }

  // Only actual start dates enter the calculation. Malformed or future values
  // are ignored as unusable records; end dates and every daily-log field are
  // deliberately outside this model.
  const validStarts = Array.from(new Set(
    periods
      .map((period) => period.startDate)
      .filter((startDate) => isCalendarDate(startDate) && startDate <= today),
  ))
    .sort((a, b) => a.localeCompare(b));

  if (validStarts.length < 3) {
    return withheld('insufficient_data', validStarts.length);
  }

  // Slice starts before deriving gaps, so the selected intervals remain truly
  // consecutive. Filtering gaps first can bridge across a bad recent record.
  const recentStarts = validStarts.slice(-(MAX_INTERVALS_CONSIDERED + 1));
  const intervals: number[] = [];
  for (let index = recentStarts.length - 1; index >= 1; index -= 1) {
    const interval = getDaysDifference(recentStarts[index - 1], recentStarts[index]);
    if (interval < MIN_PLAUSIBLE_INTERVAL_DAYS || interval > MAX_PLAUSIBLE_INTERVAL_DAYS) {
      break;
    }
    intervals.unshift(interval);
  }

  if (intervals.length < 2) {
    return withheld('withheld', validStarts.length, 'insufficient_recent_intervals', {
      intervalsUsed: intervals.length,
    });
  }

  const sum = intervals.reduce((total, interval) => total + interval, 0);
  const averageCycleLength = Math.round(sum / intervals.length);
  const medianCycleLength = calculateMedian(intervals);
  const shortestCycleLength = Math.min(...intervals);
  const longestCycleLength = Math.max(...intervals);
  const latestStart = recentStarts[recentStarts.length - 1];
  const windowStart = addDays(latestStart, shortestCycleLength - OBSERVED_RANGE_MARGIN_DAYS);
  const windowEnd = addDays(latestStart, longestCycleLength + OBSERVED_RANGE_MARGIN_DAYS);
  const details = {
    intervalsUsed: intervals.length,
    averageCycleLength,
    medianCycleLength,
    shortestCycleLength,
    longestCycleLength,
  };

  const inclusiveWindowDays = getDaysDifference(windowStart, windowEnd) + 1;
  if (inclusiveWindowDays > MAX_PREDICTION_WINDOW_DAYS) {
    return withheld('withheld', intervals.length + 1, 'wide_variation', details);
  }

  const expectedStartDate = addDays(latestStart, medianCycleLength);
  if (windowEnd < today) {
    return withheld('withheld', intervals.length + 1, 'stale_window', details);
  }

  return {
    status: 'personalized',
    expectedStartDate,
    windowStart,
    windowEnd,
    periodsUsed: intervals.length + 1,
    ...details,
    methodVersion: METHOD_VERSION,
  };
}

/** Is `date` inside the predicted start window? Used by the calendar. */
export function predictionOccursOnDate(prediction: CyclePrediction, date: string): boolean {
  if (!prediction.windowStart || !prediction.windowEnd) return false;
  return prediction.windowStart <= date && date <= prediction.windowEnd;
}
