import { beforeEach, describe, expect, it } from 'vitest';
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

    purgeDiaryLocalStateForUser('u1');

    expect(localStorage.getItem('gomsin.diary.page.u1.2026-09-01')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.paper.u1')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.stickers.u1.2026-09')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.shop.u1')).toBeNull();
    expect(localStorage.getItem('gomsin.display.paper.u1')).toBeNull();
    expect(localStorage.getItem('gomsin.diary.page.u2.2026-09-01')).toBe('{}');
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('does nothing without a user id', () => {
    localStorage.setItem('gomsin.diary.paper.u1', 'grid');
    purgeDiaryLocalStateForUser('');
    expect(localStorage.getItem('gomsin.diary.paper.u1')).toBe('grid');
  });
});
