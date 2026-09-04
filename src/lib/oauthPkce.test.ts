import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { AUTH_CALLBACK_TIMEOUT_MS } from '@/lib/async';
import { createPkceTimeoutFetch, validatePkceFlowId } from '@/lib/oauthPkce';

function abortableFetch() {
  let signal: AbortSignal | undefined;
  let resolveLate!: (response: Response) => void;
  const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      signal = init?.signal ?? undefined;
      resolveLate = resolve;
      const rejectAbort = () => reject(new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) rejectAbort();
      else signal?.addEventListener('abort', rejectAbort, { once: true });
    }));
  return {
    fetchImpl: fetchImpl as typeof fetch,
    getSignal: () => signal,
    resolveLate: (response: Response) => resolveLate(response),
  };
}

/**
 * A response whose headers have arrived but whose body is still streaming.
 *
 * `@supabase/auth-js` only saves the session after `await result.json()`, so
 * this is the shape that used to escape the transport deadline entirely.
 */
function stalledBodyResponse(payload: string, status = 200) {
  let sendBody!: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sendBody = () => {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      };
    },
  });
  return {
    response: new Response(stream, {
      status,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    }),
    sendBody: () => sendBody(),
  };
}

/** Resolves headers immediately; the body arrives only when released. */
function stalledBodyFetch(payload: string) {
  const stalled = stalledBodyResponse(payload);
  let signal: AbortSignal | undefined;
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return stalled.response;
  });
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getSignal: () => signal,
    sendBody: stalled.sendBody,
  };
}

afterEach(() => vi.useRealTimers());

describe('PKCE flow id validation', () => {
  it('pins the SDK version that provides the reviewed experimental flow-id contract', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies['@supabase/supabase-js']).toBe('2.111.0');
  });

  it('matches the SDK flow id boundary exactly', () => {
    expect(validatePkceFlowId('aB0_-123')).toBe('aB0_-123');
    expect(validatePkceFlowId('a'.repeat(64))).toBe('a'.repeat(64));
    expect(validatePkceFlowId('short')).toBeNull();
    expect(validatePkceFlowId('a'.repeat(65))).toBeNull();
    expect(validatePkceFlowId('invalid.flow')).toBeNull();
    expect(validatePkceFlowId(null)).toBeNull();
  });

  it('round-trips the SDK flow id through the configured callback URL', async () => {
    const values = new Map<string, string>();
    const client = createClient('https://project.supabase.co', 'publishable-key', {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
        flowType: 'pkce',
        experimental: { appendPkceFlowIdToRedirects: true },
        storage: {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => { values.set(key, value); },
          removeItem: (key) => { values.delete(key); },
        },
      },
    });

    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'gomsinlog://auth/callback',
        skipBrowserRedirect: true,
      },
    });

    expect(error).toBeNull();
    expect(validatePkceFlowId(data.flowId)).toBe(data.flowId);
    const authorizeUrl = new URL(data.url);
    const redirectUrl = new URL(authorizeUrl.searchParams.get('redirect_to')!);
    expect(redirectUrl.searchParams.get('sb_flow_id')).toBe(data.flowId);
  });
});

describe('PKCE token transport timeout', () => {
  it('aborts only the PKCE token endpoint after 15 seconds', async () => {
    vi.useFakeTimers();
    const transport = abortableFetch();
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
      { method: 'POST' },
    );
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS - 1);
    expect(transport.getSignal()?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(transport.getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also deadlines refresh-token recovery without changing its request payload', async () => {
    vi.useFakeTimers();
    const transport = abortableFetch();
    const headers = { apikey: 'publishable-key', 'content-type': 'application/json' };
    const body = '{"refresh_token":"opaque-refresh-token"}';
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', headers, body },
    );
    void request.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS);

    expect(transport.getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(transport.fetchImpl).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      expect.objectContaining({ method: 'POST', headers, body }),
    );
  });

  it.each([
    'https://project.supabase.co/auth/v1/token?grant_type=password',
    'https://project.supabase.co/rest/v1/token?grant_type=pkce',
    'not a url',
  ])('passes non-PKCE requests through unchanged: %s', async (url) => {
    const response = new Response('ok');
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
    const init = { method: 'POST', headers: { 'x-test': '1' } };

    await expect(createPkceTimeoutFetch(fetchImpl)(url, init)).resolves.toBe(response);

    expect(fetchImpl).toHaveBeenCalledWith(url, init);
  });

  it('forwards an existing caller abort and removes its timeout', async () => {
    vi.useFakeTimers();
    const transport = abortableFetch();
    const caller = new AbortController();
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
      { signal: caller.signal },
    );
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);

    caller.abort();

    await rejection;
    expect(transport.getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves a complete response before the deadline and cleans up', async () => {
    vi.useFakeTimers();
    const transport = abortableFetch();
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
    );
    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS - 1);

    transport.resolveLate(new Response('{"access_token":"real"}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    }));

    const delivered = await request;
    expect(delivered.ok).toBe(true);
    expect(delivered.status).toBe(200);
    expect(delivered.headers.get('content-type')).toBe('application/json');
    await expect(delivered.json()).resolves.toEqual({ access_token: 'real' });
    expect(transport.getSignal()?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves a body-less status untouched and still clears the deadline', async () => {
    vi.useFakeTimers();
    const transport = abortableFetch();
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
    );
    await vi.advanceTimersByTimeAsync(0);
    const response = new Response(null, { status: 204 });

    transport.resolveLate(response);

    await expect(request).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot become successful after transport abort rejects the request', async () => {
    vi.useFakeTimers();
    const transport = abortableFetch();
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
    );
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS);
    await rejection;

    transport.resolveLate(new Response('late'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

/**
 * The deadline has to outlive the response headers. `@supabase/auth-js` reads
 * the token body after its `fetch` promise resolves and saves the session only
 * then, so a deadline released at the headers would let a stalled body hang the
 * sign-in forever -- or install a session long after the user gave up.
 */
describe('PKCE token transport deadline over the response body', () => {
  it('keeps the deadline armed while the body is still streaming', async () => {
    vi.useFakeTimers();
    const transport = stalledBodyFetch('{"access_token":"late"}');
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
      { method: 'POST' },
    );

    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS - 1);

    expect(vi.getTimerCount()).toBe(1);
    expect(transport.getSignal()?.aborted).toBe(false);

    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it('keeps the refresh-token deadline armed until its response body finishes', async () => {
    vi.useFakeTimers();
    const transport = stalledBodyFetch('{"access_token":"late-refresh"}');
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', body: '{"refresh_token":"opaque"}' },
    );
    void request.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS);

    expect(transport.getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts and rejects when headers arrive in time but the body does not', async () => {
    vi.useFakeTimers();
    const transport = stalledBodyFetch('{"access_token":"late"}');
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
      { method: 'POST' },
    );
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS);

    await rejection;
    expect(transport.getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can never succeed once the deadline passed, even if the body then arrives', async () => {
    vi.useFakeTimers();
    const transport = stalledBodyFetch('{"access_token":"stolen-late-session"}');
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
      { method: 'POST' },
    );
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(AUTH_CALLBACK_TIMEOUT_MS);
    await rejection;

    // The transport finally hands over a perfectly valid session payload.
    transport.sendBody();
    await vi.advanceTimersByTimeAsync(0);

    // It must not turn the abandoned sign-in into a success.
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards a caller abort that lands while the body is streaming', async () => {
    vi.useFakeTimers();
    const transport = stalledBodyFetch('{"access_token":"late"}');
    const caller = new AbortController();
    const request = createPkceTimeoutFetch(transport.fetchImpl)(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
      { signal: caller.signal },
    );
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);

    caller.abort();

    await rejection;
    expect(transport.getSignal()?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('OAuth start logging', () => {
  it('never logs the raw caught error when starting OAuth', () => {
    const source = readFileSync('src/lib/supabase.ts', 'utf8');
    const start = source.indexOf('private async startOAuth');
    const end = source.indexOf('async signInWithGoogle', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const startOAuth = source.slice(start, end);

    expect(startOAuth).toContain("console.error('[gomsinlog] OAuth start failed.');");
    // No second console argument, no template literal, no caught binding.
    expect(startOAuth).not.toMatch(/console\.\w+\([^)]*,/);
    expect(startOAuth).not.toMatch(/console\.\w+\(`/);
    expect(startOAuth).not.toMatch(/catch\s*\(/);
  });
});
