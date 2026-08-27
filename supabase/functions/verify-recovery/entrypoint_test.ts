import {
  assert,
  assertEquals,
  startSupabaseStub,
  startEntrypoint,
} from '../_shared/entrypointHarness.ts';

const ALLOWED = 'https://gomsinlog.app';

Deno.test({
  name: 'verify-recovery: fails closed with 500 when server config is missing',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      { ALLOWED_ORIGINS: ALLOWED },
      { method: 'OPTIONS', headers: { Origin: ALLOWED } },
    );
    try {
      const response = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: { Origin: ALLOWED, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assertEquals(response.status, 500, 'must return 500 on missing server env');
      assertEquals(data.error, 'Server configuration error', 'error message must match');
    } finally {
      await entrypoint.stop();
    }
  },
});

Deno.test({
  name: 'verify-recovery: origin gate rejects disallowed origins with 403',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      {
        ALLOWED_ORIGINS: ALLOWED,
        SUPABASE_URL: 'http://127.0.0.1:9999',
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_test_key' }),
      },
      { method: 'OPTIONS', headers: { Origin: ALLOWED } },
    );
    try {
      const response = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: { Origin: 'https://malicious.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assertEquals(response.status, 403, 'must return 403 on disallowed origin');
      assertEquals(data.error, 'E_ORIGIN_NOT_ALLOWED', 'must return E_ORIGIN_NOT_ALLOWED');
    } finally {
      await entrypoint.stop();
    }
  },
});

Deno.test({
  name: 'verify-recovery: unauthenticated caller receives 401 E_UNAUTHENTICATED and verifies admin headers',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      {
        ALLOWED_ORIGINS: ALLOWED,
        SUPABASE_URL: stub.base,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_admin_verify' }),
      },
      { method: 'OPTIONS', headers: { Origin: ALLOWED } },
    );
    try {
      const response = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: {
          Origin: ALLOWED,
          Authorization: 'Bearer caller_user_token_789',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      assertEquals(response.status, 401, 'must return 401 for unauthenticated caller');
      assertEquals(data.error, 'E_UNAUTHENTICATED', 'must return E_UNAUTHENTICATED');

      assert(stub.seen.length > 0, 'must have queried Auth endpoint');
      const authReq = stub.seen.find((entry) => entry.path.includes('/auth/v1/user'));
      assert(authReq, 'auth request must have been made');
      assertEquals(authReq?.apikey, 'sb_secret_admin_verify', 'apikey must be injected admin key');
      assertEquals(authReq?.authorization, 'Bearer caller_user_token_789', 'caller user token must be preserved');
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});
