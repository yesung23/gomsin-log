import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { CyclePeriod } from '@/types';
import { CycleSheet } from './CycleSheet';
import type { CyclePeriodDraft } from './cycleDrafts';

interface CyclePeriodEditorProps {
  period: CyclePeriod;
  pending: boolean;
  deletePending: boolean;
  error: string | null;
  onSave: (draft: CyclePeriodDraft) => void;
  onDelete: (period: CyclePeriod) => void;
  onClose: () => void;
}

export function CyclePeriodEditor({
  period,
  pending,
  deletePending,
  error,
  onSave,
  onDelete,
  onClose,
}: CyclePeriodEditorProps) {
  const [draft, setDraft] = useState<CyclePeriodDraft>({
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = pending || deletePending;

  return (
    <CycleSheet title="생리 기간 수정" onClose={onClose} busy={busy}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-caption font-bold text-foreground">시작일</span>
            <input
              type="date"
              value={draft.startDate}
              onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))}
              disabled={busy}
              className="w-full min-h-11 p-2.5 rounded-control border border-border bg-background text-body"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-caption font-bold text-foreground">종료일</span>
            <input
              type="date"
              value={draft.endDate || ''}
              min={draft.startDate}
              onChange={(event) => setDraft((current) => ({
                ...current,
                endDate: event.target.value || undefined,
              }))}
              disabled={busy}
              className="w-full min-h-11 p-2.5 rounded-control border border-border bg-background text-body"
            />
          </label>
        </div>
        <p className="text-caption text-muted-foreground">
          종료일을 비워두면 아직 생리 중으로 기록돼요.
        </p>

        {error && <p role="alert" className="text-caption text-destructive">{error}</p>}

        {confirmingDelete ? (
          <div className="rounded-control border border-destructive/30 bg-destructive/5 p-3 space-y-2">
            {/* Explicit about WHAT is being deleted: a vague "기록 삭제" cannot tell
                the user whether their condition logs go with it. */}
            <p className="text-caption text-foreground">
              이 생리 기록을 삭제할까요? 이 날짜의 컨디션 기록은 그대로 남아요.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="press-response-row flex-1 min-h-11 rounded-control border border-border text-label font-medium"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => onDelete(period)}
                disabled={busy}
                className="press-response flex-1 min-h-11 rounded-control bg-destructive text-destructive-foreground text-label font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {deletePending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                삭제
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              aria-label="이 생리 기록 삭제"
              className="press-response min-h-11 px-3 rounded-control border border-destructive/30 text-destructive disabled:opacity-50 flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              disabled={busy}
              aria-label="생리 기간 저장"
              className="press-response flex-1 min-h-11 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {pending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {pending ? '저장 중' : '저장'}
            </button>
          </div>
        )}
      </div>
    </CycleSheet>
  );
}
