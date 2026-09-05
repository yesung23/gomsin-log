import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import { createAdminClientFetch, parseAdminSecretKey } from '../_shared/adminSecret.ts';
import { parseAllowedOrigins, resolveCors } from '../delete-account/_shared/cors.ts';
import { hashAppAccountToken, type VerifiedAppleTransaction } from '../_shared/appleIapContract.ts';
import { createAppleIapVerifier } from '../_shared/appleIapVerifier.ts';
import { handleAppleIapSync } from './handler.ts';

type StateRow = {
  entitlement_key: string | null;
  active: boolean;
  export_credits: number | string;
};

function withCors(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, { status: response.status, headers: merged });
}

function createUserClient(url: string, secret: string, bearer: string): SupabaseClient {
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${bearer}` },
      fetch: createAdminClientFetch(url, secret),
    },
  });
}

function parseState(data: unknown) {
  const rows = Array.isArray(data) ? data as StateRow[] : [];
  return {
    entitlements: rows
      .filter((row) => typeof row.entitlement_key === 'string')
      .map((row) => ({ key: row.entitlement_key as string, active: row.active === true })),
    exportCredits: Number(rows[0]?.export_credits ?? 0),
  };
}

Deno.serve(async (request) => {
  const cors = resolveCors(
    request.method,
    request.headers.get('Origin'),
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  );
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
  }
  if (!cors.configured || !cors.allowed) {
    return new Response(JSON.stringify({ error: 'E_ORIGIN_NOT_ALLOWED' }), {
      status: 403,
      headers: { ...cors.headers, 'Content-Type': 'application/json' },
    });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const secret = parseAdminSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  let verifier: ReturnType<typeof createAppleIapVerifier>;
  if (!url || !secret) {
    return withCors(
      new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
      cors.headers,
    );
  }
  try {
    verifier = createAppleIapVerifier();
  } catch {
    return withCors(
      new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
      cors.headers,
    );
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createAdminClientFetch(url, secret) },
  });
  const authorization = request.headers.get('Authorization') ?? '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const userClient = createUserClient(url, secret, bearer);

  const loadState = async (environment: 'Xcode' | 'Sandbox' | 'Production') => {
    const { data, error } = await userClient.rpc('iap_get_state', { p_environment: environment });
    if (error) throw new Error('E_DB_READ_FAILED');
    return parseState(data);
  };

  const response = await handleAppleIapSync(request, {
    authenticate: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      if (error || data.user?.app_metadata?.account_deletion_pending === true) return null;
      return data.user?.id ?? null;
    },
    preparePurchase: async (_userId, productId, environment) => {
      const { data, error } = await userClient.rpc('iap_prepare_purchase', {
        p_product_id: productId,
        p_environment: environment,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row || typeof row.account_token !== 'string' || row.sale_enabled !== true) {
        throw new Error('E_IAP_SALE_CLOSED');
      }
      return { appAccountToken: row.account_token };
    },
    verifyTransaction: verifier.verifyTransaction,
    ingestTransaction: async ({ userId, transaction, jwsSha256 }) => {
      const tx = transaction as VerifiedAppleTransaction;
      const tokenHash = await hashAppAccountToken(tx.appAccountToken as string);
      const { data, error } = await admin.rpc('iap_apply_verified_transaction_v2', {
        p_user_id: userId,
        p_environment: tx.environment,
        p_transaction_id: tx.transactionId,
        p_original_transaction_id: tx.originalTransactionId,
        p_product_id: tx.productId,
        p_product_type: tx.type,
        p_bundle_id: tx.bundleId,
        p_app_account_token_hash: tokenHash,
        p_purchase_date_ms: tx.purchaseDate,
        p_signed_date_ms: tx.signedDate,
        p_expires_date_ms: tx.expiresDate ?? null,
        p_revocation_date_ms: tx.revocationDate ?? null,
        p_event_kind: tx.revocationDate
          ? tx.revocationType === 'FAMILY_REVOKE' ? 'revoke' : 'refund'
          : 'purchase',
        p_payload_hash: jwsSha256,
        p_quantity: tx.quantity ?? 1,
        p_revocation_type: tx.revocationType ?? null,
        p_revocation_percentage: tx.revocationPercentage ?? null,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row || row.accepted !== true) throw new Error('E_IAP_INGEST_REJECTED');
      const state = await loadState(tx.environment);
      return {
        accepted: true,
        duplicate: row.duplicate === true,
        transactionId: String(row.transaction_id),
        ...state,
      };
    },
    loadEntitlements: (_userId, environment) => loadState(environment),
    loadRefundDataConsent: async ({ noticeVersion, noticeSha256 }) => {
      const { data, error } = await userClient.rpc('iap_get_refund_data_consent_state', {
        p_notice_version: noticeVersion,
        p_notice_sha256: noticeSha256,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (
        error || !row || typeof row.notice_matches !== 'boolean' ||
        (row.decision !== null &&
          row.decision !== 'granted' &&
          row.decision !== 'withdrawn')
      ) {
        throw new Error('E_IAP_CONSENT_STATE_FAILED');
      }
      return {
        noticeMatches: row.notice_matches,
        decision: row.decision,
      };
    },
    setRefundDataConsent: async ({
      decision,
      noticeVersion,
      noticeSha256,
      idempotencyKey,
    }) => {
      const { data, error } = await userClient.rpc('iap_set_refund_data_consent', {
        p_decision: decision,
        p_notice_version: noticeVersion,
        p_notice_sha256: noticeSha256,
        p_idempotency_key: idempotencyKey,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (
        error || !row ||
        (row.decision !== 'granted' && row.decision !== 'withdrawn') ||
        typeof row.notice_version !== 'string' ||
        typeof row.notice_sha256 !== 'string' ||
        typeof row.duplicate !== 'boolean'
      ) {
        throw new Error('E_IAP_CONSENT_UPDATE_FAILED');
      }
      return {
        decision: row.decision,
        noticeVersion: row.notice_version,
        noticeSha256: row.notice_sha256,
        duplicate: row.duplicate,
      };
    },
  });
  return withCors(response, cors.headers);
});
