import { describe, it, expect } from 'vitest';
import type { DailyRecord } from '@/types';
import {
  MAX_DAILY_SUMMARY_LINE_CHARS,
  MAX_DAILY_SUMMARY_SOURCE_CHARS,
  ON_DEVICE_SUMMARY_BATCH_SIZE,
  buildAllOnDeviceBatches,
  buildOnDeviceItems,
  collapseSummaryText,
  normalizeDailySummarySource,
  normalizeSummaryLineText,
  type DailySummaryLine,
} from '@/lib/dailySummary/contract';

/**
 * 네이티브 경계를 실제로 건너가는 것이 무엇인가.
 *
 * 여기서 세는 것은 payload의 **키 목록**이다. "recordId를 넣지 않았다"는 코드 읽기로 확인할 수
 * 있지만, 나중에 누가 `date`를 하나 추가해도 다른 어떤 테스트도 실패하지 않는다. 그래서 키
 * 집합 자체를 고정한다.
 */

function line(over: Partial<DailySummaryLine> = {}): DailySummaryLine {
  const text = over.text ?? '오늘 시험 끝났어';
  const sourceText = Object.prototype.hasOwnProperty.call(over, 'sourceText')
    ? over.sourceText ?? null
    : text;
  return {
    recordId: 'record-uuid',
    time: '09:00',
    date: '2026-08-22',
    ...over,
    text,
    sourceText,
    sourceWasTruncated: over.sourceWasTruncated ?? false,
  };
}

describe('모델 payload에는 index와 text만 들어간다', () => {
  it('키 집합이 정확히 두 개다', () => {
    const items = buildOnDeviceItems([line({ recordId: 'a' }), line({ recordId: 'b' })]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['index', 'text']);
    }
  });

  it('recordId·userId·날짜·시각·첨부가 직렬화된 payload에 나타나지 않는다', () => {
    const items = buildOnDeviceItems([
      line({ recordId: 'record-uuid-aaa', time: '09:00', date: '2026-08-22' }),
      line({ recordId: 'record-uuid-bbb', time: '13:00', date: '2026-08-22', text: '점심' }),
    ]);
    const wire = JSON.stringify(items);
    expect(wire).not.toContain('record-uuid-aaa');
    expect(wire).not.toContain('record-uuid-bbb');
    expect(wire).not.toContain('2026-08-22');
    expect(wire).not.toContain('09:00');
    expect(wire).not.toContain('recordId');
    expect(wire).not.toContain('userId');
    expect(wire).not.toContain('http');
  });

  it('index는 배열 위치에서 새로 만든다', () => {
    const items = buildOnDeviceItems([line({ recordId: 'z' }), line({ recordId: 'y' }), line({ recordId: 'x' })]);
    expect(items.map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it('다섯 개를 넘겨 보내지 않는다', () => {
    const lines = Array.from({ length: 12 }, (_, i) => line({ recordId: `r${i}` }));
    expect(buildOnDeviceItems(lines)).toHaveLength(ON_DEVICE_SUMMARY_BATCH_SIZE);
  });

  it('구조화된 감정·주기·건강 필드는 payload에 들어갈 자리가 없다', () => {
    /*
      `DailySummaryLine`은 네 필드뿐이므로 `emotionFlow` 같은 값은 여기까지 오지 못한다.
      기록 전체를 넘기려 해도 payload에 남는 것은 index와 text다.
    */
    const withStructuredFields = {
      id: 'r1',
      userId: 'partner',
      date: '2026-08-22',
      time: '09:00',
      authorRole: 'gomsin',
      log: '오늘 시험 끝났어',
      isPrivate: false,
      createdAt: '2026-08-22T00:00:00.000Z',
      emotionFlow: [{ group: 'shame', visibility: 'author_only', source: 'user_confirmed' }],
      emotionAnalysis: { dominant: 'sad' },
    } as unknown as DailyRecord;

    const items = buildOnDeviceItems([line({ recordId: withStructuredFields.id })]);
    const wire = JSON.stringify(items);
    expect(wire).not.toContain('emotionFlow');
    expect(wire).not.toContain('emotionAnalysis');
    expect(wire).not.toContain('shame');
    expect(wire).not.toContain('author_only');
  });

  it('원문 본문이 없는 항목은 합성 문장으로 대신 보내지 않고 하루 전체를 거부한다', () => {
    const lines = [
      line({ recordId: 'with-body', sourceText: '직접 쓴 본문' }),
      line({ recordId: 'attachment-only', text: '사진을 남겼어요', sourceText: null }),
    ];

    expect(buildOnDeviceItems(lines)).toEqual([]);
    expect(buildAllOnDeviceBatches(lines)).toBeNull();
  });
});

describe('표지 40자 상한', () => {
  it('넘치면 자르고 말줄임표를 붙인다', () => {
    const text = normalizeSummaryLineText('가'.repeat(120));
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(MAX_DAILY_SUMMARY_LINE_CHARS);
    expect(text!.endsWith('…')).toBe(true);
  });

  it('deterministic 표시 텍스트는 별도 표지 함수에서 40자 상한을 지킨다', () => {
    const items = buildOnDeviceItems([line({ text: '나'.repeat(200) }), line({ text: '짧다' })]);
    for (const item of items) {
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.text.length).toBeLessThanOrEqual(MAX_DAILY_SUMMARY_SOURCE_CHARS);
    }
  });

  it('상한 이하는 그대로 둔다 (멱등)', () => {
    const once = normalizeSummaryLineText('오늘 시험 끝났어');
    expect(once).toBe('오늘 시험 끝났어');
    expect(normalizeSummaryLineText(once)).toBe(once);
  });

  it('상한에서 emoji·결합 문자·ZWJ grapheme을 중간 절단하지 않는다', () => {
    const emoji = normalizeSummaryLineText(`${'a'.repeat(38)}😀b`);
    const nfd = normalizeSummaryLineText(`${'a'.repeat(38)}e\u0301b`);
    const family = normalizeSummaryLineText(`${'a'.repeat(30)}👨‍👩‍👧‍👦b`);

    expect(emoji).toBe(`${'a'.repeat(38)}…`);
    expect(nfd).toBe(`${'a'.repeat(38)}…`);
    expect(family).toBe(`${'a'.repeat(30)}…`);
    for (const text of [emoji, nfd, family]) {
      expect(text).not.toBeNull();
      expect(text!.length).toBeLessThanOrEqual(MAX_DAILY_SUMMARY_LINE_CHARS);
      expect(text!).not.toContain('\uFFFD');
    }
  });

  it('Segmenter가 없으면 결합 문자를 자르지 않고 배치 refinement를 포기한다', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    try {
      const text = `${'a'.repeat(118)}👨‍👩‍👧‍👦b`;
      expect(normalizeSummaryLineText(text)).toBeNull();
      expect(buildOnDeviceItems([line({ text }), line({ text: '짧다' })])).toEqual([]);
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });
});

describe('원문 입력 상한과 모델 호출 상한', () => {
  it('모델 입력은 120 UTF-16 단위까지 보존하고 40자 표지 상한을 적용하지 않는다', () => {
    const items = buildOnDeviceItems([line({ text: '가'.repeat(121) })]);
    expect(items[0].text).toHaveLength(120);
    expect(items[0].text.endsWith('…')).toBe(false);
  });

  it('120 단위 상한도 grapheme 중간을 자르지 않는다', () => {
    const source = `${'a'.repeat(118)}👨‍👩‍👧‍👦b`;
    const items = buildOnDeviceItems([line({ text: source })]);
    expect(items[0].text).toBe('a'.repeat(118));
    expect(items[0].text).not.toContain('\u200d');
  });

  it('상한보다 큰 단일 grapheme 때문에 짧은 prefix만 남아도 절단 사실을 보존한다', () => {
    const source = `안녕하세요 e${'\u0301'.repeat(200)}`;
    const normalized = normalizeDailySummarySource(source);

    expect(normalized).toEqual({ text: '안녕하세요 ', wasTruncated: true });
  });

  it('21개 이상이면 모델 배치를 만들지 않고 null로 fail-closed 한다', () => {
    const lines = Array.from({ length: 21 }, (_, index) => line({ recordId: `r${index}`, text: `기록 ${index}` }));
    expect(buildAllOnDeviceBatches(lines)).toBeNull();
  });
});

describe('collapseSummaryText는 접기만 하고 자르지 않는다', () => {
  it('제어문자와 연속 공백을 하나로 접는다', () => {
    expect(collapseSummaryText('  오늘\n\n시험\t끝났어\u0000 ')).toBe('오늘 시험 끝났어');
    expect(collapseSummaryText('줄\u2028바꿈')).toBe('줄 바꿈');
  });

  it('문자와 이모지 결합에 필요한 ZWNJ·ZWJ는 보존한다', () => {
    expect(collapseSummaryText('가족 👨‍👩‍👧‍👦')).toBe('가족 👨‍👩‍👧‍👦');
    expect(collapseSummaryText('می‌خواهم')).toBe('می‌خواهم');
  });

  it('40자를 넘겨도 자르지 않는다 -- 검증이 거부할 수 있어야 한다', () => {
    const long = collapseSummaryText('가'.repeat(80));
    expect(long).toHaveLength(80);
  });
});

describe('buildAllOnDeviceBatches (5개 단위 고정 배치 분할)', () => {
  it('0, 1, 5, 6, 8, 12개 라인을 5개 단위 고정 배치로 분할한다', () => {
    expect(buildAllOnDeviceBatches([])).toEqual([]);

    const b1 = buildAllOnDeviceBatches([line({ recordId: 'r0' })]);
    expect(b1).toHaveLength(1);
    expect(b1![0].items).toEqual([{ index: 0, text: '오늘 시험 끝났어' }]);

    const lines5 = Array.from({ length: 5 }, (_, i) => line({ recordId: `r${i}` }));
    const b5 = buildAllOnDeviceBatches(lines5);
    expect(b5).toHaveLength(1);
    expect(b5![0].items).toHaveLength(5);
    expect(b5![0].items.map((it) => it.index)).toEqual([0, 1, 2, 3, 4]);

    const lines6 = Array.from({ length: 6 }, (_, i) => line({ recordId: `r${i}` }));
    const b6 = buildAllOnDeviceBatches(lines6);
    expect(b6).toHaveLength(2);
    expect(b6![0].items).toHaveLength(5);
    expect(b6![1].items).toEqual([{ index: 0, text: '오늘 시험 끝났어' }]);

    const lines8 = Array.from({ length: 8 }, (_, i) => line({ recordId: `r${i}` }));
    const b8 = buildAllOnDeviceBatches(lines8);
    expect(b8).toHaveLength(2);
    expect(b8![0].items).toHaveLength(5);
    expect(b8![0].items.map((it) => it.index)).toEqual([0, 1, 2, 3, 4]);
    expect(b8![1].items).toHaveLength(3);
    expect(b8![1].items.map((it) => it.index)).toEqual([0, 1, 2]);
    expect(b8![1].lines.map((l) => l.recordId)).toEqual(['r5', 'r6', 'r7']);

    const lines12 = Array.from({ length: 12 }, (_, i) => line({ recordId: `r${i}` }));
    const b12 = buildAllOnDeviceBatches(lines12);
    expect(b12).toHaveLength(3);
    expect(b12![0].items).toHaveLength(5);
    expect(b12![1].items).toHaveLength(5);
    expect(b12![2].items).toHaveLength(2);
  });

  it('Segmenter 부재 시 나중 배치(batch 2 등)에 긴 줄이 있으면 전체 배치를 null로 반환한다', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    try {
      const longText = `${'a'.repeat(118)}👨‍👩‍👧‍👦b`;
      const lines = [
        ...Array.from({ length: 5 }, (_, i) => line({ recordId: `r${i}`, text: '짧은 줄' })),
        line({ recordId: 'r5', text: longText }),
        line({ recordId: 'r6', text: '짧은 줄' }),
      ];
      expect(buildAllOnDeviceBatches(lines)).toBeNull();
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });
});
