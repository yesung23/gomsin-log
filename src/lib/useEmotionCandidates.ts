import { useCallback, useMemo, useRef, useState } from 'react';
import type { EmotionFlowItem } from '@/types';
import { applyBasicEmotion, type BasicEmotion } from '@/lib/basicEmotions';
import {
  candidatesToFlowItems,
  extractEmotionCandidates,
  flowItemsToCandidates,
  type EmotionCandidate,
} from '@/lib/emotionCandidates';
import { InferenceMemo } from '@/lib/onDeviceInference';

/**
 * Review state for the opt-out emotion flow, shared by the composer and by the
 * "correct a saved record" editor so the two can never drift apart.
 *
 * The tricky part is that candidates are DERIVED from text that keeps changing
 * while the user types, but removals and corrections are USER DECISIONS that must
 * survive that re-derivation. Keying decisions by candidate id and re-applying them
 * on every extraction is what makes "I already said that one is wrong" stick
 * instead of being undone by the next keystroke.
 */
export interface EmotionCandidateReview {
  /** Kept candidates, in flow order, with corrections applied. */
  candidates: EmotionCandidate[];
  /** Removed candidates, still restorable until save. */
  removed: EmotionCandidate[];
  remove: (id: string) => void;
  restore: (id: string) => void;
  changeEmotion: (id: string, basic: BasicEmotion) => void;
  /**
   * The author answered "yes, that one" for this candidate.
   *
   * Separate from `changeEmotion` only because agreeing and correcting are
   * different gestures; both count as an answer, and only an answer may be
   * stored as the author's feeling.
   */
  confirm: (id: string) => void;
  /** Answer every remaining candidate at once. The "다 맞아요" path. */
  confirmAll: () => void;
  /** Which candidates have been answered. Drives the confirmed/suggested split. */
  confirmedIds: ReadonlySet<string>;
  /** True when at least one candidate is still an unanswered machine guess. */
  hasUnanswered: boolean;
  /**
   * Exactly what should be persisted. `evidence` is dropped here.
   *
   * Unanswered candidates come back as `rule_suggested` and can never be
   * `shared`; `emotionFlowForStorage` then keeps them out of the row entirely.
   * `shareWithPartner` is the second half of the PRODUCT_V3 §13 requirement --
   * it publishes what the author confirmed, and nothing else.
   */
  toFlowItems: (isPrivate: boolean, shareWithPartner: boolean) => EmotionFlowItem[];
  /** True once the user removed, corrected or confirmed anything. */
  touched: boolean;
  reset: () => void;
}

function useReview(
  base: EmotionCandidate[],
  /**
   * Candidates that were already answered before this review opened.
   *
   * The post-save correction path reads back items a person confirmed once
   * already; re-deriving them as unanswered guesses would let a correction
   * session silently demote a settled feeling back to a suggestion.
   */
  preAnswered?: ReadonlySet<string>,
): EmotionCandidateReview {
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [overrides, setOverrides] = useState<Readonly<Record<string, BasicEmotion>>>({});
  const [ownAnswers, setAnsweredIds] = useState<ReadonlySet<string>>(() => new Set());
  const answeredIds = useMemo<ReadonlySet<string>>(
    () => (preAnswered && preAnswered.size > 0
      ? new Set([...preAnswered, ...ownAnswers])
      : ownAnswers),
    [preAnswered, ownAnswers],
  );
  // Kept in a ref as well so `toFlowItems` can mark edits without re-rendering.
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const answeredRef = useRef(answeredIds);
  answeredRef.current = answeredIds;

  const withOverrides = useMemo(
    () => base.map((candidate) => {
      const override = overrides[candidate.id];
      return override ? { ...candidate, basic: override } : candidate;
    }),
    [base, overrides],
  );

  const candidates = useMemo(
    () => withOverrides
      .filter((candidate) => !removedIds.has(candidate.id))
      .map((candidate, index) => ({ ...candidate, sequence: index + 1 })),
    [withOverrides, removedIds],
  );

  const removed = useMemo(
    () => withOverrides.filter((candidate) => removedIds.has(candidate.id)),
    [withOverrides, removedIds],
  );

  const remove = useCallback((id: string) => {
    setRemovedIds((current) => new Set(current).add(id));
  }, []);

  const restore = useCallback((id: string) => {
    setRemovedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  // Correcting a feeling IS answering it: someone who replaces 놀랐어 with 화났어 has
  // said more about what they felt than someone who tapped agree.
  const changeEmotion = useCallback((id: string, basic: BasicEmotion) => {
    setOverrides((current) => ({ ...current, [id]: basic }));
    setAnsweredIds((current) => new Set(current).add(id));
  }, []);

  const confirm = useCallback((id: string) => {
    setAnsweredIds((current) => new Set(current).add(id));
  }, []);

  const confirmAll = useCallback(() => {
    setAnsweredIds((current) => {
      const next = new Set(current);
      for (const candidate of base) next.add(candidate.id);
      return next;
    });
  }, [base]);

  const reset = useCallback(() => {
    setRemovedIds(new Set());
    setOverrides({});
    setAnsweredIds(new Set());
  }, []);

  const toFlowItems = useCallback(
    (isPrivate: boolean, shareWithPartner: boolean) => candidatesToFlowItems(candidates, {
      isPrivate,
      shareWithPartner,
      confirmedIds: answeredRef.current,
      editedIds: new Set(Object.keys(overridesRef.current)),
    }),
    [candidates],
  );

  const hasUnanswered = useMemo(
    () => candidates.some((candidate) => !answeredIds.has(candidate.id)),
    [candidates, answeredIds],
  );

  return {
    candidates,
    removed,
    remove,
    restore,
    changeEmotion,
    confirm,
    confirmAll,
    confirmedIds: answeredIds,
    hasUnanswered,
    toFlowItems,
    touched:
      removedIds.size > 0 || Object.keys(overrides).length > 0 || answeredIds.size > 0,
    reset,
  };
}

export interface BoundaryReview extends EmotionCandidateReview {
  /**
   * Run the analyser on `text`. Call this AT A BOUNDARY only -- the field lost
   * focus, or save was pressed. Never on change.
   *
   * Idempotent per content: calling it repeatedly with text that normalises to
   * the same string reuses the previous reading, so leaving and re-entering the
   * field costs nothing and cannot reshuffle candidate ids under a decision the
   * author already made.
   */
  analyse: (text: string) => void;
  /** True once `analyse` has produced a reading for the current content. */
  analysed: boolean;
}

/**
 * Review candidates read from composer text AT COMPOSITION BOUNDARIES.
 *
 * Replaces a hook that re-derived candidates from a 300 ms debounce of every
 * keystroke. See `onDeviceInference.ts` for why that was the wrong moment, and
 * `docs/V1_LAUNCH_DECISIONS_2026-08-20.md` §3 for the comparison it came from.
 *
 * The memo lives for the lifetime of the composer, so the common shape --
 * write, tab away, glance, tab back, add a line, save -- analyses twice rather
 * than once per pause.
 */
export function useEmotionCandidatesAtBoundary(): BoundaryReview {
  const memo = useRef(new InferenceMemo<EmotionCandidate[]>());
  // The content the current `base` was read from. A ref rather than state: it is
  // a guard against redundant work, and making it state would mean the guard
  // itself scheduled a render.
  const analysedKeyRef = useRef<string | null>(null);
  const [base, setBase] = useState<EmotionCandidate[]>([]);
  const [analysed, setAnalysed] = useState(false);
  const review = useReview(base);

  const { reset } = review;
  const analyse = useCallback((text: string) => {
    const key = InferenceMemo.keyFor(text);
    // Same content as last time: the reading cannot have changed, and replacing
    // `base` would regenerate identical candidate ids while discarding the
    // answers already keyed to them.
    if (analysedKeyRef.current === key) return;
    analysedKeyRef.current = key;
    setBase(memo.current.read(text, extractEmotionCandidates));
    // A genuinely different body is a different set of feelings; decisions made
    // about the previous reading do not carry over to it.
    reset();
    setAnalysed(true);
  }, [reset]);

  return { ...review, analyse, analysed };
}

/**
 * Review the flow already stored on a record, so a wrong reading can be corrected
 * after the fact. This is the path that did not exist at all before: once a record
 * was saved its flow was final.
 */
export function useEmotionCandidatesForRecord(
  items: EmotionFlowItem[] | undefined,
): EmotionCandidateReview {
  const base = useMemo(() => flowItemsToCandidates(items || []), [items]);
  // Derived by POSITION against `base` rather than by re-deriving the fallback id
  // rule, which `flowItemsToCandidates` owns. Both walk the same sequence-sorted
  // list, so index `i` is the same item in both -- and a change to that id rule
  // cannot silently desynchronise this set from it.
  const preAnswered = useMemo(() => {
    const sorted = [...(items || [])].sort((a, b) => a.sequence - b.sequence);
    return new Set(
      base
        .filter((_, index) => sorted[index]?.source === 'user_confirmed')
        .map((candidate) => candidate.id),
    );
  }, [base, items]);
  return useReview(base, preAnswered);
}

/**
 * Re-apply a correction onto an existing stored item list.
 *
 * Used when saving a corrected record: it preserves each item's identity and only
 * rewrites the emotion, so `userEdited` and the item id survive.
 */
export function applyCorrections(
  items: EmotionFlowItem[],
  candidates: EmotionCandidate[],
): EmotionFlowItem[] {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  return candidates.map((candidate, index) => {
    const original = byId.get(candidate.id);
    const base: EmotionFlowItem = original ?? {
      id: candidate.id,
      sequence: index + 1,
      group: 'surprise',
      displayLabel: '놀랐어',
    };
    return { ...applyBasicEmotion(base, candidate.basic), sequence: index + 1 };
  });
}
