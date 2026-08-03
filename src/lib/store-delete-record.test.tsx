import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AppState, DailyRecord } from '@/types';

type AuthCallback = (event: string, session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null) => void;

const authCallbacks: AuthCallback[] = [];
const unsubscribe = vi.fn();
const createdChannels: Array<{ name: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }> = [];

const mockSupabase = {
  auth: {
    onAuthStateChange: (cb: AuthCallback) => {
      authCallbacks.push(cb);
      return { data: { subscription: { unsubscribe } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
  },
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
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    upsert: () => Promise.resolve({ error: null }),
  }),
};

const disconnectCoupleFromDB = vi.fn().mockResolvedValue(true);
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
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
  // Read-only lifecycle probe.
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

const callOrder: string[] = [];
const saveRecordToDB = vi.fn(async () => {
  callOrder.push('saveRecord');
  return { ok: true as const };
});
const deleteRecordFromDB = vi.fn(async () => {
  callOrder.push('deleteRecordFromDB');
  return { ok: true as const };
});
const removeRecordMedia = vi.fn(async () => {
  callOrder.push('removeRecordMedia');
});

const fetchRecordsResultFromDB = vi.fn(async () => ({ ok: true, records: [] }));

vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => saveRecordToDB(...(args as [])),
  deleteRecordFromDB: (...args: unknown[]) => deleteRecordFromDB(...(args as [])),
  fetchRecordsFromDB: vi.fn(async () => []),
  fetchRecordsResultFromDB: (...args: unknown[]) => fetchRecordsResultFromDB(...(args as [])),
  uploadRecordMedia: vi.fn(async (file: File) => ({ attachment: { type: 'photo' as const, name: file.name, path: `c/r/${file.name}` } })),
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

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');
const STORE_KEY = 'gomsinlog.state.v2';

// The store now returns a classified result, so these hold `ok` plus the
// reason: a failure must be attributable, not merely false.
let lastDeleteResult: boolean | null = null;
let lastUpdateResult: boolean | null = null;
let lastDeleteReason: string | null = null;
let lastUpdateReason: string | null = null;

function Probe() {
  const { state, isReady, deleteRecord, updateRecord } = useStore();
  const updateRecordOk = async (id: string, updates: Parameters<typeof updateRecord>[1]) => {
    const result = await updateRecord(id, updates);
    lastUpdateReason = result.ok ? null : result.reason;
    return result.ok;
  };
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="records">{state.records.map((r) => r.id).join(',')}</span>
      <span data-testid="emotionFlow">{JSON.stringify(state.records.find((r) => r.id === 'rec-1')?.emotionFlow ?? null)}</span>
      <span data-testid="emotionUpdatedAt">{state.records.find((r) => r.id === 'rec-1')?.emotionUpdatedAt ?? 'null'}</span>
      <span data-testid="log">{state.records.find((r) => r.id === 'rec-1')?.log ?? ''}</span>
      <button
        data-testid="delete-rec1"
        onClick={async () => {
          const result = await deleteRecord('rec-1');
          lastDeleteResult = result.ok;
          lastDeleteReason = result.ok ? null : result.reason;
        }}
      />
      <button
        data-testid="update-text-changed"
        onClick={async () => {
          lastUpdateResult = await updateRecordOk('rec-1', {
            log: 'changed text',
            emotionFlow: [],
            emotionUpdatedAt: null,
          });
        }}
      />
      <button
        data-testid="update-text-same"
        onClick={async () => {
          lastUpdateResult = await updateRecordOk('rec-1', {
            log: 'hello',
          });
        }}
      />
    </div>
  );
}

function buildConnectedState(records: DailyRecord[] = []): Partial<AppState> {
  return {
    setupComplete: true,
    isDemoMode: false,
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
    records,
    events: [],
    trips: [],
    widgetLayout: [],
    hasSeenInstallPrompt: false,
    theme: 'light',
  };
}

describe('deleteRecord with storage cleanup', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    createdChannels.length = 0;
    callOrder.length = 0;
    lastDeleteResult = null;
    lastUpdateResult = null;
    lastDeleteReason = null;
    lastUpdateReason = null;
    removeRecordMedia.mockReset();
    removeRecordMedia.mockImplementation(async () => { callOrder.push('removeRecordMedia'); });
    // The shared setup's `vi.restoreAllMocks()` strips implementations, so the
    // read-only lifecycle probe is re-armed here. Default: no couple space known,
    // so no test silently gains a server-supplied workspace.
    fetchMyCoupleState.mockReset();
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server' });
    deleteRecordFromDB.mockReset();
    deleteRecordFromDB.mockImplementation(async () => { callOrder.push('deleteRecordFromDB'); return { ok: true as const }; });
    saveRecordToDB.mockReset();
    saveRecordToDB.mockImplementation(async () => { callOrder.push('saveRecord'); return { ok: true as const }; });
    localStorage.clear();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: {} } } });
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function setup(records: DailyRecord[]) {
    const stateWithRecords = buildConnectedState(records);
    localStorage.setItem(STORE_KEY, JSON.stringify(stateWithRecords));
    fetchFullStateFromDB.mockResolvedValue(stateWithRecords);

    const { unmount } = render(
      <StoreProvider><Probe /></StoreProvider>,
    );

    // Wait for auth callbacks to be registered
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));

    // Fire auth to hydrate
    await act(async () => {
      authCallbacks.forEach((cb) =>
        cb('SIGNED_IN', { user: { id: 'user-1', email: 'a@b.com', app_metadata: {} } }),
      );
    });
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
    return unmount;
  }

  it('cleans up storage objects then deletes the DB row', async () => {
    const records: DailyRecord[] = [{
      id: 'rec-1',
      userId: 'user-1',
      date: '2026-01-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'hello',
      isPrivate: false,
      attachments: [
        { type: 'photo', name: 'img.jpg', path: 'couple-1/rec-1/abc.jpg' },
      ],
      createdAt: '2026-01-01T10:00:00.000Z',
    }];
    await setup(records);

    await act(async () => {
      screen.getByTestId('delete-rec1').click();
    });
    await waitFor(() => expect(lastDeleteResult).toBe(true));

    // Storage cleanup happens BEFORE the DB delete
    expect(callOrder).toEqual(['removeRecordMedia', 'deleteRecordFromDB']);
    expect(removeRecordMedia).toHaveBeenCalledWith(['couple-1/rec-1/abc.jpg']);
    expect(screen.getByTestId('records').textContent).toBe('');
  });

  it('aborts delete if storage cleanup fails', async () => {
    removeRecordMedia.mockReset();
    removeRecordMedia.mockRejectedValue(new Error('Storage error'));

    const records: DailyRecord[] = [{
      id: 'rec-1',
      userId: 'user-1',
      date: '2026-01-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'hello',
      isPrivate: false,
      attachments: [
        { type: 'photo', name: 'img.jpg', path: 'couple-1/rec-1/abc.jpg' },
      ],
      createdAt: '2026-01-01T10:00:00.000Z',
    }];
    await setup(records);

    await act(async () => {
      screen.getByTestId('delete-rec1').click();
    });
    await waitFor(() => expect(lastDeleteResult).toBe(false));

    // DB delete should NOT have been called
    expect(deleteRecordFromDB).not.toHaveBeenCalled();
    // Record should still be present
    expect(screen.getByTestId('records').textContent).toBe('rec-1');
  });

  it('skips non-canonical paths during storage cleanup', async () => {
    const records: DailyRecord[] = [{
      id: 'rec-1',
      userId: 'user-1',
      date: '2026-01-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'hello',
      isPrivate: false,
      attachments: [
        { type: 'photo', name: 'img.jpg', path: 'couple-1/rec-1/abc.jpg' },
        { type: 'photo', name: 'bad.jpg', path: '../../../etc/passwd' },
      ],
      createdAt: '2026-01-01T10:00:00.000Z',
    }];
    await setup(records);

    await act(async () => {
      screen.getByTestId('delete-rec1').click();
    });
    await waitFor(() => expect(lastDeleteResult).toBe(true));

    // Only the canonical path should be cleaned up
    expect(removeRecordMedia).toHaveBeenCalledWith(['couple-1/rec-1/abc.jpg']);
  });

  it('succeeds when record has no attachments (no storage cleanup needed)', async () => {
    const records: DailyRecord[] = [{
      id: 'rec-1',
      userId: 'user-1',
      date: '2026-01-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'hello',
      isPrivate: false,
      createdAt: '2026-01-01T10:00:00.000Z',
    }];
    await setup(records);

    await act(async () => {
      screen.getByTestId('delete-rec1').click();
    });
    await waitFor(() => expect(lastDeleteResult).toBe(true));

    // No storage cleanup, just DB delete
    expect(removeRecordMedia).not.toHaveBeenCalled();
    expect(deleteRecordFromDB).toHaveBeenCalled();
    expect(screen.getByTestId('records').textContent).toBe('');
  });
});

describe('updateRecord emotion clearing on text change', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    createdChannels.length = 0;
    callOrder.length = 0;
    lastDeleteResult = null;
    lastUpdateResult = null;
    lastDeleteReason = null;
    lastUpdateReason = null;
    removeRecordMedia.mockReset();
    removeRecordMedia.mockImplementation(async () => { callOrder.push('removeRecordMedia'); });
    deleteRecordFromDB.mockReset();
    deleteRecordFromDB.mockImplementation(async () => { callOrder.push('deleteRecordFromDB'); return { ok: true as const }; });
    saveRecordToDB.mockReset();
    saveRecordToDB.mockImplementation(async () => { callOrder.push('saveRecord'); return { ok: true as const }; });
    localStorage.clear();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: {} } } });
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function setup(records: DailyRecord[]) {
    const stateWithRecords = buildConnectedState(records);
    localStorage.setItem(STORE_KEY, JSON.stringify(stateWithRecords));
    fetchFullStateFromDB.mockResolvedValue(stateWithRecords);

    const { unmount } = render(
      <StoreProvider><Probe /></StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));

    await act(async () => {
      authCallbacks.forEach((cb) =>
        cb('SIGNED_IN', { user: { id: 'user-1', email: 'a@b.com', app_metadata: {} } }),
      );
    });
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
    return unmount;
  }

  it('clears emotionFlow and emotionUpdatedAt when text changes', async () => {
    const records: DailyRecord[] = [{
      id: 'rec-1',
      userId: 'user-1',
      date: '2026-01-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'hello',
      isPrivate: false,
      emotionFlow: [{ id: 'e1', sequence: 1, group: 'joy', displayLabel: '기쁨', source: 'user_confirmed', visibility: 'shared' }],
      emotionUpdatedAt: '2026-01-01T10:00:00.000Z',
      createdAt: '2026-01-01T10:00:00.000Z',
    }];
    await setup(records);

    // Verify initial state has emotions
    expect(screen.getByTestId('emotionFlow').textContent).toContain('e1');
    expect(screen.getByTestId('emotionUpdatedAt').textContent).not.toBe('null');

    await act(async () => {
      screen.getByTestId('update-text-changed').click();
    });
    await waitFor(() => expect(lastUpdateResult).toBe(true));

    // emotionFlow should be cleared
    expect(screen.getByTestId('emotionFlow').textContent).toBe('[]');
    expect(screen.getByTestId('emotionUpdatedAt').textContent).toBe('null');
    expect(screen.getByTestId('log').textContent).toBe('changed text');
  });

  it('preserves emotionFlow when text does not change', async () => {
    const records: DailyRecord[] = [{
      id: 'rec-1',
      userId: 'user-1',
      date: '2026-01-01',
      time: '10:00',
      authorRole: 'gomsin',
      log: 'hello',
      isPrivate: false,
      emotionFlow: [{ id: 'e1', sequence: 1, group: 'joy', displayLabel: '기쁨', source: 'user_confirmed', visibility: 'shared' }],
      emotionUpdatedAt: '2026-01-01T10:00:00.000Z',
      createdAt: '2026-01-01T10:00:00.000Z',
    }];
    await setup(records);

    await act(async () => {
      screen.getByTestId('update-text-same').click();
    });
    await waitFor(() => expect(lastUpdateResult).toBe(true));

    // emotionFlow should be preserved since text didn't change
    expect(screen.getByTestId('emotionFlow').textContent).toContain('e1');
    expect(screen.getByTestId('emotionUpdatedAt').textContent).not.toBe('null');
    expect(screen.getByTestId('log').textContent).toBe('hello');
  });
});
