import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  payload: null as null | Record<string, unknown>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  barrierCalls: 0,
}));

vi.mock('@/lib/accountDeletion', () => ({
  runServerMutationBehindDeletionBarrier: async (
    operation: (context: { userId: string; assertCurrent: () => void }) => Promise<unknown>,
    options: { expectedUserId: string | 'current' },
  ) => {
    database.barrierCalls += 1;
    const expectedUserId = options.expectedUserId === 'current' ? 'user-b' : options.expectedUserId;
    if (expectedUserId !== 'user-b') return { kind: 'blocked' };
    return {
      kind: 'executed',
      value: await operation({ userId: expectedUserId, assertCurrent: () => {} }),
    };
  },
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      // Simulate the session having switched to B after A initiated the action.
      getSession: async () => ({ data: { session: { user: { id: 'user-b' } } } }),
    },
    from: (table: string) => ({
      select: () => {
        const query = {
          eq: (column: string, value: unknown) => {
            database.filters.push({ table, column, value });
            return query;
          },
          order: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return query;
      },
      upsert: (payload: Record<string, unknown>) => {
        database.payload = payload;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'daily-log',
                ...payload,
                created_at: '2026-08-14T00:00:00.000Z',
                updated_at: '2026-08-14T00:00:00.000Z',
              },
              error: null,
            }),
          }),
        };
      },
    }),
  },
}));

const {
  fetchCycleDailyLogsResultFromDB,
  fetchCyclePeriodsResultFromDB,
  fetchCycleSettingsResultFromDB,
  saveCycleDailyLogToDB,
} = await import('@/lib/cycle');

describe('cycle writes preserve the account that initiated them', () => {
  beforeEach(() => {
    database.payload = null;
    database.filters = [];
    database.barrierCalls = 0;
  });

  it('blocks an A daily-log action after the current account has switched to B', async () => {
    const result = await saveCycleDailyLogToDB(
      '2026-08-14',
      ['headache'],
      {},
      'user-a',
    );

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(database.barrierCalls).toBe(1);
    expect(database.payload).toBeNull();
  });

  it('pins every raw-health read to A even if the live session has changed to B', async () => {
    await Promise.all([
      fetchCyclePeriodsResultFromDB('user-a'),
      fetchCycleDailyLogsResultFromDB('user-a'),
      fetchCycleSettingsResultFromDB('user-a'),
    ]);

    expect(database.filters).toEqual([
      { table: 'cycle_periods', column: 'user_id', value: 'user-a' },
      { table: 'cycle_daily_logs', column: 'user_id', value: 'user-a' },
      { table: 'cycle_settings', column: 'user_id', value: 'user-a' },
    ]);
  });
});
