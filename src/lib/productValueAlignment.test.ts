import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_BY_ROLE,
  HOME_CORE_BY_ROLE,
  isHomeCore,
  migrateWidgetLayout,
  widgetsForRole,
} from '@/lib/widgets';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('product value alignment', () => {
  it('puts lightweight capture first on the waiting partner home', () => {
    /*
      기록 진입점이 곰신 홈의 맨 앞에 있어야 한다는 요구는 그대로다. 달라진 것은 그것이
      이제 두 표면에 있다는 것이다 -- 레일 오른쪽 링의 `+`와 그 아래 컴포저.

      그래서 단언을 "0번이 today_word"에서 "레일이 먼저이고 그 바로 다음이 today_word"로
      옮긴다. 리터럴 배열로 고정하지 않는 이유는 이전 주석과 같다: 다음에 코어가 바뀔 때
      낡은 기본값을 조용히 다시 못 박게 된다.
    */
    expect(HOME_CORE_BY_ROLE.gomsin[0]).toBe('story_rail');
    expect(HOME_CORE_BY_ROLE.gomsin[1]).toBe('today_word');
  });

  it('gives both roles the same first surface', () => {
    /*
      역할별 홈은 유지하되, 두 사람이 같은 것을 먼저 본다. 첫 화면의 구조 자체가 다르면
      서로가 무엇을 보고 있는지 상상할 수 없고, 그것은 커플 제품에서 잃으면 안 되는
      감각이다. 레일 아래의 순서는 여전히 역할별이다.
    */
    expect(HOME_CORE_BY_ROLE.soldier[0]).toBe('story_rail');
    expect(HOME_CORE_BY_ROLE.soldier[1]).toBe('call_briefing');
  });

  it('keeps the rail out of the arrangeable layer', () => {
    // 코어는 제거·재배치할 수 없다. 위젯 추가 시트에 나타나면 제거를 제안하는 셈이 된다.
    expect(isHomeCore('story_rail', 'gomsin')).toBe(true);
    expect(isHomeCore('story_rail', 'soldier')).toBe(true);
    expect(widgetsForRole('gomsin').map((w) => w.id)).not.toContain('story_rail');
    expect(widgetsForRole('soldier').map((w) => w.id)).not.toContain('story_rail');
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
