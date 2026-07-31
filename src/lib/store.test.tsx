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
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
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

vi.mock('@/lib/records', () => ({
  saveRecordToDB: vi.fn().mockResolvedValue(true),
  deleteRecordFromDB: vi.fn().mockResolvedValue(true),
}));

const { StoreProvider, useStore } = await import('@/lib/store');
const STORE_KEY = 'gomsinlog.state.v2';

function Probe() {
  const { state, isReady, signOut } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="demo">{String(state.isDemoMode)}</span>
      <span data-testid="setup">{String(state.setupComplete)}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <span data-testid="name">{state.profile.myName}</span>
      <span data-testid="records">{state.records.map((r) => r.id).join(',')}</span>
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
