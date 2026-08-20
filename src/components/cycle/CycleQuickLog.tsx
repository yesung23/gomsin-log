import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CycleSymptom } from '@/types';
import { QUICK_SYMPTOMS, symptomLabels } from './cycleFormatting';

interface CycleQuickLogProps {
  /** Symptoms already recorded for the selected date. */
  activeSymptoms: CycleSymptom[];
  pendingSymptom: CycleSymptom | null;
  isToday: boolean;
  selectedLabel: string;
  onToggleSymptom: (symptom: CycleSymptom) => void;
  onOpenDetail: () => void;
}

/**
 * One-tap condition logging.
 *
 * Four chips, not all six: this row exists for the case where the user opens the
 * app, taps one thing and leaves. Everything else lives behind 자세히 기록하기.
 *
 * Every chip writes a DAILY LOG. It can never create or extend a period — that
 * conflation was the original P0 defect.
 */
export function CycleQuickLog({
  activeSymptoms,
  pendingSymptom,
  isToday,
  selectedLabel,
  onToggleSymptom,
  onOpenDetail,
}: CycleQuickLogProps) {
  return (
    <section className="space-y-2.5" aria-labelledby="cycle-quick-log-title">
      <h3 id="cycle-quick-log-title" className="text-label font-bold text-foreground">
        {isToday ? '오늘 컨디션은 어때요?' : `${selectedLabel} 컨디션`}
      </h3>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_SYMPTOMS.map((symptom) => {
          const selected = activeSymptoms.includes(symptom);
          const pending = pendingSymptom === symptom;
          return (
            <button
              type="button"
              key={symptom}
              onClick={() => onToggleSymptom(symptom)}
              disabled={pendingSymptom !== null}
              aria-pressed={selected}
              className={cn(
                'press-response min-h-11 px-3.5 rounded-full text-caption border',
                'flex items-center gap-1.5 active:scale-95 disabled:opacity-60',
                selected
                  ? 'bg-coral/20 border-coral text-coral-strong font-bold'
                  : 'bg-card border-border text-foreground hover:bg-muted',
              )}
            >
              {pending && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
              {symptomLabels[symptom]}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpenDetail}
        className="press-response min-h-11 text-caption font-medium text-info underline underline-offset-2"
      >
        자세히 기록하기
      </button>
    </section>
  );
}
