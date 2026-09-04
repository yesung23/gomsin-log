import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeDiaryLocalStateForUser } from './diaryLocalState';

beforeEach(() => localStorage.clear());

describe('purgeDiaryLocalStateForUser', () => {
  it('removes page, paper and legacy sticker metadata for only the signed-out account', () => {
    localStorage.setItem('gomsin.diary.page.u1.2026-09-01', '{}');
    localStorage.setItem('gomsin.diary.paper.u1', 'grid');
    localStorage.setItem('gomsin.diary.stickers.u1.2026-09', '[]');
    localStorage.setItem('gomsin.diary.shop.u1', '{}');
    localStorage.setItem('gomsin.display.paper.u1', 'dot');
    localStorage.setItem('gomsin.diary.page.u2.2026-09-01', '{}');
    localStorage.setItem('unrelated', 'keep');

    expect(purgeDiaryLocalStateForUser('u1')).toBe(true);

    expect(localStorage.getItem('gomsin.diary.page.u1.2026-09-01')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.paper.u1')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.stickers.u1.2026-09')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.shop.u1')).toBeNull();
    expect(localStorage.getItem('gomsin.display.paper.u1')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.page.u2.2026-09-01')).toBe('{}');
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('does not purge another account whose id only shares the same prefix', () => {
    localStorage.setItem('gomsin.diary.paper.u1', 'grid');
    localStorage.setItem('gomsin.diary.page.u1.2026-09-01', '{}');
    localStorage.setItem('gomsin.diary.paper.u10', 'plain');
    localStorage.setItem('gomsin.diary.page.u10.2026-09-01', '{"owner":"u10"}');

    expect(purgeDiaryLocalStateForUser('u1')).toBe(true);

    expect(localStorage.getItem('gomsin.diary.paper.u1')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.page.u1.2026-09-01')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.paper.u10')).toBe('plain');
    expect(localStorage.getItem('gomsin.diary.page.u10.2026-09-01')).toBe('{"owner":"u10"}');
  });

  it('returns false when removal does not survive an exact read-back', () => {
    const values = new Map([['gomsin.diary.paper.u1', 'grid']]);
    const storage = {
      get length() { return values.size; },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: vi.fn(),
    };

    expect(purgeDiaryLocalStateForUser('u1', storage)).toBe(false);
    expect(values.get('gomsin.diary.paper.u1')).toBe('grid');
  });

  it('does nothing without a user id', () => {
    localStorage.setItem('gomsin.diary.paper.u1', 'grid');
    purgeDiaryLocalStateForUser('');
    expect(localStorage.getItem('gomsin.diary.paper.u1')).toBe('grid');
  });
});
