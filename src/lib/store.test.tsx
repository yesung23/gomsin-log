import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AppState } from '@/types';

type AuthCallback = (event: string, session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null) => void;

const authCallbacks: AuthCallback[] = [];
const unsubscribe = vi.fn();
const createdChannels: Array<{ name: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }> = [];

const mockSupabase = {
  profileUpdateError: null as null | { message: string },
  profileUpdateMatched: true,
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
    update: () => ({
      eq: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({
            data: mockSupabase.profileUpdateMatched ? { id: 'user-a' } : null,
            error: mockSupabase.profileUpdateError,
          }),
        }),
      }),
    }),
    upsert: () => Promise.resolve({ error: null }),
  }),
};

const disconnectCoupleFromDB = vi.fn().mockResolvedValue(true);
const saveCoupleAnniversary = vi.fn().mockResolvedValue(true);
// Default: the lifecycle RPC could NOT answer. By contract that leaves local
// couple state untouched, so every pre-existing scenario keeps its fixture
// workspace. Tests that care about a definite answer set it explicitly.
const fetchMyCoupleState = vi.fn().mockResolvedValue({ ok: false, reason: 'server' });

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
const saveRecordToDB = vi.fn(async () => {
  callOrder.push('saveRecord');
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

// Talk-about marks load alongside the other shared slices. Metadata only, and
// deliberately outside the ok/quarantine gate, so an empty list is the correct
// default for every scenario in this file.
vi.mock('@/lib/talkAbout', () => ({
  fetchTalkAboutMarksFromDB: vi.fn().mockResolvedValue([]),
  markTalkAboutInDB: vi.fn().mockResolvedValue({ ok: true }),
  unmarkTalkAboutInDB: vi.fn().mockResolvedValue({ ok: true }),
  resolveTalkAboutInDB: vi.fn().mockResolvedValue({ ok: true }),
}));

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');
const { fetchTripsResultFromDB: fetchTripsResultFromDBMock } = await import('@/lib/trips') as unknown as { fetchTripsResultFromDB: ReturnType<typeof vi.fn> };
const STORE_KEY = 'gomsinlog.state.v2';

let lastMediaResult: { ok: boolean; failedFiles: string[]; error?: string } | null = null;

function Probe({ files = [] as File[] }: { files?: File[] }) {
  const { state, isReady, authSyncUnavailable, sharedSyncStatus, signOut, disconnect, updateProfile, addRecordWithMedia, addEvent, reloadEvents } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="authSync">{authSyncUnavailable ? 'unavailable' : 'available'}</span>
      <span data-testid="syncStatus">{sharedSyncStatus}</span>
      <span data-testid="setup">{String(state.setupComplete)}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <span data-testid="name">{state.profile.myName}</span>
      <span data-testid="couple">{state.profile.couple.coupleId ?? 'none'}</span>
      <span data-testid="partner">{state.profile.couple.partnerName || 'none'}</span>
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
      <button
        onClick={() => {
          void addRecordWithMedia(
            {
              date: '2026-07-31',
              time: '12:00',
              authorRole: 'gomsin',
              log: '오늘의 기록',
              isPrivate: false,
            },
            files,
          ).then((result) => {
            lastMediaResult = result;
          });
        }}
      >
        post
      </button>
      <button onClick={() => void signOut()}>signout</button>
      <button onClick={() => void disconnect()}>disconnect</button>
      <button onClick={() => void updateProfile({ myName: 'updated-name' })}>update-profile</button>
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
    fetchFullStateFromDB.mockReset();
    mockSupabase.profileUpdateError = null;
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
    disconnectCoupleFromDB.mockReset().mockResolvedValue(true);
    fetchEventsResultFromDB.mockReset().mockResolvedValue({ ok: true, events: [] });
    fetchTripsResultFromDBMock.mockReset().mockResolvedValue({ ok: true, trips: [] });
    saveEventToDB.mockReset().mockResolvedValue(null);
    updateEventInDB.mockReset().mockResolvedValue(null);
    deleteEventFromDB.mockReset().mockResolvedValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(screen.getByTestId('syncStatus')).toHaveTextContent('live');

    const channel = createdChannels.find((c) => c.name === 'couple-sync:couple-1')!;
    const subscribeCallback = channel.subscribe.mock.calls[0]?.[0];

    await act(async () => {
      subscribeCallback?.('CHANNEL_ERROR');
    });

    await waitFor(() => expect(screen.getByTestId('syncStatus')).toHaveTextContent('unavailable'));

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
});
