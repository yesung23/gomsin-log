import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AppState, DailyRecord, Role } from '@/types';
import {
  PARTNER_DAY_CHECKPOINT_VERSION,
  readPartnerDayCheckpoint,
  writePartnerDayCheckpoint,
} from '@/lib/partnerDay';

/**
 * StoryRoute PartnerDay identity isolation across live unlink, relink, and account changes.
 *
 * Like RoleHome / WidgetDashboard, StoryRoute reads usePartnerDay.
 * If StoryRoute survives an account change or couple unlink/relink while remaining mounted,
 * it must remount / reinitialize its partner-day state so that:
 * 1) Old checkpoint receipts from relationship A do not suppress relationship B's records.
 * 2) Confirmed IDs from relationship A do not contaminate relationship B's receipt upon acknowledgement.
 * 3) Switching back to relationship A restores relationship A's valid checkpoint.
 */

const TODAY = '2026-08-22';
const BEFORE_A_CHECKPOINT = '2026-08-19';

let currentState: AppState;
const markTalkAbout = vi.fn(async () => ({ ok: true }));
const unmarkTalkAbout = vi.fn(async () => ({ ok: true }));
const setHighlightedRecordId = vi.fn();

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: 'live' as const,
    setHighlightedRecordId,
    markTalkAbout,
    unmarkTalkAbout,
  }),
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId }: { recordId: string }) => <div data-testid={`media-${recordId}`} />,
}));

const { StoryRoute } = await import('@/features/story/StoryRoute');

function record(overrides: Partial<DailyRecord> & { id: string; userId: string }): DailyRecord {
  return {
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '기록',
    isPrivate: false,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

function stateFor(
  userId: string,
  coupleId: string | undefined,
  records: DailyRecord[],
  role: Role = 'soldier',
): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: userId, email: `${userId}@example.com`, provider: 'google' },
    profile: {
      id: userId,
      myName: '몽룡',
      role,
      couple: {
        coupleId,
        partnerUserId: coupleId ? 'partner-b' : undefined,
        partnerName: coupleId ? '춘향' : '',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: !!coupleId,
        status: coupleId ? 'active' : 'disconnected',
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    talkAboutMarks: [],
    widgetLayout: ['partner_day'],
    soldierWidgetLayout: ['partner_day'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

function seedCheckpointA(
  observedIds: string[],
  userId = 'user-a',
  coupleId = 'couple-a',
) {
  writePartnerDayCheckpoint({ userId, coupleId }, {
    version: PARTNER_DAY_CHECKPOINT_VERSION,
    confirmedRecordIds: ['a-rec-1', 'a-rec-2'],
    outstandingRecordIds: [],
    knownRecordIds: ['a-rec-1', 'a-rec-2', ...observedIds],
  });
}

function renderStoryRoute() {
  return render(
    <MemoryRouter initialEntries={['/story/partner']}>
      <Routes>
        <Route path="/story/partner" element={<StoryRoute mode="today" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  localStorage.clear();
  markTalkAbout.mockClear();
  unmarkTalkAbout.mockClear();
  setHighlightedRecordId.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('StoryRoute PartnerDay identity isolation across live unlink and relink', () => {
  it("shows the new couple's older records after unlink -> new couple without unmounting route", () => {
    seedCheckpointA(['b-old']);
    currentState = stateFor('user-a', 'couple-a', []);
    const { rerender } = renderStoryRoute();

    // unlink
    currentState = stateFor('user-a', undefined, []);
    rerender(
      <MemoryRouter initialEntries={['/story/partner']}>
        <Routes>
          <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        </Routes>
      </MemoryRouter>,
    );

    // relink with couple-b
    currentState = stateFor('user-a', 'couple-b', [
      record({ id: 'b-old', userId: 'partner-b', date: BEFORE_A_CHECKPOINT, log: '새 커플의 기록' }),
    ]);
    rerender(
      <MemoryRouter initialEntries={['/story/partner']}>
        <Routes>
          <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('새 커플의 기록')).toBeInTheDocument();
  });

  it("does not carry A's confirmed ids into B's window upon acknowledgement in StoryRoute", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedCheckpointA(['b-only']);
    currentState = stateFor('user-a', 'couple-a', []);
    const { rerender } = renderStoryRoute();

    currentState = stateFor('user-b', 'couple-b', [
      record({ id: 'b-only', userId: 'partner-b', date: BEFORE_A_CHECKPOINT, log: 'B의 유일한 기록' }),
    ]);
    rerender(
      <MemoryRouter initialEntries={['/story/partner']}>
        <Routes>
          <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('B의 유일한 기록')).toBeInTheDocument();

    // Navigate to closing card and acknowledge
    await user.click(screen.getByRole('button', { name: '다음 순간' }));
    await user.click(screen.getByTestId('story-acknowledge'));

    const storedB = readPartnerDayCheckpoint({ userId: 'user-b', coupleId: 'couple-b' });
    expect(storedB?.confirmedRecordIds).toEqual(['b-only']);
    expect(storedB?.confirmedRecordIds).not.toContain('a-rec-1');
    expect(storedB?.knownRecordIds).toEqual(['b-only']);
    expect(storedB?.outstandingRecordIds).toEqual([]);

    // A's own receipt is untouched by B's acknowledgement.
    expect(readPartnerDayCheckpoint({ userId: 'user-a', coupleId: 'couple-a' })?.confirmedRecordIds)
      .toEqual(['a-rec-1', 'a-rec-2']);
  });

  it("restores A's own receipt after A -> B -> A in StoryRoute", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    currentState = stateFor('user-a', 'couple-a', [
      record({ id: 'a-seen', userId: 'partner-a', log: 'A가 확인한 기록' }),
    ]);
    const { rerender } = renderStoryRoute();
    await user.click(screen.getByRole('button', { name: '다음 순간' }));
    await user.click(screen.getByTestId('story-acknowledge'));

    // Switch to B
    currentState = stateFor('user-b', 'couple-b', [
      record({ id: 'b-rec', userId: 'partner-b', log: 'B의 기록' }),
    ]);
    rerender(
      <MemoryRouter initialEntries={['/story/partner']}>
        <Routes>
          <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('B의 기록')).toBeInTheDocument();

    // Switch back to A
    currentState = stateFor('user-a', 'couple-a', [
      record({ id: 'a-seen', userId: 'partner-a', log: 'A가 확인한 기록' }),
      record({ id: 'a-new', userId: 'partner-a', time: '20:00', log: 'A의 새 기록' }),
    ]);
    rerender(
      <MemoryRouter initialEntries={['/story/partner']}>
        <Routes>
          <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('A가 확인한 기록')).not.toBeInTheDocument();
    expect(screen.getByText('A의 새 기록')).toBeInTheDocument();
  });
});
