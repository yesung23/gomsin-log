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

const { fetchPartnerJoinedAt } = await import('@/lib/coupleTimeline');

beforeEach(() => {
  from.mockClear();
  maybeSingle.mockReset().mockResolvedValue({ data: { joined_at: '2026-08-20T12:00:00Z' }, error: null });
});

describe('reading the join time', () => {
  it('returns it from the partner membership row', async () => {
    await expect(fetchPartnerJoinedAt('couple-1', 'me')).resolves.toBe('2026-08-20T12:00:00Z');
    expect(from).toHaveBeenCalledWith('couple_members');
  });

  it('asks for one column and nothing else', () => {
    /*
      A wider select would be a place partner data could reach a client that has
      no product reason to hold it. Asserted on the source: the chain is mocked
      here, so a runtime check would be checking the mock.
    */
    const text = readFileSync(resolve(process.cwd(), 'src/lib/coupleTimeline.ts'), 'utf8');
    expect(text).toContain(".select('joined_at')");
    expect(text.match(/\.select\(/g) ?? []).toHaveLength(1);
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
