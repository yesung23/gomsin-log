import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { maybeSingle, select, eq, update, from };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mocks.from,
    auth: {},
  })),
  SupabaseClient: class {},
}));

vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

const { saveCoupleAnniversary } = await import('@/lib/supabase');

describe('saveCoupleAnniversary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'couple-1' }, error: null });
  });

  it('writes SQL NULL when the anniversary is cleared', async () => {
    await expect(saveCoupleAnniversary('couple-1', null)).resolves.toBe(true);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ anniversary_date: null }));
  });

  it('returns false when RLS or a stale id causes the update to match no row', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(saveCoupleAnniversary('couple-1', '2025-01-01')).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      '[gomsinlog] Anniversary update matched no accessible couple row.',
    );
    consoleError.mockRestore();
  });
});
