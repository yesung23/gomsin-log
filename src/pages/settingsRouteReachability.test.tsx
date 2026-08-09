import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
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
    isDemoMode: false,
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
  it('PRESERVATION: the tab bar keeps all four original tabs, plus 일정', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'src/components/MobileShell.tsx'),
      'utf8',
    );
    const tabs = [...shell.matchAll(/to: '(\/[a-z]+)'/g)].map((match) => match[1]);
    expect(tabs).toEqual(['/home', '/record', '/schedule', '/us', '/my']);
    for (const original of ['/home', '/record', '/us', '/my']) {
      expect(tabs, `original tab ${original} must survive`).toContain(original);
    }
    // The grid must actually fit the tabs it renders.
    expect(shell).toContain(`grid-cols-${tabs.length}`);
  });

  it('every tab keeps its section lit on detail screens', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'src/components/MobileShell.tsx'),
      'utf8',
    );
    // /trips/:id must light 일정, and /settings must light 마이 -- otherwise a
    // detail screen looks like it belongs to no section at all.
    expect(shell).toContain("matchPrefixes: ['/schedule', '/trips']");
    expect(shell).toContain("matchPrefixes: ['/my', '/settings']");
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
      resolve(process.cwd(), 'src/features/home/WidgetDashboard.tsx'),
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
