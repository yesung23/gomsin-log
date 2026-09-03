import { describe, expect, it } from 'vitest';
import {
  STARTER_ACCESSORY_IDS,
  STARTER_ACCESSORY_OPTIONS,
  drawStarterAccessory,
  getAvailableStarterPool,
} from './companionStarterReveal';

describe('companion starter reveal pool and draw logic', () => {
  it('has exactly the 5 approved source-sheet accessories in STARTER_ACCESSORY_OPTIONS', () => {
    expect(STARTER_ACCESSORY_IDS).toEqual(['boots', 'sneakers', 'letter', 'dogtag', 'plane']);
    expect(STARTER_ACCESSORY_OPTIONS.map((opt) => opt.id)).toEqual(STARTER_ACCESSORY_IDS);
    expect(STARTER_ACCESSORY_OPTIONS.map((opt) => opt.label)).toEqual([
      '검정 부츠',
      '운동화',
      '하트 편지',
      '메탈 펜던트',
      '종이비행기',
    ]);
  });

  it('filters out already owned items from the available starter pool', () => {
    expect(getAvailableStarterPool([])).toEqual(STARTER_ACCESSORY_IDS);
    expect(getAvailableStarterPool(['boots', 'cap' as any])).toEqual(['sneakers', 'letter', 'dogtag', 'plane']);
    expect(getAvailableStarterPool(['boots', 'sneakers', 'letter', 'dogtag', 'plane'])).toEqual([]);
  });

  it('draws deterministically when custom random is provided', () => {
    // 0 -> index 0 (boots)
    const res1 = drawStarterAccessory([], () => 0);
    expect(res1.status).toBe('drawn');
    if (res1.status === 'drawn') {
      expect(res1.item.id).toBe('boots');
    }

    // 0.999 -> last index (plane)
    const res2 = drawStarterAccessory([], () => 0.999);
    expect(res2.status).toBe('drawn');
    if (res2.status === 'drawn') {
      expect(res2.item.id).toBe('plane');
    }
  });

  it('clamps invalid random numbers (negative, >=1, NaN, infinite) safely', () => {
    const resNeg = drawStarterAccessory([], () => -0.5);
    expect(resNeg.status).toBe('drawn');
    if (resNeg.status === 'drawn') expect(resNeg.item.id).toBe('boots');

    const resOver = drawStarterAccessory([], () => 1.5);
    expect(resOver.status).toBe('drawn');
    if (resOver.status === 'drawn') expect(resOver.item.id).toBe('plane');

    const resNaN = drawStarterAccessory([], () => Number.NaN);
    expect(resNaN.status).toBe('drawn');
    if (resNaN.status === 'drawn') expect(resNaN.item.id).toBe('boots');
  });

  it('returns complete when all starter items are owned', () => {
    const res = drawStarterAccessory(['boots', 'sneakers', 'letter', 'dogtag', 'plane']);
    expect(res.status).toBe('complete');
  });
});
