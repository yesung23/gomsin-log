import { Check, Loader2, Plus } from 'lucide-react';
import type { CyclePrediction } from '@/lib/cyclePrediction';
import { isPeriodImplausiblyLong, periodDayNumber } from '@/lib/cycle';
import { cn } from '@/lib/utils';
import type { CyclePeriod } from '@/types';
import { confidenceLabels, formatKoreanDate } from './cycleFormatting';

interface CycleStatusHeroProps {
  activePeriod: CyclePeriod | null;
  prediction: CyclePrediction;
  today: string;
  pending: boolean;
  onStartPeriod: () => void;
  onEndPeriod: () => void;
}

/**
 * The one thing the user came to find out: am I on my period, and when is the
 * next one.
 *
 * The prediction is rendered as a RANGE, never as a single confident date. A
 * lone `8월 26일` reads as a promise the statistics cannot make; `8월 24일 ~ 28일`
 * with a confidence word is honest about the same estimate.
 */
export function CycleStatusHero({
  activePeriod,
  prediction,
  today,
  pending,
  onStartPeriod,
  onEndPeriod,
}: CycleStatusHeroProps) {
  /*
   * `data-testid` carries the machine-readable state so tests assert on the
   * state itself rather than on Korean copy, which is free to change.
   */
  const heroState = activePeriod
    ? 'active'
    : prediction.status === 'insufficient_data' ? 'insufficient_data' : 'prediction';

  return (
    <section
      className="space-y-4"
      aria-labelledby="cycle-hero-title"
      data-testid="cycle-hero"
    >
      <span data-testid="cycle-hero-state" className="sr-only">{heroState}</span>

      {activePeriod ? (
        <div className="space-y-1">
          <p id="cycle-hero-title" className="text-title text-foreground font-bold">
            <span aria-hidden="true">🌸 </span>
            생리 {periodDayNumber(activePeriod, today)}일째
          </p>
          <p className="text-caption text-muted-foreground">
            {formatKoreanDate(activePeriod.startDate)} 시작
          </p>
          {isPeriodImplausiblyLong(activePeriod, today) && (
            /* Ask, never auto-correct: the user's record is not ours to edit. */
            <p className="text-caption text-muted-foreground leading-relaxed pt-0.5">
              아직 생리 중으로 기록되어 있어요. 이미 끝났다면 종료일을 기록해 주세요.
            </p>
          )}
        </div>
      ) : prediction.status === 'insufficient_data' ? (
        <div className="space-y-1">
          <p id="cycle-hero-title" className="text-title text-foreground font-bold">
            <span aria-hidden="true">🌱 </span>
            내 주기를 알아가는 중
          </p>
          <p className="text-caption text-muted-foreground leading-relaxed">
            첫 생리 시작일을 기록하면 예상 기간을 알려드릴게요.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <p id="cycle-hero-title" className="text-caption text-muted-foreground">
            {prediction.isOverdue ? '예상 기간이 지났어요' : '다음 생리 예상'}
          </p>
          <p
            className="text-title text-foreground font-bold"
            data-testid="cycle-prediction-window"
          >
            {formatKoreanDate(prediction.windowStart || '')}
            {' ~ '}
            {formatKoreanDate(prediction.windowEnd || '')}
          </p>
          <p className="text-caption text-muted-foreground">
            예측 신뢰도 ·{' '}
            <span data-testid="cycle-prediction-confidence" className="font-medium text-foreground">
              {confidenceLabels[prediction.confidence]}
            </span>
          </p>
          <p className="text-caption text-muted-foreground" data-testid="cycle-prediction-basis">
            {prediction.status === 'personalized'
              ? `최근 ${prediction.intervalsUsed}번의 실제 생리 기록 기준`
              : '기본 설정을 이용한 예상이에요.'}
          </p>
          {prediction.isOverdue && (
            <p className="text-caption text-muted-foreground leading-relaxed pt-0.5">
              아직 시작하지 않았다면 주기가 평소와 달라졌을 수 있어요.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={activePeriod ? onEndPeriod : onStartPeriod}
        disabled={pending}
        className={cn(
          'w-full min-h-11 py-3 px-4 rounded-full text-label font-bold transition',
          'flex items-center justify-center gap-2 active:scale-98 disabled:opacity-60',
          activePeriod
            ? 'bg-card border border-coral text-coral-strong'
            : 'bg-coral-strong text-coral-strong-foreground',
        )}
      >
        {pending ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : activePeriod ? (
          <Check className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Plus className="w-4 h-4" aria-hidden="true" />
        )}
        {activePeriod ? '오늘 생리 끝났어요' : '오늘 생리 시작했어요'}
      </button>
    </section>
  );
}
