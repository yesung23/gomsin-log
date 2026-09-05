import { describe, expect, it, vi } from 'vitest';
import {
  inclusiveTripDates,
  parseTripPeriodParams,
  reconcileParentTrips,
  recordsInInclusiveRange,
  validateTripDraft,
  validateTripItemUrl,
  validateTripRangeAgainstItems,
} from '@/lib/trips';

vi.mock('@/lib/accountDeletion', () => ({
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

const { mockUpdatePayload, mockEq, mockSupabase } = vi.hoisted(() => {
  const mockUpdatePayload = vi.fn();
  /**
   * Records every `.eq()` predicate. The builder has to be chainable because the
   * scoped mutations apply two of them -- the row id AND its parent -- so that a
   * widened RLS policy cannot turn a stale id into a cross-couple write. A
   * single-`eq` fixture could not observe the second predicate at all.
   */
  const mockEq = vi.fn();
  const mockSupabase = {
    from: vi.fn(() => ({
      update: (payload: Record<string, unknown>) => {
        mockUpdatePayload(payload);
        const builder: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            mockEq(column, value);
            return builder;
          },
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: 'item-1', trip_id: 'trip-1', item_date: '2026-08-10', title: 'updated', category: 'food', memo: null, url: null, sort_order: 1, updated_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' },
                error: null,
              }),
          }),
        };
        return builder;
      },
    })),
  };
  return { mockUpdatePayload, mockEq, mockSupabase };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

describe('trip planner helpers', () => {
  it('validates required trip fields and chronological dates', () => {
    expect(validateTripDraft({ title: '  ', startDate: '2026-08-10', endDate: '2026-08-12' })).toContain('이름');
    expect(validateTripDraft({ title: '부산', startDate: '', endDate: '2026-08-12' })).toContain('가는 날');
    expect(validateTripDraft({ title: '부산', startDate: '2026-08-10', endDate: '' })).toContain('오는 날');
    expect(validateTripDraft({ title: '부산', startDate: '2026-08-12', endDate: '2026-08-10' })).toContain('빠를');
    expect(validateTripDraft({ title: ' 부산 ', startDate: '2026-08-10', endDate: '2026-08-10' })).toBeNull();
  });

  it('rejects shrinking a trip around existing itinerary dates', () => {
    expect(validateTripRangeAgainstItems(
      { startDate: '2026-08-10', endDate: '2026-08-12' },
      [{ itemDate: '2026-08-09' }],
    )).toContain('기존 일정');
    expect(validateTripRangeAgainstItems(
      { startDate: '2026-08-10', endDate: '2026-08-12' },
      [{ itemDate: '2026-08-10' }, { itemDate: '2026-08-12' }],
    )).toBeNull();
  });

  it('accepts only optional http and https itinerary links', () => {
    expect(validateTripItemUrl('')).toBeNull();
    expect(validateTripItemUrl('https://example.com/place')).toBeNull();
    expect(validateTripItemUrl('http://example.com')).toBeNull();
    expect(validateTripItemUrl('javascript:alert(1)')).toContain('http');
    expect(validateTripItemUrl('not a url')).toContain('올바른');
  });

  it('rejects URLs over 2048 characters', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2040);
    expect(validateTripItemUrl(longUrl)).toContain('길어');
  });

  it('rejects URLs with whitespace', () => {
    expect(validateTripItemUrl('https://exam ple.com/path')).toContain('올바른');
  });

  it('rejects URLs without a hostname', () => {
    expect(validateTripItemUrl('http://')).toContain('올바른');
  });

  it('builds inclusive date tabs across a month boundary', () => {
    expect(inclusiveTripDates('2026-08-31', '2026-09-02')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('reconciles parent trip snapshots by id without duplicate rows', () => {
    const base = {
      coupleId: 'couple-1',
      createdBy: 'user-a',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      status: 'planned' as const,
      createdAt: '2026-08-01T00:00:00Z',
    };
    expect(reconcileParentTrips([
      { ...base, id: 'trip-1', title: '이전 제목' },
      { ...base, id: 'trip-2', title: '부산' },
      { ...base, id: 'trip-1', title: '새 제목' },
    ])).toEqual([
      { ...base, id: 'trip-1', title: '새 제목' },
      { ...base, id: 'trip-2', title: '부산' },
    ]);
  });

  it('parses valid period queries and filters records inclusively', () => {
    const period = parseTripPeriodParams(new URLSearchParams('from=2026-08-10&to=2026-08-12&trip=trip-1'));
    expect(period).toEqual({ from: '2026-08-10', to: '2026-08-12', tripId: 'trip-1' });
    expect(recordsInInclusiveRange([
      { date: '2026-08-09' },
      { date: '2026-08-10' },
      { date: '2026-08-12' },
      { date: '2026-08-13' },
    ], period!.from, period!.to)).toEqual([
      { date: '2026-08-10' },
      { date: '2026-08-12' },
    ]);
    expect(parseTripPeriodParams(new URLSearchParams('from=2026-02-30&to=2026-03-01&trip=trip-1'))).toBeNull();
    expect(parseTripPeriodParams(new URLSearchParams('from=2026-08-12&to=2026-08-10&trip=trip-1'))).toBeNull();
  });
});

describe('updateTripItemInDB', () => {
  it('does not send topology columns', async () => {
    const { updateTripItemInDB } = await import('@/lib/trips');
    mockUpdatePayload.mockClear();
    mockEq.mockClear();

    await updateTripItemInDB({
      id: 'item-1',
      tripId: 'trip-1',
      itemDate: '2026-08-10',
      title: '해운대',
      category: 'activity',
      memo: 'fun',
      url: 'https://example.com',
      sortOrder: 3,
    });

    expect(mockUpdatePayload).toHaveBeenCalledTimes(1);
    const payload = mockUpdatePayload.mock.calls[0][0];
    expect(payload).toHaveProperty('title');
    expect(payload).toHaveProperty('category');
    expect(payload).toHaveProperty('memo');
    expect(payload).toHaveProperty('url');
    expect(payload).not.toHaveProperty('trip_id');
    expect(payload).not.toHaveProperty('item_date');
    expect(payload).not.toHaveProperty('sort_order');
  });

  /**
   * `trip_id` must not be in the update PAYLOAD (the database rejects a statement
   * that names it outside `reorder_trip_items`) but it MUST be in the WHERE clause.
   * Those two requirements pull in opposite directions, which is how the predicate
   * came to be missing while the test above still passed.
   */
  it('scopes the update to the parent trip, not to the item id alone', async () => {
    const { updateTripItemInDB } = await import('@/lib/trips');
    mockEq.mockClear();

    await updateTripItemInDB({
      id: 'item-1',
      tripId: 'trip-1',
      itemDate: '2026-08-10',
      title: '해운대',
      category: 'activity',
      sortOrder: 3,
    });

    expect(mockEq.mock.calls).toEqual([
      ['id', 'item-1'],
      ['trip_id', 'trip-1'],
    ]);
  });

  it('issues no request at all without a parent trip to scope to', async () => {
    const { updateTripItemInDB } = await import('@/lib/trips');
    mockUpdatePayload.mockClear();
    mockEq.mockClear();

    const result = await updateTripItemInDB({
      id: 'item-1',
      tripId: '',
      itemDate: '2026-08-10',
      title: '해운대',
      category: 'activity',
      sortOrder: 3,
    });

    expect(result).toBeNull();
    expect(mockUpdatePayload).not.toHaveBeenCalled();
    expect(mockEq).not.toHaveBeenCalled();
  });
});

describe('updateTripInDB', () => {
  it('scopes the update to the caller couple, not to the trip id alone', async () => {
    const { updateTripInDB } = await import('@/lib/trips');
    mockEq.mockClear();

    await updateTripInDB('trip-1', { title: '부산' }, 'couple-1');

    expect(mockEq.mock.calls).toEqual([
      ['id', 'trip-1'],
      ['couple_id', 'couple-1'],
    ]);
  });

  it('issues no request at all without a couple to scope to', async () => {
    const { updateTripInDB } = await import('@/lib/trips');
    mockUpdatePayload.mockClear();
    mockEq.mockClear();

    expect(await updateTripInDB('trip-1', { title: '부산' }, '')).toBeNull();
    expect(mockUpdatePayload).not.toHaveBeenCalled();
    expect(mockEq).not.toHaveBeenCalled();
  });
});

describe('toggleTripChecklistInDB', () => {
  it('scopes the toggle to the parent trip, not to the checklist id alone', async () => {
    const { toggleTripChecklistInDB } = await import('@/lib/trips');
    mockEq.mockClear();

    await toggleTripChecklistInDB('checklist-1', true, 'trip-1');

    expect(mockEq.mock.calls).toEqual([
      ['id', 'checklist-1'],
      ['trip_id', 'trip-1'],
    ]);
  });

  it('issues no request at all without a parent trip to scope to', async () => {
    const { toggleTripChecklistInDB } = await import('@/lib/trips');
    mockUpdatePayload.mockClear();
    mockEq.mockClear();

    expect(await toggleTripChecklistInDB('checklist-1', true, '')).toBe(false);
    expect(mockUpdatePayload).not.toHaveBeenCalled();
    expect(mockEq).not.toHaveBeenCalled();
  });
});
