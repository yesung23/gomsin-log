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

function setupMemberMock(
  data: unknown,
  error: unknown = null,
  partnerLookup?: () => Promise<{ data: unknown; error: unknown }>,
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const defaultPartnerRows = data
    && typeof data === 'object'
    && typeof (data as { couple_id?: unknown }).couple_id === 'string'
    ? [{ user_id: 'partner-001', joined_at: '2026-08-20T12:00:00Z' }]
    : [];
  const query = {
    eq: vi.fn(),
    neq: vi.fn(),
    limit: vi.fn(() => partnerLookup
      ? partnerLookup()
      : Promise.resolve({ data: defaultPartnerRows, error: null })),
    maybeSingle,
  };
  query.eq.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  const select = vi.fn().mockReturnValue(query);
  return { select, eq: query.eq, neq: query.neq, limit: query.limit, maybeSingle };
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
    const memberChain = setupMemberMock(
      { couple_id: coupleId, status: 'active', role: 'gomsin' },
      null,
      async () => ({ data: [], error: null }),
    );
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
    expect(result.profile!.couple.partnerUserId).toBeUndefined();
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

    // Partner found, then the sanitized partner service projection.
    mockRpc
      .mockResolvedValueOnce({ data: [{ display_name: 'Partner', username: 'partner_id' }], error: null })
      .mockResolvedValueOnce({
        data: [{
          branch: 'army',
          military_status: 'serving',
          enlistment_date: '2025-03-10',
          expected_discharge_date: '2026-09-09',
          discharge_date: null,
          discharge_date_source: 'calculated',
        }],
        error: null,
      });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.connected).toBe(true);
    expect(result.profile!.couple.status).toBe('active');
    expect(result.profile!.couple.partnerUserId).toBe('partner-001');
    expect(result.profile!.couple.partnerJoinedAt).toBe('2026-08-20T12:00:00Z');
    expect(result.profile!.couple.partnerUsername).toBe('partner_id');
    expect(result.profile!.couple.partnerMilitary).toEqual({
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2025-03-10',
      expectedDischargeDate: '2026-09-09',
      dischargeDateSource: 'calculated',
    });
    expect('memo' in (result.profile!.couple.partnerMilitary ?? {})).toBe(false);
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'get_partner_service_info');
    expect(memberChain.limit.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockRpc.mock.invocationCallOrder[1],
    );
  });

  it('keeps exact membership identity when the presentation profile has no row', async () => {
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
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple).toMatchObject({
      coupleId,
      connected: true,
      status: 'active',
      partnerName: '',
      partnerUserId: 'partner-001',
      partnerJoinedAt: '2026-08-20T12:00:00Z',
    });
  });

  it('discards stale presentation when final membership authority has zero rows', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(
      { couple_id: coupleId, status: 'active', role: 'gomsin' },
      null,
      async () => ({ data: [], error: null }),
    );
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: '2025-06-01', status: 'active' });
    const contactChain = setupContactMock();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      if (table === 'contact_preferences') return { select: contactChain.select };
      return { select: vi.fn() };
    });
    mockRpc
      .mockResolvedValueOnce({
        data: [{ display_name: 'Former Partner', username: 'former_partner' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{
          branch: 'army',
          military_status: 'serving',
          discharge_date_source: 'manual',
        }],
        error: null,
      });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple).toMatchObject({
      coupleId,
      connected: false,
      status: 'pending',
      partnerName: '',
    });
    expect(result.profile!.couple.partnerUserId).toBeUndefined();
    expect(result.profile!.couple.partnerJoinedAt).toBeUndefined();
    expect(result.profile!.couple.partnerUsername).toBeUndefined();
    expect(result.profile!.couple.partnerMilitary).toBeUndefined();
  });

  it.each([
    {
      label: 'query error',
      lookup: async () => ({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      }),
    },
    {
      label: 'throw',
      lookup: async () => { throw new TypeError('Failed to fetch'); },
    },
    {
      label: 'malformed row',
      lookup: async () => ({ data: [{ user_id: '', joined_at: null }], error: null }),
    },
    {
      label: 'multiple rows',
      lookup: async () => ({
        data: [
          { user_id: 'partner-001', joined_at: null },
          { user_id: 'partner-002', joined_at: null },
        ],
        error: null,
      }),
    },
  ])('reports $label as retryable partner-membership failure', async ({ lookup }) => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(
      { couple_id: coupleId, status: 'active', role: 'gomsin' },
      null,
      lookup,
    );
    const coupleChain = setupCoupleMock({ id: coupleId, anniversary_date: '2025-06-01', status: 'active' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: profileChain.select };
      if (table === 'couple_members') return { select: memberChain.select };
      if (table === 'couples') return { select: coupleChain.select };
      return { select: vi.fn() };
    });
    mockRpc.mockResolvedValue({ data: [{ display_name: 'Partner' }], error: null });

    const result = await fetchFullStateResultFromDB(userId);

    expect(result).toMatchObject({ ok: false, stage: 'partner-membership' });
    expect(mockFetchRecordsResultFromDB).not.toHaveBeenCalled();
  });

  it('falls back to the existing partner profile RPC before migration 060 is applied', async () => {
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
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: [{ display_name: 'Partner' }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.connected).toBe(true);
    expect(result.profile!.couple.partnerUsername).toBeUndefined();
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'get_partner_profile_with_username');
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'get_partner_profile');
    expect(mockRpc).toHaveBeenNthCalledWith(3, 'get_partner_service_info');
  });

  it('does not hydrate malformed partner service projection or a free-form memo', async () => {
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
    mockRpc
      .mockResolvedValueOnce({ data: [{ display_name: 'Partner' }], error: null })
      .mockResolvedValueOnce({
        data: [{
          branch: 'invalid-branch',
          military_status: 'serving',
          enlistment_date: 'not-a-date',
          discharge_date_source: 'manual',
          memo: 'must never enter app state',
        }],
        error: null,
      });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.partnerMilitary).toBeUndefined();
  });

  it('strips any extraneous memo field if present in partner service projection response', async () => {
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
    mockRpc
      .mockResolvedValueOnce({ data: [{ display_name: 'Partner' }], error: null })
      .mockResolvedValueOnce({
        data: [{
          branch: 'army',
          military_status: 'serving',
          enlistment_date: '2025-03-10',
          discharge_date_source: 'calculated',
          memo: 'owner-only secret note',
        }],
        error: null,
      });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.partnerMilitary).toBeDefined();
    expect(result.profile!.couple.partnerMilitary).toEqual({
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2025-03-10',
      dischargeDateSource: 'calculated',
    });
    expect('memo' in (result.profile!.couple.partnerMilitary ?? {})).toBe(false);
  });

  it('rejects impossible calendar dates while accepting valid ones and valid enums', async () => {
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
    mockRpc
      .mockResolvedValueOnce({ data: [{ display_name: 'Partner' }], error: null })
      .mockResolvedValueOnce({
        data: [{
          branch: 'airforce',
          military_status: 'serving',
          enlistment_date: '2026-02-31', // impossible date
          expected_discharge_date: '2026-13-40', // impossible month and day
          discharge_date: '2024-02-29', // valid leap year date
          discharge_date_source: 'manual',
        }],
        error: null,
      });

    const result = requireState(await fetchFullStateFromDB(userId));

    expect(result.profile!.couple.partnerMilitary).toBeDefined();
    expect(result.profile!.couple.partnerMilitary).toEqual({
      branch: 'airforce',
      militaryStatus: 'serving',
      dischargeDate: '2024-02-29',
      dischargeDateSource: 'manual',
    });
    expect(result.profile!.couple.partnerMilitary?.enlistmentDate).toBeUndefined();
    expect(result.profile!.couple.partnerMilitary?.expectedDischargeDate).toBeUndefined();
  });

  it('does not silently treat a partner service authorization failure as missing data', async () => {
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
    mockRpc
      .mockResolvedValueOnce({ data: [{ display_name: 'Partner' }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });

    const result = await fetchFullStateResultFromDB(userId);

    expect(result).toMatchObject({ ok: false, stage: 'partner', code: '42501' });
  });

  it('fetches records and trips for a pending couple', async () => {
    const coupleId = 'couple-123';
    const profileChain = setupProfileMock(profileRow);
    const memberChain = setupMemberMock(
      { couple_id: coupleId, status: 'active', role: 'gomsin' },
      null,
      async () => ({ data: [], error: null }),
    );
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
