import {
  assert,
  assertEquals,
  startSupabaseStub,
  startEntrypoint,
} from '../_shared/entrypointHarness.ts';

const VALID_SCHEDULER_SECRET = 'record_media_cleanup_scheduler_secret_32_chars';
const VALID_ADMIN_KEY = 'sb_secret_record_media_cleanup_admin';
const HEADER = 'x-record-media-cleanup-scheduler-secret';

Deno.test({
  name: 'record media cleanup entrypoint: rejects non-POST methods',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const entrypoint = await startEntrypoint(new URL('./index.ts', import.meta.url), {});
    try {
      const response = await fetch(entrypoint.origin, { method: 'GET' });
      assertEquals(response.status, 405, 'GET must be rejected');
      assertEquals((await response.json()).error, 'E_METHOD_NOT_ALLOWED', 'error code');
    } finally {
      await entrypoint.stop();
    }
  },
});

Deno.test({
  name: 'record media cleanup entrypoint: invalid configuration fails closed before backend access',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const invalidConfigurations: Array<Record<string, string>> = [
      { SUPABASE_URL: stub.base, SUPABASE_SECRET_KEYS: JSON.stringify({ default: VALID_ADMIN_KEY }) },
      { SUPABASE_URL: stub.base, RECORD_MEDIA_CLEANUP_SCHEDULER_SECRET: VALID_SCHEDULER_SECRET },
      {
        SUPABASE_URL: stub.base,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'legacy-service-role-key' }),
        RECORD_MEDIA_CLEANUP_SCHEDULER_SECRET: VALID_SCHEDULER_SECRET,
      },
    ];
    for (const env of invalidConfigurations) {
      const entrypoint = await startEntrypoint(new URL('./index.ts', import.meta.url), env, {
        method: 'POST',
      });
      try {
        const response = await fetch(entrypoint.origin, {
          method: 'POST',
          headers: { [HEADER]: VALID_SCHEDULER_SECRET },
        });
        assertEquals(response.status, 503, 'invalid configuration must return 503');
        assertEquals(
          (await response.json()).error,
          'E_RECORD_MEDIA_CLEANUP_NOT_CONFIGURED',
          'configuration error code',
        );
      } finally {
        await entrypoint.stop();
      }
    }
    assertEquals(stub.seen.length, 0, 'invalid configuration must not reach Supabase');
    await stub.stop();
  },
});

Deno.test({
  name: 'record media cleanup entrypoint: only the dedicated scheduler header authorizes a claim',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub();
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      {
        SUPABASE_URL: stub.base,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: VALID_ADMIN_KEY }),
        RECORD_MEDIA_CLEANUP_SCHEDULER_SECRET: VALID_SCHEDULER_SECRET,
      },
      { method: 'POST' },
    );
    try {
      const deniedHeaders: Array<Record<string, string>> = [
        {},
        { [HEADER]: 'wrong_record_media_cleanup_secret_32_chars' },
        { Authorization: `Bearer ${VALID_SCHEDULER_SECRET}` },
        { [HEADER]: VALID_ADMIN_KEY },
      ];
      for (const headers of deniedHeaders) {
        const response = await fetch(entrypoint.origin, { method: 'POST', headers });
        assertEquals(response.status, 401, 'alternate or wrong credentials must be rejected');
        assertEquals((await response.json()).error, 'E_UNAUTHENTICATED', 'auth error code');
      }
      assertEquals(stub.seen.length, 0, 'denied requests must not reach Supabase');
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});

Deno.test({
  name: 'record media cleanup entrypoint: valid scheduler auth uses the opaque admin key for one claim',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/rest/v1/rpc/claim_record_media_cleanup_job')) {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith('/rest/v1/rpc/claim_record_media_object_cleanup_job')) {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ message: 'unexpected endpoint' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const entrypoint = await startEntrypoint(
      new URL('./index.ts', import.meta.url),
      {
        SUPABASE_URL: stub.base,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: VALID_ADMIN_KEY }),
        RECORD_MEDIA_CLEANUP_SCHEDULER_SECRET: VALID_SCHEDULER_SECRET,
      },
      { method: 'POST' },
    );
    try {
      const response = await fetch(entrypoint.origin, {
        method: 'POST',
        headers: { [HEADER]: VALID_SCHEDULER_SECRET },
      });
      assertEquals(response.status, 200, 'idle claim must succeed');
      assertEquals(await response.json(), { outcome: 'idle', deletedObjects: 0 }, 'idle body');
      assertEquals(stub.seen.length, 2, 'prefix and object queues are each claimed once');
      assert(
        stub.seen[0].path.endsWith('/rest/v1/rpc/claim_record_media_cleanup_job'),
        'the first backend call must preserve the prefix-first claim',
      );
      assert(
        stub.seen[1].path.endsWith('/rest/v1/rpc/claim_record_media_object_cleanup_job'),
        'the second backend call may claim one exact object only after an empty prefix queue',
      );
      assertEquals(stub.seen[0].apikey, VALID_ADMIN_KEY, 'opaque key must be sent as apikey');
      assertEquals(stub.seen[0].authorization, null, 'opaque admin key must not be sent as bearer');
      const body = JSON.parse(stub.seen[0].body ?? '{}');
      assert(typeof body.p_lease_id === 'string', 'claim must send a generated lease UUID');
      assertEquals(body.p_lease_seconds, 120, 'claim must use the bounded lease duration');
      const objectBody = JSON.parse(stub.seen[1].body ?? '{}');
      assertEquals(objectBody.p_lease_id, body.p_lease_id, 'both queues use the same invocation lease');
      assertEquals(objectBody.p_lease_seconds, 120, 'object claim uses the bounded lease duration');
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});
