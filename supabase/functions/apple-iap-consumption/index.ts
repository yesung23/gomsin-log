import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import {
  createAdminClientFetch,
  parseAdminSecretKey,
  parseSchedulerSecret,
  timingSafeEqualSecret,
} from '../_shared/adminSecret.ts';
import { createAppleIapConsumptionSender } from '../_shared/appleIapServerApi.ts';
import { type AppleIapConsumptionJob, handleAppleIapConsumption } from './handler.ts';

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
    !schedulerSecret || !providedSecret ||
    !(await timingSafeEqualSecret(providedSecret, schedulerSecret))
  ) {
    return new Response(JSON.stringify({ error: 'E_UNAUTHENTICATED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const secret = parseAdminSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  if (!url || !secret) {
    return new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let sendConsumptionInformation: ReturnType<typeof createAppleIapConsumptionSender>;
  try {
    sendConsumptionInformation = createAppleIapConsumptionSender();
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

  return handleAppleIapConsumption(request, {
    schedulerSecret,
    now: Date.now,
    claimNext: async () => {
      const { data, error } = await admin.rpc('iap_claim_consumption_request');
      const row = Array.isArray(data) ? data[0] : null;
      if (error) throw new Error('E_IAP_CONSUMPTION_CLAIM_FAILED');
      if (!row) return null;
      return {
        requestId: String(row.request_id),
        leaseToken: String(row.lease_token),
        attemptNo: Number(row.attempt_no),
        receivedAtMs: Number(row.received_at_ms),
        deadlineAtMs: Number(row.deadline_at_ms),
        leaseExpiresAtMs: Number(row.lease_expires_at_ms),
      } as AppleIapConsumptionJob;
    },
    authorizeSend: async (authorization) => {
      const { data, error } = await admin.rpc('iap_authorize_consumption_send', {
        p_request_id: authorization.requestId,
        p_lease_token: authorization.leaseToken,
      });
      if (error) throw new Error('E_IAP_CONSUMPTION_AUTHORIZE_FAILED');
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;
      return {
        sendAuthorizationToken: String(row.send_authorization_token),
        sendAuthorizationExpiresAtMs: Number(row.send_authorization_expires_at_ms),
        attemptNo: Number(row.attempt_no),
        environment: row.environment,
        transactionId: String(row.transaction_id),
        productType: row.product_type,
        deliveryStatus: row.delivery_status,
        sampleContentProvided: row.sample_content_provided === true,
        consumptionPercentage: row.consumption_percentage == null
          ? null
          : Number(row.consumption_percentage),
        requestBodyHash: String(row.request_body_hash),
      };
    },
    sendConsumptionInformation,
    complete: async (completion) => {
      const { error } = await admin.rpc('iap_complete_consumption_request', {
        p_request_id: completion.requestId,
        p_lease_token: completion.leaseToken,
        p_send_authorization_token: completion.sendAuthorizationToken,
        p_attempt_no: completion.attemptNo,
        p_request_body_hash: completion.requestBodyHash,
        p_outcome: completion.outcome,
        p_error_code: completion.errorCode,
        p_retry_after_seconds: completion.retryAfterSeconds,
      });
      if (error) throw new Error('E_IAP_CONSUMPTION_COMPLETE_FAILED');
    },
    listOperationalAlerts: async () => {
      const { data, error } = await admin.rpc('iap_list_operational_alerts');
      if (error || !Array.isArray(data)) {
        throw new Error('E_IAP_OPERATIONS_READ_FAILED');
      }
      return data.map((row) => ({
        alertId: String(row.alert_id),
        source: row.source,
        environment: row.environment,
        status: row.status,
        deadlineBucket: row.deadline_bucket,
        attemptNo: Number(row.attempt_no),
        errorCode: String(row.error_code),
      }));
    },
    acknowledgeManualReview: async ({ reviewId, resolutionCode }) => {
      const { data, error } = await admin.rpc('iap_acknowledge_transaction_review', {
        p_review_id: reviewId,
        p_resolution_code: resolutionCode,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) throw new Error('E_IAP_REVIEW_UPDATE_FAILED');
      return {
        reviewId: String(row.review_id),
        status: row.status,
        resolutionCode: row.resolution_code,
        duplicate: row.duplicate,
      };
    },
  });
});
