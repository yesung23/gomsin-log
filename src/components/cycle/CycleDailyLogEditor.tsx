import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { CYCLE_FLOWS, CYCLE_MOODS, CYCLE_PAIN_LEVELS, CYCLE_SYMPTOMS } from '@/types';
import type { CycleDailyLog, CycleSymptom } from '@/types';
import { cn } from '@/lib/utils';
import { CycleSheet } from './CycleSheet';
import { draftFromDailyLog, type CycleDailyLogDraft } from './cycleDrafts';
import { flowLabels, formatKoreanDate, moodLabels, painLabels, symptomLabels } from './cycleFormatting';

interface CycleDailyLogEditorProps {
  date: string;
  existingLog: CycleDailyLog | null;
  pending: boolean;
  deletePending: boolean;
  error: string | null;
  onSave: (draft: CycleDailyLogDraft) => void;
  onDelete: (log: CycleDailyLog) => void;
  onClose: () => void;
}

/** A labelled row of single-select options, rendered as toggle buttons. */
function OptionRow<T extends string>({
  legend,
  options,
  labels,
  value,
  onSelect,
  columns,
}: {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | undefined;
  onSelect: (next: T | undefined) => void;
  columns: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-caption font-bold text-foreground">{legend}</legend>
      <div className={cn('grid gap-1', columns)}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              type="button"
              key={option}
              // Tapping the selected option clears it, so a mis-tap is undoable
              // without a separate "없음" affordance for every field.
              onClick={() => onSelect(selected ? undefined : option)}
              aria-pressed={selected}
              aria-label={`${legend} ${labels[option]}`}
              className={cn(
                'min-h-11 px-1 rounded-control border text-caption transition',
                selected
                  ? 'bg-coral/20 border-coral text-coral-strong font-bold'
                  : 'bg-card border-border text-foreground hover:bg-muted',
              )}
            >
              {labels[option]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Editor for one date's condition record.
 *
 * Writes `cycle_daily_logs` and nothing else. The draft is local state until the
 * server confirms, and a failed save keeps the draft — including the note, which
 * is the one field the user actually typed by hand.
 */
export function CycleDailyLogEditor({
  date,
  existingLog,
  pending,
  deletePending,
  error,
  onSave,
  onDelete,
  onClose,
}: CycleDailyLogEditorProps) {
  const [draft, setDraft] = useState<CycleDailyLogDraft>(() => draftFromDailyLog(date, existingLog));

  const toggleSymptom = (symptom: CycleSymptom) => {
    setDraft((current) => ({
      ...current,
      symptoms: current.symptoms.includes(symptom)
        ? current.symptoms.filter((value) => value !== symptom)
        : [...current.symptoms, symptom],
    }));
  };

  const busy = pending || deletePending;

  return (
    <CycleSheet title={`${formatKoreanDate(date)} 컨디션 기록`} onClose={onClose} busy={busy}>
      <div className="space-y-4">
        <OptionRow
          legend="출혈량"
          options={CYCLE_FLOWS}
          labels={flowLabels}
          value={draft.flow}
          onSelect={(flow) => setDraft((current) => ({ ...current, flow }))}
          columns="grid-cols-4"
        />
        <OptionRow
          legend="통증"
          options={CYCLE_PAIN_LEVELS}
          labels={painLabels}
          value={draft.painLevel}
          onSelect={(painLevel) => setDraft((current) => ({ ...current, painLevel }))}
          columns="grid-cols-4"
        />
        <OptionRow
          legend="기분"
          options={CYCLE_MOODS}
          labels={moodLabels}
          value={draft.mood}
          onSelect={(mood) => setDraft((current) => ({ ...current, mood }))}
          columns="grid-cols-5"
        />

        <fieldset className="space-y-1.5">
          <legend className="text-caption font-bold text-foreground">증상</legend>
          <div className="flex flex-wrap gap-1.5">
            {CYCLE_SYMPTOMS.map((symptom) => {
              const selected = draft.symptoms.includes(symptom);
              return (
                <button
                  type="button"
                  key={symptom}
                  onClick={() => toggleSymptom(symptom)}
                  aria-pressed={selected}
                  aria-label={`증상 ${symptomLabels[symptom]}`}
                  className={cn(
                    'min-h-11 px-3 rounded-full border text-caption transition',
                    selected
                      ? 'bg-coral/20 border-coral text-coral-strong font-bold'
                      : 'bg-card border-border text-foreground hover:bg-muted',
                  )}
                >
                  {symptomLabels[symptom]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="block space-y-1.5">
          <span className="text-caption font-bold text-foreground">메모</span>
          <textarea
            aria-label="메모"
            value={draft.note}
            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            rows={3}
            className="w-full p-3 rounded-control border border-border bg-background text-body resize-none"
          />
          <span className="block text-caption text-muted-foreground">
            메모는 파트너에게 공유되지 않아요.
          </span>
        </label>

        {error && <p role="alert" className="text-caption text-destructive">{error}</p>}

        <div className="flex gap-2">
          {existingLog && (
            <button
              type="button"
              onClick={() => onDelete(existingLog)}
              disabled={busy}
              aria-label="이 날의 컨디션 기록 삭제"
              className="min-h-11 px-3 rounded-control border border-destructive/30 text-destructive disabled:opacity-50 flex items-center justify-center"
            >
              {deletePending
                ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                : <Trash2 className="w-4 h-4" aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={busy}
            aria-label="컨디션 저장"
            className="flex-1 min-h-11 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {pending ? '저장 중' : '저장'}
          </button>
        </div>
      </div>
    </CycleSheet>
  );
}
