import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The partner join-time lookup.
 *
 * §7.6 uses it to tell which records predate the partner. It is ANCILLARY: the
 * only thing that depends on it is whether a prompt is offered, and the prompt
 * reveals nothing on its own. So every failure returns `undefined` and nothing
 * else happens -- which is what stops a lookup from taking the app down with it.
 */

const maybeSingle = vi.fn();
const strictLookup = vi.fn();
const chain = {
  select: vi.fn(() => chain),
  eq: vi.fn(() => chain),
  neq: vi.fn(() => chain),
  limit: vi.fn(() => strictLookup()),
  maybeSingle: () => maybeSingle(),
};
const from = vi.fn(() => chain);

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => from(...(args as [never])) },
  isSupabaseConfigured: true,
}));

const coupleTimeline = await import('@/lib/coupleTimeline');
const {
  bindPartnerMembership,
  fetchPartnerJoinedAt,
  fetchPartnerMembership,
} = coupleTimeline;

type StrictLookupResult =
  | { ok: true; partner: { userId: string; joinedAt?: string } | null }
  | { ok: false; error: unknown };

const fetchPartnerMembershipResult = (
  coupleTimeline as typeof coupleTimeline & {
    fetchPartnerMembershipResult?: (
      coupleId: string,
      myUserId: string,
    ) => Promise<StrictLookupResult>;
  }
).fetchPartnerMembershipResult;

async function readStrictMembership(
  coupleId: string,
  myUserId: string,
): Promise<StrictLookupResult> {
  if (!fetchPartnerMembershipResult) {
    return { ok: false, error: new Error('strict membership result is not implemented') };
  }
  return fetchPartnerMembershipResult(coupleId, myUserId);
}

beforeEach(() => {
  from.mockClear();
  chain.select.mockClear();
  chain.eq.mockClear();
  chain.neq.mockClear();
  chain.limit.mockClear();
  maybeSingle.mockReset().mockResolvedValue({
    data: { user_id: 'partner', joined_at: '2026-08-20T12:00:00Z' },
    error: null,
  });
  strictLookup.mockReset().mockResolvedValue({
    data: [{ user_id: 'partner', joined_at: '2026-08-20T12:00:00Z' }],
    error: null,
  });
});

describe('reading the join time', () => {
  it('returns it from the partner membership row', async () => {
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBe('2026-08-20T12:00:00Z');
    expect(from).toHaveBeenCalledWith('couple_members');
  });

  it('returns the active partner identity and optional join time together', async () => {
    await expect(fetchPartnerMembership('couple-1', 'me')).resolves.toEqual({
      userId: 'partner',
      joinedAt: '2026-08-20T12:00:00Z',
    });
  });

  it('asks the exact active couple for only the two authoritative membership facts', async () => {
    await readStrictMembership('couple-1', 'me');

    expect(chain.select).toHaveBeenCalledWith('user_id, joined_at');
    expect(chain.eq).toHaveBeenCalledWith('couple_id', 'couple-1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'active');
    expect(chain.neq).toHaveBeenCalledWith('user_id', 'me');
  });
});

describe('strict partner membership authority', () => {
  it.each([
    {
      label: 'A reads B with joined_at',
      viewer: 'user-a',
      row: { user_id: 'user-b', joined_at: '2026-08-20T12:00:00Z' },
      partner: { userId: 'user-b', joinedAt: '2026-08-20T12:00:00Z' },
    },
    {
      label: 'B reads A without joined_at',
      viewer: 'user-b',
      row: { user_id: 'user-a', joined_at: null },
      partner: { userId: 'user-a' },
    },
  ])('returns the reciprocal exact identity when $label', async ({ viewer, row, partner }) => {
    strictLookup.mockResolvedValue({ data: [row], error: null });

    await expect(readStrictMembership('couple-1', viewer)).resolves.toEqual({
      ok: true,
      partner,
    });
  });

  it('distinguishes a verified zero-row pending couple from lookup failure', async () => {
    strictLookup.mockResolvedValue({ data: [], error: null });

    await expect(readStrictMembership('couple-1', 'user-a')).resolves.toEqual({
      ok: true,
      partner: null,
    });
  });

  it('returns the query error instead of collapsing it into partner absence', async () => {
    const error = { code: '42501', message: 'permission denied' };
    strictLookup.mockResolvedValue({ data: null, error });

    const result = await readStrictMembership('couple-1', 'user-a');

    expect(result).toEqual({ ok: false, error });
  });

  it('returns a thrown transport error instead of collapsing it into partner absence', async () => {
    const error = new TypeError('Failed to fetch');
    strictLookup.mockRejectedValue(error);

    const result = await readStrictMembership('couple-1', 'user-a');

    expect(result).toEqual({ ok: false, error });
  });

  it.each([
    ['a non-array response', null],
    ['an empty user id', [{ user_id: '', joined_at: null }]],
    ['the requesting user', [{ user_id: 'user-a', joined_at: null }]],
    ['a malformed join time', [{ user_id: 'user-b', joined_at: 123 }]],
    ['an invalid join-time string', [{ user_id: 'user-b', joined_at: 'not-a-timestamp' }]],
    ['multiple active partners', [
      { user_id: 'user-b', joined_at: null },
      { user_id: 'user-c', joined_at: null },
    ]],
  ])('fails closed for %s', async (_label, data) => {
    strictLookup.mockResolvedValue({ data, error: null });

    const result = await readStrictMembership('couple-1', 'user-a');

    expect(result.ok).toBe(false);
  });
});

describe('binding belongs to the exact active workspace', () => {
  const partner = { userId: 'partner-a', joinedAt: '2026-08-20T12:00:00Z' };
  const active = {
    coupleId: 'couple-a',
    partnerName: '상대',
    coupleCode: '',
    connected: true,
    status: 'active' as const,
  };

  it('요청 당시와 같은 active couple에만 상대 신원을 붙인다', () => {
    expect(bindPartnerMembership(active, 'couple-a', partner)).toMatchObject({
      partnerUserId: 'partner-a',
      partnerJoinedAt: partner.joinedAt,
    });
  });

  it('A의 지연 응답을 connected B에 붙이지 않는다', () => {
    const connectedB = { ...active, coupleId: 'couple-b' };
    expect(bindPartnerMembership(connectedB, 'couple-a', partner)).toBe(connectedB);
    expect(bindPartnerMembership(connectedB, 'couple-a', partner).partnerUserId).toBeUndefined();
  });

  it('같은 ID라도 pending/disconnected에는 붙이지 않는다', () => {
    const pending = { ...active, connected: false, status: 'pending' as const };
    expect(bindPartnerMembership(pending, 'couple-a', partner)).toBe(pending);
    const disconnected = { ...active, connected: false, status: 'disconnected' as const };
    expect(bindPartnerMembership(disconnected, 'couple-a', partner)).toBe(disconnected);
  });
});

describe('nothing about a failure escapes', () => {
  it('returns undefined when the query reports an error', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'denied' } });
    strictLookup.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBeUndefined();
  });

  it('returns undefined when the client THROWS rather than reporting', async () => {
    /*
      The case that broke a test run. This is called from a `useEffect`, so a
      rejection here is an unhandled one -- and an ancillary lookup must not be
      able to do that. `recordProductEvent` already had this shape; this did not.
    */
    maybeSingle.mockRejectedValue(new Error('transport gone'));
    strictLookup.mockRejectedValue(new Error('transport gone'));
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBeUndefined();
  });

  it('returns undefined when there is no partner row yet', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    strictLookup.mockResolvedValue({ data: [], error: null });
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBeUndefined();
  });

  it('does not query at all without a couple or a user', async () => {
    await expect(fetchPartnerJoinedAt('', 'me')).resolves.toBeUndefined();
    await expect(fetchPartnerJoinedAt('couple-1', '')).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });
});
