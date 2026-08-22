import { describe, it, expect, beforeEach } from 'vitest';
import {
  STICKERS, PLACEMENT_LIMIT, loadPlacements, savePlacements, place, remove, type Placement,
} from './stickers';

const USER = 'user-a';
const MONTH = '2026-08';

function placement(partial: Partial<Placement> = {}): Placement {
  return { id: 'p1', stickerId: 'heart', x: 0.5, y: 0.5, rotation: 4, ...partial };
}

beforeEach(() => {
  localStorage.clear();
});

describe('붙인 자리는 비율로 남는다', () => {
  it('저장하고 다시 읽으면 같다', () => {
    savePlacements(USER, MONTH, [placement()]);
    expect(loadPlacements(USER, MONTH)).toEqual([placement()]);
  });

  it('계정마다 · 달마다 따로 남는다', () => {
    /*
      같은 기기를 두 사람이 쓰는 상황에서 한쪽의 꾸밈이 다른 쪽 일기에 나타나면 안 된다.
      달이 섞이면 8월 스티커가 7월 지면에 붙는다.
    */
    savePlacements(USER, MONTH, [placement({ stickerId: 'star' })]);
    expect(loadPlacements('user-b', MONTH)).toEqual([]);
    expect(loadPlacements(USER, '2026-07')).toEqual([]);
  });

  it('지면 밖 좌표는 안으로 되돌린다', () => {
    // 밖에 있는 스티커는 눌러서 지울 수 없다. 영영 남는다.
    savePlacements(USER, MONTH, [placement({ x: 4.2, y: -1 })]);
    const [loaded] = loadPlacements(USER, MONTH);
    expect(loaded.x).toBe(1);
    expect(loaded.y).toBe(0);
  });

  it('저장할 수 없는 좌표는 되살리지 않는다', () => {
    /*
      `JSON.stringify` 는 `NaN` 과 `Infinity` 를 `null` 로 쓴다. 그래서 왕복하면 좌표가
      숫자가 아니게 되고, 그런 붙임은 통째로 버려진다 -- 가운데로 되돌려 붙여 주는 것이
      아니다. 사용자가 붙인 적 없는 자리에 스티커가 나타나는 것보다 없는 편이 낫다.
    */
    savePlacements(USER, MONTH, [placement({ x: Number.NaN, y: Number.POSITIVE_INFINITY })]);
    expect(loadPlacements(USER, MONTH)).toEqual([]);
  });

  it('메모리 안에서 붙일 때는 숫자가 아닌 좌표를 가운데로 되돌린다', () => {
    // 이쪽은 JSON 을 거치지 않으므로 `NaN` 이 그대로 들어온다. 그리면 스티커가 사라지고
    // 지면 어딘가에 눌리지 않는 자리만 남는다.
    expect(place([], 'heart', Number.NaN, Number.NaN, 0, 'new')[0]).toMatchObject({ x: 0.5, y: 0.5 });
  });
});

describe('손상된 값이 일기를 지우지 않는다', () => {
  /*
    이 블록이 지키는 것: 스티커를 읽다 던지면 지면 전체가 안 그려지고, 사용자는 스티커가
    아니라 **그 달의 일기를 통째로** 잃은 것으로 본다. 어떤 쓰레기가 들어 있어도 빈
    배열이어야 한다.
  */
  it.each([
    ['깨진 JSON', '{['],
    ['배열이 아님', '{"x":1}'],
    ['빈 문자열', ''],
    ['null', 'null'],
    ['숫자 배열', '[1,2,3]'],
  ])('%s 이면 빈 지면이지 오류가 아니다', (_label, raw) => {
    localStorage.setItem(`gomsin.diary.stickers.${USER}.${MONTH}`, raw);
    expect(loadPlacements(USER, MONTH)).toEqual([]);
  });

  it('모양이 맞는 것만 살린다', () => {
    localStorage.setItem(
      `gomsin.diary.stickers.${USER}.${MONTH}`,
      JSON.stringify([placement(), { id: 'x' }, null, placement({ id: 'p2' })]),
    );
    expect(loadPlacements(USER, MONTH).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('목록에 없는 스티커는 버린다', () => {
    // 그릴 그림이 없다. 남겨 두면 지면에 빈 자리가 생기고 눌러도 아무 일이 없다.
    localStorage.setItem(
      `gomsin.diary.stickers.${USER}.${MONTH}`,
      JSON.stringify([placement({ stickerId: 'gone' }), placement({ id: 'p2' })]),
    );
    expect(loadPlacements(USER, MONTH).map((p) => p.id)).toEqual(['p2']);
  });

  it('계정이 없으면 아무것도 읽지 않는다', () => {
    savePlacements('', MONTH, [placement()]);
    expect(loadPlacements('', MONTH)).toEqual([]);
  });
});

describe('상한은 붙일 때 걸린다', () => {
  const full = Array.from({ length: PLACEMENT_LIMIT }, (_, i) => placement({ id: `p${i}` }));

  it('상한에 닿으면 더 붙지 않는다', () => {
    /*
      화면에는 붙었는데 저장할 때만 잘리면, 다시 열었을 때 방금 붙인 것이 없다.
      **붙지 않는 것이 붙었다 사라지는 것보다 낫다.**
    */
    expect(place(full, 'heart', 0.1, 0.1, 0, 'new')).toHaveLength(PLACEMENT_LIMIT);
    expect(place(full, 'heart', 0.1, 0.1, 0, 'new').some((p) => p.id === 'new')).toBe(false);
  });

  it('상한 아래에서는 붙는다', () => {
    expect(place(full.slice(0, 3), 'star', 0.2, 0.3, 5, 'new')).toHaveLength(4);
  });

  it('목록에 없는 스티커는 붙지 않는다', () => {
    expect(place([], 'gone', 0.2, 0.3, 5, 'new')).toEqual([]);
  });

  it('붙일 때도 좌표를 지면 안으로 되돌린다', () => {
    expect(place([], 'heart', 9, -9, 0, 'new')[0]).toMatchObject({ x: 1, y: 0 });
  });
});

describe('떼기', () => {
  it('그 하나만 뗀다', () => {
    const before = [placement(), placement({ id: 'p2', stickerId: 'star' })];
    expect(remove(before, 'p1').map((p) => p.id)).toEqual(['p2']);
  });

  it('없는 것을 떼도 나머지가 그대로다', () => {
    const before = [placement()];
    expect(remove(before, 'nope')).toEqual(before);
  });
});

describe('기본 세트', () => {
  it('열두 개이고 id 가 겹치지 않는다', () => {
    expect(STICKERS).toHaveLength(12);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(12);
  });

  it('전부 읽을 이름을 갖는다', () => {
    // 스크린리더가 읽는 것이 이것이다. 없으면 그 스티커는 이름 없는 버튼이 된다.
    for (const sticker of STICKERS) {
      expect(sticker.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('유료 표시가 없다', () => {
    /*
      §9.5 -- 유료 스티커는 Memory Product 의 지불가치 확인 뒤다. 잠긴 스티커를 목록에
      섞어 두면 무료로 꾸미는 루프가 돌기 전에 결제가 먼저 보인다.
    */
    for (const sticker of STICKERS) {
      expect(sticker).not.toHaveProperty('price');
      expect(sticker).not.toHaveProperty('locked');
      expect(sticker).not.toHaveProperty('premium');
    }
  });
});
