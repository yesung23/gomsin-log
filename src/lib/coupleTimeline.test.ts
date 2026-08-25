import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The partner join-time lookup.
 *
 * §7.6 uses it to tell which records predate the partner. It is ANCILLARY: the
 * only thing that depends on it is whether a prompt is offered, and the prompt
 * reveals nothing on its own. So every failure returns `undefined` and nothing
 * else happens -- which is what stops a lookup from taking the app down with it.
 */

const maybeSingle = vi.fn();
const chain = {
  select: () => chain,
  eq: () => chain,
  neq: () => chain,
  maybeSingle: () => maybeSingle(),
};
const from = vi.fn(() => chain);

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => from(...(args as [never])) },
  isSupabaseConfigured: true,
}));

const {
  bindPartnerMembership,
  fetchPartnerJoinedAt,
  fetchPartnerMembership,
} = await import('@/lib/coupleTimeline');

beforeEach(() => {
  from.mockClear();
  maybeSingle.mockReset().mockResolvedValue({
    data: { user_id: 'partner', joined_at: '2026-08-20T12:00:00Z' },
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

  it('asks only for the two membership facts used by the product', () => {
    /*
      A wider select would be a place partner data could reach a client that has
      no product reason to hold it. Asserted on the source: the chain is mocked
      here, so a runtime check would be checking the mock.
    */
    const text = readFileSync(resolve(process.cwd(), 'src/lib/coupleTimeline.ts'), 'utf8');
    expect(text).toContain(".select('user_id, joined_at')");
    expect(text.match(/\.select\(/g) ?? []).toHaveLength(1);
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
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBeUndefined();
  });

  it('returns undefined when the client THROWS rather than reporting', async () => {
    /*
      The case that broke a test run. This is called from a `useEffect`, so a
      rejection here is an unhandled one -- and an ancillary lookup must not be
      able to do that. `recordProductEvent` already had this shape; this did not.
    */
    maybeSingle.mockRejectedValue(new Error('transport gone'));
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBeUndefined();
  });

  it('returns undefined when there is no partner row yet', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBeUndefined();
  });

  it('does not query at all without a couple or a user', async () => {
    await expect(fetchPartnerJoinedAt('', 'me')).resolves.toBeUndefined();
    await expect(fetchPartnerJoinedAt('couple-1', '')).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });
});
