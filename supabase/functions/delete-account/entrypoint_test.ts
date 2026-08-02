/**
 * Real-Deno validation of the actual entrypoint.
 *
 * Vitest exercises `handler.ts` with doubles, which proves the LOGIC but says
 * nothing about whether `index.ts` wires the real dependencies correctly, nor
 * whether the module works under Deno with the `npm:` specifier. This closes
 * that gap without deploying anything, and WITHOUT stubbing any Deno API:
 *
 *   1. `index.ts` is spawned as a real subprocess (`deno run`), so the genuine
 *      `Deno.serve`, `Deno.env` and `npm:@supabase/supabase-js@2` are all in
 *      play.
 *   2. Real HTTP requests are sent to it and the responses are compared, status
 *      / headers / body, against calling `handleDeleteAccountRequest` directly
 *      with the same env -- proving argument and response shapes match.
 *   3. A local HTTP server stands in for the Supabase Auth endpoint, proving the
 *      entrypoint constructs a working admin client from the injected
 *      (url, serviceRoleKey) and that the handler uses it.
 *
 * Run with:
 *   deno test --allow-net --allow-env --allow-read --allow-run \
 *     supabase/functions/delete-account/entrypoint_test.ts
 */

import { handleDeleteAccountRequest } from './handler.ts';

const ALLOWED = 'https://gomsinlog.app';
/** `Deno.serve(handler)` with no options listens here, exactly as it does on the
 *  Supabase Edge runtime. Not configurable from the test, which is the point. */
const FUNCTION_PORT = 8000;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`assertion failed: ${message} (got ${a}, expected ${e})`);
}

/** A stand-in for the Supabase Auth/REST endpoint. */
function startSupabaseStub(): {
  base: string;
  seen: Array<{ path: string; apikey: string | null }>;
  stop: () => Promise<void>;
} {
  const seen: Array<{ path: string; apikey: string | null }> = [];
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen: () => {} },
    (incoming) => {
      const url = new URL(incoming.url);
      seen.push({ path: url.pathname, apikey: incoming.headers.get('apikey') });
      return new Response(JSON.stringify({ message: 'invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  return {
    base: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`,
    seen,
    stop: () => server.shutdown(),
  };
}

/** Spawn the REAL entrypoint and wait until it answers. */
async function startEntrypoint(env: Record<string, string>): Promise<{
  origin: string;
  stop: () => Promise<void>;
}> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      'run', '--allow-net', '--allow-env', '--quiet',
      new URL('./index.ts', import.meta.url).pathname,
    ],
    // The subprocess inherits HOME/DENO_DIR so the already-warmed npm cache for
    // `npm:@supabase/supabase-js@2` is reused; only the function's own variables
    // are injected on top.
    env: { ...env, NO_COLOR: '1' },
    stdout: 'piped',
    stderr: 'piped',
  });
  const child = command.spawn();
  const origin = `http://127.0.0.1:${FUNCTION_PORT}`;

  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    try {
      const probe = await fetch(`${origin}/delete-account`, {
        method: 'OPTIONS',
        headers: { Origin: ALLOWED },
      });
      await probe.text();
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const stop = async () => {
    try {
      child.kill('SIGKILL');
    } catch { /* already gone */ }
    await child.output();
    // Give the OS a moment to release the port before the next test binds it.
    await new Promise((resolve) => setTimeout(resolve, 250));
  };

  if (!ready) {
    const output = await child.output();
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(`the entrypoint subprocess never became ready:\n${stderr}`);
  }
  return { origin, stop };
}

type Case = { method: string; origin: string | null; authorization?: string };

const SHAPE_CASES: Case[] = [
  { method: 'OPTIONS', origin: ALLOWED },
  { method: 'OPTIONS', origin: 'https://evil.example' },
  { method: 'OPTIONS', origin: null },
  { method: 'GET', origin: ALLOWED, authorization: 'Bearer t' },
  { method: 'POST', origin: ALLOWED },
  { method: 'POST', origin: 'https://evil.example', authorization: 'Bearer t' },
];

function directRequest(testCase: Case): Request {
  const headers = new Headers();
  if (testCase.origin !== null) headers.set('Origin', testCase.origin);
  if (testCase.authorization) headers.set('Authorization', testCase.authorization);
  return new Request('https://edge.example/delete-account', {
    method: testCase.method,
    headers,
  });
}

const COMPARED_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'vary',
  'content-type',
];

function comparableHeaders(response: Response): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const name of COMPARED_HEADERS) {
    const value = response.headers.get(name);
    // Deno.serve may add Accept-Encoding when its HTTP layer negotiates
    // compression. That is transport metadata, not a CORS behavior difference.
    result[name] = name === 'vary' && value
      ? value.split(',')
        .map((token) => token.trim())
        .filter((token) => token.toLowerCase() !== 'accept-encoding')
        .sort()
        .join(', ')
      : value;
  }
  return result;
}

function assertVariesOnOrigin(response: Response, message: string): void {
  const varyTokens = (response.headers.get('vary') ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase());
  assert(varyTokens.includes('origin'), message);
}

Deno.test({
  name: 'the real entrypoint agrees with the tested handler on argument and response shapes',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const env = {
      ALLOWED_ORIGINS: ALLOWED,
      SUPABASE_URL: stub.base,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    };
    const entrypoint = await startEntrypoint(env);

    try {
      for (const testCase of SHAPE_CASES) {
        const headers = new Headers();
        if (testCase.origin !== null) headers.set('Origin', testCase.origin);
        if (testCase.authorization) headers.set('Authorization', testCase.authorization);

        const overHttp = await fetch(`${entrypoint.origin}/delete-account`, {
          method: testCase.method,
          headers,
        });
        const httpBody = await overHttp.text();

        const direct = await handleDeleteAccountRequest(directRequest(testCase), {
          env: (key: string) => (env as Record<string, string>)[key],
          createAdmin: () => {
            throw new Error('createAdmin must not be reached for these cases');
          },
        });
        const directBody = await direct.text();

        const label = `${testCase.method} ${testCase.origin ?? '<no Origin>'}`;
        assertEquals(overHttp.status, direct.status, `status must match for ${label}`);
        assertEquals(
          comparableHeaders(overHttp),
          comparableHeaders(direct),
          `headers must match for ${label}`,
        );
        assertEquals(httpBody, directBody, `body must match for ${label}`);
      }
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});

Deno.test({
  name: 'the real entrypoint fails closed when ALLOWED_ORIGINS is unset',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const entrypoint = await startEntrypoint({
      SUPABASE_URL: stub.base,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });
    try {
      for (const method of ['OPTIONS', 'POST', 'GET']) {
        const response = await fetch(`${entrypoint.origin}/delete-account`, {
          method,
          headers: { Origin: ALLOWED, Authorization: 'Bearer t' },
        });
        await response.text();
        assertEquals(response.status, 500, `${method} must fail closed with 500`);
        assertVariesOnOrigin(response, `${method} must still send Vary: Origin`);
        assertEquals(
          response.headers.get('access-control-allow-origin'),
          null,
          `${method} must reflect nothing`,
        );
      }
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});

Deno.test({
  name: 'the real entrypoint builds a working supabase-js admin client from (url, key)',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const entrypoint = await startEntrypoint({
      ALLOWED_ORIGINS: ALLOWED,
      SUPABASE_URL: stub.base,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    try {
      const response = await fetch(`${entrypoint.origin}/delete-account`, {
        method: 'POST',
        headers: { Origin: ALLOWED, Authorization: 'Bearer some-token' },
      });
      await response.text();

      assertEquals(response.status, 401, 'an unverifiable token must yield 401');
      assertVariesOnOrigin(response, 'Vary: Origin must still be present');
      assertEquals(
        response.headers.get('access-control-allow-origin'),
        ALLOWED,
        'an allowlisted origin must be reflected',
      );

      assert(stub.seen.length > 0, 'the real client must have issued a request');
      assert(
        stub.seen.some((entry) => entry.path.includes('/auth/v1/user')),
        `the client must call the Auth user endpoint (saw ${JSON.stringify(stub.seen)})`,
      );
      assert(
        stub.seen.some((entry) => entry.apikey === 'service-role-key'),
        'the injected service-role key must be sent as apikey',
      );
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});
