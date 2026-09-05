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
  { recordId: 'rec-a', text: '오늘 시험 끝났어', time: '09:00', date: '2026-08-22', sourceText: '오늘 시험 끝났어', fullSourceText: '오늘 시험 끝났어', sourceWasTruncated: false },
  { recordId: 'rec-b', text: '점심 먹었어', time: '13:00', date: '2026-08-22', sourceText: '점심 먹었어', fullSourceText: '점심 먹었어', sourceWasTruncated: false },
  { recordId: 'rec-c', text: '사진을 남겼어요', time: '18:00', date: '2026-08-22', sourceText: '사진을 남겼어요', fullSourceText: '사진을 남겼어요', sourceWasTruncated: false },
];
const ITEMS = buildOnDeviceItems(LINES);

function refined(items: unknown) {
  return verifyRefinedItems(items, ITEMS);
}

describe('통과하는 응답', () => {
  it('긴 원문의 완전한 마지막 문장 suffix를 앞 말줄임표와 함께 표시한다', () => {
    const source = '오전에는 생활관에서 편지를 정리하고 쉬었어. 오후에는 운동장을 세 바퀴 걸었어.';
    const result = verifyRefinedItems(
      [{ index: 0, text: '오후에는 운동장을 세 바퀴 걸었어.' }],
      [{ index: 0, text: source }],
    );
    expect(result).toEqual({
      ok: true,
      texts: ['…오후에는 운동장을 세 바퀴 걸었어.'],
    });
  });

  it('개수·순서·index가 그대로면 텍스트를 받아들인다', () => {
    const result = refined([
      { index: 0, text: '오늘 시험 끝났어' },
      { index: 1, text: '점심 먹었어' },
      { index: 2, text: '사진을 남겼어요' },
    ]);
    expect(result).toEqual({
      ok: true,
      texts: ['오늘 시험 끝났어', '점심 먹었어', '사진을 남겼어요'],
    });
  });

  it('원문에 없는 마침표를 추가하면 exact excerpt가 아니므로 거부한다', () => {
    expect(verifyRefinedItems(
      [{ index: 0, text: '점심 먹었어.' }],
      [{ index: 0, text: '점심 먹었어' }],
    )).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });

  it('120 단위에서 잘린 prefix는 완전한 원문으로 검증할 수 없어 거부한다', () => {
    expect(verifyRefinedItems(
      [{ index: 0, text: '안녕하세요' }],
      [{ index: 0, text: '안녕하세요' }],
      [true],
    )).toEqual({ ok: false, rejection: 'semantic_mismatch' });
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
  it.each([
    [
      '나는 그 사람이 싫다 라고 말한 적이 없고 오히려 많이 아낀다고 여러 번 분명하게 설명했어',
      '나는 그 사람이 싫다',
    ],
    [
      '우리는 헤어졌어 라고 친구가 농담했지만 실제로는 오래 함께하고 싶다고 분명하게 말했어',
      '우리는 헤어졌어',
    ],
    [
      '비가 오면 만나지 말자고 한 게 아니라 실내에서 만나 오래 이야기하자고 분명하게 적었어',
      '비가 오면 만나지 말자고',
    ],
    [
      '세 번 전화했어 라고 쓴 건 오타였고 실제로는 두 번만 전화했다고 바로 고쳐 적었어',
      '세 번 전화했어',
    ],
    [
      '오늘은 통화하지 말자고 적은 게 아니고 저녁에 길게 통화하자고 나중에 다시 설명했어',
      '오늘은 통화하지 말자고',
    ],
    [
      '내일 안 만날 거야 라는 말은 농담이었고 실제로는 약속한 시간에 꼭 만나겠다고 확인했어',
      '내일 안 만날 거야',
    ],
    [
      '눈이 오면 외출하지 말자고 한 게 아니라 근처 카페에서 만나자고 조건을 붙여 설명했어',
      '눈이 오면 외출하지 말자고',
    ],
    [
      '다섯 번 만났다고 쓴 건 내가 잘못 적은 거고 실제로는 네 번이라고 바로 정정했어',
      '다섯 번 만났다고',
    ],
  ])('뒤 부정·농담·조건·정정을 버린 앞 발췌을 실제 verifier가 거부한다', (source, candidate) => {
    expect(verifyRefinedItems(
      [{ index: 0, text: candidate }],
      [{ index: 0, text: source }],
    )).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });

  it('장식한 표시가 40자를 넘으면 원문 출처가 맞아도 거부한다', () => {
    const source = `${'가'.repeat(20)} ${'나'.repeat(20)} ${'다'.repeat(20)}`;
    expect(verifyRefinedItems(
      [{ index: 0, text: `${'나'.repeat(20)} ${'다'.repeat(10)}` }],
      [{ index: 0, text: source }],
    )).toEqual({ ok: false, rejection: 'semantic_mismatch' });
  });

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
        { index: 0, text: '오늘 시험 끝났어' },
        { index: 1, text: '점심 먹었어' },
        { index: 2, text: '사진을 남겼어요' },
      ],
      LINES,
      ITEMS,
    );
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect([...good.refined.entries()]).toEqual([
      ['rec-a', '오늘 시험 끝났어'],
      ['rec-b', '점심 먹었어'],
      ['rec-c', '사진을 남겼어요'],
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
      { recordId: 'rec-6', text: '여섯째 기록', time: '14:00', date: '2026-08-22', sourceText: '여섯째 기록', fullSourceText: '여섯째 기록', sourceWasTruncated: false },
      { recordId: 'rec-7', text: '일곱째 기록', time: '15:00', date: '2026-08-22', sourceText: '일곱째 기록', fullSourceText: '일곱째 기록', sourceWasTruncated: false },
      { recordId: 'rec-8', text: '여덟째 기록', time: '16:00', date: '2026-08-22', sourceText: '여덟째 기록', fullSourceText: '여덟째 기록', sourceWasTruncated: false },
    ];
    const batch2Items = buildOnDeviceItems(batch2Lines);
    expect(batch2Items.map((it) => it.index)).toEqual([0, 1, 2]);

    const bound = verifyAndBindRefinedLines(
      [
        { index: 0, text: '여섯째 기록' },
        { index: 1, text: '일곱째 기록' },
        { index: 2, text: '여덟째 기록' },
      ],
      batch2Lines,
      batch2Items,
    );

    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect([...bound.refined.entries()]).toEqual([
      ['rec-6', '여섯째 기록'],
      ['rec-7', '일곱째 기록'],
      ['rec-8', '여덟째 기록'],
    ]);
  });
});
