import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useEffect } from 'react';
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

function installTestWebLocks(): void {
  type PendingLock = {
    mode: LockMode;
    callback: (lock: Lock | null) => PromiseLike<unknown> | unknown;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  };
  type LockState = {
    activeShared: number;
    activeExclusive: boolean;
    queue: PendingLock[];
  };
  const states = new Map<string, LockState>();

  const pump = (name: string, state: LockState): void => {
    if (state.activeExclusive || state.queue.length === 0) return;
    if (state.queue[0]?.mode === 'exclusive' && state.activeShared > 0) return;

    const grant = (entry: PendingLock) => {
      if (entry.mode === 'exclusive') state.activeExclusive = true;
      else state.activeShared += 1;
      void Promise.resolve()
        .then(() => entry.callback({ name, mode: entry.mode } as Lock))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          if (entry.mode === 'exclusive') state.activeExclusive = false;
          else state.activeShared -= 1;
          if (!state.activeExclusive && state.activeShared === 0 && state.queue.length === 0) {
            states.delete(name);
          }
          pump(name, state);
        });
    };

    if (state.queue[0]?.mode === 'exclusive') {
      grant(state.queue.shift()!);
      return;
    }
    while (state.queue[0]?.mode === 'shared' && !state.activeExclusive) {
      grant(state.queue.shift()!);
    }
  };

  const request = vi.fn(async <T,>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => PromiseLike<T> | T,
  ): Promise<T> => {
    const mode = options.mode ?? 'exclusive';
    const state = states.get(name) ?? {
      activeShared: 0,
      activeExclusive: false,
      queue: [],
    };
    states.set(name, state);
    const canGrantImmediately = state.queue.length === 0
      && !state.activeExclusive
      && (mode === 'shared' || state.activeShared === 0);
    if (options.ifAvailable && !canGrantImmediately) return callback(null);
    return new Promise<T>((resolve, reject) => {
      state.queue.push({
        mode,
        callback: callback as PendingLock['callback'],
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      pump(name, state);
    });
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request },
  });
}

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
  rpc: vi.fn(async (name: string) => (
    name === 'is_my_account_deletion_pending'
      ? { data: false, error: null }
      : { data: null, error: null }
  )),
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
  add: vi.fn(async (entry) => {
    if (outboxEntries.has(entry.id)) throw new DOMException('duplicate', 'ConstraintError');
    outboxEntries.set(entry.id, entry);
  }),
  put: vi.fn(async (entry) => { outboxEntries.set(entry.id, entry); }),
  putMany: vi.fn(async (entries) => {
    for (const entry of entries) outboxEntries.set(entry.id, entry);
  }),
  remove: vi.fn(async (id) => { outboxEntries.delete(id); }),
  removeMany: vi.fn(async (ids) => { for (const id of ids) outboxEntries.delete(id); }),
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
const defaultFetchFullStateResult = async (userId: string) => {
  const result = await fetchFullStateFromDB(userId);
  return result === FULL_STATE_UNAVAILABLE
    ? { ok: false as const, reason: 'unknown' as const }
    : { ok: true as const, state: result };
};
const fetchFullStateResultFromDB = vi.fn(defaultFetchFullStateResult);
vi.mock('@/lib/sync', () => ({
  fetchFullStateFromDB: (userId: string) => fetchFullStateFromDB(userId),
  // The store reads the reason-carrying variant. Deriving it from the same mock
  // keeps every existing scenario byte-identical while exercising the new shape.
  fetchFullStateResultFromDB: (userId: string) => fetchFullStateResultFromDB(userId),
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
const uploadRecordMedia = vi.fn(async (
  file: File,
  coupleId?: string,
  recordId?: string,
  _displayName?: string,
  objectId?: string,
) => {
  callOrder.push(`upload:${file.name}`);
  return {
    attachment: {
      type: 'photo' as const,
      name: file.name,
      path: objectId
        ? `${coupleId}/${recordId}/${objectId}.png`
        : `c/r/${file.name}`,
    },
  };
});
const beginRecordMediaMutation = vi.fn(async (
  request: { baseContentRevision: number },
) => ({
  ok: true as const,
  state: 'pending' as const,
  targetContentRevision: request.baseContentRevision + 1,
}));
const getRecordMediaMutationStatus = vi.fn(async () => ({
  ok: true as const,
  state: 'pending' as const,
}));
const abandonRecordMediaMutation = vi.fn(async () => ({
  ok: true as const,
  state: 'abandoned' as const,
}));

const fetchRecordsFromDB = vi.fn(async () => []);

const fetchRecordsResultFromDB = vi.fn(async () => ({ ok: true, records: [] }));
const deleteRecordFromDB = vi.fn(async () => ({ ok: true as const }));
const activateCoupleProtectionForAuthenticatedSession = vi.fn(async () => 'not_paired' as const);

vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => saveRecordToDB(...(args as [])),
  deleteRecordFromDB: (...args: unknown[]) => deleteRecordFromDB(...(args as [])),
  fetchRecordsFromDB: (...args: unknown[]) => fetchRecordsFromDB(...(args as [])),
  fetchRecordsResultFromDB: (...args: unknown[]) => fetchRecordsResultFromDB(...(args as [])),
  uploadRecordMedia: (...args: unknown[]) => uploadRecordMedia(
    ...(args as [File, string?, string?, string?, string?]),
  ),
  beginRecordMediaMutation: (...args: unknown[]) => beginRecordMediaMutation(...(args as [])),
  getRecordMediaMutationStatus: (...args: unknown[]) => getRecordMediaMutationStatus(...(args as [])),
  abandonRecordMediaMutation: (...args: unknown[]) => abandonRecordMediaMutation(...(args as [])),
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: (file: { type: string }) =>
    file.type.startsWith('image/')
      ? { ext: 'png', type: 'photo' }
      : { error: 'unsupported' },
  isCanonicalRecordMediaPath: (path: unknown, coupleId: string, recordId: string) => {
    if (typeof path !== 'string') return false;
    return path.startsWith(`${coupleId}/${recordId}/`);
  },
  isValidMediaObjectId: (value: string) => (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ),
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
const markTalkAboutInDB = vi.fn().mockResolvedValue({ ok: true });
const unmarkTalkAboutInDB = vi.fn().mockResolvedValue({ ok: true });
const resolveTalkAboutInDB = vi.fn().mockResolvedValue({ ok: true });
const recordProductEvent = vi.fn().mockResolvedValue(undefined);

// Talk-about marks load alongside the other shared slices. A failed read keeps
// the old list; the normal default here is an authoritative empty result.
vi.mock('@/lib/talkAbout', () => ({
  fetchTalkAboutMarksResultFromDB: (...args: unknown[]) => fetchTalkAboutMarksResultFromDB(...args),
  markTalkAboutInDB: (...args: unknown[]) => markTalkAboutInDB(...args),
  unmarkTalkAboutInDB: (...args: unknown[]) => unmarkTalkAboutInDB(...args),
  resolveTalkAboutInDB: (...args: unknown[]) => resolveTalkAboutInDB(...args),
}));

vi.mock('@/lib/productEvents', () => ({
  recordProductEvent: (...args: unknown[]) => recordProductEvent(...args),
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
  retryableFailedFileIndexes?: number[];
  error?: string;
  reason?: string;
  recordId?: string;
} | null = null;
let lastFlushResult: { delivered: number; requeued: number; blocked: number } | null = null;
let lastTalkAboutResult: { ok: boolean; error?: string; syncPending?: boolean } | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function Probe({
  files = [] as File[],
  allOrNothingMedia = false,
  onCommit,
}: {
  files?: File[];
  allOrNothingMedia?: boolean;
  onCommit?: (state: AppState) => void;
}) {
  const {
    state,
    isReady,
    authSyncUnavailable,
    sharedSyncStatus,
    talkAboutSyncStatus,
    coupleLifecycle,
    signOut,
    disconnect,
    updateProfile,
    addRecordWithMedia,
    updateRecord,
    deleteRecord,
    queueRecordForLater,
    flushOutbox,
    refreshCoupleLifecycle,
    outboxWaiting,
    outboxBlocked,
    addEvent,
    reloadEvents,
    markTalkAbout,
    unmarkTalkAbout,
    resolveTalkAbout,
    setLocale,
  } = useStore();
  useEffect(() => {
    onCommit?.(state);
  }, [onCommit, state]);
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="authSync">{authSyncUnavailable ? 'unavailable' : 'available'}</span>
      <span data-testid="syncStatus">{sharedSyncStatus}</span>
      <span data-testid="talkSyncStatus">{talkAboutSyncStatus}</span>
      <span data-testid="coupleLifecycle">{coupleLifecycle}</span>
      <span data-testid="setup">{String(state.setupComplete)}</span>
      <span data-testid="locale">{state.locale ?? 'none'}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <span data-testid="name">{state.profile.myName}</span>
      <span data-testid="username">{state.profile.username ?? 'none'}</span>
      <span data-testid="gender">{state.profile.genderIdentity ?? 'none'}</span>
      <span data-testid="couple">{state.profile.couple.coupleId ?? 'none'}</span>
      <span data-testid="partner">{state.profile.couple.partnerName || 'none'}</span>
      <span data-testid="partnerId">{state.profile.couple.partnerUserId ?? 'none'}</span>
      <span data-testid="partnerMilitary">{state.profile.couple.partnerMilitary ? 'present' : 'none'}</span>
      <span data-testid="anniversary">{state.profile.couple.anniversaryDate ?? 'none'}</span>
      <span data-testid="records">{state.records.map((r) => r.id).join(',')}</span>
      <span data-testid="events">{state.events.map((event) => event.id).join(',')}</span>
      <span data-testid="trips">{state.trips.map((trip) => trip.id).join(',')}</span>
      <span data-testid="highlights">{(state.coupleHighlights ?? []).map((highlight) => highlight.id).join(',')}</span>
      <span data-testid="talkAboutMarks">{(state.talkAboutMarks ?? []).map((mark) => mark.id).join(',')}</span>
      <span data-testid="highlightedRecord">{state.highlightedRecordId ?? 'none'}</span>
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
        const first = state.records[0];
        if (first) void updateRecord(first.id, { log: '수정된 최신 기록' });
      }}>update-first-record</button>
      <button onClick={() => {
        const first = state.records[0];
        if (first) void deleteRecord(first.id);
      }}>delete-first-record</button>
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
      <button onClick={() => setLocale('en')}>set-locale-en</button>
      <button onClick={() => setLocale('ko')}>set-locale-ko</button>
      <button onClick={() => void updateProfile({
        username: ' Foo_Bar ',
        profileCaption: '오늘도 함께',
        profileDateType: 'meeting',
      })}>update-profile-identity</button>
      <button onClick={() => void updateProfile({ genderIdentity: 'woman' })}>set-gender</button>
      <button onClick={() => void updateProfile({ genderIdentity: undefined })}>clear-gender</button>
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
      <button onClick={() => {
        void markTalkAbout('record-talk').then((result) => { lastTalkAboutResult = result; });
      }}>mark-talk</button>
      <button onClick={() => {
        void unmarkTalkAbout('record-talk').then((result) => { lastTalkAboutResult = result; });
      }}>unmark-talk</button>
      <button onClick={() => {
        void resolveTalkAbout('record-talk').then((result) => { lastTalkAboutResult = result; });
      }}>resolve-talk</button>
    </div>
  );
}

function OnboardingStepProbe({
  onRender,
}: {
  onRender: (setter: (step: number) => void) => void;
}) {
  const { state, isReady, setOnboardingStep } = useStore();
  onRender(setOnboardingStep);

  return (
    <div>
      <span data-testid="onboarding-ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="onboarding-step">{state.onboardingStep}</span>
      <button onClick={() => setOnboardingStep(state.onboardingStep)}>
        write-same-onboarding-step
      </button>
      <button onClick={() => setOnboardingStep(state.onboardingStep + 1)}>
        advance-onboarding-step
      </button>
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
    installTestWebLocks();
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
    fetchFullStateResultFromDB.mockReset().mockImplementation(defaultFetchFullStateResult);
    mockSupabase.profileUpdateError = null;
    mockSupabase.lastProfileUpdatePayload = null;
    mockSupabase.profileUpdateMatched = true;
    saveCoupleAnniversary.mockReset().mockResolvedValue(true);
    fetchRecordsResultFromDB.mockReset().mockResolvedValue({ ok: true, records: [] });
    deleteRecordFromDB.mockReset().mockResolvedValue({ ok: true });
    beginRecordMediaMutation.mockReset().mockImplementation(async (
      request: { baseContentRevision: number },
    ) => ({
      ok: true,
      state: 'pending',
      targetContentRevision: request.baseContentRevision + 1,
    }));
    getRecordMediaMutationStatus.mockReset().mockResolvedValue({ ok: true, state: 'pending' });
    abandonRecordMediaMutation.mockReset().mockResolvedValue({ ok: true, state: 'abandoned' });
    mockSupabase.channel.mockClear();
    mockSupabase.removeChannel.mockClear();
    mockSupabase.rpc.mockReset().mockImplementation(async (name: string) => (
      name === 'is_my_account_deletion_pending'
        ? { data: false, error: null }
        : { data: null, error: null }
    ));
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
    markTalkAboutInDB.mockReset().mockResolvedValue({ ok: true });
    unmarkTalkAboutInDB.mockReset().mockResolvedValue({ ok: true });
    resolveTalkAboutInDB.mockReset().mockResolvedValue({ ok: true });
    recordProductEvent.mockReset().mockResolvedValue(undefined);
    lastTalkAboutResult = null;
    saveEventToDB.mockReset().mockResolvedValue(null);
    updateEventInDB.mockReset().mockResolvedValue(null);
    deleteEventFromDB.mockReset().mockResolvedValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps the onboarding step writer stable and treats the same step as a no-op', async () => {
    const setters: Array<(step: number) => void> = [];
    let renderCount = 0;

    render(
      <StoreProvider>
        <OnboardingStepProbe onRender={(setter) => {
          renderCount += 1;
          setters.push(setter);
        }} />
      </StoreProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const settledRenderCount = renderCount;
    const settledSetter = setters.at(-1);
    screen.getByRole('button', { name: 'write-same-onboarding-step' }).click();
    await act(async () => { await Promise.resolve(); });

    expect(renderCount).toBe(settledRenderCount);
    expect(setters.at(-1)).toBe(settledSetter);

    screen.getByRole('button', { name: 'advance-onboarding-step' }).click();
    await waitFor(() => expect(screen.getByTestId('onboarding-step')).toHaveTextContent('1'));
    expect(setters.at(-1)).toBe(settledSetter);
  });

  afterEach(() => {
    vi.useRealTimers();
    setOutboxLocalCacheKey(null);
    Reflect.deleteProperty(navigator, 'locks');
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
    await waitFor(() => expect(lastFlushResult).toEqual({ delivered: 0, requeued: 0, blocked: 0 }));

    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(Array.from(outboxEntries.values())[0]).toMatchObject({ attempts: 0 });
    expect(Array.from(outboxEntries.values())[0].blocked).toBeUndefined();
  });

  it('enters the app when Supabase restores the persisted initial session', async () => {
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
      emitAuth('INITIAL_SESSION', 'user-a');
    });

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    expect(screen.getByTestId('setup')).toHaveTextContent('true');
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

  it('reports a committed talk-about write separately when reconciliation is delayed', async () => {
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchTalkAboutMarksResultFromDB.mockResolvedValueOnce({
      ok: false,
      error: new Error('refresh failed'),
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-1'));

    screen.getByText('mark-talk').click();

    await waitFor(() => expect(lastTalkAboutResult).toEqual({ ok: true, syncPending: true }));
    expect(markTalkAboutInDB).toHaveBeenCalledWith(
      'record-talk',
      'couple-1',
      'user-a',
      expect.objectContaining({ userId: 'user-a' }),
    );
  });

  it('returns a fully reconciled talk-about success only after the authoritative list refreshes', async () => {
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchTalkAboutMarksResultFromDB.mockResolvedValueOnce({
      ok: true,
      marks: [{
        id: 'mark-new', recordId: 'record-talk', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T01:00:00.000Z', isCompleted: false,
      }],
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-1'));

    screen.getByText('mark-talk').click();

    await waitFor(() => expect(lastTalkAboutResult).toEqual({ ok: true }));
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-new');
  });

  it('does not restore talk-about metadata after the workspace is quarantined mid-refresh', async () => {
    let finishRefresh!: (value: { ok: true; marks: Array<{
      id: string; recordId: string; coupleId: string; actorUserId: string;
      createdAt: string; isCompleted: boolean;
    }> }) => void;
    fetchFullStateFromDB.mockResolvedValue(serverState({
      talkAboutMarks: [{
        id: 'mark-old', recordId: 'record-old', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T00:00:00.000Z', isCompleted: false,
      }],
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchTalkAboutMarksResultFromDB.mockImplementationOnce(() => new Promise((resolve) => {
      finishRefresh = resolve;
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-old'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const subscribeCallback = channel.subscribe.mock.calls[0]?.[0];

    screen.getByText('mark-talk').click();
    await waitFor(() => expect(fetchTalkAboutMarksResultFromDB).toHaveBeenCalledTimes(1));
    await act(async () => subscribeCallback?.('CHANNEL_ERROR'));
    expect(screen.getByTestId('syncStatus')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('');

    await act(async () => finishRefresh({
      ok: true,
      marks: [{
        id: 'mark-stale', recordId: 'record-talk', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T01:00:00.000Z', isCompleted: false,
      }],
    }));

    await waitFor(() => expect(lastTalkAboutResult).toEqual({ ok: true, syncPending: true }));
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('');
  });

  it('does not let an older talk-about refresh overwrite the newest response', async () => {
    const first = deferred<{ ok: true; marks: Array<{
      id: string; recordId: string; coupleId: string; actorUserId: string;
      createdAt: string; isCompleted: boolean;
    }> }>();
    const second = deferred<{ ok: true; marks: Array<{
      id: string; recordId: string; coupleId: string; actorUserId: string;
      createdAt: string; isCompleted: boolean;
    }> }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchTalkAboutMarksResultFromDB
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-1'));

    screen.getByText('mark-talk').click();
    screen.getByText('mark-talk').click();
    await waitFor(() => expect(fetchTalkAboutMarksResultFromDB).toHaveBeenCalledTimes(2));

    await act(async () => second.resolve({
      ok: true,
      marks: [{
        id: 'mark-newest', recordId: 'record-talk', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T02:00:00.000Z', isCompleted: false,
      }],
    }));
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-newest');

    await act(async () => first.resolve({
      ok: true,
      marks: [{
        id: 'mark-older', recordId: 'record-talk', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T01:00:00.000Z', isCompleted: false,
      }],
    }));
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-newest');
    expect(screen.getByTestId('talkAboutMarks')).not.toHaveTextContent('mark-older');
  });

  it('separates a talk-about slice outage from an authoritative empty list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      talkAboutMarks: [{
        id: 'mark-old', recordId: 'record-old', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T00:00:00.000Z', isCompleted: false,
      }],
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('couple-sync:couple-1'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );

    fetchTalkAboutMarksResultFromDB.mockResolvedValueOnce({
      ok: false,
      error: new Error('talk slice unavailable'),
    });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'talk_about' } });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId('syncStatus')).toHaveTextContent('live');
    expect(screen.getByTestId('talkSyncStatus')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-old');

    fetchTalkAboutMarksResultFromDB.mockResolvedValueOnce({ ok: true, marks: [] });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'talk_about' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId('talkSyncStatus')).toHaveTextContent('ready');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('');
  });

  it('fails closed when a profile refresh cannot load its talk-about slice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      talkAboutMarks: [{
        id: 'mark-old', recordId: 'record-old', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T00:00:00.000Z', isCompleted: false,
      }],
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-old'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );

    fetchFullStateResultFromDB.mockResolvedValueOnce({
      ok: false,
      reason: 'unknown',
      stage: 'talk-about',
    });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'profile' } });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId('syncStatus')).toHaveTextContent('live');
    expect(screen.getByTestId('talkSyncStatus')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-old');

    markTalkAboutInDB.mockClear();
    screen.getByText('mark-talk').click();
    await waitFor(() => expect(lastTalkAboutResult).toEqual(expect.objectContaining({ ok: false })));
    expect(markTalkAboutInDB).not.toHaveBeenCalled();
  });

  it('applies profile and talk-about data from the same successful profile refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      talkAboutMarks: [{
        id: 'mark-old', recordId: 'record-old', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T00:00:00.000Z', isCompleted: false,
      }],
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', partnerUserId: 'partner-1', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-old'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );

    fetchFullStateResultFromDB.mockResolvedValueOnce({
      ok: true,
      state: serverState({
        talkAboutMarks: [{
          id: 'mark-new', recordId: 'record-new', coupleId: 'couple-1',
          actorUserId: 'user-a', createdAt: '2026-09-03T01:00:00.000Z', isCompleted: false,
        }],
        profile: {
          myName: '새 이름', role: 'gomsin',
          couple: {
            coupleId: 'couple-1', partnerName: '몽룡', partnerUserId: 'partner-1', coupleCode: '',
            connected: true, status: 'active',
          },
          military: {} as never, contact: {} as never,
        } as never,
      }),
    });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'profile' } });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId('name')).toHaveTextContent('새 이름');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-new');
    expect(screen.getByTestId('talkAboutMarks')).not.toHaveTextContent('mark-old');
    expect(screen.getByTestId('talkSyncStatus')).toHaveTextContent('ready');
  });

  it.each([
    {
      label: 'pending',
      nextCouple: {
        coupleId: 'couple-1', partnerName: '', coupleCode: '',
        connected: false, status: 'pending' as const,
      },
      expectedLifecycle: 'pending',
    },
    {
      label: 'disconnected',
      nextCouple: {
        partnerName: '', coupleCode: '', connected: false, status: 'disconnected' as const,
      },
      expectedLifecycle: 'disconnected',
    },
  ])('publishes a successful $label profile refresh without any stale couple slice', async ({
    nextCouple,
    expectedLifecycle,
  }) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const committedFrames: Array<{
      partnerId?: string;
      recordIds: string[];
      eventIds: string[];
      tripIds: string[];
      highlightIds: string[];
      talkAboutIds: string[];
      highlightedRecordId?: string;
    }> = [];
    const captureFrame = (next: AppState) => {
      if (next.authenticatedUser?.id !== 'user-a') return;
      committedFrames.push({
        partnerId: next.profile.couple.partnerUserId,
        recordIds: next.records.map((record) => record.id),
        eventIds: next.events.map((event) => event.id),
        tripIds: next.trips.map((trip) => trip.id),
        highlightIds: (next.coupleHighlights ?? []).map((highlight) => highlight.id),
        talkAboutIds: next.talkAboutMarks.map((mark) => mark.id),
        highlightedRecordId: next.highlightedRecordId,
      });
    };
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{
        id: 'record-former-partner', userId: 'partner-b', date: '2026-09-03', time: '09:00',
        authorRole: 'soldier', log: 'stale', isPrivate: false, createdAt: '2026-09-03T00:00:00Z',
      }] as never,
      events: [{ id: 'event-former-partner', createdBy: 'partner-b', isPrivate: false }] as never,
      trips: [{ id: 'trip-former-partner' }] as never,
      coupleHighlights: [{ id: 'highlight-former-partner' }] as never,
      talkAboutMarks: [{
        id: 'mark-former-partner', recordId: 'record-former-partner', coupleId: 'couple-1',
        actorUserId: 'partner-b', createdAt: '2026-09-03T00:00:00Z', isCompleted: false,
      }],
      highlightedRecordId: 'record-former-partner',
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: 'Partner B', partnerUserId: 'partner-b',
          partnerMilitary: {
            branch: 'army', militaryStatus: 'serving', dischargeDateSource: 'manual',
          },
          coupleCode: '', connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe onCommit={captureFrame} /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('highlightedRecord')).toHaveTextContent('record-former-partner'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );
    committedFrames.length = 0;
    if (expectedLifecycle === 'pending') {
      fetchMyCoupleState.mockResolvedValueOnce({
        ok: true,
        state: {
          coupleId: 'couple-1',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: false,
          invitationActive: true,
          invitationExpiresAt: '2026-09-04T00:00:00Z',
        },
      });
    }

    fetchFullStateResultFromDB.mockResolvedValueOnce({
      ok: true,
      state: serverState({
        records: [],
        events: [],
        trips: [],
        coupleHighlights: [],
        talkAboutMarks: [],
        profile: {
          myName: '춘향', role: 'gomsin', couple: nextCouple,
          military: {} as never, contact: {} as never,
        } as never,
      }),
    });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'profile' } });
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => expect(screen.getByTestId('partnerId')).toHaveTextContent('none'));
    expect(screen.getByTestId('records')).toBeEmptyDOMElement();
    expect(screen.getByTestId('events')).toBeEmptyDOMElement();
    expect(screen.getByTestId('trips')).toBeEmptyDOMElement();
    expect(screen.getByTestId('highlights')).toBeEmptyDOMElement();
    expect(screen.getByTestId('talkAboutMarks')).toBeEmptyDOMElement();
    expect(screen.getByTestId('highlightedRecord')).toHaveTextContent('none');
    expect(screen.getByTestId('partner')).toHaveTextContent('none');
    expect(screen.getByTestId('partnerMilitary')).toHaveTextContent('none');
    expect(screen.getByTestId('coupleLifecycle')).toHaveTextContent(expectedLifecycle);
    expect(committedFrames.every((frame) => frame.partnerId !== undefined || (
      !frame.recordIds.includes('record-former-partner')
      && !frame.eventIds.includes('event-former-partner')
      && !frame.tripIds.includes('trip-former-partner')
      && !frame.highlightIds.includes('highlight-former-partner')
      && !frame.talkAboutIds.includes('mark-former-partner')
      && frame.highlightedRecordId !== 'record-former-partner'
    ))).toBe(true);
  });

  it('preserves the last-known-good workspace when partner membership refresh is unavailable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-known-good' }] as never,
      events: [{ id: 'event-known-good' }] as never,
      trips: [{ id: 'trip-known-good' }] as never,
      coupleHighlights: [{ id: 'highlight-known-good' }] as never,
      talkAboutMarks: [{
        id: 'mark-known-good', recordId: 'record-known-good', coupleId: 'couple-1',
        actorUserId: 'partner-b', createdAt: '2026-09-03T00:00:00Z', isCompleted: false,
      }],
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: 'Partner B', partnerUserId: 'partner-b',
          coupleCode: '', connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-b'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );

    fetchFullStateResultFromDB.mockResolvedValueOnce({
      ok: false,
      reason: 'offline',
      stage: 'partner-membership',
    });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'profile' } });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-b');
    expect(screen.getByTestId('records')).toHaveTextContent('record-known-good');
    expect(screen.getByTestId('events')).toHaveTextContent('event-known-good');
    expect(screen.getByTestId('trips')).toHaveTextContent('trip-known-good');
    expect(screen.getByTestId('highlights')).toHaveTextContent('highlight-known-good');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-known-good');
  });

  it('keeps the last verified profile until an identity-bearing profile refresh completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const refresh = deferred<{ ok: true; state: Partial<AppState> }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      talkAboutMarks: [{
        id: 'mark-old', recordId: 'record-old', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T00:00:00.000Z', isCompleted: false,
      }],
      profile: {
        myName: '현재 이름', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '현재 상대', partnerUserId: 'partner-1',
          coupleCode: '', connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-1'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );

    fetchFullStateResultFromDB.mockImplementationOnce(() => refresh.promise);
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'profile' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchFullStateResultFromDB).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId('name')).toHaveTextContent('현재 이름');
    expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-1');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-old');

    await act(async () => refresh.resolve({
      ok: true,
      state: serverState({
        talkAboutMarks: [{
          id: 'mark-unverified', recordId: 'record-unverified', coupleId: 'couple-1',
          actorUserId: 'user-a', createdAt: '2026-09-03T01:00:00.000Z', isCompleted: false,
        }],
        profile: {
          myName: '불완전한 새 이름', role: 'gomsin',
          couple: {
            coupleId: 'couple-1', partnerName: '신원 없는 상대', coupleCode: '',
            connected: true, status: 'active',
          },
          military: {} as never, contact: {} as never,
        } as never,
      }),
    }));

    expect(screen.getByTestId('name')).toHaveTextContent('현재 이름');
    expect(screen.getByTestId('partner')).toHaveTextContent('현재 상대');
    expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-1');
    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-old');
    expect(screen.getByTestId('talkSyncStatus')).toHaveTextContent('unavailable');
  });

  it('drops a delayed account A profile refresh after account B becomes active', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const delayedAccountA = deferred<{ ok: true; state: Partial<AppState> }>();
    let accountAReads = 0;
    fetchFullStateResultFromDB.mockImplementation((requestedUserId: string) => {
      if (requestedUserId === 'user-a') {
        accountAReads += 1;
        if (accountAReads > 1) return delayedAccountA.promise;
        return Promise.resolve({
          ok: true as const,
          state: serverState({
            talkAboutMarks: [],
            profile: {
              myName: 'Account A', role: 'gomsin',
              couple: {
                coupleId: 'couple-a', partnerName: 'A partner', partnerUserId: 'partner-a',
                coupleCode: '', connected: true, status: 'active',
              },
              military: {} as never, contact: {} as never,
            } as never,
          }),
        });
      }
      return Promise.resolve({
        ok: true as const,
        state: serverState({
          talkAboutMarks: [],
          profile: {
            myName: 'Account B', role: 'gomsin',
            couple: {
              coupleId: 'couple-b', partnerName: 'B partner', partnerUserId: 'partner-b',
              coupleCode: '', connected: true, status: 'active',
            },
            military: {} as never, contact: {} as never,
          } as never,
        }),
      });
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-a'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-a')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'profile' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(accountAReads).toBe(2));

    await act(async () => emitAuth('SIGNED_IN', 'user-b'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    await waitFor(() => expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-b'));

    await act(async () => delayedAccountA.resolve({
      ok: true,
      state: serverState({
        talkAboutMarks: [],
        profile: {
          myName: 'Stale Account A', role: 'gomsin',
          couple: {
            coupleId: 'couple-a', partnerName: 'Stale A partner', partnerUserId: 'partner-a',
            coupleCode: '', connected: true, status: 'active',
          },
          military: {} as never, contact: {} as never,
        } as never,
      }),
    }));

    expect(screen.getByTestId('user')).toHaveTextContent('user-b');
    expect(screen.getByTestId('name')).toHaveTextContent('Account B');
    expect(screen.getByTestId('couple')).toHaveTextContent('couple-b');
    expect(screen.getByTestId('partnerId')).toHaveTextContent('partner-b');
  });

  it('does not let an older profile full-read overwrite a newer talk-only response', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const oldProfileRead = deferred<{
      ok: true;
      state: Partial<AppState>;
    }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      talkAboutMarks: [{
        id: 'mark-initial', recordId: 'record-initial', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T00:00:00.000Z', isCompleted: false,
      }],
      profile: {
        myName: '현재 이름', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-initial'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );

    fetchFullStateResultFromDB.mockImplementationOnce(() => oldProfileRead.promise);
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'profile' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchFullStateResultFromDB).toHaveBeenCalledTimes(2));

    fetchTalkAboutMarksResultFromDB.mockResolvedValueOnce({
      ok: true,
      marks: [{
        id: 'mark-newest', recordId: 'record-newest', coupleId: 'couple-1',
        actorUserId: 'user-a', createdAt: '2026-09-03T02:00:00.000Z', isCompleted: false,
      }],
    });
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'talk_about' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-newest'));

    await act(async () => oldProfileRead.resolve({
      ok: true,
      state: serverState({
        talkAboutMarks: [{
          id: 'mark-stale', recordId: 'record-stale', coupleId: 'couple-1',
          actorUserId: 'user-a', createdAt: '2026-09-03T01:00:00.000Z', isCompleted: false,
        }],
        profile: {
          myName: '뒤늦은 이름', role: 'gomsin',
          couple: {
            coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
            connected: true, status: 'active',
          },
          military: {} as never, contact: {} as never,
        } as never,
      }),
    }));

    expect(screen.getByTestId('talkAboutMarks')).toHaveTextContent('mark-newest');
    expect(screen.getByTestId('talkAboutMarks')).not.toHaveTextContent('mark-stale');
    expect(screen.getByTestId('name')).toHaveTextContent('현재 이름');
  });

  it.each([
    { label: 'mark', button: 'mark-talk', write: markTalkAboutInDB },
    { label: 'unmark', button: 'unmark-talk', write: unmarkTalkAboutInDB },
    { label: 'resolve', button: 'resolve-talk', write: resolveTalkAboutInDB },
  ])('drops all post-write side effects when the account changes before $label resolves', async ({ button, write }) => {
    const pendingWrite = deferred<{ ok: true }>();
    fetchFullStateFromDB.mockImplementation(async (userId: string) => serverState({
      profile: {
        myName: userId === 'user-a' ? 'A' : 'B', role: 'gomsin',
        couple: userId === 'user-a'
          ? {
              coupleId: 'couple-a', partnerName: 'A partner', coupleCode: '',
              connected: true, status: 'active',
            }
          : {
              partnerName: '', coupleCode: '', connected: false, status: 'pending',
            },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    write.mockImplementationOnce(() => pendingWrite.promise);

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-a'));
    recordProductEvent.mockClear();

    screen.getByText(button).click();
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    await act(async () => emitAuth('SIGNED_IN', 'user-b'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    await act(async () => pendingWrite.resolve({ ok: true }));

    await waitFor(() => expect(lastTalkAboutResult).toEqual(expect.objectContaining({ ok: false })));
    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(fetchTalkAboutMarksResultFromDB).not.toHaveBeenCalled();
  });

  it('drops post-write side effects when the same account disconnects before a mark resolves', async () => {
    const pendingWrite = deferred<{ ok: true }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: {
          coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '',
          connected: true, status: 'active',
        },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    markTalkAboutInDB.mockImplementationOnce(() => pendingWrite.promise);

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-1'));
    recordProductEvent.mockClear();

    screen.getByText('mark-talk').click();
    await waitFor(() => expect(markTalkAboutInDB).toHaveBeenCalledOnce());
    screen.getByText('disconnect').click();
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    await act(async () => pendingWrite.resolve({ ok: true }));

    await waitFor(() => expect(lastTalkAboutResult).toEqual(expect.objectContaining({ ok: false })));
    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(fetchTalkAboutMarksResultFromDB).not.toHaveBeenCalled();
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

  it('purges local data immediately and finishes sign-out when push revocation never settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { authRepository } = await import('@/lib/supabase');
    vi.mocked(authRepository.signOut).mockClear();
    mockSupabase.rpc.mockImplementation((name: string) => (
      name === 'revoke_my_push_tokens'
        ? new Promise(() => {})
        : Promise.resolve({ data: null, error: null })
    ));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));

    await act(async () => {
      screen.getByText('signout').click();
      await Promise.resolve();
    });

    // Local records and identity do not wait on a network hygiene call.
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(authRepository.signOut).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(authRepository.signOut).toHaveBeenCalledOnce();
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

  it('uses insert/update invalidations for records while retaining the direct-read compatibility channel', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-before', userId: 'user-a', isPrivate: false, log: 'before' }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-before'));

    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCalls = channel.on.mock.calls.filter(
      (call) => call[1]?.table === 'collaboration_invalidations',
    );
    expect(invalidationCalls.map((call) => call[1]?.event)).toEqual(['INSERT', 'UPDATE']);
    expect(channel.on.mock.calls.some((call) => call[1]?.table === 'daily_records')).toBe(false);
    const compatibilityChannel = createdChannels.find(
      (entry) => entry.name === 'couple-records-compat:couple-1',
    )!;
    expect(compatibilityChannel.on.mock.calls.some(
      (call) => call[1]?.table === 'daily_records' && call[1]?.event === '*',
    )).toBe(true);
    expect(compatibilityChannel.subscribe).toHaveBeenCalledWith();

    fetchRecordsResultFromDB.mockResolvedValueOnce({
      ok: true,
      records: [{ id: 'record-after', userId: 'user-a', isPrivate: false, log: 'authoritative' }],
    });
    await act(async () => {
      invalidationCalls[0]?.[2]?.({
        new: { slice: 'records', log_text: 'payload must not become state' },
      });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId('records')).toHaveTextContent('record-after');
    expect(screen.getByTestId('logs')).toHaveTextContent('authoritative');
    expect(screen.getByTestId('logs')).not.toHaveTextContent('payload must not become state');
  });

  it('reconciles every shared slice after SUBSCRIBED before considering the channel live', async () => {
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-before', userId: 'user-a', isPrivate: false }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    mockSupabase.rpc.mockResolvedValue({ data: 'couple-1', error: null });
    fetchRecordsResultFromDB.mockResolvedValueOnce({
      ok: true,
      records: [{ id: 'record-after', userId: 'user-a', isPrivate: false }],
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-before'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const subscribeCallback = channel.subscribe.mock.calls[0]?.[0];

    await act(async () => subscribeCallback?.('SUBSCRIBED'));

    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-after'));
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_my_active_couple_id');
  });

  it('prevents an older records refresh from overwriting a newer same-access refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const older = deferred<{ ok: true; records: never[] }>();
    const newer = deferred<{ ok: true; records: never[] }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-before', userId: 'user-a', isPrivate: false }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchRecordsResultFromDB
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-before'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );

    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(1));

    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(2));

    await act(async () => newer.resolve({
      ok: true,
      records: [{ id: 'record-newest', userId: 'user-a', isPrivate: false }] as never,
    }));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-newest'));
    await act(async () => older.resolve({
      ok: true,
      records: [{ id: 'record-older', userId: 'user-a', isPrivate: false }] as never,
    }));
    expect(screen.getByTestId('records')).toHaveTextContent('record-newest');
    expect(screen.getByTestId('records')).not.toHaveTextContent('record-older');
  });

  it('ignores an older records rejection after a newer same-access refresh succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let rejectOlder!: (reason?: unknown) => void;
    const older = new Promise<{ ok: true; records: never[] }>((_resolve, reject) => {
      rejectOlder = reject;
    });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-before', userId: 'user-a', isPrivate: false }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchRecordsResultFromDB
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce({
        ok: true,
        records: [{ id: 'record-newest', userId: 'user-a', isPrivate: false }] as never,
      });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-before'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );

    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(1));
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-newest'));

    await act(async () => rejectOlder(new Error('stale request failed')));
    expect(screen.getByTestId('records')).toHaveTextContent('record-newest');
    expect(screen.getByTestId('syncStatus')).toHaveTextContent('live');
  });

  it('shares the records sequence between SUBSCRIBED reconciliation and a dedicated refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const olderReconciliation = deferred<{ ok: true; records: never[] }>();
    const newerDedicated = deferred<{ ok: true; records: never[] }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-before', userId: 'user-a', isPrivate: false }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    mockSupabase.rpc.mockResolvedValue({ data: 'couple-1', error: null });
    fetchRecordsResultFromDB
      .mockReturnValueOnce(olderReconciliation.promise)
      .mockReturnValueOnce(newerDedicated.promise);

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-before'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const subscribeCallback = channel.subscribe.mock.calls[0]?.[0];
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );

    await act(async () => subscribeCallback?.('SUBSCRIBED'));
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(1));
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(2));

    await act(async () => newerDedicated.resolve({
      ok: true,
      records: [{ id: 'record-dedicated-newest', userId: 'user-a', isPrivate: false }] as never,
    }));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-dedicated-newest'));
    await act(async () => olderReconciliation.resolve({
      ok: true,
      records: [{ id: 'record-reconciliation-older', userId: 'user-a', isPrivate: false }] as never,
    }));
    expect(screen.getByTestId('records')).toHaveTextContent('record-dedicated-newest');
    expect(screen.getByTestId('records')).not.toHaveTextContent('record-reconciliation-older');
  });

  it('ignores an older reconciliation records rejection after a dedicated refresh succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let rejectReconciliation!: (reason?: unknown) => void;
    const olderReconciliation = new Promise<{ ok: true; records: never[] }>((_resolve, reject) => {
      rejectReconciliation = reject;
    });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-before', userId: 'user-a', isPrivate: false }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    mockSupabase.rpc.mockResolvedValue({ data: 'couple-1', error: null });
    fetchRecordsResultFromDB
      .mockReturnValueOnce(olderReconciliation)
      .mockResolvedValueOnce({
        ok: true,
        records: [{ id: 'record-dedicated-newest', userId: 'user-a', isPrivate: false }] as never,
      });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-before'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const subscribeCallback = channel.subscribe.mock.calls[0]?.[0];
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );

    await act(async () => subscribeCallback?.('SUBSCRIBED'));
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(1));
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-dedicated-newest'));

    await act(async () => rejectReconciliation(new Error('stale reconciliation records failed')));
    expect(screen.getByTestId('records')).toHaveTextContent('record-dedicated-newest');
    expect(screen.getByTestId('syncStatus')).toHaveTextContent('live');
  });

  it('does not let an in-flight records read erase a newly created record', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const staleRead = deferred<{ ok: true; records: never[] }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [],
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchRecordsResultFromDB.mockReturnValueOnce(staleRead.promise);
    saveRecordToDB.mockResolvedValueOnce({ ok: true, contentRevision: 1 });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    const channel = await waitFor(() => {
      const found = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1');
      expect(found).toBeTruthy();
      return found!;
    });
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(1));

    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록'));
    await act(async () => staleRead.resolve({ ok: true, records: [] }));
    expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록');
  });

  it('does not append a record twice when its invalidation refetch wins the create-response race', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const createResponse = deferred<{ ok: true; contentRevision: number }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [],
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    saveRecordToDB.mockReturnValueOnce(createResponse.promise);

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    const channel = await waitFor(() => {
      const found = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1');
      expect(found).toBeTruthy();
      return found!;
    });

    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalledTimes(1));
    const inserted = saveRecordToDB.mock.calls[0]?.[0] as {
      id: string; userId: string; isPrivate: boolean; log: string;
    };
    fetchRecordsResultFromDB.mockResolvedValueOnce({
      ok: true,
      records: [{ ...inserted, contentRevision: 1 }] as never,
    });
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent(inserted.id));

    await act(async () => createResponse.resolve({ ok: true, contentRevision: 1 }));
    await waitFor(() => expect(lastMediaResult?.ok).toBe(true));
    expect(screen.getByTestId('records').textContent?.split(',')).toEqual([inserted.id]);
    expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록');
  });

  it('does not let an in-flight records read undo a successful record update', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const original = {
      id: 'record-1', userId: 'user-a', date: '2026-08-01', time: '12:00',
      authorRole: 'gomsin', log: '수정 전 기록', isPrivate: false, createdAt: '2026-08-01T03:00:00Z',
      contentRevision: 1,
    };
    const staleRead = deferred<{ ok: true; records: never[] }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [original] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchRecordsResultFromDB.mockReturnValueOnce(staleRead.promise);
    saveRecordToDB.mockResolvedValueOnce({ ok: true, contentRevision: 2 });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('logs')).toHaveTextContent('수정 전 기록'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(1));

    await act(async () => screen.getByText('update-first-record').click());
    await waitFor(() => expect(screen.getByTestId('logs')).toHaveTextContent('수정된 최신 기록'));
    await act(async () => staleRead.resolve({ ok: true, records: [original] as never }));
    expect(screen.getByTestId('logs')).toHaveTextContent('수정된 최신 기록');
    expect(screen.getByTestId('logs')).not.toHaveTextContent('수정 전 기록');
  });

  it('does not let an in-flight records read resurrect a successfully deleted record', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const original = {
      id: 'record-1', userId: 'user-a', date: '2026-08-01', time: '12:00',
      authorRole: 'gomsin', log: '삭제할 기록', isPrivate: false, createdAt: '2026-08-01T03:00:00Z',
      contentRevision: 1,
    };
    const staleRead = deferred<{ ok: true; records: never[] }>();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [original] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    fetchRecordsResultFromDB.mockReturnValueOnce(staleRead.promise);

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-1'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'INSERT',
    );
    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledTimes(1));

    await act(async () => screen.getByText('delete-first-record').click());
    await waitFor(() => expect(screen.getByTestId('records')).not.toHaveTextContent('record-1'));
    await act(async () => staleRead.resolve({ ok: true, records: [original] as never }));
    expect(screen.getByTestId('records')).not.toHaveTextContent('record-1');
  });

  it('removes a shared record only after the RLS-visible authoritative refresh returns no row', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      records: [{ id: 'record-shared', userId: 'partner-a', isPrivate: false }] as never,
      profile: {
        myName: '춘향', role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never, contact: {} as never,
      } as never,
    }));
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('record-shared'));
    const channel = createdChannels.find((entry) => entry.name === 'couple-sync:couple-1')!;
    const invalidationCall = channel.on.mock.calls.find(
      (call) => call[1]?.table === 'collaboration_invalidations' && call[1]?.event === 'UPDATE',
    );
    fetchRecordsResultFromDB.mockResolvedValueOnce({ ok: true, records: [] });

    await act(async () => {
      invalidationCall?.[2]?.({ new: { slice: 'records' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent(''));
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
    const partnerPollCount = () => mockSupabase.rpc.mock.calls.filter(
      ([name]) => name === 'get_partner_profile',
    ).length;
    await waitFor(() => expect(partnerPollCount()).toBe(1));
    expect(mockSupabase.channel).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByText('disconnect').click();
    });
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    const callsAfterDisconnect = partnerPollCount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(partnerPollCount()).toBe(callsAfterDisconnect);
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
    // Normal partial-success mode commits one bounded media revision per file.
    expect(callOrder.filter((c) => c === 'saveRecord')).toHaveLength(3);
    expect(beginRecordMediaMutation.mock.calls.slice(-2).map(([request]) => ({
      base: (request as { baseContentRevision: number }).baseContentRevision,
      uploads: (request as { newMediaIds: string[] }).newMediaIds.length,
    }))).toEqual([
      { base: 1, uploads: 1 },
      { base: 2, uploads: 1 },
    ]);
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

  it('returns truthful partial success when media begin fails after the staged profile row exists', async () => {
    lastMediaResult = null;
    saveRecordToDB.mockReset().mockResolvedValue({ ok: true, contentRevision: 1 });
    beginRecordMediaMutation.mockResolvedValueOnce({ ok: false, reason: 'server' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({ ok: true, state: 'unavailable' });
    uploadRecordMedia.mockClear();
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));

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

    expect(lastMediaResult).toMatchObject({
      ok: true,
      failedFiles: ['post.png'],
      reason: 'server',
      recordId: expect.any(String),
    });
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
    expect(uploadRecordMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId('logs')).toHaveTextContent('오늘의 기록');
    expect(screen.getByTestId('privacy')).toHaveTextContent('private');
  });

  it('keeps uploaded media when the attachment patch response is lost and operation status confirms commit', async () => {
    callOrder.length = 0;
    saveRecordToDB.mockReset()
      .mockResolvedValueOnce({ ok: true, contentRevision: 1 })
      .mockResolvedValueOnce({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 2,
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
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
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
    expect(lastMediaResult?.retryableFailedFileIndexes).toEqual([0]);
    expect(screen.getByTestId('attachments')).toHaveTextContent('');
  });

  it('preserves successful normal-composer files without reviving an abandoned failed id', async () => {
    callOrder.length = 0;
    lastMediaResult = null;
    saveRecordToDB.mockReset().mockImplementation(async (...args: unknown[]) => {
      callOrder.push('saveRecord');
      const intent = args[3] as { kind: 'create' | 'update'; expectedRevision?: number };
      return {
        ok: true as const,
        contentRevision: intent.kind === 'create' ? 1 : (intent.expectedRevision ?? 1) + 1,
      };
    });
    uploadRecordMedia.mockReset().mockImplementation(async (
      file: File,
      coupleId?: string,
      recordId?: string,
      _displayName?: string,
      objectId?: string,
    ) => {
      callOrder.push(`upload:${file.name}`);
      return file.name === 'broken.png'
        ? { error: '파일을 올리지 못했어요.', reason: 'server' as const }
        : {
            attachment: {
              type: 'photo' as const,
              name: file.name,
              path: `${coupleId}/${recordId}/${objectId}.png`,
            },
          };
    });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));

    render(
      <StoreProvider>
        <Probe files={[
          new File(['a'], 'good.png', { type: 'image/png' }),
          new File(['b'], 'broken.png', { type: 'image/png' }),
        ]} />
      </StoreProvider>,
    );
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());

    expect(lastMediaResult).toMatchObject({ ok: true, failedFiles: ['broken.png'] });
    expect(lastMediaResult?.retryableFailedFileIndexes).toEqual([1]);
    expect(screen.getByTestId('attachments')).toHaveTextContent('good.png');
    expect(beginRecordMediaMutation.mock.calls.map(([request]) => (
      (request as { baseContentRevision: number }).baseContentRevision
    ))).toEqual([1, 2]);
    expect(beginRecordMediaMutation.mock.calls.map(([request]) => (
      (request as { newMediaIds: string[] }).newMediaIds.length
    ))).toEqual([1, 1]);
    expect(saveRecordToDB).toHaveBeenCalledTimes(2);
    expect(abandonRecordMediaMutation).toHaveBeenCalledTimes(1);
  });

  it('reports only the unfinished normal-composer files after a later begin is refused', async () => {
    lastMediaResult = null;
    saveRecordToDB.mockReset().mockImplementation(async (...args: unknown[]) => {
      const intent = args[3] as { kind: 'create' | 'update'; expectedRevision?: number };
      return {
        ok: true as const,
        contentRevision: intent.kind === 'create' ? 1 : (intent.expectedRevision ?? 1) + 1,
      };
    });
    beginRecordMediaMutation
      .mockImplementationOnce(async (request: { baseContentRevision: number }) => ({
        ok: true as const,
        state: 'pending' as const,
        targetContentRevision: request.baseContentRevision + 1,
      }))
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' });
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));

    render(
      <StoreProvider>
        <Probe files={[
          new File(['a'], 'committed.png', { type: 'image/png' }),
          new File(['b'], 'unfinished.png', { type: 'image/png' }),
        ]} />
      </StoreProvider>,
    );
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());

    expect(lastMediaResult).toMatchObject({
      ok: true,
      failedFiles: ['unfinished.png'],
      reason: 'forbidden',
    });
    expect(lastMediaResult).not.toHaveProperty('retryableFailedFileIndexes');
    expect(uploadRecordMedia.mock.calls.map(([file]) => (file as File).name))
      .toEqual(['committed.png']);
    expect(saveRecordToDB).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('attachments')).toHaveTextContent('committed.png');
    expect(screen.getByTestId('attachments')).not.toHaveTextContent('unfinished.png');
  });

  it('continues normal-composer sequencing after response-loss status confirms a file commit', async () => {
    callOrder.length = 0;
    lastMediaResult = null;
    saveRecordToDB.mockReset()
      .mockResolvedValueOnce({ ok: true, contentRevision: 1 })
      .mockResolvedValueOnce({ ok: false, reason: 'offline' })
      .mockResolvedValueOnce({ ok: true, contentRevision: 3 });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 2,
    });
    uploadRecordMedia.mockReset().mockImplementation(async (
      file: File,
      coupleId?: string,
      recordId?: string,
      _displayName?: string,
      objectId?: string,
    ) => ({
      attachment: {
        type: 'photo' as const,
        name: file.name,
        path: `${coupleId}/${recordId}/${objectId}.png`,
      },
    }));
    fetchFullStateFromDB.mockResolvedValue(serverState({
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));

    render(
      <StoreProvider>
        <Probe files={[
          new File(['a'], 'first.png', { type: 'image/png' }),
          new File(['b'], 'second.png', { type: 'image/png' }),
        ]} />
      </StoreProvider>,
    );
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await act(async () => screen.getByText('post').click());
    await waitFor(() => expect(lastMediaResult).not.toBeNull());

    expect(lastMediaResult).toMatchObject({ ok: true, failedFiles: [] });
    expect(screen.getByTestId('attachments')).toHaveTextContent('first.png');
    expect(screen.getByTestId('attachments')).toHaveTextContent('second.png');
    expect(beginRecordMediaMutation.mock.calls.map(([request]) => (
      (request as { baseContentRevision: number }).baseContentRevision
    ))).toEqual([1, 2]);
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
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
    expect(lastMediaResult?.retryableFailedFileIndexes).toEqual([0, 1]);
    expect(lastMediaResult?.recordId).toBeTruthy();
    expect(beginRecordMediaMutation).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).toHaveBeenCalledTimes(1);
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
    mockSupabase.rpc.mockReset().mockImplementation(async (name: string) => (
      name === 'is_my_account_deletion_pending'
        ? { data: false, error: null }
        : { data: 'couple-1', error: null }
    ));
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

    const recoveryReadCount = () => mockSupabase.rpc.mock.calls.filter(
      ([name]) => name === 'get_my_active_couple_id',
    ).length;
    const callsAfterFirstRecovery = recoveryReadCount();
    await act(async () => {
      // The next poll must back off to 4 seconds. The old implementation reset
      // after every successful HTTP read and hit all shared endpoints every 2s.
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 4);

    // The cap remains 30 seconds for subsequent recovery polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(recoveryReadCount()).toBe(callsAfterFirstRecovery + 5);
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
    installTestWebLocks();
    authCallbacks.length = 0;
    createdChannels.length = 0;
    localStorage.clear();
    fetchFullStateFromDB.mockReset().mockResolvedValue(profileState());
    fetchFullStateResultFromDB.mockReset().mockImplementation(defaultFetchFullStateResult);
    fetchRecordsResultFromDB.mockReset().mockResolvedValue({ ok: true, records: [] });
    mockSupabase.profileUpdateError = null;
    mockSupabase.profileUpdateMatched = true;
    saveCoupleAnniversary.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
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

    await waitFor(() => expect(saveCoupleAnniversary).toHaveBeenCalledWith(
      'couple-1',
      null,
      expect.objectContaining({ userId: 'user-a', mode: 'shared' }),
    ));
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

  it('persists an optional gender and erases it with SQL NULL before updating local state', async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('gender')).toHaveTextContent('none'));

    await act(async () => {
      screen.getByText('set-gender').click();
    });
    await waitFor(() => expect(screen.getByTestId('gender')).toHaveTextContent('woman'));
    expect(mockSupabase.lastProfileUpdatePayload).toMatchObject({ gender_identity: 'woman' });

    await act(async () => {
      screen.getByText('clear-gender').click();
    });
    await waitFor(() => expect(screen.getByTestId('gender')).toHaveTextContent('none'));
    expect(mockSupabase.lastProfileUpdatePayload).toMatchObject({ gender_identity: null });
  });

  it('hydrates with stored valid locale and sets html lang', async () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ locale: 'en' }));
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('INITIAL_SESSION', null));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('uses browser English preference on first run when no stored locale exists', async () => {
    const origLanguages = navigator.languages;
    Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'], configurable: true });
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('INITIAL_SESSION', null));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(document.documentElement.lang).toBe('en');
    Object.defineProperty(navigator, 'languages', { value: origLanguages, configurable: true });
  });

  it('rejects invalid stored locale and falls back to default', async () => {
    const origLanguages = navigator.languages;
    Object.defineProperty(navigator, 'languages', { value: ['fr-FR'], configurable: true });
    localStorage.setItem(STORE_KEY, JSON.stringify({ locale: 'unsupported-xyz' }));
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('INITIAL_SESSION', null));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    expect(screen.getByTestId('locale')).toHaveTextContent('ko');
    expect(document.documentElement.lang).toBe('ko');
    Object.defineProperty(navigator, 'languages', { value: origLanguages, configurable: true });
  });

  it('setLocale updates state, html lang, and persists via device preferences save flow', async () => {
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
    await act(async () => {
      screen.getByText('set-locale-en').click();
    });
    await waitFor(() => expect(screen.getByTestId('locale')).toHaveTextContent('en'));
    expect(document.documentElement.lang).toBe('en');
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      expect(stored.locale).toBe('en');
    });
  });
});
