import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord, Role } from '@/types';
import {
  PARTNER_DAY_CHECKPOINT_VERSION,
  readPartnerDayCheckpoint,
  writePartnerDayCheckpoint,
} from '@/lib/partnerDay';

/**
 * Relationship-scoped widget state must not survive a change of relationship.
 *
 * Scoping the checkpoint's STORAGE key by viewer and couple was not enough. The
 * widgets read that key once, in a `useState` initializer, and the dashboard is
 * NOT unmounted when identity changes:
 *
 *   - `purgeSharedAccess` clears `profile.couple.coupleId` through a state
 *     replacement, so an unlink re-renders the dashboard rather than tearing it
 *     down.
 *   - signing into an account that already has a profile keeps `setupComplete`
 *     true, so `App` never leaves its authenticated route branch.
 *
 * So a widget keyed by its widget id alone kept Account A's checkpoint across
 *
 *     Account A / Couple A  ->  Account B / Couple B
 *
 * and applied A's confirmed set and date bound to B's records. Records in the new
 * relationship that nobody had ever seen were hidden, and the next acknowledgement
 * persisted A-derived values under B's storage key -- making it durable rather
 * than something a reload would repair.
 *
 * Every test here drives the REAL dashboard and changes identity by re-rendering
 * the SAME tree. Mounting a fresh widget against a foreign storage key proves only
 * that the key is scoped, which was never the broken part.
 */

const TODAY = '2026-08-19';
/** Older than A's checkpoint: the exact records the bug hid. */
const BEFORE_A_CHECKPOINT = '2026-08-17';

const setWidgetLayout = vi.fn();
const setHighlightedRecordId = vi.fn();

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: 'live' as const,
    setWidgetLayout,
    setHighlightedRecordId,
  }),
}));
vi.mock('@/lib/records', () => ({
  resolveAttachmentUrls: vi.fn(async (attachments: unknown[]) => attachments),
}));
/*
 * The call briefing is rendered by this dashboard too, and it carries its own
 * identity key and its own checkpoint. It also renders a second CareHintWidget
 * inside itself. Stubbing it keeps these assertions about the REGISTRY-rendered
 * widgets, which are the ones that were missing the key.
 */
vi.mock('@/components/widgets/CallBriefingWidget', () => ({
  CallBriefingWidget: () => null,
}));
vi.mock('@/components/CoupleStatusBanner', () => ({
  CoupleStatusBanner: () => null,
}));

const { WidgetDashboard } = await import('@/features/home/WidgetDashboard');

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
  layout: string[],
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
    widgetLayout: layout,
    soldierWidgetLayout: layout,
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

/**
 * A checkpoint for account A that would hide anything before today.
 *
 * `observedIds` matters, and getting it wrong once already made four of these
 * tests vacuous. The window only applies its date bound to records the receipt
 * can attest were already visible; anything it has not observed is rescued as a
 * late arrival. A receipt with an empty observation therefore suppresses NOTHING,
 * so a stale-identity bug hides behind the rescue and the mutation stops biting.
 *
 * Callers pass the ids of the records the test will show for account B. Sharing
 * an id across two relationships is a test device rather than a claim about
 * production, where ids are server-generated and would not collide -- what it
 * isolates is the lifecycle question these tests exist for: does a receipt
 * belonging to one relationship still govern another one's screen?
 */
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

function renderDashboard() {
  return render(<MemoryRouter><WidgetDashboard /></MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // 12:00 UTC is 21:00 KST the same day, so `localToday()` resolves to TODAY.
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  localStorage.clear();
  setWidgetLayout.mockClear();
  setHighlightedRecordId.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('상대방의 오늘 across a live account change', () => {
  it("shows B's older records after A -> B, without any remount", () => {
    seedCheckpointA(['b-old']);
    currentState = stateFor('user-a', 'couple-a', [], ['partner_day']);
    const { rerender } = renderDashboard();

    // Same tree, new identity. This is the transition the bug survived.
    currentState = stateFor('user-b', 'couple-b', [
      record({ id: 'b-old', userId: 'partner-b', date: BEFORE_A_CHECKPOINT, log: 'B가 못 본 기록' }),
    ], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    // Under the defect A's receipt classified B's record as already observed.
    expect(screen.getByText('B가 못 본 기록')).toBeInTheDocument();
  });

  it("does not carry A's confirmed ids into B's window", () => {
    seedCheckpointA([]);
    currentState = stateFor('user-a', 'couple-a', [], ['partner_day']);
    const { rerender } = renderDashboard();

    // A record in couple B that happens to reuse an id A had confirmed.
    currentState = stateFor('user-b', 'couple-b', [
      record({ id: 'a-rec-1', userId: 'partner-b', log: 'B의 기록' }),
    ], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    expect(screen.getByText('B의 기록')).toBeInTheDocument();
  });
});

describe('상대방의 오늘 across unlink and relink', () => {
  it('shows the new couple\'s older records after unlink -> new couple', () => {
    seedCheckpointA(['b-old']);
    currentState = stateFor('user-a', 'couple-a', [], ['partner_day']);
    const { rerender } = renderDashboard();

    // `purgeSharedAccess`: same account, couple cleared, records dropped.
    currentState = stateFor('user-a', undefined, [], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    // Relinked with someone else. Same account, new couple, still no remount.
    currentState = stateFor('user-a', 'couple-b', [
      record({ id: 'b-old', userId: 'partner-b', date: BEFORE_A_CHECKPOINT, log: '새 커플의 기록' }),
    ], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    expect(screen.getByText('새 커플의 기록')).toBeInTheDocument();
  });

  it('same couple id with a different viewer is still a different identity', () => {
    // Two accounts on one device sharing a couple id: B must not inherit A's
    // receipt just because the relationship id matches.
    seedCheckpointA(['unseen'], 'user-a', 'couple-shared');
    currentState = stateFor('user-a', 'couple-shared', [], ['partner_day']);
    const { rerender } = renderDashboard();

    currentState = stateFor('user-b', 'couple-shared', [
      record({ id: 'unseen', userId: 'partner-x', date: BEFORE_A_CHECKPOINT, log: 'B는 못 봤다' }),
    ], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    expect(screen.getByText('B는 못 봤다')).toBeInTheDocument();
  });
});

describe('acknowledgement after an identity change writes only the new identity', () => {
  it("stores B's own state, with no A ids and no A date bound", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedCheckpointA(['b-only']);
    currentState = stateFor('user-a', 'couple-a', [], ['partner_day']);
    const { rerender } = renderDashboard();

    currentState = stateFor('user-b', 'couple-b', [
      record({ id: 'b-only', userId: 'partner-b', date: BEFORE_A_CHECKPOINT, log: 'B의 유일한 기록' }),
    ], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    await user.click(screen.getByTestId('partner-day-acknowledge'));

    const stored = readPartnerDayCheckpoint({ userId: 'user-b', coupleId: 'couple-b' });
    expect(stored?.confirmedRecordIds).toEqual(['b-only']);
    // The contamination that made the defect durable: A's ids being merged into the
    // receipt written under B's key.
    expect(stored?.confirmedRecordIds).not.toContain('a-rec-1');
    expect(stored?.knownRecordIds).toEqual(['b-only']);
    expect(stored?.outstandingRecordIds).toEqual([]);

    // A's own receipt is untouched by B's acknowledgement.
    expect(readPartnerDayCheckpoint({ userId: 'user-a', coupleId: 'couple-a' })?.confirmedRecordIds)
      .toEqual(['a-rec-1', 'a-rec-2']);
  });
});

describe('다정한 한마디 as a standalone widget', () => {
  it('describes the new relationship after an identity change', () => {
    // CareHint holds the same checkpoint in a `useState` with no setter, so it
    // could never re-read at all. Exercised here OUTSIDE the call briefing,
    // which has always had its own identity key.
    seedCheckpointA(['b-hard']);
    currentState = stateFor('user-a', 'couple-a', [], ['care_hint']);
    const { rerender } = renderDashboard();

    currentState = stateFor('user-b', 'couple-b', [
      record({
        id: 'b-hard',
        userId: 'partner-b',
        date: BEFORE_A_CHECKPOINT,
        reaction: 'hard',
        log: '힘들었던 하루',
      }),
    ], ['care_hint']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    expect(screen.getByText(/힘든 일이 있었어요/)).toBeInTheDocument();
    expect(screen.queryByText(/새로 공유된 순간이 아직 없어요/)).not.toBeInTheDocument();
  });
});

describe('identity is lifecycle only, never a widget id', () => {
  it('persists the plain registry id, so a saved layout survives an account change', async () => {
    // If the compound key had leaked into the `id` prop, removal would persist
    // `partner_day:user-a:couple-a` and the stored layout would stop matching the
    // registry for every other identity. The key must be lifecycle only.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    currentState = stateFor('user-a', 'couple-a', [], ['partner_day', 'dday']);
    renderDashboard();

    await user.click(screen.getByRole('button', { name: '위젯 편집' }));
    await user.click(screen.getByRole('button', { name: '상대방의 오늘 위젯 삭제' }));

    expect(setWidgetLayout).toHaveBeenCalledWith(['dday'], 'soldier');
  });
});

describe('switching back to the first identity', () => {
  it('restores A\'s own receipt after A -> B -> A', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // A acknowledges its own record, so A has a real receipt on disk.
    currentState = stateFor('user-a', 'couple-a', [
      record({ id: 'a-seen', userId: 'partner-a', log: 'A가 확인한 기록' }),
    ], ['partner_day']);
    const { rerender } = renderDashboard();
    await user.click(screen.getByTestId('partner-day-acknowledge'));
    expect(screen.queryByText('A가 확인한 기록')).not.toBeInTheDocument();

    // Over to B and straight back, all without unmounting the dashboard.
    currentState = stateFor('user-b', 'couple-b', [
      record({ id: 'b-rec', userId: 'partner-b', log: 'B의 기록' }),
    ], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);
    expect(screen.getByText('B의 기록')).toBeInTheDocument();

    currentState = stateFor('user-a', 'couple-a', [
      record({ id: 'a-seen', userId: 'partner-a', log: 'A가 확인한 기록' }),
      record({ id: 'a-new', userId: 'partner-a', time: '20:00', log: 'A의 새 기록' }),
    ], ['partner_day']);
    rerender(<MemoryRouter><WidgetDashboard /></MemoryRouter>);

    // A's receipt came back from storage: the confirmed record stays confirmed,
    // and the one that arrived while A was away is surfaced.
    expect(screen.queryByText('A가 확인한 기록')).not.toBeInTheDocument();
    expect(screen.getByText('A의 새 기록')).toBeInTheDocument();
  });
});
