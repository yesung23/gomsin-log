import {
  assert,
  assertEquals,
  startSupabaseStub,
  startEntrypoint,
} from '../_shared/entrypointHarness.ts';

const VALID_SCHEDULER_SECRET = 'high_entropy_custom_scheduler_secret_32_characters_long';
const VALID_ADMIN_KEY = 'sb_secret_admin_default_key_456';

Deno.test({
  name: 'send-push: rejects non-POST methods with 405',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      {},
      { method: 'POST' },
    );
    try {
      const response = await fetch(entrypoint.origin, { method: 'GET' });
      const data = await response.json();
      assertEquals(response.status, 405, 'GET must return 405');
      assertEquals(data.error, 'E_METHOD_NOT_ALLOWED', 'error must be E_METHOD_NOT_ALLOWED');
    } finally {
      await entrypoint.stop();
    }
  },
});

Deno.test({
  name: 'send-push: fails with 503 E_PUSH_NOT_CONFIGURED when PUSH_SCHEDULER_SECRET is missing or invalid',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    for (const secret of [undefined, '', 'short-secret', '   ' + VALID_SCHEDULER_SECRET]) {
      const env: Record<string, string> = {
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: VALID_ADMIN_KEY }),
      };
      if (secret !== undefined) env.PUSH_SCHEDULER_SECRET = secret;
      const entrypoint = await startEntrypoint(
        new URL('./index.ts', import.meta.url),
        env,
        { method: 'POST' },
      );
      try {
        const response = await fetch(entrypoint.origin, {
          method: 'POST',
          headers: { 'x-push-scheduler-secret': VALID_SCHEDULER_SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await response.json();
        assertEquals(response.status, 503, 'must return 503 when PUSH_SCHEDULER_SECRET is missing or invalid');
        assertEquals(data.error, 'E_PUSH_NOT_CONFIGURED', 'must return E_PUSH_NOT_CONFIGURED');
      } finally {
        await entrypoint.stop();
      }
    }
  },
});

Deno.test({
  name: 'send-push: rejects missing or wrong caller secret with 401 without reaching admin/FCM',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      {
        SUPABASE_URL: stub.base,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: VALID_ADMIN_KEY }),
        PUSH_SCHEDULER_SECRET: VALID_SCHEDULER_SECRET,
      },
      { method: 'POST' },
    );
    try {
      // Case 1: Missing secret header
      const resMissing = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const dataMissing = await resMissing.json();
      assertEquals(resMissing.status, 401, 'missing secret must return 401');
      assertEquals(dataMissing.error, 'Unauthorized', 'must return generic Unauthorized');

      // Case 2: Wrong secret header
      const resWrong = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: { 'x-push-scheduler-secret': 'wrong_scheduler_secret_value_32_characters', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const dataWrong = await resWrong.json();
      assertEquals(resWrong.status, 401, 'wrong secret must return 401');
      assertEquals(dataWrong.error, 'Unauthorized', 'must return generic Unauthorized');

      // Case 3: Admin key passed instead of scheduler secret
      const resAdminKey = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: { 'x-push-scheduler-secret': VALID_ADMIN_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const dataAdminKey = await resAdminKey.json();
      assertEquals(resAdminKey.status, 401, 'admin key cannot substitute for scheduler secret');
      assertEquals(dataAdminKey.error, 'Unauthorized', 'must return generic Unauthorized');

      // Case 4: Authorization is reserved for user JWTs on user-facing functions.
      // The scheduler accepts only its dedicated header, so a bearer token cannot
      // become an accidental second authentication path.
      const resBearer = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_SCHEDULER_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const dataBearer = await resBearer.json();
      assertEquals(resBearer.status, 401, 'Authorization bearer fallback must be rejected');
      assertEquals(dataBearer.error, 'Unauthorized', 'must return generic Unauthorized');

      // Assert that neither Admin nor DB was queried on denied caller
      assertEquals(stub.seen.length, 0, 'denied requests must not reach admin or database');
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});

Deno.test({
  name: 'send-push: authenticates caller with valid PUSH_SCHEDULER_SECRET and advances to configuration/handler',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      {
        SUPABASE_URL: stub.base,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: VALID_ADMIN_KEY }),
        PUSH_SCHEDULER_SECRET: VALID_SCHEDULER_SECRET,
      },
      { method: 'POST' },
    );
    try {
      const response = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: { 'x-push-scheduler-secret': VALID_SCHEDULER_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      // Caller authentication succeeded (did not return 401). Since FCM is not configured in this test,
      // it fails at step 4 with 503 E_PUSH_NOT_CONFIGURED, proving it passed caller auth and reached FCM init.
      assertEquals(response.status, 503, 'must advance past caller auth');
      assertEquals(data.error, 'E_PUSH_NOT_CONFIGURED', 'must proceed to FCM configuration');
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});

Deno.test({
  name: 'send-push: FCM fetch timeout policy is strictly shorter than DB claim lease (migration 066)',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const script = [
      "import {",
      "  FCM_FETCH_TIMEOUT_MS,",
      "  DEFAULT_PUSH_LEASE_SECONDS,",
      "} from './supabase/functions/send-push/index.ts';",
      "",
      "if (typeof FCM_FETCH_TIMEOUT_MS !== 'number' || FCM_FETCH_TIMEOUT_MS <= 0) {",
      "  throw new Error('FCM_FETCH_TIMEOUT_MS must be a positive number');",
      "}",
      "if (typeof DEFAULT_PUSH_LEASE_SECONDS !== 'number' || DEFAULT_PUSH_LEASE_SECONDS <= 0) {",
      "  throw new Error('DEFAULT_PUSH_LEASE_SECONDS must be a positive number');",
      "}",
      "const leaseMs = DEFAULT_PUSH_LEASE_SECONDS * 1000;",
      "if (FCM_FETCH_TIMEOUT_MS >= leaseMs) {",
      "  throw new Error('FCM fetch timeout (' + FCM_FETCH_TIMEOUT_MS + 'ms) must be strictly shorter than DB lease (' + leaseMs + 'ms)');",
      "}",
      "if (FCM_FETCH_TIMEOUT_MS > 60000) {",
      "  throw new Error('FCM fetch timeout (' + FCM_FETCH_TIMEOUT_MS + 'ms) is too long for 300s lease window');",
      "}",
      "console.log('POLICY_OK');",
      "Deno.exit(0);",
    ].join('\n');
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ['eval', script],
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    assert(output.success, `policy check script failed:\n${stderr}`);
    assert(stdout.includes('POLICY_OK'), 'policy check must output POLICY_OK');
  },
});

Deno.test({
  name: 'send-push: deliverFcmMessage passes AbortSignal with timeout to fetch and handles timeout / ok / error',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const script = `
      import {
        deliverFcmMessage,
        FCM_FETCH_TIMEOUT_MS,
      } from './supabase/functions/send-push/index.ts';

      let capturedSignal = undefined;
      let capturedUrl = '';
      let capturedBody = '';

      const dummyCandidate = {
        user_id: 'u-1',
        platform: 'ios',
        token: 'fcm-token-123',
        decided_at: '2026-08-27T00:00:00Z',
        claim_id: 'claim-123',
      };

      // 1. Verify signal and payload are passed to fetch on success
      const mockSuccessFetch = async (url, init) => {
        capturedUrl = String(url);
        capturedSignal = init?.signal;
        capturedBody = String(init?.body);
        return new Response(JSON.stringify({ name: 'projects/p/messages/msg-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const successResult = await deliverFcmMessage({
        projectId: 'my-project',
        bearer: 'bearer-test-token',
        candidate: dummyCandidate,
        fetchFn: mockSuccessFetch,
      });

      if (!successResult.ok) throw new Error('successResult should be ok: true');
      if (!capturedSignal || !(capturedSignal instanceof AbortSignal)) {
        throw new Error('deliverFcmMessage must pass an AbortSignal instance to fetch');
      }
      if (!capturedUrl.includes('my-project/messages:send')) {
        throw new Error('deliverFcmMessage must call messages:send on project');
      }
      if (!capturedBody.includes('fcm-token-123') || !capturedBody.includes('새로운 소식이 있어요')) {
        throw new Error('deliverFcmMessage body must contain token and notification body');
      }

      // 2. Verify timeout / abort error propagation
      const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      const mockTimeoutFetch = async () => {
        throw timeoutError;
      };

      let timeoutThrown = false;
      try {
        await deliverFcmMessage({
          projectId: 'my-project',
          bearer: 'bearer-test-token',
          candidate: dummyCandidate,
          fetchFn: mockTimeoutFetch,
        });
      } catch (err) {
        timeoutThrown = true;
        if (err.name !== 'TimeoutError') throw new Error('Expected TimeoutError');
      }
      if (!timeoutThrown) throw new Error('deliverFcmMessage must propagate fetch TimeoutError');

      // 3. Verify non-ok response consumes error body and identifies dead token
      const mockDeadTokenFetch = async () => {
        return new Response(JSON.stringify({
          error: {
            code: 404,
            status: 'NOT_FOUND',
            details: [{ errorCode: 'UNREGISTERED' }],
          },
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const deadResult = await deliverFcmMessage({
        projectId: 'my-project',
        bearer: 'bearer-test-token',
        candidate: dummyCandidate,
        fetchFn: mockDeadTokenFetch,
      });

      if (deadResult.ok !== false || deadResult.tokenGone !== true) {
        throw new Error('dead token response must return ok: false and tokenGone: true');
      }

      console.log('DELIVER_TEST_OK');
      Deno.exit(0);
    `;
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ['eval', script],
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    assert(output.success, `deliver test script failed:\n${stderr}`);
    assert(stdout.includes('DELIVER_TEST_OK'), 'deliver test must output DELIVER_TEST_OK');
  },
});
