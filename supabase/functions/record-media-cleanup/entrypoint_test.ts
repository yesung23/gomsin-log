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
  name: 'record media cleanup entrypoint: contract 4 is probed before concurrent queue claims',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const stub = startSupabaseStub((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/rest/v1/rpc/record_media_cleanup_contract_version')) {
        return new Response('4', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
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
      assertEquals(stub.seen.length, 3, 'contract and both queues are called once');
      assert(
        stub.seen[0].path.endsWith('/rest/v1/rpc/record_media_cleanup_contract_version'),
        'the contract probe must precede every claim',
      );
      const claims = stub.seen.slice(1);
      assertEquals(
        claims.map((entry) => entry.path).sort(),
        [
          '/rest/v1/rpc/claim_record_media_cleanup_job',
          '/rest/v1/rpc/claim_record_media_object_cleanup_job',
        ].sort(),
        'prefix and exact-object lanes must both claim without an ordering dependency',
      );
      assertEquals(stub.seen[0].apikey, VALID_ADMIN_KEY, 'opaque key must be sent as apikey');
      assertEquals(stub.seen[0].authorization, null, 'opaque admin key must not be sent as bearer');
      const prefixClaim = claims.find((entry) =>
        entry.path.endsWith('/rest/v1/rpc/claim_record_media_cleanup_job')
      );
      const objectClaim = claims.find((entry) =>
        entry.path.endsWith('/rest/v1/rpc/claim_record_media_object_cleanup_job')
      );
      if (!prefixClaim) throw new Error('assertion failed: prefix claim must exist');
      if (!objectClaim) throw new Error('assertion failed: object claim must exist');
      const body = JSON.parse(prefixClaim.body ?? '{}');
      assert(typeof body.p_lease_id === 'string', 'claim must send a generated lease UUID');
      assertEquals(body.p_lease_seconds, 120, 'claim must use the bounded lease duration');
      const objectBody = JSON.parse(objectClaim.body ?? '{}');
      assertEquals(objectBody.p_lease_id, body.p_lease_id, 'both queues use the same invocation lease');
      assertEquals(objectBody.p_lease_seconds, 120, 'object claim uses the bounded lease duration');
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});

Deno.test({
  name: 'record media cleanup entrypoint: exact-object jobs use the raw Storage delete contract',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const mediaObjectId = '10000000-0000-4000-8000-000000000001';
    const storageObjectId = '20000000-0000-4000-8000-000000000002';
    const recordId = '30000000-0000-4000-8000-000000000003';
    const coupleId = '40000000-0000-4000-8000-000000000004';
    const storagePath = `${coupleId}/${recordId}/memory.jpg`;
    const stub = startSupabaseStub((request) => {
      const path = new URL(request.url).pathname;
      const seen = stub.seen.at(-1);
      if (!seen) throw new Error('the current request must be captured');

      if (path.endsWith('/rest/v1/rpc/record_media_cleanup_contract_version')) {
        return new Response('4', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith('/rest/v1/rpc/claim_record_media_cleanup_job')) {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith('/rest/v1/rpc/claim_record_media_object_cleanup_job')) {
        const claim = JSON.parse(seen.body ?? '{}');
        return new Response(JSON.stringify([{
          media_object_id: mediaObjectId,
          storage_object_id: storageObjectId,
          record_id: recordId,
          couple_id: coupleId,
          lease_id: claim.p_lease_id,
        }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith('/rest/v1/rpc/resolve_record_media_object_cleanup_path')) {
        return new Response(JSON.stringify([{ storage_path: storagePath }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path === '/storage/v1/object/couple-media') {
        return new Response(null, { status: 200 });
      }
      if (path.endsWith('/rest/v1/rpc/settle_record_media_object_cleanup_job')) {
        return new Response('true', {
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
      assertEquals(response.status, 200, 'exact-object cleanup must succeed');
      assertEquals(
        await response.json(),
        { outcome: 'completed', deletedObjects: 1 },
        'exactly one resolved Storage object is deleted',
      );

      const deletion = stub.seen.find((entry) =>
        entry.path === '/storage/v1/object/couple-media'
      );
      if (!deletion) throw new Error('assertion failed: Storage delete request must exist');
      assertEquals(deletion.method, 'DELETE', 'Storage uses its raw DELETE endpoint');
      assertEquals(deletion.apikey, VALID_ADMIN_KEY, 'Storage receives the opaque admin key as apikey');
      assertEquals(deletion.authorization, null, 'the opaque admin key must not be sent as bearer');
      assertEquals(
        JSON.parse(deletion.body ?? '{}'),
        { prefixes: [storagePath] },
        'Storage receives only the exact server-resolved object path',
      );

      const settlement = stub.seen.find((entry) =>
        entry.path.endsWith('/rest/v1/rpc/settle_record_media_object_cleanup_job')
      );
      if (!settlement) throw new Error('assertion failed: object settlement request must exist');
      const settlementBody = JSON.parse(settlement.body ?? '{}');
      assertEquals(settlementBody.p_media_object_id, mediaObjectId, 'settlement pins the media row');
      assertEquals(settlementBody.p_storage_object_id, storageObjectId, 'settlement pins the Storage row');
      assert(
        typeof settlementBody.p_lease_id === 'string',
        'settlement preserves the generated invocation lease',
      );
    } finally {
      await entrypoint.stop();
      await stub.stop();
    }
  },
});
