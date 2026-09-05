import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = ReturnType<typeof recordRow>;
type PageResult = { data: Row[] | null; error: unknown };

const mocks = vi.hoisted(() => ({
  pages: [] as PageResult[],
  pageRequests: [] as Array<{
    filters: string[];
    limits: number[];
    orders: Array<{ column: string; ascending?: boolean }>;
  }>,
  createSignedUrls: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(() => {
      const request = {
        filters: [] as string[],
        limits: [] as number[],
        orders: [] as Array<{ column: string; ascending?: boolean }>,
      };
      const pageIndex = mocks.pageRequests.push(request) - 1;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        or: vi.fn((filter: string) => {
          request.filters.push(filter);
          return builder;
        }),
        order: vi.fn((column: string, options?: { ascending?: boolean }) => {
          request.orders.push({ column, ascending: options?.ascending });
          return builder;
        }),
        limit: vi.fn((count: number) => {
          request.limits.push(count);
          return builder;
        }),
        then: <TResult1 = PageResult, TResult2 = never>(
          onfulfilled?: ((value: PageResult) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) => Promise.resolve(
          mocks.pages[pageIndex] ?? { data: [], error: null },
        ).then(onfulfilled, onrejected),
      };
      return builder;
    }),
    storage: {
      from: vi.fn(() => ({ createSignedUrls: mocks.createSignedUrls })),
    },
  },
}));

import { fetchRecordsResultFromDB } from '@/lib/records';

const COUPLE_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-09-05T01:00:00.000Z';

function uuidAt(position: number): string {
  return `22222222-2222-4222-8222-${position.toString(16).padStart(12, '0')}`;
}

function recordRow(position: number, overrides: Record<string, unknown> = {}) {
  const id = uuidAt(position);
  return {
    id,
    user_id: '33333333-3333-4333-8333-333333333333',
    couple_id: COUPLE_ID,
    record_date: '2026-09-05',
    record_time: '10:00:00',
    log_text: `기록 ${position}`,
    reaction: null,
    attachments: [],
    is_private: false,
    emotion_flow: [],
    emotion_updated_at: null,
    created_at: CREATED_AT,
    content_revision: 1,
    cipher_format: 0,
    ...overrides,
  };
}

function descendingRows(count: number, start = count): Row[] {
  return Array.from({ length: count }, (_, index) => recordRow(start - index));
}

beforeEach(() => {
  mocks.pages.length = 0;
  mocks.pageRequests.length = 0;
  mocks.createSignedUrls.mockReset().mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
    error: null,
  }));
});

describe('daily_records complete pagination', () => {
  it('loads all 1,005 authorized rows across the server row cap with a stable cursor', async () => {
    const rows = descendingRows(1_005);
    mocks.pages.push(
      { data: rows.slice(0, 500), error: null },
      { data: rows.slice(500, 1_000), error: null },
      { data: rows.slice(1_000), error: null },
      { data: [], error: null },
    );

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(1_005);
    expect(new Set(result.records.map((record) => record.id)).size).toBe(1_005);
    expect(result.records.map((record) => record.id)).toEqual(rows.map((row) => row.id));
    expect(mocks.pageRequests).toHaveLength(4);
    expect(mocks.pageRequests.every((request) => request.limits.includes(500))).toBe(true);
    expect(mocks.pageRequests[0].orders).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]);
    expect(mocks.pageRequests[1].filters[0]).toContain('created_at.lt.');
    expect(mocks.pageRequests[1].filters[0]).toContain(`id.lt.${rows[499].id}`);
  });

  it.each([1, 2, 100])(
    'keeps reading through a server max_rows cap of %i until an empty page',
    async (serverCap) => {
      const rows = descendingRows(serverCap * 2 + 1);
      for (let offset = 0; offset < rows.length; offset += serverCap) {
        mocks.pages.push({ data: rows.slice(offset, offset + serverCap), error: null });
      }
      mocks.pages.push({ data: [], error: null });

      const result = await fetchRecordsResultFromDB(COUPLE_ID);

      expect(result.ok).toBe(true);
      expect(result.records.map((record) => record.id)).toEqual(rows.map((row) => row.id));
      expect(mocks.pageRequests).toHaveLength(Math.ceil(rows.length / serverCap) + 1);
    },
  );

  it.each([500, 1_000])(
    'requires a final empty page when the authorized history is exactly %i rows',
    async (rowCount) => {
      const rows = descendingRows(rowCount);
      for (let offset = 0; offset < rows.length; offset += 500) {
        mocks.pages.push({ data: rows.slice(offset, offset + 500), error: null });
      }
      mocks.pages.push({ data: [], error: null });

      const result = await fetchRecordsResultFromDB(COUPLE_ID);

      expect(result.ok).toBe(true);
      expect(result.records).toHaveLength(rowCount);
      expect(mocks.pageRequests).toHaveLength(rowCount / 500 + 1);
    },
  );

  it('uses id as the deterministic tie-breaker when every boundary timestamp is identical', async () => {
    const rows = descendingRows(501);
    mocks.pages.push(
      { data: rows.slice(0, 500), error: null },
      { data: rows.slice(500), error: null },
      { data: [], error: null },
    );

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(true);
    expect(result.records.map((record) => record.id)).toEqual(rows.map((row) => row.id));
    expect(mocks.pageRequests[1].filters[0]).toContain(`created_at.eq.${CREATED_AT}`);
    expect(mocks.pageRequests[1].filters[0]).toContain(`id.lt.${rows[499].id}`);
  });

  it('preserves UTC microseconds in a strictly older timestamp cursor', async () => {
    const newest = recordRow(2, { created_at: '2026-09-05T01:00:00.123456Z' });
    const older = recordRow(1, { created_at: '2026-09-05T01:00:00.123455Z' });
    mocks.pages.push(
      { data: [newest], error: null },
      { data: [older], error: null },
      { data: [], error: null },
    );

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(true);
    expect(result.records.map((record) => record.id)).toEqual([newest.id, older.id]);
    expect(mocks.pageRequests[1].filters[0]).toContain(
      'created_at.lt.2026-09-05T01:00:00.123456Z',
    );
    expect(mocks.pageRequests[2].filters[0]).toContain(
      'created_at.lt.2026-09-05T01:00:00.123455Z',
    );
  });

  it('deduplicates a repeated boundary row without losing the following record', async () => {
    const first = descendingRows(500, 700);
    const next = recordRow(200);
    mocks.pages.push(
      { data: first, error: null },
      { data: [first.at(-1)!, next], error: null },
      { data: [], error: null },
    );

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(501);
    expect(new Set(result.records.map((record) => record.id)).size).toBe(501);
    expect(result.records.some((record) => record.id === next.id)).toBe(true);
  });

  it('fails the whole read when a later page fails instead of publishing a truncated prefix', async () => {
    mocks.pages.push(
      { data: descendingRows(2), error: null },
      { data: null, error: { code: 'PGRST500', message: 'later page failed' } },
    );

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it('fails closed when a broken backend repeats a full page without advancing the cursor', async () => {
    const samePage = descendingRows(500);
    mocks.pages.push(
      { data: samePage, error: null },
      { data: samePage, error: null },
    );

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(mocks.pageRequests).toHaveLength(2);
  });

  it('rejects a different cursor that moves newer instead of strictly older', async () => {
    const boundary = recordRow(100);
    const newer = recordRow(101);
    mocks.pages.push(
      { data: [boundary], error: null },
      { data: [newer], error: null },
    );

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(mocks.pageRequests).toHaveLength(2);
  });

  it.each([
    ['timestamp', { created_at: '2026-02-30T01:00:00.123456Z' }],
    ['UUID', { id: uuidAt(10).toUpperCase() }],
  ])('rejects a non-canonical %s cursor from the last row', async (_label, overrides) => {
    mocks.pages.push({ data: [recordRow(10, overrides)], error: null });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(mocks.pageRequests).toHaveLength(1);
  });

  it('rejects data:null with error:null instead of treating it as an empty final page', async () => {
    mocks.pages.push({ data: null, error: null });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
  });
});

describe('record attachment signing batches', () => {
  it('signs large authorized media sets in bounded batches and preserves every record', async () => {
    const rows = descendingRows(205).map((row, index) => ({
      ...row,
      attachments: [{
        type: 'photo',
        name: `photo-${index}.jpg`,
        path: `${COUPLE_ID}/${row.id}/${uuidAt(index + 10_000)}.jpg`,
      }],
    }));
    mocks.pages.push({ data: rows, error: null }, { data: [], error: null });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(205);
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(3);
    expect(mocks.createSignedUrls.mock.calls.map(([paths]) => paths.length)).toEqual([100, 100, 5]);
    expect(result.records.every((record) => record.attachments?.[0]?.url)).toBe(true);
  });
});
