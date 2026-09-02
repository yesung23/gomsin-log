import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ update: (...args: unknown[]) => update(...args) }) },
  isSupabaseConfigured: true,
}));
vi.mock('@/lib/accountDeletion', () => ({ serverCallBlockedByPendingDeletion: () => false }));

const { resolveTalkAboutInDB } = await import('@/lib/talkAbout');

function answers(result: { data: unknown; error: unknown }) {
  const chain = {
    eq: () => chain,
    select: vi.fn(() => Promise.resolve(result)),
  };
  update.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  update.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('resolveTalkAboutInDB affected-row acknowledgement', () => {
  it('reports a real pending-row transition', async () => {
    const chain = answers({ data: [{ id: 'mark-1' }], error: null });

    await expect(resolveTalkAboutInDB('record-1', 'couple-1'))
      .resolves.toEqual({ ok: true, changed: true });
    expect(chain.select).toHaveBeenCalledWith('id');
  });

  it('does not claim a transition when RLS or a concurrent resolve affected zero rows', async () => {
    answers({ data: [], error: null });

    await expect(resolveTalkAboutInDB('record-1', 'couple-1'))
      .resolves.toEqual({ ok: true, changed: false });
  });
});
