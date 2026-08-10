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
  cyclesUsed: number;
  averageCycleLength?: number;
  medianCycleLength?: number;
  variabilityDays?: number;
  // Optional estimated fertility window (statistical estimate only)
  estimatedOvulationDate?: string;
  fertilityWindowStart?: string;
  fertilityWindowEnd?: string;
  methodVersion: string;
}

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

/**
 * Prediction Engine V3
 * Pure function module.
 * Uses ONLY actual period start dates from `CyclePeriod`.
 * Daily logs/symptoms are NEVER passed or used here.
 */
export function predictCycle(input: CyclePredictionInput): CyclePrediction {
  const { periods, configuredCycleLength = 28, configuredPeriodLength = 5 } = input;
  const methodVersion = 'v3.0.0-stats';

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
      cyclesUsed: 0,
      methodVersion,
    };
  }

  const latestStart = validStarts[validStarts.length - 1];

  if (validStarts.length < 3) {
    // 1 or 2 periods: Use configured cycle length estimate
    const cycleLen = (configuredCycleLength >= 15 && configuredCycleLength <= 60)
      ? configuredCycleLength
      : 28;
    const periodLen = (configuredPeriodLength >= 1 && configuredPeriodLength <= 15)
      ? configuredPeriodLength
      : 5;

    const expectedStartDate = addDays(latestStart, cycleLen);
    const windowStart = addDays(expectedStartDate, -1);
    const windowEnd = addDays(expectedStartDate, Math.max(1, periodLen - 1));

    const estimatedOvulationDate = addDays(expectedStartDate, -14);
    const fertilityWindowStart = addDays(estimatedOvulationDate, -5);
    const fertilityWindowEnd = addDays(estimatedOvulationDate, 1);

    return {
      status: 'configured_estimate',
      expectedStartDate,
      windowStart,
      windowEnd,
      confidence: 'low',
      cyclesUsed: validStarts.length,
      averageCycleLength: cycleLen,
      medianCycleLength: cycleLen,
      variabilityDays: 2,
      estimatedOvulationDate,
      fertilityWindowStart,
      fertilityWindowEnd,
      methodVersion,
    };
  }

  // 3+ periods: Calculate actual cycle intervals
  const intervals: number[] = [];
  for (let i = 1; i < validStarts.length; i += 1) {
    const diff = getDaysDifference(validStarts[i - 1], validStarts[i]);
    // Filter out extreme noise/outliers (less than 15 days or more than 60 days)
    if (diff >= 15 && diff <= 60) {
      intervals.push(diff);
    }
  }

  if (intervals.length === 0) {
    const cycleLen = configuredCycleLength || 28;
    const expectedStartDate = addDays(latestStart, cycleLen);
    return {
      status: 'configured_estimate',
      expectedStartDate,
      windowStart: addDays(expectedStartDate, -1),
      windowEnd: addDays(expectedStartDate, 3),
      confidence: 'low',
      cyclesUsed: validStarts.length,
      methodVersion,
    };
  }

  const sum = intervals.reduce((acc, val) => acc + val, 0);
  const averageCycleLength = Math.round(sum / intervals.length);
  const medianCycleLength = calculateMedian(intervals);

  // Calculate variability (range / max deviation from median)
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

  return {
    status: 'personalized',
    expectedStartDate,
    windowStart,
    windowEnd,
    confidence,
    cyclesUsed: validStarts.length,
    averageCycleLength,
    medianCycleLength,
    variabilityDays,
    estimatedOvulationDate,
    fertilityWindowStart,
    fertilityWindowEnd,
    methodVersion,
  };
}
