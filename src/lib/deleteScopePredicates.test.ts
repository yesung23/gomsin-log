import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * DEF-09. Event and trip deletes were `id`-only.
 *
 * Ownership rested entirely on the RLS policies (`014:96-107` for events), which
 * are correct today -- the UI boundary is correct too, and the browser
 * reproduction confirmed a partner is offered no delete control at all. But the
 * records path already does this properly (`records.ts` filters on `user_id` AND
 * `couple_id` and treats 0 rows as `not_found`), and the asymmetry meant a policy
 * ever widened to couple scope would have no client-side barrier behind it.
 *
 * These are defence-in-depth assertions: they pin that the predicate is part of
 * the REQUEST, and that a delete cannot be issued without the scope it needs.
 */

type Recorded = { table: string; eqs: Array<[string, unknown]> };

const h = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  rowResult: { data: { id: 'row-1' } as unknown, error: null as unknown },
}));

vi.mock('@/lib/accountDeletion', () => ({
  serverCallBlockedByPendingDeletion: vi.fn().mockResolvedValue(false),
  runServerMutationBehindDeletionBarrier: async (
    operation: (context: { userId: string; assertCurrent: () => void }) => Promise<unknown>,
    options: { expectedUserId: string | 'current' },
  ) => ({
    kind: 'executed',
    value: await operation({
      userId: options.expectedUserId === 'current' ? 'user-a' : options.expectedUserId,
      assertCurrent: () => {},
    }),
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const entry: Recorded = { table, eqs: [] };
      h.recorded.push(entry);
      const chain: Record<string, unknown> = {};
      chain.delete = () => chain;
      chain.eq = (column: string, value: unknown) => {
        entry.eqs.push([column, value]);
        return chain;
      };
      chain.select = () => chain;
      chain.maybeSingle = async () => h.rowResult;
      return chain;
    },
  },
  isSupabaseConfigured: true,
}));

const trips = await import('@/lib/trips');

describe('trip deletes carry the scope they belong to', () => {
  beforeEach(() => {
    h.recorded.length = 0;
    h.rowResult = { data: { id: 'row-1' }, error: null };
  });

  it('scopes a trip delete to the couple', async () => {
    expect(await trips.deleteTripFromDB('trip-1', 'couple-1')).toBe(true);
    expect(h.recorded).toEqual([
      { table: 'trips', eqs: [['id', 'trip-1'], ['couple_id', 'couple-1']] },
    ]);
  });

  it('scopes a trip item delete to its parent trip', async () => {
    // Trip items are couple-SHARED by design, so the parent trip -- not the
    // author -- is the correct boundary here.
    expect(await trips.deleteTripItemFromDB('item-1', 'trip-1')).toBe(true);
    expect(h.recorded).toEqual([
      { table: 'trip_items', eqs: [['id', 'item-1'], ['trip_id', 'trip-1']] },
    ]);
  });

  it('scopes a checklist delete to its parent trip', async () => {
    expect(await trips.deleteTripChecklistFromDB('check-1', 'trip-1')).toBe(true);
    expect(h.recorded).toEqual([
      { table: 'trip_checklists', eqs: [['id', 'check-1'], ['trip_id', 'trip-1']] },
    ]);
  });

  it('issues no request when the scope is missing', async () => {
    expect(await trips.deleteTripFromDB('trip-1', '')).toBe(false);
    expect(await trips.deleteTripItemFromDB('item-1', '')).toBe(false);
    expect(await trips.deleteTripChecklistFromDB('check-1', '')).toBe(false);
    expect(h.recorded).toEqual([]);
  });

  it('still treats a 0-row delete as a failure', async () => {
    h.rowResult = { data: null, error: null };
    expect(await trips.deleteTripFromDB('trip-1', 'couple-1')).toBe(false);
    expect(await trips.deleteTripItemFromDB('item-1', 'trip-1')).toBe(false);
    expect(await trips.deleteTripChecklistFromDB('check-1', 'trip-1')).toBe(false);
  });
});
