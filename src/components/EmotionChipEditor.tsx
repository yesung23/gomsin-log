import { ChevronDown, ChevronUp, Heart, RotateCcw, X } from 'lucide-react';
import {
  BASIC_EMOTION_EMOJI,
  BASIC_EMOTION_LABEL,
  BASIC_EMOTION_ORDER,
  stepBasicEmotion,
  type BasicEmotion,
} from '@/lib/basicEmotions';
import type { EmotionCandidate } from '@/lib/emotionCandidates';

/**
 * Review and correct the feelings the app read out of a diary entry.
 *
 * Two behaviours, both requested and both absent before:
 *
 *  - REMOVE, not select. Candidates arrive already included; the ✕ takes one out.
 *    The previous chips did nothing unless tapped, so the ordinary path (write,
 *    save) recorded no feeling and the partner saw an empty flow.
 *  - CORRECT, not accept. ▲/▼ move a candidate through the six basic emotions, so
 *    a wrong reading is a two-tap fix. This is the whole point: a flow that said
 *    행복 → 우울 when the day went 분노 → 행복 previously had no repair path at all.
 *
 * Removals are reversible. A ✕ next to six similar chips is easy to hit by
 * mistake, and re-typing the entry to get a candidate back would be absurd, so
 * removed candidates stay listed and restorable until save.
 */

export interface EmotionChipEditorProps {
  /** Candidates currently kept, in flow order. */
  candidates: EmotionCandidate[];
  /** Candidates the user removed, still restorable. */
  removed: EmotionCandidate[];
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  onChangeEmotion: (id: string, basic: BasicEmotion) => void;
  /** Who will be able to see the result, stated plainly. */
  visibilityNote: string;
  /** Hidden when editing an already-saved record, where it would be redundant. */
  showHeading?: boolean;
  className?: string;
}

export function EmotionChipEditor({
  candidates,
  removed,
  onRemove,
  onRestore,
  onChangeEmotion,
  visibilityNote,
  showHeading = true,
  className,
}: EmotionChipEditorProps) {
  if (candidates.length === 0 && removed.length === 0) return null;

  return (
    <div
      data-testid="emotion-chip-editor"
      className={`p-3.5 rounded-surface bg-coral/5 border border-coral/20 space-y-2.5 ${className || ''}`}
    >
      {showHeading && (
        <>
          <h4 className="text-label font-bold text-foreground flex items-center gap-1">
            <Heart size={13} className="text-coral fill-coral" /> 기록 속 마음을 골라볼까요?
          </h4>
          <p className="text-caption text-muted-foreground leading-tight">
            글에서 읽은 마음이에요. 아닌 건 ✕로 빼고, 다르면 ▲▼로 바꿔 주세요.
          </p>
        </>
      )}
      <p className="text-caption font-semibold leading-tight text-muted-foreground">
        {visibilityNote}
      </p>

      {candidates.length === 0 ? (
        <p
          data-testid="emotion-chip-editor-empty"
          className="text-caption text-muted-foreground leading-tight pt-1"
        >
          마음을 모두 뺐어요. 이 기록에는 마음 흐름이 저장되지 않아요.
        </p>
      ) : (
        <ul data-testid="emotion-chip-list" className="space-y-2 pt-1">
          {candidates.map((candidate, index) => {
            const label = BASIC_EMOTION_LABEL[candidate.basic];
            const atTop = candidate.basic === BASIC_EMOTION_ORDER[0];
            const atEnd = candidate.basic === BASIC_EMOTION_ORDER[BASIC_EMOTION_ORDER.length - 1];
            return (
              <li
                key={candidate.id}
                data-testid={`emotion-chip-${candidate.id}`}
                data-basic={candidate.basic}
                className="flex items-center gap-2 bg-card border border-border rounded-control p-2"
              >
                <span className="text-caption font-bold text-muted-foreground w-4 text-center shrink-0">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-label font-bold text-foreground flex items-center gap-1">
                    <span aria-hidden="true">{BASIC_EMOTION_EMOJI[candidate.basic]}</span>
                    <span data-testid={`emotion-chip-label-${candidate.id}`}>{label}</span>
                  </p>
                  {/* WHY the app said this. Display-only: the phrase comes from the
                      diary text and is never persisted. */}
                  {candidate.evidence && (
                    <p className="text-caption text-muted-foreground truncate">
                      “{candidate.evidence}”에서 읽었어요
                    </p>
                  )}
                </div>

                {/* Correction stepper. Two 44px targets rather than a native
                    <select>, so a wrong reading is fixable with a thumb without
                    opening a picker over the composer. */}
                <div className="flex flex-col shrink-0">
                  <button
                    type="button"
                    onClick={() => onChangeEmotion(candidate.id, stepBasicEmotion(candidate.basic, -1))}
                    disabled={atTop}
                    aria-label={`${label} 대신 더 긍정적인 감정으로 바꾸기`}
                    className="min-h-[22px] min-w-[44px] flex items-center justify-center text-muted-foreground disabled:opacity-30 active:scale-95 transition"
                  >
                    <ChevronUp size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeEmotion(candidate.id, stepBasicEmotion(candidate.basic, 1))}
                    disabled={atEnd}
                    aria-label={`${label} 대신 더 부정적인 감정으로 바꾸기`}
                    className="min-h-[22px] min-w-[44px] flex items-center justify-center text-muted-foreground disabled:opacity-30 active:scale-95 transition"
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onRemove(candidate.id)}
                  aria-label={`${label} 빼기`}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive active:scale-95 transition shrink-0"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {removed.length > 0 && (
        <div className="pt-1 space-y-1.5" data-testid="emotion-chip-removed">
          <p className="text-caption text-muted-foreground">뺀 마음 — 다시 넣을 수 있어요</p>
          <div className="flex flex-wrap gap-1.5">
            {removed.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onRestore(candidate.id)}
                aria-label={`${BASIC_EMOTION_LABEL[candidate.basic]} 다시 넣기`}
                className="min-h-[44px] px-3 rounded-control bg-muted text-muted-foreground border border-border text-caption font-bold flex items-center gap-1 active:scale-95 transition"
              >
                <RotateCcw size={12} aria-hidden="true" />
                {BASIC_EMOTION_LABEL[candidate.basic]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
