import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import {
  createAdminClient,
  createAdminClientFetch,
  parseAdminSecretKey,
  parseSchedulerSecret,
  timingSafeEqualSecret,
} from '../_shared/adminSecret.ts';
import {
  RECORD_MEDIA_CLEANUP_LEASE_SECONDS,
  type RecordMediaCleanupJob,
  type RecordMediaObjectCleanupJob,
  runRecordMediaCleanup,
} from '../_shared/recordMediaCleanup.ts';
import { handleRecordMediaCleanupRequest } from './handler.ts';

const MEDIA_BUCKET = 'couple-media';
type CleanupRpcName =
  | 'record_media_cleanup_contract_version'
  | 'claim_record_media_cleanup_job'
  | 'complete_record_media_cleanup_job'
  | 'defer_record_media_cleanup_job'
  | 'fail_record_media_cleanup_job'
  | 'claim_record_media_object_cleanup_job'
  | 'resolve_record_media_object_cleanup_path'
  | 'settle_record_media_object_cleanup_job'
  | 'fail_record_media_object_cleanup_job';

async function removeStoragePaths(
  fetcher: typeof fetch,
  supabaseUrl: string,
  adminSecret: string,
  paths: string[],
  signal: AbortSignal,
): Promise<void> {
  const endpoint = new URL(
    `/storage/v1/object/${encodeURIComponent(MEDIA_BUCKET)}`,
    supabaseUrl,
  );
  const response = await fetcher(endpoint, {
    method: 'DELETE',
    headers: {
      apikey: adminSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: paths }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('E_STORAGE_DELETE_FAILED');
  }
  await response.arrayBuffer();
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'E_METHOD_NOT_ALLOWED' }, 405);
  }

  const schedulerSecret = parseSchedulerSecret(
    Deno.env.get('RECORD_MEDIA_CLEANUP_SCHEDULER_SECRET'),
  );
  if (!schedulerSecret) {
    return json({ error: 'E_RECORD_MEDIA_CLEANUP_NOT_CONFIGURED' }, 503);
  }
  const providedSecret = request.headers.get(
    'x-record-media-cleanup-scheduler-secret',
  );
  if (
    !providedSecret ||
    !(await timingSafeEqualSecret(providedSecret, schedulerSecret))
  ) {
    return json({ error: 'E_UNAUTHENTICATED' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const adminSecret = parseAdminSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  if (!supabaseUrl || !adminSecret) {
    return json({ error: 'E_RECORD_MEDIA_CLEANUP_NOT_CONFIGURED' }, 503);
  }

  const admin = createAdminClient(createClient, supabaseUrl, adminSecret);
  const cleanupFetch = createAdminClientFetch(supabaseUrl, adminSecret);
  // The checked-in generated Database type predates migration 083. Keep the
  // temporary untyped seam limited to the cleanup contract RPCs above.
  const callCleanupRpc = async (
    name: CleanupRpcName,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ data: unknown; error: unknown }> => {
    const result = await admin.rpc(name as never, args as never).abortSignal(signal);
    return { data: result.data, error: result.error };
  };
  return handleRecordMediaCleanupRequest(request, {
    schedulerSecret,
    runCleanup: (invocationSignal) => runRecordMediaCleanup({
      createLeaseId: () => crypto.randomUUID(),
      contractVersion: async (signal) => {
        const { data, error } = await callCleanupRpc(
          'record_media_cleanup_contract_version',
          {},
          signal,
        );
        if (error || data !== 3) throw new Error('E_CLEANUP_CONTRACT_UNAVAILABLE');
        return data;
      },
      claim: async (leaseId, leaseSeconds, signal) => {
        const { data, error } = await callCleanupRpc('claim_record_media_cleanup_job', {
          p_lease_id: leaseId,
          p_lease_seconds: leaseSeconds,
        }, signal);
        if (error || !Array.isArray(data) || data.length > 1) {
          throw new Error('E_CLEANUP_CLAIM_FAILED');
        }
        if (data.length === 0) return null;
        const row = data[0] as Record<string, unknown>;
        return {
          recordId: String(row.record_id),
          coupleId: String(row.couple_id),
          leaseId: String(row.lease_id),
        } satisfies RecordMediaCleanupJob;
      },
      list: async (prefix, { limit, offset }, signal) => {
        const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(prefix, {
          limit,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        }, { signal });
        if (error || !Array.isArray(data)) {
          throw new Error('E_STORAGE_LIST_FAILED');
        }
        return data;
      },
      remove: async (paths, signal) => {
        await removeStoragePaths(cleanupFetch, supabaseUrl, adminSecret, paths, signal);
      },
      complete: async (recordId, leaseId, signal) => {
        const { data, error } = await callCleanupRpc('complete_record_media_cleanup_job', {
          p_record_id: recordId,
          p_lease_id: leaseId,
        }, signal);
        if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
        return data === true;
      },
      defer: async (recordId, leaseId, signal) => {
        const { data, error } = await callCleanupRpc('defer_record_media_cleanup_job', {
          p_record_id: recordId,
          p_lease_id: leaseId,
        }, signal);
        if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
        return data === true;
      },
      fail: async (recordId, leaseId, errorCode, signal) => {
        const { data, error } = await callCleanupRpc('fail_record_media_cleanup_job', {
          p_record_id: recordId,
          p_lease_id: leaseId,
          p_error_code: errorCode,
        }, signal);
        if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
        return data === 'pending' || data === 'blocked' ? data : null;
      },
      object: {
        claim: async (leaseId, leaseSeconds, signal) => {
          const { data, error } = await callCleanupRpc(
            'claim_record_media_object_cleanup_job',
            { p_lease_id: leaseId, p_lease_seconds: leaseSeconds },
            signal,
          );
          if (error || !Array.isArray(data) || data.length > 1) {
            throw new Error('E_CLEANUP_CLAIM_FAILED');
          }
          if (data.length === 0) return null;
          const row = data[0] as Record<string, unknown>;
          return {
            mediaObjectId: String(row.media_object_id),
            storageObjectId: String(row.storage_object_id),
            recordId: String(row.record_id),
            coupleId: String(row.couple_id),
            leaseId: String(row.lease_id),
          } satisfies RecordMediaObjectCleanupJob;
        },
        resolvePath: async (job, signal) => {
          const { data, error } = await callCleanupRpc(
            'resolve_record_media_object_cleanup_path',
            {
              p_media_object_id: job.mediaObjectId,
              p_storage_object_id: job.storageObjectId,
              p_lease_id: job.leaseId,
            },
            signal,
          );
          if (error || !Array.isArray(data) || data.length > 1) {
            throw new Error('E_STORAGE_OBJECT_RESOLVE_FAILED');
          }
          if (data.length === 0) return null;
          const path = (data[0] as Record<string, unknown>).storage_path;
          if (typeof path !== 'string') throw new Error('E_STORAGE_OBJECT_RESOLVE_FAILED');
          return path;
        },
        settle: async (job, signal) => {
          const { data, error } = await callCleanupRpc(
            'settle_record_media_object_cleanup_job',
            {
              p_media_object_id: job.mediaObjectId,
              p_storage_object_id: job.storageObjectId,
              p_lease_id: job.leaseId,
            },
            signal,
          );
          if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
          return data === true;
        },
        fail: async (job, errorCode, signal) => {
          const { data, error } = await callCleanupRpc(
            'fail_record_media_object_cleanup_job',
            {
              p_media_object_id: job.mediaObjectId,
              p_storage_object_id: job.storageObjectId,
              p_lease_id: job.leaseId,
              p_error_code: errorCode,
            },
            signal,
          );
          if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
          return data === 'pending' || data === 'blocked' ? data : null;
        },
      },
    }, { signal: invocationSignal }),
  });
});

export { RECORD_MEDIA_CLEANUP_LEASE_SECONDS };
