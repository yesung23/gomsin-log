import type { BasicEmotion, EmotionFlowItem, EmotionGroup } from '@/types';

/**
 * The six refined emotions the product speaks in.
 *
 * The old vocabulary had nineteen `EmotionGroup` values. That was unusable for
 * correction: a user who was shown the wrong feeling had no practical way to find
 * the right one, and the reported problem was exactly that -- "감정의 흐름이
 * 짜증 -> 행복인데 앱에서 행복 -> 우울처럼 잘못 캐치했다면 수정할 방법이 없다".
 *
 * Six is small enough to step through with two buttons and still cover the range
 * people actually write about. `EmotionGroup` is deliberately NOT removed:
 * records already stored carry those values, so `BASIC_BY_GROUP` maps every one of
 * them onto a basic emotion and nothing has to be migrated.
 */
export type { BasicEmotion };

/**
 * Wheel order, most positive first.
 *
 * Ordered by valence rather than alphabetically or by the order they were named,
 * because the stepper is how a user corrects a feeling: pressing ▲ should always
 * mean "more positive than that" and ▼ "more negative". An arbitrary order would
 * make the control feel random.
 */
export const BASIC_EMOTION_ORDER: readonly BasicEmotion[] = [
  'happiness',
  'surprise',
  'fear',
  'disgust',
  'anger',
  'sadness',
] as const;

export const BASIC_EMOTION_LABEL: Record<BasicEmotion, string> = {
  happiness: '행복',
  surprise: '놀람',
  fear: '공포',
  disgust: '혐오',
  anger: '분노',
  sadness: '슬픔',
};

export const BASIC_EMOTION_EMOJI: Record<BasicEmotion, string> = {
  happiness: '😊',
  surprise: '😮',
  fear: '😨',
  disgust: '😣',
  anger: '😡',
  sadness: '😢',
};

/**
 * Valence per basic emotion, reused by the flow analysis so a corrected item
 * changes the drawn shape the same way an originally-detected one would.
 */
export const BASIC_EMOTION_VALENCE: Record<BasicEmotion, number> = {
  happiness: 1,
  surprise: 0.1,
  fear: -0.5,
  disgust: -0.6,
  anger: -0.7,
  sadness: -0.75,
};

/**
 * Every legacy `EmotionGroup` collapsed onto a basic emotion.
 *
 * Exhaustive by type, so adding an `EmotionGroup` without deciding its basic
 * emotion is a compile error rather than a silent `undefined` at runtime.
 */
export const BASIC_BY_GROUP: Record<EmotionGroup, BasicEmotion> = {
  joy: 'happiness',
  excitement: 'happiness',
  love: 'happiness',
  calm: 'happiness',
  surprise: 'surprise',
  neutral: 'surprise',
  uncertain: 'fear',
  fear: 'fear',
  concern: 'fear',
  longing: 'sadness',
  sadness: 'sadness',
  envy: 'sadness',
  fatigue: 'sadness',
  guilt: 'sadness',
  shame: 'disgust',
  disgust: 'disgust',
  anger: 'anger',
  frustration: 'anger',
  jealousy: 'anger',
};

/** The `EmotionGroup` written alongside a basic emotion, for backward reads. */
export const GROUP_BY_BASIC: Record<BasicEmotion, EmotionGroup> = {
  happiness: 'joy',
  surprise: 'surprise',
  fear: 'fear',
  disgust: 'disgust',
  anger: 'anger',
  sadness: 'sadness',
};

export function isBasicEmotion(value: unknown): value is BasicEmotion {
  return typeof value === 'string' && (BASIC_EMOTION_ORDER as readonly string[]).includes(value);
}

/**
 * The basic emotion of an item, whether it was written by the new pipeline or
 * read back from a record stored before this existed.
 */
export function basicEmotionOf(item: Pick<EmotionFlowItem, 'group' | 'basic'>): BasicEmotion {
  if (isBasicEmotion(item.basic)) return item.basic;
  return BASIC_BY_GROUP[item.group] ?? 'surprise';
}

export function basicEmotionLabelOf(item: Pick<EmotionFlowItem, 'group' | 'basic'>): string {
  return BASIC_EMOTION_LABEL[basicEmotionOf(item)];
}

/**
 * Step the wheel. `direction` is -1 for ▲ (more positive) and +1 for ▼.
 *
 * Clamped rather than wrapped: wrapping from 슬픔 straight back to 행복 reads as a
 * glitch on a six-item list, and clamping makes the ends discoverable.
 */
export function stepBasicEmotion(current: BasicEmotion, direction: -1 | 1): BasicEmotion {
  const index = BASIC_EMOTION_ORDER.indexOf(current);
  const next = Math.min(BASIC_EMOTION_ORDER.length - 1, Math.max(0, index + direction));
  return BASIC_EMOTION_ORDER[next];
}

/**
 * Rewrite an item onto a basic emotion the user picked.
 *
 * `group` and `displayLabel` are rewritten too, so every existing reader --
 * the analysis valence table, the partner's summary, the record detail card --
 * agrees with the correction without needing to know this feature exists.
 * `userEdited` records that a human overrode the machine, which is what makes the
 * correction durable instead of something the next re-analysis would undo.
 */
export function applyBasicEmotion(
  item: EmotionFlowItem,
  basic: BasicEmotion,
): EmotionFlowItem {
  return {
    ...item,
    basic,
    group: GROUP_BY_BASIC[basic],
    displayLabel: BASIC_EMOTION_LABEL[basic],
    userEdited: true,
  };
}
