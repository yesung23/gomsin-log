import type { DailyRecord } from '@/types';
import { momentSummaryText, type StoryCard } from '@/features/story/storyProjection';
import type { DailySummaryLine } from '@/lib/dailySummary/contract';

/**
 * 규칙만으로 만든 요약. **동기적이고, 항상 존재한다.**
 *
 * 텍스트를 여기서 새로 정의하지 않고 `momentSummaryText`를 그대로 부른다. 이 기능의 핵심
 * 계약이 "모델이 실패하면 화면은 규칙 결과 그대로"이므로, fallback 문장이 `projectStory`가
 * 만드는 문장과 **글자 단위로 같아야** 한다. 같은 규칙을 두 번 적으면 한쪽만 바뀌는 날이 오고,
 * 그때 fallback은 조용히 다른 화면이 된다.
 *
 * (`src/lib` → `src/features` 방향의 import는 이 저장소에서 흔하지 않다. 순수 함수 하나이고
 * 순환이 없으며, 중복 정의보다 이 결합이 안전하다고 판단해 의도적으로 남긴다.)
 */
export function deterministicSummaryLines(
  records: readonly DailyRecord[],
): DailySummaryLine[] {
  return records.map((record) => ({
    recordId: record.id,
    text: momentSummaryText(record),
    time: record.time,
    date: record.date,
  }));
}

/**
 * 다듬어진 문장을 속표지에 **텍스트만** 갈아 끼운다.
 *
 * 이 함수의 모양 자체가 계약이다. `card.lines.map`은 줄을 추가·삭제·재배열할 수 없고,
 * `recordId`·`time`·`date`를 손대지 않으므로 다듬어진 문장이 다른 기록을 가리키게 될 방법이
 * 없다. 짝이 되는 `recordId`가 없는 줄은 규칙 문장을 그대로 유지한다.
 *
 * 표지가 아닌 카드는 그대로 지나간다. 순간 카드는 사용자가 쓴 원문을 보여 주는 자리이고,
 * 거기에 모델 출력을 넣는 것은 원본을 대체하는 것이다 -- §4.2가 금지한 바로 그 실패다.
 */
export function applyRefinedCoverText(
  cards: StoryCard[],
  refinedByRecordId: ReadonlyMap<string, string>,
): StoryCard[] {
  if (refinedByRecordId.size === 0) return cards;
  return cards.map((card) => {
    if (card.kind !== 'cover') return card;
    return {
      ...card,
      lines: card.lines.map((line) => {
        const refined = refinedByRecordId.get(line.recordId);
        return refined ? { ...line, text: refined } : line;
      }),
    };
  });
}
