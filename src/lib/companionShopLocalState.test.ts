import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectCompanionAccessory,
  collectCompanionPaper,
  loadCompanionShopState,
  saveCompanionShopState,
} from './companionShopLocalState';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('companion shop account-local collection', () => {
  it('starts each account with only the existing plain and ruled papers', () => {
    expect(loadCompanionShopState('u1')).toMatchObject({
      version: 1,
      ownedAccessories: [],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    });
    expect(loadCompanionShopState('u2').ownedPapers).toEqual(['plain', 'ruled']);
  });

  it('falls back safely when stored collection data is malformed', () => {
    localStorage.setItem('gomsin.diary.shop.u1', '{not-json');
    expect(loadCompanionShopState('u1').ownedAccessories).toEqual([]);

    localStorage.setItem('gomsin.diary.shop.u1', JSON.stringify({
      version: 1,
      ownedAccessories: ['crown', 'cap'],
      ownedPapers: ['plain', 'gold'],
      lastFreeDrawDate: '2026-02-30',
    }));
    expect(loadCompanionShopState('u1')).toMatchObject({
      ownedAccessories: ['cap'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    });
  });

  it('migrates a previously equipped accessory into ownership', () => {
    localStorage.setItem('gomsin.diary.garden.u1', JSON.stringify({
      version: 1,
      peach: 'scarf',
      sage: 'none',
    }));

    expect(loadCompanionShopState('u1').ownedAccessories).toEqual(['scarf']);

    localStorage.setItem('gomsin.diary.garden.u1', JSON.stringify({
      version: 1,
      peach: 'none',
      sage: 'none',
    }));

    expect(loadCompanionShopState('u1').ownedAccessories).toEqual(['scarf']);
  });

  it('collects a paper for only the active account', () => {
    collectCompanionPaper('u1', 'grid');

    expect(loadCompanionShopState('u1').ownedPapers).toEqual(['plain', 'ruled', 'grid']);
    expect(loadCompanionShopState('u2').ownedPapers).toEqual(['plain', 'ruled']);
  });

  it('does not collect a paper without an account identifier', () => {
    const result = collectCompanionPaper('', 'grid');

    expect(result.ownedPapers).toEqual(['plain', 'ruled']);
    expect(localStorage.length).toBe(0);
  });

  it('collects the exact selected accessory and preserves the legacy draw date', () => {
    saveCompanionShopState('u1', {
      version: 1,
      ownedAccessories: ['cap'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: '2026-09-01',
    });

    const result = collectCompanionAccessory('u1', 'flower');

    expect(result.ownedAccessories).toEqual(['cap', 'flower']);
    expect(result.lastFreeDrawDate).toBe('2026-09-01');
  });

  it('is idempotent when the selected accessory is already owned', () => {
    saveCompanionShopState('u1', {
      version: 1,
      ownedAccessories: ['cap', 'bow'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: '2026-01-01',
    });

    const result = collectCompanionAccessory('u1', 'cap');

    expect(result.ownedAccessories).toEqual(['cap', 'bow']);
    expect(loadCompanionShopState('u1').ownedAccessories).toEqual(['cap', 'bow']);
  });

  it('keeps accessory collections separate for each account', () => {
    collectCompanionAccessory('u1', 'scarf');

    expect(loadCompanionShopState('u1').ownedAccessories).toEqual(['scarf']);
    expect(loadCompanionShopState('u2').ownedAccessories).toEqual([]);
  });

  it('does not collect without an account identifier', () => {
    const result = collectCompanionAccessory('', 'cap');

    expect(result.ownedAccessories).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('returns the prior collection when browser storage rejects an accessory write', () => {
    vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    const result = collectCompanionAccessory('u1', 'flower');

    expect(result.ownedAccessories).toEqual([]);
    expect(loadCompanionShopState('u1').ownedAccessories).toEqual([]);
  });
});
