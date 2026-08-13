import { useCallback, useMemo, useRef, useState } from 'react';
import type { EmotionFlowItem } from '@/types';
import { applyBasicEmotion, type BasicEmotion } from '@/lib/basicEmotions';
import {
  candidatesToFlowItems,
  extractEmotionCandidates,
  flowItemsToCandidates,
  type EmotionCandidate,
} from '@/lib/emotionCandidates';

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
   * Exactly what should be persisted. `evidence` is dropped here.
   *
   * `shareWithPartner` is the explicit author action PRODUCT_V3 §13 requires
   * before machine-inferred emotion can become partner-visible; omitting it
   * (or a private record) keeps every item `author_only`.
   */
  toFlowItems: (isPrivate: boolean, shareWithPartner: boolean) => EmotionFlowItem[];
  /** True once the user removed or corrected anything. */
  touched: boolean;
  reset: () => void;
}

function useReview(base: EmotionCandidate[]): EmotionCandidateReview {
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [overrides, setOverrides] = useState<Readonly<Record<string, BasicEmotion>>>({});
  // Kept in a ref as well so `toFlowItems` can mark edits without re-rendering.
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

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

  const changeEmotion = useCallback((id: string, basic: BasicEmotion) => {
    setOverrides((current) => ({ ...current, [id]: basic }));
  }, []);

  const reset = useCallback(() => {
    setRemovedIds(new Set());
    setOverrides({});
  }, []);

  const toFlowItems = useCallback(
    (isPrivate: boolean, shareWithPartner: boolean) => candidatesToFlowItems(candidates, {
      isPrivate,
      shareWithPartner,
      editedIds: new Set(Object.keys(overridesRef.current)),
    }),
    [candidates],
  );

  return {
    candidates,
    removed,
    remove,
    restore,
    changeEmotion,
    toFlowItems,
    touched: removedIds.size > 0 || Object.keys(overrides).length > 0,
    reset,
  };
}

/** Review candidates extracted live from composer text. */
export function useEmotionCandidatesForText(text: string): EmotionCandidateReview {
  const base = useMemo(() => extractEmotionCandidates(text), [text]);
  return useReview(base);
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
  return useReview(base);
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
      displayLabel: '놀람',
    };
    return { ...applyBasicEmotion(base, candidate.basic), sequence: index + 1 };
  });
}
