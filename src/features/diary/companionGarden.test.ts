import { describe, expect, it } from 'vitest';
import { COMPANION_GARDEN_STAGES, deriveCompanionGardenState } from './companionGarden';

describe('companion garden growth', () => {
  it.each([
    [1, 1, '작은 싹'],
    [29, 1, '작은 싹'],
    [30, 2, '어린 나무'],
    [99, 2, '어린 나무'],
    [100, 3, '든든한 나무'],
    [364, 3, '든든한 나무'],
    [365, 4, '꽃 피는 나무'],
    [9999, 4, '꽃 피는 나무'],
  ])('%i일은 %i단계 %s이다', (days, level, name) => {
    const state = deriveCompanionGardenState(days);
    expect(state.isAvailable).toBe(true);
    if (state.isAvailable) {
      expect(state.togetherDays).toBe(days);
      expect(state.stage.level).toBe(level);
      expect(state.stage.name).toBe(name);
    }
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    '유효한 함께한 날이 없으면 %s를 가짜 1단계로 만들지 않는다',
    (days) => {
      expect(deriveCompanionGardenState(days)).toEqual({
        isAvailable: false,
        togetherDays: null,
        stage: null,
      });
    },
  );

  it('소수 일수는 완전히 지난 날만 사용한다', () => {
    const state = deriveCompanionGardenState(30.9);
    expect(state.isAvailable).toBe(true);
    if (state.isAvailable) {
      expect(state.togetherDays).toBe(30);
      expect(state.stage.level).toBe(2);
    }
  });

  it('단계는 빈틈이나 겹침 없이 네 구간이다', () => {
    expect(COMPANION_GARDEN_STAGES.map(({ minDays, maxDays }) => [minDays, maxDays])).toEqual([
      [1, 29],
      [30, 99],
      [100, 364],
      [365, null],
    ]);
  });
});
