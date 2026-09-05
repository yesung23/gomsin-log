import { describe, expect, it } from 'vitest';
import {
  STARTER_ACCESSORY_IDS,
  STARTER_ACCESSORY_OPTIONS,
  getAvailableStarterPool,
} from './companionStarterReveal';

describe('companion starter direct-choice collection', () => {
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

  it('keeps the full set available for explicit user choice until each item is owned', () => {
    expect(getAvailableStarterPool(['letter'])).toEqual(['boots', 'sneakers', 'dogtag', 'plane']);
  });
});
