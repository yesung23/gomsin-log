import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTasks } from '@/lib/tasks';

vi.mock('@/lib/accountDeletion', () => ({
  runServerMutationBehindDeletionBarrier: async (
    operation: (context: { userId: string; assertCurrent: () => void }) => Promise<unknown>,
    options: { expectedUserId: string | 'current' },
  ) => ({
    kind: 'executed',
    value: await operation({
      userId: options.expectedUserId === 'current' ? 'user-a' : options.expectedUserId,
      assertCurrent: () => {},
    }),
  }),
}));

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    from: supabaseMocks.from,
  },
}));

describe('fetchTasks', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
    supabaseMocks.from.mockReset();
  });

  it('verifies that the requested couple is still the authenticated active couple', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: 'couple-a', error: null });
    const secondOrder = vi.fn().mockResolvedValue({ data: [], error: null });
    const firstOrder = vi.fn().mockReturnValue({ order: secondOrder });
    const eq = vi.fn().mockReturnValue({ order: firstOrder });
    const select = vi.fn().mockReturnValue({ eq });
    supabaseMocks.from.mockReturnValue({ select });

    const result = await fetchTasks('couple-a');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_my_active_couple_id');
    expect(eq).toHaveBeenCalledWith('couple_id', 'couple-a');
    expect(result).toEqual({ ok: true, tasks: [] });
  });

  it('fails closed before reading tasks when the active couple differs', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: 'couple-b', error: null });

    const result = await fetchTasks('couple-a');

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('does not turn an unverifiable membership into an empty task list', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST500', message: 'membership unavailable' },
    });

    const result = await fetchTasks('couple-a');

    expect(result).toEqual({ ok: false, reason: 'error' });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });
});
