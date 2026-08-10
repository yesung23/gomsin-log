import { Loader2 } from 'lucide-react';
import { buildCyclePartnerMessage } from '@/lib/cyclePartnerMessage';
import type { CyclePrediction } from '@/lib/cyclePrediction';
import { cn } from '@/lib/utils';
import type { CycleSharingPreferences } from '@/types';

type ShareKey = 'shareCurrentPeriod' | 'sharePredictionWindow' | 'shareFertilityWindow';

interface CycleSharingSettingsProps {
  preferences: CycleSharingPreferences;
  prediction: CyclePrediction;
  periodActive: boolean;
  pendingKey: ShareKey | null;
  error: string | null;
  onToggle: (key: ShareKey, next: boolean) => void;
}

const OPTIONS: Array<{ key: ShareKey; title: string; description: string }> = [
  {
    key: 'shareCurrentPeriod',
    title: '생리 진행 상태 공유',
    description: '지금 생리 중인지 여부만 보여요. 시작일과 증상은 보이지 않아요.',
  },
  {
    key: 'sharePredictionWindow',
    title: '다음 예상 기간 공유',
    description: '예상 범위만 보여요. 정확한 날짜가 아닐 수 있어요.',
  },
  {
    key: 'shareFertilityWindow',
    title: '가임/배란 예상 공유',
    description: '달력 계산에 따른 추정이에요. 피임 수단으로 쓸 수 없어요.',
  },
];

/**
 * Partner sharing, on its own screen.
 *
 * Every option defaults to off on the server, and each toggle is a server write:
 * the switch reflects persisted state, so it never claims a preference that the
 * database did not accept. Fertility stays last and most heavily qualified.
 */
export function CycleSharingSettings({
  preferences,
  prediction,
  periodActive,
  pendingKey,
  error,
  onToggle,
}: CycleSharingSettingsProps) {
  const preview = buildCyclePartnerMessage({
    preferences,
    periodActive,
    predictionWindowStart: prediction.windowStart,
    predictionWindowEnd: prediction.windowEnd,
    fertilityWindowStart: prediction.fertilityWindowStart,
    fertilityWindowEnd: prediction.fertilityWindowEnd,
  });

  return (
    <div className="space-y-4">
      <p className="text-caption text-muted-foreground leading-relaxed">
        원본 기록은 나만 볼 수 있어요. 아래에서 직접 고른 항목만 파트너에게 보여요.
      </p>

      <ul className="divide-y divide-border/40">
        {OPTIONS.map((option) => {
          const checked = preferences[option.key];
          const pending = pendingKey === option.key;
          return (
            <li key={option.key} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-label font-medium text-foreground">{option.title}</p>
                <p className="text-caption text-muted-foreground leading-relaxed mt-0.5">
                  {option.description}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={option.title}
                disabled={pendingKey !== null}
                onClick={() => onToggle(option.key, !checked)}
                className={cn(
                  'shrink-0 min-h-11 min-w-11 w-14 rounded-full border transition',
                  'flex items-center px-1 disabled:opacity-60',
                  checked ? 'bg-coral/25 border-coral justify-end' : 'bg-muted border-border justify-start',
                )}
              >
                {pending ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden="true" />
                ) : (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-5 h-5 rounded-full',
                      checked ? 'bg-coral-strong' : 'bg-card border border-border',
                    )}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}

      <div
        data-testid="cycle-partner-preview"
        className="rounded-surface bg-muted/40 p-3.5 space-y-1.5"
      >
        <p className="text-caption font-bold text-foreground">{preview.headline}</p>
        {preview.lines.map((line) => (
          <p key={line} className="text-caption text-muted-foreground leading-relaxed">{line}</p>
        ))}
      </div>
    </div>
  );
}
