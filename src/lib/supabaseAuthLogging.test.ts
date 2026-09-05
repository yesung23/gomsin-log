import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const signInWithOtp = vi.hoisted(() => vi.fn());
const signInWithOAuth = vi.hoisted(() => vi.fn());
const signInWithIdToken = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const authorizeWithNativeApple = vi.hoisted(() => vi.fn());
const stageVerifiedAppleNameCandidate = vi.hoisted(() => vi.fn());
const configuredFetch = vi.hoisted(() => ({ current: null as typeof fetch | null }));
const networkFetch = vi.hoisted(() => vi.fn<typeof fetch>());

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: { global: { fetch: typeof fetch } }) => {
    configuredFetch.current = options.global.fetch;
    return { auth: { signInWithOtp, signInWithOAuth, signInWithIdToken, updateUser, getSession } };
  },
}));

vi.mock('@/lib/appleAuth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/appleAuth')>(),
  authorizeWithNativeApple: (...args: unknown[]) => authorizeWithNativeApple(...args),
  stageVerifiedAppleNameCandidate: (...args: unknown[]) => stageVerifiedAppleNameCandidate(...args),
}));

vi.mock('@/lib/platform', () => ({
  authRedirectUrl: () => 'https://app.example.com/auth/callback',
  isNativePlatform: () => false,
}));

vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key-not-a-secret');
vi.stubGlobal('fetch', networkFetch);

const { SupabaseAuthRepository } = await import('@/lib/supabase');

describe('SupabaseAuthRepository email auth logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    signInWithOtp.mockReset();
    signInWithOAuth.mockReset();
    signInWithIdToken.mockReset();
    updateUser.mockReset();
    getSession.mockReset();
    authorizeWithNativeApple.mockReset();
    stageVerifiedAppleNameCandidate.mockReset();
    networkFetch.mockReset();
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('logs only a static message when signInWithOtp throws sensitive details', async () => {
    const canary = {
      email: 'canary@example.com',
      tokenUrl: 'https://project.supabase.co/auth/v1/token?access_token=canary-token',
      access_token: 'canary-access-token',
      code: 'canary-code',
      response: { detail: 'canary-response-detail' },
    };
    signInWithOtp.mockRejectedValueOnce(canary);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      new SupabaseAuthRepository().signInWithEmail(canary.email),
    ).resolves.toEqual({ error: '매직링크를 보내지 못했어요. 잠시 후 다시 시도해 주세요.' });

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: canary.email,
      options: { emailRedirectTo: 'https://app.example.com/auth/callback' },
    });
    expect(consoleError.mock.calls).toEqual([
      ['[gomsinlog] Magic-link request failed.'],
    ]);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(canary.email);
    expect(logged).not.toContain(canary.tokenUrl);
    expect(logged).not.toContain(canary.access_token);
    expect(logged).not.toContain(canary.code);
    expect(logged).not.toContain(canary.response.detail);
  });

  it('does not start either Apple transport when the native gate fails closed', async () => {
    authorizeWithNativeApple.mockResolvedValueOnce({ status: 'unavailable' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new SupabaseAuthRepository().signInWithApple()).resolves.toEqual({
      error: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });

    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('exchanges the native Apple token with the exact raw nonce and stages name only after a verified session', async () => {
    const fullName = { givenName: '하루', familyName: '김', formatted: '김하루' };
    authorizeWithNativeApple.mockResolvedValueOnce({
      status: 'success',
      identityToken: 'identity-token-fixture',
      authorizationCode: 'authorization-code-fixture',
      appleUserId: 'apple-user-fixture',
      rawNonce: 'raw-nonce-fixture',
      fullName,
    });
    signInWithIdToken.mockResolvedValueOnce({
      data: {
        user: { id: 'verified-supabase-user' },
        session: { user: { id: 'verified-supabase-user' } },
      },
      error: null,
    });

    await expect(new SupabaseAuthRepository().signInWithApple()).resolves.toEqual({});

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'identity-token-fixture',
      nonce: 'raw-nonce-fixture',
    });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(stageVerifiedAppleNameCandidate).toHaveBeenCalledWith(
      'verified-supabase-user',
      fullName,
    );
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('treats Apple cancellation as a typed non-error and makes no Supabase call', async () => {
    authorizeWithNativeApple.mockResolvedValueOnce({ status: 'cancelled' });

    await expect(new SupabaseAuthRepository().signInWithApple()).resolves.toEqual({
      cancelled: true,
    });

    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(stageVerifiedAppleNameCandidate).not.toHaveBeenCalled();
  });

  it('does not stage Apple name when Supabase rejects the credential', async () => {
    authorizeWithNativeApple.mockResolvedValueOnce({
      status: 'success',
      identityToken: 'identity-token-fixture',
      authorizationCode: 'authorization-code-fixture',
      appleUserId: 'apple-user-fixture',
      rawNonce: 'raw-nonce-fixture',
      fullName: { formatted: '김하루' },
    });
    signInWithIdToken.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'nonce mismatch' },
    });

    await expect(new SupabaseAuthRepository().signInWithApple()).resolves.toEqual({
      error: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });

    expect(stageVerifiedAppleNameCandidate).not.toHaveBeenCalled();
  });

  it('keeps the complete Apple exchange single-flight across concurrent calls', async () => {
    let resolveAuthorization!: (value: unknown) => void;
    authorizeWithNativeApple.mockReturnValueOnce(new Promise((resolve) => {
      resolveAuthorization = resolve;
    }));
    signInWithIdToken.mockResolvedValueOnce({
      data: {
        user: { id: 'verified-supabase-user' },
        session: { user: { id: 'verified-supabase-user' } },
      },
      error: null,
    });
    const repository = new SupabaseAuthRepository();

    const first = repository.signInWithApple();
    const second = repository.signInWithApple();
    expect(authorizeWithNativeApple).toHaveBeenCalledTimes(1);

    resolveAuthorization({
      status: 'success',
      identityToken: 'identity-token-fixture',
      authorizationCode: 'authorization-code-fixture',
      appleUserId: 'apple-user-fixture',
      rawNonce: 'raw-nonce-fixture',
      fullName: null,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([{}, {}]);
    expect(signInWithIdToken).toHaveBeenCalledTimes(1);
  });

  it('logs only a static message when native Apple auth throws credential-shaped data', async () => {
    const canary = {
      identityToken: 'canary-identity-token',
      authorizationCode: 'canary-authorization-code',
      rawNonce: 'canary-raw-nonce',
      state: 'canary-request-state',
    };
    authorizeWithNativeApple.mockRejectedValueOnce(canary);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new SupabaseAuthRepository().signInWithApple()).resolves.toEqual({
      error: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });

    expect(consoleError.mock.calls).toEqual([
      ['[gomsinlog] Native Apple sign-in failed.'],
    ]);
    const logged = JSON.stringify(consoleError.mock.calls);
    for (const secretLikeValue of Object.values(canary)) {
      expect(logged).not.toContain(secretLikeValue);
    }
  });

  it('does not change Google OAuth when the Apple gate is off', async () => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'false');
    signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: null });

    await expect(new SupabaseAuthRepository().signInWithGoogle()).resolves.toEqual({});

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://app.example.com/auth/callback',
        skipBrowserRedirect: false,
      },
    });
  });

  it('does not invent Google when the authenticated provider is unavailable', async () => {
    getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'verified-supabase-user',
            email: 'fixture@example.com',
            app_metadata: {},
          },
        },
      },
    });

    await expect(new SupabaseAuthRepository().getCurrentUser()).resolves.toEqual({
      id: 'verified-supabase-user',
      email: 'fixture@example.com',
      provider: 'unknown',
    });
  });

  it('reports only identity providers that Supabase actually loaded', async () => {
    getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'verified-supabase-user',
            email: 'relay@example.com',
            app_metadata: { provider: 'apple' },
            identities: [
              { provider: 'apple' },
              { provider: 'google' },
              {},
            ],
          },
        },
      },
    });

    await expect(new SupabaseAuthRepository().getCurrentUser()).resolves.toEqual({
      id: 'verified-supabase-user',
      email: 'relay@example.com',
      provider: 'apple',
      identityProviders: ['apple', 'google'],
    });
  });

  it.each(['headers', 'body'])('rejects a late Apple token %s response before the SDK can install a session', async (stall) => {
    vi.useFakeTimers();
    let release!: () => void;
    const response = stall === 'body'
      ? new Response(new ReadableStream({ start(controller) {
          release = () => { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); };
        } }))
      : new Response('{}');
    networkFetch.mockImplementationOnce(() => stall === 'body'
      ? Promise.resolve(response)
      : new Promise((resolve) => { release = () => resolve(response); }));
    const accepted = vi.fn();
    const rejected = vi.fn();
    const request = configuredFetch.current!(
      'https://project.supabase.co/auth/v1/token?grant_type=id_token',
      { method: 'POST', body: JSON.stringify({ provider: 'apple', nonce: 'test-nonce' }) },
    ).then(accepted, rejected);
    await vi.advanceTimersByTimeAsync(15_000);
    try {
      expect(rejected).toHaveBeenCalledOnce();
      expect(networkFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(accepted).not.toHaveBeenCalled();
    } finally {
      release();
      await request;
    }
    expect(accepted).not.toHaveBeenCalled();
  });
});
