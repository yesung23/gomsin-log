import { describe, it, expect } from 'vitest';
import { buildOnDeviceItems, type DailySummaryLine } from '@/lib/dailySummary/contract';
import {
  bindRefinedTexts,
  verifyAndBindRefinedLines,
  verifyRefinedItems,
} from '@/lib/dailySummary/verify';

/**
 * 모델 출력은 검증되지 않은 입력이다.
 *
 * 각 거부 사유마다 테스트가 하나씩 있다. 하나로 뭉치면 "거부했다"만 확인되고 **왜** 거부했는지가
 * 흔들려도 통과한다 -- 재배열과 환각한 index는 다른 실패이고, 다른 실패로 보고되어야 한다.
 */

const LINES: DailySummaryLine[] = [
  { recordId: 'rec-a', text: '오늘 시험 끝났어', time: '09:00', date: '2026-08-22' },
  { recordId: 'rec-b', text: '점심 먹었어', time: '13:00', date: '2026-08-22' },
  { recordId: 'rec-c', text: '사진을 남겼어요', time: '18:00', date: '2026-08-22' },
];
const ITEMS = buildOnDeviceItems(LINES);

function refined(items: unknown) {
  return verifyRefinedItems(items, ITEMS);
}

describe('통과하는 응답', () => {
  it('개수·순서·index가 그대로면 텍스트를 받아들인다', () => {
    const result = refined([
      { index: 0, text: '오늘 시험 끝났어' },
      { index: 1, text: '점심 먹었어.' },
      { index: 2, text: '사진을 남겼어요' },
    ]);
    expect(result).toEqual({
      ok: true,
      texts: ['오늘 시험 끝났어', '점심 먹었어.', '사진을 남겼어요'],
    });
  });

  it('바깥 공백은 접어서 받아들인다', () => {
    const result = refined([
      { index: 0, text: '  오늘 시험 끝났어  ' },
      { index: 1, text: '점심 먹었어' },
      { index: 2, text: '사진을 남겼어요' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.texts[0]).toBe('오늘 시험 끝났어');
  });

  it('내부 띄어쓰기를 옮기거나 늘리면 의미가 달라질 수 있어 거부한다', () => {
    expect(refined([
      { index: 0, text: '오늘  시험 끝났어' },
      { index: 1, text: ITEMS[1].text },
      { index: 2, text: ITEMS[2].text },
    ])).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });

  it.each([
    ["'안 가'라고 했어", '안 가라고 했어'],
    ['아버지가 방에 들어가신다', '아버지 가방에 들어가신다'],
    ['３시 운동했어', '－３시 운동했어'],
  ])('손실 정규화로 같아 보이는 문장도 거부한다: %s -> %s', (source, candidate) => {
    expect(verifyRefinedItems(
      [{ index: 0, text: candidate }],
      [{ index: 0, text: source }],
    )).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });
});

describe('거부하는 응답', () => {
  it('배열이 아니다', () => {
    expect(refined(null).ok).toBe(false);
    expect(refined({ items: [] })).toEqual({ ok: false, rejection: 'not_an_array' });
    expect(refined('[]')).toEqual({ ok: false, rejection: 'not_an_array' });
  });

  it('항목을 추가했다', () => {
    expect(refined([
      { index: 0, text: 'a' }, { index: 1, text: 'b' }, { index: 2, text: 'c' }, { index: 3, text: '지어낸 줄' },
    ])).toEqual({ ok: false, rejection: 'count_mismatch' });
  });

  it('항목을 삭제했다', () => {
    expect(refined([{ index: 0, text: 'a' }, { index: 1, text: 'b' }]))
      .toEqual({ ok: false, rejection: 'count_mismatch' });
  });

  it('index를 환각했다 (범위 밖)', () => {
    expect(refined([
      { index: 0, text: ITEMS[0].text },
      { index: 9, text: ITEMS[1].text },
      { index: 2, text: ITEMS[2].text },
    ]))
      .toEqual({ ok: false, rejection: 'index_out_of_range' });
    expect(refined([
      { index: -1, text: ITEMS[0].text },
      { index: 1, text: ITEMS[1].text },
      { index: 2, text: ITEMS[2].text },
    ]))
      .toEqual({ ok: false, rejection: 'index_out_of_range' });
  });

  it('index를 중복했다 (그래서 하나가 누락됐다)', () => {
    expect(refined([
      { index: 0, text: ITEMS[0].text },
      { index: 0, text: ITEMS[1].text },
      { index: 2, text: ITEMS[2].text },
    ]))
      .toEqual({ ok: false, rejection: 'duplicate_index' });
  });

  it('재배열했다', () => {
    expect(refined([{ index: 1, text: 'b' }, { index: 0, text: 'a' }, { index: 2, text: 'c' }]))
      .toEqual({ ok: false, rejection: 'reordered' });
  });

  it('index가 정수가 아니다', () => {
    expect(refined([{ index: 0.5, text: 'a' }, { index: 1, text: 'b' }, { index: 2, text: 'c' }]))
      .toEqual({ ok: false, rejection: 'index_not_integer' });
    expect(refined([{ index: '0', text: 'a' }, { index: 1, text: 'b' }, { index: 2, text: 'c' }]))
      .toEqual({ ok: false, rejection: 'index_not_integer' });
  });

  it('항목이 객체가 아니다', () => {
    expect(refined(['a', 'b', 'c'])).toEqual({ ok: false, rejection: 'malformed_item' });
    expect(refined([null, null, null])).toEqual({ ok: false, rejection: 'malformed_item' });
  });

  it('텍스트가 문자열이 아니다', () => {
    expect(refined([{ index: 0, text: 42 }, { index: 1, text: 'b' }, { index: 2, text: 'c' }]))
      .toEqual({ ok: false, rejection: 'text_not_a_string' });
  });

  it('텍스트가 비어 있다', () => {
    expect(refined([{ index: 0, text: '   ' }, { index: 1, text: 'b' }, { index: 2, text: 'c' }]))
      .toEqual({ ok: false, rejection: 'empty_text' });
  });

  it('40자를 넘겼다 -- 잘라 쓰지 않고 배치 전체를 버린다', () => {
    expect(refined([
      { index: 0, text: '가'.repeat(41) }, { index: 1, text: 'b' }, { index: 2, text: 'c' },
    ])).toEqual({ ok: false, rejection: 'text_too_long' });

    // 정확히 40자이고 원문과 같은 문장은 통과한다.
    const forty = '가'.repeat(40);
    expect(verifyRefinedItems(
      [{ index: 0, text: forty }],
      [{ index: 0, text: forty }],
    ).ok).toBe(true);
  });

  it('원문에 없는 내용이 한 줄이라도 있으면 배치 전체를 거부한다', () => {
    expect(refined([
      { index: 0, text: '오늘 외로워' },
      { index: 1, text: ITEMS[1].text },
      { index: 2, text: ITEMS[2].text },
    ])).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });

  it.each([
    ['너랑 헤어졌어, 꿈에서', '너랑 헤어졌어'],
    ['춘향이랑 점심 먹었어', '점심 먹었어'],
    ['3°C였어', '-3°C였어'],
    ['-3°C였어', '3°C였어'],
    ['두 번 전화했어', '전화했어'],
  ])('부분 문자열이어도 의미 맥락이나 수량을 잃으면 거부한다: %s -> %s', (source, candidate) => {
    expect(verifyRefinedItems(
      [{ index: 0, text: candidate }],
      [{ index: 0, text: source }],
    )).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });

  it('index가 맞아도 다른 줄의 문장을 가져오면 거부한다', () => {
    expect(refined([
      { index: 0, text: ITEMS[1].text },
      { index: 1, text: ITEMS[0].text },
      { index: 2, text: ITEMS[2].text },
    ])).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });

  it('보이지 않는 문자를 공백처럼 지워 통과시키지 않는다', () => {
    expect(refined([
      { index: 0, text: `오늘\u200b 시험 끝났어` },
      { index: 1, text: ITEMS[1].text },
      { index: 2, text: ITEMS[2].text },
    ])).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });
});

describe('index를 원래 recordId에 다시 붙인다', () => {
  it('배열 위치로 붙인다 -- 모델이 준 index는 매핑에 쓰이지 않는다', () => {
    const bound = bindRefinedTexts(LINES, ['첫째', '둘째', '셋째']);
    expect(bound.get('rec-a')).toBe('첫째');
    expect(bound.get('rec-b')).toBe('둘째');
    expect(bound.get('rec-c')).toBe('셋째');
    expect(bound.size).toBe(3);
  });

  it('개수가 어긋나면 아무것도 붙이지 않는다', () => {
    expect(bindRefinedTexts(LINES, ['하나']).size).toBe(0);
  });

  it('검증과 재결합이 한 번에 이뤄지고, 실패는 지도를 만들지 않는다', () => {
    const good = verifyAndBindRefinedLines(
      [
        { index: 0, text: '오늘 시험 끝났어.' },
        { index: 1, text: '점심 먹었어.' },
        { index: 2, text: '사진을 남겼어요.' },
      ],
      LINES,
      ITEMS,
    );
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect([...good.refined.entries()]).toEqual([
      ['rec-a', '오늘 시험 끝났어.'],
      ['rec-b', '점심 먹었어.'],
      ['rec-c', '사진을 남겼어요.'],
    ]);

    const bad = verifyAndBindRefinedLines([{ index: 2, text: 'C' }], LINES, ITEMS);
    expect(bad).toEqual({ ok: false, rejection: 'count_mismatch' });
  });

  it('다듬어진 텍스트가 다른 기록에 붙을 수 없다', () => {
    // 재배열은 애초에 검증에서 걸리므로, 매핑이 뒤바뀔 응답은 지도를 만들지 못한다.
    const result = verifyAndBindRefinedLines(
      [{ index: 2, text: '셋째' }, { index: 1, text: '둘째' }, { index: 0, text: '첫째' }],
      LINES,
      ITEMS,
    );
    expect(result.ok).toBe(false);
  });

  it('두 번째 배치(batch 2, index 0..2)가 records 6..8에 정확히 매핑된다', () => {
    const batch2Lines: DailySummaryLine[] = [
      { recordId: 'rec-6', text: '여섯째 기록', time: '14:00', date: '2026-08-22' },
      { recordId: 'rec-7', text: '일곱째 기록', time: '15:00', date: '2026-08-22' },
      { recordId: 'rec-8', text: '여덟째 기록', time: '16:00', date: '2026-08-22' },
    ];
    const batch2Items = buildOnDeviceItems(batch2Lines);
    expect(batch2Items.map((it) => it.index)).toEqual([0, 1, 2]);

    const bound = verifyAndBindRefinedLines(
      [
        { index: 0, text: '여섯째 기록.' },
        { index: 1, text: '일곱째 기록.' },
        { index: 2, text: '여덟째 기록.' },
      ],
      batch2Lines,
      batch2Items,
    );

    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect([...bound.refined.entries()]).toEqual([
      ['rec-6', '여섯째 기록.'],
      ['rec-7', '일곱째 기록.'],
      ['rec-8', '여덟째 기록.'],
    ]);
  });
});
