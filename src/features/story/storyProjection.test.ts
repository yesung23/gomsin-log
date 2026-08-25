import { describe, it, expect } from 'vitest';
import { projectStory, storyRangeLabel, momentSummaryText } from '@/features/story/storyProjection';
import { buildOnDeviceItems } from '@/lib/dailySummary/contract';
import { deterministicSummaryLines } from '@/lib/dailySummary/rules';
import type { DailyRecord } from '@/types';

const TODAY = '2026-08-22';

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1', userId: 'partner', date: TODAY, time: '09:00',
    authorRole: 'gomsin', log: '오늘 시험 끝났어', isPrivate: false, ...over,
  } as DailyRecord;
}

describe('스토리는 정확한 원본만 연다', () => {
  it('요청한 원본이 첫 화면이 된다', () => {
    const records = [record({ id: 'a' }), record({ id: 'b', time: '13:00' }), record({ id: 'c', time: '18:00' })];
    const { cards, initialIndex } = projectStory({ records, todayStr: TODAY, focusRecordId: 'b', withCover: true });
    const card = cards[initialIndex];
    expect(card.kind).toBe('moment');
    expect(card.kind === 'moment' && card.record.id).toBe('b');
  });

  it('요청한 원본이 없으면 부재 카드를 그리고 대체하지 않는다', () => {
    // §4.2: 근사치·날짜 점프·비슷한 기록은 계약 위반이다.
    const records = [record({ id: 'a' }), record({ id: 'c', time: '18:00' })];
    const { cards, initialIndex } = projectStory({ records, todayStr: TODAY, focusRecordId: 'gone', withCover: true });
    expect(cards[initialIndex].kind).toBe('missing');
    expect(cards[initialIndex]).toMatchObject({ recordId: 'gone' });
    // 하나가 사라졌다고 나머지를 못 보게 하지 않는다.
    expect(cards.filter((c) => c.kind === 'moment')).toHaveLength(2);
  });

  it('부재 카드가 다른 기록의 자리를 빼앗지 않는다', () => {
    const records = [record({ id: 'a' })];
    const { cards } = projectStory({ records, todayStr: TODAY, focusRecordId: 'gone', withCover: true });
    const moments = cards.filter((c) => c.kind === 'moment');
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ record: { id: 'a' } });
  });
});

describe('속표지', () => {
  it('순간이 여럿일 때만 붙는다', () => {
    const one = projectStory({ records: [record()], todayStr: TODAY, withCover: true });
    expect(one.cards.some((c) => c.kind === 'cover')).toBe(false);

    const many = projectStory({
      records: [record({ id: 'a' }), record({ id: 'b', time: '20:00' })],
      todayStr: TODAY, withCover: true,
    });
    expect(many.cards[0].kind).toBe('cover');
  });

  it('보관 모드에서는 붙지 않는다', () => {
    const archive = projectStory({
      records: [record({ id: 'a' }), record({ id: 'b', time: '20:00' })],
      todayStr: TODAY, withCover: false,
    });
    expect(archive.cards.some((c) => c.kind === 'cover')).toBe(false);
  });

  it('다섯 줄을 넘지 않고, 줄마다 원본 id를 갖는다', () => {
    const records = Array.from({ length: 8 }, (_, i) => record({ id: `r${i}`, time: `0${i}:00` }));
    const { cards } = projectStory({ records, todayStr: TODAY, withCover: true });
    const cover = cards[0];
    expect(cover.kind).toBe('cover');
    if (cover.kind !== 'cover') return;
    expect(cover.lines).toHaveLength(5);
    // 줄이 원본으로 가려면 id가 있어야 한다. 인덱스로는 갈 수 없다.
    for (const line of cover.lines) expect(line.recordId).toBeTruthy();
  });
});

describe('열 수 없는 기록', () => {
  it('카드를 만들지 않고 닫는 카드에서 개수만 말한다', () => {
    const records = [
      record({ id: 'a' }),
      record({ id: 'b', contentUnavailable: 'key_unavailable' } as Partial<DailyRecord>),
    ];
    const { cards } = projectStory({ records, todayStr: TODAY, withCover: true });
    expect(cards.filter((c) => c.kind === 'moment')).toHaveLength(1);
    expect(cards.at(-1)).toMatchObject({ kind: 'closing', momentCount: 1, unreadableCount: 1 });
  });

  it('전부 열 수 없어도 닫는 카드는 남는다', () => {
    const records = [record({ id: 'a', contentUnavailable: 'undecryptable' } as Partial<DailyRecord>)];
    const { cards } = projectStory({ records, todayStr: TODAY, withCover: true });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'closing', momentCount: 0, unreadableCount: 1 });
  });

  it('아무것도 없으면 카드도 없다', () => {
    // 빈 전체화면으로 보내지 않는다. 호출부가 이 결과로 진입 자체를 막는다.
    const { cards } = projectStory({ records: [], todayStr: TODAY, withCover: true });
    expect(cards).toEqual([]);
  });
});

describe('구간 라벨은 사실만 적는다', () => {
  it('오늘 하루면 오늘이라고 한다', () => {
    expect(storyRangeLabel([record()], TODAY)).toBe('오늘');
  });

  it('지난 하루면 날짜를 적는다', () => {
    expect(storyRangeLabel([record({ date: '2026-08-20' })], TODAY)).toBe('8/20');
  });

  it('여러 날이면 처음과 끝을 적는다', () => {
    const label = storyRangeLabel(
      [record({ id: 'a', date: '2026-08-20' }), record({ id: 'b', date: '2026-08-22' })], TODAY,
    );
    expect(label).toBe('8/20 – 8/22');
    // "3일치 밀림" 같은 부채 표현을 쓰지 않는다.
    expect(label).not.toMatch(/개|건|밀/);
  });
});

describe('본문이 없는 순간', () => {
  it('첨부 종류를 사실대로 말한다', () => {
    expect(momentSummaryText(record({ log: '', attachments: [{ type: 'photo', url: 'x' }] } as Partial<DailyRecord>)))
      .toBe('사진을 남겼어요');
    expect(momentSummaryText(record({ log: '', attachments: [{ type: 'voice', url: 'x' }] } as Partial<DailyRecord>)))
      .toBe('목소리를 남겼어요');
  });

  it('아무것도 없으면 지어내지 않는다', () => {
    const text = momentSummaryText(record({ log: '', attachments: [] }));
    expect(text).toBe('순간을 남겼어요');
    // 감정을 단정하거나 이야기를 만들지 않는다(§6.3).
    expect(text).not.toMatch(/좋|슬프|힘들|기뻤어|평온/);
  });

  it('긴 본문은 자르되 원문에서 잘라낸다', () => {
    const text = momentSummaryText(record({ log: '가'.repeat(80) }));
    expect(text.length).toBeLessThanOrEqual(40);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('Unicode 및 온디바이스 연계 회귀 방지', () => {
  const LONE_SURROGATE_REGEX = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('Intl.Segmenter가 있을 때 emoji·NFD·ZWJ 절단 시 서로게이트를 쪼개지 않는다', () => {
    const emojiRecord = record({ log: `${'a'.repeat(38)}😀b` });
    const nfdRecord = record({ log: `${'a'.repeat(38)}e\u0301b` });
    const zwjRecord = record({ log: `${'a'.repeat(30)}👨‍👩‍👧‍👦b` });

    for (const rec of [emojiRecord, nfdRecord, zwjRecord]) {
      const summary = momentSummaryText(rec);
      expect(summary.length).toBeLessThanOrEqual(40);
      expect(summary.endsWith('…')).toBe(true);
      expect(LONE_SURROGATE_REGEX.test(summary)).toBe(false);
    }
  });

  it('Intl.Segmenter 부재 시 momentSummaryText -> deterministicSummaryLines -> buildOnDeviceItems 경로에서 서로게이트가 payload에 가지 않고 배치가 비워지며 결정론적 텍스트는 온전히 유지된다', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });

    try {
      const emojiLog = `${'a'.repeat(38)}😀b`;
      const nfdLog = `${'a'.repeat(38)}e\u0301b`;
      const zwjLog = `${'a'.repeat(30)}👨‍👩‍👧‍👦b`;

      const records = [
        record({ id: 'r-emoji', log: emojiLog }),
        record({ id: 'r-nfd', log: nfdLog }),
        record({ id: 'r-zwj', log: zwjLog }),
      ];

      // 1. momentSummaryText는 Segmenter 부재 시 자르지 않고 원문(접힌 본문)을 그대로 보존
      expect(momentSummaryText(records[0])).toBe(emojiLog);
      expect(momentSummaryText(records[1])).toBe(nfdLog);
      expect(momentSummaryText(records[2])).toBe(zwjLog);

      // 2. deterministicSummaryLines 결과도 원문 텍스트가 유지되며 lone surrogate가 없음
      const lines = deterministicSummaryLines(records);
      expect(lines).toHaveLength(3);
      expect(lines[0].text).toBe(emojiLog);
      expect(lines[1].text).toBe(nfdLog);
      expect(lines[2].text).toBe(zwjLog);
      for (const line of lines) {
        expect(LONE_SURROGATE_REGEX.test(line.text)).toBe(false);
      }

      // 3. buildOnDeviceItems 호출 시 40자 초과 + Segmenter 부재로 인해 배치가 비워짐 (refinement 포기)
      const payloadItems = buildOnDeviceItems(lines);
      expect(payloadItems).toEqual([]);

      // 4. payload wire format에 lone surrogate가 절대 도달하지 않음
      const wire = JSON.stringify(payloadItems);
      expect(LONE_SURROGATE_REGEX.test(wire)).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });
});
