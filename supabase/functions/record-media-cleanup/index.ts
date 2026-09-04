import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import {
  createAdminClient,
  parseAdminSecretKey,
  parseSchedulerSecret,
  timingSafeEqualSecret,
} from '../_shared/adminSecret.ts';
import {
  RECORD_MEDIA_CLEANUP_LEASE_SECONDS,
  type RecordMediaCleanupJob,
  runRecordMediaCleanup,
} from '../_shared/recordMediaCleanup.ts';
import { handleRecordMediaCleanupRequest } from './handler.ts';

const MEDIA_BUCKET = 'couple-media';
type CleanupRpcName =
  | 'claim_record_media_cleanup_job'
  | 'complete_record_media_cleanup_job'
  | 'defer_record_media_cleanup_job'
  | 'fail_record_media_cleanup_job';

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
  // The checked-in generated Database type predates migration 083. Keep the
  // temporary untyped seam limited to these four exact service RPC names.
  const callCleanupRpc = async (
    name: CleanupRpcName,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }> => {
    const result = await admin.rpc(name as never, args as never);
    return { data: result.data, error: result.error };
  };
  return handleRecordMediaCleanupRequest(request, {
    schedulerSecret,
    runCleanup: () => runRecordMediaCleanup({
      createLeaseId: () => crypto.randomUUID(),
      claim: async (leaseId, leaseSeconds) => {
        const { data, error } = await callCleanupRpc('claim_record_media_cleanup_job', {
          p_lease_id: leaseId,
          p_lease_seconds: leaseSeconds,
        });
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
      list: async (prefix, { limit, offset }) => {
        const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(prefix, {
          limit,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });
        if (error || !Array.isArray(data)) {
          throw new Error('E_STORAGE_LIST_FAILED');
        }
        return data;
      },
      remove: async (paths) => {
        const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths);
        if (error) throw new Error('E_STORAGE_DELETE_FAILED');
      },
      complete: async (recordId, leaseId) => {
        const { data, error } = await callCleanupRpc('complete_record_media_cleanup_job', {
          p_record_id: recordId,
          p_lease_id: leaseId,
        });
        if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
        return data === true;
      },
      defer: async (recordId, leaseId) => {
        const { data, error } = await callCleanupRpc('defer_record_media_cleanup_job', {
          p_record_id: recordId,
          p_lease_id: leaseId,
        });
        if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
        return data === true;
      },
      fail: async (recordId, leaseId, errorCode) => {
        const { data, error } = await callCleanupRpc('fail_record_media_cleanup_job', {
          p_record_id: recordId,
          p_lease_id: leaseId,
          p_error_code: errorCode,
        });
        if (error) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
        return data === 'pending' || data === 'blocked' ? data : null;
      },
    }),
  });
});

export { RECORD_MEDIA_CLEANUP_LEASE_SECONDS };
