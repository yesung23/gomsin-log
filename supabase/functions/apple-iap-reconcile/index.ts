import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import {
  createAdminClientFetch,
  parseAdminSecretKey,
  parseSchedulerSecret,
  timingSafeEqualSecret,
} from '../_shared/adminSecret.ts';
import { sha256Hex } from '../_shared/appleIapContract.ts';
import { createAppleIapHistory } from '../_shared/appleIapHistory.ts';
import { createAppleIapVerifier } from '../_shared/appleIapVerifier.ts';
import {
  type AppleIapReconcileTarget,
  handleAppleIapReconcile,
  MAX_RECONCILIATION_TARGETS,
} from './handler.ts';

Deno.serve(async (request) => {
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
    global: { fetch: createAdminClientFetch(url, secret) },
  });

  return handleAppleIapReconcile(request, {
    schedulerSecret,
    listTargets: async () => {
      const { data, error } = await admin.rpc('iap_claim_reconciliation_targets', {
        p_limit: MAX_RECONCILIATION_TARGETS,
      });
      if (error || !Array.isArray(data)) throw new Error('E_DB_READ_FAILED');
      return data.map((row) => ({
        checkpointId: String(row.checkpoint_id),
        leaseToken: String(row.lease_token),
        userId: String(row.user_id),
        environment: row.environment,
        anchorTransactionId: String(row.anchor_transaction_id),
        revision: row.next_revision === null ? null : String(row.next_revision),
        appAccountTokenHash: String(row.app_account_token_hash),
      })) as AppleIapReconcileTarget[];
    },
    transactionHistory,
    verifyTransaction: verifier.verifyTransaction,
    ingestTransaction: async ({ userId, environment, transaction, jwsSha256 }) => {
      if (transaction.environment !== environment || !transaction.appAccountToken) {
        throw new Error('E_IAP_RECONCILE_ACCOUNT_MISMATCH');
      }
      const { error } = await admin.rpc('iap_apply_verified_transaction_v2', {
        p_user_id: userId,
        p_environment: transaction.environment,
        p_transaction_id: transaction.transactionId,
        p_original_transaction_id: transaction.originalTransactionId,
        p_product_id: transaction.productId,
        p_product_type: transaction.type,
        p_bundle_id: transaction.bundleId,
        p_app_account_token_hash: await sha256Hex(transaction.appAccountToken.toLowerCase()),
        p_purchase_date_ms: transaction.purchaseDate,
        p_signed_date_ms: transaction.signedDate,
        p_expires_date_ms: transaction.expiresDate ?? null,
        p_revocation_date_ms: transaction.revocationDate ?? null,
        p_event_kind: transaction.revocationDate
          ? transaction.revocationType === 'FAMILY_REVOKE' ? 'revoke' : 'refund'
          : 'purchase',
        p_payload_hash: jwsSha256,
        p_quantity: transaction.quantity ?? 1,
        p_revocation_type: transaction.revocationType ?? null,
        p_revocation_percentage: transaction.revocationPercentage ?? null,
      });
      if (error) throw new Error('E_IAP_INGEST_FAILED');
    },
    recordReview: async ({
      checkpointId,
      leaseToken,
      environment,
      transaction,
      jwsSha256,
      reasonCode,
    }) => {
      if (transaction.environment !== environment) {
        throw new Error('E_IAP_RECONCILE_ENVIRONMENT_MISMATCH');
      }
      const { error } = await admin.rpc('iap_record_reconciliation_review', {
        p_checkpoint_id: checkpointId,
        p_lease_token: leaseToken,
        p_environment: environment,
        p_transaction_id: transaction.transactionId,
        p_original_transaction_id: transaction.originalTransactionId,
        p_product_id: transaction.productId,
        p_product_type: transaction.type,
        p_bundle_id: transaction.bundleId,
        p_event_kind: transaction.revocationDate
          ? transaction.revocationType === 'FAMILY_REVOKE' ? 'revoke' : 'refund'
          : 'purchase',
        p_transaction_signed_date_ms: transaction.signedDate,
        p_transaction_payload_hash: jwsSha256,
        p_reason_code: reasonCode,
      });
      if (error) throw new Error('E_IAP_RECONCILE_REVIEW_FAILED');
    },
    completeTarget: async ({
      checkpointId,
      leaseToken,
      succeeded,
      errorCode,
      nextRevision,
      hasMore,
    }) => {
      const { error } = await admin.rpc('iap_complete_reconciliation_target', {
        p_checkpoint_id: checkpointId,
        p_lease_token: leaseToken,
        p_succeeded: succeeded,
        p_error_code: errorCode,
        p_next_revision: nextRevision,
        p_has_more: hasMore,
      });
      if (error) throw new Error('E_IAP_RECONCILE_COMPLETE_FAILED');
    },
  });
});
