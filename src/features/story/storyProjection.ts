import type { DailyRecord } from '@/types';
import { isRecordContentAvailable } from '@/lib/recordAvailability';

/**
 * 스토리 한 장이 무엇인가.
 *
 * ## 카드는 언제나 `recordId`로 지정된다
 *
 * 인덱스로 지정하면 기록 하나가 삭제됐을 때 옆 기록이 열린다. 그것은 PRODUCT_V3 §4.2가
 * "근사치·날짜 점프·비슷한 기록은 계약 위반"이라고 못 박은 바로 그 실패다. 인덱스는
 * `3 / 6` 같은 표시에만 쓰고, 대상 지정에는 절대 쓰지 않는다.
 *
 * ## 데이터를 새로 만들지 않는다
 *
 * 여기서 하는 일은 투영뿐이다. 누가 무엇을 볼 수 있는지는 `visibleRecordsForViewer`가
 * 이미 판정했고, 놓친 구간이 어디부터인지는 `projectPartnerDay`가 이미 정했다. 권한
 * 판정을 여기서 한 번 더 하면 두 곳이 어긋나는 날이 온다.
 */

export type StoryCard =
  | {
      kind: 'cover';
      /** 속표지에 얹는 요약 줄. 각 줄은 자기가 가리키는 원본의 id를 갖는다. */
      lines: { recordId: string; text: string; time: string; date: string }[];
      /** `8/20 – 8/22` 또는 `오늘`. 사실만 적는다. */
      rangeLabel: string;
    }
  | { kind: 'moment'; record: DailyRecord }
  | {
      kind: 'missing';
      /** 요청받았지만 더 이상 볼 수 없는 원본. 대체하지 않는다. */
      recordId: string;
    }
  | {
      kind: 'closing';
      /** 이 스토리가 담은 순간 수. 표시용이며 대상 지정에 쓰이지 않는다. */
      momentCount: number;
      /** 열 수 없었던 기록 수. 권한이 아니라 기기 상태의 문제이므로 개수는 말해도 된다. */
      unreadableCount: number;
    };

export interface StoryProjection {
  cards: StoryCard[];
  /** 진입 시 열릴 카드의 인덱스. `?at=` 대상이 없으면 부재 카드를 가리킨다. */
  initialIndex: number;
}

/** `2026-08-20` → `8/20` */
function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/**
 * 구간을 사실대로 적는다.
 *
 * 하루면 그 하루를, 여러 날이면 처음과 끝을 적는다. "3일치가 밀렸어요" 같은 부채 표현을
 * 쓰지 않는다 -- 개수는 부채이고 날짜는 사실이다(PRODUCT_V3 §14.3의 같은 원칙).
 */
export function storyRangeLabel(records: DailyRecord[], todayStr: string): string {
  if (records.length === 0) return '';
  const dates = [...new Set(records.map((record) => record.date))].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === last) return first === todayStr ? '오늘' : shortDate(first);
  return `${shortDate(first)} – ${shortDate(last)}`;
}

/**
 * 본문이 없는 기록을 무엇이라고 부를 것인가.
 *
 * 첨부 종류를 사실대로 말한다. 앱이 이야기를 지어내지 않는다(PRODUCT_V3 §6.2).
 */
export function momentSummaryText(record: DailyRecord): string {
  const body = (record.log ?? '').replace(/\s+/g, ' ').trim();
  if (body) return body.length <= 40 ? body : `${body.slice(0, 39).trimEnd()}…`;
  const kinds = new Set((record.attachments ?? []).map((attachment) => attachment.type));
  if (kinds.has('photo')) return '사진을 남겼어요';
  if (kinds.has('voice')) return '목소리를 남겼어요';
  if (kinds.has('video')) return '영상을 남겼어요';
  return '순간을 남겼어요';
}

/**
 * 읽을 수 있는 기록만 카드가 된다.
 *
 * 복호화하지 못한 기록은 카드를 만들지 않고 닫는 카드에서 **개수만** 말한다. 권한이 막은
 * 기록은 애초에 여기까지 오지 않으므로 셀 개수 자체가 없고, 여기 남은 것은 전부 기기
 * 상태의 문제다 -- 그래서 개수를 말해도 상대에 대해 아무것도 알리지 않는다(§6.4).
 */
export function projectStory({
  records,
  todayStr,
  focusRecordId,
  withCover,
}: {
  /** 이미 권한 판정을 통과한 기록. 시간순(오래된 것부터). */
  records: DailyRecord[];
  todayStr: string;
  /** `?at=`으로 요청된 원본. */
  focusRecordId?: string;
  /** 순간이 2개 이상일 때만 속표지를 붙인다. 하나뿐이면 목차가 목차 노릇을 못 한다. */
  withCover: boolean;
}): StoryProjection {
  const readable = records.filter(isRecordContentAvailable);
  const unreadableCount = records.length - readable.length;

  const cards: StoryCard[] = [];

  if (withCover && readable.length > 1) {
    cards.push({
      kind: 'cover',
      rangeLabel: storyRangeLabel(readable, todayStr),
      // 최대 5줄. §6.2 "한 줄은 한 사건, 최대 5줄".
      lines: readable.slice(0, 5).map((record) => ({
        recordId: record.id,
        text: momentSummaryText(record),
        time: record.time,
        date: record.date,
      })),
    });
  }

  for (const record of readable) cards.push({ kind: 'moment', record });

  /*
    요청받은 원본이 이 스토리에 없다.

    삭제됐거나 비공개로 바뀌었거나 이 뷰어의 구간 밖이다. 어느 쪽이든 **다른 기록으로
    대체하지 않는다.** 부재 카드를 만들어 그 자리에서 사실대로 말하고, 나머지 순간은
    그대로 남긴다 -- 하나가 사라졌다고 나머지를 못 보게 하는 것도 대체만큼 나쁘다.
  */
  const focusIndex = focusRecordId
    ? cards.findIndex((card) => card.kind === 'moment' && card.record.id === focusRecordId)
    : -1;

  if (focusRecordId && focusIndex === -1) {
    cards.unshift({ kind: 'missing', recordId: focusRecordId });
  }

  if (readable.length > 0 || unreadableCount > 0) {
    cards.push({ kind: 'closing', momentCount: readable.length, unreadableCount });
  }

  const initialIndex = focusRecordId
    ? (focusIndex === -1
      ? 0
      : cards.findIndex((card) => card.kind === 'moment' && card.record.id === focusRecordId))
    : 0;

  return { cards, initialIndex: Math.max(initialIndex, 0) };
}
