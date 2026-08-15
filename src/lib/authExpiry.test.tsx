import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

/**
 * Auth-expiry recovery and on-demand workspace resolution.
 *
 * Both behaviours exist because the same two failures used to be reported as a
 * broken internet connection:
 *
 *  - an expired JWT (`PGRST301` / 401), which is fully recoverable by one
 *    `refreshSession()`;
 *  - a membership that exists on the server but not in local state, which used to
 *    produce "create a couple space first" for a user who already owned one.
 */

const {
  mockSupabase,
  refreshSession,
  authRepositorySignOut,
  fetchFullStateResultFromDB,
  fetchMyCoupleState,
  saveRecordToDB,
  authCallbacks,
} = vi.hoisted(() => {
  const authCallbacks: ((event: string, session: unknown) => void)[] = [];
  const refreshSession = vi.fn();
  const authRepositorySignOut = vi.fn();
  const fetchFullStateResultFromDB = vi.fn();
  const fetchMyCoupleState = vi.fn();
  const saveRecordToDB = vi.fn();
  const channel = {
    on: vi.fn(function on() { return channel; }),
    subscribe: vi.fn(function subscribe() { return channel; }),
  };
  const mockSupabase = {
    auth: {
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        authCallbacks.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      getUser: vi.fn(),
      refreshSession,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(),
    rpc: vi.fn(),
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };
  return {
    mockSupabase,
    refreshSession,
    authRepositorySignOut,
    fetchFullStateResultFromDB,
    fetchMyCoupleState,
    saveRecordToDB,
    authCallbacks,
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: () => authRepositorySignOut() },
  disconnectCoupleFromDB: vi.fn().mockResolvedValue(true),
  deleteAccountFromDB: vi.fn().mockResolvedValue(true),
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
  fetchMyCoupleState: (...args: unknown[]) => fetchMyCoupleState(...(args as [])),
}));

const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
vi.mock('@/lib/sync', () => ({
  fetchFullStateFromDB: vi.fn(),
  fetchFullStateResultFromDB: (...args: unknown[]) => fetchFullStateResultFromDB(...(args as [])),
  FULL_STATE_UNAVAILABLE,
}));

vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => saveRecordToDB(...(args as [])),
  deleteRecordFromDB: vi.fn().mockResolvedValue({ ok: true }),
  fetchRecordsFromDB: vi.fn().mockResolvedValue([]),
  fetchRecordsResultFromDB: vi.fn().mockResolvedValue({ ok: true, records: [] }),
  uploadRecordMedia: vi.fn(),
  removeRecordMedia: vi.fn(),
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: () => ({ ext: 'png', type: 'photo' }),
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

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');

let lastRecordResult: { ok: boolean; error?: string } | null = null;

function Probe() {
  const {
    state,
    isReady,
    authSyncUnavailable,
    authSyncReason,
    coupleLifecycle,
    addRecordWithMedia,
  } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="authSync">{authSyncUnavailable ? 'unavailable' : 'available'}</span>
      <span data-testid="authReason">{authSyncReason ?? 'none'}</span>
      <span data-testid="lifecycle">{coupleLifecycle}</span>
      <span data-testid="couple">{state.profile.couple.coupleId ?? 'none'}</span>
      <span data-testid="name">{state.profile.myName}</span>
      <span data-testid="records">{state.records.map((r) => r.id).join(',')}</span>
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
            [],
          ).then((result) => { lastRecordResult = result; });
        }}
      >
        post
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

function serverState(coupleId?: string) {
  return {
    setupComplete: true,
    records: [],
    events: [],
    trips: [],
    profile: {
      id: 'user-a',
      myName: '춘향',
      role: 'gomsin',
      couple: coupleId
        ? { coupleId, partnerName: '', coupleCode: '', connected: false, status: 'pending' }
        : { partnerName: '', coupleCode: '', connected: false, status: 'pending' },
      military: {} as never,
      contact: {} as never,
    } as never,
  };
}

async function mount() {
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
}

describe('auth expiry recovery', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    localStorage.clear();
    lastRecordResult = null;
    refreshSession.mockReset();
    authRepositorySignOut.mockReset().mockResolvedValue(undefined);
    fetchFullStateResultFromDB.mockReset();
    fetchMyCoupleState.mockReset().mockResolvedValue({ ok: false, reason: 'server' });
    saveRecordToDB.mockReset().mockResolvedValue({ ok: true });
    mockSupabase.auth.getUser.mockReset().mockResolvedValue({
      data: { user: { id: 'user-a', app_metadata: { provider: 'google' } } },
      error: null,
    });
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refreshes the session exactly once and retries hydration on success', async () => {
    fetchFullStateResultFromDB
      .mockResolvedValueOnce({ ok: false, reason: 'auth_expired' })
      .mockResolvedValue({ ok: true, state: serverState('couple-1') });
    refreshSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } }, error: null });

    await mount();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    // The retry succeeded, so the user sees their account -- not an error screen.
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('춘향'));
    expect(screen.getByTestId('authSync')).toHaveTextContent('available');
    expect(screen.getByTestId('authReason')).toHaveTextContent('none');
    expect(authRepositorySignOut).not.toHaveBeenCalled();
  });

  it('signs out with the session cause when the refresh fails', async () => {
    fetchFullStateResultFromDB.mockResolvedValue({ ok: false, reason: 'auth_expired' });
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid refresh token' } });

    await mount();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(authRepositorySignOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('authReason')).toHaveTextContent('auth_expired'));
    // No account data is left rendered behind the failure.
    expect(screen.getByTestId('records')).toHaveTextContent('');
  });

  it('does not attempt a refresh for a cause that is not an auth loss', async () => {
    fetchFullStateResultFromDB.mockResolvedValue({ ok: false, reason: 'forbidden' });

    await mount();

    expect(refreshSession).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('authSync')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('authReason')).toHaveTextContent('forbidden');
  });

  it('reports lifecycle unknown, never personal, when hydration fails', async () => {
    fetchFullStateResultFromDB.mockResolvedValue({ ok: false, reason: 'unknown' });

    await mount();

    expect(screen.getByTestId('lifecycle')).toHaveTextContent('unknown');
    expect(screen.getByTestId('lifecycle')).not.toHaveTextContent('personal');
  });

  it('surfaces a Korean session message instead of a DB permission string', async () => {
    fetchFullStateResultFromDB.mockResolvedValue({ ok: true, state: serverState('couple-1') });
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'auth_expired' });
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'JWT expired' } });

    await mount();
    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(lastRecordResult).not.toBeNull());
    expect(lastRecordResult?.ok).toBe(false);
    expect(lastRecordResult?.error).toBe('세션이 만료되었어요. 다시 로그인해 주세요.');
    expect(lastRecordResult?.error).not.toContain('인터넷');
    expect(lastRecordResult?.error).not.toMatch(/permission|policy|PGRST|42501/i);
    // The central recovery path ran exactly once for the burst.
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe('on-demand workspace resolution', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    localStorage.clear();
    lastRecordResult = null;
    refreshSession.mockReset();
    authRepositorySignOut.mockReset().mockResolvedValue(undefined);
    fetchFullStateResultFromDB.mockReset()
      // No couple id in local state: the exact situation an abandoned onboarding
      // or a failed hydration leaves behind.
      .mockResolvedValue({ ok: true, state: serverState(undefined) });
    fetchMyCoupleState.mockReset();
    saveRecordToDB.mockReset().mockResolvedValue({ ok: true });
    mockSupabase.auth.getUser.mockReset().mockResolvedValue({
      data: { user: { id: 'user-a', app_metadata: { provider: 'google' } } },
      error: null,
    });
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('saves the record after resolving membership from the server', async () => {
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-9',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: false,
        invitationActive: true,
        invitationExpiresAt: '2026-08-01T00:00:00.000Z',
      },
    });

    await mount();
    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(lastRecordResult).not.toBeNull());
    expect(lastRecordResult?.ok).toBe(true);
    // The resolved workspace is what the write was scoped to.
    expect(saveRecordToDB).toHaveBeenCalledWith(
      expect.objectContaining({ log: '오늘의 기록' }),
      'couple-9',
      'user-a',
      { kind: 'create' },
    );
    await waitFor(() => expect(screen.getByTestId('couple')).toHaveTextContent('couple-9'));
    expect(screen.getByTestId('lifecycle')).toHaveTextContent('pending');
  });

  it('returns a retryable message and writes nothing when membership is unresolved', async () => {
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server' });

    await mount();
    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(lastRecordResult).not.toBeNull());
    expect(lastRecordResult?.ok).toBe(false);
    expect(lastRecordResult?.error).toBe('지금 커플 공간을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.');
    // Not the create-a-space message: that would be a lie.
    expect(lastRecordResult?.error).not.toContain('커플 공간을 만든 뒤에');
    expect(lastRecordResult?.error).not.toContain('인터넷');
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('keeps the personal-mode message for an authoritative no-membership answer', async () => {
    fetchMyCoupleState.mockResolvedValue({ ok: true, state: null });

    await mount();
    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(lastRecordResult).not.toBeNull());
    expect(lastRecordResult?.error).toBe('커플 공간을 만든 뒤에 기록을 남길 수 있어요.');
    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(screen.getByTestId('lifecycle')).toHaveTextContent('personal');
  });

  it('reports the offline cause without attempting the write', async () => {
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'offline' });

    await mount();
    await act(async () => {
      screen.getByText('post').click();
    });

    await waitFor(() => expect(lastRecordResult).not.toBeNull());
    expect(lastRecordResult?.error).toContain('오프라인');
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });
});
