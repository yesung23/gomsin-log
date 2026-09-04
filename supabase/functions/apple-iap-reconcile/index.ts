import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import {
  createAdminClientFetch,
  parseAdminSecretKey,
  parseSchedulerSecret,
  timingSafeEqualSecret,
} from '../_shared/adminSecret.ts';
import { createAppleIapHistory } from '../_shared/appleIapHistory.ts';
import { createAppleIapVerifier } from '../_shared/appleIapVerifier.ts';
import {
  type AppleIapReconcileTarget,
  handleAppleIapReconcile,
  MAX_RECONCILIATION_TARGETS,
} from './handler.ts';

const SUPABASE_ADMIN_REQUEST_TIMEOUT_MS = 10_000;

Deno.serve(async (request) => {
  const invocationStartedAtMs = performance.now();
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'E_METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const schedulerSecret = parseSchedulerSecret(Deno.env.get('APPLE_IAP_SCHEDULER_SECRET'));
  const providedSecret = request.headers.get('x-iap-scheduler-secret');
  if (
    schedulerSecret && (!providedSecret ||
      !(await timingSafeEqualSecret(providedSecret, schedulerSecret)))
  ) {
    return new Response(JSON.stringify({ error: 'E_UNAUTHENTICATED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const secret = parseAdminSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  let verifier: ReturnType<typeof createAppleIapVerifier>;
  let transactionHistory: ReturnType<typeof createAppleIapHistory>;
  if (!schedulerSecret || !url || !secret) {
    return new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    verifier = createAppleIapVerifier();
    transactionHistory = createAppleIapHistory();
  } catch {
    return new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createAdminClientFetch(url, secret, SUPABASE_ADMIN_REQUEST_TIMEOUT_MS) },
  });

  return handleAppleIapReconcile(request, {
    schedulerSecret,
    invocationStartedAtMs,
    monotonicNow: () => performance.now(),
    listTargets: async () => {
      const { data, error } = await admin.rpc('iap_claim_reconciliation_targets', {
        p_limit: MAX_RECONCILIATION_TARGETS,
      });
      if (error || !Array.isArray(data)) throw new Error('E_DB_READ_FAILED');
      return data.map((row) => ({
        checkpointId: String(row.checkpoint_id),
        leaseToken: String(row.lease_token),
        environment: row.environment,
        anchorTransactionId: String(row.anchor_transaction_id),
        revision: row.next_revision === null ? null : String(row.next_revision),
      })) as AppleIapReconcileTarget[];
    },
    transactionHistory,
    verifyTransaction: verifier.verifyTransaction,
    settlePage: async ({
      checkpointId,
      leaseToken,
      environment,
      expectedRevision,
      nextRevision,
      hasMore,
      transactions,
    }) => {
      const { data, error } = await admin.rpc('iap_settle_reconciliation_page', {
        p_checkpoint_id: checkpointId,
        p_lease_token: leaseToken,
        p_environment: environment,
        p_expected_revision: expectedRevision,
        p_next_revision: nextRevision,
        p_has_more: hasMore,
        p_transactions: transactions,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) throw new Error('E_IAP_RECONCILE_SETTLE_FAILED');
      return {
        applied: Number(row.applied_count),
        reviewed: Number(row.reviewed_count),
      };
    },
    failTarget: async ({
      checkpointId,
      leaseToken,
      errorCode,
    }) => {
      const { error } = await admin.rpc('iap_fail_reconciliation_target', {
        p_checkpoint_id: checkpointId,
        p_lease_token: leaseToken,
        p_error_code: errorCode,
      });
      if (error) throw new Error('E_IAP_RECONCILE_COMPLETE_FAILED');
    },
  });
});
