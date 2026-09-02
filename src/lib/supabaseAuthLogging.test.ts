import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const signInWithOtp = vi.hoisted(() => vi.fn());
const signInWithOAuth = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithOtp, signInWithOAuth } }),
}));

vi.mock('@/lib/platform', () => ({
  authRedirectUrl: () => 'https://app.example.com/auth/callback',
  isNativePlatform: () => false,
}));

vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key-not-a-secret');

const { SupabaseAuthRepository } = await import('@/lib/supabase');

describe('SupabaseAuthRepository email auth logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    signInWithOtp.mockReset();
    signInWithOAuth.mockReset();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
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

  it('does not start Apple OAuth when the reviewed build gate is off', async () => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'false');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new SupabaseAuthRepository().signInWithApple()).resolves.toEqual({
      error: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });

    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('starts the existing Apple PKCE path only when the build gate is exactly true', async () => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'true');
    signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: null });

    await expect(new SupabaseAuthRepository().signInWithApple()).resolves.toEqual({});

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: {
        redirectTo: 'https://app.example.com/auth/callback',
        skipBrowserRedirect: false,
      },
    });
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
});
