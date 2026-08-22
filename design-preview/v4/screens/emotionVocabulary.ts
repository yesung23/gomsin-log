/**
 * 감정 어휘와 순서 — 상수만.
 *
 * `PenEmotion.tsx`에서 분리한 이유는 이 저장소가 `registry.ts`를 분리한 이유와 같다.
 * 컴포넌트와 값을 함께 내보내는 모듈은 `react-refresh/only-export-components`에 걸리고,
 * `npm run lint`가 `--max-warnings 0`으로 돈다. 이 파일은 컴포넌트를 선언하지 않으므로
 * 값을 내보내도 깨끗하다.
 */

export type BasicEmotion = 'happiness' | 'surprise' | 'fear' | 'disgust' | 'anger' | 'sadness';

/** 밝은 쪽부터. 고를 때 순서가 임의로 보이면 안 된다. */
export const EMOTION_ORDER: readonly BasicEmotion[] = [
  'happiness', 'surprise', 'fear', 'disgust', 'anger', 'sadness',
];

/**
 * 라벨은 일상어다.
 *
 * 앱의 `BASIC_EMOTION_LABEL`은 `행복·놀람·공포·혐오·분노·슬픔`이다. 에크만식 분류로는
 * 정확하지만 **커플 일기에 `혐오`와 `공포`는 세다.** "오늘 어땠어?"에 혐오를 고르는
 * 사람은 없고, 있다면 그건 앱이 시킨 말이다.
 *
 * 이 앱은 상대에게 하루를 전하는 곳이지 감정을 분류하는 곳이 아니다. 그래서 분류명이
 * 아니라 **실제로 쓰는 말**을 쓴다 -- `별로였어`가 `혐오`보다 사람이 하는 말이다.
 *
 * 키는 그대로 둔다. 감정 엔진·색 토큰·흐름 분석이 전부 이 키를 쓰므로, 바뀌는 것은
 * 사람에게 보이는 문자열뿐이다.
 *
 * **앱에도 같은 변경이 필요하다.** `src/lib/basicEmotions.ts`의 `BASIC_EMOTION_LABEL`을
 * 바꿔야 하고, 흐름 서술(`속상했어 → 좋았어`)과 감정 엔진 테스트가 함께 움직인다.
 */
export const EMOTION_LABEL: Record<BasicEmotion, string> = {
  happiness: '좋았어',
  surprise: '놀랐어',
  fear: '걱정됐어',
  disgust: '별로였어',
  anger: '화났어',
  sadness: '속상했어',
};
