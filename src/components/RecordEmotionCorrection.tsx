import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { DailyRecord, EmotionFlowItem } from '@/types';
import { EmotionChipEditor } from '@/components/EmotionChipEditor';
import { EmotionFlowInsightCard } from '@/components/EmotionFlowInsightCard';
import {
  applyCorrections,
  useEmotionCandidatesForRecord,
} from '@/lib/useEmotionCandidates';

/**
 * Fix a saved record's emotion flow.
 *
 * This is the gap the product owner called the app's biggest problem: once a
 * record was written its flow was final, so a reading of 행복 → 우울 on a day that
 * actually went 분노 → 행복 stayed wrong forever and quietly poisoned the partner's
 * view and every period summary built on top of it.
 *
 * The same `EmotionChipEditor` used in the composer is reused here, so correcting
 * after the fact works exactly like reviewing at write time -- ✕ to remove, ▲▼ to
 * change -- rather than being a second, differently-shaped feature to learn.
 *
 * Only the author sees this: the caller gates it on `isOwnRecord`.
 */
export function RecordEmotionCorrection({
  record,
  onSave,
  disabled,
  disabledReason,
}: {
  record: DailyRecord;
  onSave: (emotionFlow: EmotionFlowItem[]) => Promise<{ ok: boolean; error?: string }>;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const review = useEmotionCandidatesForRecord(record.emotionFlow);

  const stored = record.emotionFlow || [];
  const hasFlow = stored.some((item) => item.source === 'user_confirmed');

  if (!hasFlow) {
    // Nothing to correct. Rather than an empty editor, say why -- an entry with no
    // recognised feeling is a real and common outcome, not an error.
    return (
      <p className="text-[11px] text-muted-foreground">
        이 기록에는 저장된 마음이 없어요. 내용을 수정하면 다시 읽어드려요.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-testid="open-emotion-correction"
        className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-muted text-foreground font-bold text-xs active:scale-95 transition w-full"
      >
        <Sparkles size={13} aria-hidden="true" /> 마음 고치기
      </button>
    );
  }

  const corrected = applyCorrections(stored, review.candidates);

  return (
    <div className="space-y-2" data-testid="emotion-correction-panel">
      <EmotionChipEditor
        candidates={review.candidates}
        removed={review.removed}
        onRemove={review.remove}
        onRestore={review.restore}
        onChangeEmotion={review.changeEmotion}
        visibilityNote={
          record.isPrivate
            ? '🔒 나만 보기 기록이라 이 마음도 나만 볼 수 있어요.'
            : '고친 마음은 상대방에게도 그대로 보여요.'
        }
        showHeading={false}
      />

      {/* What the corrected flow will look like, before committing to it. */}
      <EmotionFlowInsightCard items={corrected} variant="composer" />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            review.reset();
            setIsOpen(false);
          }}
          disabled={isSaving}
          className="flex-1 min-h-[44px] rounded-lg bg-muted text-muted-foreground font-bold text-xs disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          data-testid="save-emotion-correction"
          onClick={async () => {
            if (disabled) {
              toast.error(disabledReason || '지금은 저장할 수 없어요.');
              return;
            }
            if (!review.touched) {
              toast.info('바꾼 내용이 없어요.');
              return;
            }
            setIsSaving(true);
            try {
              const result = await onSave(corrected);
              if (!result.ok) {
                toast.error(result.error || '마음을 고치지 못했어요.');
                return;
              }
              toast.success('마음을 고쳤어요.');
              review.reset();
              setIsOpen(false);
            } finally {
              setIsSaving(false);
            }
          }}
          disabled={isSaving || disabled}
          className="flex-1 min-h-[44px] rounded-lg bg-coral-strong text-coral-strong-foreground font-bold text-xs disabled:opacity-50"
        >
          {isSaving ? '저장 중...' : '이대로 저장'}
        </button>
      </div>
    </div>
  );
}
