import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, Role } from '@/types';

/**
 * H-4: /schedule, /trips and /service must have an entry point that a user
 * cannot delete.
 *
 * `MobileShell`'s tab bar exposes only /home, /record, /us and /my. Before this
 * fix:
 *
 *   - /schedule and /trips were reachable ONLY from `UpcomingScheduleWidget`
 *     (일정 추가 and 여행 플래너);
 *   - /service only from `DDayWidget`'s 복무 현황 card, plus a SOLDIER-ONLY row
 *     in settings -- so a 곰신 had no durable route to it at all.
 *
 * The dashboard layout is user-editable (`setWidgetLayout`,
 * `AddWidgetBottomSheet`), `App.tsx` redirects `*` to `/`, and the native shell
 * has no address bar. So removing the schedule widget stranded two whole
 * features permanently with no recovery path.
 *
 * Settings is always reachable (`WidgetDashboard` and `DDayWidget` both link to
 * it), which is why the durable entry point belongs there. The tab bar is
 * deliberately NOT restructured.
 */

const navigate = vi.hoisted(() => vi.fn());
const setPartnerUsername = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: null,
  consumeCoupleInvitation: vi.fn(),
  regenerateCoupleInvitation: vi.fn(),
}));

let currentRole: Role = 'gomsin';

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'u1', email: 'a@b.c', provider: 'google' },
    profile: {
      id: 'u1',
      myName: currentRole === 'gomsin' ? '춘향' : '몽룡',
      role: currentRole,
      couple: {
        coupleId: 'c1',
        partnerName: currentRole === 'gomsin' ? '몽룡' : '춘향',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
      contact: {
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '12:00',
        weekendEnd: '21:00',
        enabled: true,
      },
    },
    records: [],
    events: [],
    trips: [],
    // The stranding condition: the schedule widget has been removed.
    widgetLayout: ['today_word'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as AppState;
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    updateProfile: vi.fn(),
    disconnect: vi.fn(),
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
    setTheme: vi.fn(),
    refreshInvitation: vi.fn(),
    exportMyData: vi.fn(),
    setPartnerUsername,
  }),
}));

const { SettingsPage } = await import('@/pages/SettingsPage');

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

/** Routes that have no tab and were reachable only from a deletable widget. */
const ORPHANED_ROUTES = [
  { to: '/schedule', label: '일정 관리' },
  { to: '/trips', label: '여행 플래너' },
  { to: '/service', label: '복무 현황 · D-Day' },
] as const;

describe('H-4: settings offers a durable route to every non-tab feature', () => {
  beforeEach(() => {
    navigate.mockReset();
    setPartnerUsername.mockReset().mockResolvedValue(true);
    currentRole = 'gomsin';
  });

  for (const { to, label } of ORPHANED_ROUTES) {
    it(`navigates to ${to} even with the schedule widget removed`, async () => {
      const user = userEvent.setup();
      renderSettings();
      await user.click(screen.getByRole('button', { name: label }));
      expect(navigate).toHaveBeenCalledWith(to);
    });
  }

  it('offers all three to a 곰신, who cannot see the soldier-only rows', async () => {
    currentRole = 'gomsin';
    renderSettings();
    for (const { label } of ORPHANED_ROUTES) {
      expect(screen.getByRole('button', { name: label }), label).toBeTruthy();
    }
  });

  it('offers all three to a 군화 as well', async () => {
    currentRole = 'soldier';
    renderSettings();
    for (const { label } of ORPHANED_ROUTES) {
      expect(screen.getByRole('button', { name: label }), label).toBeTruthy();
    }
  });

  it('groups them under a labelled shortcut section', () => {
    renderSettings();
    expect(screen.getByText('바로가기')).toBeTruthy();
  });

  it('프로필 편집 안에서 상대방 아이디를 저장할 수 있다', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: '내 프로필 수정' }));

    const dialog = screen.getByRole('dialog', { name: '내 프로필 수정' });
    const input = within(dialog).getByRole('textbox', { name: '군화 영어 아이디' });
    await user.type(input, 'partner_name');
    await user.click(within(dialog).getByRole('button', { name: '상대방 아이디 저장' }));

    expect(setPartnerUsername).toHaveBeenCalledWith('partner_name');
  });
});

describe('H-4: the entry point survives the conditions that caused the stranding', () => {
  const settings = readFileSync(resolve(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');

  it('the shortcut list is not behind a role or connection condition', () => {
    // A conditional entry point is not a durable one.
    const at = settings.indexOf('바로가기');
    expect(at).toBeGreaterThan(-1);
    const section = settings.slice(at - 700, at);
    expect(section).not.toContain("profile.role === 'soldier' && (");
    expect(section).not.toContain('couple.connected && (');
  });

  it('every shortcut declares a 44px tap target (themeTokens C6 rule)', () => {
    /*
     * The guarantee moved, it did not go away.
     *
     * These shortcuts used to be hand-rolled buttons that each spelled out
     * `min-h-[44px] min-w-[44px]`. The 2026-08-08 visual revision converts repeated
     * menu items to `RowGroup` + `PressableRow`, because a settings menu is repeated
     * data and Surface economy forbids one card per item. The 44px now comes from
     * the primitive instead of from a copy of the utility per row.
     *
     * So this asserts the same fact one level down: the shortcuts are built from
     * `PressableRow`, and `PressableRow` is what carries the height. `min-h-11` IS
     * 44px (11 * 4px). Checking the primitive is strictly stronger than checking a
     * substring, because it cannot pass while a single row opts out.
     */
    const at = settings.indexOf('바로가기');
    const section = settings.slice(at, at + 1200);
    expect(section).toContain('PressableRow');

    const list = readFileSync(resolve(process.cwd(), 'src/components/ui/List.tsx'), 'utf8');
    const pressable = list.slice(list.indexOf('export function PressableRow'));
    expect(pressable).toContain('min-h-11');
  });

  it('uses semantic tokens only, never a palette literal (themeTokens C4 rule)', () => {
    const at = settings.indexOf('바로가기');
    const section = settings.slice(at, at + 1200);
    const PALETTE_LITERAL =
      /\b(?:bg|text|border|from|to|via|ring|divide|placeholder)-(?:white|black|gray|slate|zinc|neutral|stone)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;
    expect(section.match(PALETTE_LITERAL) ?? []).toEqual([]);
    // ...and never --navy as a foreground (C5 rule).
    expect(section.match(/\btext-navy(?:\/\d{1,3})?\b/g) ?? []).toEqual([]);
  });

  /**
   * The tab bar gained 일정 as a fifth tab.
   *
   * This assertion used to pin the bar at exactly four tabs, and that was the
   * right guard at the time: /schedule and /trips were reachable only from a
   * deletable widget, and the fix deliberately put the durable entry point in
   * settings instead of restructuring navigation.
   *
   * The planning surface has now been promoted to a real tab, which fixes the
   * root cause rather than routing around it -- and also fixes standing on
   * /trips with NO tab highlighted, which told the user they were nowhere.
   *
   * The guard is kept, not weakened: the four original destinations must all
   * still be present, so this still fails if navigation quietly loses one.
   */
  it('탭바가 다섯 칸이고, 그리드가 그 수와 맞는다', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'src/components/MobileShell.tsx'),
      'utf8',
    );
    const tabs = [...shell.matchAll(/to: '(\/[a-z]+)'/g)].map((match) => match[1]);
    expect(tabs).toEqual(['/home', '/search', '/diary', '/schedule', '/us']);
    // 그리드가 실제로 그리는 칸 수와 맞아야 한다. 어긋나면 칸 하나가 잘리거나 빈다.
    expect(shell).toContain(`grid-cols-${tabs.length}`);
  });

  /**
   * 어느 화면도 어느 탭에도 속하지 않는 상태가 없다.
   *
   * 앞선 판은 탭 목록을 글자 그대로 적어 두고 그것이 안 바뀌었는지 봤다. 그 테스트는
   * 탭이 재편될 때 **반드시** 깨지지만, 정작 재편이 만드는 진짜 사고는 잡지 못한다 --
   * 탭을 잃은 화면(`/my`, `/settings`, `/record`, `/service`)이 아무 탭에도 안 걸려서
   * 서 있는 동안 앱이 "당신은 아무 데도 없다"고 말하는 것.
   *
   * 그래서 목록이 아니라 **덮이는지**를 본다. 라우터가 셸 안에서 서비스하는 경로를
   * `App.tsx` 에서 읽어 와, 각각이 어떤 탭의 `matchPrefixes` 에 걸리는지 확인한다.
   * 새 화면을 추가하면서 탭에 안 걸면 여기서 걸린다.
   */
  it('셸이 서비스하는 모든 경로가 어떤 탭에든 걸린다', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'src/components/MobileShell.tsx'),
      'utf8',
    );
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

    const prefixes = [...shell.matchAll(/matchPrefixes: \[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((inner) => inner[1]));
    expect(prefixes.length, 'matchPrefixes 를 못 읽었다').toBeGreaterThan(5);

    const routes = [...app.matchAll(/<Route path="(\/[a-z][a-z/:-]*)"/g)]
      .map((match) => match[1])
      // 셸 밖에서 그려지는 것들. 탭바가 없으므로 걸릴 탭도 없다.
      .filter((path) => !path.startsWith('/auth') && !path.startsWith('/legal')
        && !path.startsWith('/onboarding') && !path.startsWith('/story'))
      /*
        가운데 칸은 **장소가 아니라 동작**이다.

        `/compose` 는 탭바에 있지만 어떤 경로에서도 선택되지 않는다(`matchPrefixes: []`)
        -- 인스타의 만들기 탭도 같다: 눌리면 컴포저가 열리고 탭바는 원래 있던 곳을 계속
        가리킨다. 그래서 "어느 탭에도 안 걸린다"가 여기서는 결함이 아니라 설계다.

        이 예외를 목록에 적어 두는 것은 아래 단언이 그것 하나만 봐주게 하기 위해서다.
        다른 화면이 같은 상태가 되면 여전히 걸린다.
      */
      .filter((path) => path !== '/compose')
      // `:id` 자리는 접두사 판정에 쓰이지 않으므로 부모까지만 본다.
      .map((path) => path.replace(/\/:[^/]+$/, ''));
    expect(routes.length, '라우트를 못 읽었다').toBeGreaterThan(8);

    const orphans = routes.filter((path) => !prefixes.some(
      (prefix) => prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`),
    ));
    expect(orphans, '이 화면들은 어느 탭에도 걸리지 않는다').toEqual([]);
  });

  it('섹션 안의 상세 화면에서도 그 섹션이 켜져 있다', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'src/components/MobileShell.tsx'),
      'utf8',
    );
    // `/trips/:id` 는 일정을, `/settings` 는 우리를 켠다. 위의 덮임 검사는 "어딘가에
    // 걸린다"만 보므로, 어느 탭이 맞는지는 여기서 못 박는다.
    expect(shell).toContain("matchPrefixes: ['/schedule', '/trips']");
    expect(shell).toContain("matchPrefixes: ['/us', '/me', '/service', '/my', '/settings']");
    expect(shell).toContain("matchPrefixes: ['/diary', '/shop']");
    // 검색 결과가 데려가는 곳이 원본이므로, 원본을 보는 동안 켜지는 것은 그리로 온 문이다.
    expect(shell).toContain("matchPrefixes: ['/search', '/record']");
  });

  it('PRESERVATION: the widget entry points still exist for users who kept them', () => {
    const widget = readFileSync(
      resolve(process.cwd(), 'src/components/widgets/UpcomingScheduleWidget.tsx'),
      'utf8',
    );
    expect(widget).toContain("navigate('/schedule')");
    expect(widget).toContain("navigate('/trips')");
    const dday = readFileSync(
      resolve(process.cwd(), 'src/components/widgets/DDayWidget.tsx'),
      'utf8',
    );
    expect(dday).toContain("navigate('/service')");
  });

  it('documents that settings itself is always reachable', () => {
    // The whole fix depends on this, so it is asserted rather than assumed.
    const dashboard = readFileSync(
      resolve(process.cwd(), 'src/features/home/RoleHome.tsx'),
      'utf8',
    );
    const dday = readFileSync(
      resolve(process.cwd(), 'src/components/widgets/DDayWidget.tsx'),
      'utf8',
    );
    expect(
      dashboard.includes("navigate('/settings')") || dday.includes("navigate('/settings')"),
    ).toBe(true);
  });
});
