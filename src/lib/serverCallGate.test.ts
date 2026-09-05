import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerServerCallGate,
  runServerMutationBehindDeletionBarrier,
  serverCallBlockedByPendingDeletion,
  withAccountDeletionLock,
  type BoundServerCallGate,
  type ServerCallGateRegistration,
} from '@/lib/accountDeletion';

/**
 * REGRESSION: server mutations issued outside `StoreContextType` bypassed the
 * tri-state pre-flight gate.
 *
 * The gate inventory in the plan enumerated only the store's own methods, but
 * trips, cycle and invitation writes are issued directly by pages through the
 * data-layer modules. Clause 2.45 requires the authoritative check before
 * "the next server synchronization OR any server mutation", so those 22 writes
 * were a real bypass: while status was `unknown`, they could recreate server
 * rows for an account whose data `prepare_account_deletion` had already removed.
 *
 * This suite pins the fix: every one of those functions consults the gate and
 * returns its EXISTING failure value without issuing a request.
 */

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const supabase = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      const chain: Record<string, unknown> = {};
      for (const method of ['insert', 'update', 'upsert', 'delete', 'select', 'eq', 'order']) {
        chain[method] = () => chain;
      }
      chain.single = async () => ({ data: null, error: { message: 'should not be reached' } });
      chain.maybeSingle = async () => ({ data: null, error: { message: 'should not be reached' } });
      chain.then = undefined;
      return chain;
    },
    rpc: (name: string) => {
      calls.push(`rpc:${name}`);
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getSession: async () => {
        calls.push('auth.getSession');
        return { data: { session: { user: { id: 'user-a' } } } };
      },
      getUser: async () => {
        calls.push('auth.getUser');
        return { data: { user: { id: 'user-a' } }, error: null };
      },
    },
  };
  return { calls, supabase };
});

vi.mock('@/lib/supabase', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/supabase')>();
  return { ...original, supabase: h.supabase, isSupabaseConfigured: true };
});

const { calls } = h;
const boundRegistrations: ServerCallGateRegistration[] = [];

function registerBoundServerCallGate(
  registration: BoundServerCallGate,
): ServerCallGateRegistration {
  const handle = registerServerCallGate(registration);
  boundRegistrations.push(handle);
  return handle;
}

function clearBoundServerCallGates(): void {
  for (const registration of boundRegistrations.splice(0).reverse()) {
    registration.unregister();
  }
}

/** Every request-issuing call. `auth.getSession` is local, so it is excluded. */
function requestsIssued(): string[] {
  return calls.filter((call) => call !== 'auth.getSession');
}

describe('the pre-flight gate registry', () => {
  afterEach(() => {
    clearBoundServerCallGates();
    registerServerCallGate(null);
    calls.length = 0;
  });

  it('blocks on pending only; clear and unknown do not block', async () => {
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'pending' }),
    });
    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'clear' }),
    });
    expect(await serverCallBlockedByPendingDeletion()).toBe(false);
    // The deliberate availability tradeoff: `unknown` continues.
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'unknown' }),
    });
    expect(await serverCallBlockedByPendingDeletion()).toBe(false);
  });

  it('re-issues the check on EVERY call rather than caching a verdict', async () => {
    let asked = 0;
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => {
        asked += 1;
        return { kind: 'unknown' };
      },
    });
    await serverCallBlockedByPendingDeletion();
    await serverCallBlockedByPendingDeletion();
    await serverCallBlockedByPendingDeletion();
    expect(asked).toBe(3);
  });

  it('fails closed when the gate itself throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => { throw new Error('gate exploded'); },
    });
    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('fails closed after the last mounted provider unregisters', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registration = registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'pending' }),
    });
    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    registration.unregister();
    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    error.mockRestore();
  });

  it('fails closed when mounted providers have no gate bound to their current user', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const staleGate = vi.fn(async () => ({ kind: 'clear' } as const));
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-b',
      gate: staleGate,
    });

    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    expect(staleGate).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('never lets a stale provider registration serve the current user of a newer provider', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    registerBoundServerCallGate({
      expectedUserId: 'user-b',
      getCurrentUserId: () => 'user-b',
      gate: async () => ({ kind: 'pending' }),
    });
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      // Provider A has observed the shared Auth switch to B, but its render-time
      // registration is still bound to A. It must not overwrite B's gate.
      getCurrentUserId: () => 'user-b',
      gate: async () => ({ kind: 'clear' }),
    });

    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    error.mockRestore();
  });

  it('does not let stale cleanup from provider A clear provider B registration', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const providerA = registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-b',
      gate: async () => ({ kind: 'clear' }),
    });
    registerBoundServerCallGate({
      expectedUserId: 'user-b',
      getCurrentUserId: () => 'user-b',
      gate: async () => ({ kind: 'pending' }),
    });

    providerA.unregister();

    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    error.mockRestore();
  });

  it('lets prior mutations overlap but never lets a later mutation overtake deletion', async () => {
    let releaseMutations!: () => void;
    const mutationBarrier = new Promise<void>((resolve) => { releaseMutations = resolve; });
    let releaseDeletion!: () => void;
    const deletionBarrier = new Promise<void>((resolve) => { releaseDeletion = resolve; });
    const entered: string[] = [];
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'clear' }),
    });

    const first = runServerMutationBehindDeletionBarrier(async ({ lease }) => {
      expect(lease?.mode).toBe('shared');
      entered.push('mutation-1');
      await mutationBarrier;
      return 1;
    }, { expectedUserId: 'user-a' });
    const second = runServerMutationBehindDeletionBarrier(async () => {
      entered.push('mutation-2');
      await mutationBarrier;
      return 2;
    }, { expectedUserId: 'user-a' });
    await vi.waitFor(() => expect(entered).toEqual(['mutation-1', 'mutation-2']));

    const deletion = withAccountDeletionLock('user-a', async () => {
      entered.push('deletion');
      await deletionBarrier;
    });
    const late = runServerMutationBehindDeletionBarrier(async () => {
      entered.push('mutation-late');
      return 3;
    }, { expectedUserId: 'user-a' });
    await Promise.resolve();
    expect(entered).toEqual(['mutation-1', 'mutation-2']);

    releaseMutations();
    await vi.waitFor(() => expect(entered).toEqual(['mutation-1', 'mutation-2', 'deletion']));
    releaseDeletion();

    await expect(first).resolves.toEqual({ kind: 'executed', value: 1 });
    await expect(second).resolves.toEqual({ kind: 'executed', value: 2 });
    await deletion;
    await expect(late).resolves.toEqual({ kind: 'executed', value: 3 });
    expect(entered).toEqual(['mutation-1', 'mutation-2', 'deletion', 'mutation-late']);
  });

  it('blocks a queued mutation if the authenticated account changes before lock admission', async () => {
    let currentUserId = 'user-a';
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => currentUserId,
      gate: async () => ({ kind: 'clear' }),
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const entered = vi.fn();
    const holder = withAccountDeletionLock('user-a', () => barrier);
    await Promise.resolve();

    const mutation = runServerMutationBehindDeletionBarrier(async () => {
      entered();
      return 'written';
    }, { expectedUserId: 'user-a' });
    currentUserId = 'user-b';
    release();
    await holder;

    await expect(mutation).resolves.toEqual({ kind: 'blocked' });
    expect(entered).not.toHaveBeenCalled();
  });

  it('rechecks a newly observed pending status outside the shared lease', async () => {
    const leases: Array<unknown> = [];
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async (lease) => {
        leases.push(lease);
        return { kind: 'pending' };
      },
    });
    const operation = vi.fn();

    await expect(runServerMutationBehindDeletionBarrier(operation, { expectedUserId: 'user-a' }))
      .resolves.toEqual({ kind: 'blocked' });
    expect(operation).not.toHaveBeenCalled();
    expect(leases).toHaveLength(2);
    expect(leases[0]).toMatchObject({ userId: 'user-a', mode: 'shared' });
    expect(leases[1]).toBeUndefined();
  });

  it('rechecks identity after an asynchronous deletion gate before entering the operation', async () => {
    let currentUserId = 'user-a';
    let releaseGate!: () => void;
    const gateBarrier = new Promise<void>((resolve) => { releaseGate = resolve; });
    const gateEntered = vi.fn();
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => currentUserId,
      gate: async () => {
        gateEntered();
        await gateBarrier;
        return { kind: 'unknown' };
      },
    });
    const operation = vi.fn();

    const pending = runServerMutationBehindDeletionBarrier(operation, {
      expectedUserId: 'user-a',
    });
    await vi.waitFor(() => expect(gateEntered).toHaveBeenCalled());
    currentUserId = 'user-b';
    releaseGate();

    await expect(pending).resolves.toEqual({ kind: 'blocked' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('drops best-effort work on unknown authority instead of delaying deletion', async () => {
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'unknown' }),
    });
    const operation = vi.fn();

    await expect(runServerMutationBehindDeletionBarrier(operation, {
      expectedUserId: 'user-a',
      policy: 'best_effort',
    })).resolves.toEqual({ kind: 'blocked' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('lets a multi-step mutation stop before its next request after an account switch', async () => {
    let currentUserId = 'user-a';
    let continueOperation!: () => void;
    const betweenWrites = new Promise<void>((resolve) => { continueOperation = resolve; });
    const writes: string[] = [];
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => currentUserId,
      gate: async () => ({ kind: 'clear' }),
    });

    const mutation = runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
      assertCurrent();
      writes.push('first');
      await betweenWrites;
      assertCurrent();
      writes.push('second');
    }, { expectedUserId: 'user-a' });
    await vi.waitFor(() => expect(writes).toEqual(['first']));
    currentUserId = 'user-b';
    continueOperation();

    await expect(mutation).resolves.toEqual({ kind: 'blocked' });
    expect(writes).toEqual(['first']);
  });

  it('drops best-effort work immediately when an exclusive deletion lock is contended', async () => {
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'clear' }),
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const holder = withAccountDeletionLock('user-a', () => barrier);
    await Promise.resolve();
    const operation = vi.fn();

    await expect(runServerMutationBehindDeletionBarrier(operation, {
      expectedUserId: 'user-a',
      policy: 'best_effort',
    })).resolves.toEqual({ kind: 'blocked' });
    expect(operation).not.toHaveBeenCalled();

    release();
    await holder;
  });
});

describe('REGRESSION: no server mutation outside the store bypasses the gate', () => {
  beforeEach(() => {
    calls.length = 0;
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'pending' }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    clearBoundServerCallGates();
    registerServerCallGate(null);
  });

  it('aborts all ten trips mutations with no request issued', async () => {
    const trips = await import('@/lib/trips');
    const trip = { title: 't', startDate: '2026-08-01', endDate: '2026-08-02' };
    const item = {
      id: 'item-1', tripId: 'trip-1', itemDate: '2026-08-01', title: 'x',
      category: 'sight', memo: '', url: '', sortOrder: 0,
    };

    expect(await trips.saveTripToDB(trip as never, 'couple-1', 'user-a')).toBeNull();
    expect(await trips.updateTripInDB('trip-1', { title: 'y' })).toBeNull();
    expect(await trips.deleteTripFromDB('trip-1', 'couple-1')).toBe(false);
    expect(await trips.saveTripItemToDB(item as never)).toBeNull();
    expect(await trips.updateTripItemInDB(item as never)).toBeNull();
    expect(await trips.reorderTripItemsInDB([{ id: 'item-1', sortOrder: 1 }])).toBe(false);
    expect(await trips.deleteTripItemFromDB('item-1', 'trip-1')).toBe(false);
    expect(await trips.saveTripChecklistToDB('trip-1', 'passport')).toBeNull();
    expect(await trips.toggleTripChecklistInDB('check-1', true)).toBe(false);
    expect(await trips.deleteTripChecklistFromDB('check-1', 'trip-1')).toBe(false);

    expect(requestsIssued()).toEqual([]);
  });

  it('aborts all six cycle mutations with no request issued', async () => {
    const cycle = await import('@/lib/cycle');

    // The gate now reports WHY it refused instead of a bare falsy value, so each
    // assertion pins both the refusal and its non-retryable `forbidden` reason.
    const blocked = { ok: false, reason: 'forbidden' };

    expect(await cycle.saveCycleSettingsToDB(28, 5)).toEqual(blocked);
    expect(await cycle.saveCycleEntryToDB('2026-08-01', '2026-08-05', 'n', [])).toEqual(blocked);
    expect(await cycle.updateCycleEntryInDB('entry-1', {
      startDate: '2026-08-01', endDate: '2026-08-05', notes: 'n', symptoms: [],
    })).toEqual(blocked);
    expect(await cycle.deleteCycleEntryFromDB('entry-1')).toEqual(blocked);
    expect(await cycle.createCycleSupportSignalInDB({
      coupleId: 'couple-1', kind: 'need_rest', sharedForDate: '2026-08-01',
    } as never)).toEqual(blocked);
    expect(await cycle.revokeCycleSupportSignalFromDB('signal-1')).toEqual(blocked);

    expect(requestsIssued()).toEqual([]);
  });

  // The three invitation mutations need a CONFIGURED client to reach their
  // guard at all (an unconfigured client fails closed first), so they are
  // covered by `invitationGate.test.ts` instead.

  it('PRESERVATION: a clear verdict lets every one of them through unchanged', async () => {
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'clear' }),
    });
    calls.length = 0;
    const trips = await import('@/lib/trips');
    const cycle = await import('@/lib/cycle');

    await trips.deleteTripFromDB('trip-1', 'couple-1');
    await trips.reorderTripItemsInDB([{ id: 'item-1', sortOrder: 1 }]);
    await cycle.deleteCycleEntryFromDB('entry-1');

    expect(calls).toContain('from:trips');
    expect(calls).toContain('rpc:reorder_trip_items');
    expect(calls).toContain('from:cycle_entries');
  });

  it('PRESERVATION: an unknown verdict also lets them through (offline path)', async () => {
    registerBoundServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => 'user-a',
      gate: async () => ({ kind: 'unknown' }),
    });
    calls.length = 0;
    const trips = await import('@/lib/trips');
    await trips.deleteTripFromDB('trip-1', 'couple-1');
    expect(calls).toContain('from:trips');
  });
});
