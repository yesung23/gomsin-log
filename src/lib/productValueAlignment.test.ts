import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_BY_ROLE, migrateWidgetLayout } from '@/lib/widgets';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('product value alignment', () => {
  it('puts lightweight capture first on the waiting partner home', () => {
    expect(DEFAULT_LAYOUT_BY_ROLE.gomsin[0]).toBe('today_word');
  });

  it('migrates only the untouched legacy default and preserves customization', () => {
    // Migrates forward to the CURRENT gomsin default, whatever that is --
    // asserted against DEFAULT_LAYOUT_BY_ROLE.gomsin rather than a literal
    // array, so this does not silently re-pin a stale default the next time
    // it changes (it already has once: partner_day was added in P0-a).
    expect(migrateWidgetLayout(['today_briefing', 'today_word', 'dday'], 'gomsin'))
      .toEqual(DEFAULT_LAYOUT_BY_ROLE.gomsin);
    expect(migrateWidgetLayout(['dday', 'today_word'], 'gomsin'))
      .toEqual(['dday', 'today_word']);
    expect(migrateWidgetLayout(['partner_day', 'dday'], 'soldier'))
      .toEqual(['partner_day', 'dday']);
  });

  it('gives both soldier shortcuts a real destination and removes stale benefit copy', () => {
    const source = read('src/pages/MyPage.tsx');
    expect(source).toContain("onClick={() => navigate('/service')}");
    expect(source).toContain("onClick={() => navigate('/schedule')}");
    expect(source).not.toContain('병사 적금');
    expect(source).not.toContain('혜택 모음');
  });

  it('keeps success copy warm without decorative emoji noise', () => {
    const source = read('src/components/widgets/TodayLogWidget.tsx');
    expect(source).toContain("'나에게만 남겼어요.'");
    expect(source).toContain('에게 전했어요.');
    expect(source).not.toContain('전해졌어요! 💕');
  });
});
