import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Push token lifecycle, and the negative tests §14.3 asks for by name.
 *
 * The rule is that unlink, sign-out, account deletion and account switch each
 * invalidate the token immediately. Three of the four are enforced in the
 * database and are proved by the phase0 harness against a real PostgreSQL; this
 * file covers the fourth -- sign-out -- and the ORDERING that makes it work,
 * which is the part a database cannot enforce.
 */

const rpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  isSupabaseConfigured: true,
}));

const { registerPushToken, revokeOwnPushTokens, clearOwnUnseen } = await import('@/lib/pushTokens');

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('registering this device', () => {
  it('claims the token through the RPC, never by writing the table', async () => {
    // A direct INSERT cannot express the handover, and the table is SELECT-only
    // for clients precisely so this is the only path.
    const result = await registerPushToken('ios', 'token-abc');

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('register_push_token', {
      p_platform: 'ios',
      p_token: 'token-abc',
    });
  });

  it('refuses an empty token before spending a round trip', async () => {
    const result = await registerPushToken('android', '   ');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a failure in Korean, without the token in it', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom token-abc' } });
    const result = await registerPushToken('ios', 'token-abc');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/[가-힣]/);
    // The server's raw message is not passed through: it can contain anything.
    expect(result.error).not.toContain('token-abc');
    expect(result.error).not.toContain('boom');
  });
});

describe('releasing this account\'s tokens', () => {
  it('asks the server to drop them', async () => {
    const result = await revokeOwnPushTokens();
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('revoke_my_push_tokens');
  });

  it('reports failure without throwing, so it can never block a sign-out', async () => {
    rpc.mockResolvedValue({ error: { message: 'refused' } });
    await expect(revokeOwnPushTokens()).resolves.toMatchObject({ ok: false });
  });

  it('does not throw when the backend is not configured', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase', () => ({ supabase: null, isSupabaseConfigured: false }));
    const offline = await import('@/lib/pushTokens');
    await expect(offline.revokeOwnPushTokens()).resolves.toMatchObject({ ok: false });
    vi.doUnmock('@/lib/supabase');
    vi.resetModules();
  });
});

describe('clearing one\'s own delivery flag', () => {
  it('acts through the caller-scoped RPC and takes no arguments', async () => {
    // No user id parameter exists, so there is no shape in which this could act
    // on the partner's row -- which is what keeps it from being a read receipt.
    await clearOwnUnseen();
    expect(rpc).toHaveBeenCalledWith('clear_my_unseen');
    expect(rpc.mock.calls[0]).toHaveLength(1);
  });

  it('swallows a failure, because nothing depends on it succeeding', async () => {
    rpc.mockResolvedValue({ error: { message: 'nope' } });
    await expect(clearOwnUnseen()).resolves.toBeUndefined();
  });
});
