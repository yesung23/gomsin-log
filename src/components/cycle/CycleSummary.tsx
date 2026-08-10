import type { CyclePrediction } from '@/lib/cyclePrediction';
import type { CycleDailyLog, CyclePeriod } from '@/types';
import { symptomLabels } from './cycleFormatting';

interface CycleSummaryProps {
  prediction: CyclePrediction;
  periods: CyclePeriod[];
  dailyLogs: CycleDailyLog[];
  configuredCycleLength: number;
  configuredPeriodLength: number;
}

/** Mean length of periods that actually have both endpoints recorded. */
function measuredPeriodLength(periods: CyclePeriod[]): number | null {
  const closed = periods.filter((period) => !!period.endDate);
  if (closed.length === 0) return null;
  const total = closed.reduce((sum, period) => {
    const [y1, m1, d1] = period.startDate.split('-').map(Number);
    const [y2, m2, d2] = (period.endDate as string).split('-').map(Number);
    const start = new Date(y1, m1 - 1, d1, 12).getTime();
    const end = new Date(y2, m2 - 1, d2, 12).getTime();
    return sum + Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  }, 0);
  return Math.round(total / closed.length);
}

/** The symptom logged most often, for a factual "자주 기록한" line. */
function mostLoggedSymptom(dailyLogs: CycleDailyLog[]): string | null {
  const counts = new Map<string, number>();
  for (const log of dailyLogs) {
    for (const symptom of log.symptoms) {
      counts.set(symptom, (counts.get(symptom) || 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [symptom, count] of counts) {
    if (count > bestCount) {
      best = symptom;
      bestCount = count;
    }
  }
  if (!best || bestCount < 2) return null;
  return symptomLabels[best as keyof typeof symptomLabels];
}

/**
 * A low-emphasis factual summary.
 *
 * Descriptive statistics about the user's own records only. No diagnosis, no
 * "정상/비정상", no condition names — this app is not a medical device, and a
 * sentence like "PMS 가능성" would be both wrong and unlawful to imply.
 */
export function CycleSummary({
  prediction,
  periods,
  dailyLogs,
  configuredCycleLength,
  configuredPeriodLength,
}: CycleSummaryProps) {
  const measured = measuredPeriodLength(periods);
  const frequentSymptom = mostLoggedSymptom(dailyLogs);
  const hasRange = prediction.status === 'personalized'
    && prediction.medianCycleLength !== undefined
    && prediction.variabilityDays !== undefined;

  return (
    <section className="space-y-2" aria-labelledby="cycle-summary-title">
      <h3 id="cycle-summary-title" className="text-label font-bold text-foreground">내 주기</h3>
      <dl className="divide-y divide-border/40">
        <div className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-caption text-muted-foreground">평균 주기</dt>
          <dd className="text-body text-foreground">
            {prediction.medianCycleLength ?? configuredCycleLength}일
            {prediction.status !== 'personalized' && (
              <span className="text-caption text-muted-foreground"> (설정값)</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-caption text-muted-foreground">평균 기간</dt>
          <dd className="text-body text-foreground">
            {measured ?? configuredPeriodLength}일
            {measured === null && (
              <span className="text-caption text-muted-foreground"> (설정값)</span>
            )}
          </dd>
        </div>
        {hasRange && (
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-caption text-muted-foreground">최근 범위</dt>
            <dd className="text-body text-foreground">
              {(prediction.medianCycleLength as number) - (prediction.variabilityDays as number)}
              ~
              {(prediction.medianCycleLength as number) + (prediction.variabilityDays as number)}일
            </dd>
          </div>
        )}
        {frequentSymptom && (
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-caption text-muted-foreground">자주 기록한 컨디션</dt>
            <dd className="text-body text-foreground">{frequentSymptom}</dd>
          </div>
        )}
      </dl>
      <p className="text-caption text-muted-foreground leading-relaxed">
        내 기록을 바탕으로 계산한 참고 정보예요. 의료적인 판단이 아니에요.
      </p>
    </section>
  );
}
