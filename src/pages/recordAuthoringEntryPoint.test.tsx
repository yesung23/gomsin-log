import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord, Role } from '@/types';
import { DEFAULT_LAYOUT_BY_ROLE, HOME_CORE_BY_ROLE } from '@/lib/widgets';

/**
 * PRODUCT_V3 §7.1, stated as a contract rather than a preference:
 *
 *   "작성 진입점 계약: 기록 작성 진입점은 기록 탭에 상시 존재하며 제거할 수 없다.
 *    홈의 컴포저는 추가 경로이지 유일한 경로가 아니다. 사용자가 홈을 어떻게
 *    구성하든 기록을 남길 수 있어야 한다."
 *
 * The 군화 default home is `['partner_day', 'talk_about_list', 'dday']` -- it
 * carries no composer at all. So for that role the 기록 tab is not a convenience,
 * it is the ONLY authoring path, and the existing RecordPage suite renders the
 * page exclusively as a 곰신 (`role: 'gomsin'`). Nothing asserted that a soldier
 * can reach the composer, and nothing asserted that the entry point survives an
 * empty or rearranged home layout.
 *
 * These are cheap assertions for a contract whose failure mode is a partner who
 * cannot write anything at all.
 */

const ME = 'user-me';

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const queueRecordForLater = vi.fn(async () => ({ queued: true }));

let currentState: AppState;

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: 'live' as const,
    updateRecord: vi.fn(async () => ({ ok: true as const })),
    deleteRecord: vi.fn(async () => ({ ok: true as const })),
    updateRecordMedia: vi.fn(async () => ({ ok: true as const, failedFiles: [] as string[] })),
    setHighlightedRecordId: vi.fn(),
    markTalkAbout: vi.fn(async () => ({ ok: true })),
    unmarkTalkAbout: vi.fn(async () => ({ ok: true })),
    resolveTalkAbout: vi.fn(async () => ({ ok: true })),
    addRecordWithMedia,
    queueRecordForLater,
    outboxWaiting: 0,
    outboxBlocked: 0,
    retryBlockedRecords: vi.fn(),
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');

function makeState(role: Role, widgetLayout: string[], records: DailyRecord[] = []): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: role === 'soldier' ? '몽룡' : '춘향',
      role,
      couple: {
        coupleId: 'couple-1',
        partnerName: role === 'soldier' ? '춘향' : '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    talkAboutMarks: [],
    widgetLayout,
    soldierWidgetLayout: widgetLayout,
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

function renderPage(role: Role, widgetLayout: string[] = []) {
  currentState = makeState(role, widgetLayout);
  return render(
    <MemoryRouter initialEntries={['/record']}>
      <RecordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  addRecordWithMedia.mockClear();
  queueRecordForLater.mockClear();
});

describe('§7.1 the 기록 tab authoring entry point exists for BOTH roles', () => {
  for (const role of ['gomsin', 'soldier'] as const) {
    it(`${role} finds the composer entry point on the 기록 tab`, () => {
      renderPage(role);
      expect(screen.getByRole('button', { name: /기록 남기기/ })).toBeEnabled();
    });

    it(`${role} completes a one-line record from the 기록 tab, end to end`, async () => {
      // §7.1's target is a lightweight record in about thirty seconds, so the
      // whole path is asserted, not just that a button exists: open, pick 한줄,
      // type one line, save, and see the write actually leave with this role
      // stamped on it.
      const user = userEvent.setup();
      renderPage(role);

      await user.click(screen.getByRole('button', { name: /기록 남기기/ }));
      expect(await screen.findByRole('dialog', { name: '기록 남기기' }))
        .toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /한줄/ }));
      await user.type(await screen.findByLabelText('오늘의 기록'), `${role}이 쓴 한 줄`);
      await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

      await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
      expect(addRecordWithMedia.mock.calls[0][0]).toMatchObject({
        log: `${role}이 쓴 한 줄`,
        authorRole: role,
      });
    });
  }

  /**
   * The premise of this file changed, and the requirement did not.
   *
   * This used to assert that 군화's default home carried NO composer -- which was
   * true, and was the defect rather than the reason. §5.1 says the record entry
   * exists for both roles, and the soldier default simply omitted it, so the
   * person with the scarce phone window had to go and add one.
   *
   * The home now PINS a composer for both roles. §7.1 is unaffected: the home was
   * always an additional path, and the 기록 tab's entry is load-bearing precisely
   * because a home can be rearranged and this one cannot be relied upon to be
   * where someone left it. Every other test in this file is what proves that, and
   * they run with the home stripped to nothing.
   */
  it('pins a composer on the home for BOTH roles, which the tab does not depend on', () => {
    expect(HOME_CORE_BY_ROLE.soldier).toContain('today_word');
    expect(HOME_CORE_BY_ROLE.gomsin).toContain('today_word');
    // ...and it is no longer in either arrangeable layer, so it cannot be removed
    // from the home at all.
    expect(DEFAULT_LAYOUT_BY_ROLE.soldier).not.toContain('today_word');
    expect(DEFAULT_LAYOUT_BY_ROLE.gomsin).not.toContain('today_word');
  });

  it('survives a home stripped to nothing, for either role', () => {
    // "사용자가 홈을 어떻게 구성하든 기록을 남길 수 있어야 한다."
    for (const role of ['gomsin', 'soldier'] as const) {
      const { unmount } = renderPage(role, []);
      expect(screen.getByRole('button', { name: /기록 남기기/ })).toBeEnabled();
      unmount();
    }
  });

  it('survives a home rearranged to widgets that cannot author', () => {
    for (const role of ['gomsin', 'soldier'] as const) {
      const { unmount } = renderPage(role, ['dday', 'partner_day']);
      expect(screen.getByRole('button', { name: /기록 남기기/ })).toBeEnabled();
      unmount();
    }
  });
});
