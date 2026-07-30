import { describe, expect, it } from 'vitest';
import { recommendEmotionFlow } from '../emotionRuleEngine';

describe('emotionRuleEngine', () => {
  it('recommends happiness for an explicit happy expression', () => {
    const result = recommendEmotionFlow('오늘 진짜 행복했어');
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: 'joy', displayLabel: '행복' }),
      ])
    );
  });

  it('keeps a complex emotional flow in order and caps it at three items', () => {
    const result = recommendEmotionFlow(
      '알바에서 진상 손님을 만나 속상했는데, 친구와 치킨 먹고 기분이 나아졌어. 우리가 함께 왔던 곳이라 네 생각이 났어'
    );

    expect(result).toHaveLength(3);
    expect(result[0]?.displayLabel).toBe('속상함');
    expect(result[1]?.group).toBe('joy');
    expect(result[2]?.displayLabel).toBe('그리움');
  });

  it.each([
    '오늘 하나도 안 행복해',
    '오늘 기분이 별로 안 좋았어',
  ])('does not recommend joy for negated text: %s', (text) => {
    const result = recommendEmotionFlow(text);
    expect(result.some((item) => item.group === 'joy')).toBe(false);
  });

  it('recommends longing for a missing-you expression', () => {
    const result = recommendEmotionFlow('너 너무 보고 싶어');
    expect(result.some((item) => ['보고싶음', '그리움'].includes(item.displayLabel))).toBe(true);
  });

  it('does not leak profanity or prohibited labels', () => {
    const profanityResult = recommendEmotionFlow('오늘 알바에서 시발 개짜증났어');
    const prohibitedResult = recommendEmotionFlow('오늘 집착나고 복수심이 생길 정도로 싫었어');

    expect(profanityResult.some((item) => /(?:시발|씨발|개짜증)/.test(item.displayLabel))).toBe(false);
    expect(
      prohibitedResult.some((item) => ['집착', '복수심', '증오', '악의'].includes(item.displayLabel))
    ).toBe(false);
  });

  it('returns no candidates for meaningless facts', () => {
    expect(recommendEmotionFlow('12345 67890')).toEqual([]);
  });

  it('merges consecutive matches from the same emotion group', () => {
    expect(recommendEmotionFlow('오늘 기분 좋고 행복하고 신나고 즐거웠어')).toHaveLength(1);
  });
});
