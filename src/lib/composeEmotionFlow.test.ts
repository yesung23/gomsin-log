import { describe, it, expect } from 'vitest';
import { buildEmotionFlow } from '@/lib/composeEmotionFlow';
import type { BasicEmotion } from '@/types';

/**
 * `PRODUCT_V3` §13.1 이 남긴 네 보장 중 셋째 -- **감정의 공개 범위는 기록의 공개
 * 범위를 넘지 못한다** -- 를 실제로 실행해서 확인한다.
 *
 * §13.1은 "제안 하나하나에 확인" 을 "저장하는 순간 화면이 말하고 있었다" 로 바꿨다.
 * 그 교환이 성립하는 근거 하나가 감정 전용 공개 스위치를 없앤 것이므로, 감정이
 * 기록보다 넓게 나가는 경로가 하나라도 생기면 개정의 전제가 무너진다.
 */
const NOW = new Date('2026-08-23T09:30:00.000Z');
const MOOD: BasicEmotion[] = ['anger', 'happiness'];

describe('감정 흐름은 기록의 공개 범위를 넘지 못한다', () => {
  it('나만 보기 기록의 감정은 작성자만 본다', () => {
    const flow = buildEmotionFlow({ mood: MOOD, now: NOW, isPrivate: true });
    expect(flow).toHaveLength(2);
    for (const item of flow) expect(item.visibility).toBe('author_only');
  });

  it('공유 기록의 감정은 함께 본다', () => {
    const flow = buildEmotionFlow({ mood: MOOD, now: NOW, isPrivate: false });
    for (const item of flow) expect(item.visibility).toBe('shared');
  });

  /*
    공개 범위 말고는 아무것도 감정의 노출을 바꾸지 못한다.

    이 단언이 없으면 "특정 감정만 늘 비공개" 같은 예외가 조용히 들어와도 위의 두
    테스트는 초록으로 남는다 -- 그것이 곧 감정만 따로 공개 범위를 갖는 상태다.
  */
  it('여섯 중 어느 것도 자기만의 공개 규칙을 갖지 않는다', () => {
    const all: BasicEmotion[] = ['happiness', 'surprise', 'fear', 'disgust', 'anger', 'sadness'];
    const shared = buildEmotionFlow({ mood: all, now: NOW, isPrivate: false });
    const privateFlow = buildEmotionFlow({ mood: all, now: NOW, isPrivate: true });
    expect(new Set(shared.map((item) => item.visibility))).toEqual(new Set(['shared']));
    expect(new Set(privateFlow.map((item) => item.visibility))).toEqual(new Set(['author_only']));
  });
});

describe('저장되는 것은 화면에 눌려 있던 것뿐이다', () => {
  it('눌리지 않은 감정은 흐름에 없다', () => {
    const flow = buildEmotionFlow({ mood: ['sadness'], now: NOW, isPrivate: false });
    expect(flow.map((item) => item.basic)).toEqual(['sadness']);
  });

  it('아무것도 누르지 않으면 감정도 없다', () => {
    expect(buildEmotionFlow({ mood: [], now: NOW, isPrivate: false })).toEqual([]);
  });

  it('고른 순서가 이야기의 순서다', () => {
    const flow = buildEmotionFlow({ mood: ['anger', 'happiness'], now: NOW, isPrivate: false });
    expect(flow.map((item) => item.sequence)).toEqual([1, 2]);
    expect(flow.map((item) => item.displayLabel)).toEqual(['화났어', '기뻤어']);
  });

  /*
    전부 `user_confirmed` 다. §13.1이 인정하는 작성자의 행위는 "눌린 채로 보이는 것을
    두고 남기기를 누른 것" 이므로, 저장에 닿은 감정 중 기계의 미확인 추론으로 남는
    것은 없다 -- 파트너에게 가는 것은 §13이 그대로 금지한다.
  */
  it('저장에 닿은 감정 중 미확인 추론은 없다', () => {
    const flow = buildEmotionFlow({ mood: MOOD, now: NOW, isPrivate: false });
    expect(new Set(flow.map((item) => item.source))).toEqual(new Set(['user_confirmed']));
  });
});
