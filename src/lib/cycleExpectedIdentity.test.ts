import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  payload: null as null | Record<string, unknown>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock('@/lib/accountDeletion', () => ({
  serverCallBlockedByPendingDeletion: async () => false,
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
  });

  it('never retargets an A daily-log action to a later B session', async () => {
    await saveCycleDailyLogToDB(
      '2026-08-14',
      ['headache'],
      {},
      'user-a',
    );

    // If the request uses B, RLS sees a valid B-owned write and cannot know it
    // originated from A's stale UI. Pinning A makes a later B token fail closed.
    expect(database.payload).toMatchObject({
      user_id: 'user-a',
      log_date: '2026-08-14',
    });
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
