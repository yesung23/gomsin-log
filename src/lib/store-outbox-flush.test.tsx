import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AppState, DailyRecord } from '@/types';
import type { OutboxPersistence, QueuedRecord } from '@/lib/outbox';

/**
 * The offline queue actually gets delivered.
 *
 * This file exists because three earlier attempts at the same coverage were
 * deleted for being vacuous, and the handoff recorded the fix as UNVERIFIED
 * rather than count them. Each failed the same way: they asserted on something
 * the flush is not the only route to.
 *
 *   * `persistence.all()` is reached by the queue-COUNT effect as well, so it
 *     stays green with the flush effect gutted.
 *   * an `online` listener exists regardless, because `useOnlineStatus`
 *     registers one of its own.
 *   * asserting inside `store.test.tsx` passed alone and failed in the full
 *     suite on state left by other tests in that file.
 *
 * So the observable here is `saveRecordToDB`, which NOTHING but a real delivery
 * attempt reaches: the store only calls it from `addRecordWithMedia`, and no
 * record is composed in these tests. A queued entry becoming a call to it is
 * the whole claim -- "delivery was attempted" -- and gutting the effect makes
 * that call disappear.
 *
 * The fixture is the part that did not exist before: a real `OutboxPersistence`
 * double, seeded with a real entry, behind the module boundary jsdom cannot
 * cross (IndexedDB). `@/lib/outbox` itself is deliberately NOT mocked, so the
 * account filter, the blocked filter and the attempt cap all run for real.
 */

type AuthCallback = (event: string, session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null) => void;

const authCallbacks: AuthCallback[] = [];
const unsubscribe = vi.fn();

const mockSupabase = {
  auth: {
    onAuthStateChange: (cb: AuthCallback) => {
      authCallbacks.push(cb);
      return { data: { subscription: { unsubscribe } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
  },
  channel: vi.fn(() => {
    const chainable = { on: vi.fn(), subscribe: vi.fn() };
    chainable.on.mockReturnValue(chainable);
    chainable.subscribe.mockReturnValue(chainable);
    return chainable;
  }),
  removeChannel: vi.fn(),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  from: () => ({
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    upsert: () => Promise.resolve({ error: null }),
  }),
};

const fetchMyCoupleState = vi.fn().mockResolvedValue({ ok: false, reason: 'server' });

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: vi.fn().mockResolvedValue(undefined) },
  disconnectCoupleFromDB: vi.fn().mockResolvedValue(true),
  deleteAccountFromDB: vi.fn().mockResolvedValue(true),
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
  fetchMyCoupleState: (...args: unknown[]) => fetchMyCoupleState(...(args as [])),
}));

const fetchFullStateFromDB = vi.fn();
const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
vi.mock('@/lib/sync', () => ({
  fetchFullStateFromDB: (userId: string) => fetchFullStateFromDB(userId),
  fetchFullStateResultFromDB: async (userId: string) => {
    const result = await fetchFullStateFromDB(userId);
    return result === FULL_STATE_UNAVAILABLE
      ? { ok: false, reason: 'unknown' }
      : { ok: true, state: result };
  },
  FULL_STATE_UNAVAILABLE,
}));

/** The single observable. Only a delivery attempt reaches it. */
const saveRecordToDB = vi.fn(async () => ({ ok: true as const, contentRevision: 1 }));

vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => saveRecordToDB(...(args as [])),
  deleteRecordFromDB: vi.fn(async () => ({ ok: true as const })),
  fetchRecordsFromDB: vi.fn(async () => []),
  fetchRecordsResultFromDB: vi.fn(async () => ({ ok: true, records: [] })),
  uploadRecordMedia: vi.fn(async (file: File) => ({ attachment: { type: 'photo' as const, name: file.name, path: `c/r/${file.name}` } })),
  removeRecordMedia: vi.fn(async () => {}),
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: (file: { type: string }) =>
    file.type.startsWith('image/') ? { ext: 'png', type: 'photo' } : { error: 'unsupported' },
  isCanonicalRecordMediaPath: () => true,
}));

vi.mock('@/app/e2ee/runtimeSession', () => ({
  installE2eeRuntimeForAuthenticatedSession: vi.fn().mockResolvedValue({ status: 'guarded' }),
  activateCoupleProtectionForAuthenticatedSession: vi.fn().mockResolvedValue('not_paired'),
}));

vi.mock('@/lib/events', () => ({
  fetchEventsFromDB: vi.fn().mockResolvedValue([]),
  fetchEventsResultFromDB: vi.fn().mockResolvedValue({ ok: true, events: [] }),
  saveEventToDB: vi.fn().mockResolvedValue(null),
  updateEventInDB: vi.fn().mockResolvedValue(null),
  deleteEventFromDB: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/trips', () => ({
  fetchTripsFromDB: vi.fn().mockResolvedValue([]),
  fetchTripsResultFromDB: vi.fn().mockResolvedValue({ ok: true, trips: [] }),
  reconcileParentTrips: (trips: unknown[]) => trips,
}));

/**
 * The fixture that did not exist.
 *
 * `createIndexedDbOutbox` is the one seam where jsdom stops -- there is no
 * IndexedDB -- so replacing it with an in-memory port leaves every decision in
 * `outbox.ts` running for real against entries this file controls.
 */
let queue: QueuedRecord[] = [];
vi.mock('@/lib/outboxStorage', () => ({
  isOutboxStorageAvailable: () => true,
  createIndexedDbOutbox: (): OutboxPersistence => ({
    all: async () => queue.map((entry) => ({ ...entry })),
    put: async (entry) => {
      const index = queue.findIndex((existing) => existing.id === entry.id);
      if (index === -1) queue.push(entry);
      else queue[index] = entry;
    },
    remove: async (id) => { queue = queue.filter((entry) => entry.id !== id); },
  }),
}));

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');
const STORE_KEY = 'gomsinlog.state.v2';

function Probe() {
  const { isReady } = useStore();
  return <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>;
}

function queuedEntry(overrides: Partial<QueuedRecord> = {}): QueuedRecord {
  return {
    id: 'queued-rec-1',
    userId: 'user-1',
    coupleId: 'couple-1',
    queuedAt: '2026-01-01T09:00:00.000Z',
    attempts: 0,
    record: {
      userId: 'user-1',
      date: '2026-01-01',
      time: '09:00',
      authorRole: 'gomsin',
      log: 'written while the barracks had no signal',
      isPrivate: false,
    } as Omit<DailyRecord, 'id' | 'createdAt'>,
    files: [],
    ...overrides,
  };
}

function buildConnectedState(): Partial<AppState> {
  return {
    setupComplete: true,
    authenticatedUser: { id: 'user-1', email: 'a@b.com', provider: 'google' },
    profile: {
      id: 'user-1',
      myName: 'Tester',
      role: 'gomsin',
      couple: {
        partnerName: 'Partner',
        anniversaryDate: '2024-02-14',
        coupleCode: 'CODE',
        coupleId: 'couple-1',
        connected: true,
        status: 'active',
      },
      military: {
        branch: 'army',
        militaryStatus: 'serving',
        enlistmentDate: '2025-03-10',
        expectedDischargeDate: '2026-09-09',
        dischargeDateSource: 'calculated',
        memo: '',
      },
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
    widgetLayout: [],
    hasSeenInstallPrompt: false,
    theme: 'light',
  };
}

/**
 * Sign in and settle, WITHOUT dispatching `visibilitychange` or `online`.
 *
 * That omission is the test. Before the fix the only flush trigger lived inside
 * the realtime effect's listeners, so a cold launch on a good connection
 * delivered nothing until the user backgrounded and foregrounded the app.
 */
async function coldLaunch() {
  const state = buildConnectedState();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  fetchFullStateFromDB.mockResolvedValue(state);

  const { unmount } = render(<StoreProvider><Probe /></StoreProvider>);
  await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
  await act(async () => {
    authCallbacks.forEach((cb) =>
      cb('SIGNED_IN', { user: { id: 'user-1', email: 'a@b.com', app_metadata: {} } }));
  });
  await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
  // The flush is deferred by a tick on purpose (identity refs are assigned by
  // other effects), so let that timer run.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  return unmount;
}

describe('offline outbox flush', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    queue = [];
    saveRecordToDB.mockReset();
    saveRecordToDB.mockImplementation(async () => ({ ok: true as const, contentRevision: 1 }));
    fetchMyCoupleState.mockReset();
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server' });
    localStorage.clear();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: {} } } });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('attempts delivery of a queued record on a cold launch, with no foreground event', async () => {
    queue = [queuedEntry()];

    const unmount = await coldLaunch();

    // The claim: delivery was ATTEMPTED. Not "the queue was read" -- the count
    // effect reads it too -- but the queued payload reaching the write path.
    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalled());
    const [record, coupleId] = saveRecordToDB.mock.calls[0] as unknown as [DailyRecord, string];
    expect(record.id).toBe('queued-rec-1');
    expect(record.log).toBe('written while the barracks had no signal');
    expect(coupleId).toBe('couple-1');

    unmount();
  });

  it('removes the entry from the queue once delivery succeeds', async () => {
    queue = [queuedEntry()];

    const unmount = await coldLaunch();

    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalled());
    await waitFor(() => expect(queue.map((entry) => entry.id)).toEqual([]));

    unmount();
  });

  it('never replays another account\'s queued record', async () => {
    queue = [queuedEntry({ id: 'other-account-entry', userId: 'user-2' })];

    const unmount = await coldLaunch();

    // Give the flush the same window the positive case gets, then assert it
    // stayed silent: the account filter is what stops one person's queue from
    // being written into another's couple space.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(queue.map((entry) => entry.id)).toEqual(['other-account-entry']);

    unmount();
  });

  it('does not retry an entry that was already blocked', async () => {
    queue = [queuedEntry({
      blocked: { reason: 'couple_changed', message: 'x', at: '2026-01-01T09:30:00.000Z' },
    })];

    const unmount = await coldLaunch();

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(saveRecordToDB).not.toHaveBeenCalled();

    unmount();
  });

  it('keeps a retryable failure in the queue instead of losing the record', async () => {
    queue = [queuedEntry()];
    saveRecordToDB.mockImplementation(async () => ({ ok: false as const, reason: 'offline' as const }));

    const unmount = await coldLaunch();

    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalled());
    // Still queued, and the attempt was counted so the cap can eventually stop it.
    await waitFor(() => {
      expect(queue).toHaveLength(1);
      expect(queue[0].attempts).toBe(1);
      expect(queue[0].blocked).toBeUndefined();
    });

    unmount();
  });
});
