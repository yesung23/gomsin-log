import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import type { QueuedRecord } from '@/lib/outbox';
import { App } from '@/App';
import { DEVICE_PREF_CARRY_OVER_KEYS, StoreProvider } from '@/lib/store';
import { useStore } from '@/lib/useStore';
import {
  clearRecoveryMarkerForAttempt,
  markRecoveryPending,
  recoveryKeyFor,
  type AccountDeletionOutcome,
} from '@/lib/accountDeletion';
import { AUTH_SYNC_TIMEOUT_MS } from '@/lib/async';
import { readAvatar, writeAvatar } from '@/lib/avatarImage';
import { readComposerDraft, writeComposerDraft } from '@/lib/composerDraft';
import { grantCycleSensitiveConsent, hasCycleSensitiveConsent } from '@/lib/sensitiveConsent';
import { registerE2eeRuntimeTeardown } from '@/app/e2ee/runtimeLifecycle';

/**
 * Deletion-Recovery Suite (nine tests) and the store/route half of the
 * Tri-State Verification Suite (tests 3-5).
 *
 * These are ONE carried-forward flow rather than nine isolated snapshots,
 * because each closes a bypass the others leave open.
 */

type AuthCallback = (
  event: string,
  session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null,
) => void;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type TestLockCallback<T> = (lock: Lock | null) => PromiseLike<T> | T;

type TestLockRequest = <T>(
  name: string,
  optionsOrCallback: LockOptions | TestLockCallback<T>,
  callback?: TestLockCallback<T>,
) => Promise<T>;

/** Same-origin reader/writer scheduler shared by every rendered Provider. */
function createWebLocksHarness() {
  type PendingLock = {
    mode: LockMode;
    callback: TestLockCallback<unknown>;
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

  const request: TestLockRequest = async <T,>(
    name: string,
    optionsOrCallback: LockOptions | TestLockCallback<T>,
    optionalCallback?: TestLockCallback<T>,
  ): Promise<T> => {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function'
      ? optionsOrCallback
      : optionalCallback;
    if (!callback) throw new TypeError('A lock callback is required.');
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
    if (options.ifAvailable && !canGrantImmediately) {
      return callback(null);
    }
    return new Promise<T>((resolve, reject) => {
      state.queue.push({
        mode,
        callback: callback as TestLockCallback<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      pump(name, state);
    });
  };

  return { request: vi.fn(request) };
}

/** Holds the first winner before its callback so the loser observes no marker. */
function createDelayedFirstWebLocksHarness() {
  const allowWinner = deferred<void>();
  const loserTried = deferred<void>();
  const states = new Map<string, { held: boolean; waiters: Array<() => void> }>();
  let delayFirstWinner = true;
  const request: TestLockRequest = async <T,>(
    name: string,
    optionsOrCallback: LockOptions | TestLockCallback<T>,
    optionalCallback?: TestLockCallback<T>,
  ): Promise<T> => {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function'
      ? optionsOrCallback
      : optionalCallback;
    if (!callback) throw new TypeError('A lock callback is required.');
    const state = states.get(name) ?? { held: false, waiters: [] };
    states.set(name, state);
    if (options.ifAvailable && state.held) {
      loserTried.resolve(undefined);
      return callback(null);
    }
    if (state.held) await new Promise<void>((resolve) => { state.waiters.push(resolve); });
    state.held = true;
    if (delayFirstWinner) {
      delayFirstWinner = false;
      await allowWinner.promise;
    }
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      state.held = false;
      state.waiters.shift()?.();
      if (!state.held && state.waiters.length === 0) states.delete(name);
    }
  };
  return { request: vi.fn(request), allowWinner, loserTried };
}

/**
 * `vi.mock` factories are hoisted above module-scope consts, so everything the
 * factories touch is declared with `vi.hoisted`.
 */
const h = vi.hoisted(() => {
  const authCallbacks: Array<(event: string, session: unknown) => void> = [];
  /** Ordered log of every observable server interaction, for ordering assertions. */
  const callLog: string[] = [];
  const getUser = vi.fn();
  const getDeletionPending = vi.fn();
  const authRepositorySignOut = vi.fn(async () => { callLog.push('authRepository.signOut'); });
  const deleteAccountFromDB = vi.fn();
  const fetchFullStateFromDB = vi.fn();
  const saveRecordToDB = vi.fn(async () => {
    callLog.push('saveRecordToDB');
    return { ok: true as const, contentRevision: 1 };
  });
  const installE2eeRuntimeForAuthenticatedSession = vi.fn().mockResolvedValue({ status: 'guarded' });
  const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
  const outboxEntries = new Map<string, QueuedRecord>();
  const outboxAdapter = { available: true };
  const outboxPersistence = {
    all: vi.fn(async () => Array.from(outboxEntries.values())),
    add: vi.fn(async (entry: QueuedRecord) => {
      if (outboxEntries.has(entry.id)) throw new DOMException('duplicate', 'ConstraintError');
      outboxEntries.set(entry.id, entry);
    }),
    put: vi.fn(async (entry: QueuedRecord) => { outboxEntries.set(entry.id, entry); }),
    putMany: vi.fn(async (entries: QueuedRecord[]) => {
      for (const entry of entries) outboxEntries.set(entry.id, entry);
    }),
    remove: vi.fn(async (id: string) => { outboxEntries.delete(id); }),
    removeMany: vi.fn(async (ids: string[]) => { for (const id of ids) outboxEntries.delete(id); }),
  };
  const readQueuedRecord = vi.fn(async (entry: QueuedRecord) => {
    if (entry.record) return entry.record;
    throw new Error('Queued record carries no readable payload.');
  });

  const mockSupabase = {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCallbacks.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getUser: (...args: unknown[]) => {
        callLog.push('auth.getUser');
        return getUser(...args);
      },
    },
    channel: vi.fn(() => {
      const chainable: Record<string, unknown> = { on: vi.fn(), subscribe: vi.fn() };
      (chainable.on as ReturnType<typeof vi.fn>).mockReturnValue(chainable);
      (chainable.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(chainable);
      return chainable;
    }),
    removeChannel: vi.fn(),
    rpc: vi.fn((name: string) => {
      callLog.push(`rpc:${name}`);
      if (name === 'is_my_account_deletion_pending') {
        return getDeletionPending();
      }
      // Membership stays confirmed, so a reconciliation does not purge the
      // couple space out from under the mutation assertions below.
      return Promise.resolve({
        data: name === 'get_my_active_couple_id' ? 'couple-1' : null,
        error: null,
      });
    }),
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: () => {
              callLog.push('from:profiles.update');
              return Promise.resolve({ data: { id: 'user-a' }, error: null });
            },
          }),
        }),
      }),
      upsert: () => {
        callLog.push('from:contact_preferences.upsert');
        return Promise.resolve({ error: null });
      },
    }),
  };

  return {
    authCallbacks, callLog, getUser, getDeletionPending,
    authRepositorySignOut, deleteAccountFromDB,
    fetchFullStateFromDB, saveRecordToDB, installE2eeRuntimeForAuthenticatedSession,
    mockSupabase, FULL_STATE_UNAVAILABLE,
    outboxEntries, outboxPersistence, outboxAdapter, readQueuedRecord,
  };
});

const {
  authCallbacks,
  callLog,
  getUser,
  getDeletionPending,
  authRepositorySignOut,
  mockSupabase,
} = h;
const deleteAccountFromDB = h.deleteAccountFromDB as unknown as {
  mockReset: () => { mockResolvedValue: (v: AccountDeletionOutcome) => void };
  mockResolvedValue: (v: AccountDeletionOutcome) => void;
  mockImplementation: (fn: () => Promise<AccountDeletionOutcome>) => void;
};
const fetchFullStateFromDB = h.fetchFullStateFromDB;
const saveRecordToDB = h.saveRecordToDB;
const FULL_STATE_UNAVAILABLE = h.FULL_STATE_UNAVAILABLE;

vi.mock('@/lib/outboxStorage', () => ({
  createIndexedDbOutbox: () => h.outboxAdapter.available ? h.outboxPersistence : null,
}));

vi.mock('@/lib/outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/outbox')>();
  return {
    ...actual,
    readQueuedRecord: (entry: QueuedRecord) => h.readQueuedRecord(entry),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: h.mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: () => h.authRepositorySignOut() },
  disconnectCoupleFromDB: vi.fn(async () => { h.callLog.push('disconnectCoupleFromDB'); return true; }),
  deleteAccountFromDB: () => h.deleteAccountFromDB(),
  saveCoupleAnniversary: vi.fn(async () => { h.callLog.push('saveCoupleAnniversary'); return true; }),
  // Read-only lifecycle probe; logged so the gate-ordering assertions can prove
  // it never runs ahead of the deletion check for a MUTATION path.
  // Read-only lifecycle probe. Deliberately answers "unavailable" so it cannot
  // alter the couple state these deletion scenarios set up, and is NOT logged:
  // it is not a mutation and the call-order assertions are about mutations.
  fetchMyCoupleState: vi.fn(async () => ({ ok: false, reason: 'server' })),
  fetchAuthProviderAvailability: vi.fn(async () => ({ google: true, kakao: false })),
}));

vi.mock('@/lib/sync', () => ({
  fetchFullStateFromDB: (userId: string) => {
    h.callLog.push('fetchFullStateFromDB');
    return h.fetchFullStateFromDB(userId);
  },
  fetchFullStateResultFromDB: async (userId: string) => {
    h.callLog.push('fetchFullStateFromDB');
    const result = await h.fetchFullStateFromDB(userId);
    return result === h.FULL_STATE_UNAVAILABLE
      ? { ok: false, reason: 'unknown' }
      : { ok: true, state: result };
  },
  FULL_STATE_UNAVAILABLE: h.FULL_STATE_UNAVAILABLE,
}));

vi.mock('@/lib/records', () => ({
  saveRecordToDB: () => h.saveRecordToDB(),
  deleteRecordFromDB: vi.fn(async () => { h.callLog.push('deleteRecordFromDB'); return { ok: true }; }),
  fetchRecordsResultFromDB: vi.fn(async () => {
    h.callLog.push('fetchRecordsResultFromDB');
    return { ok: true, records: [] };
  }),
  uploadRecordMedia: vi.fn(),
  removeRecordMedia: vi.fn(),
  resolveAttachmentUrls: vi.fn(async (a: unknown) => a),
  classifyMediaFile: vi.fn(() => ({ type: 'photo' })),
  isCanonicalRecordMediaPath: (path: unknown, coupleId: string, recordId: string) => {
    if (typeof path !== 'string') return false;
    return path.startsWith(`${coupleId}/${recordId}/`);
  },
}));

vi.mock('@/app/e2ee/runtimeSession', () => ({
  installE2eeRuntimeForAuthenticatedSession: h.installE2eeRuntimeForAuthenticatedSession,
  activateCoupleProtectionForAuthenticatedSession: vi.fn().mockResolvedValue('not_paired'),
}));

vi.mock('@/lib/events', () => ({
  fetchEventsResultFromDB: vi.fn(async () => {
    h.callLog.push('fetchEventsResultFromDB');
    return { ok: true, events: [] };
  }),
  saveEventToDB: vi.fn(async () => { h.callLog.push('saveEventToDB'); return null; }),
  updateEventInDB: vi.fn(async () => { h.callLog.push('updateEventInDB'); return null; }),
  deleteEventFromDB: vi.fn(async () => { h.callLog.push('deleteEventFromDB'); return true; }),
}));

vi.mock('@/lib/trips', () => ({
  fetchTripsResultFromDB: vi.fn(async () => {
    h.callLog.push('fetchTripsResultFromDB');
    return { ok: true, trips: [] };
  }),
  reconcileParentTrips: (trips: unknown) => trips,
}));

// Kept light: App imports the home page eagerly, and asserting on this marker is
// how "a normal route rendered" is detected.
vi.mock('@/pages/HomePage', () => ({ HomePage: () => <div>HOME-PAGE-RENDERED</div> }));
vi.mock('@/pages/OnboardingPage', () => ({ OnboardingPage: () => <div>ONBOARDING-PAGE-RENDERED</div> }));
vi.mock('@/pages/AuthCallbackPage', () => ({
  AuthCallbackPage: () => <div>AUTH-CALLBACK-RENDERED</div>,
}));

let lastProbeFlush: Promise<unknown> | null = null;

/** Buttons live outside the routed tree so they stay reachable during recovery. */
function Probe() {
  const {
    deleteAccount, retryAccountDeletion, signOut, deletionStatus, accountDeletionRecovery,
    addRecord, deleteEvent, retrySharedAccess, queueRecordForLater, flushOutbox,
    retryBlockedRecords, discardQueuedRecords, state,
  } = useStore();
  const [deletionResult, setDeletionResult] = useState('none');
  const [queueResult, setQueueResult] = useState('none');
  const [addResult, setAddResult] = useState('none');
  const [flushResult, setFlushResult] = useState('none');
  const [retryResult, setRetryResult] = useState('none');
  const [discardResult, setDiscardResult] = useState('none');
  return (
    <div>
      <span data-testid="deletionStatus">{deletionStatus.kind}</span>
      <span data-testid="recovery">{accountDeletionRecovery ? 'active' : 'none'}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <span data-testid="record-count">{state.records.length}</span>
      <span data-testid="deletion-result">{deletionResult}</span>
      <span data-testid="queue-result">{queueResult}</span>
      <span data-testid="add-result">{addResult}</span>
      <span data-testid="flush-result">{flushResult}</span>
      <span data-testid="retry-result">{retryResult}</span>
      <span data-testid="discard-result">{discardResult}</span>
      <button onClick={() => void deleteAccount().then((outcome) => setDeletionResult(outcome.status))}>delete-account</button>
      <button onClick={() => void retryAccountDeletion().then((outcome) => setDeletionResult(outcome.status))}>retry-deletion</button>
      <button onClick={() => void signOut()}>sign-out</button>
      <button onClick={() => void retrySharedAccess()}>retry-shared</button>
      <button onClick={() => void addRecord({
        date: '2026-08-01', time: '10:00', authorRole: 'gomsin', log: 'x', isPrivate: false,
      } as never).then((result) => setAddResult(result.queued ? 'queued' : 'not-queued'))}>add-record</button>
      <button onClick={() => void deleteEvent('event-1')}>delete-event</button>
      <button onClick={() => void queueRecordForLater({
        date: '2026-08-01', time: '10:00', authorRole: 'gomsin', log: 'queued', isPrivate: false,
      } as never, []).then((result) => setQueueResult(result.queued ? 'queued' : 'not-queued'))}>queue-record</button>
      <button onClick={() => {
        const promise = flushOutbox();
        lastProbeFlush = promise;
        void promise.then(() => setFlushResult('done'));
      }}>flush-outbox</button>
      <button onClick={() => void retryBlockedRecords().then((count) => setRetryResult(String(count)))}>
        retry-blocked
      </button>
      <button onClick={() => void discardQueuedRecords().then((count) => setDiscardResult(String(count)))}>
        discard-queued
      </button>
    </div>
  );
}

const AUTHENTICATED_ROUTES = [
  '/', '/record', '/schedule', '/us', '/my', '/settings', '/trips', '/service',
];

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StoreProvider>
        <Probe />
        <App />
      </StoreProvider>
    </MemoryRouter>,
  );
}

function emitAuth(event: string, userId: string | null, appMetadata: Record<string, unknown> = { provider: 'google' }) {
  const session = userId
    ? { user: { id: userId, email: `${userId}@example.com`, app_metadata: appMetadata } }
    : null;
  authCallbacks.forEach((cb) => cb(event, session));
}

function serverState(overrides: Partial<AppState> = {}): Partial<AppState> {
  return {
    setupComplete: true,
    records: [],
    events: [],
    trips: [],
    profile: {
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    } as never,
    ...overrides,
  };
}

const NOT_PENDING = {
  data: { user: { id: 'user-a', app_metadata: { provider: 'google' } } },
  error: null,
};
const PENDING = {
  data: {
    user: {
      id: 'user-a',
      app_metadata: { provider: 'google', providers: ['google'], account_deletion_pending: true },
    },
  },
  error: null,
};
const DB_NOT_PENDING = { data: false, error: null };
const DB_PENDING = { data: true, error: null };

const PARTIAL: AccountDeletionOutcome = {
  status: 'partially_deleted',
  dataRemoved: true,
  warnings: ['media_not_fully_removed:couple-1/rec-1/a.jpg'],
};
const RECOVERY_REQUIRED: AccountDeletionOutcome = {
  status: 'recovery_required',
  dataRemoved: false,
  warnings: [],
};
const CANCELLED: AccountDeletionOutcome = {
  status: 'cancelled',
  dataRemoved: false,
  warnings: [],
};
const DELETED: AccountDeletionOutcome = { status: 'deleted', dataRemoved: true, warnings: [] };
const FAILED: AccountDeletionOutcome = { status: 'failed', dataRemoved: false, warnings: [] };
const ATTEMPT_A = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_A_NEWER = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_B = '33333333-3333-4333-8333-333333333333';
const DELETION_LOCK_PREFIX = 'gomsinlog.accountDeletion.lock.v1.';

function markerPayload(userId: string, attemptId: string, phase: 'pending' | 'local_cleanup') {
  return JSON.stringify({ version: 2, userId, attemptId, phase });
}

function queuedEntry(id: string, userId: string, coupleId: string): QueuedRecord {
  return {
    id,
    userId,
    coupleId,
    queuedAt: '2026-08-01T00:00:00Z',
    attempts: 0,
    record: { log: `${userId}-private` } as never,
    files: [new File([`${userId}-file`], `${userId}.jpg`, { type: 'image/jpeg' })],
  };
}

function seedLocalArtifacts(userId: string) {
  writeAvatar(userId, 'me', `data:image/jpeg;base64,${userId}-me`);
  writeAvatar(userId, 'couple', `data:image/jpeg;base64,${userId}-couple`);
  writeComposerDraft(userId, { log: `${userId}-draft`, isPrivate: true });
  grantCycleSensitiveConsent(userId);
  localStorage.setItem(`gomsin.diary.page.${userId}.2026-09-04`, '{}');
}

function expectLocalArtifactsPresent(userId: string) {
  expect(readAvatar(userId, 'me')).toContain(userId);
  expect(readAvatar(userId, 'couple')).toContain(userId);
  expect(readComposerDraft(userId)?.log).toBe(`${userId}-draft`);
  expect(hasCycleSensitiveConsent(userId)).toBe(true);
  expect(localStorage.getItem(`gomsin.diary.page.${userId}.2026-09-04`)).toBe('{}');
}

function expectLocalArtifactsPurged(userId: string) {
  expect(readAvatar(userId, 'me')).toBeNull();
  expect(readAvatar(userId, 'couple')).toBeNull();
  expect(readComposerDraft(userId)).toBeNull();
  expect(hasCycleSensitiveConsent(userId)).toBe(false);
  expect(localStorage.getItem(`gomsin.diary.page.${userId}.2026-09-04`)).toBeNull();
}

async function signIn(userId = 'user-a') {
  await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
  await act(async () => { emitAuth('SIGNED_IN', userId); });
}

async function settleStartupFlush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await Promise.resolve();
  });
}

describe('Deletion-Recovery Suite', () => {
  let webLocks: ReturnType<typeof createWebLocksHarness>;

  beforeEach(() => {
    lastProbeFlush = null;
    authCallbacks.length = 0;
    callLog.length = 0;
    localStorage.clear();
    h.outboxEntries.clear();
    h.outboxAdapter.available = true;
    h.outboxPersistence.all.mockReset().mockImplementation(
      async () => Array.from(h.outboxEntries.values()),
    );
    h.outboxPersistence.add.mockReset().mockImplementation(async (entry: QueuedRecord) => {
      if (h.outboxEntries.has(entry.id)) throw new DOMException('duplicate', 'ConstraintError');
      h.outboxEntries.set(entry.id, entry);
    });
    h.outboxPersistence.put.mockReset().mockImplementation(async (entry: QueuedRecord) => {
      h.outboxEntries.set(entry.id, entry);
    });
    h.outboxPersistence.putMany.mockReset().mockImplementation(async (entries: QueuedRecord[]) => {
      for (const entry of entries) h.outboxEntries.set(entry.id, entry);
    });
    h.outboxPersistence.remove.mockReset().mockImplementation(async (id: string) => {
      h.outboxEntries.delete(id);
    });
    h.outboxPersistence.removeMany.mockReset().mockImplementation(async (ids: string[]) => {
      for (const id of ids) h.outboxEntries.delete(id);
    });
    h.readQueuedRecord.mockReset().mockImplementation(async (entry: QueuedRecord) => {
      if (entry.record) return entry.record;
      throw new Error('Queued record carries no readable payload.');
    });
    webLocks = createWebLocksHarness();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: webLocks,
    });
    getUser.mockReset().mockResolvedValue(NOT_PENDING);
    getDeletionPending.mockReset().mockResolvedValue(DB_NOT_PENDING);
    deleteAccountFromDB.mockReset().mockResolvedValue(FAILED);
    fetchFullStateFromDB.mockReset().mockResolvedValue(serverState());
    authRepositorySignOut.mockClear();
    saveRecordToDB.mockClear();
    h.installE2eeRuntimeForAuthenticatedSession.mockClear();
    mockSupabase.rpc.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('writes and exactly reads back a pending attempt before the first deletion call', async () => {
    const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
    const setItem = vi.spyOn(storagePrototype, 'setItem');
    const getItem = vi.spyOn(storagePrototype, 'getItem');
    deleteAccountFromDB.mockResolvedValue(FAILED);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    const key = recoveryKeyFor('user-a');
    const setCall = setItem.mock.calls.findIndex(([candidate]) => candidate === key);
    expect(setCall).toBeGreaterThanOrEqual(0);
    const setOrder = setItem.mock.invocationCallOrder[setCall];
    const readOrders = getItem.mock.calls.flatMap(([candidate], index) =>
      candidate === key ? [getItem.mock.invocationCallOrder[index]] : []);
    const serverOrder = h.deleteAccountFromDB.mock.invocationCallOrder[0];
    expect(readOrders.some((order) => order > setOrder && order < serverOrder)).toBe(true);
    expect(JSON.parse(localStorage.getItem(key) || 'null')).toMatchObject({
      version: 2,
      userId: 'user-a',
      phase: 'pending',
    });
  });

  it('makes zero deletion calls when marker storage cannot be durably read back', async () => {
    const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
    const originalSetItem = storagePrototype.setItem;
    vi.spyOn(storagePrototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (key === recoveryKeyFor('user-a')) throw new Error('storage unavailable');
      return originalSetItem.call(this, key, value);
    });
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(deleteAccountFromDB.mock.calls).toHaveLength(0);
    expect(screen.getByTestId('deletion-result')).toHaveTextContent('failed');
  });

  it('fails closed with zero deletion calls when Web Locks is unavailable', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(deleteAccountFromDB).not.toHaveBeenCalled();
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('deletion-result')).toHaveTextContent('failed');
  });

  it('fails closed with zero deletion calls when Web Locks throws', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: vi.fn().mockRejectedValue(new Error('lock service failed')) },
    });
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(deleteAccountFromDB).not.toHaveBeenCalled();
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('deletion-result')).toHaveTextContent('failed');
  });

  it('refuses enqueue and flush without Web Locks while preserving existing outbox data', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    renderApp();
    await signIn();
    const existing = queuedEntry('pre-existing', 'user-a', 'couple-1');
    h.outboxEntries.set(existing.id, existing);
    h.readQueuedRecord.mockClear();

    await act(async () => { screen.getByText('queue-record').click(); });
    await waitFor(() => expect(screen.getByTestId('queue-result')).toHaveTextContent('not-queued'));
    await act(async () => { screen.getByText('flush-outbox').click(); });
    await waitFor(() => expect(screen.getByTestId('flush-result')).toHaveTextContent('done'));

    expect(Array.from(h.outboxEntries.keys())).toEqual(['pre-existing']);
    expect(h.outboxEntries.get(existing.id)).toBe(existing);
    expect(h.readQueuedRecord).not.toHaveBeenCalled();
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('preserves retry/discard data when Web Locks is unsupported', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const existing = queuedEntry('pre-existing', 'user-a', 'couple-1');
    existing.attempts = 4;
    existing.blocked = { reason: 'forbidden', message: 'keep me', at: '2026-08-01T00:00:00Z' };
    h.outboxEntries.set(existing.id, existing);
    renderApp();
    await signIn();
    await settleStartupFlush();

    await act(async () => {
      screen.getByText('retry-blocked').click();
      screen.getByText('discard-queued').click();
    });
    await waitFor(() => expect(screen.getByTestId('retry-result')).toHaveTextContent('0'));
    await waitFor(() => expect(screen.getByTestId('discard-result')).toHaveTextContent('0'));

    expect(h.outboxEntries.get(existing.id)).toBe(existing);
    expect(h.outboxEntries.get(existing.id)?.attempts).toBe(4);
    expect(h.outboxEntries.get(existing.id)?.blocked?.message).toBe('keep me');
  });

  it('preserves retry/discard data while an active deletion marker fences the account', async () => {
    const existing = queuedEntry('pre-existing', 'user-a', 'couple-1');
    existing.attempts = 4;
    existing.blocked = { reason: 'forbidden', message: 'keep me', at: '2026-08-01T00:00:00Z' };
    h.outboxEntries.set(existing.id, existing);
    renderApp();
    await signIn();
    await settleStartupFlush();
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );

    await act(async () => {
      screen.getByText('retry-blocked').click();
      screen.getByText('discard-queued').click();
    });
    await waitFor(() => expect(screen.getByTestId('retry-result')).toHaveTextContent('0'));
    await waitFor(() => expect(screen.getByTestId('discard-result')).toHaveTextContent('0'));

    expect(h.outboxEntries.get(existing.id)).toBe(existing);
    expect(h.outboxEntries.get(existing.id)?.attempts).toBe(4);
    expect(h.outboxEntries.get(existing.id)?.blocked?.message).toBe('keep me');
  });

  it('preserves retry/discard data when the account lock is already held', async () => {
    const existing = queuedEntry('pre-existing', 'user-a', 'couple-1');
    existing.attempts = 4;
    existing.blocked = { reason: 'forbidden', message: 'keep me', at: '2026-08-01T00:00:00Z' };
    h.outboxEntries.set(existing.id, existing);
    renderApp();
    await signIn();
    await settleStartupFlush();
    const release = deferred<void>();
    const acquired = deferred<void>();
    const holder = navigator.locks.request(
      `${DELETION_LOCK_PREFIX}user-a`,
      { mode: 'exclusive' },
      async () => {
        acquired.resolve(undefined);
        await release.promise;
      },
    );
    await acquired.promise;

    await act(async () => {
      screen.getByText('retry-blocked').click();
      screen.getByText('discard-queued').click();
    });
    await waitFor(() => expect(screen.getByTestId('retry-result')).toHaveTextContent('0'));
    await waitFor(() => expect(screen.getByTestId('discard-result')).toHaveTextContent('0'));

    expect(h.outboxEntries.get(existing.id)).toBe(existing);
    release.resolve(undefined);
    await holder;
  });

  it.each(['retry-blocked', 'discard-queued'] as const)(
    'does not mutate A when the account switches during %s queue enumeration',
    async (action) => {
      const existing = queuedEntry('pre-existing', 'user-a', 'couple-1');
      existing.attempts = 4;
      existing.blocked = { reason: 'forbidden', message: 'keep me', at: '2026-08-01T00:00:00Z' };
      h.outboxEntries.set(existing.id, existing);
      renderApp();
      await signIn();
      await settleStartupFlush();
      const readStarted = deferred<void>();
      const finishRead = deferred<QueuedRecord[]>();
      h.outboxPersistence.all.mockImplementationOnce(() => {
        readStarted.resolve(undefined);
        return finishRead.promise;
      });

      act(() => { screen.getByText(action).click(); });
      await readStarted.promise;
      getUser.mockResolvedValue({
        data: { user: { id: 'user-b', app_metadata: { provider: 'google' } } },
        error: null,
      });
      await act(async () => { emitAuth('SIGNED_IN', 'user-b'); });
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
      await act(async () => { finishRead.resolve([existing]); });

      expect(h.outboxEntries.get(existing.id)).toBe(existing);
      expect(h.outboxEntries.get(existing.id)?.attempts).toBe(4);
      expect(h.outboxEntries.get(existing.id)?.blocked?.message).toBe('keep me');
    },
  );

  it('uses one same-origin deletion flight across two Providers', async () => {
    const deletion = deferred<AccountDeletionOutcome>();
    deleteAccountFromDB.mockImplementation(() => deletion.promise);
    const first = renderApp();
    const second = renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(2));
    await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });
    await waitFor(() => expect(screen.getAllByTestId('user').every(
      (node) => node.textContent === 'user-a',
    )).toBe(true));
    await settleStartupFlush();

    act(() => {
      for (const button of screen.getAllByText('delete-account')) fireEvent.click(button);
    });
    await waitFor(() => expect(deleteAccountFromDB).toHaveBeenCalled());
    await act(async () => { deletion.resolve(CANCELLED); });

    expect(deleteAccountFromDB).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('deletion-result').map((node) => node.textContent).sort())
      .toEqual(['cancelled', 'failed']);
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId('recovery').every(
      (node) => node.textContent === 'none',
    )).toBe(true));
    expect(screen.getAllByTestId('deletionStatus').every(
      (node) => node.textContent === 'clear',
    )).toBe(true);
    first.unmount();
    second.unmount();
  });

  it('does not let a deleted Provider late completion sign out or clear the next Provider account', async () => {
    const deletion = deferred<AccountDeletionOutcome>();
    deleteAccountFromDB.mockImplementation(() => deletion.promise);
    const first = renderApp();
    await signIn('user-a');
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));

    act(() => { screen.getByText('delete-account').click(); });
    await waitFor(() => expect(deleteAccountFromDB).toHaveBeenCalledTimes(1));
    first.unmount();

    getUser.mockResolvedValue({
      data: { user: { id: 'user-b', app_metadata: { provider: 'google' } } },
      error: null,
    });
    const second = renderApp();
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThanOrEqual(2));
    await act(async () => {
      authCallbacks.at(-1)?.('SIGNED_IN', {
        user: { id: 'user-b', email: 'user-b@example.com', app_metadata: { provider: 'google' } },
      });
    });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    const nextRuntimeTeardown = vi.fn();
    registerE2eeRuntimeTeardown(nextRuntimeTeardown);

    await act(async () => { deletion.resolve(DELETED); });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('user')).toHaveTextContent('user-b');
    expect(authRepositorySignOut).not.toHaveBeenCalled();
    expect(nextRuntimeTeardown).not.toHaveBeenCalled();
    second.unmount();
  });

  it.each([
    ['failed', FAILED],
    ['recovery_required', RECOVERY_REQUIRED],
  ] as const)('fences both Providers when the one deletion winner returns %s', async (_label, outcome) => {
    const deletion = deferred<AccountDeletionOutcome>();
    deleteAccountFromDB.mockImplementation(() => deletion.promise);
    const first = renderApp();
    const second = renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(2));
    await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });
    await waitFor(() => expect(screen.getAllByTestId('user').every(
      (node) => node.textContent === 'user-a',
    )).toBe(true));
    await settleStartupFlush();

    act(() => {
      for (const button of screen.getAllByText('delete-account')) fireEvent.click(button);
    });
    await waitFor(() => expect(deleteAccountFromDB).toHaveBeenCalledTimes(1));
    await act(async () => { deletion.resolve(outcome); });

    await waitFor(() => expect(screen.getAllByTestId('recovery').every(
      (node) => node.textContent === 'active',
    )).toBe(true));
    expect(screen.queryByText('HOME-PAGE-RENDERED')).not.toBeInTheDocument();
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).not.toBeNull();
    first.unmount();
    second.unmount();
  });

  it('joins the cooperative deletion lock when a loser observes contention before the marker exists', async () => {
    deleteAccountFromDB.mockResolvedValue(FAILED);
    const first = renderApp();
    const second = renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(2));
    await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });
    await waitFor(() => expect(screen.getAllByTestId('user').every(
      (node) => node.textContent === 'user-a',
    )).toBe(true));
    await settleStartupFlush();
    const delayedLocks = createDelayedFirstWebLocksHarness();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: delayedLocks,
    });

    act(() => {
      for (const button of screen.getAllByText('delete-account')) fireEvent.click(button);
    });
    await delayedLocks.loserTried.promise;
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    await act(async () => { delayedLocks.allowWinner.resolve(undefined); });

    await waitFor(() => expect(deleteAccountFromDB).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByTestId('recovery').every(
      (node) => node.textContent === 'active',
    )).toBe(true));
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).not.toBeNull();
    first.unmount();
    second.unmount();
  });

  it('same-document marker appearance fences the matching account and removal does not auto-open it', async () => {
    renderApp();
    await signIn('user-a');
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));

    let marker: ReturnType<typeof markRecoveryPending> = null;
    act(() => { marker = markRecoveryPending('user-a', localStorage, () => ATTEMPT_A); });
    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));

    act(() => {
      expect(clearRecoveryMarkerForAttempt(marker!, 'pending')).toBe(true);
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
  });

  it('storage marker appearance rereads the matching account key instead of trusting event payload', async () => {
    renderApp();
    await signIn('user-a');
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'untrusted-unrelated-key',
        newValue: null,
      }));
    });

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
    localStorage.removeItem(recoveryKeyFor('user-a'));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: recoveryKeyFor('user-a'),
        oldValue: markerPayload('user-a', ATTEMPT_A, 'pending'),
        newValue: null,
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
  });

  it('marker events for A never fence the currently signed-in B account', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-b', app_metadata: { provider: 'google' } } },
      error: null,
    });
    renderApp();
    await signIn('user-b');
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: recoveryKeyFor('user-a'),
        newValue: markerPayload('user-a', ATTEMPT_A, 'pending'),
      }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('user-b');
  });

  it('returns A\'s truthful deleted result after switching to B without purging or signing out B', async () => {
    let resolveDeletion!: (outcome: AccountDeletionOutcome) => void;
    deleteAccountFromDB.mockImplementation(() => new Promise((resolve) => { resolveDeletion = resolve; }));
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    h.outboxEntries.set('queued-b', queuedEntry('queued-b', 'user-b', 'couple-2'));
    seedLocalArtifacts('user-a');
    seedLocalArtifacts('user-b');
    renderApp();
    await signIn('user-a');

    act(() => { screen.getByText('delete-account').click(); });
    await waitFor(() => expect(deleteAccountFromDB.mock.calls).toHaveLength(1));
    getUser.mockResolvedValue({
      data: { user: { id: 'user-b', app_metadata: { provider: 'google' } } },
      error: null,
    });
    await act(async () => { emitAuth('SIGNED_IN', 'user-b'); });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));

    await act(async () => { resolveDeletion(DELETED); });
    await waitFor(() => expect(screen.getByTestId('deletion-result')).toHaveTextContent('deleted'));

    expect(screen.getByTestId('user')).toHaveTextContent('user-b');
    expect(authRepositorySignOut).not.toHaveBeenCalled();
    expect(h.outboxEntries.has('queued-a')).toBe(false);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
    expectLocalArtifactsPurged('user-a');
    expectLocalArtifactsPresent('user-b');
  });

  it('reuses one pending attempt and one network call for same-account retries', async () => {
    let resolveDeletion!: (outcome: AccountDeletionOutcome) => void;
    deleteAccountFromDB.mockImplementation(() => new Promise((resolve) => { resolveDeletion = resolve; }));
    renderApp();
    await signIn();

    act(() => {
      fireEvent.click(screen.getByText('delete-account'));
      fireEvent.click(screen.getByText('retry-deletion'));
    });
    await waitFor(() => expect(deleteAccountFromDB.mock.calls).toHaveLength(1));
    const firstMarker = localStorage.getItem(recoveryKeyFor('user-a'));
    await act(async () => { resolveDeletion(FAILED); });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(firstMarker);
  });

  it('does not let an older response advance or clean a newer pending attempt', async () => {
    let resolveDeletion!: (outcome: AccountDeletionOutcome) => void;
    deleteAccountFromDB.mockImplementation(() => new Promise((resolve) => { resolveDeletion = resolve; }));
    seedLocalArtifacts('user-a');
    renderApp();
    await signIn();

    act(() => { screen.getByText('delete-account').click(); });
    await waitFor(() => expect(deleteAccountFromDB.mock.calls).toHaveLength(1));
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A_NEWER, 'pending'),
    );
    await act(async () => { resolveDeletion(DELETED); });

    expect(localStorage.getItem(recoveryKeyFor('user-a')))
      .toBe(markerPayload('user-a', ATTEMPT_A_NEWER, 'pending'));
    expectLocalArtifactsPresent('user-a');
    expect(authRepositorySignOut).not.toHaveBeenCalled();
  });

  it('does not let an older cancelled response clear a newer pending attempt', async () => {
    const deletion = deferred<AccountDeletionOutcome>();
    deleteAccountFromDB.mockImplementation(() => deletion.promise);
    renderApp();
    await signIn();

    act(() => { screen.getByText('delete-account').click(); });
    await waitFor(() => expect(deleteAccountFromDB).toHaveBeenCalledTimes(1));
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A_NEWER, 'pending'),
    );
    await act(async () => { deletion.resolve(CANCELLED); });

    expect(localStorage.getItem(recoveryKeyFor('user-a')))
      .toBe(markerPayload('user-a', ATTEMPT_A_NEWER, 'pending'));
    expect(screen.getByTestId('deletion-result')).toHaveTextContent('cancelled');
  });

  it.each([
    ['failed', FAILED],
    ['recovery_required', RECOVERY_REQUIRED],
    ['partially_deleted', PARTIAL],
  ] as const)('preserves %s account content, queued files, and consent across restart', async (_status, outcome) => {
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    seedLocalArtifacts('user-a');
    deleteAccountFromDB.mockResolvedValue(outcome);
    const first = renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });

    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expectLocalArtifactsPresent('user-a');
    first.unmount();
    authCallbacks.length = 0;
    const second = renderApp();
    await signIn();

    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expectLocalArtifactsPresent('user-a');
    second.unmount();
  });

  it('keeps local_cleanup intact when INITIAL_SESSION resolves to that account', async () => {
    const cleanup = markerPayload('user-a', ATTEMPT_A, 'local_cleanup');
    localStorage.setItem(recoveryKeyFor('user-a'), cleanup);
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    seedLocalArtifacts('user-a');

    renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(1));
    await act(async () => { emitAuth('INITIAL_SESSION', 'user-a'); });
    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(cleanup);
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expectLocalArtifactsPresent('user-a');
    expect(fetchFullStateFromDB).not.toHaveBeenCalled();
    expect(h.installE2eeRuntimeForAuthenticatedSession).not.toHaveBeenCalled();
  });

  it('explicit null INITIAL_SESSION cleans only exact V2 local_cleanup and preserves untrusted markers', async () => {
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'local_cleanup'),
    );
    localStorage.setItem(
      recoveryKeyFor('user-b'),
      markerPayload('user-b', ATTEMPT_B, 'pending'),
    );
    localStorage.setItem(recoveryKeyFor('user-c'), 'local_cleanup');
    localStorage.setItem(recoveryKeyFor('user-d'), '{broken');
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    h.outboxEntries.set('queued-b', queuedEntry('queued-b', 'user-b', 'couple-2'));
    h.outboxEntries.set('queued-c', queuedEntry('queued-c', 'user-c', 'couple-3'));
    h.outboxEntries.set('queued-d', queuedEntry('queued-d', 'user-d', 'couple-4'));
    seedLocalArtifacts('user-a');
    seedLocalArtifacts('user-b');
    seedLocalArtifacts('user-c');
    seedLocalArtifacts('user-d');

    renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(1));
    expect(localStorage.getItem(recoveryKeyFor('user-a')))
      .toBe(markerPayload('user-a', ATTEMPT_A, 'local_cleanup'));
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    await act(async () => { emitAuth('INITIAL_SESSION', null); });

    await waitFor(() => expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull());
    expect(localStorage.getItem(recoveryKeyFor('user-b')))
      .toBe(markerPayload('user-b', ATTEMPT_B, 'pending'));
    expect(localStorage.getItem(recoveryKeyFor('user-c'))).toBe('local_cleanup');
    expect(localStorage.getItem(recoveryKeyFor('user-d'))).toBe('{broken');
    expect(h.outboxEntries.has('queued-a')).toBe(false);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
    expect(h.outboxEntries.has('queued-c')).toBe(true);
    expect(h.outboxEntries.has('queued-d')).toBe(true);
    expectLocalArtifactsPurged('user-a');
    expectLocalArtifactsPresent('user-b');
    expectLocalArtifactsPresent('user-c');
    expectLocalArtifactsPresent('user-d');
    expect(authRepositorySignOut).not.toHaveBeenCalled();
  });

  it('does not purge or clear an unreadable marker during signed-out startup recovery', async () => {
    const key = recoveryKeyFor('user-a');
    localStorage.setItem(key, markerPayload('user-a', ATTEMPT_A, 'local_cleanup'));
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    seedLocalArtifacts('user-a');
    const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
    const originalGetItem = storagePrototype.getItem;
    vi.spyOn(storagePrototype, 'getItem').mockImplementation(function getItem(candidate) {
      if (candidate === key) throw new Error('storage unreadable');
      return originalGetItem.call(this, candidate);
    });

    renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(1));
    await act(async () => {
      emitAuth('INITIAL_SESSION', null);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expectLocalArtifactsPresent('user-a');
    expect(originalGetItem.call(localStorage, key)).toBe(
      markerPayload('user-a', ATTEMPT_A, 'local_cleanup'),
    );
  });

  it('runs startup local_cleanup transition and clear under the per-user lock', async () => {
    const cleanup = markerPayload('user-a', ATTEMPT_A, 'local_cleanup');
    localStorage.setItem(recoveryKeyFor('user-a'), cleanup);
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    seedLocalArtifacts('user-a');
    const lockHeld = deferred<void>();
    const lockAcquired = deferred<void>();
    const holder = navigator.locks.request(
      `${DELETION_LOCK_PREFIX}user-a`,
      { mode: 'exclusive' },
      async () => {
        lockAcquired.resolve(undefined);
        await lockHeld.promise;
      },
    );
    await lockAcquired.promise;

    renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(1));
    await act(async () => { emitAuth('INITIAL_SESSION', null); });
    await act(async () => { await Promise.resolve(); });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(cleanup);
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expectLocalArtifactsPresent('user-a');

    lockHeld.resolve(undefined);
    await holder;
    await waitFor(() => expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull());
    expect(h.outboxEntries.has('queued-a')).toBe(false);
    expectLocalArtifactsPurged('user-a');
  });

  it('preserves startup local_cleanup when Web Locks is unavailable', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const cleanup = markerPayload('user-a', ATTEMPT_A, 'local_cleanup');
    localStorage.setItem(recoveryKeyFor('user-a'), cleanup);
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    seedLocalArtifacts('user-a');

    renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(1));
    await act(async () => {
      emitAuth('INITIAL_SESSION', null);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(cleanup);
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expectLocalArtifactsPresent('user-a');
  });

  it('keeps local_cleanup when outbox storage is unavailable and absence cannot be proven', async () => {
    const cleanup = markerPayload('user-a', ATTEMPT_A, 'local_cleanup');
    localStorage.setItem(recoveryKeyFor('user-a'), cleanup);
    seedLocalArtifacts('user-a');
    h.outboxAdapter.available = false;

    renderApp();
    await waitFor(() => expect(authCallbacks).toHaveLength(1));
    await act(async () => {
      emitAuth('INITIAL_SESSION', null);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(cleanup);
  });

  it.each([
    ['legacy local_cleanup', 'local_cleanup'],
    ['legacy pending', 'true'],
    ['corrupt', '{broken'],
  ])('never upgrades, clears, or purges a %s marker from the signed-in delete flow', async (_label, raw) => {
    localStorage.setItem(recoveryKeyFor('user-a'), raw);
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    seedLocalArtifacts('user-a');
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(deleteAccountFromDB).not.toHaveBeenCalled();
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(raw);
    expect(h.outboxEntries.get('queued-a')?.attempts).toBe(0);
    expectLocalArtifactsPresent('user-a');
  });

  it('never purges or calls deletion when the signed-in marker is unreadable', async () => {
    const key = recoveryKeyFor('user-a');
    const raw = markerPayload('user-a', ATTEMPT_A, 'local_cleanup');
    localStorage.setItem(key, raw);
    h.outboxEntries.set('queued-a', queuedEntry('queued-a', 'user-a', 'couple-1'));
    seedLocalArtifacts('user-a');
    const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
    const originalGetItem = storagePrototype.getItem;
    vi.spyOn(storagePrototype, 'getItem').mockImplementation(function getItem(candidate) {
      if (candidate === key) throw new Error('storage unreadable');
      return originalGetItem.call(this, candidate);
    });
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(deleteAccountFromDB).not.toHaveBeenCalled();
    expect(originalGetItem.call(localStorage, key)).toBe(raw);
    expect(h.outboxEntries.get('queued-a')?.attempts).toBe(0);
    expectLocalArtifactsPresent('user-a');
  });

  it('blocks queueing and flush before opening a queued payload when a marker becomes active', async () => {
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    entry.record = undefined;
    entry.sealedRecord = { version: 1, iv: 'bad', ciphertext: 'bad' } as never;
    h.outboxEntries.set(entry.id, entry);
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );

    await act(async () => {
      screen.getByText('queue-record').click();
      screen.getByText('flush-outbox').click();
      await Promise.resolve();
    });

    expect(h.outboxEntries.size).toBe(1);
    expect(h.outboxEntries.get('queued-a')).toEqual(entry);
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('rechecks immediately before decrypt when the marker appears during queue enumeration', async () => {
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    entry.record = undefined;
    entry.sealedRecord = { version: 1, iv: 'bad', ciphertext: 'bad' } as never;
    h.outboxEntries.set(entry.id, entry);
    h.outboxPersistence.all.mockImplementationOnce(async () => {
      localStorage.setItem(
        recoveryKeyFor('user-a'),
        markerPayload('user-a', ATTEMPT_A, 'pending'),
      );
      return Array.from(h.outboxEntries.values());
    });

    await act(async () => { screen.getByText('flush-outbox').click(); });

    expect(h.outboxEntries.get(entry.id)).toEqual(entry);
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('never writes A plaintext as B when auth switches within the same couple during decrypt', async () => {
    renderApp();
    await signIn('user-a');
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();
    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    h.outboxEntries.set(entry.id, entry);
    const decryptStarted = deferred<void>();
    const finishDecrypt = deferred<NonNullable<QueuedRecord['record']>>();
    h.readQueuedRecord.mockImplementationOnce(async () => {
      decryptStarted.resolve(undefined);
      return finishDecrypt.promise;
    });

    act(() => { screen.getByText('flush-outbox').click(); });
    await decryptStarted.promise;
    getUser.mockResolvedValue({
      data: { user: { id: 'user-b', app_metadata: { provider: 'google' } } },
      error: null,
    });
    await act(async () => { emitAuth('SIGNED_IN', 'user-b'); });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    await act(async () => { finishDecrypt.resolve(entry.record!); });
    await waitFor(() => expect(screen.getByTestId('flush-result')).toHaveTextContent('done'));

    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(h.outboxEntries.get(entry.id)).toMatchObject({
      userId: 'user-a',
      coupleId: 'couple-1',
      attempts: 0,
    });
    expect(h.outboxEntries.get(entry.id)?.blocked).toBeUndefined();
  });

  it('rechecks after reading a queued payload and before applying any delivery mutation', async () => {
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    const record = entry.record;
    Object.defineProperty(entry, 'record', {
      configurable: true,
      enumerable: true,
      get: () => {
        localStorage.setItem(
          recoveryKeyFor('user-a'),
          markerPayload('user-a', ATTEMPT_A, 'pending'),
        );
        return record;
      },
    });
    h.outboxEntries.set(entry.id, entry);

    await act(async () => { screen.getByText('flush-outbox').click(); });

    expect(h.outboxEntries.has(entry.id)).toBe(true);
    expect(h.outboxEntries.get(entry.id)?.attempts).toBe(0);
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it.each([
    ['media resume', []],
    ['publication', [{ type: 'photo', name: 'post.jpg', path: 'couple-1/queued-a/post.jpg' }]],
  ] as const)('does not deadlock staged-post %s when the nested gate observes server-only pending', async (
    _label,
    attachments,
  ) => {
    const stagedRecord = {
      id: 'queued-a',
      userId: 'user-a',
      date: '2026-08-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'staged post',
      isPrivate: true,
      isProfilePost: attachments.length === 0 ? true : false,
      createdAt: '2026-08-01T10:00:00.000Z',
      contentRevision: 1,
      attachments: [...attachments],
    };
    fetchFullStateFromDB.mockResolvedValue(serverState({ records: [stagedRecord] as never }));
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();

    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    entry.allOrNothingMedia = true;
    entry.files = [new File(['post'], 'post.jpg', { type: 'image/jpeg' })];
    entry.record = {
      userId: 'user-a',
      date: '2026-08-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'staged post',
      isPrivate: false,
      isProfilePost: true,
    } as never;
    h.outboxEntries.set(entry.id, entry);
    getDeletionPending.mockResolvedValue(DB_PENDING);

    act(() => { screen.getByText('flush-outbox').click(); });
    const flush = lastProbeFlush;
    if (!flush) throw new Error('flush promise was not captured');
    await expect(Promise.race([
      flush,
      new Promise((_, reject) => setTimeout(() => reject(new Error('flush deadlocked')), 250)),
    ])).resolves.toBeDefined();

    expect(h.outboxEntries.get(entry.id)).toBe(entry);
    expect(h.outboxEntries.get(entry.id)?.attempts).toBe(0);
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).not.toBeNull();
  });

  it('compensates only the new direct-queue entry when a marker appears during enqueue', async () => {
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();
    const existing = queuedEntry('pre-existing', 'user-a', 'couple-1');
    h.outboxEntries.set(existing.id, existing);
    const addStarted = deferred<void>();
    const finishAdd = deferred<void>();
    h.outboxPersistence.add.mockImplementationOnce(async (entry: QueuedRecord) => {
      h.outboxEntries.set(entry.id, entry);
      addStarted.resolve(undefined);
      await finishAdd.promise;
    });

    act(() => { screen.getByText('queue-record').click(); });
    await addStarted.promise;
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );
    await act(async () => { finishAdd.resolve(undefined); });
    await waitFor(() => expect(screen.getByTestId('queue-result')).toHaveTextContent('not-queued'));

    expect(Array.from(h.outboxEntries.keys())).toEqual(['pre-existing']);
    expect(h.outboxEntries.get(existing.id)).toBe(existing);
  });

  it('reports queued when the durable insert commits but the follow-up count read fails', async () => {
    renderApp();
    await signIn('user-a');
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();
    let inserted = false;
    h.outboxPersistence.add.mockImplementationOnce(async (entry: QueuedRecord) => {
      h.outboxEntries.set(entry.id, entry);
      inserted = true;
    });
    h.outboxPersistence.all.mockImplementation(async () => {
      if (inserted) throw new Error('count read failed');
      return Array.from(h.outboxEntries.values());
    });

    act(() => { screen.getByText('queue-record').click(); });
    await waitFor(() => expect(screen.getByTestId('queue-result')).toHaveTextContent(/^queued$/));

    expect(h.outboxEntries.size).toBe(1);
    expect(Array.from(h.outboxEntries.values())[0]).toMatchObject({
      userId: 'user-a',
      coupleId: 'couple-1',
      attempts: 0,
    });
  });

  it('uses the same enqueue compensation for the addRecord retry queue path', async () => {
    h.saveRecordToDB.mockResolvedValueOnce({
      ok: false as const,
      reason: 'offline',
      error: 'offline',
    });
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();
    const existing = queuedEntry('pre-existing', 'user-a', 'couple-1');
    h.outboxEntries.set(existing.id, existing);
    const addStarted = deferred<void>();
    const finishAdd = deferred<void>();
    h.outboxPersistence.add.mockImplementationOnce(async (entry: QueuedRecord) => {
      h.outboxEntries.set(entry.id, entry);
      addStarted.resolve(undefined);
      await finishAdd.promise;
    });

    act(() => { screen.getByText('add-record').click(); });
    await addStarted.promise;
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );
    await act(async () => { finishAdd.resolve(undefined); });
    await waitFor(() => expect(screen.getByTestId('add-result')).toHaveTextContent('not-queued'));

    expect(Array.from(h.outboxEntries.keys())).toEqual(['pre-existing']);
    expect(h.outboxEntries.get(existing.id)).toBe(existing);
  });

  it('preserves an entry when a marker appears during controlled decrypt', async () => {
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();
    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    entry.record = {
      date: '2026-08-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'queued-a-private',
      isPrivate: false,
    } as never;
    h.outboxEntries.set(entry.id, entry);
    const decryptStarted = deferred<void>();
    const decrypt = deferred<NonNullable<QueuedRecord['record']>>();
    h.readQueuedRecord.mockImplementationOnce(() => {
      decryptStarted.resolve(undefined);
      return decrypt.promise;
    });
    h.outboxPersistence.put.mockClear();
    h.outboxPersistence.remove.mockClear();

    act(() => { screen.getByText('flush-outbox').click(); });
    await decryptStarted.promise;
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );
    await act(async () => { decrypt.resolve(entry.record!); });
    await waitFor(() => expect(screen.getByTestId('flush-result')).toHaveTextContent('done'));

    expect(h.outboxEntries.get(entry.id)).toBe(entry);
    expect(h.outboxPersistence.put).not.toHaveBeenCalled();
    expect(h.outboxPersistence.remove).not.toHaveBeenCalled();
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('preserves an entry when a marker appears during remote mutation before disposition', async () => {
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();
    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    entry.record = {
      date: '2026-08-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'queued-a-private',
      isPrivate: false,
    } as never;
    entry.files = [];
    h.outboxEntries.set(entry.id, entry);
    const mutation = deferred<{ ok: true; contentRevision: number }>();
    h.saveRecordToDB.mockImplementationOnce(async () => {
      callLog.push('saveRecordToDB');
      return mutation.promise;
    });
    h.outboxPersistence.put.mockClear();
    h.outboxPersistence.remove.mockClear();

    act(() => { screen.getByText('flush-outbox').click(); });
    const flush = lastProbeFlush;
    expect(flush).not.toBeNull();
    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalled());
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );
    await act(async () => {
      mutation.resolve({ ok: true, contentRevision: 1 });
      await mutation.promise;
      await flush;
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await waitFor(() => expect(screen.getByTestId('flush-result')).toHaveTextContent('done'));

    expect(h.outboxEntries.get(entry.id)).toBe(entry);
    expect(h.outboxPersistence.put).not.toHaveBeenCalled();
    expect(h.outboxPersistence.remove).not.toHaveBeenCalled();
  });

  it('preserves an entry when decrypt throws after a marker appears', async () => {
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));
    await settleStartupFlush();
    const entry = queuedEntry('queued-a', 'user-a', 'couple-1');
    h.outboxEntries.set(entry.id, entry);
    const decryptStarted = deferred<void>();
    const decrypt = deferred<NonNullable<QueuedRecord['record']>>();
    h.readQueuedRecord.mockImplementationOnce(() => {
      decryptStarted.resolve(undefined);
      return decrypt.promise;
    });
    h.outboxPersistence.put.mockClear();
    h.outboxPersistence.remove.mockClear();

    act(() => { screen.getByText('flush-outbox').click(); });
    await decryptStarted.promise;
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );
    await act(async () => { decrypt.reject(new Error('tampered')); });
    await waitFor(() => expect(screen.getByTestId('flush-result')).toHaveTextContent('done'));

    expect(h.outboxEntries.get(entry.id)).toBe(entry);
    expect(h.outboxEntries.get(entry.id)?.attempts).toBe(0);
    expect(h.outboxPersistence.put).not.toHaveBeenCalled();
    expect(h.outboxPersistence.remove).not.toHaveBeenCalled();
  });

  it('rechecks the marker after fetch and before applying hydrated state or E2EE', async () => {
    let resolveHydration!: (state: Partial<AppState>) => void;
    fetchFullStateFromDB.mockImplementation(() => new Promise((resolve) => { resolveHydration = resolve; }));
    renderApp();
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    act(() => { emitAuth('SIGNED_IN', 'user-a'); });
    await waitFor(() => expect(fetchFullStateFromDB).toHaveBeenCalled());
    h.installE2eeRuntimeForAuthenticatedSession.mockClear();
    localStorage.setItem(
      recoveryKeyFor('user-a'),
      markerPayload('user-a', ATTEMPT_A, 'pending'),
    );

    await act(async () => {
      resolveHydration(serverState({
        records: [{ id: 'must-not-apply', userId: 'user-a', log: 'secret' }] as never,
      }));
    });

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
    expect(screen.getByTestId('record-count')).toHaveTextContent('0');
    expect(h.installE2eeRuntimeForAuthenticatedSession).not.toHaveBeenCalled();
  });

  it('1 - keeps a V2 pending marker on partial deletion while retaining identity and data', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    const stored = localStorage.getItem(recoveryKeyFor('user-a'));
    expect(JSON.parse(stored || 'null')).toMatchObject({
      version: 2,
      userId: 'user-a',
      phase: 'pending',
    });
    // No warnings, storage paths or account content anywhere in the marker.
    expect(stored).not.toContain('media_not_fully_removed');
    expect(stored).not.toContain('couple-1');

    // STORE_KEY holds only the device-preference whitelist.
    const persisted = JSON.parse(localStorage.getItem('gomsinlog.state.v2') || '{}');
    // The POINT of this assertion is that nothing identifying or content-bearing
    // survives the purge -- no profile, no couple id, no records, no invitation
    // code. It is an exact list so a new field cannot be added to the persisted
    // blob without a deliberate decision here.
    //
    // `soldierWidgetLayout` joined it when the 군화 home became rearrangeable: the
    // two roles keep separate layouts, and a layout is a device preference in
    // exactly the same way `widgetLayout` already was -- an array of widget ids.
    //
    // Pinned against the DECLARED carry-over set rather than only against this
    // blob, because the two can disagree in the dangerous direction. A new
    // carry-over field that happens to be `undefined` at purge time -- an optional
    // one, which is exactly what a per-relationship checkpoint would be -- is
    // erased by `JSON.stringify`, so an assertion on `Object.keys(persisted)`
    // alone stays green while the field silently starts surviving sign-out. A
    // real attempt to add `partnerDayLastCheckedAt?: string` to the carry-over set
    // did pass that assertion untouched. Asserting the constant first makes the
    // declaration itself the thing under test.
    expect([...DEVICE_PREF_CARRY_OVER_KEYS].sort())
      .toEqual(['hasSeenInstallPrompt', 'locale', 'soldierWidgetLayout', 'theme', 'widgetLayout']);
    // ...and the blob may not contain anything the declaration does not allow.
    expect(Object.keys(persisted).sort())
      .toEqual([...DEVICE_PREF_CARRY_OVER_KEYS].sort());
    // The function no longer has a literal that could disagree with this list --
    // it builds its result FROM the list -- so pinning the list pins both.
    // See `carryOverDevicePrefs`.

    // The session is deliberately kept so the deletion can be finished.
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
    expect(screen.queryByText('HOME-PAGE-RENDERED')).toBeNull();
  });

  it('preserves both accounts\' queued files while deletion is only partial', async () => {
    h.outboxEntries.set('queued-a', {
      id: 'queued-a', userId: 'user-a', coupleId: 'couple-1', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-a'], 'private-a.jpg', { type: 'image/jpeg' })],
    });
    h.outboxEntries.set('queued-b', {
      id: 'queued-b', userId: 'user-b', coupleId: 'couple-2', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-b'], 'private-b.jpg', { type: 'image/jpeg' })],
    });
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
  });

  it('routes a non-destructive incomplete cancellation into recovery without purging its outbox', async () => {
    h.outboxEntries.set('queued-a', {
      id: 'queued-a', userId: 'user-a', coupleId: 'couple-1', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-a'], 'private-a.jpg', { type: 'image/jpeg' })],
    });
    deleteAccountFromDB.mockResolvedValue(RECOVERY_REQUIRED);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null'))
      .toMatchObject({ version: 2, userId: 'user-a', phase: 'pending' });
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(h.outboxEntries.has('queued-a')).toBe(true);
  });

  it('leaves the account usable after a server-confirmed safe cancellation', async () => {
    deleteAccountFromDB.mockResolvedValue(CANCELLED);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('clear');
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
  });

  it('2 - logout preserves the marker and does not claim the account was deleted', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });
    const pendingMarker = localStorage.getItem(recoveryKeyFor('user-a'));
    expect(JSON.parse(pendingMarker || 'null')).toMatchObject({ phase: 'pending' });

    await act(async () => { screen.getByText('sign-out').click(); });

    expect(localStorage.getItem('gomsinlog.state.v1')).toBeNull();
    expect(localStorage.getItem('gomsinlog.state.v2')).toBeNull();
    // Logging out does not cancel an irreversible deletion.
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(pendingMarker);
    expect(authRepositorySignOut).toHaveBeenCalled();
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.queryByText(/탈퇴가 완료되었/)).toBeNull();
  });

  it('3 - same-user re-login resumes recovery before any fetched state is applied', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });
    await act(async () => { screen.getByText('sign-out').click(); });

    callLog.length = 0;
    await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });

    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(await screen.findByText('탈퇴 다시 시도')).toBeInTheDocument();
    // No account data is fetched while recovery is active.
    expect(callLog).not.toContain('fetchFullStateFromDB');
    expect(screen.queryByText('HOME-PAGE-RENDERED')).toBeNull();
  });

  it('4 - another user reaches normal routes and the first marker stays intact', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });
    await act(async () => { screen.getByText('sign-out').click(); });

    getUser.mockResolvedValue({
      data: { user: { id: 'user-b', app_metadata: { provider: 'google' } } },
      error: null,
    });
    await act(async () => { emitAuth('SIGNED_IN', 'user-b'); });

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('none'));
    expect(await screen.findByText('HOME-PAGE-RENDERED')).toBeInTheDocument();
    // Not deleted, not overwritten.
    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null'))
      .toMatchObject({ version: 2, userId: 'user-a', phase: 'pending' });
    expect(localStorage.getItem(recoveryKeyFor('user-b'))).toBeNull();
  });

  it('5 - a malformed marker fails closed and no read path removes it', async () => {
    for (const malformed of ['{"broken":', '{}', '12345']) {
      localStorage.clear();
      localStorage.setItem(recoveryKeyFor('user-a'), malformed);
      authCallbacks.length = 0;
      const view = renderApp();
      await signIn();

      expect(screen.getByTestId('recovery')).toHaveTextContent('active');
      expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
      expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(malformed);
      view.unmount();
    }
  });

  it('6 - a clean browser is blocked by server metadata, and the verdict comes from getUser()', async () => {
    // No local marker at all, and the cached session's claims OMIT the flag.
    getUser.mockResolvedValue(PENDING);
    renderApp();
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-a', { provider: 'google', providers: ['google'] });
    });

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
    // PROVENANCE: the round-trip happened, and it is what produced the verdict.
    // A stale-JWT implementation reading `session.user.app_metadata` would give
    // the wrong answer here, because those claims omit the flag.
    expect(callLog).toContain('auth.getUser');
    expect(getUser).toHaveBeenCalled();
    // A positive server answer also writes the marker so the next reload is instant.
    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null'))
      .toMatchObject({ version: 2, userId: 'user-a', phase: 'pending' });
    expect(screen.queryByText('HOME-PAGE-RENDERED')).toBeNull();
  });

  it('preserves every queued file when another device supplies only a pending server flag', async () => {
    h.outboxEntries.set('queued-a', {
      id: 'queued-a', userId: 'user-a', coupleId: 'couple-1', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-a'], 'private-a.jpg', { type: 'image/jpeg' })],
    });
    h.outboxEntries.set('queued-b', {
      id: 'queued-b', userId: 'user-b', coupleId: 'couple-2', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-b'], 'private-b.jpg', { type: 'image/jpeg' })],
    });
    getUser.mockResolvedValue(PENDING);
    renderApp();
    await signIn();

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
  });

  it('8 - a successful retry deletes Auth BEFORE clearing the marker', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });
    const pendingMarker = localStorage.getItem(recoveryKeyFor('user-a'));
    expect(JSON.parse(pendingMarker || 'null')).toMatchObject({ phase: 'pending' });

    // A retry that fails leaves the marker in place.
    deleteAccountFromDB.mockResolvedValue(FAILED);
    await act(async () => { screen.getByText('retry-deletion').click(); });
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(pendingMarker);
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');

    // A retry keeps the marker while Auth deletion is in flight, and clears it
    // only after the server confirms deletion.
    let resolveDeletion!: (outcome: AccountDeletionOutcome) => void;
    deleteAccountFromDB.mockReturnValue(new Promise<AccountDeletionOutcome>((resolve) => {
      resolveDeletion = resolve;
    }));
    await act(async () => { screen.getByText('retry-deletion').click(); });
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(pendingMarker);
    await act(async () => { resolveDeletion(DELETED); });
    await waitFor(() => {
      expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    });
  });

  it('keeps local_cleanup until an exact outbox read-back proves its files are gone', async () => {
    h.outboxEntries.set('queued-a', {
      id: 'queued-a', userId: 'user-a', coupleId: 'couple-1', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-a'], 'private-a.jpg', { type: 'image/jpeg' })],
    });
    h.outboxEntries.set('queued-b', {
      id: 'queued-b', userId: 'user-b', coupleId: 'couple-2', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-b'], 'private-b.jpg', { type: 'image/jpeg' })],
    });
    h.outboxPersistence.removeMany.mockResolvedValue(undefined);
    deleteAccountFromDB.mockResolvedValue(DELETED);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null'))
      .toMatchObject({ version: 2, userId: 'user-a', phase: 'local_cleanup' });
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
    expect(authRepositorySignOut).not.toHaveBeenCalled();

    const remoteAttempts = deleteAccountFromDB.mock.calls.length;
    h.outboxPersistence.removeMany.mockImplementation(async (ids: string[]) => {
      for (const id of ids) h.outboxEntries.delete(id);
    });
    await act(async () => { screen.getByText('retry-deletion').click(); });

    expect(deleteAccountFromDB.mock.calls).toHaveLength(remoteAttempts);
    expect(h.outboxEntries.has('queued-a')).toBe(false);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(authRepositorySignOut).toHaveBeenCalledOnce();
  });

  it('a safely cancelled retry clears recovery and keeps the preserved local session', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });
    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null'))
      .toMatchObject({ phase: 'pending' });

    deleteAccountFromDB.mockResolvedValue(CANCELLED);
    await act(async () => { screen.getByText('retry-deletion').click(); });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    expect(authRepositorySignOut).not.toHaveBeenCalled();
  });

  it('9 - every authenticated route renders the recovery screen throughout', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    for (const route of AUTHENTICATED_ROUTES) {
      localStorage.clear();
      authCallbacks.length = 0;
      const view = renderApp(route);
      await signIn();
      await act(async () => { screen.getByText('delete-account').click(); });

      // before retry
      expect(await screen.findByText('탈퇴 처리를 확인하고 있어요'), route).toBeInTheDocument();
      expect(screen.queryByText('HOME-PAGE-RENDERED'), route).toBeNull();

      // after a failed retry
      deleteAccountFromDB.mockResolvedValue(FAILED);
      await act(async () => { screen.getByText('retry-deletion').click(); });
      expect(screen.getByText('탈퇴 처리를 확인하고 있어요'), route).toBeInTheDocument();

      // after a reload / remount, driven from localStorage alone
      view.unmount();
      authCallbacks.length = 0;
      const remounted = renderApp(route);
      await signIn();
      expect(await screen.findByText('탈퇴 처리를 확인하고 있어요'), route).toBeInTheDocument();

      // after logout and re-login as the same user
      await act(async () => { screen.getByText('sign-out').click(); });
      await act(async () => { emitAuth('SIGNED_IN', 'user-a'); });
      expect(await screen.findByText('탈퇴 처리를 확인하고 있어요'), route).toBeInTheDocument();
      expect(screen.queryByText('HOME-PAGE-RENDERED'), route).toBeNull();

      deleteAccountFromDB.mockResolvedValue(PARTIAL);
      screen.getByText('탈퇴 다시 시도');
      screen.getByText('로그아웃');
      // No override of any kind is offered.
      expect(screen.queryByText(/계속/)).toBeNull();
      expect(screen.queryByText(/무시/)).toBeNull();
      remounted.unmount();
    }
  });

  it('9b - /auth/callback and /legal/:doc stay reachable during recovery', async () => {
    localStorage.setItem(recoveryKeyFor('user-a'), 'true');
    renderApp('/auth/callback');
    await signIn();
    expect(await screen.findByText('AUTH-CALLBACK-RENDERED')).toBeInTheDocument();
  });

  it('blocks clean-device hydration when DB is pending even though Auth is not pending', async () => {
    getUser.mockResolvedValue(NOT_PENDING);
    getDeletionPending.mockResolvedValue(DB_PENDING);
    renderApp();
    await signIn();

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
    expect(callLog).toContain('auth.getUser');
    expect(callLog).toContain('rpc:is_my_account_deletion_pending');
    expect(callLog).not.toContain('fetchFullStateFromDB');
    expect(screen.queryByText('HOME-PAGE-RENDERED')).toBeNull();
  });

  it('does not persist a stale pre-lock pending answer after fresh locked authorities clear', async () => {
    getUser.mockResolvedValue(NOT_PENDING);
    getDeletionPending
      .mockResolvedValueOnce(DB_PENDING)
      .mockResolvedValue(DB_NOT_PENDING);
    renderApp();
    await signIn();

    expect(await screen.findByText('HOME-PAGE-RENDERED')).toBeInTheDocument();
    expect(getDeletionPending).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('clear');
  });

  it('continues clean-device hydration only when Auth and DB both answer not pending', async () => {
    getUser.mockResolvedValue(NOT_PENDING);
    getDeletionPending.mockResolvedValue(DB_NOT_PENDING);
    renderApp();
    await signIn();

    expect(await screen.findByText('HOME-PAGE-RENDERED')).toBeInTheDocument();
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('clear');
    const authAt = callLog.indexOf('auth.getUser');
    const dbAt = callLog.indexOf('rpc:is_my_account_deletion_pending');
    const hydrationAt = callLog.indexOf('fetchFullStateFromDB');
    expect(authAt).toBeGreaterThanOrEqual(0);
    expect(dbAt).toBeGreaterThanOrEqual(0);
    expect(hydrationAt).toBeGreaterThan(authAt);
    expect(hydrationAt).toBeGreaterThan(dbAt);
  });

  it.each(['error', 'reject', 'malformed'] as const)(
    'lets a literal DB true dominate an Auth %s',
    async (failure) => {
      if (failure === 'error') {
        getUser.mockResolvedValue({ data: { user: null }, error: { message: 'unavailable' } });
      } else if (failure === 'reject') {
        getUser.mockRejectedValue(new Error('unavailable'));
      } else {
        getUser.mockResolvedValue({
          data: { user: { id: 'other-user', app_metadata: { account_deletion_pending: false } } },
          error: null,
        });
      }
      getDeletionPending.mockResolvedValue(DB_PENDING);
      renderApp();
      await signIn();

      await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
      expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
    },
  );

  it.each(['error', 'reject', 'malformed'] as const)(
    'lets Auth pending dominate a DB %s',
    async (failure) => {
      getUser.mockResolvedValue(PENDING);
      if (failure === 'error') {
        getDeletionPending.mockResolvedValue({ data: false, error: { message: 'unavailable' } });
      } else if (failure === 'reject') {
        getDeletionPending.mockRejectedValue(new Error('unavailable'));
      } else {
        getDeletionPending.mockResolvedValue({ data: 'true', error: null });
      }
      renderApp();
      await signIn();

      await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
      expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
    },
  );

  it.each(['auth', 'database'] as const)(
    'keeps a positive %s authority dominant when the other authority times out',
    async (positiveAuthority) => {
      renderApp();
      await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
      if (positiveAuthority === 'auth') {
        getUser.mockResolvedValue(PENDING);
        getDeletionPending.mockImplementation(() => new Promise(() => {}));
      } else {
        getUser.mockImplementation(() => new Promise(() => {}));
        getDeletionPending.mockResolvedValue(DB_PENDING);
      }
      vi.useFakeTimers();
      act(() => { emitAuth('SIGNED_IN', 'user-a'); });

      expect(getUser).toHaveBeenCalledOnce();
      expect(getDeletionPending).toHaveBeenCalledOnce();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTH_SYNC_TIMEOUT_MS);
      });
      expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
      expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    },
  );

  it('starts both authorities concurrently, settles after one timeout, and handles late rejection', async () => {
    let rejectAuth!: (error: Error) => void;
    let rejectDatabase!: (error: Error) => void;
    const unhandled = vi.fn((event: PromiseRejectionEvent) => event.preventDefault());
    getUser.mockImplementation(() => new Promise((_, reject) => { rejectAuth = reject; }));
    getDeletionPending.mockImplementation(
      () => new Promise((_, reject) => { rejectDatabase = reject; }),
    );
    window.addEventListener('unhandledrejection', unhandled);
    renderApp();
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    vi.useFakeTimers();
    act(() => { emitAuth('SIGNED_IN', 'user-a'); });

    expect(getUser).toHaveBeenCalledOnce();
    expect(getDeletionPending).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_SYNC_TIMEOUT_MS);
    });
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('unknown');
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');

    await act(async () => {
      rejectAuth(new Error('late auth rejection'));
      rejectDatabase(new Error('late DB rejection'));
      await Promise.resolve();
    });
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', unhandled);
  });

  it('authority ranking: recovery is active whenever either authority says so', async () => {
    const combinations: Array<{
      marker: string | null;
      server: typeof NOT_PENDING | typeof PENDING | 'unavailable';
      expectRecovery: boolean;
    }> = [
      { marker: null, server: NOT_PENDING, expectRecovery: false },
      { marker: null, server: PENDING, expectRecovery: true },
      { marker: null, server: 'unavailable', expectRecovery: false },
      { marker: 'true', server: NOT_PENDING, expectRecovery: true },
      { marker: 'true', server: PENDING, expectRecovery: true },
      { marker: 'true', server: 'unavailable', expectRecovery: true },
      { marker: '{"broken":', server: NOT_PENDING, expectRecovery: true },
      { marker: '{"broken":', server: PENDING, expectRecovery: true },
      { marker: '{"broken":', server: 'unavailable', expectRecovery: true },
    ];

    for (const combination of combinations) {
      localStorage.clear();
      if (combination.marker !== null) {
        localStorage.setItem(recoveryKeyFor('user-a'), combination.marker);
      }
      if (combination.server === 'unavailable') {
        getUser.mockRejectedValue(new Error('offline'));
      } else {
        getUser.mockResolvedValue(combination.server);
      }
      authCallbacks.length = 0;
      const view = renderApp();
      await signIn();

      const label = `marker=${combination.marker} server=${
        combination.server === 'unavailable' ? 'unavailable' : combination.server.data.user.app_metadata.account_deletion_pending ? 'pending' : 'not_pending'
      }`;
      await waitFor(() => expect(screen.getByTestId('recovery'), label)
        .toHaveTextContent(combination.expectRecovery ? 'active' : 'none'));
      view.unmount();
    }
  });

  it('offline auth path releases the splash and does not fabricate recovery', async () => {
    getUser.mockRejectedValue(new Error('offline'));
    fetchFullStateFromDB.mockResolvedValue(FULL_STATE_UNAVAILABLE);
    renderApp();
    await signIn();

    // `setIsAuthChecked(true)` still runs, so the splash is released.
    await waitFor(() => expect(screen.getByTestId('deletionStatus')).toHaveTextContent('unknown'));
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
  });
});

describe('Tri-State Verification Suite - store and route behaviour', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    callLog.length = 0;
    localStorage.clear();
    getUser.mockReset().mockResolvedValue(NOT_PENDING);
    getDeletionPending.mockReset().mockResolvedValue(DB_NOT_PENDING);
    deleteAccountFromDB.mockReset().mockResolvedValue(FAILED);
    fetchFullStateFromDB.mockReset().mockResolvedValue(serverState());
    saveRecordToDB.mockClear();
    mockSupabase.rpc.mockClear();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: createWebLocksHarness(),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('3 - an offline INITIATING device is blocked by its marker alone, with no round-trip', async () => {
    localStorage.setItem(recoveryKeyFor('user-a'), 'true');
    getUser.mockImplementation(() => new Promise(() => {}));

    for (const route of AUTHENTICATED_ROUTES) {
      localStorage.setItem(recoveryKeyFor('user-a'), 'true');
      authCallbacks.length = 0;
      callLog.length = 0;
      const view = renderApp(route);
      await signIn();

      expect(screen.getByTestId('deletionStatus'), route).toHaveTextContent('pending');
      expect(await screen.findByText('탈퇴 처리를 확인하고 있어요'), route).toBeInTheDocument();
      expect(screen.queryByText('HOME-PAGE-RENDERED'), route).toBeNull();
      // The route gate was already closed while no server answer existed, and
      // the marker required no round-trip to reach that verdict.
      expect(callLog, route).not.toContain('auth.getUser');
      expect(callLog, route).not.toContain('rpc:is_my_account_deletion_pending');
      view.unmount();
    }
  });

  it('4 - an offline SECONDARY device re-verifies BEFORE synchronization and before a mutation', async () => {
    // No local marker, unreachable server => unknown, and the existing offline
    // path continues. This is a deliberate availability tradeoff, NOT fail-closed.
    getUser.mockRejectedValue(new Error('offline'));
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('deletionStatus')).toHaveTextContent('unknown'));

    // Synchronization: the check is observed BEFORE the first read request.
    // Driven through `window.addEventListener('online', ...)`, which is exactly
    // how an offline secondary device is caught when connectivity returns.
    await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalled());
    callLog.length = 0;
    getUser.mockResolvedValue(NOT_PENDING);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    await waitFor(() => expect(callLog).toContain('auth.getUser'));
    await waitFor(() => expect(callLog).toContain('rpc:is_my_account_deletion_pending'));
    await waitFor(() => expect(
      callLog.some((entry) => (
        (entry.startsWith('rpc:') && entry !== 'rpc:is_my_account_deletion_pending')
        || entry.startsWith('fetch')
      )),
    ).toBe(true));
    const syncCheck = callLog.indexOf('auth.getUser');
    const dbSyncCheck = callLog.indexOf('rpc:is_my_account_deletion_pending');
    const firstRead = callLog.findIndex((entry) => (
      (entry.startsWith('rpc:') && entry !== 'rpc:is_my_account_deletion_pending')
      || entry.startsWith('fetch')
    ));
    expect(syncCheck, callLog.join(',')).toBeGreaterThanOrEqual(0);
    expect(dbSyncCheck, callLog.join(',')).toBeGreaterThanOrEqual(0);
    expect(firstRead, callLog.join(',')).toBeGreaterThan(syncCheck);
    expect(firstRead, callLog.join(',')).toBeGreaterThan(dbSyncCheck);

    // Mutation: same ordering guarantee.
    callLog.length = 0;
    await act(async () => { screen.getByText('add-record').click(); });
    const mutationCheck = callLog.indexOf('auth.getUser');
    const mutationDbCheck = callLog.indexOf('rpc:is_my_account_deletion_pending');
    const firstWrite = callLog.indexOf('saveRecordToDB');
    expect(mutationCheck).toBeGreaterThanOrEqual(0);
    expect(mutationDbCheck).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(mutationCheck);
    expect(firstWrite).toBeGreaterThan(mutationDbCheck);

    // The status is NOT reused as if settled: a second attempt re-issues it.
    const authBefore = getUser.mock.calls.length;
    const databaseBefore = getDeletionPending.mock.calls.length;
    await act(async () => { screen.getByText('add-record').click(); });
    expect(getUser.mock.calls.length).toBeGreaterThan(authBefore);
    expect(getDeletionPending.mock.calls.length).toBeGreaterThan(databaseBefore);
  });

  it('serializes account deletion behind an in-flight ordinary record write', async () => {
    const recordWrite = deferred<{ ok: true; contentRevision: number }>();
    h.saveRecordToDB.mockImplementationOnce(async () => {
      callLog.push('saveRecordToDB');
      return recordWrite.promise;
    });
    deleteAccountFromDB.mockResolvedValue(CANCELLED);
    renderApp();
    await signIn();
    expect(await screen.findByText('HOME-PAGE-RENDERED')).toBeInTheDocument();

    act(() => { screen.getByText('add-record').click(); });
    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalledTimes(1));

    act(() => { screen.getByText('delete-account').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(deleteAccountFromDB).not.toHaveBeenCalled();

    await act(async () => {
      recordWrite.resolve({ ok: true, contentRevision: 1 });
      await recordWrite.promise;
    });
    await waitFor(() => expect(deleteAccountFromDB).toHaveBeenCalledTimes(1));
  });

  it('stops a clean-device mutation before writes when the DB authority turns pending', async () => {
    getUser.mockResolvedValue(NOT_PENDING);
    getDeletionPending.mockResolvedValue(DB_NOT_PENDING);
    renderApp();
    await signIn();
    expect(await screen.findByText('HOME-PAGE-RENDERED')).toBeInTheDocument();

    callLog.length = 0;
    saveRecordToDB.mockClear();
    getDeletionPending.mockResolvedValue(DB_PENDING);
    await act(async () => { screen.getByText('add-record').click(); });

    expect(callLog).toContain('auth.getUser');
    expect(callLog).toContain('rpc:is_my_account_deletion_pending');
    expect(callLog).not.toContain('saveRecordToDB');
    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
  });

  it('4b - no elapsed time or retry count promotes unknown to clear', async () => {
    getUser.mockRejectedValue(new Error('offline'));
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('deletionStatus')).toHaveTextContent('unknown'));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => { screen.getByText('add-record').click(); });
      expect(screen.getByTestId('deletionStatus')).toHaveTextContent('unknown');
    }
    // Never stored, cached or serialized as `clear` -- and never persisted at all.
    const persisted = localStorage.getItem('gomsinlog.state.v2') || '{}';
    expect(persisted).not.toContain('deletion');
    expect(persisted).not.toContain('clear');
  });

  it('5 - a retry that finds pending aborts with NO writes applied and preserves recovery data', async () => {
    getUser.mockRejectedValue(new Error('offline'));
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('deletionStatus')).toHaveTextContent('unknown'));

    callLog.length = 0;
    saveRecordToDB.mockClear();
    getUser.mockResolvedValue(PENDING);
    await act(async () => { screen.getByText('add-record').click(); });

    const checkAt = callLog.indexOf('auth.getUser');
    expect(checkAt).toBeGreaterThanOrEqual(0);
    // ORDERING, not end state: a sync-then-reconcile implementation would reach
    // the same final screen and must still FAIL this assertion.
    const afterCheck = callLog.slice(checkAt + 1);
    expect(afterCheck.filter((entry) => (
      entry.startsWith('rpc:') && entry !== 'rpc:is_my_account_deletion_pending'
    ))).toEqual([]);
    expect(afterCheck).not.toContain('saveRecordToDB');
    expect(afterCheck).not.toContain('fetchRecordsResultFromDB');
    expect(afterCheck).not.toContain('fetchEventsResultFromDB');
    expect(afterCheck).not.toContain('fetchTripsResultFromDB');
    expect(afterCheck).not.toContain('deleteRecordFromDB');
    expect(afterCheck).not.toContain('saveEventToDB');
    expect(afterCheck).not.toContain('disconnectCoupleFromDB');
    expect(saveRecordToDB).not.toHaveBeenCalled();

    // Recovery is entered and routes are blocked without authorizing cleanup.
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null'))
      .toMatchObject({ version: 2, userId: 'user-a', phase: 'pending' });
    expect(await screen.findByText('탈퇴 처리를 확인하고 있어요')).toBeInTheDocument();

    // No deferred timer later delivers a write.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('5b - a mutation aborted by the gate reports its existing failure value', async () => {
    getUser.mockResolvedValue(PENDING);
    localStorage.clear();
    renderApp();
    await signIn();
    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('active'));
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });
});
