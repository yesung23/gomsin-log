import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AppState, DailyRecord } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(app) = tapping a home summary does not land on the record it
 *                         summarises.
 *
 * README section 1 promises: "요약 문장이나 항목을 누르면 해당 원본 기록 위치로
 * 스크롤하여 1~2초간 시각적으로 강조됩니다".
 *
 * Measured on the unfixed tree:
 *  - Inside `RecordPage` the promise was kept: `handleSummaryItemClick` sets the
 *    highlight and scrolls.
 *  - From the HOME screen it was not. `TodayBriefingWidget`,
 *    `PartnerEmotionSummaryWidget` and `PartnerEmotionFlowWidget` all called
 *    `navigate('/record')` with no target at all, so the user landed on today's
 *    timeline and had to find the record themselves.
 *  - `MemoriesWidget` DID call `setHighlightedRecordId(first.id)` -- and it still
 *    did nothing, because no code read that id except the effect that CLEARS it
 *    two seconds later. Worse, 추억 다시보기 targets a record from a PAST YEAR,
 *    which is not on today's timeline at all, so the tap was silently inert.
 *
 * Nothing caught it: the store action existed, one widget called it, and no test
 * asserted that anything happened as a result.
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-07-31';
const LAST_YEAR = '2025-07-31';

const setHighlightedRecordId = vi.fn();
const scrollIntoView = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/records', () => ({
  MEDIA_ACCEPT: 'image/jpeg',
  classifyMediaFile: () => ({ error: 'unsupported' }),
  resolveAttachmentUrls: vi.fn(async (attachments: unknown[]) => attachments),
}));

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: 'live' as const,
    updateRecord: vi.fn(async () => ({ ok: true as const })),
    deleteRecord: vi.fn(async () => ({ ok: true as const })),
    updateRecordMedia: vi.fn(async () => ({ ok: true as const, failedFiles: [] as string[] })),
    setHighlightedRecordId,
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '오늘의 기록',
    isPrivate: false,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

function makeState(records: DailyRecord[], highlightedRecordId?: string): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '몽룡',
      role: 'soldier',
      couple: {
        coupleId: 'couple-1',
        partnerName: '춘향',
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
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
    highlightedRecordId,
  } as AppState;
}

function renderPage(records: DailyRecord[], highlightedRecordId?: string) {
  currentState = makeState(records, highlightedRecordId);
  // Noon UTC is 21:00 KST the same day, so `localToday()` resolves to TODAY.
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  return render(
    <MemoryRouter initialEntries={['/record']}>
      <RecordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setHighlightedRecordId.mockClear();
  scrollIntoView.mockClear();
  // jsdom implements no layout, so scrollIntoView is not defined on elements.
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe('arriving with a record chosen lands on that record', () => {
  it('scrolls to a highlighted record that is on the open date', async () => {
    renderPage([record({ id: 'rec-target' })], 'rec-target');

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: 'center' });
  });

  it('switches to the record OWN date first, which is the 추억 다시보기 case', async () => {
    // A memory from a past year is not on today's timeline at all. Before the fix
    // the tap set a highlight for a record that was never rendered.
    renderPage(
      [
        record({ id: 'rec-today' }),
        record({ id: 'rec-memory', date: LAST_YEAR, log: '작년 오늘', createdAt: `${LAST_YEAR}T09:00:00.000Z` }),
      ],
      'rec-memory',
    );

    // The page opens on today; the effect must move it to the memory's date.
    await waitFor(() => {
      expect(screen.getByText('작년 오늘')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  it('does nothing at all when the id names no record on screen', async () => {
    // A private record of the partner's, or one deleted since. There is nothing to
    // scroll to, and nothing to invent.
    renderPage([record({ id: 'rec-today' })], 'rec-gone');

    await vi.advanceTimersByTimeAsync(400);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('PRESERVATION: the highlight still clears itself, so the emphasis is temporary', async () => {
    renderPage([record({ id: 'rec-target' })], 'rec-target');

    await vi.advanceTimersByTimeAsync(2100);
    expect(setHighlightedRecordId).toHaveBeenCalledWith(undefined);
  });

  it('PRESERVATION: no highlight means no scroll and no date change', async () => {
    renderPage([record({ id: 'rec-today' })]);

    await vi.advanceTimersByTimeAsync(400);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(setHighlightedRecordId).not.toHaveBeenCalled();
  });
});
