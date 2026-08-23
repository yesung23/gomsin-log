import { useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import {
  BASIC_EMOTION_LABEL,
  BASIC_EMOTION_ORDER,
  type BasicEmotion,
} from '@/lib/basicEmotions';
import { EmotionCharacter } from '@/components/emotion/EmotionCharacter';
import type { EmotionCandidate } from '@/lib/emotionCandidates';

/**
 * 이렇게 느꼈나요? — the app's reading of an entry, offered as a QUESTION.
 *
 * ## What this replaces and why
 *
 * The previous editor presented the same readings as decisions already taken: the
 * chips arrived included, and `candidatesToFlowItems` stamped every survivor
 * `user_confirmed`. Someone who wrote an entry and pressed save without looking
 * had the machine's guess filed as their own confirmed feeling -- and if they had
 * ever turned the share switch on, published to their partner as one.
 *
 * PRODUCT_V3 §13 draws the line this component sits on: a machine reading is
 * private to the author, and becoming the author's feeling -- let alone the
 * partner's view of it -- requires an affirmative act. Not the absence of a
 * refusal.
 *
 * So every reading here is visibly UNANSWERED until it is pressed. Answering is
 * one tap (맞아요), disagreeing is one tap and a pick (바꾸기), and ignoring the
 * whole thing is free and stores nothing.
 *
 * ## Why it is not a smaller control
 *
 * A single "the app thinks you felt 기뻤어" line with a checkmark would be shorter,
 * but it hides the two things that make the reading judgeable: WHICH PHRASE it
 * came from, and that there may be a SEQUENCE. `ㅈ같았는데 ... 기분이 나아졌어` is
 * 화났어 → 기뻤어, and collapsing it to one feeling loses the shape of the day, which
 * is the part worth keeping.
 *
 * ## Timing
 *
 * Nothing here triggers analysis. The caller runs the analyser at a composition
 * boundary and hands the result down -- see `onDeviceInference.ts`.
 */

export interface EmotionSuggestionReviewProps {
  candidates: EmotionCandidate[];
  removed: EmotionCandidate[];
  confirmedIds: ReadonlySet<string>;
  onConfirm: (id: string) => void;
  onConfirmAll: () => void;
  onChangeEmotion: (id: string, basic: BasicEmotion) => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  /** Plain sentence naming who ends up able to see the answered feelings. */
  visibilityNote: string;
  /**
   * The share switch. Rendered only when there is a sharing decision to make --
   * a private record has none. Sharing an UNANSWERED reading is impossible by
   * construction (`candidatesToFlowItems`), so this switch publishes only what
   * was confirmed, and the copy says so.
   */
  shareWithPartner?: boolean;
  onToggleShareWithPartner?: (value: boolean) => void;
  className?: string;
}

export function EmotionSuggestionReview({
  candidates,
  removed,
  confirmedIds,
  onConfirm,
  onConfirmAll,
  onChangeEmotion,
  onRemove,
  onRestore,
  visibilityNote,
  shareWithPartner,
  onToggleShareWithPartner,
  className,
}: EmotionSuggestionReviewProps) {
  /** Which row has its six-character picker open. Only ever one. */
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  if (candidates.length === 0 && removed.length === 0) return null;

  const confirmedCount = candidates.filter((c) => confirmedIds.has(c.id)).length;
  const unanswered = candidates.length - confirmedCount;

  return (
    <div
      data-testid="emotion-suggestion-review"
      /*
        종이 위의 구역이지 카드가 아니다 (2026-08-23).

        분홍 배경에 둥근 카드였다. 공책 위에서 그 하나가 유일하게 앱처럼 보였고, 그것
        때문에 나머지 화면이 인쇄된 것처럼 읽혔다. 채우기를 걷고 손으로 그린 상자로 둔다.
      */
      className={`ink-box p-3.5 space-y-3 ${className || ''}`}
    >
      <div className="space-y-1">
        <h4 className="text-label font-bold" style={{ color: 'var(--ink)' }}>이렇게 느꼈나요?</h4>
        <p className="text-caption text-muted-foreground leading-tight">
          글에서 읽어본 거예요. 눌러서 확인한 마음만 저장돼요.
        </p>
      </div>

      {candidates.length === 0 ? (
        <p
          data-testid="emotion-suggestion-empty"
          className="text-caption text-muted-foreground leading-tight"
        >
          마음을 모두 뺐어요. 이 기록에는 마음이 저장되지 않아요.
        </p>
      ) : (
        <ul data-testid="emotion-suggestion-list" className="space-y-1.5">
          {candidates.map((candidate, index) => {
            const answered = confirmedIds.has(candidate.id);
            const label = BASIC_EMOTION_LABEL[candidate.basic];
            const picking = pickerFor === candidate.id;
            return (
              <li
                key={candidate.id}
                data-testid={`emotion-suggestion-${candidate.id}`}
                data-basic={candidate.basic}
                data-answered={answered ? 'true' : 'false'}
                /*
                  확인한 줄은 실선, 아직인 줄은 점선. 채우기로 구별하면 종이가 사라진다.
                */
                className="p-2 space-y-2"
                style={{
                  border: answered
                    ? 'var(--stroke) solid var(--ink)'
                    : 'var(--stroke-thin) dashed var(--ink-faint)',
                  borderRadius: '120px 8px 130px 8px / 8px 130px 8px 120px',
                }}
              >
                <div className="flex items-center gap-2">
                  {candidates.length > 1 && (
                    <span className="text-caption font-bold text-muted-foreground w-4 text-center shrink-0 tabular-nums">
                      {index + 1}
                    </span>
                  )}
                  {/* Monochrome until answered: an unconfirmed reading should not
                      look as settled as a confirmed one. */}
                  <EmotionCharacter emotion={candidate.basic} selected={answered} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-label font-bold text-foreground">{label}</p>
                    {candidate.evidence ? (
                      <p className="text-caption text-muted-foreground truncate">
                        “{candidate.evidence}”에서 읽었어요
                      </p>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        {answered ? '확인했어요' : '아직 확인 전이에요'}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(candidate.id)}
                    aria-label={`${label} 빼기`}
                    className="press-response min-h-11 min-w-11 flex items-center justify-center rounded-lg text-muted-foreground shrink-0"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onConfirm(candidate.id);
                      setPickerFor(null);
                    }}
                    disabled={answered}
                    data-testid={`emotion-suggestion-confirm-${candidate.id}`}
                    aria-label={`${label} 맞아요`}
                    className={`press-response-row flex-1 min-h-11 rounded-control text-label font-bold flex items-center justify-center gap-1 border ${
                      answered
                        ? 'border-transparent bg-coral/15 text-coral-strong'
                        : 'border-border bg-card text-foreground'
                    }`}
                  >
                    {answered && <Check size={14} aria-hidden="true" />}
                    {answered ? '확인함' : '맞아요'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerFor(picking ? null : candidate.id)}
                    aria-expanded={picking}
                    data-testid={`emotion-suggestion-change-${candidate.id}`}
                    className="press-response-row ink-chip flex-1 min-h-11 text-label font-bold" style={{ color: 'var(--ink)' }}
                  >
                    {picking ? '닫기' : '다른 마음'}
                  </button>
                </div>

                {picking && (
                  <ul
                    data-testid={`emotion-suggestion-picker-${candidate.id}`}
                    className="grid grid-cols-6 gap-1 pt-0.5"
                    aria-label={`${index + 1}번째 마음 고르기`}
                  >
                    {BASIC_EMOTION_ORDER.map((basic) => {
                      const isOn = basic === candidate.basic;
                      return (
                        <li key={basic}>
                          <button
                            type="button"
                            onClick={() => {
                              onChangeEmotion(candidate.id, basic);
                              setPickerFor(null);
                            }}
                            data-testid={`emotion-suggestion-option-${candidate.id}-${basic}`}
                            aria-pressed={isOn}
                            aria-label={BASIC_EMOTION_LABEL[basic]}
                            className={`press-response w-full min-h-11 py-1 rounded-control flex flex-col items-center justify-center gap-0.5 border ${
                              isOn ? 'border-transparent' : 'border-border bg-card'
                            }`}
                            style={
                              isOn ? { backgroundColor: `var(--emotion-${basic}-surface)` } : undefined
                            }
                          >
                            <EmotionCharacter emotion={basic} selected={isOn} size={26} />
                            <span
                              className={`text-caption leading-none ${
                                isOn ? 'font-bold text-foreground' : 'text-muted-foreground'
                              }`}
                            >
                              {BASIC_EMOTION_LABEL[basic]}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {unanswered > 1 && (
        <button
          type="button"
          onClick={onConfirmAll}
          data-testid="emotion-suggestion-confirm-all"
          className="press-response-row ink-fill w-full min-h-11 text-label font-bold"
        >
          {unanswered}개 다 맞아요
        </button>
      )}

      {removed.length > 0 && (
        <div className="space-y-1.5" data-testid="emotion-suggestion-removed">
          <p className="text-caption text-muted-foreground">뺀 마음 — 다시 넣을 수 있어요</p>
          <div className="flex flex-wrap gap-1.5">
            {removed.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onRestore(candidate.id)}
                aria-label={`${BASIC_EMOTION_LABEL[candidate.basic]} 다시 넣기`}
                className="press-response ink-chip min-h-11 px-3 text-caption font-bold flex items-center gap-1" style={{ color: 'var(--ink-soft)' }}
              >
                <RotateCcw size={12} aria-hidden="true" />
                {BASIC_EMOTION_LABEL[candidate.basic]}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-caption font-semibold leading-tight text-muted-foreground">
        {visibilityNote}
      </p>

      {onToggleShareWithPartner && (
        <label className="ink-chip flex items-center gap-1.5 min-h-11 px-3 text-label font-semibold cursor-pointer w-fit" style={{ color: 'var(--ink)' }}>
          <input
            type="checkbox"
            checked={!!shareWithPartner}
            onChange={(event) => onToggleShareWithPartner(event.target.checked)}
            className="accent-coral"
            data-testid="emotion-share-toggle"
          />
          확인한 마음도 함께 보여주기
        </label>
      )}
    </div>
  );
}
