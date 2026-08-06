import type { EmotionFlowItem, EmotionGroup } from '@/types';
import { BASIC_EMOTION_VALENCE } from '@/lib/basicEmotions';

/**
 * On-device emotion-flow analysis.
 *
 * This module is a pure, deterministic function of the emotion items the user
 * explicitly confirmed. It exists so that the app can describe the shape of a
 * day ("무거워졌어요", "오르내렸어요") without sending anything anywhere.
 *
 * Three properties are load-bearing and must not be relaxed:
 *
 * 1. It never receives diary text. The input is `EmotionFlowItem[]`, and only
 *    `sequence`, `group`, `displayLabel` and `source` are read. `log` is not a
 *    parameter and `matchedText` is never touched, so no diary fragment can
 *    reach the output even by accident.
 *
 * 2. Its result is derived, never persisted. There is no column and no field on
 *    `DailyRecord` for it; both call sites recompute it on render. That keeps
 *    `privacy.ts` the single write-path authority.
 *
 * 3. It is non-diagnostic. Summaries come from the fixed table below and never
 *    contain clinical vocabulary (see `NON_DIAGNOSTIC_BANNED_TERMS`).
 *
 * No external model, no network, no `Date`, no randomness -- the same input
 * always yields the same output.
 */

/**
 * Valence of each emotion group on a [-1, 1] pleasantness axis.
 *
 * These are UI copy, not clinical measures: they only need to order the groups
 * plausibly so that "sadness -> joy" reads as recovery and the reverse reads as
 * a downward day. Every group in the `EmotionGroup` union must appear here; the
 * unit test fails if a new group is added to the union without a valence.
 */
/**
 * Valence of one item, preferring the six-emotion reading when present.
 *
 * A correction rewrites `basic` (and `group` with it), so this makes a corrected
 * item bend the drawn shape exactly as an originally-detected one would. Without
 * this the user could fix a label and watch the line stay wrong.
 */
export function valenceOfItem(item: Pick<EmotionFlowItem, 'group' | 'basic'>): number {
  if (item.basic && item.basic in BASIC_EMOTION_VALENCE) {
    return BASIC_EMOTION_VALENCE[item.basic];
  }
  return EMOTION_VALENCE[item.group] ?? 0;
}

export const EMOTION_VALENCE: Record<EmotionGroup, number> = {
  joy: 1,
  excitement: 0.9,
  love: 0.8,
  calm: 0.5,
  surprise: 0.1,
  neutral: 0,
  uncertain: -0.1,
  longing: -0.2,
  envy: -0.3,
  fatigue: -0.35,
  concern: -0.4,
  fear: -0.5,
  shame: -0.5,
  guilt: -0.5,
  jealousy: -0.55,
  frustration: -0.6,
  disgust: -0.6,
  anger: -0.7,
  sadness: -0.75,
};

/** Total spread at or below which a day counts as emotionally flat. */
export const CALM_BAND = 0.2;

/** Net first-to-last movement needed to call a day directional. */
export const DIRECTIONAL_NET_CHANGE = 0.4;

/** How many direction flips make a day a rollercoaster. */
export const MIN_SIGN_CHANGES_FOR_ROLLERCOASTER = 2;

/**
 * Clinical vocabulary that must never appear in a generated summary. The app
 * describes feelings, it does not diagnose. Asserted by the unit test.
 */
export const NON_DIAGNOSTIC_BANNED_TERMS = [
  '우울증',
  '장애',
  '진단',
  '치료',
  '질환',
  '증상',
  '병',
  'PTSD',
];

/** Deltas smaller than this are treated as noise when counting direction flips. */
const SIGN_CHANGE_EPSILON = 0.05;

export type EmotionFlowShape =
  | 'single'
  | 'calm'
  | 'recovery'
  | 'downward'
  | 'rollercoaster'
  | 'mixed';

export interface EmotionFlowPoint {
  sequence: number;
  group: EmotionGroup;
  label: string;
  valence: number;
}

export interface EmotionFlowTransition {
  fromIndex: number;
  toIndex: number;
  from: EmotionFlowPoint;
  to: EmotionFlowPoint;
  delta: number;
}

export interface EmotionFlowAnalysis {
  points: EmotionFlowPoint[];
  startState: EmotionFlowPoint;
  endState: EmotionFlowPoint;
  netChange: number;
  swing: number;
  largestTransition: EmotionFlowTransition | null;
  shape: EmotionFlowShape;
  summary: string;
}

/** One fixed, non-diagnostic sentence per shape. */
const SHAPE_SENTENCE: Record<EmotionFlowShape, string> = {
  single: '이 마음 하나를 남겼어요.',
  calm: '비슷한 마음이 하루 내내 이어졌어요.',
  recovery: '마음이 조금씩 편해지는 쪽으로 움직였어요.',
  downward: '하루가 지나면서 마음이 무거워졌어요.',
  rollercoaster: '마음이 여러 번 오르내린 하루예요.',
  mixed: '여러 마음이 섞인 하루예요.',
};

function hasValence(item: Pick<EmotionFlowItem, 'group' | 'basic'>): boolean {
  // A corrected item is always scoreable: `applyBasicEmotion` rewrites `group`
  // alongside `basic`. Checking `basic` as well means a future basic emotion
  // cannot be silently dropped from the analysis just because someone forgot to
  // add its legacy group to EMOTION_VALENCE.
  if (item.basic && item.basic in BASIC_EMOTION_VALENCE) return true;
  return Object.prototype.hasOwnProperty.call(EMOTION_VALENCE, item.group);
}

/**
 * Analyse the ordered emotions a user confirmed for one record.
 *
 * Returns `null` when there is nothing confirmed to describe, so callers can
 * skip rendering entirely rather than showing an empty card.
 */
export function analyzeEmotionFlow(
  items: EmotionFlowItem[] | undefined,
): EmotionFlowAnalysis | null {
  // Only user-confirmed items count. Rule suggestions stay local to the
  // composer and must never drive a saved record's narrative.
  const confirmed = (items || [])
    .filter((item) => item.source === 'user_confirmed')
    .filter((item) => hasValence(item));

  if (confirmed.length === 0) return null;

  // Stable sort: equal sequences keep their original relative order.
  const ordered = confirmed
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.sequence - b.item.sequence || a.index - b.index)
    .map(({ item }) => item);

  const points: EmotionFlowPoint[] = ordered.map((item) => ({
    sequence: item.sequence,
    group: item.group,
    // Fall back to the group key only -- never to any other user-provided
    // string, so no diary fragment can reach the label.
    label: item.displayLabel?.trim() || item.group,
    valence: valenceOfItem(item),
  }));

  const valences = points.map((point) => point.valence);
  const startState = points[0];
  const endState = points[points.length - 1];
  const netChange = endState.valence - startState.valence;
  const swing = Math.max(...valences) - Math.min(...valences);

  const deltas = valences.slice(1).map((value, index) => value - valences[index]);

  let signChanges = 0;
  let lastSign = 0;
  for (const delta of deltas) {
    if (Math.abs(delta) <= SIGN_CHANGE_EPSILON) continue;
    const sign = delta > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) signChanges += 1;
    lastSign = sign;
  }

  let largestTransition: EmotionFlowTransition | null = null;
  for (let i = 0; i < deltas.length; i += 1) {
    // Strictly greater: the earliest index wins ties.
    if (largestTransition && Math.abs(deltas[i]) <= Math.abs(largestTransition.delta)) continue;
    largestTransition = {
      fromIndex: i,
      toIndex: i + 1,
      from: points[i],
      to: points[i + 1],
      delta: deltas[i],
    };
  }

  const shape = classifyShape({
    length: points.length,
    swing,
    netChange,
    signChanges,
  });

  // Built only from labels and the fixed sentence table.
  const path = points.map((point) => point.label).join(' → ');
  const summary = `${path} ${SHAPE_SENTENCE[shape]}`;

  return {
    points,
    startState,
    endState,
    netChange,
    swing,
    largestTransition,
    shape,
    summary,
  };
}

/** Fixed rule cascade -- order matters and is part of the contract. */
function classifyShape({
  length,
  swing,
  netChange,
  signChanges,
}: {
  length: number;
  swing: number;
  netChange: number;
  signChanges: number;
}): EmotionFlowShape {
  if (length === 1) return 'single';
  if (swing <= CALM_BAND) return 'calm';
  if (signChanges >= MIN_SIGN_CHANGES_FOR_ROLLERCOASTER) return 'rollercoaster';
  if (netChange >= DIRECTIONAL_NET_CHANGE) return 'recovery';
  if (netChange <= -DIRECTIONAL_NET_CHANGE) return 'downward';
  return 'mixed';
}
