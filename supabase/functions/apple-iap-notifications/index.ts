import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import { createAdminClientFetch, parseAdminSecretKey } from '../_shared/adminSecret.ts';
import { sha256Hex } from '../_shared/appleIapContract.ts';
import { createAppleIapVerifier } from '../_shared/appleIapVerifier.ts';
import { handleAppleIapNotification } from './handler.ts';

function eventKind(type: string): 'purchase' | 'refund' | 'revoke' | 'refund_reversed' {
  if (type === 'REFUND') return 'refund';
  if (type === 'REFUND_REVERSED') return 'refund_reversed';
  if (type === 'REVOKE') return 'revoke';
  return 'purchase';
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'E_METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const secret = parseAdminSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  let verifier: ReturnType<typeof createAppleIapVerifier>;
  if (!url || !secret) {
    return new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    verifier = createAppleIapVerifier();
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

  return handleAppleIapNotification(request, {
    verifyNotification: verifier.verifyNotification,
    verifyTransaction: verifier.verifyTransaction,
    persistVerifiedNotification: async ({
      notification,
      transaction,
      notificationJwsSha256,
      transactionJwsSha256,
    }) => {
      // A transaction without appAccountToken cannot be assigned to a GomsinLog
      // account. Persist the notification as a no-grant fact instead of guessing.
      const assignable = transaction?.appAccountToken && transactionJwsSha256
        ? transaction
        : null;
      const { data, error } = await admin.rpc('iap_process_verified_notification', {
        p_notification_uuid: notification.notificationUUID,
        p_environment: notification.environment,
        p_notification_type: notification.notificationType,
        p_subtype: notification.subtype ?? null,
        p_notification_transaction_id: transaction?.transactionId ?? null,
        p_notification_original_transaction_id: transaction?.originalTransactionId ?? null,
        p_notification_signed_date_ms: notification.signedDate,
        p_notification_payload_hash: notificationJwsSha256,
        p_transaction_id: assignable?.transactionId ?? null,
        p_transaction_original_transaction_id: assignable?.originalTransactionId ?? null,
        p_product_id: assignable?.productId ?? null,
        p_bundle_id: assignable?.bundleId ?? null,
        p_app_account_token_hash: assignable
          ? await sha256Hex(assignable.appAccountToken as string)
          : null,
        p_purchase_date_ms: assignable?.purchaseDate ?? null,
        p_transaction_signed_date_ms: assignable?.signedDate ?? null,
        p_expires_date_ms: assignable?.expiresDate ?? null,
        p_revocation_date_ms: assignable?.revocationDate ?? null,
        p_event_kind: assignable ? eventKind(notification.notificationType) : null,
        p_transaction_payload_hash: assignable ? transactionJwsSha256 : null,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) throw new Error('E_IAP_PERSIST_FAILED');
      return { duplicate: row.duplicate === true, stale: row.stale === true };
    },
  });
});
