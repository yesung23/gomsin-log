import { describe, it, expect } from 'vitest';
import type { StoryCard } from '@/features/story/storyProjection';
import { applyRefinedCoverText } from '@/lib/dailySummary/rules';

/**
 * 대체는 텍스트에만 닿는다.
 *
 * 이 함수가 지키는 것은 세 가지다: 줄의 **개수**, 줄의 **순서**, 줄의 **`recordId`**. 세 개가
 * 유지되면 다듬어진 문장이 다른 기록을 가리킬 수 없고, 정확한 원본 이동은 이 기능과 무관해진다.
 */

function cover(): Extract<StoryCard, { kind: 'cover' }> {
  return {
    kind: 'cover',
    rangeLabel: '오늘',
    lines: [
      { recordId: 'a', text: '오늘 시험 끝났어', time: '09:00', date: '2026-08-22' },
      { recordId: 'b', text: '점심 먹었어', time: '13:00', date: '2026-08-22' },
      { recordId: 'c', text: '사진을 남겼어요', time: '18:00', date: '2026-08-22' },
    ],
  };
}

const moment = (id: string): StoryCard => ({
  kind: 'moment',
  record: {
    id, date: '2026-08-22', time: '09:00', authorRole: 'gomsin',
    log: '원본 본문', isPrivate: false, createdAt: '2026-08-22T00:00:00.000Z',
  },
});

describe('applyRefinedCoverText', () => {
  it('짝이 되는 recordId의 텍스트만 바꾼다', () => {
    const cards: StoryCard[] = [cover(), moment('a')];
    const result = applyRefinedCoverText(cards, new Map([['b', '점심을 먹었어요']]));
    const refined = result[0];
    expect(refined.kind).toBe('cover');
    if (refined.kind !== 'cover') return;
    expect(refined.lines.map((line) => line.text))
      .toEqual(['오늘 시험 끝났어', '점심을 먹었어요', '사진을 남겼어요']);
  });

  it('개수·순서·recordId·시각·날짜를 바꾸지 않는다', () => {
    const before = cover();
    const result = applyRefinedCoverText([before], new Map([
      ['a', 'A'], ['b', 'B'], ['c', 'C'],
    ]));
    const after = result[0];
    expect(after.kind).toBe('cover');
    if (after.kind !== 'cover') return;
    expect(after.lines).toHaveLength(before.lines.length);
    expect(after.lines.map((l) => l.recordId)).toEqual(['a', 'b', 'c']);
    expect(after.lines.map((l) => l.time)).toEqual(['09:00', '13:00', '18:00']);
    expect(after.lines.map((l) => l.date)).toEqual(before.lines.map((l) => l.date));
    expect(after.rangeLabel).toBe('오늘');
  });

  it('지도에 없는 recordId를 줄로 추가하지 않는다', () => {
    const result = applyRefinedCoverText([cover()], new Map([['없는-기록', '지어낸 줄']]));
    const after = result[0];
    if (after.kind !== 'cover') throw new Error('cover expected');
    expect(after.lines).toHaveLength(3);
    expect(JSON.stringify(after.lines)).not.toContain('지어낸 줄');
  });

  it('순간 카드의 원본 본문에는 손대지 않는다', () => {
    // 원본을 모델 출력으로 바꾸는 것은 §4.2가 금지한 대체다.
    const cards: StoryCard[] = [cover(), moment('a'), moment('b')];
    const result = applyRefinedCoverText(cards, new Map([['a', '다듬은 문장'], ['b', '다듬은 문장']]));
    for (const card of result.slice(1)) {
      expect(card.kind).toBe('moment');
      if (card.kind !== 'moment') continue;
      expect(card.record.log).toBe('원본 본문');
    }
  });

  it('부재·닫는 카드를 그대로 지나간다', () => {
    const cards: StoryCard[] = [
      { kind: 'missing', recordId: 'gone' },
      cover(),
      { kind: 'closing', momentCount: 3, unreadableCount: 1 },
    ];
    const result = applyRefinedCoverText(cards, new Map([['a', 'A']]));
    expect(result[0]).toEqual({ kind: 'missing', recordId: 'gone' });
    expect(result[2]).toEqual({ kind: 'closing', momentCount: 3, unreadableCount: 1 });
  });

  it('빈 지도면 같은 배열을 그대로 돌려준다', () => {
    const cards: StoryCard[] = [cover()];
    expect(applyRefinedCoverText(cards, new Map())).toBe(cards);
  });
});
