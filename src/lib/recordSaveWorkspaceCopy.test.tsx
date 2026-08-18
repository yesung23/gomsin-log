import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

/**
 * PRIORITY 1, the couple-state half.
 *
 * The product owner reported that writing a diary entry said there was no
 * internet connection. One of the three candidate causes was the couple-state
 * read: migrations 016 and 017 are not applied on the operator's project, so
 * `get_my_couple_state` does not exist server-side and answers `PGRST202` -- and
 * the record-save path resolves the workspace through exactly that RPC whenever
 * the local `coupleId` is missing (a failed hydration or an abandoned onboarding
 * is enough).
 *
 * So an undeployed RPC can block saving for a user whose couple space is
 * perfectly fine. What it must never do is describe that as a connection
 * problem, and it must not tell the user to "try again shortly" for a state no
 * amount of retrying can change.
 *
 * Every arm below drives the REAL store through `addRecordWithMedia` with no
 * local `coupleId`, so `resolveWorkspaceOnDemand` is genuinely exercised.
 */

const CONNECTION_PHRASES = ['인터넷', '오프라인', '연결을 확인', '와이파이'] as const;

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

const fetchMyCoupleState = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: vi.fn().mockResolvedValue(undefined) },
  disconnectCoupleFromDB: vi.fn().mockResolvedValue(true),
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

const saveRecordToDB = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => saveRecordToDB(...(args as [])),
  deleteRecordFromDB: vi.fn().mockResolvedValue({ ok: true }),
  fetchRecordsFromDB: vi.fn(async () => []),
  fetchRecordsResultFromDB: vi.fn(async () => ({ ok: true, records: [] })),
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

let lastResult: { ok: boolean; failedFiles: string[]; error?: string } | null = null;

function Probe() {
  const { isReady, addRecordWithMedia, state } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="couple">{state.profile.couple.coupleId ?? 'none'}</span>
      <button
        onClick={() => {
          void addRecordWithMedia(
            {
              date: '2026-07-31',
              time: '12:00',
              // The reported role.
              authorRole: 'gomsin',
              log: '오늘은 훈련이 길었지만 네 생각하니까 버틸 수 있었어.',
              isPrivate: false,
            },
            [],
          ).then((result) => { lastResult = result; });
        }}
      >
        post
      </button>
    </div>
  );
}

/**
 * Hydrate an authenticated 곰신 whose local couple id is missing.
 *
 * Hydration itself also probes the lifecycle RPC, so it is pinned to "could not
 * answer" here (which by contract leaves local state untouched) and each arm then
 * installs the answer it wants the SAVE to see. Otherwise an arm that returns a
 * couple id would adopt it during hydration and never reach the save path.
 */
async function mountWithoutLocalCoupleId() {
  fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server' });
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
  await act(async () => {
    authCallbacks.forEach((cb) => cb('INITIAL_SESSION', {
      user: { id: 'user-a', email: 'a@example.com', app_metadata: { provider: 'google' } },
    }));
  });
  await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
  // The precondition that makes the on-demand resolve the only way to save.
  expect(screen.getByTestId('couple')).toHaveTextContent('none');
}

async function save() {
  lastResult = null;
  await act(async () => { screen.getByText('post').click(); });
  await waitFor(() => expect(lastResult).not.toBeNull());
  return lastResult!;
}

describe('a record save whose workspace must be resolved on demand', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    localStorage.clear();
    lastResult = null;
    saveRecordToDB.mockClear();
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    mockSupabase.auth.getUser.mockReset().mockResolvedValue({
      data: { user: { id: 'user-a', app_metadata: { provider: 'google' } } },
      error: null,
    });
    fetchMyCoupleState.mockReset();
    // Hydrated, authenticated, and deliberately WITHOUT a couple id.
    fetchFullStateFromDB.mockReset().mockResolvedValue({
      setupComplete: true,
      records: [],
      events: [],
      trips: [],
      profile: {
        myName: '춘향',
        role: 'gomsin',
        couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' },
        military: {},
        contact: {},
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does NOT blame the connection when get_my_couple_state is undeployed', async () => {
    // PGRST202 classifies as `server`; this is the exact shape fetchMyCoupleState
    // returns for it, and the whole point is what the user is then told.
    await mountWithoutLocalCoupleId();
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server', schemaGap: true });

    const result = await save();

    expect(result.ok).toBe(false);
    expect(saveRecordToDB).not.toHaveBeenCalled();
    for (const phrase of CONNECTION_PHRASES) {
      expect(result.error, phrase).not.toContain(phrase);
    }
  });

  it('names the undeployed RPC as a server-side setup problem', async () => {
    await mountWithoutLocalCoupleId();
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server', schemaGap: true });

    const result = await save();

    // A user cannot fix an unapplied migration, so "잠시 후 다시 시도" would be a
    // lie about retryability as well as about the cause.
    expect(result.error).toContain('서버');
    expect(result.error).toContain('관리자');
    expect(result.error).not.toContain('잠시 후 다시 시도해 주세요');
    // And it must not invite the user to create a space they already own.
    expect(result.error).not.toContain('커플 공간을 만든');
  });

  it('keeps a genuine server failure on its own retryable message', async () => {
    // PRESERVATION: a 500 is not a deploy gap, and retrying it can genuinely work.
    await mountWithoutLocalCoupleId();
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server' });

    const result = await save();

    expect(result.error).toBe('지금 커플 공간을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.');
    for (const phrase of CONNECTION_PHRASES) {
      expect(result.error, phrase).not.toContain(phrase);
    }
  });

  it('does not blame the connection for an unreachable server either', async () => {
    await mountWithoutLocalCoupleId();
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'unreachable' });

    const result = await save();

    expect(result.ok).toBe(false);
    for (const phrase of CONNECTION_PHRASES) {
      expect(result.error, phrase).not.toContain(phrase);
    }
  });

  it('still says offline when the device is confirmed offline', async () => {
    // PRESERVATION: the contract forbids a FALSE diagnosis, not a true one.
    await mountWithoutLocalCoupleId();
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'offline' });

    const result = await save();

    expect(result.error).toContain('오프라인');
  });

  it('still tells a genuinely personal account to create a space', async () => {
    // PRESERVATION: an authoritative negative is a different answer entirely.
    await mountWithoutLocalCoupleId();
    fetchMyCoupleState.mockResolvedValue({ ok: true, state: null });

    const result = await save();

    expect(result.error).toBe('커플 공간을 만든 뒤에 기록을 남길 수 있어요.');
  });

  it('saves normally once the RPC does answer with a couple id', async () => {
    // PRESERVATION: the deploy-gap branch must not swallow the working case.
    await mountWithoutLocalCoupleId();
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

    const result = await save();

    expect(result.ok).toBe(true);
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
  });
});
