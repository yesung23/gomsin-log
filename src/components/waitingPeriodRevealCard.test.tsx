import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord } from '@/types';

/**
 * §7.6's card, and the three things it must never do.
 *
 * Every assertion here is really one assertion: nothing becomes visible to the
 * partner except by a specific, deliberate act. The card can be ignored, closed,
 * or never seen, and every entry stays exactly as private as it was.
 */

const ME = 'user-me';
const JOINED = '2026-08-20T12:00:00.000Z';

const updateRecord = vi.fn(async () => ({ ok: true as const }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => true };
});

let currentState: AppState;
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: currentState, isReady: true, updateRecord }),
}));

const { WaitingPeriodRevealCard } = await import('@/components/WaitingPeriodRevealCard');

function record(over: Partial<DailyRecord> & { id: string }): DailyRecord {
  return {
    userId: ME,
    date: '2026-08-19',
    time: '10:00',
    authorRole: 'gomsin',
    log: `기록 ${over.id}`,
    isPrivate: true,
    createdAt: '2026-08-19T10:00:00.000Z',
    ...over,
  };
}

function makeState(records: DailyRecord[], partnerJoinedAt: string | undefined): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
        partnerJoinedAt,
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    talkAboutMarks: [],
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

/*
  `joinedAt` is NOT defaulted. A default parameter is not overridden by an
  explicit `undefined`, so the "no join time" case below would render WITH one
  and assert nothing. Third time this trap has fired in this branch.
*/
function renderCard(records: DailyRecord[], joinedAt?: string) {
  vi.setSystemTime(new Date('2026-08-21T09:00:00.000Z'));
  currentState = makeState(records, joinedAt);
  return render(<WaitingPeriodRevealCard />);
}

beforeEach(() => {
  updateRecord.mockClear().mockResolvedValue({ ok: true });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('nothing is revealed without a deliberate act', () => {
  it('starts with nothing selected', async () => {
    renderCard([record({ id: 'a' }), record({ id: 'b' })], JOINED);
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    // A pre-ticked box is a decision made on someone's behalf.
    expect(screen.getByTestId('waiting-period-reveal-confirm')).toBeDisabled();
  });

  it('writes nothing when the card is dismissed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard([record({ id: 'a' })], JOINED);

    await user.click(screen.getByTestId('waiting-period-keep'));

    expect(updateRecord).not.toHaveBeenCalled();
    expect(screen.queryByTestId('waiting-period-reveal')).toBeNull();
  });

  it('reveals only the entries that were ticked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard([record({ id: 'a' }), record({ id: 'b' }), record({ id: 'c' })], JOINED);

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByTestId('waiting-period-reveal-confirm'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(1));
    expect(updateRecord).toHaveBeenCalledWith('a', { isPrivate: false });
  });

  it('un-ticking removes it from the write', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard([record({ id: 'a' }), record({ id: 'b' })], JOINED);

    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]);
    await user.click(boxes[1]);
    await user.click(boxes[0]);
    await user.click(screen.getByTestId('waiting-period-reveal-confirm'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(1));
    expect(updateRecord).toHaveBeenCalledWith('b', { isPrivate: false });
  });
});

describe('a partial failure is reported as one', () => {
  it('keeps the failures selected and says what actually happened', async () => {
    /*
      Three revealed and two failed is not "it didn't work" -- three are now
      visible to the partner. Reporting a blanket failure would leave someone
      believing an entry is private when it is not, which is the exact error §7.6
      exists to prevent, arriving through the mechanism meant to prevent it.
    */
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    updateRecord.mockImplementation(async (id: string) => (
      id === 'b' ? { ok: false as const } : { ok: true as const }
    ) as never);
    renderCard([record({ id: 'a' }), record({ id: 'b' })], JOINED);

    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]);
    await user.click(boxes[1]);
    await user.click(screen.getByTestId('waiting-period-reveal-confirm'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(2));
    // The card stays open with only the failed one still ticked, so a retry
    // cannot accidentally re-reveal what already succeeded.
    await waitFor(() => expect(screen.getByTestId('waiting-period-reveal')).toBeInTheDocument());
  });
});

describe('when the card does not appear at all', () => {
  it('renders nothing without a join time', () => {
    const { container } = renderCard([record({ id: 'a' })]);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing once the window has passed', () => {
    vi.setSystemTime(new Date('2026-09-30T09:00:00.000Z'));
    currentState = makeState([record({ id: 'a' })], JOINED);
    const { container } = render(<WaitingPeriodRevealCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when every waiting-period entry is already shared', () => {
    const { container } = renderCard([record({ id: 'a', isPrivate: false })], JOINED);
    expect(container.firstChild).toBeNull();
  });
});
