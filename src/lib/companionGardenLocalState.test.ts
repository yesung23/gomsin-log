import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GARDEN_ACCESSORIES,
  loadGardenAccessories,
  saveGardenAccessory,
} from '@/lib/companionGardenLocalState';
import { purgeDiaryLocalStateForUser } from '@/lib/diaryLocalState';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('companion garden local accessories', () => {
  it('starts with no accessories and persists independent choices for the two companions', () => {
    expect(loadGardenAccessories('alice')).toEqual(DEFAULT_GARDEN_ACCESSORIES);

    saveGardenAccessory('alice', 'peach', 'cap');
    saveGardenAccessory('alice', 'sage', 'flower');

    expect(loadGardenAccessories('alice')).toEqual({
      version: 1,
      peach: 'cap',
      sage: 'flower',
    });
  });

  it('keeps accounts isolated on a shared device', () => {
    saveGardenAccessory('alice', 'peach', 'bow');
    saveGardenAccessory('bob', 'peach', 'scarf');

    expect(loadGardenAccessories('alice').peach).toBe('bow');
    expect(loadGardenAccessories('bob').peach).toBe('scarf');
  });

  it('fails closed to safe defaults for malformed JSON and unknown accessories', () => {
    localStorage.setItem('gomsin.diary.garden.alice', '{not-json');
    expect(loadGardenAccessories('alice')).toEqual(DEFAULT_GARDEN_ACCESSORIES);

    localStorage.setItem('gomsin.diary.garden.alice', JSON.stringify({
      version: 1,
      peach: 'crown-from-the-future',
      sage: 'flower',
    }));
    expect(loadGardenAccessories('alice')).toEqual({
      version: 1,
      peach: 'none',
      sage: 'flower',
    });
  });

  it('does not persist anything without an account identity', () => {
    expect(saveGardenAccessory('', 'peach', 'cap')).toEqual(DEFAULT_GARDEN_ACCESSORIES);
    expect(localStorage.length).toBe(0);
  });

  it('returns the prior state when browser storage rejects the write', () => {
    vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    const result = saveGardenAccessory('alice', 'peach', 'cap');

    expect(result).toEqual(DEFAULT_GARDEN_ACCESSORIES);
    expect(loadGardenAccessories('alice')).toEqual(DEFAULT_GARDEN_ACCESSORIES);
  });

  it('is purged with the rest of that account diary metadata on sign-out/delete', () => {
    saveGardenAccessory('alice', 'peach', 'cap');
    saveGardenAccessory('bob', 'sage', 'flower');
    localStorage.setItem('gomsin.diary.page.alice.2026-09-01', '{}');

    purgeDiaryLocalStateForUser('alice');

    expect(localStorage.getItem('gomsin.diary.garden.alice')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.page.alice.2026-09-01')).toBeNull();
    expect(loadGardenAccessories('bob').sage).toBe('flower');
  });
});
