import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * REGRESSION, continued: the three invitation RPCs bypassed the pre-flight gate.
 *
 * These need a CONFIGURED Supabase client to reach the guard at all -- with no
 * URL/key the module fails closed before any server call. So the environment is stubbed, a
 * real client is constructed, and `fetch` is spied on: a pending deletion must
 * produce ZERO network requests.
 */

const gate = vi.fn();

describe('invitation mutations honour the pre-flight gate', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let supabaseModule: typeof import('@/lib/supabase');
  let accountDeletion: typeof import('@/lib/accountDeletion');
  let lockRequest: ReturnType<typeof vi.fn>;
  let lockHeld: boolean;
  let currentUserId: string;

  beforeEach(async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key-not-a-secret');
    vi.resetModules();

    fetchSpy = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    lockHeld = false;
    currentUserId = 'user-a';
    lockRequest = vi.fn(async (
      _name: string,
      _options: unknown,
      callback: (lock: { name: string; mode: 'shared' }) => Promise<unknown>,
    ) => {
      lockHeld = true;
      try {
        return await callback({ name: 'test-lock', mode: 'shared' });
      } finally {
        lockHeld = false;
      }
    });
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: lockRequest },
    });

    supabaseModule = await import('@/lib/supabase');
    accountDeletion = await import('@/lib/accountDeletion');
    expect(supabaseModule.isSupabaseConfigured, 'the client must be configured').toBe(true);

    gate.mockReset().mockResolvedValue({ kind: 'pending' });
    accountDeletion.registerServerCallGate({
      expectedUserId: 'user-a',
      getCurrentUserId: () => currentUserId,
      gate,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    accountDeletion.registerServerCallGate(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('createCoupleInvitation aborts before ANY request, including the caller read', async () => {
    const result = await supabaseModule.createCoupleInvitation('gomsin');
    expect(result.error).toMatch(/탈퇴/);
    expect(result.coupleId).toBe('');
    expect(result.code).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('consumeCoupleInvitation aborts with no redeem_invitation request', async () => {
    supabaseModule.__resetInviteAttemptsForTest();
    const result = await supabaseModule.consumeCoupleInvitation('123456');
    expect(result.error).toMatch(/탈퇴/);
    expect(result.coupleId).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('regenerateCoupleInvitation aborts with no regenerate_invitation request', async () => {
    const result = await supabaseModule.regenerateCoupleInvitation();
    expect(result.error).toMatch(/탈퇴/);
    expect(result.code).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('PRESERVATION: a clear verdict still issues the request', async () => {
    gate.mockResolvedValue({ kind: 'clear' });
    supabaseModule.__resetInviteAttemptsForTest();
    await supabaseModule.regenerateCoupleInvitation();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('PRESERVATION: an unknown verdict still issues the request (offline path)', async () => {
    gate.mockResolvedValue({ kind: 'unknown' });
    supabaseModule.__resetInviteAttemptsForTest();
    await supabaseModule.regenerateCoupleInvitation();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('holds the deletion reader lock until the invitation RPC response settles', async () => {
    gate.mockResolvedValue({ kind: 'clear' });
    supabaseModule.__resetInviteAttemptsForTest();
    let releaseResponse!: () => void;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      releaseResponse = () => resolve(new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));

    const mutation = supabaseModule.regenerateCoupleInvitation();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(lockRequest).toHaveBeenCalled();
    expect(lockHeld).toBe(true);

    releaseResponse();
    await mutation;
    expect(lockHeld).toBe(false);
  });

  it('issues no request when the account switches while gate admission is waiting', async () => {
    gate.mockImplementationOnce(async () => {
      currentUserId = 'user-b';
      return { kind: 'clear' };
    });
    supabaseModule.__resetInviteAttemptsForTest();

    const result = await supabaseModule.regenerateCoupleInvitation();

    expect(result.code).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
