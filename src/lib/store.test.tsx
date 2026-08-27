import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AppState } from '@/types';
import type { OutboxPersistence, QueuedRecord } from '@/lib/outbox';
import {
  clearCoupleProtectionRequirement,
  clearAllCoupleProtectionRequirements,
  isCoupleProtectionRequired,
  requireCoupleProtection,
} from '@/app/e2ee/coupleProtectionBarrier';

const featureFlagMock = vi.hoisted(() => ({
  isDeviceProtectionEnabled: false,
}));

vi.mock('@/app/e2ee/featureFlag', () => ({
  isDeviceProtectionEnabled: () => featureFlagMock.isDeviceProtectionEnabled,
}));

type AuthCallback = (event: string, session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null) => void;

const authCallbacks: AuthCallback[] = [];
const unsubscribe = vi.fn();
const createdChannels: Array<{ name: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }> = [];

const mockSupabase = {
  profileUpdateError: null as null | { message: string },
  profileUpdateMatched: true,
  lastProfileUpdatePayload: null as Record<string, unknown> | null,
  auth: {
    onAuthStateChange: (cb: AuthCallback) => {
      authCallbacks.push(cb);
      return { data: { subscription: { unsubscribe } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
  },
  // Supports the chained .on().on().on().subscribe() builder the store uses.
  channel: vi.fn((name: string) => {
    const chainable = {
      name,
      on: vi.fn(),
      subscribe: vi.fn(),
    };
    chainable.on.mockReturnValue(chainable);
    chainable.subscribe.mockReturnValue(chainable);
    createdChannels.push(chainable);
    return chainable;
  }),
  removeChannel: vi.fn(),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  from: () => ({
    update: (payload: Record<string, unknown>) => {
      mockSupabase.lastProfileUpdatePayload = payload;
      return {
      eq: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({
            data: mockSupabase.profileUpdateMatched ? { id: 'user-a' } : null,
            error: mockSupabase.profileUpdateError,
          }),
        }),
      }),
      };
    },
    upsert: () => Promise.resolve({ error: null }),
  }),
};

const disconnectCoupleFromDB = vi.fn().mockResolvedValue(true);
const saveCoupleAnniversary = vi.fn().mockResolvedValue(true);
// Default: the lifecycle RPC could NOT answer. By contract that leaves local
// couple state untouched, so every pre-existing scenario keeps its fixture
// workspace. Tests that care about a definite answer set it explicitly.
const fetchMyCoupleState = vi.fn().mockResolvedValue({ ok: false, reason: 'server' });

const outboxEntries = new Map<string, QueuedRecord>();
const outboxPersistence: OutboxPersistence = {
  all: vi.fn(async () => Array.from(outboxEntries.values())),
  put: vi.fn(async (entry) => { outboxEntries.set(entry.id, entry); }),
  remove: vi.fn(async (id) => { outboxEntries.delete(id); }),
};

vi.mock('@/lib/outboxStorage', () => ({
  createIndexedDbOutbox: () => outboxPersistence,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: vi.fn().mockResolvedValue(undefined) },
  disconnectCoupleFromDB,
  deleteAccountFromDB: vi.fn().mockResolvedValue(true),
  saveCoupleAnniversary,
  // Read-only lifecycle probe.
  fetchMyCoupleState: (...args: unknown[]) => fetchMyCoupleState(...(args as [])),
}));

const fetchFullStateFromDB = vi.fn();
const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
vi.mock('@/lib/sync', () => ({
  fetchFullStateFromDB: (userId: string) => fetchFullStateFromDB(userId),
  // The store reads the reason-carrying variant. Deriving it from the same mock
  // keeps every existing scenario byte-identical while exercising the new shape.
  fetchFullStateResultFromDB: async (userId: string) => {
    const result = await fetchFullStateFromDB(userId);
    return result === FULL_STATE_UNAVAILABLE
      ? { ok: false, reason: 'unknown' }
      : { ok: true, state: result };
  },
  FULL_STATE_UNAVAILABLE,
}));

/** Ordered log of media-related calls, used to assert the two-phase upload flow. */
const callOrder: string[] = [];
let enforceProtectionBarrierInStoreMock = false;
const saveRecordToDB = vi.fn(async (...args: unknown[]) => {
  callOrder.push('saveRecord');
  const record = args[0] as { isPrivate?: boolean } | undefined;
  const coupleId = args[1];
  const userId = args[2];
  if (enforceProtectionBarrierInStoreMock
    && record?.isPrivate === false
    && typeof userId === 'string'
    && typeof coupleId === 'string'
    && isCoupleProtectionRequired(userId, coupleId)) {
    return { ok: false as const, reason: 'server' as const, protectionRequired: true };
  }
  return { ok: true as const };
});
const uploadRecordMedia = vi.fn(async (file: File) => {
  callOrder.push(`upload:${file.name}`);
  return { attachment: { type: 'photo' as const, name: file.name, path: `c/r/${file.name}` } };
});
const removeRecordMedia = vi.fn(async () => {
  callOrder.push('removeMedia');
});

const fetchRecordsFromDB = vi.fn(async () => []);

const fetchRecordsResultFromDB = vi.fn(async () => ({ ok: true, records: [] }));
const activateCoupleProtectionForAuthenticatedSession = vi.fn(async () => 'not_paired' as const);

vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => saveRecordToDB(...(args as [])),
  deleteRecordFromDB: vi.fn().mockResolvedValue({ ok: true }),
  fetchRecordsFromDB: (...args: unknown[]) => fetchRecordsFromDB(...(args as [])),
  fetchRecordsResultFromDB: (...args: unknown[]) => fetchRecordsResultFromDB(...(args as [])),
  uploadRecordMedia: (...args: unknown[]) => uploadRecordMedia(...(args as [File])),
  removeRecordMedia: (...args: unknown[]) => removeRecordMedia(...(args as [])),
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: (file: { type: string }) =>
    file.type.startsWith('image/')
      ? { ext: 'png', type: 'photo' }
      : { error: 'unsupported' },
  isCanonicalRecordMediaPath: (path: unknown, coupleId: string, recordId: string) => {
    if (typeof path !== 'string') return false;
    return path.startsWith(`${coupleId}/${recordId}/`);
  },
}));

vi.mock('@/app/e2ee/runtimeSession', () => ({
  installE2eeRuntimeForAuthenticatedSession: vi.fn().mockResolvedValue({ status: 'guarded' }),
  activateCoupleProtectionForAuthenticatedSession: (...args: unknown[]) =>
    activateCoupleProtectionForAuthenticatedSession(...(args as [])),
}));

const fetchEventsResultFromDB = vi.fn().mockResolvedValue({ ok: true, events: [] });
const saveEventToDB = vi.fn().mockResolvedValue(null);
const updateEventInDB = vi.fn().mockResolvedValue(null);
const deleteEventFromDB = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/events', () => ({
  fetchEventsFromDB: vi.fn().mockResolvedValue([]),
  fetchEventsResultFromDB: (...args: unknown[]) => fetchEventsResultFromDB(...(args as [string])),
  saveEventToDB: (...args: unknown[]) => saveEventToDB(...args),
  updateEventInDB: (...args: unknown[]) => updateEventInDB(...args),
  deleteEventFromDB: (...args: unknown[]) => deleteEventFromDB(...args),
}));

vi.mock('@/lib/trips', () => ({
  fetchTripsFromDB: vi.fn().mockResolvedValue([]),
  fetchTripsResultFromDB: vi.fn().mockResolvedValue({ ok: true, trips: [] }),
  reconcileParentTrips: (trips: unknown[]) => trips,
}));

const fetchTalkAboutMarksResultFromDB = vi.fn()
  .mockResolvedValue({ ok: true, marks: [] });

// Talk-about marks load alongside the other shared slices. A failed read keeps
// the old list; the normal default here is an authoritative empty result.
vi.mock('@/lib/talkAbout', () => ({
  fetchTalkAboutMarksResultFromDB: (...args: unknown[]) => fetchTalkAboutMarksResultFromDB(...args),
  markTalkAboutInDB: vi.fn().mockResolvedValue({ ok: true }),
  unmarkTalkAboutInDB: vi.fn().mockResolvedValue({ ok: true }),
  resolveTalkAboutInDB: vi.fn().mockResolvedValue({ ok: true }),
}));

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');
const { setOutboxLocalCacheKey } = await import('@/lib/outbox');
const { registerE2eeRuntimeTeardown } = await import('@/app/e2ee/runtimeLifecycle');
const { fetchTripsResultFromDB: fetchTripsResultFromDBMock } = await import('@/lib/trips') as unknown as { fetchTripsResultFromDB: ReturnType<typeof vi.fn> };
const STORE_KEY = 'gomsinlog.state.v2';

let lastMediaResult: {
  ok: boolean;
  failedFiles: string[];
  error?: string;
  reason?: string;
  recordId?: string;
} | null = null;
let lastFlushResult: { delivered: number; requeued: number; blocked: number } | null = null;

function Probe({
  files = [] as File[],
  allOrNothingMedia = false,
}: { files?: File[]; allOrNothingMedia?: boolean }) {
  const {
    state,
    isReady,
    authSyncUnavailable,
    sharedSyncStatus,
    signOut,
    disconnect,
    updateProfile,
    addRecordWithMedia,
    queueRecordForLater,
    flushOutbox,
    refreshCoupleLifecycle,
    outboxWaiting,
    outboxBlocked,
    addEvent,
    reloadEvents,
  } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="authSync">{authSyncUnavailable ? 'unavailable' : 'available'}</span>
      <span data-testid="syncStatus">{sharedSyncStatus}</span>
      <span data-testid="setup">{String(state.setupComplete)}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <span data-testid="name">{state.profile.myName}</span>
      <span data-testid="username">{state.profile.username ?? 'none'}</span>
      <span data-testid="couple">{state.profile.couple.coupleId ?? 'none'}</span>
      <span data-testid="partner">{state.profile.couple.partnerName || 'none'}</span>
      <span data-testid="partnerMilitary">{state.profile.couple.partnerMilitary ? 'present' : 'none'}</span>
      <span data-testid="anniversary">{state.profile.couple.anniversaryDate ?? 'none'}</span>
      <span data-testid="records">{state.records.map((r) => r.id).join(',')}</span>
      <span data-testid="events">{state.events.map((event) => event.id).join(',')}</span>
      <span data-testid="trips">{state.trips.map((trip) => trip.id).join(',')}</span>
      <span data-testid="talkAboutMarks">{(state.talkAboutMarks ?? []).map((mark) => mark.id).join(',')}</span>
      <span data-testid="attachments">
        {state.records
          .flatMap((r) => r.attachments || [])
          .map((a) => a.name)
          .join(',')}
      </span>
      <span data-testid="logs">{state.records.map((r) => r.log).join('|')}</span>
      <span data-testid="privacy">{state.records.map((r) => r.isPrivate ? 'private' : 'public').join(',')}</span>
      <span data-testid="outbox">{outboxWaiting}:{outboxBlocked}</span>
      <button
        onClick={() => {
          void addRecordWithMedia(
            {
              date: '2026-07-31',
              time: '12:00',
              authorRole: 'gomsin',
              log: '오늘의 기록',
              isPrivate: false,
              ...(allOrNothingMedia ? { isProfilePost: true } : {}),
            },
            files,
            allOrNothingMedia ? { allOrNothingMedia: true } : undefined,
          ).then((result) => {
            lastMediaResult = result;
          });
        }}
      >
        post
      </button>
      <button onClick={() => {
        void queueRecordForLater({
          date: '2026-08-16',
          time: '12:00',
          authorRole: 'gomsin',
          log: 'queued old couple record',
          isPrivate: false,
        }, []);
      }}>queue</button>
      <button onClick={() => {
        void flushOutbox().then((result) => { lastFlushResult = result; });
      }}>flush</button>
      <button onClick={() => void refreshCoupleLifecycle()}>refresh-lifecycle</button>
      <button onClick={() => void signOut()}>signout</button>
      <button onClick={() => void disconnect()}>disconnect</button>
      <button onClick={() => void updateProfile({ myName: 'updated-name' })}>update-profile</button>
      <button onClick={() => void updateProfile({
        username: ' Foo_Bar ',
        profileCaption: '오늘도 함께',
        profileDateType: 'meeting',
      })}>update-profile-identity</button>
      <button onClick={() => void updateProfile({
        couple: { ...state.profile.couple, anniversaryDate: undefined },
      })}>clear-anniversary</button>
      <button onClick={() => {
        const userId = state.authenticatedUser?.id;
        const coupleId = state.profile.couple.coupleId;
        if (userId && coupleId) {
          void addEvent({
            coupleId,
            createdBy: userId,
            title: 'new event',
            eventType: 'date',
            startDate: '2026-08-01',
            isPrivate: false,
          });
        }
      }}>add-event</button>
      <button onClick={() => void reloadEvents()}>reload-events</button>
    </div>
  );
}

function emitAuth(event: string, userId: string | null) {
  const session = userId
    ? { user: { id: userId, email: `${userId}@example.com`, app_metadata: { provider: 'google' } } }
    : null;
  authCallbacks.forEach((cb) => cb(event, session));
}

function serverState(overrides: Partial<AppState>): Partial<AppState> {
  return {
    setupComplete: true,
    records: [],
    events: [],
    trips: [],
    ...overrides,
  };
}

describe('StoreProvider auth lifecycle', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    createdChannels.length = 0;
    localStorage.clear();
    outboxEntries.clear();
    clearAllCoupleProtectionRequirements();
    featureFlagMock.isDeviceProtectionEnabled = false;
    enforceProtectionBarrierInStoreMock = false;
    setOutboxLocalCacheKey(null);
    lastFlushResult = null;
    fetchFullStateFromDB.mockReset();
    mockSupabase.profileUpdateError = null;
    mockSupabase.lastProfileUpdatePayload = null;
    mockSupabase.profileUpdateMatched = true;
    saveCoupleAnniversary.mockReset().mockResolvedValue(true);
    fetchRecordsResultFromDB.mockReset().mockResolvedValue({ ok: true, records: [] });
    mockSupabase.channel.mockClear();
    mockSupabase.removeChannel.mockClear();
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    // The shared setup's `vi.restoreAllMocks()` strips implementations, and the
    // store now asks the server whether a deletion is pending before it syncs.
    // The default answer is an authoritative "not pending".
    mockSupabase.auth.getUser.mockReset().mockResolvedValue({
      data: { user: { id: 'user-a', app_metadata: { provider: 'google' } } },
      error: null,
    });
    // `vi.restoreAllMocks()` strips this too. Default: the lifecycle RPC could
    // not answer, which by contract must leave local couple state untouched.
    fetchMyCoupleState.mockReset().mockResolvedValue({ ok: false, reason: 'server' });
    activateCoupleProtectionForAuthenticatedSession.mockReset().mockResolvedValue('not_paired');
    disconnectCoupleFromDB.mockReset().mockResolvedValue(true);
    fetchEventsResultFromDB.mockReset().mockResolvedValue({ ok: true, events: [] });
    fetchTripsResultFromDBMock.mockReset().mockResolvedValue({ ok: true, trips: [] });
    fetchTalkAboutMarksResultFromDB.mockReset().mockResolvedValue({ ok: true, marks: [] });
    saveEventToDB.mockReset().mockResolvedValue(null);
    updateEventInDB.mockReset().mockResolvedValue(null);
    deleteEventFromDB.mockReset().mockResolvedValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    setOutboxLocalCacheKey(null);
  });

  it('clears module-level E2EE capabilities when the provider unmounts', async () => {
    const teardown = vi.fn();
    registerE2eeRuntimeTeardown(teardown);
    const view = render(<StoreProvider><Probe /></StoreProvider>);

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('loading'));
    view.unmount();

    expect(teardown).toHaveBeenCalledOnce();
  });

  it('blocks an old-couple outbox entry before opening or sending it after re-pairing', async () => {
    let remoteCoupleId = 'couple-old';
    fetchFullStateFromDB.mockImplementation(async () => serverState({
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: {
          coupleId: remoteCoupleId,
          partnerName: '몽룡',
          coupleCode: '',
          connected: true,
          status: 'active',
        },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));
    const open = vi.fn(async () => new Uint8Array());
    setOutboxLocalCacheKey({
      binding: {
        installationId: 'test',
        userId: 'user-a',
        deviceId: 'device-a',
        purpose: 'lck',
        version: 1,
      },
      has: async () => true,
      seal: async () => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([1]) }),
      open,
      delete: async () => {},
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-old'));
    await act(async () => { screen.getByText('queue').click(); });
    await waitFor(() => expect(outboxEntries.size).toBe(1));
    expect(Array.from(outboxEntries.values())[0].sealedRecord).toBeDefined();

    remoteCoupleId = 'couple-new';
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-new'));
    saveRecordToDB.mockClear();
    await act(async () => { screen.getByText('flush').click(); });
    await waitFor(() => expect(lastFlushResult).toEqual({ delivered: 0, requeued: 0, blocked: 1 }));

    expect(open).not.toHaveBeenCalled();
    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(Array.from(outboxEntries.values())[0].blocked?.reason).toBe('couple_changed');
  });

  it('rechecks the queued couple after payload open before the first replay mutation', async () => {
    let remoteCoupleId = 'couple-old';
    fetchFullStateFromDB.mockImplementation(async () => serverState({
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: {
          coupleId: remoteCoupleId,
          partnerName: '몽룡',
          coupleCode: '',
          connected: true,
          status: 'active',
        },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));
    let resolveOpen!: (plaintext: Uint8Array) => void;
    const open = vi.fn(() => new Promise<Uint8Array>((resolve) => { resolveOpen = resolve; }));
    setOutboxLocalCacheKey({
      binding: {
        installationId: 'test',
        userId: 'user-a',
        deviceId: 'device-a',
        purpose: 'lck',
        version: 1,
      },
      has: async () => true,
      seal: async () => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array([1]) }),
      open,
      delete: async () => {},
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-old'));
    await act(async () => { screen.getByText('queue').click(); });
    await waitFor(() => expect(outboxEntries.size).toBe(1));

    saveRecordToDB.mockClear();
    screen.getByText('flush').click();
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    remoteCoupleId = 'couple-new';
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-new'));
    await act(async () => resolveOpen(new TextEncoder().encode(JSON.stringify({
      record: {
        date: '2026-08-16',
        time: '12:00',
        authorRole: 'gomsin',
        log: 'queued old couple record',
        isPrivate: false,
      },
    }))));
    await waitFor(() => expect(lastFlushResult).toEqual({ delivered: 0, requeued: 0, blocked: 1 }));

    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(Array.from(outboxEntries.values())[0].blocked?.reason).toBe('couple_changed');
  });

  it('becomes ready after a session is restored', async () => {
    fetchFullStateFromDB.mockResolvedValue(
      serverState({ profile: { myName: '춘향', role: 'gomsin', couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' }, military: {} as never, contact: {} as never } as never }),
    );

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
  });

  it('still becomes ready when the server sync never resolves (no infinite spinner)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A hang here used to leave isReady false forever, showing only the splash spinner.
    fetchFullStateFromDB.mockReturnValue(new Promise(() => {}));

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(13_000);
    });

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    // A timeout is retryable and must be surfaced separately from a verified
    // missing profile, so the app does not silently classify it as onboarding.
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    expect(screen.getByTestId('authSync')).toHaveTextContent('unavailable');
  });

  it('does not leak the previous account\'s records when switching accounts', async () => {
    fetchFullStateFromDB.mockImplementation(async (userId: string) =>
      userId === 'user-a'
        ? serverState({
            records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'A', isPrivate: false, createdAt: 'x' }] as never,
            talkAboutMarks: [{ id: 'mark-a', recordId: 'rec-a', coupleId: 'couple-a', actorUserId: 'user-a', createdAt: 'x', isCompleted: false }],
            profile: { myName: 'A', role: 'gomsin', couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' }, military: {} as never, contact: {} as never } as never,
          })
        : null,
    );

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('rec-a'));
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-a');

    // Account B has no profile row yet; account A's cached records must not survive.
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-b');
    });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    expect(screen.getByTestId('records')).toHaveTextContent('');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('');
    expect(screen.getByTestId('name')).toHaveTextContent('');
  });

  it('fails closed immediately while a different account is hydrating', async () => {
    let resolveUserB!: (value: Partial<AppState> | null) => void;
    fetchFullStateFromDB.mockImplementation((userId: string) => {
      if (userId === 'user-a') {
        return Promise.resolve(serverState({
          records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'A secret', isPrivate: true, createdAt: 'x' }] as never,
          events: [{ id: 'event-a' }] as never,
          profile: { myName: 'A', role: 'gomsin', couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' }, military: {} as never, contact: {} as never } as never,
        }));
      }
      return new Promise((resolve) => { resolveUserB = resolve; });
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('rec-a'));

    await act(async () => emitAuth('SIGNED_IN', 'user-b'));

    expect(screen.getByTestId('ready')).toHaveTextContent('loading');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('records')).toHaveTextContent('');
    expect(screen.getByTestId('events')).toHaveTextContent('');
    expect(screen.getByTestId('name')).toHaveTextContent('');

    await act(async () => resolveUserB(null));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('user')).toHaveTextContent('user-b');
  });

  it('discards legacy cached account content on signed-out reload', async () => {
    const legacyCachedState = {
      setupComplete: true,
      profile: { myName: '춘향', role: 'gomsin', couple: { partnerName: '몽룡', coupleCode: '123456', connected: true, status: 'active' }, military: {} as never, contact: {} as never } as never,
      records: [{ id: 'cached-1', date: '2026-07-31', time: '09:00', authorRole: 'gomsin', log: 'cached', isPrivate: false, createdAt: 'x' }] as never,
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(legacyCachedState));

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('INITIAL_SESSION', null);
    });

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('setup')).toHaveTextContent('false');
    expect(screen.getByTestId('records')).not.toHaveTextContent('cached-1');
  });

  it('resets to a signed-out state when there is no session', async () => {
    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('INITIAL_SESSION', null);
    });

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('setup')).toHaveTextContent('false');
  });

  it('purges the cached account data on sign out', async () => {
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'secret', isPrivate: false, createdAt: 'x' }] as never,
        profile: { myName: '춘향', role: 'gomsin', couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' }, military: {} as never, contact: {} as never } as never,
      }),
    );

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('rec-a'));

    await act(async () => {
      screen.getByText('signout').click();
    });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    const cached = localStorage.getItem(STORE_KEY);
    // Either the key is gone, or it holds no account data at all.
    if (cached) {
      const parsed = JSON.parse(cached) as AppState;
      expect(parsed.records).toEqual([]);
      expect(parsed.authenticatedUser).toBeNull();
      expect(cached).not.toContain('secret');
    }
  });

  /**
   * The ORDER of the sign-out steps, which is the part a database cannot enforce.
   *
   * §14.3 requires a push token to be invalidated on sign-out. The RPC that does
   * it reads `auth.uid()`, so it has to run while the session is still valid.
   * Called after `authRepository.signOut()` it would look identical at the call
   * site, return without complaint, and never actually revoke anything -- the
   * failure would surface months later as a signed-out phone still buzzing.
   */
  it('releases the push tokens BEFORE the session is torn down', async () => {
    const { authRepository } = await import('@/lib/supabase');
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));

    await act(async () => { screen.getByText('signout').click(); });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));

    const revoke = mockSupabase.rpc.mock.calls.findIndex(
      (call) => call[0] === 'revoke_my_push_tokens',
    );
    expect(revoke, 'sign-out must ask the server to drop this device').toBeGreaterThanOrEqual(0);

    // Invocation order across two different spies, which is what actually pins
    // the sequence: comparing call counts would pass either way round.
    const revokeOrder = mockSupabase.rpc.mock.invocationCallOrder[revoke];
    const signOutOrder = vi.mocked(authRepository.signOut).mock.invocationCallOrder[0];
    expect(signOutOrder, 'the auth sign-out must have happened').toBeDefined();
    expect(revokeOrder).toBeLessThan(signOutOrder);
  });

  it('signs out even when the token revocation is refused', async () => {
    // A notification cleanup must never be able to trap someone in a session.
    mockSupabase.rpc.mockImplementation(async (name: string) => (
      name === 'revoke_my_push_tokens'
        ? { data: null, error: { message: 'refused' } }
        : { data: null, error: null }
    ));
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));

    await act(async () => { screen.getByText('signout').click(); });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
  });

  it('clears the couple id and shared state, then tears down realtime after disconnect', async () => {
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'shared', isPrivate: false, createdAt: 'x' }] as never,
        events: [
          { id: 'event-shared', isPrivate: false, createdBy: 'user-a' },
          { id: 'event-private', isPrivate: true, createdBy: 'user-a' },
        ] as never,
        trips: [{ id: 'trip-a' }] as never,
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: {
            coupleId: 'couple-1',
            partnerName: '몽룡',
            anniversaryDate: '2025-01-01',
            coupleCode: '',
            connected: true,
            status: 'active',
          },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));
    const sharedChannel = createdChannels.find((channel) => channel.name === 'couple-sync:couple-1');
    expect(sharedChannel).toBeDefined();

    await act(async () => {
      screen.getByText('disconnect').click();
    });

    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    expect(screen.getByTestId('partner')).toHaveTextContent('none');
    expect(screen.getByTestId('anniversary')).toHaveTextContent('none');
    expect(screen.getByTestId('records')).toHaveTextContent('');
    expect(screen.getByTestId('events')).toHaveTextContent('event-private');
    expect(screen.getByTestId('events')).not.toHaveTextContent('event-shared');
    expect(screen.getByTestId('trips')).toHaveTextContent('');
    expect(screen.getByTestId('name')).toHaveTextContent('춘향');
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    await waitFor(() => expect(mockSupabase.removeChannel).toHaveBeenCalledWith(sharedChannel));
  });

  it('purges shared access when the own membership realtime row is revoked', async () => {
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        records: [{ id: 'rec-a', log: 'shared' }] as never,
        events: [{ id: 'event-a' }] as never,
        trips: [{ id: 'trip-a' }] as never,
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const membershipCall = channel.on.mock.calls.find((call) => call[1]?.table === 'couple_members');
    expect(membershipCall?.[1]?.filter).toBe('user_id=eq.user-a');

    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await act(async () => {
      membershipCall?.[2]?.({});
    });

    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    expect(screen.getByTestId('records')).toHaveTextContent('');
    expect(screen.getByTestId('events')).toHaveTextContent('');
    expect(screen.getByTestId('trips')).toHaveTextContent('');
    await waitFor(() => expect(mockSupabase.removeChannel).toHaveBeenCalledWith(channel));
  });

  it('reconciles membership on foreground and purges a missed disconnect', async () => {
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'rec-a', log: 'shared' }] as never,
      events: [{ id: 'event-a', isPrivate: false, createdBy: 'user-a' }] as never,
      trips: [{ id: 'trip-a' }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));

    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    expect(screen.getByTestId('records')).toHaveTextContent('');
    expect(screen.getByTestId('events')).toHaveTextContent('');
    expect(screen.getByTestId('trips')).toHaveTextContent('');
  });

  it('reconciles membership when a visible client comes back online', async () => {
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'rec-a', log: 'shared' }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));

    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    expect(screen.getByTestId('records')).toHaveTextContent('');
  });

  it('refetches events from RLS-visible rows after a privacy invalidation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      events: [{ id: 'event-shared', isPrivate: false, createdBy: 'partner-a' }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent('event-shared'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );
    expect(invalidationCall).toBeDefined();

    fetchEventsResultFromDB.mockResolvedValueOnce({ ok: true, events: [] });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'events' } });
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent(''));
  });

  it('does not append an event saved for account A after switching to account B', async () => {
    let resolveSave!: (value: unknown) => void;
    saveEventToDB.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    fetchFullStateFromDB.mockImplementation(async (userId: string) => serverState({
      events: userId === 'user-b' ? [{
        id: 'event-b', coupleId: 'couple-b', createdBy: 'user-b', title: 'B',
        eventType: 'date', startDate: '2026-08-02', isPrivate: false, createdAt: 'x',
      }] as never : [],
      profile: {
        myName: userId,
        role: 'gomsin',
        couple: {
          coupleId: userId === 'user-a' ? 'couple-a' : 'couple-b',
          partnerName: 'partner', coupleCode: '', connected: true, status: 'active',
        },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-a'));
    screen.getByText('add-event').click();
    await waitFor(() => expect(saveEventToDB).toHaveBeenCalledTimes(1));

    await act(async () => emitAuth('SIGNED_IN', 'user-b'));
    await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent('event-b'));
    await act(async () => resolveSave({
      id: 'event-a-new', coupleId: 'couple-a', createdBy: 'user-a', title: 'A',
      eventType: 'date', startDate: '2026-08-01', isPrivate: false, createdAt: 'x',
    }));

    expect(screen.getByTestId('events')).toHaveTextContent('event-b');
    expect(screen.getByTestId('events')).not.toHaveTextContent('event-a-new');
  });

  it('ignores a deferred event reload after disconnect', async () => {
    let resolveReload!: (value: unknown) => void;
    fetchEventsResultFromDB.mockReturnValue(new Promise((resolve) => { resolveReload = resolve; }));
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-1'));
    screen.getByText('reload-events').click();
    await waitFor(() => expect(fetchEventsResultFromDB).toHaveBeenCalledTimes(1));
    await act(async () => { screen.getByText('disconnect').click(); });
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));

    await act(async () => resolveReload({ ok: true, events: [{ id: 'stale-event' }] }));
    expect(screen.getByTestId('events')).toHaveTextContent('');
  });

  it('does not subscribe while pending and stops the pending partner poll on disconnect', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: {
            coupleId: 'couple-pending',
            partnerName: '',
            coupleCode: '123456',
            connected: false,
            status: 'pending',
          },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalledTimes(1));
    expect(mockSupabase.channel).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByText('disconnect').click();
    });
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    const callsAfterDisconnect = mockSupabase.rpc.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterDisconnect);
  });

  it('replaces the active couple channel when the authenticated account changes', async () => {
    fetchFullStateFromDB.mockImplementation(async (userId: string) =>
      serverState({
        profile: {
          myName: userId,
          role: 'gomsin',
          couple: {
            coupleId: userId === 'user-a' ? 'couple-a' : 'couple-b',
            partnerName: 'partner',
            coupleCode: '',
            connected: true,
            status: 'active',
          },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-a'));
    const firstChannel = createdChannels.find((channel) => channel.name === 'couple-sync:couple-a');

    await act(async () => emitAuth('SIGNED_IN', 'user-b'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-b'));
    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(firstChannel);
  });

  it('saves the record row before uploading media (storage RLS requires it)', async () => {
    callOrder.length = 0;
    saveRecordToDB.mockClear();
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    const files = [
      new File(['a'], 'first.png', { type: 'image/png' }),
      new File(['b'], 'second.png', { type: 'image/png' }),
    ];

    render(
      <StoreProvider>
        <Probe files={files} />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));

    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(screen.getByTestId('attachments')).toHaveTextContent('first.png'));

    // The storage INSERT policy checks that daily_records already contains the
    // row, so the first call must be the record save.
    expect(callOrder[0]).toBe('saveRecord');
    expect(callOrder).toContain('upload:first.png');
    expect(callOrder).toContain('upload:second.png');
    expect(callOrder.indexOf('saveRecord')).toBeLessThan(callOrder.indexOf('upload:first.png'));
    // A second save patches the row with the attachment metadata.
    expect(callOrder.filter((c) => c === 'saveRecord')).toHaveLength(2);
    expect(screen.getByTestId('attachments')).toHaveTextContent('second.png');
  });

  it('stages a public all-or-nothing post privately and publishes it with the complete media patch', async () => {
    callOrder.length = 0;
    saveRecordToDB.mockClear();
    lastMediaResult = null;
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(
      <StoreProvider>
        <Probe files={[new File(['a'], 'post.png', { type: 'image/png' })]} allOrNothingMedia />
      </StoreProvider>,
    );
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());

    const savedVersions = saveRecordToDB.mock.calls.map((call) => call[0] as DailyRecord);
    expect(savedVersions).toHaveLength(2);
    expect(savedVersions[0].isPrivate).toBe(true);
    expect(savedVersions[0].isProfilePost).toBeUndefined();
    expect(savedVersions[0].attachments).toBeUndefined();
    expect(savedVersions[1].isPrivate).toBe(false);
    expect(savedVersions[1].isProfilePost).toBe(true);
    expect(savedVersions[1].attachments?.map((attachment) => attachment.name)).toEqual(['post.png']);
    expect(screen.getByTestId('privacy')).toHaveTextContent('public');
  });

  it('keeps uploaded media when the attachment patch response is lost and read-back confirms commit', async () => {
    callOrder.length = 0;
    removeRecordMedia.mockClear();
    saveRecordToDB.mockReset()
      .mockResolvedValueOnce({ ok: true, contentRevision: 1 })
      .mockResolvedValueOnce({ ok: false, reason: 'offline' });
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );
    fetchRecordsResultFromDB.mockImplementation(async () => {
      const intended = saveRecordToDB.mock.calls[1]?.[0] as DailyRecord | undefined;
      return {
        ok: true,
        records: intended ? [{ ...intended, userId: 'user-a', contentRevision: 2 }] : [],
      };
    });

    render(
      <StoreProvider>
        <Probe files={[new File(['a'], 'post.png', { type: 'image/png' })]} allOrNothingMedia />
      </StoreProvider>,
    );
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());

    expect(lastMediaResult?.ok).toBe(true);
    expect(lastMediaResult?.failedFiles).toEqual([]);
    expect(removeRecordMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId('attachments')).toHaveTextContent('post.png');
  });

  it('preserves all-or-nothing post intent when the initial save is queued', async () => {
    lastMediaResult = null;
    saveRecordToDB.mockImplementationOnce(async () => ({
      ok: false as const,
      reason: 'offline' as const,
    }));
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(
      <StoreProvider>
        <Probe files={[new File(['a'], 'post.png', { type: 'image/png' })]} allOrNothingMedia />
      </StoreProvider>,
    );
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult?.queued).toBe(true));

    const queued = Array.from(outboxEntries.values());
    expect(queued).toHaveLength(1);
    expect(queued[0].allOrNothingMedia).toBe(true);
    expect(queued[0].files.map((file) => file.name)).toEqual(['post.png']);

    saveRecordToDB.mockReset()
      .mockResolvedValueOnce({ ok: true, contentRevision: 1 })
      .mockResolvedValueOnce({ ok: true, contentRevision: 2 });
    lastFlushResult = null;
    await act(async () => screen.getByText('flush').click());
    await waitFor(() => expect(lastFlushResult).toEqual({ delivered: 1, requeued: 0, blocked: 0 }));

    const replayedVersions = saveRecordToDB.mock.calls.map((call) => call[0] as DailyRecord);
    expect(replayedVersions).toHaveLength(2);
    expect(replayedVersions[0].isPrivate).toBe(true);
    expect(replayedVersions[0].isProfilePost).toBeUndefined();
    expect(replayedVersions[1].isPrivate).toBe(false);
    expect(replayedVersions[1].isProfilePost).toBe(true);
    expect(outboxEntries.size).toBe(0);
  });

  it('blocks an immediate shared save while connected couple protection is pending', async () => {
    featureFlagMock.isDeviceProtectionEnabled = true;
    lastMediaResult = null;
    enforceProtectionBarrierInStoreMock = true;
    let resolveActivation!: (outcome: 'activated' | 'unavailable') => void;
    const activationPending = new Promise<'activated' | 'unavailable'>((resolve) => {
      resolveActivation = resolve;
    });
    activateCoupleProtectionForAuthenticatedSession.mockImplementationOnce(
      async () => activationPending,
    );
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-1',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: true,
        invitationActive: false,
        invitationExpiresAt: null,
      },
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await waitFor(() => expect(activateCoupleProtectionForAuthenticatedSession).toHaveBeenCalledTimes(1));

    // Repeated connected refreshes reuse the unresolved activation attempt.
    await act(async () => {
      screen.getByText('refresh-lifecycle').click();
      screen.getByText('refresh-lifecycle').click();
    });
    expect(activateCoupleProtectionForAuthenticatedSession).toHaveBeenCalledTimes(1);

    // The real records writer is separately covered by records.test.ts; this
    // store boundary proves the connected state cannot proceed as a plaintext
    // save while the activation promise is unresolved.
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());
    expect(lastMediaResult?.ok).toBe(false);
    expect(lastMediaResult?.reason).toBe('protection_required');
    expect(screen.getByTestId('logs')).toHaveTextContent('');

    resolveActivation('unavailable');
    await waitFor(() => expect(isCoupleProtectionRequired('user-a', 'couple-1')).toBe(true));

    // A failed activation does not clear the barrier. A later connected refresh
    // may retry, and only that retry's confirmed success can release it.
    activateCoupleProtectionForAuthenticatedSession.mockImplementationOnce(
      async () => 'activated' as const,
    );
    await act(async () => screen.getByText('refresh-lifecycle').click());
    await waitFor(() => expect(isCoupleProtectionRequired('user-a', 'couple-1')).toBe(false));

    lastMediaResult = null;
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult?.ok).toBe(true));
    expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록');
  });

  it('does not activate or retain couple protection barrier when feature is disabled and allows shared save', async () => {
    featureFlagMock.isDeviceProtectionEnabled = false;
    lastMediaResult = null;
    enforceProtectionBarrierInStoreMock = true;
    requireCoupleProtection('user-a', 'couple-1');
    expect(isCoupleProtectionRequired('user-a', 'couple-1')).toBe(true);

    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-1',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: true,
        invitationActive: false,
        invitationExpiresAt: null,
      },
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));

    expect(activateCoupleProtectionForAuthenticatedSession).not.toHaveBeenCalled();
    expect(isCoupleProtectionRequired('user-a', 'couple-1')).toBe(false);

    await act(async () => {
      screen.getByText('refresh-lifecycle').click();
    });
    expect(activateCoupleProtectionForAuthenticatedSession).not.toHaveBeenCalled();
    expect(isCoupleProtectionRequired('user-a', 'couple-1')).toBe(false);

    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());
    expect(lastMediaResult?.ok).toBe(true);
    expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록');
  });

  it('keeps the written text when a media upload fails, and reports the failure', async () => {
    callOrder.length = 0;
    lastMediaResult = null;
    uploadRecordMedia.mockImplementationOnce(async () => {
      callOrder.push('upload:fail');
      return { error: '파일을 올리지 못했어요.' };
    });
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(
      <StoreProvider>
        <Probe files={[new File(['a'], 'broken.png', { type: 'image/png' })]} />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));

    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록'));
    // Text survived, the failure is surfaced to the caller instead of silently swallowed.
    expect(lastMediaResult?.ok).toBe(true);
    expect(lastMediaResult?.failedFiles).toEqual(['broken.png']);
    expect(screen.getByTestId('attachments')).toHaveTextContent('');
  });

  it('post mode rolls back successful media when any file fails and returns the same row id', async () => {
    callOrder.length = 0;
    lastMediaResult = null;
    uploadRecordMedia.mockImplementation(async (file: File) => {
      if (file.name === 'broken.png') {
        callOrder.push('upload:fail');
        return { error: '파일을 올리지 못했어요.' };
      }
      callOrder.push(`upload:${file.name}`);
      return {
        attachment: {
          type: 'photo' as const,
          name: file.name,
          path: `couple-1/generated-record/${file.name}`,
        },
      };
    });
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(
      <StoreProvider>
        <Probe
          files={[
            new File(['a'], 'good.png', { type: 'image/png' }),
            new File(['b'], 'broken.png', { type: 'image/png' }),
          ]}
          allOrNothingMedia
        />
      </StoreProvider>,
    );
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));

    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());

    expect(lastMediaResult?.ok).toBe(true);
    expect(lastMediaResult?.failedFiles).toEqual(['good.png', 'broken.png']);
    expect(lastMediaResult?.recordId).toBeTruthy();
    expect(removeRecordMedia).toHaveBeenCalledWith([
      expect.stringContaining('/good.png'),
    ]);
    expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록');
    expect(screen.getByTestId('attachments')).toHaveTextContent('');
    expect((saveRecordToDB.mock.calls[0]?.[0] as DailyRecord).isPrivate).toBe(true);
    expect(screen.getByTestId('privacy')).toHaveTextContent('private');
  });

  it('refuses to create a record when no couple space is connected', async () => {
    lastMediaResult = null;
    // An AUTHORITATIVE negative: the server confirms there is no couple space, so
    // the create-a-space message is the correct one to show.
    fetchMyCoupleState.mockResolvedValue({ ok: true, state: null });
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));

    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(lastMediaResult).not.toBeNull());
    expect(lastMediaResult?.ok).toBe(false);
    expect(lastMediaResult?.error).toBe('커플 공간을 만든 뒤에 기록을 남길 수 있어요.');
    // Never a connection message for an authorization/membership cause.
    expect(lastMediaResult?.error).not.toContain('인터넷');
    expect(screen.getByTestId('records')).toHaveTextContent('');
  });

  it('does not persist authenticated shared collections at rest', async () => {
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'private-at-rest-record', log: 'shared body' }] as never,
      events: [{ id: 'private-at-rest-event' }] as never,
      trips: [{ id: 'private-at-rest-trip' }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('private-at-rest-record'));
    await waitFor(() => {
      const cached = localStorage.getItem(STORE_KEY) || '';
      expect(cached).not.toContain('private-at-rest-record');
      expect(cached).not.toContain('private-at-rest-event');
      expect(cached).not.toContain('private-at-rest-trip');
      expect(cached).not.toContain('shared body');
    });
  });

  it('ignores a token refresh for the account that is already loaded', async () => {
    fetchFullStateFromDB.mockResolvedValue(
      serverState({ profile: { myName: '춘향', role: 'gomsin', couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' }, military: {} as never, contact: {} as never } as never }),
    );

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    const callsAfterSignIn = fetchFullStateFromDB.mock.calls.length;

    await act(async () => {
      emitAuth('TOKEN_REFRESHED', 'user-a');
    });

    // No extra full-state fetch: a refreshed token changes nothing.
    expect(fetchFullStateFromDB.mock.calls.length).toBe(callsAfterSignIn);
  });

  it('allows record creation in a pending (solo) couple space', async () => {
    lastMediaResult = null;
    saveRecordToDB.mockClear();
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-solo', partnerName: '', coupleCode: '999999', connected: false, status: 'pending' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a');
    });
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('couple')).toHaveTextContent('couple-solo');

    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(lastMediaResult).not.toBeNull());
    expect(lastMediaResult?.ok).toBe(true);
    expect(saveRecordToDB).toHaveBeenCalled();
    expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록');
  });

  it('shows sharedSyncStatus as unavailable on channel error and resets it on account switch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'shared', isPrivate: false, createdAt: 'x' }] as never,
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: {
            coupleId: 'couple-1',
            partnerName: '몽룡',
            coupleCode: '',
            connected: true,
            status: 'active',
            partnerMilitary: { branch: 'army', militaryStatus: 'serving', dischargeDateSource: 'calculated' },
          },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));
    expect(screen.getByTestId('syncStatus')).toHaveTextContent('live');
    expect(screen.getByTestId('partnerMilitary')).toHaveTextContent('present');

    const channel = createdChannels.find((c) => c.name === 'couple-sync:couple-1')!;
    const subscribeCallback = channel.subscribe.mock.calls[0]?.[0];

    await act(async () => {
      subscribeCallback?.('CHANNEL_ERROR');
    });

    await waitFor(() => expect(screen.getByTestId('syncStatus')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('partnerMilitary')).toHaveTextContent('none');

    await act(async () => emitAuth('SIGNED_IN', 'user-b'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    expect(screen.getByTestId('syncStatus')).toHaveTextContent('live');
  });

  it('recovers shared data via HTTP after channel failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'shared', isPrivate: false, createdAt: 'x' }] as never,
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));

    const channel = createdChannels.find((c) => c.name === 'couple-sync:couple-1')!;
    const subscribeCallback = channel.subscribe.mock.calls[0]?.[0];

    // Set up mocks for the HTTP recovery path BEFORE triggering the error
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: 'couple-1', error: null });
    fetchRecordsResultFromDB.mockResolvedValue({
      ok: true,
      records: [{ id: 'rec-recovered', date: '2026-07-31', time: '12:00', userId: 'user-a', log: 'recovered', isPrivate: false, createdAt: 'x' }],
    });
    fetchEventsResultFromDB.mockReset().mockResolvedValue({ ok: true, events: [] });

    await act(async () => {
      subscribeCallback?.('CHANNEL_ERROR');
    });
    await waitFor(() => expect(screen.getByTestId('syncStatus')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('records')).toHaveTextContent('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(screen.getByTestId('syncStatus')).toHaveTextContent('delayed'));
    expect(screen.getByTestId('records')).toHaveTextContent('rec-recovered');

    const callsAfterFirstRecovery = mockSupabase.rpc.mock.calls.length;
    await act(async () => {
      // The next poll must back off to 4 seconds. The old implementation reset
      // after every successful HTTP read and hit all shared endpoints every 2s.
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 4);

    // The cap remains 30 seconds for subsequent recovery polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(callsAfterFirstRecovery + 5);
  });

  it('does not blank the timeline on foreground return', async () => {
    fetchFullStateFromDB.mockResolvedValue(
      serverState({
        records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'visible', isPrivate: false, createdAt: 'x' }] as never,
        profile: {
          myName: '춘향',
          role: 'gomsin',
          couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
          military: {} as never,
          contact: {} as never,
        } as never,
      }),
    );

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('rec-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));

    // Membership check returns valid couple - data should be refreshed, never blanked
    mockSupabase.rpc.mockResolvedValue({ data: 'couple-1', error: null });
    fetchRecordsResultFromDB.mockResolvedValue({
      ok: true,
      records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', userId: 'user-a', log: 'visible', isPrivate: false, createdAt: 'x' }],
    });
    fetchEventsResultFromDB.mockReset().mockResolvedValue({ ok: true, events: [] });

    // Simulate a foreground return
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // After reconciliation resolves with confirmed membership, records must survive
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('rec-a'));
  });
});

describe('profile persistence acknowledgement', () => {
  const profileState = () => serverState({
    profile: {
      myName: 'original-name',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: 'partner',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    } as never,
  });

  beforeEach(() => {
    authCallbacks.length = 0;
    createdChannels.length = 0;
    localStorage.clear();
    fetchFullStateFromDB.mockReset().mockResolvedValue(profileState());
    fetchRecordsResultFromDB.mockReset().mockResolvedValue({ ok: true, records: [] });
    mockSupabase.profileUpdateError = null;
    mockSupabase.profileUpdateMatched = true;
    saveCoupleAnniversary.mockReset().mockResolvedValue(true);
  });

  it('keeps the confirmed local profile when the server update fails', async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('original-name'));

    mockSupabase.profileUpdateError = { message: 'permission denied' };
    await act(async () => {
      screen.getByText('update-profile').click();
    });

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('original-name'));
    expect(screen.getByTestId('name')).not.toHaveTextContent('updated-name');
  });

  it('does not claim success when the profile update matched zero rows', async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('original-name'));

    mockSupabase.profileUpdateMatched = false;
    await act(async () => {
      screen.getByText('update-profile').click();
    });

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('original-name'));
    expect(screen.getByTestId('name')).not.toHaveTextContent('updated-name');
  });

  it('persists an anniversary clear as SQL NULL before updating local state', async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('anniversary')).toHaveTextContent('2025-01-01'));

    await act(async () => {
      screen.getByText('clear-anniversary').click();
    });

    await waitFor(() => expect(saveCoupleAnniversary).toHaveBeenCalledWith('couple-1', null));
    await waitFor(() => expect(screen.getByTestId('anniversary')).toHaveTextContent('none'));
  });

  it('writes normalized profile identity fields and only then updates local state', async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('original-name'));
    await act(async () => {
      screen.getByText('update-profile-identity').click();
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('Foo_Bar'));
    expect(mockSupabase.lastProfileUpdatePayload).toMatchObject({
      username: 'foo_bar',
      profile_caption: '오늘도 함께',
      profile_date_type: 'meeting',
    });
  });
});
