import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerServerCallGate, serverCallBlockedByPendingDeletion } from '@/lib/accountDeletion';

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

/** Every request-issuing call. `auth.getSession` is local, so it is excluded. */
function requestsIssued(): string[] {
  return calls.filter((call) => call !== 'auth.getSession');
}

describe('the pre-flight gate registry', () => {
  afterEach(() => {
    registerServerCallGate(null);
    calls.length = 0;
  });

  it('is a no-op when no provider is mounted, so behaviour is unchanged', async () => {
    expect(await serverCallBlockedByPendingDeletion()).toBe(false);
  });

  it('blocks on pending only; clear and unknown do not block', async () => {
    registerServerCallGate(async () => ({ kind: 'pending' }));
    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    registerServerCallGate(async () => ({ kind: 'clear' }));
    expect(await serverCallBlockedByPendingDeletion()).toBe(false);
    // The deliberate availability tradeoff: `unknown` continues.
    registerServerCallGate(async () => ({ kind: 'unknown' }));
    expect(await serverCallBlockedByPendingDeletion()).toBe(false);
  });

  it('re-issues the check on EVERY call rather than caching a verdict', async () => {
    let asked = 0;
    registerServerCallGate(async () => {
      asked += 1;
      return { kind: 'unknown' };
    });
    await serverCallBlockedByPendingDeletion();
    await serverCallBlockedByPendingDeletion();
    await serverCallBlockedByPendingDeletion();
    expect(asked).toBe(3);
  });

  it('does not brick every write when the gate itself throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerServerCallGate(async () => { throw new Error('gate exploded'); });
    expect(await serverCallBlockedByPendingDeletion()).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('is cleared on unmount', async () => {
    registerServerCallGate(async () => ({ kind: 'pending' }));
    expect(await serverCallBlockedByPendingDeletion()).toBe(true);
    registerServerCallGate(null);
    expect(await serverCallBlockedByPendingDeletion()).toBe(false);
  });
});

describe('REGRESSION: no server mutation outside the store bypasses the gate', () => {
  beforeEach(() => {
    calls.length = 0;
    registerServerCallGate(async () => ({ kind: 'pending' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
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
    registerServerCallGate(async () => ({ kind: 'clear' }));
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
    registerServerCallGate(async () => ({ kind: 'unknown' }));
    calls.length = 0;
    const trips = await import('@/lib/trips');
    await trips.deleteTripFromDB('trip-1', 'couple-1');
    expect(calls).toContain('from:trips');
  });
});
