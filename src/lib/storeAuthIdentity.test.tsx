import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { DailyRecord, UserProfile, toAuthUser } from '@/types';
import type { FullStateResult } from '@/lib/sync';
import { appleSessionGuard } from '@/lib/authSessionGuard';

type SessionUser = Parameters<typeof toAuthUser>[0];
type SessionPayload = { user: SessionUser; access_token?: string };
type Provider = 'apple' | 'google';
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

const auth = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: SessionPayload | null) => void),
  user: null as SessionUser | null,
}));

const hydrate = vi.hoisted(() => vi.fn<
  (_userId?: string) => Promise<FullStateResult>
>());

const boundaries = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  authLinkIdentity: vi.fn(),
  authUpdateUser: vi.fn(),
  databaseFrom: vi.fn(),
  databaseRpc: vi.fn(),
  fetchCoupleState: vi.fn(),
  disconnectCouple: vi.fn(),
  deleteAccount: vi.fn(),
  saveCoupleAnniversary: vi.fn(),
  saveRecord: vi.fn(),
  recordProductEvent: vi.fn(),
  clearE2eeRuntime: vi.fn(),
  installE2eeRuntime: vi.fn(),
  realtimeChannel: {
    on: vi.fn(),
    subscribe: vi.fn(),
  },
  createRealtimeChannel: vi.fn(),
  removeRealtimeChannel: vi.fn(),
  outbox: {
    all: vi.fn(),
    add: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(),
    remove: vi.fn(),
    removeMany: vi.fn(),
  },
}));

boundaries.realtimeChannel.on.mockReturnValue(boundaries.realtimeChannel);
boundaries.realtimeChannel.subscribe.mockReturnValue(boundaries.realtimeChannel);
boundaries.createRealtimeChannel.mockReturnValue(boundaries.realtimeChannel);

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/supabase')>(),
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof auth.callback) => {
        auth.callback = callback;
        return { data: { subscription: { unsubscribe() { auth.callback = null; } } } };
      },
      getUser: boundaries.authGetUser,
      linkIdentity: boundaries.authLinkIdentity,
      updateUser: boundaries.authUpdateUser,
    },
    from: boundaries.databaseFrom,
    rpc: boundaries.databaseRpc,
    channel: boundaries.createRealtimeChannel,
    removeChannel: boundaries.removeRealtimeChannel,
  },
  fetchMyCoupleState: boundaries.fetchCoupleState,
  disconnectCoupleFromDB: boundaries.disconnectCouple,
  deleteAccountFromDB: boundaries.deleteAccount,
  saveCoupleAnniversary: boundaries.saveCoupleAnniversary,
}));

vi.mock('@/lib/sync', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/sync')>(),
  fetchFullStateResultFromDB: hydrate,
}));

vi.mock('@/lib/outboxStorage', () => ({
  createIndexedDbOutbox: () => boundaries.outbox,
}));

vi.mock('@/lib/records', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/records')>(),
  saveRecordToDB: boundaries.saveRecord,
}));

vi.mock('@/lib/productEvents', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/productEvents')>(),
  recordProductEvent: boundaries.recordProductEvent,
}));

vi.mock('@/app/e2ee/runtimeLifecycle', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/app/e2ee/runtimeLifecycle')>(),
  clearE2eeRuntime: boundaries.clearE2eeRuntime,
}));

vi.mock('@/app/e2ee/runtimeSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/app/e2ee/runtimeSession')>(),
  installE2eeRuntimeForAuthenticatedSession: boundaries.installE2eeRuntime,
}));

import { StoreProvider } from '@/lib/store';
import { useStore } from '@/lib/useStore';

function AuthProbe() {
  const { state, isReady } = useStore();
  return (
    <div>
      <output data-testid="is-ready">{String(isReady)}</output>
      <output data-testid="auth">
        {isReady ? JSON.stringify(state.authenticatedUser) : 'loading'}
      </output>
      <output data-testid="auth-user">
        {state.authenticatedUser ? JSON.stringify(state.authenticatedUser) : 'null'}
      </output>
      <output data-testid="records">{JSON.stringify(state.records)}</output>
      <output data-testid="record-count">{state.records.length}</output>
      <output data-testid="profile-name">{state.profile.myName}</output>
      <output data-testid="setup-complete">{String(state.setupComplete)}</output>
      <output data-testid="couple-id">{state.profile.couple.coupleId || 'none'}</output>
    </div>
  );
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function ownedRecord(userId: string, log: string, date = '2026-09-05'): DailyRecord {
  return {
    id: `record-${userId}`,
    userId,
    date,
    time: '09:30',
    authorRole: 'gomsin',
    log,
    attachments: [],
    isPrivate: false,
    createdAt: `${date}T00:30:00.000Z`,
  };
}

function ownedProfile(userId: string, name: string, coupleId: string): UserProfile {
  return {
    id: userId,
    myName: name,
    role: 'gomsin',
    couple: {
      coupleId,
      partnerName: 'Synthetic Partner',
      coupleCode: 'SYNTH1',
      connected: true,
      status: 'active',
    },
    military: {
      branch: 'army',
      militaryStatus: 'serving',
      dischargeDateSource: 'manual',
      memo: '',
    },
    contact: {
      weekdayStart: '18:00',
      weekdayEnd: '21:00',
      weekendStart: '12:00',
      weekendEnd: '21:00',
      enabled: true,
    },
  };
}

function expectOnlyDeletionRevalidation(expectedCount: number): void {
  expect(boundaries.authGetUser).toHaveBeenCalledTimes(expectedCount);
  expect(boundaries.databaseRpc.mock.calls).toEqual(
    Array.from({ length: expectedCount }, () => ['is_my_account_deletion_pending']),
  );
}

function expectNoAccountOwnershipMutation(): void {
  expect(boundaries.authLinkIdentity).not.toHaveBeenCalled();
  expect(boundaries.authUpdateUser).not.toHaveBeenCalled();
  expect(boundaries.databaseFrom).not.toHaveBeenCalled();
  expect(boundaries.disconnectCouple).not.toHaveBeenCalled();
  expect(boundaries.deleteAccount).not.toHaveBeenCalled();
  expect(boundaries.saveCoupleAnniversary).not.toHaveBeenCalled();
  expect(boundaries.saveRecord).not.toHaveBeenCalled();
  expect(boundaries.recordProductEvent).not.toHaveBeenCalled();
  expect(boundaries.outbox.add).not.toHaveBeenCalled();
  expect(boundaries.outbox.put).not.toHaveBeenCalled();
  expect(boundaries.outbox.putMany).not.toHaveBeenCalled();
  expect(boundaries.outbox.remove).not.toHaveBeenCalled();
  expect(boundaries.outbox.removeMany).not.toHaveBeenCalled();
}

function expectOnlyDevicePreferencesPersisted(
  setItem: MockInstance<Storage['setItem']>,
  forbiddenAccountValues: string[],
): void {
  const stateWrites = setItem.mock.calls.filter(([key]) => key === 'gomsinlog.state.v2');
  expect(stateWrites.length).toBeGreaterThan(0);
  for (const [, serialized] of stateWrites) {
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'hasSeenInstallPrompt',
      'locale',
      'soldierWidgetLayout',
      'theme',
      'widgetLayout',
    ]);
    for (const accountValue of forbiddenAccountValues) {
      expect(serialized).not.toContain(accountValue);
    }
  }
}

let storageSetItem: MockInstance<Storage['setItem']>;

beforeEach(() => {
  auth.callback = null;
  auth.user = null;

  hydrate.mockReset().mockResolvedValue({
    ok: true,
    state: { setupComplete: false, records: [] },
  });
  boundaries.authGetUser.mockReset().mockImplementation(async () => ({
    data: { user: auth.user },
    error: null,
  }));
  boundaries.databaseRpc.mockReset().mockResolvedValue({ data: false, error: null });
  boundaries.fetchCoupleState.mockReset().mockResolvedValue({ ok: false, reason: 'server' });
  boundaries.installE2eeRuntime.mockReset().mockResolvedValue({
    status: 'guarded',
    reason: 'bootstrap_incomplete',
  });
  boundaries.outbox.all.mockReset().mockResolvedValue([]);

  for (const mock of [
    boundaries.authLinkIdentity,
    boundaries.authUpdateUser,
    boundaries.databaseFrom,
    boundaries.disconnectCouple,
    boundaries.deleteAccount,
    boundaries.saveCoupleAnniversary,
    boundaries.saveRecord,
    boundaries.recordProductEvent,
    boundaries.clearE2eeRuntime,
    boundaries.removeRealtimeChannel,
    boundaries.outbox.add,
    boundaries.outbox.put,
    boundaries.outbox.putMany,
    boundaries.outbox.remove,
    boundaries.outbox.removeMany,
  ]) mock.mockReset();

  boundaries.realtimeChannel.on.mockClear().mockReturnValue(boundaries.realtimeChannel);
  boundaries.realtimeChannel.subscribe.mockClear().mockReturnValue(boundaries.realtimeChannel);
  boundaries.createRealtimeChannel.mockReset().mockReturnValue(boundaries.realtimeChannel);

  storageSetItem = vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, 'setItem');
});

describe('live store auth-event provider mapping', () => {
  it('uses the USER_UPDATED fast path to refresh provider identity without account rehydration', async () => {
    render(<StoreProvider><AuthProbe /></StoreProvider>);
    await waitFor(() => expect(auth.callback).not.toBeNull());
    auth.user = {
      id: 'apple-account', email: 'relay@example.com', app_metadata: { provider: 'apple' },
      identities: [{ provider: 'apple' }],
    };
    act(() => auth.callback!('INITIAL_SESSION', { user: auth.user! }));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"provider":"apple"'));
    expect(JSON.parse(screen.getByTestId('auth').textContent!)).toEqual({
      id: 'apple-account', email: 'relay@example.com', provider: 'apple', identityProviders: ['apple'],
    });
    expect(hydrate).toHaveBeenCalledTimes(1);

    auth.user = { id: 'apple-account', email: 'relay@example.com', app_metadata: {} };
    act(() => auth.callback!('USER_UPDATED', { user: auth.user! }));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"provider":"unknown"'));

    expect(JSON.parse(screen.getByTestId('auth').textContent!)).toEqual({
      id: 'apple-account', email: 'relay@example.com', provider: 'unknown',
    });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expectOnlyDeletionRevalidation(1);
    expect(boundaries.installE2eeRuntime).toHaveBeenCalledTimes(1);
    expect(boundaries.installE2eeRuntime.mock.calls[0]?.[0]).toMatchObject({
      userId: 'apple-account', activateCoupleProtection: false,
    });
    expect(boundaries.clearE2eeRuntime).toHaveBeenCalledTimes(1);
    expectNoAccountOwnershipMutation();
    await waitFor(() => {
      expect(storageSetItem.mock.calls.some(([key]) => key === 'gomsinlog.state.v2')).toBe(true);
    });
    expectOnlyDevicePreferencesPersisted(storageSetItem, ['apple-account', 'relay@example.com']);
  });

  it.each([
    { from: 'google', to: 'apple' },
    { from: 'apple', to: 'google' },
  ] as const)(
    'preserves the same UID through real $from→$to SIGNED_IN revalidation and hydration',
    async ({ from, to }: { from: Provider; to: Provider }) => {
      const uid = `same-uid-${from}-to-${to}`;
      const email = 'continuity@example.com';
      const coupleId = `couple-${uid}`;
      const profile = ownedProfile(uid, 'Continuity User', coupleId);
      const initialRecord = ownedRecord(uid, 'Initial authoritative record');
      const refreshedRecord = ownedRecord(uid, 'Latest authoritative record');
      const refreshed = createDeferred<FullStateResult>();

      hydrate
        .mockReset()
        .mockResolvedValueOnce({
          ok: true,
          state: { setupComplete: true, records: [initialRecord], profile },
        })
        .mockImplementationOnce(() => refreshed.promise);

      render(<StoreProvider><AuthProbe /></StoreProvider>);
      await waitFor(() => expect(auth.callback).not.toBeNull());

      auth.user = {
        id: uid, email, app_metadata: { provider: from }, identities: [{ provider: from }],
      };
      act(() => auth.callback!('INITIAL_SESSION', { user: auth.user! }));

      await waitFor(() => expect(screen.getByTestId('profile-name')).toHaveTextContent('Continuity User'));
      expect(screen.getByTestId('is-ready').textContent).toBe('true');
      expect(JSON.parse(screen.getByTestId('records').textContent!)).toEqual([initialRecord]);
      expect(screen.getByTestId('setup-complete').textContent).toBe('true');
      expect(screen.getByTestId('couple-id').textContent).toBe(coupleId);
      expect(JSON.parse(screen.getByTestId('auth-user').textContent!)).toEqual({
        id: uid, email, provider: from, identityProviders: [from],
      });

      auth.user = {
        id: uid,
        email,
        app_metadata: { provider: to },
        identities: [{ provider: to }, { provider: from }],
      };
      act(() => auth.callback!('SIGNED_IN', { user: auth.user! }));

      await waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));

      // Same UID stays usable while its authoritative refresh is pending.
      expect(screen.getByTestId('is-ready').textContent).toBe('true');
      expect(JSON.parse(screen.getByTestId('records').textContent!)).toEqual([initialRecord]);
      expect(screen.getByTestId('profile-name').textContent).toBe('Continuity User');
      expect(screen.getByTestId('setup-complete').textContent).toBe('true');
      expect(screen.getByTestId('couple-id').textContent).toBe(coupleId);
      expect(JSON.parse(screen.getByTestId('auth-user').textContent!)).toMatchObject({
        id: uid, provider: from,
      });

      await act(async () => {
        refreshed.resolve({
          ok: true,
          state: { setupComplete: true, records: [refreshedRecord], profile },
        });
      });

      await waitFor(() => {
        expect(JSON.parse(screen.getByTestId('auth-user').textContent!).provider).toBe(to);
      });
      expect(JSON.parse(screen.getByTestId('auth-user').textContent!)).toEqual({
        id: uid, email, provider: to, identityProviders: [to, from],
      });
      expect(JSON.parse(screen.getByTestId('records').textContent!)).toEqual([refreshedRecord]);
      expect(screen.getByTestId('profile-name').textContent).toBe('Continuity User');
      expect(screen.getByTestId('setup-complete').textContent).toBe('true');
      expect(screen.getByTestId('couple-id').textContent).toBe(coupleId);

      expect(hydrate.mock.calls).toEqual([[uid], [uid]]);
      expectOnlyDeletionRevalidation(2);
      await waitFor(() => expect(boundaries.fetchCoupleState).toHaveBeenCalledTimes(2));
      expect(boundaries.installE2eeRuntime).toHaveBeenCalledTimes(2);
      expect(boundaries.installE2eeRuntime.mock.calls.map(([input]) => input.userId)).toEqual([uid, uid]);
      expect(boundaries.clearE2eeRuntime).toHaveBeenCalledTimes(1);
      expectNoAccountOwnershipMutation();
      await waitFor(() => {
        expect(storageSetItem.mock.calls.some(([key]) => key === 'gomsinlog.state.v2')).toBe(true);
      });
      expectOnlyDevicePreferencesPersisted(storageSetItem, [uid, email, coupleId, initialRecord.id]);
    },
  );
});

describe('account switching strictly partitioned by server UID', () => {
  const testCases = [
    {
      description: 'same literal email under distinct server UIDs',
      firstUid: 'user-primary-201',
      firstEmail: 'common-identity@example.com',
      secondUid: 'user-secondary-202',
      secondEmail: 'common-identity@example.com',
      secondProvider: 'apple',
    },
    {
      description: 'Apple private relay email under distinct server UID',
      firstUid: 'user-primary-301',
      firstEmail: 'regular-account@example.com',
      secondUid: 'user-secondary-302',
      secondEmail: 'relay-abc987@privaterelay.appleid.com',
      secondProvider: 'apple',
    },
    {
      description: 'distinct emails under distinct server UIDs',
      firstUid: 'user-primary-401',
      firstEmail: 'alpha@example.com',
      secondUid: 'user-secondary-402',
      secondEmail: 'beta@example.com',
      secondProvider: 'google',
    },
  ] as const;

  testCases.forEach((testCase) => {
    it(`clears all account A state while hydrating account B for ${testCase.description}`, async () => {
      const recordA = ownedRecord(testCase.firstUid, `Private A ${testCase.firstUid}`, '2026-09-01');
      const recordB = ownedRecord(testCase.secondUid, `Private B ${testCase.secondUid}`, '2026-09-02');
      const profileA = ownedProfile(testCase.firstUid, `Name-${testCase.firstUid}`, `couple-${testCase.firstUid}`);
      const profileB = ownedProfile(testCase.secondUid, `Name-${testCase.secondUid}`, `couple-${testCase.secondUid}`);
      const accountBHydration = createDeferred<FullStateResult>();

      hydrate.mockImplementation((userId?: string) => {
        if (userId === testCase.firstUid) {
          return Promise.resolve({
            ok: true,
            state: { setupComplete: true, records: [recordA], profile: profileA },
          });
        }
        if (userId === testCase.secondUid) return accountBHydration.promise;
        return Promise.resolve({ ok: true, state: { setupComplete: false, records: [] } });
      });

      render(<StoreProvider><AuthProbe /></StoreProvider>);
      await waitFor(() => expect(auth.callback).not.toBeNull());

      auth.user = {
        id: testCase.firstUid,
        email: testCase.firstEmail,
        app_metadata: { provider: 'google' },
        identities: [{ provider: 'google' }],
      };
      act(() => auth.callback!('INITIAL_SESSION', { user: auth.user! }));

      await waitFor(() => expect(screen.getByTestId('is-ready')).toHaveTextContent('true'));
      expect(screen.getByTestId('profile-name').textContent).toBe(`Name-${testCase.firstUid}`);
      expect(JSON.parse(screen.getByTestId('records').textContent!)).toEqual([recordA]);

      act(() => {
        auth.user = {
          id: testCase.secondUid,
          email: testCase.secondEmail,
          app_metadata: { provider: testCase.secondProvider },
          identities: [{ provider: testCase.secondProvider }],
        };
        auth.callback!('SIGNED_IN', { user: auth.user! });
      });

      await waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));

      // Different UID fails closed before the second network snapshot returns.
      expect(screen.getByTestId('is-ready').textContent).toBe('false');
      expect(screen.getByTestId('auth-user').textContent).toBe('null');
      expect(screen.getByTestId('records').textContent).toBe('[]');
      expect(screen.getByTestId('record-count').textContent).toBe('0');
      expect(screen.getByTestId('profile-name').textContent).toBe('');
      expect(screen.getByTestId('setup-complete').textContent).toBe('false');
      expect(screen.getByTestId('couple-id').textContent).toBe('none');

      await act(async () => {
        accountBHydration.resolve({
          ok: true,
          state: { setupComplete: true, records: [recordB], profile: profileB },
        });
      });

      await waitFor(() => expect(screen.getByTestId('is-ready')).toHaveTextContent('true'));
      expect(screen.getByTestId('profile-name').textContent).toBe(`Name-${testCase.secondUid}`);
      expect(JSON.parse(screen.getByTestId('records').textContent!)).toEqual([recordB]);
      expect(screen.getByTestId('setup-complete').textContent).toBe('true');
      expect(screen.getByTestId('couple-id').textContent).toBe(`couple-${testCase.secondUid}`);
      expect(JSON.parse(screen.getByTestId('auth-user').textContent!)).toEqual({
        id: testCase.secondUid,
        email: testCase.secondEmail,
        provider: testCase.secondProvider,
        identityProviders: [testCase.secondProvider],
      });

      expect(hydrate.mock.calls).toEqual([[testCase.firstUid], [testCase.secondUid]]);
      expectOnlyDeletionRevalidation(2);
      await waitFor(() => expect(boundaries.fetchCoupleState).toHaveBeenCalledTimes(2));
      expect(boundaries.installE2eeRuntime.mock.calls.map(([input]) => input.userId)).toEqual([
        testCase.firstUid, testCase.secondUid,
      ]);
      expect(boundaries.clearE2eeRuntime).toHaveBeenCalledTimes(2);
      expectNoAccountOwnershipMutation();
      await waitFor(() => {
        expect(storageSetItem.mock.calls.some(([key]) => key === 'gomsinlog.state.v2')).toBe(true);
      });
      expectOnlyDevicePreferencesPersisted(storageSetItem, [
        testCase.firstUid,
        testCase.secondUid,
        testCase.firstEmail,
        testCase.secondEmail,
        recordA.id,
        recordB.id,
        `couple-${testCase.firstUid}`,
        `couple-${testCase.secondUid}`,
      ]);
    });
  });
});

describe('late session guard enforcement at StoreProvider boundary', () => {
  it('rejects a late cancelled Apple SIGNED_IN event before identity or hydration authority', async () => {
    render(<StoreProvider><AuthProbe /></StoreProvider>);
    await waitFor(() => expect(auth.callback).not.toBeNull());

    const cancelledAttempt = appleSessionGuard.beginAppleAttempt();
    cancelledAttempt.bindSessionResponse({
      access_token: 'late-cancelled-token-401',
      user: { id: 'late-cancelled-apple-uid-401' },
    });
    const finishSignOut = appleSessionGuard.beginSignOut();
    finishSignOut();
    cancelledAttempt.finish();

    expect(appleSessionGuard.canConsumeSession({
      access_token: 'late-cancelled-token-401',
      user: { id: 'late-cancelled-apple-uid-401' },
    })).toBe(false);

    act(() => {
      auth.callback!('SIGNED_IN', {
        access_token: 'late-cancelled-token-401',
        user: {
          id: 'late-cancelled-apple-uid-401',
          email: 'aborted@privaterelay.appleid.com',
          app_metadata: { provider: 'apple' },
        },
      });
    });

    expect(hydrate).not.toHaveBeenCalled();
    expect(boundaries.authGetUser).not.toHaveBeenCalled();
    expect(boundaries.databaseRpc).not.toHaveBeenCalled();
    expect(boundaries.installE2eeRuntime).not.toHaveBeenCalled();
    expect(boundaries.clearE2eeRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-user').textContent).toBe('null');
    expect(screen.getByTestId('is-ready').textContent).toBe('false');
    expectNoAccountOwnershipMutation();
  });

  it('resolves a rejected Apple INITIAL_SESSION as signed out without hydrating', async () => {
    const cancelledAttempt = appleSessionGuard.beginAppleAttempt();
    cancelledAttempt.bindSessionResponse({
      access_token: 'late-cancelled-token-402',
      user: { id: 'late-cancelled-apple-uid-402' },
    });
    const finishSignOut = appleSessionGuard.beginSignOut();
    finishSignOut();
    cancelledAttempt.finish();

    render(<StoreProvider><AuthProbe /></StoreProvider>);
    await waitFor(() => expect(auth.callback).not.toBeNull());

    act(() => {
      auth.callback!('INITIAL_SESSION', {
        access_token: 'late-cancelled-token-402',
        user: {
          id: 'late-cancelled-apple-uid-402',
          email: 'aborted@privaterelay.appleid.com',
          app_metadata: { provider: 'apple' },
        },
      });
    });

    expect(hydrate).not.toHaveBeenCalled();
    expect(boundaries.authGetUser).not.toHaveBeenCalled();
    expect(boundaries.databaseRpc).not.toHaveBeenCalled();
    expect(boundaries.installE2eeRuntime).not.toHaveBeenCalled();
    expect(boundaries.clearE2eeRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-user').textContent).toBe('null');
    expect(screen.getByTestId('is-ready').textContent).toBe('true');
    expectNoAccountOwnershipMutation();
  });
});
