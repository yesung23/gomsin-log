import { describe, expect, it } from 'vitest';
import {
  COMPANION_GARDEN_STAGES,
  deriveCompanionGardenState,
  getCompanionGardenTreeHeightPx,
} from './companionGarden';

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

  it.each([
    [1, 85],
    [15, 93],
    [29, 100],
    [30, 185],
    [99, 227],
    [100, 237],
    [364, 281],
    [365, 284],
    [730, 304],
    [9999, 304],
  ])('%i일의 나무 높이는 %ipx로 단계 안에서도 자란다', (days, height) => {
    expect(getCompanionGardenTreeHeightPx(days)).toBe(height);
  });

  it.each([320, 390])('%ipx 화면에서도 함께한 날이 늘 때 실제 표시 높이가 작아지지 않는다', (viewportWidth) => {
    const heights = Array.from({ length: 730 }, (_, index) => Math.min(
      viewportWidth * 0.76,
      getCompanionGardenTreeHeightPx(index + 1),
    ));
    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index]).toBeGreaterThanOrEqual(heights[index - 1]);
    }
  });
});
