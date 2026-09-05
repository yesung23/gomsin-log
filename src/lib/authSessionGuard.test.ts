import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { webcrypto } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const nativeAuthorization = vi.hoisted(() => vi.fn());
const pushRevocation = vi.hoisted(() => vi.fn());
const sdkHarness = vi.hoisted(() => ({ serial: 0, storageKey: '' }));
vi.mock('@/lib/pushTokens', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/pushTokens')>(),
  revokeOwnPushTokens: () => pushRevocation(),
}));
vi.mock('@/lib/outboxStorage', () => ({
  createIndexedDbOutbox: () => ({
    all: async () => [], add: async () => {}, put: async () => {}, putMany: async () => {},
    remove: async () => {}, removeMany: async () => {},
  }),
}));
vi.mock('@/lib/appleAuth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/appleAuth')>(),
  authorizeWithNativeApple: (...args: unknown[]) => nativeAuthorization(...args),
}));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) => {
      sdkHarness.storageKey = `apple-lifecycle-regression-${++sdkHarness.serial}`;
      return actual.createClient(
        args[0], args[1], {
          ...args[2],
          auth: { ...args[2]?.auth, autoRefreshToken: false, storageKey: sdkHarness.storageKey },
        },
      );
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function sessionResponse(id: string) {
  return {
    access_token: `access-${id}-fixture`, refresh_token: `refresh-${id}-fixture`,
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.test`,
      app_metadata: { provider: id === 'A' ? 'apple' : 'google' }, user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

const authorization = {
  status: 'success', identityToken: 'apple-id-token-fixture',
  authorizationCode: 'apple-code-fixture', appleUserId: 'apple-subject-fixture',
  rawNonce: 'raw-nonce-fixture', fullName: { formatted: '사과' },
};

let client: SupabaseClient;
let repository: import('./supabase').SupabaseAuthRepository;
let unsubscribe: () => void;
let events: string[];
let writtenUsers: string[];
let tokenStarted: ReturnType<typeof deferred<void>>;
let tokenReply: () => Promise<Response>;
let logoutReply: () => Promise<Response>;
let logoutStarted: ReturnType<typeof deferred<void>>;
let pkceVerifier: string;

beforeEach(async () => {
  vi.resetModules();
  nativeAuthorization.mockReset().mockResolvedValue(authorization);
  pushRevocation.mockReset().mockResolvedValue({ ok: true });
  events = [];
  writtenUsers = [];
  tokenStarted = deferred<void>();
  tokenReply = async () => Response.json(sessionResponse('A'));
  logoutReply = async () => new Response(null, { status: 204 });
  logoutStarted = deferred<void>();
  pkceVerifier = '';
  vi.stubEnv('VITE_SUPABASE_URL', 'https://apple-lifecycle.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    if (url.searchParams.get('grant_type') === 'id_token') {
      tokenStarted.resolve();
      return tokenReply();
    }
    if (url.searchParams.get('grant_type') === 'password') return Response.json(sessionResponse('B'));
    if (url.searchParams.get('grant_type') === 'pkce') {
      const body = JSON.parse(init!.body as string);
      expect(body.auth_code).toBe('google-code-fixture');
      pkceVerifier = body.code_verifier;
      return Response.json(sessionResponse('B'));
    }
    if (url.pathname === '/auth/v1/logout') {
      logoutStarted.resolve();
      return logoutReply();
    }
    throw new Error('Unexpected test transport route.');
  });
  const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
  const setItem = storagePrototype.setItem;
  vi.spyOn(storagePrototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === sdkHarness.storageKey) writtenUsers.push(JSON.parse(value).user.id);
    setItem.call(this, key, value);
  });
  const module = await import('./supabase');
  client = module.supabase!;
  repository = new module.SupabaseAuthRepository();
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    events.push(`${event}:${session?.user.id ?? '-'}`);
  });
  unsubscribe = () => subscription.unsubscribe();
  await client.auth.getSession();
  await waitFor(() => expect(events).toContain('INITIAL_SESSION:-'));
});

afterEach(async () => {
  unsubscribe?.();
  await client?.auth.stopAutoRefresh();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function holdTokenResponse(stall: 'headers' | 'body'): () => void {
  if (stall === 'headers') {
    const response = deferred<Response>();
    tokenReply = () => response.promise;
    return () => response.resolve(Response.json(sessionResponse('A')));
  }
  let release!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    release = () => {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(sessionResponse('A'))));
      controller.close();
    };
  } });
  tokenReply = async () => new Response(stream);
  return () => release();
}

async function signInGoogleB() {
  const started = await client.auth.signInWithOAuth({
    provider: 'google', options: { skipBrowserRedirect: true, redirectTo: 'https://app.example.test/auth/callback' },
  });
  expect(started.error).toBeNull();
  const url = new URL(started.data.url!);
  const flowId = new URL(url.searchParams.get('redirect_to')!).searchParams.get('sb_flow_id');
  expect(flowId).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
  const exchanged = await client.auth.exchangeCodeForSession('google-code-fixture', { flowId: flowId! });
  expect(exchanged.error).toBeNull();
  const challengeBytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(pkceVerifier));
  const challenge = Buffer.from(challengeBytes).toString('base64url');
  expect(url.searchParams.get('code_challenge')).toBe(challenge);
  expect(url.searchParams.get('code_challenge_method')).toBe('s256');
}

describe('Apple attempt ownership with the installed Supabase SDK', () => {
  it('cannot start a token exchange after sign-out invalidates a pending native authorization', async () => {
    const native = deferred<typeof authorization>();
    nativeAuthorization.mockReturnValueOnce(native.promise);
    const pending = repository.signInWithApple();
    await repository.signOut();
    // A second repository must not adopt the native client's still-pending call.
    const { SupabaseAuthRepository } = await import('./supabase');
    expect(await new SupabaseAuthRepository().signInWithApple()).toEqual({ cancelled: true });
    expect(nativeAuthorization).toHaveBeenCalledTimes(1);
    native.resolve(authorization);
    const result = await pending;

    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(events).not.toContain('SIGNED_IN:A');
    expect(writtenUsers).not.toContain('A');
    expect(result).toEqual({ cancelled: true });
  });

  it.each(['headers', 'body'] as const)('cannot resurrect A after sign-out while token %s are pending', async (stall) => {
    const release = holdTokenResponse(stall);
    const pending = repository.signInWithApple();
    await tokenStarted.promise;
    await repository.signOut();
    release();
    const result = await pending;

    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(events).not.toContain('SIGNED_IN:A');
    expect(writtenUsers).not.toContain('A');
    expect(result).toEqual({ cancelled: true });
  });

  it.each(['headers', 'body'] as const)('cannot overwrite B when an older Apple token %s complete', async (stall) => {
    const release = holdTokenResponse(stall);
    const pending = repository.signInWithApple();
    await tokenStarted.promise;
    await signInGoogleB();
    release();
    const result = await pending;

    expect((await client.auth.getSession()).data.session?.user.id).toBe('B');
    expect(writtenUsers).toEqual(['B']);
    expect(events.filter((event) => event.startsWith('SIGNED_'))).toEqual(['SIGNED_IN:B']);
    expect(result).toEqual({ cancelled: true });
  });

  it('lets a genuine new Apple sign-in persist and emit SIGNED_IN without cancelling itself', async () => {
    expect(await repository.signInWithApple()).toEqual({});
    expect((await client.auth.getSession()).data.session?.user.id).toBe('A');
    expect(writtenUsers).toEqual(['A']);
    expect(events.filter((event) => event.startsWith('SIGNED_'))).toEqual(['SIGNED_IN:A']);
    const { consumeAppleNameCandidate } = await import('./appleAuth');
    expect(consumeAppleNameCandidate('A')).toBe('사과');
  });

  it.each(['repository', 'SDK'] as const)('invalidates at %s sign-out START before the remote logout response or SIGNED_OUT', async (entry) => {
    await signInGoogleB();
    const logout = deferred<Response>();
    logoutReply = () => logout.promise;
    const release = holdTokenResponse('body');
    const pending = repository.signInWithApple();
    await tokenStarted.promise;
    const leaving = entry === 'SDK' ? client.auth.signOut() : repository.signOut();
    await logoutStarted.promise;
    release();
    try {
      expect(await pending).toEqual({ cancelled: true });
      expect(events).not.toContain('SIGNED_OUT:-');
      expect(writtenUsers).toEqual(['B']);
      // The first operation has settled, but logout still owns the lifecycle.
      expect(await repository.signInWithApple()).toEqual({ cancelled: true });
      expect(nativeAuthorization).toHaveBeenCalledTimes(1);
    } finally {
      logout.resolve(new Response(null, { status: 204 }));
      await leaving;
    }
    expect((await client.auth.getSession()).data.session).toBeNull();
    tokenReply = async () => Response.json(sessionResponse('A'));
    expect(await repository.signInWithApple()).toEqual({});
    expect((await client.auth.getSession()).data.session?.user.id).toBe('A');
  });

  it('invalidates at the live store logout entry before waiting for push revocation', async () => {
    const { StoreProvider } = await import('./store');
    const { useStore } = await import('./useStore');
    const push = deferred<{ ok: boolean }>();
    pushRevocation.mockReturnValue(push.promise);
    let signOut!: () => Promise<void>;
    function Probe() { signOut = useStore().signOut; return null; }
    const view = render(createElement(StoreProvider, null, createElement(Probe)));
    const native = deferred<typeof authorization>();
    nativeAuthorization.mockReturnValueOnce(native.promise);
    const pending = repository.signInWithApple();
    let leaving!: Promise<void>;
    act(() => { leaving = signOut(); });
    native.resolve(authorization);
    try {
      expect(await pending).toEqual({ cancelled: true });
      expect(writtenUsers).toEqual([]);
      expect(events).not.toContain('SIGNED_OUT:-');
      expect(events).not.toContain('SIGNED_IN:A');
    } finally {
      await act(async () => { push.resolve({ ok: true }); await leaving; });
      view.unmount();
    }
  });

  it('does not treat signing out other devices as a local logout', async () => {
    await signInGoogleB();
    const release = holdTokenResponse('body');
    const pending = repository.signInWithApple();
    await tokenStarted.promise;
    expect((await client.auth.signOut({ scope: 'others' })).error).toBeNull();
    release();
    expect(await pending).toEqual({});
    expect((await client.auth.getSession()).data.session?.user.id).toBe('A');
    expect(events).not.toContain('SIGNED_OUT:-');
  });

  it('rejects a pending native result after Google has established B', async () => {
    const native = deferred<typeof authorization>();
    nativeAuthorization.mockReturnValueOnce(native.promise);
    const pending = repository.signInWithApple();
    await signInGoogleB();
    native.resolve(authorization);
    expect(await pending).toEqual({ cancelled: true });
    expect((await client.auth.getSession()).data.session?.user.id).toBe('B');
    expect(writtenUsers).toEqual(['B']);
  });
});

describe('the synchronous SDK storage commit boundary', () => {
  it.each(['logout', 'B commit'] as const)('rejects A after JSON was consumed but before storage, following %s', async (change) => {
    const { createAuthSessionGuard, authSessionStorage, AppleAttemptInvalidatedError } = await import('./authSessionGuard');
    const { createAppleTokenTimeoutFetch } = await import('./appleAuth');
    const guard = createAuthSessionGuard();
    const storage = guard.wrapStorage(authSessionStorage());
    const attempt = guard.beginAppleAttempt();
    const transport = createAppleTokenTimeoutFetch(async () => Response.json(sessionResponse('A')), guard.currentAttempt);
    const response = await transport('https://apple-lifecycle.supabase.co/auth/v1/token?grant_type=id_token');
    const data = await response.json();
    const finish = change === 'logout' ? guard.beginSignOut() : () => {};
    if (change === 'B commit') storage.setItem('commit-boundary', JSON.stringify(sessionResponse('B')));
    try {
      expect(() => storage.setItem('commit-boundary', JSON.stringify(data))).toThrow(AppleAttemptInvalidatedError);
      expect(storage.getItem('commit-boundary')).toBe(change === 'logout' ? null : JSON.stringify(sessionResponse('B')));
    } finally { finish(); attempt.finish(); }
  });

  it('invalidates before automatic SDK session removal can yield to an old Apple response', async () => {
    const { createAuthSessionGuard, authSessionStorage } = await import('./authSessionGuard');
    const guard = createAuthSessionGuard();
    const storage = guard.wrapStorage(authSessionStorage());
    storage.setItem('removal-boundary', JSON.stringify(sessionResponse('B')));
    const attempt = guard.beginAppleAttempt();
    storage.removeItem('removal-boundary');
    expect(attempt.signal.aborted).toBe(true);
    attempt.finish();
  });

  it('preserves PKCE verifier bytes and does not invalidate Apple for non-session cleanup', async () => {
    const { createAuthSessionGuard, authSessionStorage } = await import('./authSessionGuard');
    const guard = createAuthSessionGuard();
    const storage = guard.wrapStorage(authSessionStorage());
    const attempt = guard.beginAppleAttempt();
    const value = JSON.stringify('pkce-verifier-fixture');
    storage.setItem('code-verifier:flow-fixture', value);
    expect(storage.getItem('code-verifier:flow-fixture')).toBe(value);
    storage.removeItem('code-verifier:flow-fixture');
    expect(attempt.signal.aborted).toBe(false);
    attempt.finish();
  });
});
