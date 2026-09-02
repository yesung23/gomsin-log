import { beforeEach, describe, expect, it } from 'vitest';
import {
  collectCompanionPaper,
  drawDailyAccessory,
  loadCompanionShopState,
  saveCompanionShopState,
} from './companionShopLocalState';

beforeEach(() => localStorage.clear());

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
      lastFreeDrawDate: 123,
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

  it('draws an unowned accessory once per local calendar day without duplicates', () => {
    saveCompanionShopState('u1', {
      version: 1,
      ownedAccessories: ['cap'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    });

    const first = drawDailyAccessory('u1', '2026-09-01', () => 0);
    expect(first).toMatchObject({ status: 'drawn', accessory: 'bow' });
    expect(first.state.ownedAccessories).toEqual(['cap', 'bow']);

    const second = drawDailyAccessory('u1', '2026-09-01', () => 0.99);
    expect(second).toMatchObject({ status: 'used_today', accessory: null });
    expect(second.state.ownedAccessories).toEqual(['cap', 'bow']);
  });

  it('does not consume the day when every accessory is already owned', () => {
    saveCompanionShopState('u1', {
      version: 1,
      ownedAccessories: ['cap', 'bow', 'scarf', 'flower'],
      ownedPapers: ['plain', 'ruled'],
      lastFreeDrawDate: null,
    });

    const result = drawDailyAccessory('u1', '2026-09-01', () => 0);
    expect(result).toMatchObject({ status: 'complete', accessory: null });
    expect(result.state.lastFreeDrawDate).toBeNull();
  });

  it('rejects an invalid local calendar date without granting an accessory', () => {
    const first = drawDailyAccessory('u1', '2026-02-30', () => 0);
    const second = drawDailyAccessory('u1', 'not-a-date', () => 0.99);

    expect(first).toMatchObject({ status: 'invalid_date', accessory: null });
    expect(second).toMatchObject({ status: 'invalid_date', accessory: null });
    expect(loadCompanionShopState('u1')).toMatchObject({
      ownedAccessories: [],
      lastFreeDrawDate: null,
    });
  });
});
