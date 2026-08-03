import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isSchemaCacheMiss, schemaCacheMissLog } from '@/lib/serverErrors';

/**
 * PGRST202 is a DEPLOYMENT state, and the client used to hide it.
 *
 * PostgREST answers `PGRST202` when a function is not in its schema cache, which
 * happens either because the migration was never applied or because it was
 * applied and the cache was never reloaded. Migration 017 removes the second
 * cause for future applies (it issues the reload itself), but a client that
 * reports the state as an anonymous failure is still unfixable in the field:
 *
 *  - `fetchMyCoupleState` only had a COMMENT saying PGRST202 means 016 is
 *    unapplied, and folded the cause into a generic reason;
 *  - `reorderTripItemsInDB` and `disconnectCoupleFromDB` returned a silent
 *    `false`, indistinguishable from an RLS rejection or a dead network.
 *
 * The user-facing copy is deliberately unchanged: it is already honest and
 * already fail-closed ("계정 정보를 확인하지 못했어요"), and there is nothing a user
 * can do about an unapplied migration. What changes is that the operator is told
 * which deploy step is missing.
 */

const PGRST202 = { code: 'PGRST202', message: 'Could not find the function in the schema cache' };

describe('the PGRST202 diagnostic itself', () => {
  it('recognises only PGRST202', () => {
    expect(isSchemaCacheMiss(PGRST202)).toBe(true);
    expect(isSchemaCacheMiss({ code: '42501' })).toBe(false);
    expect(isSchemaCacheMiss({ code: 'PGRST301' })).toBe(false);
    expect(isSchemaCacheMiss(new Error('Could not find the function'))).toBe(false);
    expect(isSchemaCacheMiss(null)).toBe(false);
  });

  it('names the RPC, the migration and the remedy', () => {
    const log = schemaCacheMissLog('get_my_couple_state', '016');
    expect(log).toContain('get_my_couple_state');
    expect(log).toContain('PGRST202');
    expect(log).toContain('016');
    // Without the remedy the log is just a different way of saying "failed".
    expect(log).toContain('reload');
  });
});

/** One configured Supabase module per test, with a controllable `rpc`. */
async function loadSupabase(rpc: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } } }) },
      rpc,
    }),
  }));
  vi.doMock('@/lib/platform', () => ({
    authRedirectUrl: () => 'http://localhost',
    isNativePlatform: () => false,
  }));
  vi.doMock('@/lib/accountDeletion', () => ({
    serverCallBlockedByPendingDeletion: vi.fn().mockResolvedValue(false),
    classifyDeletionErrorBody: vi.fn(),
    classifyDeletionSuccess: vi.fn(),
  }));
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key');
  return import('@/lib/supabase');
}

async function loadTrips(rpc: ReturnType<typeof vi.fn>) {
  await loadSupabase(rpc);
  return import('@/lib/trips');
}

describe('the three call sites that used to swallow PGRST202', () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('fetchMyCoupleState reports the deploy gap and still fails closed', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: PGRST202 });
    const { fetchMyCoupleState } = await loadSupabase(rpc);

    const result = await fetchMyCoupleState();

    // Fail-closed behaviour is preserved: an unanswered question must never be
    // rendered as "you have no couple space".
    expect(result).toEqual({ ok: false, reason: 'server' });
    expect(errors.some((line) => line.includes('PGRST202') && line.includes('016'))).toBe(true);
    expect(errors.some((line) => line.includes('reload'))).toBe(true);
  });

  it('disconnectCoupleFromDB reports the deploy gap instead of a bare false', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: PGRST202 });
    const { disconnectCoupleFromDB } = await loadSupabase(rpc);

    expect(await disconnectCoupleFromDB()).toBe(false);
    expect(errors.some((line) =>
      line.includes('disconnect_couple') && line.includes('PGRST202') && line.includes('015'),
    )).toBe(true);
  });

  it('reorderTripItemsInDB reports the deploy gap instead of a bare false', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: PGRST202 });
    const { reorderTripItemsInDB } = await loadTrips(rpc);

    expect(await reorderTripItemsInDB([
      { id: 'item-1', sortOrder: 1 },
      { id: 'item-2', sortOrder: 0 },
    ])).toBe(false);
    expect(errors.some((line) =>
      line.includes('reorder_trip_items') && line.includes('PGRST202') && line.includes('015'),
    )).toBe(true);
  });

  it('PRESERVATION: an ordinary failure keeps its existing generic log', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    const { disconnectCoupleFromDB } = await loadSupabase(rpc);

    expect(await disconnectCoupleFromDB()).toBe(false);
    // A permission failure is NOT a deploy gap and must not be reported as one.
    expect(errors.some((line) => line.includes('PGRST202'))).toBe(false);
    expect(errors.some((line) => line.includes('Error in disconnect_couple RPC'))).toBe(true);
  });

  it('PRESERVATION: a successful call logs nothing and reports success', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const { disconnectCoupleFromDB } = await loadSupabase(rpc);

    expect(await disconnectCoupleFromDB()).toBe(true);
    expect(errors).toEqual([]);
  });
});
