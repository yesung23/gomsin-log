import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AppState } from '@/types';

/**
 * The lifecycle value the UI renders must follow the events that change it.
 *
 * `CoupleStatusBanner` keys entirely off `coupleLifecycle`, and it renders
 * NOTHING for `connected`. So any event that ends a couple space -- an explicit
 * disconnect, a revoked membership, a sign-out, an account switch -- must move
 * that value, or the banner stays silent about a workspace that no longer
 * exists and the user is left with an empty timeline and no explanation.
 *
 * Covers:
 *  - DEF-01 disconnect left `coupleLifecycle` stale at `connected`.
 *  - DEF-02 lifecycle/expiry survived sign-out and account switch, so account
 *    A's verdict was rendered for account B.
 *  - DEF-03 the `disconnected` copy was unreachable, because the purge clears
 *    the local `coupleId` the derivation needs as evidence, so the next
 *    authoritative read said `personal` -- "create a space" to someone who
 *    just lost one.
 */

type AuthCallback = (
  event: string,
  session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null,
) => void;

const authCallbacks: AuthCallback[] = [];

const mockSupabase = {
  auth: {
    onAuthStateChange: (cb: AuthCallback) => {
      authCallbacks.push(cb);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn(),
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

const disconnectCoupleFromDB = vi.fn().mockResolvedValue(true);
const fetchMyCoupleState = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: vi.fn().mockResolvedValue(undefined) },
  disconnectCoupleFromDB,
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

vi.mock('@/lib/records', () => ({
  saveRecordToDB: vi.fn().mockResolvedValue({ ok: true }),
  deleteRecordFromDB: vi.fn().mockResolvedValue({ ok: true }),
  fetchRecordsFromDB: vi.fn().mockResolvedValue([]),
  fetchRecordsResultFromDB: vi.fn().mockResolvedValue({ ok: true, records: [] }),
  uploadRecordMedia: vi.fn(),
  removeRecordMedia: vi.fn(),
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: () => ({ error: 'unsupported' }),
  isCanonicalRecordMediaPath: () => false,
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

function Probe() {
  const {
    state,
    isReady,
    coupleLifecycle,
    invitationExpiresAt,
    disconnect,
    signOut,
    refreshCoupleLifecycle,
  } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="lifecycle">{coupleLifecycle}</span>
      <span data-testid="expiry">{invitationExpiresAt ?? 'none'}</span>
      <span data-testid="couple">{state.profile.couple.coupleId ?? 'none'}</span>
      <span data-testid="user">{state.authenticatedUser?.id ?? 'none'}</span>
      <button onClick={() => void disconnect()}>disconnect</button>
      <button onClick={() => void signOut()}>signout</button>
      <button onClick={() => void refreshCoupleLifecycle()}>refresh</button>
    </div>
  );
}

function emitAuth(event: string, userId: string | null) {
  const session = userId
    ? { user: { id: userId, email: `${userId}@example.com`, app_metadata: { provider: 'google' } } }
    : null;
  authCallbacks.forEach((cb) => cb(event, session));
}

const EXPIRY = '2026-09-01T00:00:00.000Z';

function connectedServerState(coupleId: string, name: string): Partial<AppState> {
  return {
    setupComplete: true,
    records: [],
    events: [],
    trips: [],
    profile: {
      myName: name,
      role: 'gomsin',
      couple: {
        coupleId,
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    } as never,
  };
}

function remoteConnected(coupleId: string) {
  return {
    ok: true as const,
    state: {
      coupleId,
      role: 'gomsin',
      memberStatus: 'active',
      partnerPresent: true,
      invitationActive: false,
      invitationExpiresAt: null,
    },
  };
}

/** Server answer for an account that is definitely in no couple space. */
const REMOTE_NO_SPACE = { ok: true as const, state: null };

async function mountConnectedAccountA() {
  fetchFullStateFromDB.mockImplementation(async (userId: string) =>
    userId === 'user-a' ? connectedServerState('couple-1', '춘향') : null,
  );
  fetchMyCoupleState.mockResolvedValue(remoteConnected('couple-1'));

  render(<StoreProvider><Probe /></StoreProvider>);
  await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
  await act(async () => emitAuth('SIGNED_IN', 'user-a'));
  await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
  await waitFor(() => expect(screen.getByTestId('lifecycle')).toHaveTextContent('connected'));
}

describe('couple lifecycle transitions', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    localStorage.clear();
    fetchFullStateFromDB.mockReset();
    mockSupabase.channel.mockClear();
    mockSupabase.removeChannel.mockClear();
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    mockSupabase.auth.getUser.mockReset().mockResolvedValue({
      data: { user: { id: 'user-a', app_metadata: { provider: 'google' } } },
      error: null,
    });
    fetchMyCoupleState.mockReset().mockResolvedValue({ ok: false, reason: 'server' });
    disconnectCoupleFromDB.mockReset().mockResolvedValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // DEF-01
  it('moves the lifecycle off connected as soon as a disconnect is confirmed', async () => {
    await mountConnectedAccountA();

    await act(async () => {
      screen.getByText('disconnect').click();
    });

    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    // `connected` renders no banner at all, so leaving it here is what silently
    // emptied the timeline with no explanation and no reconnect route.
    // Compared exactly: `disconnected` CONTAINS `connected` as a substring.
    expect(screen.getByTestId('lifecycle').textContent).not.toBe('connected');
    expect(screen.getByTestId('lifecycle').textContent).toBe('disconnected');
  });

  // DEF-01: the same must hold when the partner disconnects remotely and this
  // device only learns about it through membership reconciliation.
  it('moves the lifecycle off connected when the membership is revoked remotely', async () => {
    await mountConnectedAccountA();
    const channel = mockSupabase.channel.mock.results[0].value as {
      on: ReturnType<typeof vi.fn>;
    };
    const membershipCall = channel.on.mock.calls.find(
      (call) => (call[1] as { table?: string } | undefined)?.table === 'couple_members',
    );
    expect(membershipCall).toBeDefined();

    await act(async () => {
      (membershipCall?.[2] as (payload: unknown) => void)?.({});
    });

    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    expect(screen.getByTestId('lifecycle')).toHaveTextContent('disconnected');
  });

  // DEF-01: the invitation expiry belongs to the space that was just revoked.
  it('drops the invitation expiry when the couple space is purged', async () => {
    fetchFullStateFromDB.mockImplementation(async () => ({
      setupComplete: true,
      records: [],
      events: [],
      trips: [],
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: {
          coupleId: 'couple-1',
          partnerName: '',
          coupleCode: '123456',
          connected: false,
          status: 'pending',
        },
        military: {} as never,
        contact: {} as never,
      } as never,
    }));
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-1',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: false,
        invitationActive: true,
        invitationExpiresAt: EXPIRY,
      },
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('expiry')).toHaveTextContent(EXPIRY));

    await act(async () => {
      screen.getByText('disconnect').click();
    });

    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));
    expect(screen.getByTestId('expiry')).toHaveTextContent('none');
  });

  // DEF-03
  it('keeps saying disconnected after the purge, instead of inviting the user to create a space', async () => {
    await mountConnectedAccountA();

    await act(async () => {
      screen.getByText('disconnect').click();
    });
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('none'));

    // The purge cleared the local `coupleId`, so the next authoritative read has
    // no local evidence left and used to derive `personal`.
    fetchMyCoupleState.mockResolvedValue(REMOTE_NO_SPACE);
    await act(async () => {
      screen.getByText('refresh').click();
    });

    await waitFor(() => expect(screen.getByTestId('lifecycle')).toHaveTextContent('disconnected'));
  });

  // DEF-03: the revocation marker must not outlive the space being replaced.
  it('returns to a positive lifecycle once a new couple space exists', async () => {
    await mountConnectedAccountA();
    await act(async () => {
      screen.getByText('disconnect').click();
    });
    await waitFor(() => expect(screen.getByTestId('lifecycle')).toHaveTextContent('disconnected'));

    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-2',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: false,
        invitationActive: true,
        invitationExpiresAt: EXPIRY,
      },
    });
    await act(async () => {
      screen.getByText('refresh').click();
    });
    await waitFor(() => expect(screen.getByTestId('lifecycle')).toHaveTextContent('pending'));

    // And a later definite "no space" for that NEW couple is genuinely personal,
    // because the revoked-space marker was consumed by the reconnect.
    fetchMyCoupleState.mockResolvedValue(REMOTE_NO_SPACE);
    await act(async () => {
      screen.getByText('refresh').click();
    });
    await waitFor(() => expect(screen.getByTestId('lifecycle')).toHaveTextContent('disconnected'));
  });

  // DEF-02
  it('resets the lifecycle and the expiry to unknown when the account switches', async () => {
    fetchFullStateFromDB.mockImplementation(async (userId: string) =>
      userId === 'user-a' ? connectedServerState('couple-1', '춘향') : null,
    );
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-1',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: true,
        invitationActive: true,
        invitationExpiresAt: EXPIRY,
      },
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('lifecycle')).toHaveTextContent('connected'));
    expect(screen.getByTestId('expiry')).toHaveTextContent(EXPIRY);

    // Account B's own answer never resolves, so whatever is on screen during its
    // hydration window is account A's verdict unless it was cleared.
    let lifecycleDuringSwitch = '';
    let expiryDuringSwitch = '';
    fetchMyCoupleState.mockImplementation(() => new Promise(() => {}));
    fetchFullStateFromDB.mockImplementation(async () => {
      lifecycleDuringSwitch = screen.getByTestId('lifecycle').textContent ?? '';
      expiryDuringSwitch = screen.getByTestId('expiry').textContent ?? '';
      return null;
    });

    await act(async () => emitAuth('SIGNED_IN', 'user-b'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-b'));

    expect(lifecycleDuringSwitch).toBe('unknown');
    expect(expiryDuringSwitch).toBe('none');
    expect(screen.getByTestId('lifecycle')).toHaveTextContent('unknown');
    expect(screen.getByTestId('expiry')).toHaveTextContent('none');
  });

  // DEF-02
  it('resets the lifecycle and the expiry to unknown on sign-out', async () => {
    fetchFullStateFromDB.mockImplementation(async () => connectedServerState('couple-1', '춘향'));
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-1',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: true,
        invitationActive: true,
        invitationExpiresAt: EXPIRY,
      },
    });

    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
    await act(async () => emitAuth('SIGNED_IN', 'user-a'));
    await waitFor(() => expect(screen.getByTestId('lifecycle')).toHaveTextContent('connected'));

    await act(async () => emitAuth('SIGNED_OUT', null));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(screen.getByTestId('lifecycle')).toHaveTextContent('unknown');
    expect(screen.getByTestId('expiry')).toHaveTextContent('none');
  });
});
