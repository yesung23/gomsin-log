import { useState } from 'react';
import type { EmotionFlowItem } from '@/types';
import {
  BASIC_EMOTION_LABEL,
  BASIC_EMOTION_ORDER,
  applyBasicEmotion,
  basicEmotionOf,
  type BasicEmotion,
} from '@/lib/basicEmotions';
import { EmotionCharacter } from '@/components/emotion/EmotionCharacter';

/**
 * 기록 속 마음 — the feeling this entry is carrying, as a thing you can just point at.
 *
 * ## What this replaces
 *
 * Correcting a saved feeling used to be: find the collapsed button, open the
 * editor, press ▲ or ▼ the right number of times to walk the six-emotion wheel,
 * then save. Four or more deliberate actions to say "it was not that, it was
 * this". The stepper was built for a different job -- reviewing a list of machine
 * guesses at write time -- and it is still the right control there.
 *
 * Here the whole vocabulary is six items, so it fits on one row and the correction
 * collapses to a single tap on the feeling you meant. The stored feeling is already
 * selected when the section opens, so the common case -- the reading was right --
 * costs nothing at all.
 *
 * ## The rule this section exists to keep
 *
 * Nothing in this component reads the diary text, and nothing calls the analyser.
 * A feeling becomes `user_confirmed` only because a person pressed one of these
 * characters. The machine may still SUGGEST at write time; it may not decide here,
 * and it may not quietly revise what a person already answered -- `applyBasicEmotion`
 * stamps `userEdited`, which is what stops a later re-analysis overwriting it.
 *
 * ## Multi-item flows
 *
 * An entry can hold up to four feelings in sequence (분노 → 행복). Showing six
 * characters per item would be twenty-four targets, so the sequence is a row of
 * small characters and the picker edits whichever one is chosen -- the last by
 * default, because when a single feeling is wanted from a whole entry, where the
 * day ENDED is the more useful answer than where it started.
 */

export interface RecordMoodSectionProps {
  /** The record's stored flow. Only `user_confirmed` items are treated as answers. */
  items: EmotionFlowItem[];
  /** Persist a changed flow. Returning false leaves the previous selection shown. */
  onChange: (next: EmotionFlowItem[]) => Promise<boolean> | boolean;
  /** Author-only surface; the caller gates on ownership. */
  disabled?: boolean;
  disabledReason?: string;
}

/** A newly picked feeling starts author-only. Sharing is a separate, explicit act. */
function newItem(basic: BasicEmotion, sequence: number): EmotionFlowItem {
  return applyBasicEmotion(
    {
      sequence,
      group: 'neutral',
      displayLabel: '',
      source: 'user_confirmed',
      /*
        PRODUCT_V3 §13: a feeling is author-only until the author decides otherwise.
        Defaulting a NEW one to `shared` here would publish something to the partner
        as a side effect of a correction, which is not what pressing a face means.
      */
      visibility: 'author_only',
    },
    basic,
  );
}

export function RecordMoodSection({
  items,
  onChange,
  disabled = false,
  disabledReason,
}: RecordMoodSectionProps) {
  const confirmed = items.filter((item) => item.source === 'user_confirmed');
  const ordered = [...confirmed].sort((a, b) => a.sequence - b.sequence);

  /** Which item in the sequence the picker is editing. Defaults to the last. */
  const [editingSequence, setEditingSequence] = useState<number | null>(null);
  const [pending, setPending] = useState<BasicEmotion | null>(null);

  const target =
    ordered.find((item) => item.sequence === editingSequence) ?? ordered[ordered.length - 1];
  const selected = pending ?? (target ? basicEmotionOf(target) : null);

  const choose = async (basic: BasicEmotion) => {
    if (disabled || basic === selected) return;
    setPending(basic);

    const next = target
      ? items.map((item) =>
          item.sequence === target.sequence && item.source === 'user_confirmed'
            ? applyBasicEmotion(item, basic)
            : item,
        )
      : [...items, newItem(basic, (items.at(-1)?.sequence ?? 0) + 1)];

    const ok = await onChange(next);
    // On failure the pending choice is dropped, so the row falls back to what is
    // actually stored rather than showing a change that did not survive.
    if (!ok) setPending(null);
  };

  return (
    <section
      data-testid="record-mood-section"
      aria-labelledby="record-mood-heading"
      className="space-y-2.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 id="record-mood-heading" className="text-label font-bold text-foreground">
          기록 속 마음
        </h4>
        {ordered.length === 0 && (
          <span className="text-caption text-muted-foreground">마음 선택하기</span>
        )}
      </div>

      <p className="text-caption text-muted-foreground leading-tight">
        {ordered.length === 0
          ? '이 기록에는 아직 마음이 없어요. 눌러서 골라 주세요.'
          : '다르면 눌러서 바꿀 수 있어요.'}
      </p>

      {/*
        The sequence, shown only when there is more than one feeling. With a single
        feeling this row would say the same thing as the highlighted character
        below it, and a control that repeats its neighbour reads as a second choice
        to make rather than a summary.
      */}
      {ordered.length > 1 && (
        <ul data-testid="record-mood-sequence" className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {ordered.map((item, index) => {
            const basic = basicEmotionOf(item);
            const isTarget = item.sequence === target?.sequence;
            return (
              <li key={item.id ?? item.sequence}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingSequence(item.sequence);
                    setPending(null);
                  }}
                  aria-pressed={isTarget}
                  aria-label={`${index + 1}번째 마음 ${BASIC_EMOTION_LABEL[basic]} 고르기`}
                  className={`press-response min-h-11 pl-1 pr-2.5 rounded-control flex items-center gap-1 border ${
                    isTarget ? 'border-coral bg-coral/10' : 'border-border bg-card'
                  }`}
                >
                  <EmotionCharacter emotion={basic} selected size={24} />
                  <span className="text-caption font-semibold text-foreground">
                    {BASIC_EMOTION_LABEL[basic]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        The picker. All six always visible: hiding the unchosen ones behind a
        disclosure would put the correction back behind an extra tap, which is the
        exact cost this section exists to remove.
      */}
      <ul
        data-testid="record-mood-picker"
        className="grid grid-cols-6 gap-1"
        aria-label="마음 고르기"
      >
        {BASIC_EMOTION_ORDER.map((basic) => {
          const isOn = basic === selected;
          return (
            <li key={basic}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void choose(basic)}
                data-testid={`record-mood-option-${basic}`}
                data-selected={isOn ? 'true' : 'false'}
                aria-pressed={isOn}
                aria-label={BASIC_EMOTION_LABEL[basic]}
                title={disabled ? disabledReason : undefined}
                className={`press-response w-full min-h-11 py-1.5 rounded-control flex flex-col items-center justify-center gap-0.5 border disabled:opacity-50 ${
                  isOn ? 'border-transparent' : 'border-border bg-card'
                }`}
                /*
                  The selected tint is the emotion's own surface token, so the chip
                  and the character are the same colour family. Inline because the
                  value is chosen per emotion at runtime; the tokens themselves live
                  in `index.css` and answer dark mode there.
                */
                style={isOn ? { backgroundColor: `var(--emotion-${basic}-surface)` } : undefined}
              >
                <EmotionCharacter emotion={basic} selected={isOn} size={32} />
                <span
                  className={`text-caption leading-none ${
                    isOn ? 'font-bold text-foreground' : 'font-normal text-muted-foreground'
                  }`}
                >
                  {BASIC_EMOTION_LABEL[basic]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {disabled && disabledReason && (
        <p className="text-caption text-muted-foreground">{disabledReason}</p>
      )}
    </section>
  );
}
