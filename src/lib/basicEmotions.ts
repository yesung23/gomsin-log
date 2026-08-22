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

/**
 * 사람이 쓰는 말로 (2026-08-22).
 *
 * 앞선 어휘는 `행복 · 놀람 · 공포 · 혐오 · 분노 · 슬픔` 이었다. 그것은 정서 연구의
 * 분류명이지 일기에 쓰는 말이 아니다. **`공포`나 `혐오`를 골라 자기 하루를 설명하는
 * 사람은 없다** -- 걱정됐고 별로였을 뿐이다. 고를 수 없는 어휘는 고르지 않게 되고,
 * 고르지 않으면 이 기능은 없는 것과 같다.
 *
 * `happiness` 만 `좋았어` 가 아니라 `기뻤어` 다. 컴포저에는 작성자가 직접 다는 태그
 * (`좋았어 · 이런 일이 · 힘들었어 · 네 생각났어`)가 같은 화면에 있고, 그중 첫 칸이 이미
 * `좋았어` 다. 한 화면에서 두 컨트롤이 같은 말을 쓰면 사용자는 둘이 같은 것인지 배워야
 * 한다 -- 하나는 자기가 다는 표식이고 다른 하나는 앱이 글에서 읽은 것이므로 같지 않다.
 *
 * `BasicEmotion` 키는 그대로다. 분류 자체는 맞았고 바꾼 것은 **부르는 말**뿐이므로,
 * 저장된 값도 원자가 표도 마이그레이션이 필요 없다.
 *
 * 이미 저장된 기록은 `displayLabel` 에 옛 말을 들고 있다. 그래서 화면은 그 문자열이
 * 아니라 `basicEmotionLabelOf()` 로 **감정에서 다시 읽는다** -- 지도만 바꾸고 저장된
 * 문자열을 그대로 그리면 옛 기록만 옛 말로 남아 한 화면에 두 어휘가 섞인다.
 */
export const BASIC_EMOTION_LABEL: Record<BasicEmotion, string> = {
  happiness: '기뻤어',
  surprise: '놀랐어',
  fear: '걱정됐어',
  disgust: '별로였어',
  anger: '화났어',
  sadness: '속상했어',
};

/*
 * `BASIC_EMOTION_EMOJI` used to live here and is deliberately gone.
 *
 * A system emoji is drawn by the OS, so 😣 was a different creature on an iPhone
 * than on a Galaxy -- which made the surfaces where two people look at the SAME
 * feeling the surfaces where they saw different pictures of it. Every emotion is
 * now drawn by `components/emotion/EmotionCharacter.tsx`, which ships with the
 * app and therefore looks the same on both phones.
 */

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
