import { describe, it, expect } from 'vitest';
import { moveWithinList, movedList, reorderByIds } from '@/lib/reorderList';

const list = [
  { id: 'a', sortOrder: 10 },
  { id: 'b', sortOrder: 20 },
  { id: 'c', sortOrder: 30 },
  { id: 'd', sortOrder: 40 },
];

describe('끌어 옮긴 뒤 무엇을 다시 적어야 하는가', () => {
  it('첫째를 끝으로 옮기면 나머지가 한 칸씩 당겨진다', () => {
    expect(moveWithinList(list, 0, 3)).toEqual([
      { id: 'b', sortOrder: 10 },
      { id: 'c', sortOrder: 20 },
      { id: 'd', sortOrder: 30 },
      { id: 'a', sortOrder: 40 },
    ]);
  });

  it('이웃과 바꾸면 둘만 바뀐다', () => {
    expect(moveWithinList(list, 1, 2)).toEqual([
      { id: 'c', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
  });

  /*
    전부 다시 매기면 한 번 끌 때마다 목록 전체가 쓰기 대상이 되고, 상대가 동시에
    고치던 항목까지 덮어쓴다. 자리가 실제로 달라진 것만 나와야 한다.
  */
  it('자리가 그대로인 것은 쓰지 않는다', () => {
    const changed = moveWithinList(list, 2, 3).map((change) => change.id);
    expect(changed.sort()).toEqual(['c', 'd']);
  });

  it('제자리에 놓으면 아무것도 바꾸지 않는다', () => {
    expect(moveWithinList(list, 2, 2)).toEqual([]);
  });

  it('목록 밖으로는 옮기지 않는다', () => {
    expect(moveWithinList(list, 0, 9)).toEqual([]);
    expect(moveWithinList(list, -1, 1)).toEqual([]);
  });

  /*
    원래 있던 순서 값을 자리에 **다시 배분**한다. 새 숫자를 만들면 시간이 박힌 항목이나
    다른 날의 항목과 값이 부딪힌다.
  */
  it('새 순서 값을 만들어 내지 않는다', () => {
    const used = new Set(list.map((item) => item.sortOrder));
    for (const change of moveWithinList(list, 3, 0)) {
      expect(used.has(change.sortOrder)).toBe(true);
    }
  });

  it('띄엄띄엄한 순서 값도 그대로 재사용한다', () => {
    const sparse = [
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 7 },
      { id: 'c', sortOrder: 900 },
    ];
    expect(moveWithinList(sparse, 2, 0)).toEqual([
      { id: 'c', sortOrder: 1 },
      { id: 'a', sortOrder: 7 },
      { id: 'b', sortOrder: 900 },
    ]);
  });
});

describe('화면이 먼저 그리는 목록', () => {
  it('옮긴 자리대로 나온다', () => {
    expect(movedList(list, 0, 2).map((item) => item.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('원본을 건드리지 않는다', () => {
    const before = list.map((item) => item.id);
    movedList(list, 0, 3);
    expect(list.map((item) => item.id)).toEqual(before);
  });
});

describe('최종 순서로 바뀐 것만 골라 낸다', () => {
  it('순서를 자리 값에 배분한다', () => {
    expect(reorderByIds(list, ['d', 'a', 'b', 'c'])).toEqual([
      { id: 'd', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
      { id: 'c', sortOrder: 40 },
    ]);
  });

  it('그대로면 아무것도 바꾸지 않는다', () => {
    expect(reorderByIds(list, ['a', 'b', 'c', 'd'])).toEqual([]);
  });

  /*
    부분적으로 맞는 순서를 저장하면 화면과 저장된 값이 조용히 갈라진다. 개수가 다르거나
    모르는 아이디가 섞이면 아무것도 하지 않는 편이 낫다.
  */
  it('개수가 다르면 아무것도 하지 않는다', () => {
    expect(reorderByIds(list, ['a', 'b'])).toEqual([]);
  });

  it('모르는 아이디가 섞이면 아무것도 하지 않는다', () => {
    expect(reorderByIds(list, ['a', 'b', 'c', 'zz'])).toEqual([]);
  });
});
