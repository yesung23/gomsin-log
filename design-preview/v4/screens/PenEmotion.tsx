import type { ReactElement } from 'react';
import { type BasicEmotion } from './emotionVocabulary';

/**
 * 여섯 감정 — 공책에 펜으로 그린 판.
 *
 * ## 왜 새로 그리는가
 *
 * 앱의 `components/emotion/EmotionCharacter.tsx`가 이미 여섯을 그리고 있고 그 판단은
 * 그대로 유효하다 -- 이모지를 쓰지 않는 이유(OS 마다 다른 그림이 그려져서, 두 사람이
 * **같은 감정**을 볼 때 서로 다른 것을 본다), 실루엣이 1차 신호라는 것, 아무것도
 * 움직이지 않는다는 것. 여기서 다시 그리는 것은 **재질** 하나뿐이다: 채운 씨앗이
 * 아니라 펜으로 그린 선.
 *
 * ## 인사이드 아웃을 베끼지 않는다
 *
 * 빌려온 원칙은 하나뿐이다 -- 감정 하나에 생명체 하나, 한눈에 읽힐 것. 그 이상은 아니다.
 * 잘 알려진 그 배역은 사람 형태에 팔다리가 있고 거의 전적으로 팔레트로 구별되는데,
 * 형태든 팔레트든 가져오면 남의 것으로 읽힌다.
 *
 * 그래서 여기서도 **실루엣이 먼저**다. 여섯이 색 없이도 서로 다른 모양이고 -- 둥근 것,
 * 긴 것, 뾰족한 것, 납작한 것, 각진 것, 무거운 것 -- 흑백에서도 구별된다. 대부분의
 * 시간 동안 대부분이 선택되지 않은 상태이므로 그 상태가 기준이다.
 *
 * ## 아무것도 움직이지 않는다
 *
 * 일기 아래에서 여섯이 숨쉬고 있으면 일기와 경쟁한다. 그리고 계속되는 움직임은
 * `prefers-reduced-motion`이 막으려는 바로 그 패턴이다.
 */

/** 앱의 감정 토큰. 새 색을 만들지 않는다. */
const EMOTION_COLOR: Record<BasicEmotion, string> = {
  happiness: 'var(--color-emotion-happiness)',
  surprise: 'var(--color-emotion-surprise)',
  fear: 'var(--color-emotion-fear)',
  disgust: 'var(--color-emotion-disgust)',
  anger: 'var(--color-emotion-anger)',
  sadness: 'var(--color-emotion-sadness)',
};

/**
 * 몸.
 *
 * 여섯이 서로 다른 실루엣이다. 색을 빼고 봐도 구별되는 것이 조건이다.
 */
const BODY: Record<BasicEmotion, string> = {
  // 둥글다. 가장 넓고 안정적이다.
  happiness: 'M20 6 C31 6 34 15 34 21 C34 29 28 34 20 34 C12 34 6 29 6 21 C6 15 9 6 20 6 Z',
  // 길다. 위로 솟구친다.
  surprise: 'M20 4 C27 4 31 12 31 22 C31 30 26 35 20 35 C14 35 9 30 9 22 C9 12 13 4 20 4 Z',
  // 뾰족하다. 위가 좁고 아래가 넓어 움츠린 모양이다.
  fear: 'M20 5 C24 5 27 13 30 24 C32 31 27 35 20 35 C13 35 8 31 10 24 C13 13 16 5 20 5 Z',
  // 납작하다. 옆으로 퍼져 삐딱하다.
  disgust: 'M20 9 C30 9 36 14 36 21 C36 28 29 33 20 33 C11 33 4 28 4 21 C4 14 10 9 20 9 Z',
  // 각지다. 유일하게 모서리가 있다.
  anger: 'M8 9 L32 7 C34 7 35 9 35 12 L34 30 C34 33 32 35 29 35 L11 34 C8 34 6 32 6 29 L6 12 C6 10 6 9 8 9 Z',
  // 무겁다. 아래로 처진다.
  sadness: 'M20 7 C28 7 33 13 33 20 C33 30 27 36 20 36 C13 36 7 30 7 20 C7 13 12 7 20 7 Z',
};

/** 얼굴. 눈과 입만으로 여섯을 가른다. */
function face(emotion: BasicEmotion): ReactElement {
  const ink = 'var(--ink)';
  const eye = (cx: number, cy: number, r = 1.5) => (
    <circle cx={cx} cy={cy} r={r} fill={ink} />
  );
  switch (emotion) {
    case 'happiness':
      return (
        <>
          <path d="M14 17 Q16 14 18 17" stroke={ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M22 17 Q24 14 26 17" stroke={ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M15 24 Q20 29 25 24" stroke={ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </>
      );
    case 'surprise':
      return (
        <>
          {eye(16, 18, 2.2)}
          {eye(24, 18, 2.2)}
          <ellipse cx="20" cy="26" rx="2.6" ry="3.4" stroke={ink} strokeWidth="1.5" fill="none" />
        </>
      );
    case 'fear':
      return (
        <>
          {eye(16, 19, 1.9)}
          {eye(24, 19, 1.9)}
          <path d="M16 27 Q18 25 20 27 Q22 29 24 27" stroke={ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </>
      );
    case 'disgust':
      return (
        <>
          <path d="M13 18 L18 20" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M27 18 L22 20" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M15 26 Q20 24 25 27" stroke={ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </>
      );
    case 'anger':
      return (
        <>
          <path d="M12 16 L18 19" stroke={ink} strokeWidth="1.7" strokeLinecap="round" />
          <path d="M29 16 L23 19" stroke={ink} strokeWidth="1.7" strokeLinecap="round" />
          {eye(16, 22, 1.4)}
          {eye(25, 22, 1.4)}
          <path d="M15 28 L26 28" stroke={ink} strokeWidth="1.7" strokeLinecap="round" />
        </>
      );
    case 'sadness':
      return (
        <>
          <path d="M13 18 Q16 21 19 18" stroke={ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M22 18 Q25 21 28 18" stroke={ink} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M16 29 Q20 25 25 29" stroke={ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          {/* 눈물 한 방울. 슬픔에만 있는 표식이라 흑백에서도 갈린다. */}
          <path d="M28 21 Q29.5 24 28 25.5 Q26.5 24 28 21 Z" fill={ink} opacity="0.55" />
        </>
      );
  }
}

export function PenEmotion({
  emotion,
  selected = false,
  size = 40,
}: {
  emotion: BasicEmotion;
  selected?: boolean;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" fill="none">
      <path
        d={BODY[emotion]}
        /*
          고르지 않은 상태에서는 색이 없다. 여섯이 색으로 구별된다면 흑백에서 무너지고,
          대부분의 시간 동안 대부분이 고르지 않은 상태다. 색은 두 번째 신호다.
        */
        fill={selected ? EMOTION_COLOR[emotion] : 'transparent'}
        stroke="var(--ink)"
        strokeWidth={selected ? 1.8 : 1.4}
        strokeLinejoin="round"
      />
      {face(emotion)}
    </svg>
  );
}
