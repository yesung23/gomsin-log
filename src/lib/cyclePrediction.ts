import type { CyclePeriod } from '@/types';

export type CyclePredictionStatus =
  | 'insufficient_data'
  | 'configured_estimate'
  | 'personalized';

export type CycleConfidence = 'low' | 'medium' | 'high';

export interface CyclePredictionInput {
  periods: Array<Pick<CyclePeriod, 'startDate' | 'endDate'>>;
  configuredCycleLength?: number;
  configuredPeriodLength?: number;
  today: string;
}

export interface CyclePrediction {
  status: CyclePredictionStatus;
  expectedStartDate?: string;
  windowStart?: string;
  windowEnd?: string;
  confidence: CycleConfidence;
  /** Distinct valid period start dates that survived filtering. */
  periodsUsed: number;
  /** Cycle-to-cycle intervals actually fed into the statistics (max 12). */
  intervalsUsed: number;
  averageCycleLength?: number;
  medianCycleLength?: number;
  /**
   * Half-width of the start-date window, in days.
   *
   * This is uncertainty about WHEN the next period starts. It is NOT how long a
   * period lasts; `configuredPeriodLength` is deliberately never used here,
   * because a 6-day period does not make the start date 6 days less certain.
   */
  variabilityDays?: number;
  /** True when `expectedStartDate` is already in the past relative to `today`. */
  isOverdue?: boolean;
  /** Days elapsed since the expected start, when overdue. */
  overdueDays?: number;
  // Optional estimated fertility window (statistical estimate only)
  estimatedOvulationDate?: string;
  fertilityWindowStart?: string;
  fertilityWindowEnd?: string;
  methodVersion: string;
}

/**
 * How many cycle-to-cycle intervals the statistics may use.
 *
 * A cycle from three years ago says little about this month, and including it
 * widens `variabilityDays` for no predictive gain. Twelve intervals is roughly a
 * year of history.
 */
export const MAX_INTERVALS_CONSIDERED = 12;

/**
 * Start-window half-width when there is not enough history to measure
 * variability. Two days each side is deliberately conservative: it is wide
 * enough not to read as a promise, narrow enough to stay useful.
 */
const CONFIGURED_ESTIMATE_BUFFER_DAYS = 2;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  dt.setDate(dt.getDate() + days);
  return toLocalDateString(dt);
}

function getDaysDifference(fromStr: string, toStr: string): number {
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

function calculateMedian(numbers: number[]): number {
  if (numbers.length === 0) return 28;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

/** Attach overdue framing so the UI never shows a bare past date as "예상". */
function withOverdue(prediction: CyclePrediction, today: string): CyclePrediction {
  if (!prediction.expectedStartDate) return prediction;
  const diff = getDaysDifference(prediction.expectedStartDate, today);
  if (diff <= 0) return prediction;
  return { ...prediction, isOverdue: true, overdueDays: diff };
}

/**
 * Prediction Engine V3
 * Pure function module.
 * Uses ONLY actual period start dates from `CyclePeriod`.
 * Daily logs/symptoms are NEVER passed or used here.
 */
export function predictCycle(input: CyclePredictionInput): CyclePrediction {
  const { periods, configuredCycleLength = 28, today } = input;
  const methodVersion = 'v3.1.0-stats';

  // Filter & sort valid period start dates in chronological ascending order
  const validStarts = Array.from(new Set(
    periods
      .map((p) => p.startDate)
      .filter(isCalendarDate),
  )).sort((a, b) => a.localeCompare(b));

  if (validStarts.length === 0) {
    return {
      status: 'insufficient_data',
      confidence: 'low',
      periodsUsed: 0,
      intervalsUsed: 0,
      methodVersion,
    };
  }

  const latestStart = validStarts[validStarts.length - 1];

  if (validStarts.length < 3) {
    // 1 or 2 periods: Use configured cycle length estimate
    const cycleLen = (configuredCycleLength >= 15 && configuredCycleLength <= 60)
      ? configuredCycleLength
      : 28;

    const expectedStartDate = addDays(latestStart, cycleLen);
    // Symmetric buffer: this is start-date uncertainty, not period duration.
    const windowStart = addDays(expectedStartDate, -CONFIGURED_ESTIMATE_BUFFER_DAYS);
    const windowEnd = addDays(expectedStartDate, CONFIGURED_ESTIMATE_BUFFER_DAYS);

    const estimatedOvulationDate = addDays(expectedStartDate, -14);
    const fertilityWindowStart = addDays(estimatedOvulationDate, -5);
    const fertilityWindowEnd = addDays(estimatedOvulationDate, 1);

    return withOverdue({
      status: 'configured_estimate',
      expectedStartDate,
      windowStart,
      windowEnd,
      confidence: 'low',
      periodsUsed: validStarts.length,
      intervalsUsed: 0,
      averageCycleLength: cycleLen,
      medianCycleLength: cycleLen,
      variabilityDays: CONFIGURED_ESTIMATE_BUFFER_DAYS,
      estimatedOvulationDate,
      fertilityWindowStart,
      fertilityWindowEnd,
      methodVersion,
    }, today);
  }

  // 3+ periods: Calculate actual cycle intervals
  const allIntervals: number[] = [];
  for (let i = 1; i < validStarts.length; i += 1) {
    const diff = getDaysDifference(validStarts[i - 1], validStarts[i]);
    // Filter out extreme noise/outliers (less than 15 days or more than 60 days)
    if (diff >= 15 && diff <= 60) {
      allIntervals.push(diff);
    }
  }
  // Recency window: only the most recent intervals inform the estimate.
  const intervals = allIntervals.slice(-MAX_INTERVALS_CONSIDERED);

  if (intervals.length === 0) {
    const cycleLen = configuredCycleLength || 28;
    const expectedStartDate = addDays(latestStart, cycleLen);
    return withOverdue({
      status: 'configured_estimate',
      expectedStartDate,
      windowStart: addDays(expectedStartDate, -CONFIGURED_ESTIMATE_BUFFER_DAYS),
      windowEnd: addDays(expectedStartDate, CONFIGURED_ESTIMATE_BUFFER_DAYS),
      confidence: 'low',
      periodsUsed: validStarts.length,
      intervalsUsed: 0,
      variabilityDays: CONFIGURED_ESTIMATE_BUFFER_DAYS,
      methodVersion,
    }, today);
  }

  const sum = intervals.reduce((acc, val) => acc + val, 0);
  const averageCycleLength = Math.round(sum / intervals.length);
  const medianCycleLength = calculateMedian(intervals);

  /*
   * Variability = half the observed spread of recent intervals, in days.
   *
   * Documented plainly because the UI turns it into a confidence word, not a
   * percentage: a 27-31 day history has a spread of 4, so ±2 days. This is a
   * descriptive statistic about the user's own records, not a probability.
   */
  const maxInterval = Math.max(...intervals);
  const minInterval = Math.min(...intervals);
  const variabilityDays = Math.max(1, Math.round((maxInterval - minInterval) / 2));

  let confidence: CycleConfidence = 'low';
  if (variabilityDays <= 2 && intervals.length >= 3) {
    confidence = 'high';
  } else if (variabilityDays <= 4) {
    confidence = 'medium';
  }

  const expectedStartDate = addDays(latestStart, medianCycleLength);
  const buffer = Math.min(variabilityDays, 3);
  const windowStart = addDays(expectedStartDate, -buffer);
  const windowEnd = addDays(expectedStartDate, buffer);

  const estimatedOvulationDate = addDays(expectedStartDate, -14);
  const fertilityWindowStart = addDays(estimatedOvulationDate, -5);
  const fertilityWindowEnd = addDays(estimatedOvulationDate, 1);

  return withOverdue({
    status: 'personalized',
    expectedStartDate,
    windowStart,
    windowEnd,
    confidence,
    periodsUsed: validStarts.length,
    intervalsUsed: intervals.length,
    averageCycleLength,
    medianCycleLength,
    variabilityDays,
    estimatedOvulationDate,
    fertilityWindowStart,
    fertilityWindowEnd,
    methodVersion,
  }, today);
}

/** Is `date` inside the predicted start window? Used by the calendar. */
export function predictionOccursOnDate(prediction: CyclePrediction, date: string): boolean {
  if (!prediction.windowStart || !prediction.windowEnd) return false;
  return prediction.windowStart <= date && date <= prediction.windowEnd;
}
