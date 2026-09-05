import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type {
  AppleAuthPlugin,
  AppleAuthorizeResult,
  AppleFullName,
} from '@gomsinlog/capacitor-apple-auth';
import {
  clearAppleNameCandidate,
  consumeAppleNameCandidate,
  createAppleAuthClient,
  createAppleTokenTimeoutFetch,
  sha256NonceChallenge,
  stageVerifiedAppleNameCandidate,
  subscribeAppleNameCandidate,
  type AppleAuthClientDependencies,
} from './appleAuth';

const RAW_NONCE = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const HASHED_NONCE = 'ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0';
const REQUEST_STATE = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';

function bytes(start: number, length = 32): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => start + index);
}

function successfulAuthorization(
  overrides: Partial<Extract<AppleAuthorizeResult, { status: 'success' }>> = {},
): AppleAuthorizeResult {
  return {
    status: 'success',
    identityToken: 'identity-token-fixture',
    authorizationCode: 'authorization-code-fixture',
    userId: 'apple-user-fixture',
    fullName: {
      givenName: '하루',
      familyName: '김',
      formatted: '김하루',
    },
    state: REQUEST_STATE,
    ...overrides,
  };
}

function makeClient({
  platform = 'ios',
  native = true,
  featureEnabled = true,
  pluginAvailable = true,
  loggingDisabled = true,
  authorize = vi.fn<AppleAuthPlugin['authorize']>(async () => successfulAuthorization()),
  getCredentialState = vi.fn<AppleAuthPlugin['getCredentialState']>(async () => ({
    state: 'authorized',
  })),
  randomBytes = vi.fn()
    .mockReturnValueOnce(bytes(0))
    .mockReturnValueOnce(bytes(32)),
}: {
  platform?: string;
  native?: boolean;
  featureEnabled?: boolean;
  pluginAvailable?: boolean;
  loggingDisabled?: boolean;
  authorize?: AppleAuthPlugin['authorize'];
  getCredentialState?: AppleAuthPlugin['getCredentialState'];
  randomBytes?: AppleAuthClientDependencies['randomBytes'];
} = {}) {
  const sha256Hex = vi.fn(async (_value: string) => HASHED_NONCE);
  const client = createAppleAuthClient({
    isFeatureEnabled: () => featureEnabled,
    isNativePlatform: () => native,
    getPlatform: () => platform,
    isPluginAvailable: () => pluginAvailable,
    isLoggingDisabled: () => loggingDisabled,
    plugin: { authorize, getCredentialState },
    randomBytes,
    sha256Hex,
  });
  return { client, authorize, getCredentialState, randomBytes, sha256Hex };
}

afterEach(() => {
  clearAppleNameCandidate();
});

describe('native Apple authorization boundary', () => {
  it('refuses a logging bridge before generating or transporting credentials', async () => {
    const { client, authorize, getCredentialState, randomBytes } = makeClient({ loggingDisabled: false });
    expect(client.isAvailable()).toBe(false);
    await expect(client.authorize()).resolves.toEqual({ status: 'unavailable' });
    await expect(client.getCredentialState('apple-user-fixture')).resolves.toEqual({ state: 'unavailable' });
    expect(authorize).not.toHaveBeenCalled();
    expect(getCredentialState).not.toHaveBeenCalled();
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it('derives the SHA-256 challenge from the encoded raw nonce', async () => {
    await expect(sha256NonceChallenge(RAW_NONCE)).resolves.toBe(HASHED_NONCE);
  });

  it.each([
    ['web', false, 'web', true],
    ['Android', true, 'android', true],
    ['missing plugin', true, 'ios', false],
    ['feature off', true, 'ios', true, false],
  ])('fails closed on %s without touching the plugin or nonce source', async (
    _label,
    native,
    platform,
    pluginAvailable,
    featureEnabled = true,
  ) => {
    const { client, authorize, randomBytes } = makeClient({
      native,
      platform,
      pluginAvailable,
      featureEnabled,
    });

    await expect(client.authorize()).resolves.toEqual({ status: 'unavailable' });

    expect(authorize).not.toHaveBeenCalled();
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it('sends only a SHA-256 challenge and opaque state while retaining the 32-byte raw nonce for Supabase', async () => {
    const { client, authorize, randomBytes, sha256Hex } = makeClient();

    await expect(client.authorize()).resolves.toMatchObject({
      status: 'success',
      rawNonce: RAW_NONCE,
      identityToken: 'identity-token-fixture',
      authorizationCode: 'authorization-code-fixture',
      appleUserId: 'apple-user-fixture',
    });

    expect(randomBytes).toHaveBeenNthCalledWith(1, 32);
    expect(randomBytes).toHaveBeenNthCalledWith(2, 32);
    expect(sha256Hex).toHaveBeenCalledWith(RAW_NONCE);
    expect(authorize).toHaveBeenCalledWith({
      hashedNonce: HASHED_NONCE,
      state: REQUEST_STATE,
    });
    expect(authorize).not.toHaveBeenCalledWith(expect.objectContaining({ rawNonce: RAW_NONCE }));
  });

  it('rejects a missing 32-byte nonce before invoking native code', async () => {
    const randomBytes = vi.fn().mockReturnValue(bytes(0, 31));
    const { client, authorize } = makeClient({ randomBytes });

    await expect(client.authorize()).rejects.toMatchObject({ code: 'E_RANDOMNESS' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('rejects a missing or mismatched response state without accepting credential content', async () => {
    for (const state of [undefined, 'different-state']) {
      const authorize = vi.fn<AppleAuthPlugin['authorize']>(async () => (
        { ...successfulAuthorization(), state } as unknown as AppleAuthorizeResult
      ));
      const { client } = makeClient({ authorize });

      await expect(client.authorize()).rejects.toMatchObject({ code: 'E_STATE_MISMATCH' });
    }
  });

  it('returns cancellation as a typed non-error outcome with no credential fields', async () => {
    const authorize = vi.fn<AppleAuthPlugin['authorize']>(async () => ({
      status: 'cancelled',
      state: REQUEST_STATE,
    }));
    const { client } = makeClient({ authorize });

    await expect(client.authorize()).resolves.toEqual({ status: 'cancelled' });
  });

  it('rejects credential fields smuggled into a cancellation outcome', async () => {
    const authorize = vi.fn<AppleAuthPlugin['authorize']>(async () => ({
      status: 'cancelled',
      state: REQUEST_STATE,
      identityToken: 'unexpected-token-field',
    } as unknown as AppleAuthorizeResult));
    const { client } = makeClient({ authorize });

    await expect(client.authorize()).rejects.toMatchObject({ code: 'E_MALFORMED_RESPONSE' });
  });

  it('rejects malformed or unbounded plugin responses with a static boundary code', async () => {
    const malformed = [
      { ...successfulAuthorization(), identityToken: '' },
      { ...successfulAuthorization(), identityToken: 'x'.repeat(16_385) },
      { ...successfulAuthorization(), authorizationCode: 'x'.repeat(4_097) },
      { ...successfulAuthorization(), userId: 'x'.repeat(513) },
      { ...successfulAuthorization(), fullName: { givenName: '가'.repeat(86) } },
      { ...successfulAuthorization(), fullName: { formatted: 'x'.repeat(513) } },
      { ...successfulAuthorization(), fullName: { email: 'unexpected@example.com' } },
    ];

    for (const response of malformed) {
      const authorize = vi.fn<AppleAuthPlugin['authorize']>(async () => response as AppleAuthorizeResult);
      const { client } = makeClient({ authorize });
      await expect(client.authorize()).rejects.toMatchObject({ code: 'E_MALFORMED_RESPONSE' });
    }
  });

  it('shares one in-flight native authorization across concurrent taps', async () => {
    let resolveAuthorization!: (value: AppleAuthorizeResult) => void;
    const authorize = vi.fn<AppleAuthPlugin['authorize']>(() => new Promise((resolve) => {
      resolveAuthorization = resolve;
    }));
    const { client, randomBytes } = makeClient({ authorize });

    const first = client.authorize();
    const second = client.authorize();

    expect(second).toBe(first);
    expect(randomBytes).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));

    resolveAuthorization(successfulAuthorization());
    await expect(first).resolves.toMatchObject({ status: 'success' });
  });

  it('bounds credential-state queries and never calls iOS off-platform', async () => {
    const unavailable = makeClient({ native: true, platform: 'android' });
    await expect(unavailable.client.getCredentialState('apple-user-fixture')).resolves.toEqual({
      state: 'unavailable',
    });
    expect(unavailable.getCredentialState).not.toHaveBeenCalled();

    const available = makeClient();
    await expect(available.client.getCredentialState('apple-user-fixture')).resolves.toEqual({
      state: 'authorized',
    });
    expect(available.getCredentialState).toHaveBeenCalledWith({ userId: 'apple-user-fixture' });
    await expect(available.client.getCredentialState('x'.repeat(513))).rejects.toMatchObject({
      code: 'E_BAD_REQUEST',
    });
  });

  it('rejects extra credential-state response data instead of forwarding it', async () => {
    const { client } = makeClient({
      getCredentialState: async () => ({ state: 'authorized', identityToken: 'unexpected' }),
    });
    await expect(client.getCredentialState('apple-user-fixture')).rejects.toMatchObject({
      code: 'E_MALFORMED_RESPONSE',
    });
  });

  it('releases single-flight after cancellation and failure and uses fresh nonces on retry', async () => {
    const authorize = vi.fn<AppleAuthPlugin['authorize']>()
      .mockResolvedValueOnce({ status: 'cancelled', state: REQUEST_STATE })
      .mockRejectedValueOnce(new Error('native unavailable'))
      .mockImplementationOnce(async ({ state }) => successfulAuthorization({ state }));
    let round = 0;
    const { client } = makeClient({ authorize, randomBytes: () => bytes(32 * round++) });
    await expect(client.authorize()).resolves.toEqual({ status: 'cancelled' });
    await expect(client.authorize()).rejects.toThrow('native unavailable');
    await expect(client.authorize()).resolves.toMatchObject({ status: 'success' });
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(new Set(authorize.mock.calls.map(([request]) => request.state)).size).toBe(3);
  });
});

describe('verified Apple name candidate', () => {
  const fullName: AppleFullName = {
    givenName: '하루',
    familyName: '김',
    formatted: '김하루',
  };

  it('is available once, only to the verified Supabase user it was bound to', () => {
    stageVerifiedAppleNameCandidate('verified-user', fullName);

    expect(consumeAppleNameCandidate('verified-user')).toBe('김하루');
    expect(consumeAppleNameCandidate('verified-user')).toBeNull();
  });

  it('is not overwritten by a later null name', () => {
    stageVerifiedAppleNameCandidate('verified-user', fullName);
    stageVerifiedAppleNameCandidate('verified-user', null);

    expect(consumeAppleNameCandidate('verified-user')).toBe('김하루');
  });

  it('never crosses account identity', () => {
    stageVerifiedAppleNameCandidate('verified-user', fullName);

    expect(consumeAppleNameCandidate('other-user')).toBeNull();
    expect(consumeAppleNameCandidate('verified-user')).toBeNull();
  });

  it('notifies a mounted onboarding consumer when verification completes after session hydration', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppleNameCandidate(listener);

    stageVerifiedAppleNameCandidate('verified-user', fullName);

    expect(listener).toHaveBeenCalledWith('verified-user');
    expect(consumeAppleNameCandidate('verified-user')).toBe('김하루');
    unsubscribe();
  });

  it('does not let a presentation subscriber invalidate a verified session result', () => {
    const unsubscribe = subscribeAppleNameCandidate(() => {
      throw new Error('render boundary unavailable');
    });

    expect(() => stageVerifiedAppleNameCandidate('verified-user', fullName)).not.toThrow();
    expect(consumeAppleNameCandidate('verified-user')).toBe('김하루');
    unsubscribe();
  });

  it('bounds the editable suggestion to the onboarding nickname limit', () => {
    stageVerifiedAppleNameCandidate('verified-user', {
      formatted: '열세글자이름후보입니다가나다라마바사',
    });

    const candidate = consumeAppleNameCandidate('verified-user');
    expect(Array.from(candidate ?? '')).toHaveLength(12);
  });

  it('expires without being persisted to browser storage', () => {
    vi.useFakeTimers();
    const localWrite = vi.spyOn(localStorage, 'setItem');
    const sessionWrite = vi.spyOn(sessionStorage, 'setItem');
    try {
      stageVerifiedAppleNameCandidate('verified-user', fullName);
      vi.advanceTimersByTime(5 * 60_000 + 1);
      expect(consumeAppleNameCandidate('verified-user')).toBeNull();
      expect(localWrite).not.toHaveBeenCalled();
      expect(sessionWrite).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Apple token transport with the installed Supabase SDK', () => {
  it('never stores or emits a session when a token body arrives after timeout', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = new Map<string, string>();
    let releaseBody!: () => void;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      releaseBody = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({
          access_token: 'late-access-token-fixture', refresh_token: 'late-refresh-token-fixture',
          token_type: 'bearer', expires_in: 3600, user: { id: 'late-user' },
        })));
        controller.close();
      };
    } });
    const client = createClient('https://apple-test.supabase.co', 'test-publishable-key', {
      auth: {
        autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
        storageKey: 'apple-token-timeout-test',
        storage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => { storage.set(key, value); },
          removeItem: (key) => { storage.delete(key); },
        },
      },
      global: { fetch: createAppleTokenTimeoutFetch(async () => new Response(stream)) },
    });
    const signedIn = vi.fn();
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') signedIn();
    });
    try {
      await client.auth.getSession();
      const pending = client.auth.signInWithIdToken({
        provider: 'apple', token: 'id-token-fixture', nonce: RAW_NONCE,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.error).not.toBeNull();
      expect(result.data.session).toBeNull();
      releaseBody();
      await vi.advanceTimersByTimeAsync(0);
      expect((await client.auth.getSession()).data.session).toBeNull();
      expect(signedIn).not.toHaveBeenCalled();
      expect(storage.size).toBe(0);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(RAW_NONCE);
    } finally {
      subscription.unsubscribe();
      await client.auth.stopAutoRefresh();
      vi.useRealTimers();
    }
  });
});
