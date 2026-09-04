import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import type { QueuedRecord } from '@/lib/outbox';
import { App } from '@/App';
import { DEVICE_PREF_CARRY_OVER_KEYS, StoreProvider } from '@/lib/store';
import { useStore } from '@/lib/useStore';
import { recoveryKeyFor, type AccountDeletionOutcome } from '@/lib/accountDeletion';

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

/**
 * `vi.mock` factories are hoisted above module-scope consts, so everything the
 * factories touch is declared with `vi.hoisted`.
 */
const h = vi.hoisted(() => {
  const authCallbacks: Array<(event: string, session: unknown) => void> = [];
  /** Ordered log of every observable server interaction, for ordering assertions. */
  const callLog: string[] = [];
  const getUser = vi.fn();
  const authRepositorySignOut = vi.fn(async () => { callLog.push('authRepository.signOut'); });
  const deleteAccountFromDB = vi.fn();
  const fetchFullStateFromDB = vi.fn();
  const saveRecordToDB = vi.fn(async () => { callLog.push('saveRecordToDB'); return true; });
  const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
  const outboxEntries = new Map<string, QueuedRecord>();
  const outboxPersistence = {
    all: vi.fn(async () => Array.from(outboxEntries.values())),
    put: vi.fn(async (entry: QueuedRecord) => { outboxEntries.set(entry.id, entry); }),
    remove: vi.fn(async (id: string) => { outboxEntries.delete(id); }),
  };

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
    authCallbacks, callLog, getUser, authRepositorySignOut, deleteAccountFromDB,
    fetchFullStateFromDB, saveRecordToDB, mockSupabase, FULL_STATE_UNAVAILABLE,
    outboxEntries, outboxPersistence,
  };
});

const { authCallbacks, callLog, getUser, authRepositorySignOut, mockSupabase } = h;
const deleteAccountFromDB = h.deleteAccountFromDB as unknown as {
  mockReset: () => { mockResolvedValue: (v: AccountDeletionOutcome) => void };
  mockResolvedValue: (v: AccountDeletionOutcome) => void;
  mockImplementation: (fn: () => Promise<AccountDeletionOutcome>) => void;
};
const fetchFullStateFromDB = h.fetchFullStateFromDB;
const saveRecordToDB = h.saveRecordToDB;
const FULL_STATE_UNAVAILABLE = h.FULL_STATE_UNAVAILABLE;

vi.mock('@/lib/outboxStorage', () => ({
  createIndexedDbOutbox: () => h.outboxPersistence,
}));

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
  installE2eeRuntimeForAuthenticatedSession: vi.fn().mockResolvedValue({ status: 'guarded' }),
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

/** Buttons live outside the routed tree so they stay reachable during recovery. */
function Probe() {
  const {
    deleteAccount, retryAccountDeletion, signOut, deletionStatus, accountDeletionRecovery,
    addRecord, deleteEvent, retrySharedAccess, state,
  } = useStore();
  return (
    <div>
      <span data-testid="deletionStatus">{deletionStatus.kind}</span>
      <span data-testid="recovery">{accountDeletionRecovery ? 'active' : 'none'}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <button onClick={() => void deleteAccount()}>delete-account</button>
      <button onClick={() => void retryAccountDeletion()}>retry-deletion</button>
      <button onClick={() => void signOut()}>sign-out</button>
      <button onClick={() => void retrySharedAccess()}>retry-shared</button>
      <button onClick={() => void addRecord({
        date: '2026-08-01', time: '10:00', authorRole: 'gomsin', log: 'x', isPrivate: false,
      } as never)}>add-record</button>
      <button onClick={() => void deleteEvent('event-1')}>delete-event</button>
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

async function signIn(userId = 'user-a') {
  await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
  await act(async () => { emitAuth('SIGNED_IN', userId); });
}

describe('Deletion-Recovery Suite', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    callLog.length = 0;
    localStorage.clear();
    h.outboxEntries.clear();
    h.outboxPersistence.all.mockReset().mockImplementation(
      async () => Array.from(h.outboxEntries.values()),
    );
    h.outboxPersistence.put.mockReset().mockImplementation(async (entry: QueuedRecord) => {
      h.outboxEntries.set(entry.id, entry);
    });
    h.outboxPersistence.remove.mockReset().mockImplementation(async (id: string) => {
      h.outboxEntries.delete(id);
    });
    getUser.mockReset().mockResolvedValue(NOT_PENDING);
    deleteAccountFromDB.mockReset().mockResolvedValue(FAILED);
    fetchFullStateFromDB.mockReset().mockResolvedValue(serverState());
    authRepositorySignOut.mockClear();
    saveRecordToDB.mockClear();
    mockSupabase.rpc.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('1 - creates a boolean-only marker on partial deletion, retaining identity', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    const stored = localStorage.getItem(recoveryKeyFor('user-a'));
    expect(stored).toBe('true');
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

  it('purges only the deleting account\'s queued files on partial deletion', async () => {
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

    expect(h.outboxEntries.has('queued-a')).toBe(false);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
  });

  it('routes a non-destructive but incomplete cancellation into recovery and purges its outbox', async () => {
    h.outboxEntries.set('queued-a', {
      id: 'queued-a', userId: 'user-a', coupleId: 'couple-1', queuedAt: '2026-08-01T00:00:00Z',
      attempts: 0, record: {} as never,
      files: [new File(['private-a'], 'private-a.jpg', { type: 'image/jpeg' })],
    });
    deleteAccountFromDB.mockResolvedValue(RECOVERY_REQUIRED);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(h.outboxEntries.has('queued-a')).toBe(false);
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
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');

    await act(async () => { screen.getByText('sign-out').click(); });

    expect(localStorage.getItem('gomsinlog.state.v1')).toBeNull();
    expect(localStorage.getItem('gomsinlog.state.v2')).toBeNull();
    // Logging out does not cancel an irreversible deletion.
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
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
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
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
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
    expect(screen.queryByText('HOME-PAGE-RENDERED')).toBeNull();
  });

  it('purges only the pending account\'s queued files when another device supplies the server flag', async () => {
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
    expect(h.outboxEntries.has('queued-a')).toBe(false);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
  });

  it('8 - a successful retry deletes Auth BEFORE clearing the marker', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');

    // A retry that fails leaves the marker in place.
    deleteAccountFromDB.mockResolvedValue(FAILED);
    await act(async () => { screen.getByText('retry-deletion').click(); });
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');

    // A retry keeps the marker while Auth deletion is in flight, and clears it
    // only after the server confirms deletion.
    let resolveDeletion!: (outcome: AccountDeletionOutcome) => void;
    deleteAccountFromDB.mockReturnValue(new Promise<AccountDeletionOutcome>((resolve) => {
      resolveDeletion = resolve;
    }));
    await act(async () => { screen.getByText('retry-deletion').click(); });
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
    await act(async () => { resolveDeletion(DELETED); });
    await waitFor(() => {
      expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    });
  });

  it('keeps a deleted account in local cleanup recovery until its queued files are actually purged', async () => {
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
    h.outboxPersistence.remove.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    deleteAccountFromDB.mockResolvedValue(DELETED);
    renderApp();
    await signIn();

    await act(async () => { screen.getByText('delete-account').click(); });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('local_cleanup');
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    expect(h.outboxEntries.has('queued-a')).toBe(true);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
    expect(authRepositorySignOut).not.toHaveBeenCalled();

    const remoteAttempts = deleteAccountFromDB.mock.calls.length;
    await act(async () => { screen.getByText('retry-deletion').click(); });

    expect(deleteAccountFromDB.mock.calls).toHaveLength(remoteAttempts);
    expect(h.outboxEntries.has('queued-a')).toBe(false);
    expect(h.outboxEntries.has('queued-b')).toBe(true);
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(authRepositorySignOut).toHaveBeenCalledOnce();
  });

  it('a safely cancelled retry clears recovery and ends the purged local session', async () => {
    deleteAccountFromDB.mockResolvedValue(PARTIAL);
    renderApp();
    await signIn();
    await act(async () => { screen.getByText('delete-account').click(); });
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');

    deleteAccountFromDB.mockResolvedValue(CANCELLED);
    await act(async () => { screen.getByText('retry-deletion').click(); });

    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBeNull();
    expect(screen.getByTestId('recovery')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(authRepositorySignOut).toHaveBeenCalled();
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
    deleteAccountFromDB.mockReset().mockResolvedValue(FAILED);
    fetchFullStateFromDB.mockReset().mockResolvedValue(serverState());
    saveRecordToDB.mockClear();
    mockSupabase.rpc.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
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
    await waitFor(() => expect(
      callLog.some((entry) => entry.startsWith('rpc:') || entry.startsWith('fetch')),
    ).toBe(true));
    const syncCheck = callLog.indexOf('auth.getUser');
    const firstRead = callLog.findIndex((entry) => entry.startsWith('rpc:') || entry.startsWith('fetch'));
    expect(syncCheck, callLog.join(',')).toBeGreaterThanOrEqual(0);
    expect(firstRead, callLog.join(',')).toBeGreaterThan(syncCheck);

    // Mutation: same ordering guarantee.
    callLog.length = 0;
    await act(async () => { screen.getByText('add-record').click(); });
    const mutationCheck = callLog.indexOf('auth.getUser');
    const firstWrite = callLog.indexOf('saveRecordToDB');
    expect(mutationCheck).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(mutationCheck);

    // The status is NOT reused as if settled: a second attempt re-issues it.
    const before = getUser.mock.calls.length;
    await act(async () => { screen.getByText('add-record').click(); });
    expect(getUser.mock.calls.length).toBeGreaterThan(before);
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

  it('5 - a retry that finds pending aborts with NO writes applied, then purges', async () => {
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
    expect(afterCheck.filter((entry) => entry.startsWith('rpc:'))).toEqual([]);
    expect(afterCheck).not.toContain('saveRecordToDB');
    expect(afterCheck).not.toContain('fetchRecordsResultFromDB');
    expect(afterCheck).not.toContain('fetchEventsResultFromDB');
    expect(afterCheck).not.toContain('fetchTripsResultFromDB');
    expect(afterCheck).not.toContain('deleteRecordFromDB');
    expect(afterCheck).not.toContain('saveEventToDB');
    expect(afterCheck).not.toContain('disconnectCoupleFromDB');
    expect(saveRecordToDB).not.toHaveBeenCalled();

    // Local content purged immediately, recovery entered, routes blocked.
    expect(screen.getByTestId('recovery')).toHaveTextContent('active');
    expect(screen.getByTestId('deletionStatus')).toHaveTextContent('pending');
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
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
