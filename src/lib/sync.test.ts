import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockRpc, mockSupabase } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockSupabase = { from: mockFrom, rpc: mockRpc };
  return { mockFrom, mockRpc, mockSupabase };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

const mockFetchRecordsFromDB = vi.hoisted(() => vi.fn());
const mockFetchEventsFromDB = vi.hoisted(() => vi.fn());
const mockFetchTripsFromDB = vi.hoisted(() => vi.fn());
const mockVisibleRecordsForViewer = vi.hoisted(() => vi.fn());

vi.mock('@/lib/records', () => ({
  fetchRecordsFromDB: mockFetchRecordsFromDB,
}));

vi.mock('@/lib/events', () => ({
  fetchEventsFromDB: mockFetchEventsFromDB,
}));

vi.mock('@/lib/trips', () => ({
  fetchTripsFromDB: mockFetchTripsFromDB,
}));

vi.mock('@/lib/privacy', () => ({
  visibleRecordsForViewer: mockVisibleRecordsForViewer,
}));

import { fetchFullStateFromDB } from '@/lib/sync';

const userId = 'user-001';

const profileRow = {
  id: userId,
  display_name: 'Test User',
  role: 'gomsin',
  avatar_path: null,
  onboarding_completed_at: '2026-01-01T00:00:00Z',
  military_info: {
    branch: 'army',
    militaryStatus: 'serving',
    enlistmentDate: '2025-03-10',
    expectedDischargeDate: '2026-09-09',
    dischargeDateSource: 'calculated',
  },
};

function setupProfileMock(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, single };
}

function setupMemberMock(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eqStatus = vi.fn().mockReturnValue({ maybeSingle });
  const eqUserId = vi.fn().mockReturnValue({ eq: eqStatus });
  const select = vi.fn().mockReturnValue({ eq: eqUserId });
  return { select, eqUserId, eqStatus, maybeSingle };
}

function setupCoupleMock(data: unknown) {
  const single = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, single };
}

function setupContactMock(data: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

describe('fetchFullStateFromDB', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockFetchRecordsFromDB.mockReset();
    mockFetchEventsFromDB.mockReset();
    mockFetchTripsFromDB.mockReset();
    mockVisibleRecordsForViewer.mockReset();

    mockFetchRecordsFromDB.mockResolvedValue([]);
    mockFetchEventsFromDB.mockResolvedValue([]);
    mockFetchTripsFromDB.mockResolvedValue([]);
    mockVisibleRecordsForViewer.mockReturnValue([]);
  });

  it('returns null when profile fetch fails', async () => {
    const profileChain = setupProfileMock(null, { message: 'not found' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateFromDB(userId);

    expect(result).toBeNull();
  });

  it('returns a pending couple when no partner exists', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'gomsin' });
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: '2025-06-01', status: 'active' });
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    // No partner found
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await fetchFullStateFromDB(userId);

    expect(result).not.toBeNull();
    expect(result!.profile!.couple.connected).toBe(false);
    expect(result!.profile!.couple.status).toBe('pending');
  });

  it('returns an active couple when a partner exists', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'gomsin' });
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: '2025-06-01', status: 'active' });
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    // Partner found
    mockRpc.mockResolvedValue({ data: [{ display_name: 'Partner' }], error: null });

    const result = await fetchFullStateFromDB(userId);

    expect(result).not.toBeNull();
    expect(result!.profile!.couple.connected).toBe(true);
    expect(result!.profile!.couple.status).toBe('active');
  });

  it('fetches records and trips for a pending couple', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'gomsin' });
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: '2025-06-01', status: 'active' });
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    // No partner -> pending status, but coupleSpaceId still exists
    mockRpc.mockResolvedValue({ data: [], error: null });

    await fetchFullStateFromDB(userId);

    expect(mockFetchRecordsFromDB).toHaveBeenCalledWith(coupleId);
    expect(mockFetchTripsFromDB).toHaveBeenCalledWith(coupleId);
  });

  it('does NOT fetch records or trips when couple is disconnected', async () => {
    // When a couple is disconnected, the member's active status is revoked,
    // so the query with .eq('status', 'active') returns null.
    // This means couple.coupleId stays undefined, and coupleSpaceId is undefined.
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(null); // no active membership
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    await fetchFullStateFromDB(userId);

    expect(mockFetchRecordsFromDB).not.toHaveBeenCalled();
    expect(mockFetchTripsFromDB).not.toHaveBeenCalled();
  });

  it('always fetches events (private schedules survive disconnect)', async () => {
    // When a couple is disconnected, the member's active status is revoked,
    // so memberData is null and couple.coupleId is undefined.
    // Events should still be fetched with coupleSpaceId=undefined (private schedules).
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(null); // no active membership
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    await fetchFullStateFromDB(userId);

    // Events should be fetched with coupleSpaceId=undefined (since disconnected)
    expect(mockFetchEventsFromDB).toHaveBeenCalledWith(undefined);
  });

  it('applies visibleRecordsForViewer to filter records', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'gomsin' });
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: '2025-06-01', status: 'active' });
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    // Partner exists -> active couple -> coupleSpaceId exists -> records fetched
    mockRpc.mockResolvedValue({ data: [{ display_name: 'Partner' }], error: null });

    const rawRecords = [{ id: 'rec-1', userId, date: '2026-01-01' }];
    mockFetchRecordsFromDB.mockResolvedValue(rawRecords);
    mockVisibleRecordsForViewer.mockReturnValue([{ id: 'rec-1', userId, date: '2026-01-01', authorRole: 'gomsin' }]);

    await fetchFullStateFromDB(userId);

    expect(mockVisibleRecordsForViewer).toHaveBeenCalledTimes(1);
    // Check it was called with mapped records and a viewer object
    const [records, viewer] = mockVisibleRecordsForViewer.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(viewer).toEqual({ userId, role: 'gomsin' });
  });
});
