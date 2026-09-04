import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { AppState } from '@/types';

/**
 * When the app may put the partner's invitation down.
 *
 * `clear_my_unseen()` means "someone is here, do not invite them back to what
 * they are looking at", and 053 made it move `notified_through` as well -- the
 * boundary that decides which acts are still pending. So calling it while the
 * partner's records are NOT on screen does not merely skip one notification: it
 * moves the boundary past acts the person never saw, and nothing raises the flag
 * again until the partner writes something new.
 *
 * That is exactly the state `quarantineSharedAccess` produces. When the realtime
 * channel fails, shared authorization is uncertain, so the store empties
 * `records` and sets `sharedSyncStatus` to `unavailable`. The RPC is plain HTTP
 * and keeps working -- a network that blocks websockets but allows HTTPS is the
 * ordinary case on a restricted network, which is this product's user base.
 *
 * These render the store, drive the real channel callback, and assert on the
 * real `clearOwnUnseen` wrapper.
 */

type AuthCallback = (event: string, session: { user: { id: string; email?: string; app_metadata?: Record<string, unknown> } } | null) => void;

const authCallbacks: AuthCallback[] = [];
const createdChannels: Array<{ name: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }> = [];

const mockSupabase = {
  auth: {
    onAuthStateChange: (cb: AuthCallback) => {
      authCallbacks.push(cb);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
  },
  channel: vi.fn((name: string) => {
    const chainable = { name, on: vi.fn(), subscribe: vi.fn() };
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

/**
 * A DEFINITE server answer with a partner present. The flag effect keys on
 * `coupleLifecycle === 'connected'`, and only this probe can produce it -- an
 * `ok: false` default leaves the lifecycle `unknown` and the effect never runs,
 * which would make every assertion below pass for the wrong reason.
 */
const fetchMyCoupleState = vi.fn().mockResolvedValue({
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

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: vi.fn().mockResolvedValue(undefined) },
  disconnectCoupleFromDB: vi.fn().mockResolvedValue(true),
  deleteAccountFromDB: vi.fn().mockResolvedValue(true),
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
  fetchMyCoupleState: (...args: unknown[]) => fetchMyCoupleState(...(args as [])),
}));

/** The observable: the one client path that lowers the flag and moves the boundary. */
const clearOwnUnseen = vi.fn(async (_userId: string) => {});
const revokeOwnPushTokens = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/pushTokens', () => ({
  clearOwnUnseen: (userId: string) => clearOwnUnseen(userId),
  registerPushToken: vi.fn(async () => ({ ok: true })),
  revokeOwnPushTokens: () => revokeOwnPushTokens(),
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
  saveRecordToDB: vi.fn(async () => ({ ok: true as const, contentRevision: 1 })),
  deleteRecordFromDB: vi.fn(async () => ({ ok: true as const })),
  fetchRecordsFromDB: vi.fn(async () => []),
  fetchRecordsResultFromDB: vi.fn(async () => ({ ok: true, records: [] })),
  uploadRecordMedia: vi.fn(async () => ({ attachment: null })),
  removeRecordMedia: vi.fn(async () => {}),
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: () => ({ error: 'unsupported' }),
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

vi.mock('@/lib/outboxStorage', () => ({
  isOutboxStorageAvailable: () => false,
  createIndexedDbOutbox: () => null,
}));

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');
const STORE_KEY = 'gomsinlog.state.v2';

function Probe() {
  const { isReady, sharedSyncStatus } = useStore();
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="syncStatus">{sharedSyncStatus}</span>
    </div>
  );
}

function connectedState(): Partial<AppState> {
  return {
    setupComplete: true,
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
    records: [],
    events: [],
    trips: [],
    widgetLayout: [],
    hasSeenInstallPrompt: false,
    theme: 'light',
  };
}

async function connect() {
  const state = connectedState();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  fetchFullStateFromDB.mockResolvedValue(state);

  const { unmount } = render(<StoreProvider><Probe /></StoreProvider>);
  await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
  await act(async () => {
    authCallbacks.forEach((cb) =>
      cb('SIGNED_IN', { user: { id: 'user-1', email: 'a@b.com', app_metadata: {} } }));
  });
  await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('ready'));
  return unmount;
}

/** Fail the realtime channel, which is what empties the shared workspace. */
async function failTheChannel() {
  const channel = createdChannels.find((c) => c.name === 'couple-sync:couple-1');
  expect(channel, 'the couple realtime channel was never opened').toBeTruthy();
  const subscribeCallback = channel!.subscribe.mock.calls[0]?.[0];
  expect(subscribeCallback, 'nothing subscribed to the channel').toBeTruthy();
  await act(async () => { subscribeCallback('CHANNEL_ERROR'); });
  await waitFor(() => expect(screen.getByTestId('syncStatus').textContent).toBe('unavailable'));
}

async function foreground() {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
}

describe('lowering the partner\'s invitation', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    createdChannels.length = 0;
    vi.stubEnv('VITE_PUSH_NOTIFICATIONS_ENABLED', 'false');
    clearOwnUnseen.mockClear();
    revokeOwnPushTokens.mockClear();
    fetchMyCoupleState.mockReset();
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
    localStorage.clear();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: {} } } });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('clears on foreground while the couple workspace is live and revokes any token left by an older push-enabled build', async () => {
    const unmount = await connect();

    await waitFor(() => expect(clearOwnUnseen).toHaveBeenCalled());
    expect(clearOwnUnseen).toHaveBeenCalledWith('user-1');
    await waitFor(() => expect(revokeOwnPushTokens).toHaveBeenCalled());
    expect(screen.getByTestId('syncStatus').textContent).toBe('live');

    unmount();
  });

  it('does NOT clear while shared access is quarantined', async () => {
    const unmount = await connect();
    await waitFor(() => expect(clearOwnUnseen).toHaveBeenCalled());

    await failTheChannel();
    clearOwnUnseen.mockClear();

    // The partner's records are off the screen now. Foregrounding is not seeing
    // them, and clearing here would move 053's boundary past acts this person
    // was never shown.
    await foreground();
    await foreground();
    expect(clearOwnUnseen).not.toHaveBeenCalled();

    unmount();
  });

  it('stays silent while the app is not visible', async () => {
    const unmount = await connect();
    await waitFor(() => expect(clearOwnUnseen).toHaveBeenCalled());
    clearOwnUnseen.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await foreground();
    expect(clearOwnUnseen).not.toHaveBeenCalled();

    unmount();
  });
});
