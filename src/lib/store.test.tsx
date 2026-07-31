import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AppState } from '@/types';

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
  // Supports the chained .on().on().on().subscribe() builder the store uses.
  channel: () => {
    const chainable = {
      on: () => chainable,
      subscribe: () => chainable,
    };
    return chainable;
  },
  removeChannel: vi.fn(),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  from: () => ({
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    upsert: () => Promise.resolve({ error: null }),
  }),
};

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: vi.fn().mockResolvedValue(undefined) },
  disconnectCoupleFromDB: vi.fn().mockResolvedValue(true),
  deleteAccountFromDB: vi.fn().mockResolvedValue(true),
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
}));

const fetchFullStateFromDB = vi.fn();
vi.mock('@/lib/sync', () => ({
  fetchFullStateFromDB: (userId: string) => fetchFullStateFromDB(userId),
}));

/** Ordered log of media-related calls, used to assert the two-phase upload flow. */
const callOrder: string[] = [];
const saveRecordToDB = vi.fn(async () => {
  callOrder.push('saveRecord');
  return true;
});
const uploadRecordMedia = vi.fn(async (file: File) => {
  callOrder.push(`upload:${file.name}`);
  return { attachment: { type: 'photo' as const, name: file.name, path: `c/r/${file.name}` } };
});
const removeRecordMedia = vi.fn(async () => {
  callOrder.push('removeMedia');
});

const fetchRecordsFromDB = vi.fn(async () => []);

vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => saveRecordToDB(...(args as [])),
  deleteRecordFromDB: vi.fn().mockResolvedValue(true),
  fetchRecordsFromDB: (...args: unknown[]) => fetchRecordsFromDB(...(args as [])),
  uploadRecordMedia: (...args: unknown[]) => uploadRecordMedia(...(args as [File])),
  removeRecordMedia: (...args: unknown[]) => removeRecordMedia(...(args as [])),
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: (file: { type: string }) =>
    file.type.startsWith('image/')
      ? { ext: 'png', type: 'photo' }
      : { error: 'unsupported' },
}));

vi.mock('@/lib/events', () => ({
  fetchEventsFromDB: vi.fn().mockResolvedValue([]),
  saveEventToDB: vi.fn().mockResolvedValue(true),
  deleteEventFromDB: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/trips', () => ({
  fetchTripsFromDB: vi.fn().mockResolvedValue([]),
}));

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');
const STORE_KEY = 'gomsinlog.state.v2';

let lastMediaResult: { ok: boolean; failedFiles: string[]; error?: string } | null = null;

function Probe({ files = [] as File[] }: { files?: File[] }) {
  const { state, isReady, signOut, addRecordWithMedia } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="demo">{String(state.isDemoMode)}</span>
      <span data-testid="setup">{String(state.setupComplete)}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <span data-testid="name">{state.profile.myName}</span>
      <span data-testid="records">{state.records.map((r) => r.id).join(',')}</span>
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
    localStorage.clear();
    fetchFullStateFromDB.mockReset();
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
    expect(screen.getByTestId('demo')).toHaveTextContent('false');
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
    // Signed in, but no server profile could be loaded -> must go through onboarding
    // rather than render stale content.
    expect(screen.getByTestId('user')).toHaveTextContent('user-a');
    expect(screen.getByTestId('setup')).toHaveTextContent('false');
  });

  it('does not leak the previous account\'s records when switching accounts', async () => {
    fetchFullStateFromDB.mockImplementation(async (userId: string) =>
      userId === 'user-a'
        ? serverState({
            records: [{ id: 'rec-a', date: '2026-07-31', time: '10:00', authorRole: 'gomsin', log: 'A', isPrivate: false, createdAt: 'x' }] as never,
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

    // Account B has no profile row yet; account A's cached records must not survive.
    await act(async () => {
      emitAuth('SIGNED_IN', 'user-b');
    });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));
    expect(screen.getByTestId('records')).toHaveTextContent('');
    expect(screen.getByTestId('name')).toHaveTextContent('');
  });

  it('keeps an explicitly started demo session across a reload', async () => {
    const demoState: Partial<AppState> = {
      setupComplete: true,
      isDemoMode: true,
      profile: { myName: '춘향', role: 'gomsin', couple: { partnerName: '몽룡', coupleCode: '123456', connected: true, status: 'active' }, military: {} as never, contact: {} as never } as never,
      records: [{ id: 'demo-1', date: '2026-07-31', time: '09:00', authorRole: 'gomsin', log: 'demo', isPrivate: false, createdAt: 'x' }] as never,
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(demoState));

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
    expect(screen.getByTestId('demo')).toHaveTextContent('true');
    expect(screen.getByTestId('setup')).toHaveTextContent('true');
    expect(screen.getByTestId('records')).toHaveTextContent('demo-1');
  });

  it('resets to a signed-out state when there is no session and no demo', async () => {
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
    expect(screen.getByTestId('demo')).toHaveTextContent('false');
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
    expect(lastMediaResult?.error).toBeTruthy();
    expect(screen.getByTestId('records')).toHaveTextContent('');
  });

  it('does not persist session-only blob URLs to localStorage', async () => {
    const demoState: Partial<AppState> = {
      setupComplete: true,
      isDemoMode: true,
      profile: { myName: '춘향', role: 'gomsin', couple: { partnerName: '몽룡', coupleCode: '123456', connected: true, status: 'active' }, military: {} as never, contact: {} as never } as never,
      records: [],
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(demoState));

    render(
      <StoreProvider>
        <Probe files={[new File(['a'], 'demo.png', { type: 'image/png' })]} />
      </StoreProvider>,
    );

    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => {
      emitAuth('INITIAL_SESSION', null);
    });
    await waitFor(() => expect(screen.getByTestId('demo')).toHaveTextContent('true'));

    await act(async () => {
      screen.getByText('post').click();
    });
    await waitFor(() => expect(screen.getByTestId('attachments')).toHaveTextContent('demo.png'));

    // Visible in-session, but a persisted blob: URL would render as a broken
    // image after reload, so the preview-only attachment is dropped from the cache.
    await waitFor(() => {
      const cached = localStorage.getItem(STORE_KEY) || '';
      expect(cached).not.toContain('blob:');
      expect(cached).not.toContain('demo.png');
      // The written text itself is still cached.
      expect(cached).toContain('오늘의 기록');
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
});
