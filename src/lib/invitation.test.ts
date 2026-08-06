import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateInvitationCode,
  hashInvitationCode,
  consumeCoupleInvitation,
  __resetInviteAttemptsForTest,
} from '@/lib/supabase';

describe('generateInvitationCode', () => {
  it('always produces exactly six digits in range', () => {
    for (let i = 0; i < 2000; i += 1) {
      const code = generateInvitationCode();
      expect(code).toMatch(/^\d{6}$/);
      const value = Number(code);
      expect(value).toBeGreaterThanOrEqual(100000);
      expect(value).toBeLessThanOrEqual(999999);
    }
  });

  it('does not use Math.random (predictable) as its entropy source', () => {
    // If Math.random were the source, stubbing it would pin the output.
    const original = Math.random;
    Math.random = () => 0.5;
    try {
      const codes = new Set(Array.from({ length: 40 }, () => generateInvitationCode()));
      expect(codes.size).toBeGreaterThan(1);
    } finally {
      Math.random = original;
    }
  });

  it('produces a well spread distribution', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInvitationCode()));
    // Collisions in 1000 draws from 900k values should be very rare.
    expect(codes.size).toBeGreaterThan(990);
  });
});

describe('hashInvitationCode', () => {
  it('produces a stable 64-char sha-256 hex digest', async () => {
    const hash = await hashInvitationCode('123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashInvitationCode('123456')).toBe(hash);
  });

  it('normalises surrounding whitespace and casing', async () => {
    expect(await hashInvitationCode('  123456 ')).toBe(await hashInvitationCode('123456'));
    expect(await hashInvitationCode('abcdef')).toBe(await hashInvitationCode('ABCDEF'));
  });

  it('produces different digests for different codes', async () => {
    expect(await hashInvitationCode('123456')).not.toBe(await hashInvitationCode('123457'));
  });
});

describe('consumeCoupleInvitation input validation', () => {
  beforeEach(() => {
    __resetInviteAttemptsForTest();
  });

  it('rejects codes that are not six digits before any network call', async () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', '12345a']) {
      const result = await consumeCoupleInvitation(bad);
      expect(result.error).toBeTruthy();
      expect(result.coupleId).toBeUndefined();
    }
  });

  it('accepts only the demo code when Supabase is not configured', async () => {
    // Without VITE_SUPABASE_URL the module falls back to the offline demo path.
    //
    // `isSupabaseConfigured` is computed once at module load, so the unconfigured
    // state is stubbed and the module re-imported in isolation rather than being
    // inherited from the ambient shell. CI legitimately exports the placeholder
    // VITE_SUPABASE_* values for its build steps, and an ambient-dependent
    // version of this test passed only on a laptop that happened to lack them.
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    try {
      const offline = await import('@/lib/supabase');
      expect(offline.isSupabaseConfigured, 'the client must be unconfigured').toBe(false);
      offline.__resetInviteAttemptsForTest();

      await expect(offline.consumeCoupleInvitation('123456')).resolves.toEqual({ coupleId: 'demo-couple-id' });
      const other = await offline.consumeCoupleInvitation('999999');
      expect(other.error).toBeTruthy();
      expect(other.coupleId).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('createCoupleInvitation retry logic', () => {
  const mockRpc = vi.fn();
  let createCoupleInvitationOnline: typeof import('@/lib/supabase')['createCoupleInvitation'];
  let resetForTest: typeof import('@/lib/supabase')['__resetInviteAttemptsForTest'];

  beforeEach(async () => {
    vi.resetModules();
    mockRpc.mockReset();
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } } }),
        },
        rpc: mockRpc,
      }),
    }));
    vi.doMock('@/lib/platform', () => ({
      authRedirectUrl: () => 'http://localhost',
      isNativePlatform: () => false,
    }));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key');
    const mod = await import('@/lib/supabase');
    createCoupleInvitationOnline = mod.createCoupleInvitation;
    resetForTest = mod.__resetInviteAttemptsForTest;
    resetForTest();
  });

  it('retries on a code hash collision (23505) up to 5 times', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
      .mockResolvedValueOnce({ data: 'couple-new', error: null });

    const result = await createCoupleInvitationOnline('gomsin');
    expect(result.coupleId).toBe('couple-new');
    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.error).toBeUndefined();
    expect(mockRpc).toHaveBeenCalledTimes(5);
  });

  it('gives up after INVITATION_CODE_ATTEMPTS collisions', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });

    const result = await createCoupleInvitationOnline('gomsin');
    expect(result.coupleId).toBe('');
    expect(result.code).toBe('');
    expect(result.error).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledTimes(5);
  });

  /**
   * This was the one invitation path that bypassed `classifyServerError` and
   * returned `rpcError.message` verbatim, so a Postgres/PostgREST string went
   * straight into a Korean toast. Every sibling function already classified.
   */
  it('classifies a permission failure instead of surfacing raw server English', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for function create_couple_and_invitation' },
    });

    const result = await createCoupleInvitationOnline('gomsin');
    expect(result.error).toBe('커플 공간을 만들지 못했어요. 권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.');
    expect(result.error).not.toContain('permission denied');
    expect(result.error).not.toContain('create_couple_and_invitation');
    // A permission problem is not a connectivity problem.
    expect(result.error).not.toContain('인터넷');
  });

  it('reports an expired session as a session problem, not a connection problem', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });

    const result = await createCoupleInvitationOnline('gomsin');
    expect(result.error).toContain('세션이 만료되었어요');
    expect(result.error).not.toContain('JWT');
    expect(result.error).not.toContain('인터넷');
  });

  /**
   * `already_in_couple` is a recoverable product state, not an error to display:
   * the caller turns it into the "recover your existing space" flow. The reason
   * flag must survive classification, otherwise that recovery becomes unreachable.
   */
  it('still flags an existing couple space so recovery stays reachable', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'User is already in a couple' },
    });

    const result = await createCoupleInvitationOnline('gomsin');
    expect(result.reason).toBe('already_in_couple');
    expect(result.error).not.toContain('already in a couple');
  });
});

describe('consumeCoupleInvitation with supabase configured', () => {
  const mockRpc = vi.fn();
  let consumeOnline: typeof import('@/lib/supabase')['consumeCoupleInvitation'];
  let resetForTest: typeof import('@/lib/supabase')['__resetInviteAttemptsForTest'];

  beforeEach(async () => {
    vi.resetModules();
    mockRpc.mockReset();
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } } }),
        },
        rpc: mockRpc,
      }),
    }));
    vi.doMock('@/lib/platform', () => ({
      authRedirectUrl: () => 'http://localhost',
      isNativePlatform: () => false,
    }));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-anon-key');
    const mod = await import('@/lib/supabase');
    consumeOnline = mod.consumeCoupleInvitation;
    resetForTest = mod.__resetInviteAttemptsForTest;
    resetForTest();
  });

  /**
   * DEF-10 residual. The migration "contract" tests grep `.sql` text, and nothing
   * asserted the ONE thing that actually breaks the redemption UI: that every
   * `error_code` migration 015 can emit is handled by the client, rather than
   * falling through to the generic transient-retry default.
   *
   * So the expected set is DERIVED FROM THE SQL and each member is driven through
   * the real `consumeCoupleInvitation`. A migration that adds a verdict the client
   * has never heard of now fails here instead of shipping as "잠시 후 다시 시도".
   */
  describe('every error_code migration 015 can emit has its own verdict', () => {
    const GENERIC = '초대 코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';

    /** Error codes the `redeem_invitation` body can actually produce. */
    function errorCodesFromSql(): string[] {
      const sql = readFileSync(
        resolve(process.cwd(), 'supabase/migrations/015_security_followup.sql'),
        'utf8',
      );
      const start = sql.indexOf('CREATE FUNCTION public.redeem_invitation');
      expect(start).toBeGreaterThan(-1);
      const end = sql.indexOf('COMMENT ON FUNCTION public.redeem_invitation', start);
      expect(end).toBeGreaterThan(start);
      const body = sql.slice(start, end);

      const codes = new Set<string>();
      // Assigned into the verdict variable...
      for (const m of body.matchAll(/v_error_code\s*:=\s*'([a-z_]+)'/g)) codes.add(m[1]);
      // ...returned directly in a payload...
      for (const m of body.matchAll(/'error_code'\s*,\s*'([a-z_]+)'/g)) codes.add(m[1]);
      // ...and the COALESCE fallback, which is a real return value.
      for (const m of body.matchAll(/COALESCE\(v_error_code,\s*'([a-z_]+)'\)/g)) codes.add(m[1]);
      // NULL is the success path, not an error code.
      codes.delete('');
      return [...codes].sort();
    }

    it('the derivation actually found the codes (the parser is doing work)', () => {
      const codes = errorCodesFromSql();
      // Guard soundness: a silently empty set would make the loop below vacuous.
      expect(codes.length).toBeGreaterThanOrEqual(5);
      expect(codes).toContain('not_authenticated');
      expect(codes).toContain('internal_error');
      expect(codes).toContain('invalid_or_expired');
    });

    it('no emitted code falls through to the generic retry message', async () => {
      for (const code of errorCodesFromSql()) {
        resetForTest();
        mockRpc.mockResolvedValueOnce({
          data: { ok: false, couple_id: null, error_code: code },
          error: null,
        });

        const result = await consumeOnline('123456');

        expect(result.coupleId, code).toBeUndefined();
        expect(result.error, code).toBeTruthy();
        expect(result.error, code).not.toBe(GENERIC);
        // The raw code must never be shown to the user.
        expect(result.error, code).not.toContain(code);
      }
    });

    it('every emitted code produces a DISTINCT user-facing message', async () => {
      // Two different server verdicts collapsing into one string is how
      // not_authenticated and internal_error became indistinguishable (DEF-04).
      const messages = new Map<string, string>();
      for (const code of errorCodesFromSql()) {
        resetForTest();
        mockRpc.mockResolvedValueOnce({
          data: { ok: false, couple_id: null, error_code: code },
          error: null,
        });
        const result = await consumeOnline('123456');
        messages.set(code, result.error!);
      }
      // `invalid_request` and `invalid_or_expired` deliberately share one message:
      // distinguishing them would confirm whether a guessed hash exists.
      const deliberateAliases = new Set(['invalid_request']);
      const distinct = [...messages.entries()]
        .filter(([code]) => !deliberateAliases.has(code))
        .map(([, message]) => message);
      expect(new Set(distinct).size).toBe(distinct.length);
    });

    it('an UNKNOWN code still degrades to the honest generic message', async () => {
      // PRESERVATION: the default arm must stay, for a server ahead of this client.
      resetForTest();
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, couple_id: null, error_code: 'a_verdict_from_the_future' },
        error: null,
      });

      const result = await consumeOnline('123456');

      expect(result.error).toBe(GENERIC);
    });
  });

  it('couple_full is no longer returned as an error code', async () => {
    // The server returns couple_full via the structured result from redeem_invitation.
    // Migration 015 should no longer return this, but if it does, the client maps
    // it to a user-facing message rather than exposing the code as an existence oracle.
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, couple_id: null, error_code: 'couple_full' },
      error: null,
    });

    const result = await consumeOnline('123456');
    expect(result.error).toBeTruthy();
    // The message should be a human-readable Korean string, not the raw code
    expect(result.error).not.toBe('couple_full');
    expect(result.error).toContain('2명');
    expect(result.coupleId).toBeUndefined();
  });

  /**
   * The catch used to return a fixed "인터넷 연결을 확인해 주세요", so an RLS
   * rejection or an expired session was reported as a connectivity problem and
   * the user retried instead of fixing the real cause. The cause IS in hand here,
   * so it is classified.
   */
  it('does not blame the internet when a thrown redemption was really a permission failure', async () => {
    mockRpc.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: '42501' }));

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain('인터넷 연결');
    expect(result.error).toContain('권한이 없어요');
  });

  it('does not blame the internet when a thrown redemption was really an expired session', async () => {
    mockRpc.mockRejectedValueOnce(Object.assign(new Error('JWT expired'), { code: 'PGRST301' }));

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).not.toContain('인터넷 연결');
    expect(result.error).toContain('세션이 만료되었어요');
  });

  it('does not invent a cause for an unclassifiable thrown redemption', async () => {
    mockRpc.mockRejectedValueOnce(new Error('something entirely unexpected'));

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).not.toContain('인터넷 연결');
    expect(result.error).toContain('잠시 후 다시 시도해 주세요');
  });

  it('still reports a genuine network failure as a connection problem', async () => {
    // A true offline classification is allowed to mention the connection -- but
    // only a CONFIRMED one. This used to pass on a `TypeError: Failed to fetch`
    // alone, with the browser reporting online, which is exactly the false
    // diagnosis the product owner hit; see serverErrors.test.ts.
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      mockRpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const result = await consumeOnline('123456');

      expect(result.coupleId).toBeUndefined();
      expect(result.error).toContain('인터넷 연결');
    } finally {
      onLine.mockRestore();
    }
  });

  it('does not blame the connection for a transport failure while nominally online', async () => {
    // PRIORITY 1. Same thrown error, browser reporting online: a CSP connect-src
    // refusal, a CORS rejection and a wrong Supabase URL all arrive this way.
    expect(navigator.onLine).toBe(true);
    mockRpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).not.toContain('인터넷 연결');
    expect(result.error).not.toContain('오프라인');
    expect(result.error).toContain('서버에 요청이 닿지 않았어요');
    expect(result.reason).toBe('unreachable');
  });

  /**
   * DEF-04. `redeem_invitation` raises `not_authenticated` and `internal_error`
   * as structured verdicts (migration 015), and both fell through to the generic
   * "잠시 후 다시 시도해 주세요" -- so an unusable session and a server-side bug
   * were both presented as a transient hiccup worth retrying.
   */
  it('tells the truth when the server says the caller is not authenticated', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, couple_id: null, error_code: 'not_authenticated' },
      error: null,
    });

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).toContain('세션이 만료되었어요');
    expect(result.error).not.toContain('잠시 후 다시 시도해 주세요');
    // The caller needs this to route the session recovery, not just to toast.
    expect(result.reason).toBe('auth_expired');
  });

  it('distinguishes a server-side failure from an expired session', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, couple_id: null, error_code: 'internal_error' },
      error: null,
    });

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).toContain('서버');
    expect(result.error).not.toContain('세션이 만료되었어요');
    expect(result.error).not.toContain('인터넷 연결');
    expect(result.reason).toBe('server');
    // And it must not read like the unclassified default.
    expect(result.error).not.toBe('초대 코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });

  /**
   * DEF-04, secondary: the non-throwing PostgREST `error` branch returned a flat
   * generic string with no classification, while the `catch` branch classified.
   * The same 403 therefore read as transient or as a permission problem
   * depending only on how supabase-js chose to surface it.
   */
  it('classifies a returned permission error instead of calling it transient', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied for function redeem_invitation' },
    });

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).toContain('권한이 없어요');
    expect(result.error).not.toContain('인터넷 연결');
    expect(result.reason).toBe('forbidden');
  });

  it('classifies a returned expired-session error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    });

    const result = await consumeOnline('123456');

    expect(result.coupleId).toBeUndefined();
    expect(result.error).toContain('세션이 만료되었어요');
    expect(result.reason).toBe('auth_expired');
  });
});
