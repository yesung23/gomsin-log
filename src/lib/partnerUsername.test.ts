import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRpc, mockSupabase } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  return { mockRpc, mockSupabase: { rpc: mockRpc } };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));
vi.mock('@/lib/accountDeletion', () => ({
  serverCallBlockedByPendingDeletion: vi.fn().mockResolvedValue(false),
}));

import { setPartnerUsernameInDB } from '@/lib/partnerUsername';

describe('partner username persistence contract', () => {
  beforeEach(() => mockRpc.mockReset());

  it('normalizes the partner-selected username before calling the locked RPC', async () => {
    mockRpc.mockResolvedValue({ error: null });
    expect(await setPartnerUsernameInDB('  Soldier_01 ')).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('set_partner_username', { p_username: 'soldier_01' });
  });

  it('rejects an invalid username without touching the server', async () => {
    expect(await setPartnerUsernameInDB('1-not-an-id')).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
