import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchEventsResultFromDB,
  saveEventToDB,
  deleteEventFromDB,
} from '@/lib/events';

const { mockFrom, mockRpc, mockSupabase, mockIsConfigured } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockSupabase = { from: mockFrom, rpc: mockRpc };
  const mockIsConfigured = { value: true };
  return { mockFrom, mockRpc, mockSupabase, mockIsConfigured };
});

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockIsConfigured.value ? mockSupabase : null;
  },
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
}));

describe('fetchEventsResultFromDB', () => {
  beforeEach(() => {
    mockIsConfigured.value = true;
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  it('returns error when supabase is not configured', async () => {
    mockIsConfigured.value = false;

    const result = await fetchEventsResultFromDB();

    expect(result).toEqual({ ok: false, reason: 'error' });
  });

  it('verifies membership when coupleId is provided', async () => {
    const coupleId = 'couple-123';
    mockRpc.mockResolvedValue({ data: coupleId, error: null });

    const row = {
      id: 'evt-1',
      couple_id: coupleId,
      created_by: 'user-1',
      title: 'Anniversary',
      event_type: 'anniversary',
      start_date: '2026-01-01',
      end_date: null,
      is_private: false,
      created_at: '2026-01-01T00:00:00Z',
    };

    const mockQuery = vi.fn().mockResolvedValue({ data: [row], error: null });
    const order = vi.fn().mockReturnValue(mockQuery);
    const select = vi.fn().mockReturnValue({ order });
    mockFrom.mockReturnValue({ select });
    // The query is awaited directly (no .eq since coupleId is provided)
    // Actually: let query = supabase.from('events').select('*').order(...)
    // then if (!coupleId) query = query.eq(...)
    // then const { data, error } = await query;
    // So when coupleId IS provided, order returns a thenable directly.
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [row], error: null }),
      }),
    });

    const result = await fetchEventsResultFromDB(coupleId);

    expect(mockRpc).toHaveBeenCalledWith('get_my_active_couple_id');
    expect(result).toEqual({
      ok: true,
      events: [{
        id: 'evt-1',
        coupleId,
        createdBy: 'user-1',
        title: 'Anniversary',
        eventType: 'anniversary',
        startDate: '2026-01-01',
        endDate: null,
        isPrivate: false,
        createdAt: '2026-01-01T00:00:00Z',
      }],
    });
  });

  it('returns forbidden when membership check fails', async () => {
    mockRpc.mockResolvedValue({ data: 'different-couple-id', error: null });

    const result = await fetchEventsResultFromDB('couple-123');

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('returns forbidden on 42501 error', async () => {
    // No coupleId, so no rpc call; query returns error with code 42501
    const eq = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    const order = vi.fn().mockReturnValue({ eq });
    const select = vi.fn().mockReturnValue({ order });
    mockFrom.mockReturnValue({ select });

    const result = await fetchEventsResultFromDB();

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('filters to private-only when no coupleId', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn().mockReturnValue({ eq });
    const select = vi.fn().mockReturnValue({ order });
    mockFrom.mockReturnValue({ select });

    await fetchEventsResultFromDB();

    expect(eq).toHaveBeenCalledWith('is_private', true);
  });

  it('maps raw DB rows to CoupleEvent shape', async () => {
    const row = {
      id: 'evt-2',
      couple_id: 'couple-abc',
      created_by: 'user-x',
      title: 'Date Night',
      event_type: 'date',
      start_date: '2026-03-14',
      end_date: '2026-03-15',
      is_private: true,
      created_at: '2026-03-01T12:00:00Z',
    };

    const eq = vi.fn().mockResolvedValue({ data: [row], error: null });
    const order = vi.fn().mockReturnValue({ eq });
    const select = vi.fn().mockReturnValue({ order });
    mockFrom.mockReturnValue({ select });

    const result = await fetchEventsResultFromDB();

    expect(result).toEqual({
      ok: true,
      events: [{
        id: 'evt-2',
        coupleId: 'couple-abc',
        createdBy: 'user-x',
        title: 'Date Night',
        eventType: 'date',
        startDate: '2026-03-14',
        endDate: '2026-03-15',
        isPrivate: true,
        createdAt: '2026-03-01T12:00:00Z',
      }],
    });
  });
});

describe('saveEventToDB', () => {
  beforeEach(() => {
    mockIsConfigured.value = true;
    mockFrom.mockReset();
  });

  it('sends the event with snake_case column names', async () => {
    const upsertPayload = vi.fn();
    const savedRow = {
      id: 'evt-new',
      couple_id: 'couple-1',
      created_by: 'user-1',
      title: 'Trip',
      event_type: 'trip',
      start_date: '2026-06-01',
      end_date: '2026-06-05',
      is_private: false,
      created_at: '2026-06-01T00:00:00Z',
    };

    const single = vi.fn().mockResolvedValue({ data: savedRow, error: null });
    const selectAfter = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockImplementation((payload) => {
      upsertPayload(payload);
      return { select: selectAfter };
    });
    mockFrom.mockReturnValue({ upsert });

    const event = {
      coupleId: 'couple-1',
      createdBy: 'user-1',
      title: 'Trip',
      eventType: 'trip' as const,
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      isPrivate: false,
    };

    const result = await saveEventToDB(event);

    expect(upsertPayload).toHaveBeenCalledTimes(1);
    const payload = upsertPayload.mock.calls[0][0];
    expect(payload).toHaveProperty('couple_id', 'couple-1');
    expect(payload).toHaveProperty('created_by', 'user-1');
    expect(payload).toHaveProperty('title', 'Trip');
    expect(payload).toHaveProperty('event_type', 'trip');
    expect(payload).toHaveProperty('start_date', '2026-06-01');
    expect(payload).toHaveProperty('end_date', '2026-06-05');
    expect(payload).toHaveProperty('is_private', false);
    expect(payload).toHaveProperty('updated_at');

    expect(result).toEqual({
      id: 'evt-new',
      coupleId: 'couple-1',
      createdBy: 'user-1',
      title: 'Trip',
      eventType: 'trip',
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      isPrivate: false,
      createdAt: '2026-06-01T00:00:00Z',
    });
  });

  it('returns null on error', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'upsert failed' } });
    const selectAfter = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select: selectAfter });
    mockFrom.mockReturnValue({ upsert });

    const event = {
      coupleId: 'couple-1',
      createdBy: 'user-1',
      title: 'Trip',
      eventType: 'trip' as const,
      startDate: '2026-06-01',
      isPrivate: false,
    };

    const result = await saveEventToDB(event);

    expect(result).toBeNull();
  });
});

describe('deleteEventFromDB', () => {
  beforeEach(() => {
    mockIsConfigured.value = true;
    mockFrom.mockReset();
  });

  it('returns true when a row is deleted', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select });
    const del = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ delete: del });

    const result = await deleteEventFromDB('evt-1');

    expect(result).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('events');
    expect(eq).toHaveBeenCalledWith('id', 'evt-1');
    expect(select).toHaveBeenCalledWith('id');
    expect(maybeSingle).toHaveBeenCalled();
  });

  it('returns false on error', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'delete failed' } });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select });
    const del = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ delete: del });

    const result = await deleteEventFromDB('evt-1');

    expect(result).toBe(false);
  });
});
