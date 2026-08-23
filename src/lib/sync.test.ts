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

const mockFetchRecordsResultFromDB = vi.hoisted(() => vi.fn());
const mockFetchEventsResultFromDB = vi.hoisted(() => vi.fn());
const mockFetchTripsResultFromDB = vi.hoisted(() => vi.fn());
const mockFetchTalkAboutMarksResultFromDB = vi.hoisted(() => vi.fn());
const mockVisibleRecordsForViewer = vi.hoisted(() => vi.fn());

vi.mock('@/lib/records', () => ({
  fetchRecordsResultFromDB: mockFetchRecordsResultFromDB,
}));

vi.mock('@/lib/events', () => ({
  fetchEventsResultFromDB: mockFetchEventsResultFromDB,
}));

vi.mock('@/lib/trips', () => ({
  fetchTripsResultFromDB: mockFetchTripsResultFromDB,
}));

vi.mock('@/lib/talkAbout', () => ({
  fetchTalkAboutMarksResultFromDB: mockFetchTalkAboutMarksResultFromDB,
}));

vi.mock('@/lib/privacy', () => ({
  visibleRecordsForViewer: mockVisibleRecordsForViewer,
}));

import { fetchFullStateFromDB, fetchFullStateResultFromDB, FULL_STATE_UNAVAILABLE } from '@/lib/sync';
import type { AppState } from '@/types';

function requireState(
  result: Partial<AppState> | null | typeof FULL_STATE_UNAVAILABLE,
): Partial<AppState> {
  expect(result).not.toBeNull();
  expect(result).not.toBe(FULL_STATE_UNAVAILABLE);
  if (!result || result === FULL_STATE_UNAVAILABLE) {
    throw new Error('Expected a full state result');
  }
  return result;
}

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
  username: 'test_user',
  profile_caption: '테스트 소개',
  profile_date_type: 'together',
};

function setupProfileMock(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

function setupMemberMock(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eqStatus = vi.fn().mockReturnValue({ maybeSingle });
  const eqUserId = vi.fn().mockReturnValue({ eq: eqStatus });
  const select = vi.fn().mockReturnValue({ eq: eqUserId });
  return { select, eqUserId, eqStatus, maybeSingle };
}

function setupCoupleMock(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, single };
}

function setupContactMock(data: unknown = null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

describe('fetchFullStateFromDB', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockFetchRecordsResultFromDB.mockReset();
    mockFetchEventsResultFromDB.mockReset();
    mockFetchTripsResultFromDB.mockReset();
    mockFetchTalkAboutMarksResultFromDB.mockReset();
    mockVisibleRecordsForViewer.mockReset();

    mockFetchRecordsResultFromDB.mockResolvedValue({ ok: true, records: [] });
    mockFetchEventsResultFromDB.mockResolvedValue({ ok: true, events: [] });
    mockFetchTripsResultFromDB.mockResolvedValue({ ok: true, trips: [] });
    mockFetchTalkAboutMarksResultFromDB.mockResolvedValue({ ok: true, marks: [] });
    mockVisibleRecordsForViewer.mockReturnValue([]);
  });

  it('returns unavailable when the profile query fails', async () => {
    const profileChain = setupProfileMock(null, { message: 'network unavailable' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateFromDB(userId);

    expect(result).toBe(FULL_STATE_UNAVAILABLE);
  });

  /**
   * Absent profile + membership lookup outcomes.
   *
   * The original version of the first test here mocked `couple_members` as
   * `{ select: vi.fn() }`, so `select()` returned `undefined` and the chain threw
   * `Cannot read properties of undefined (reading 'eq')`. The exception was
   * swallowed and the assertion still saw `null`, so the test passed without ever
   * exercising a verified-empty lookup. Each case below now supplies a complete
   * chain and pins one distinct outcome.
   */
  it('returns null only when the profile is verified absent', async () => {
    const profileChain = setupProfileMock(null);
    // Complete chain, resolving to a genuinely empty membership result.
    const memberChain = setupMemberMock(null);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateFromDB(userId);

    expect(result).toBeNull();
    // Proof the lookup really ran instead of throwing on an incomplete mock.
    expect(memberChain.maybeSingle).toHaveBeenCalled();
  });

  it('resumes into the existing couple space when the profile is absent but an active membership exists', async () => {
    const coupleId = 'couple-resume-1';
    const profileChain = setupProfileMock(null);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'soldier' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      return { select: vi.fn() };
    });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.coupleId).toBe(coupleId);
    expect(result.profile!.couple.status).toBe('pending');
    expect(result.profile!.couple.connected).toBe(false);
    expect(result.profile!.role).toBe('soldier');
    // The profile row genuinely is missing, so onboarding must still finish.
    expect(result.setupComplete).toBe(false);
  });

  it('returns unavailable, not a new account, when the membership query errors', async () => {
    const profileChain = setupProfileMock(null);
    // `42501` is an RLS rejection: authoritative proof that we were NOT told
    // membership is absent.
    const memberChain = setupMemberMock(null, { code: '42501', message: 'permission denied' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateFromDB(userId);

    expect(result).toBe(FULL_STATE_UNAVAILABLE);
    expect(result).not.toBeNull();
  });

  it('classifies the membership query failure reason instead of guessing', async () => {
    const profileChain = setupProfileMock(null);
    const memberChain = setupMemberMock(null, { code: '42501', message: 'permission denied' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateResultFromDB(userId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected an unavailable result');
    expect(result.reason).toBe('forbidden');
    expect(result.stage).toBe('membership');
  });

  it('preserves the failing slice as a safe support stage', async () => {
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(null);
    const contactChain = setupContactMock(null, { code: '42703', message: 'missing column' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateResultFromDB(userId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected an unavailable result');
    expect(result).toMatchObject({ reason: 'server', stage: 'contact', code: '42703' });
  });

  it('returns unavailable when the membership lookup throws', async () => {
    const profileChain = setupProfileMock(null);
    const maybeSingle = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const eqStatus = vi.fn().mockReturnValue({ maybeSingle });
    const eqUserId = vi.fn().mockReturnValue({ eq: eqStatus });
    const memberSelect = vi.fn().mockReturnValue({ eq: eqUserId });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberSelect };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateFromDB(userId);

    // The critical assertion: a thrown lookup must never be reported as the
    // verified new-account `null` state.
    expect(result).toBe(FULL_STATE_UNAVAILABLE);
    expect(result).not.toBeNull();
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

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.connected).toBe(false);
    expect(result.profile!.couple.status).toBe('pending');
  });

  it('maps profile identity fields when the new schema is available', async () => {
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(null);
    const contactChain = setupContactMock();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile).toMatchObject({
      username: 'test_user',
      profileCaption: '테스트 소개',
      profileDateType: 'together',
    });
  });

  it('retries the old profile columns when migration 057 is not applied', async () => {
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'missing column' } })
      .mockResolvedValueOnce({ data: { ...profileRow, username: undefined, profile_caption: undefined, profile_date_type: undefined }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const profileChain = { select, eq, maybeSingle };
    const memberChain = setupMemberMock(null);
    const contactChain = setupContactMock();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(profileChain.select).toHaveBeenNthCalledWith(1, expect.stringContaining('username'));
    expect(profileChain.select).toHaveBeenNthCalledWith(2, 'id, display_name, role, avatar_path, military_info, onboarding_completed_at');
    expect(result.profile?.username).toBeUndefined();
    expect(result.profile?.profileCaption).toBeUndefined();
    expect(result.profile?.profileDateType).toBeUndefined();
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

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.connected).toBe(true);
    expect(result.profile!.couple.status).toBe('active');
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

    expect(mockFetchRecordsResultFromDB).toHaveBeenCalledWith(coupleId);
    expect(mockFetchTripsResultFromDB).toHaveBeenCalledWith(coupleId);
  });

  it('does NOT fetch records or trips when couple is disconnected', async () => {
    // No active membership means this completed account no longer has a couple
    // workspace. It must be modelled as disconnected, not as an invitation that
    // is still waiting for a partner.
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(null); // no active membership
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile?.couple.status).toBe('disconnected');
    expect(mockFetchRecordsResultFromDB).not.toHaveBeenCalled();
    expect(mockFetchTripsResultFromDB).not.toHaveBeenCalled();
  });

  it('returns unavailable when membership cannot be verified', async () => {
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(null, { message: 'membership unavailable' });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      return { select: vi.fn() };
    });

    const result = await fetchFullStateFromDB(userId);

    expect(result).toBe(FULL_STATE_UNAVAILABLE);
    expect(mockFetchRecordsResultFromDB).not.toHaveBeenCalled();
    expect(mockFetchTripsResultFromDB).not.toHaveBeenCalled();
    expect(mockFetchEventsResultFromDB).not.toHaveBeenCalled();
  });

  it('returns unavailable when couple details cannot be verified', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'gomsin' });
    const coupleChain = setupCoupleMock(null, { message: 'couple unavailable' });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      return { select: vi.fn() };
    });

    expect(await fetchFullStateFromDB(userId)).toBe(FULL_STATE_UNAVAILABLE);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFetchRecordsResultFromDB).not.toHaveBeenCalled();
  });

  it('returns unavailable when the partner lookup fails', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'gomsin' });
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: null, status: 'active' });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      return { select: vi.fn() };
    });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'partner unavailable' } });

    expect(await fetchFullStateFromDB(userId)).toBe(FULL_STATE_UNAVAILABLE);
    expect(mockFetchRecordsResultFromDB).not.toHaveBeenCalled();
    expect(mockFetchEventsResultFromDB).not.toHaveBeenCalled();
  });

  it('returns unavailable when contact preferences cannot be verified', async () => {
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(null);
    const contactChain = setupContactMock(null, { message: 'contact unavailable' });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });

    expect(await fetchFullStateFromDB(userId)).toBe(FULL_STATE_UNAVAILABLE);
    expect(mockFetchEventsResultFromDB).not.toHaveBeenCalled();
  });

  it.each([
    ['records', () => mockFetchRecordsResultFromDB.mockResolvedValue({ ok: false, records: [], error: new Error('records unavailable') })],
    ['events', () => mockFetchEventsResultFromDB.mockResolvedValue({ ok: false, reason: 'error' })],
    ['trips', () => mockFetchTripsResultFromDB.mockResolvedValue({ ok: false, reason: 'error' })],
    ['talk-about', () => mockFetchTalkAboutMarksResultFromDB.mockResolvedValue({ ok: false, error: new Error('marks unavailable') })],
  ])('returns unavailable when the %s slice cannot be fetched', async (_slice, failSlice) => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock({ couple_id: coupleId, status: 'active', role: 'gomsin' });
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: null, status: 'active' });
    const contactChain = setupContactMock();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });
    mockRpc.mockResolvedValue({ data: [{ display_name: 'Partner' }], error: null });
    failSlice();

    expect(await fetchFullStateFromDB(userId)).toBe(FULL_STATE_UNAVAILABLE);
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
    expect(mockFetchEventsResultFromDB).toHaveBeenCalledWith(undefined);
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
    mockFetchRecordsResultFromDB.mockResolvedValue({ ok: true, records: rawRecords });
    mockVisibleRecordsForViewer.mockReturnValue([{ id: 'rec-1', userId, date: '2026-01-01', authorRole: 'gomsin' }]);

    await fetchFullStateFromDB(userId);

    expect(mockVisibleRecordsForViewer).toHaveBeenCalledTimes(1);
    // Check it was called with mapped records and a viewer object
    const [records, viewer] = mockVisibleRecordsForViewer.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(viewer).toEqual({ userId, role: 'gomsin' });
  });
});
