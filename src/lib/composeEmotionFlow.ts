import { BASIC_EMOTION_LABEL, GROUP_BY_BASIC } from '@/lib/basicEmotions';
import type { BasicEmotion, EmotionFlowItem } from '@/types';

/**
 * 화면에 눌려 있는 여섯 칸을 저장될 감정 흐름으로 바꾼다.
 *
 * ## 왜 컴포저 밖으로 꺼냈는가
 *
 * 이것은 `PRODUCT_V3` §13.1이 "감정만 따로 더 넓게 공개되는 경로는 없다"고 못박은
 * 규칙의 **실행부**다. 컴포저 안의 인라인 삼항으로 두면 그 규칙을 실제로 실행해 보는
 * 테스트를 쓸 수 없다 -- 화면을 그리려면 스토어 전체가 필요하고, 그래서 남는 선택지는
 * 소스 문자열을 뒤지는 테스트뿐인데 그런 테스트는 **버그가 있는 내내 초록이다가
 * 고치는 순간 깨진다.**
 *
 * 이름이 붙은 순수 함수면 규칙이 규칙으로 남고, 어기면 테스트가 먼저 반대한다.
 *
 * ## 규칙 셋
 *
 * 1. 들어온 순서가 곧 `sequence` 다. 화면에서 고른 순서가 이야기의 순서다.
 * 2. 전부 `user_confirmed` 다 -- 눌린 채로 보이는 것을 두고 `남기기` 를 누르는 것이
 *    §13.1이 인정하는 작성자의 행위이기 때문이다.
 * 3. **공개 범위는 기록을 따른다.** 한때 `상대에게도 이 마음 보여주기` 스위치가 따로
 *    있었고 기본이 꺼짐이었다. 없앤 이유는 그것이 답할 수 없는 질문이기 때문이다 --
 *    글은 보여주면서 그 글에서 읽은 마음만 숨기는 상태가 무엇을 뜻하는지 사용자도
 *    상대도 알 수 없다. `나만 보기` 면 둘 다 나만 보고, `우리에게 공유` 면 둘 다
 *    함께 본다. 감정이 기록보다 넓게 공개되는 경로는 여기에 없다.
 */
export function buildEmotionFlow({
  mood,
  now,
  isPrivate,
}: {
  /** 화면에서 눌려 있는 감정. 눌리지 않은 것은 여기 없고, 그래서 저장되지 않는다. */
  mood: readonly BasicEmotion[];
  now: Date;
  /** 기록 자체의 공개 범위. 감정의 상한이다. */
  isPrivate: boolean;
}): EmotionFlowItem[] {
  return mood.map((basic, index) => ({
    id: `mood-${now.getTime()}-${index}`,
    sequence: index + 1,
    group: GROUP_BY_BASIC[basic],
    basic,
    displayLabel: BASIC_EMOTION_LABEL[basic],
    source: 'user_confirmed' as const,
    visibility: isPrivate ? ('author_only' as const) : ('shared' as const),
    userEdited: true,
  }));
}
