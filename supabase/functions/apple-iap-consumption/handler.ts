import { timingSafeEqualSecret } from '../_shared/adminSecret.ts';
import { json, readBoundedJson } from '../_shared/appleIapContract.ts';

export type AppleIapOperationalAlert = {
  alertId: string;
  source: 'consumption' | 'transaction_review';
  environment: 'Sandbox' | 'Production' | 'Xcode';
  status: 'manual_review' | 'send_result_unknown' | 'terminal_failed' | 'expired';
  deadlineBucket: 'overdue' | 'lt_1h' | 'lt_6h' | 'gte_6h' | 'not_applicable';
  attemptNo: number;
  errorCode: string;
};

export type AppleIapReviewAcknowledgement = {
  reviewId: string;
  status: 'acknowledged';
  resolutionCode: 'NO_AUTOMATIC_ACTION' | 'APPLE_RECONCILIATION_REQUIRED';
  duplicate: boolean;
};

export type AppleIapConsumptionJob = {
  requestId: string;
  leaseToken: string;
  attemptNo: number;
  receivedAtMs: number;
  deadlineAtMs: number;
  leaseExpiresAtMs: number;
};

export type AppleIapSendAuthorization = {
  sendAuthorizationToken: string;
  sendAuthorizationExpiresAtMs: number;
  attemptNo: number;
  environment: 'Sandbox' | 'Production';
  transactionId: string;
  productType: 'consumable' | 'non_consumable' | 'subscription';
  deliveryStatus:
    | 'DELIVERED'
    | 'UNDELIVERED_QUALITY_ISSUE'
    | 'UNDELIVERED_WRONG_ITEM'
    | 'UNDELIVERED_SERVER_OUTAGE'
    | 'UNDELIVERED_OTHER';
  sampleContentProvided: boolean;
  consumptionPercentage: number | null;
  requestBodyHash: string;
};

export type AppleIapConsumptionSend = {
  environment: 'Sandbox' | 'Production';
  transactionId: string;
  timeoutMs: number;
  request: {
    customerConsented: true;
    deliveryStatus: AppleIapSendAuthorization['deliveryStatus'];
    sampleContentProvided: boolean;
    consumptionPercentage?: number;
  };
};

export type AppleIapConsumptionCompletion = {
  requestId: string;
  leaseToken: string;
  sendAuthorizationToken: string | null;
  attemptNo: number;
  requestBodyHash: string | null;
  outcome:
    | 'accepted'
    | 'retryable_failed'
    | 'terminal_failed'
    | 'send_result_unknown'
    | 'expired';
  errorCode: string | null;
  retryAfterSeconds: number | null;
};

export type AppleIapConsumptionDeps = {
  schedulerSecret: string | null;
  now: () => number;
  claimNext: () => Promise<AppleIapConsumptionJob | null>;
  authorizeSend: (input: {
    requestId: string;
    leaseToken: string;
  }) => Promise<AppleIapSendAuthorization | null>;
  sendConsumptionInformation: (input: AppleIapConsumptionSend) => Promise<void>;
  complete: (input: AppleIapConsumptionCompletion) => Promise<void>;
  listOperationalAlerts: () => Promise<AppleIapOperationalAlert[]>;
  acknowledgeManualReview: (input: {
    reviewId: string;
    resolutionCode: AppleIapReviewAcknowledgement['resolutionCode'];
  }) => Promise<AppleIapReviewAcknowledgement>;
};

function isOperationalAlert(value: unknown): value is AppleIapOperationalAlert {
  if (!value || typeof value !== 'object') return false;
  const alert = value as Record<string, unknown>;
  return typeof alert.alertId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(alert.alertId) &&
    (alert.source === 'consumption' || alert.source === 'transaction_review') &&
    (alert.environment === 'Sandbox' ||
      alert.environment === 'Production' ||
      alert.environment === 'Xcode') &&
    (alert.status === 'manual_review' ||
      alert.status === 'send_result_unknown' ||
      alert.status === 'terminal_failed' ||
      alert.status === 'expired') &&
    (alert.deadlineBucket === 'overdue' ||
      alert.deadlineBucket === 'lt_1h' ||
      alert.deadlineBucket === 'lt_6h' ||
      alert.deadlineBucket === 'gte_6h' ||
      alert.deadlineBucket === 'not_applicable') &&
    Number.isInteger(alert.attemptNo) &&
    Number(alert.attemptNo) >= 0 &&
    Number(alert.attemptNo) <= 1_000 &&
    typeof alert.errorCode === 'string' &&
    /^[A-Z0-9_]{1,64}$/.test(alert.errorCode);
}

function errorDisposition(error: unknown): {
  outcome: 'retryable_failed' | 'terminal_failed' | 'send_result_unknown';
  errorCode: string;
  retryAfterSeconds: number | null;
} {
  const status = error && typeof error === 'object'
    ? Number((error as { httpStatusCode?: unknown }).httpStatusCode)
    : NaN;
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    const rawRetryAfter = Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds);
    const retryAfterSeconds = Number.isInteger(rawRetryAfter) &&
        rawRetryAfter >= 1 && rawRetryAfter <= 43_200
      ? rawRetryAfter
      : null;
    return {
      outcome: status === 401 || status === 429 || status >= 500
        ? 'retryable_failed'
        : 'terminal_failed',
      errorCode: `APPLE_HTTP_${status}`,
      retryAfterSeconds: status === 429 ? retryAfterSeconds : null,
    };
  }
  return {
    outcome: 'send_result_unknown',
    errorCode: 'APPLE_NETWORK',
    retryAfterSeconds: null,
  };
}

function buildRequest(
  job: AppleIapConsumptionJob,
  authorization: AppleIapSendAuthorization,
): AppleIapConsumptionSend['request'] {
  const responseWindowMs = authorization.environment === 'Sandbox'
    ? 5 * 60 * 1000
    : 12 * 60 * 60 * 1000;
  if (
    !Number.isSafeInteger(job.receivedAtMs) ||
    !Number.isSafeInteger(job.attemptNo) ||
    job.attemptNo <= 0 ||
    !Number.isSafeInteger(job.deadlineAtMs) ||
    !Number.isSafeInteger(job.leaseExpiresAtMs) ||
    job.deadlineAtMs !== job.receivedAtMs + responseWindowMs ||
    job.leaseExpiresAtMs <= job.receivedAtMs ||
    job.leaseExpiresAtMs > job.deadlineAtMs ||
    !/^[1-9][0-9]{0,19}$/.test(authorization.transactionId) ||
    authorization.attemptNo !== job.attemptNo ||
    !/^[0-9a-f]{64}$/.test(authorization.requestBodyHash) ||
    (authorization.productType === 'subscription' &&
      authorization.consumptionPercentage != null) ||
    (authorization.consumptionPercentage != null &&
      (!Number.isInteger(authorization.consumptionPercentage) ||
        authorization.consumptionPercentage < 0 ||
        authorization.consumptionPercentage > 100_000)) ||
    (authorization.deliveryStatus !== 'DELIVERED' &&
      authorization.consumptionPercentage !== 0)
  ) {
    throw new Error('E_IAP_CONSUMPTION_JOB_INVALID');
  }
  return {
    customerConsented: true,
    deliveryStatus: authorization.deliveryStatus,
    sampleContentProvided: authorization.sampleContentProvided,
    ...(authorization.consumptionPercentage == null
      ? {}
      : { consumptionPercentage: authorization.consumptionPercentage }),
  };
}

export async function handleAppleIapConsumption(
  request: Request,
  deps: AppleIapConsumptionDeps,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'E_METHOD_NOT_ALLOWED' }, 405);
  const provided = request.headers.get('x-iap-scheduler-secret');
  if (
    !deps.schedulerSecret || !provided ||
    !(await timingSafeEqualSecret(provided, deps.schedulerSecret))
  ) {
    return json({ error: 'E_UNAUTHENTICATED' }, 401);
  }

  if (request.body) {
    const operation = await readBoundedJson(request, 2_000);
    if (!operation || typeof operation !== 'object') {
      return json({ error: 'E_BAD_REQUEST' }, 400);
    }
    const operationRecord = operation as Record<string, unknown>;
    if (operationRecord.action === 'alerts') {
      try {
        const alerts = await deps.listOperationalAlerts();
        if (
          !Array.isArray(alerts) ||
          alerts.length > 100 ||
          !alerts.every(isOperationalAlert)
        ) {
          throw new Error('E_IAP_ALERT_SHAPE_INVALID');
        }
        return json({
          alerts: alerts.map((alert) => ({
            alertId: alert.alertId,
            source: alert.source,
            environment: alert.environment,
            status: alert.status,
            deadlineBucket: alert.deadlineBucket,
            attemptNo: alert.attemptNo,
            errorCode: alert.errorCode,
          })),
        }, 200);
      } catch {
        return json({ error: 'E_IAP_OPERATIONS_UNAVAILABLE' }, 503);
      }
    }
    if (operationRecord.action === 'acknowledge-review') {
      if (
        typeof operationRecord.reviewId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(operationRecord.reviewId) ||
        (operationRecord.resolutionCode !== 'NO_AUTOMATIC_ACTION' &&
          operationRecord.resolutionCode !== 'APPLE_RECONCILIATION_REQUIRED')
      ) {
        return json({ error: 'E_BAD_REQUEST' }, 400);
      }
      try {
        const result = await deps.acknowledgeManualReview({
          reviewId: operationRecord.reviewId,
          resolutionCode: operationRecord.resolutionCode,
        });
        if (
          result.reviewId !== operationRecord.reviewId ||
          result.status !== 'acknowledged' ||
          result.resolutionCode !== operationRecord.resolutionCode ||
          typeof result.duplicate !== 'boolean'
        ) {
          throw new Error('E_IAP_REVIEW_SHAPE_INVALID');
        }
        return json({
          reviewId: result.reviewId,
          status: result.status,
          resolutionCode: result.resolutionCode,
          duplicate: result.duplicate,
        }, 200);
      } catch {
        return json({ error: 'E_IAP_REVIEW_UPDATE_FAILED' }, 409);
      }
    }
    return json({ error: 'E_BAD_REQUEST' }, 400);
  }

  const counts = {
    claimed: 0,
    sent: 0,
    retryable: 0,
    terminal: 0,
    expired: 0,
    unknown: 0,
    warnings: 0,
  };
  try {
    for (let index = 0; index < 25; index += 1) {
      const job = await deps.claimNext();
      if (!job) break;
      counts.claimed += 1;
      const now = deps.now();
      if (now >= job.deadlineAtMs) {
        await deps.complete({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          sendAuthorizationToken: null,
          attemptNo: job.attemptNo,
          requestBodyHash: null,
          outcome: 'expired',
          errorCode: 'APPLE_DEADLINE_EXPIRED',
          retryAfterSeconds: null,
        });
        counts.expired += 1;
        continue;
      }
      const sendWindowMs = Math.min(job.deadlineAtMs, job.leaseExpiresAtMs) -
        now - 5_000;
      if (sendWindowMs <= 0) {
        await deps.complete({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          sendAuthorizationToken: null,
          attemptNo: job.attemptNo,
          requestBodyHash: null,
          outcome: 'retryable_failed',
          errorCode: 'APPLE_SEND_WINDOW_EXHAUSTED',
          retryAfterSeconds: null,
        });
        counts.retryable += 1;
        continue;
      }
      const authorization = await deps.authorizeSend({
        requestId: job.requestId,
        leaseToken: job.leaseToken,
      });
      if (!authorization) continue;

      let appleRequest: AppleIapConsumptionSend['request'];
      try {
        appleRequest = buildRequest(job, authorization);
      } catch {
        await deps.complete({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          sendAuthorizationToken: authorization.sendAuthorizationToken,
          attemptNo: authorization.attemptNo,
          requestBodyHash: authorization.requestBodyHash,
          outcome: 'terminal_failed',
          errorCode: 'AUTHORIZATION_PAYLOAD_INVALID',
          retryAfterSeconds: null,
        });
        counts.terminal += 1;
        continue;
      }
      if (
        authorization.environment === 'Production' &&
        now >= job.receivedAtMs + 10 * 60 * 60 * 1000
      ) counts.warnings += 1;

      // Authorization is the linearization point for a send. Re-read the clock
      // immediately before starting I/O so a delayed worker cannot use an
      // expired or malformed authorization snapshot.
      const authorizedNow = deps.now();
      if (
        !Number.isSafeInteger(authorization.sendAuthorizationExpiresAtMs) ||
        authorization.sendAuthorizationExpiresAtMs <= authorizedNow ||
        authorization.sendAuthorizationExpiresAtMs > job.leaseExpiresAtMs ||
        authorization.sendAuthorizationExpiresAtMs > job.deadlineAtMs
      ) {
        await deps.complete({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          sendAuthorizationToken: authorization.sendAuthorizationToken,
          attemptNo: authorization.attemptNo,
          requestBodyHash: authorization.requestBodyHash,
          outcome: 'retryable_failed',
          errorCode: 'SEND_AUTHORIZATION_EXPIRED',
          retryAfterSeconds: null,
        });
        counts.retryable += 1;
        continue;
      }

      const authorizedSendWindowMs = Math.min(job.deadlineAtMs, job.leaseExpiresAtMs) -
        authorizedNow - 5_000;
      if (authorizedSendWindowMs <= 0) {
        await deps.complete({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          sendAuthorizationToken: authorization.sendAuthorizationToken,
          attemptNo: authorization.attemptNo,
          requestBodyHash: authorization.requestBodyHash,
          outcome: 'retryable_failed',
          errorCode: 'APPLE_SEND_WINDOW_EXHAUSTED',
          retryAfterSeconds: null,
        });
        counts.retryable += 1;
        continue;
      }

      try {
        await deps.sendConsumptionInformation({
          environment: authorization.environment,
          transactionId: authorization.transactionId,
          timeoutMs: Math.min(120_000, authorizedSendWindowMs),
          request: appleRequest,
        });
        await deps.complete({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          sendAuthorizationToken: authorization.sendAuthorizationToken,
          attemptNo: authorization.attemptNo,
          requestBodyHash: authorization.requestBodyHash,
          outcome: 'accepted',
          errorCode: null,
          retryAfterSeconds: null,
        });
        counts.sent += 1;
      } catch (error) {
        const disposition = errorDisposition(error);
        await deps.complete({
          requestId: job.requestId,
          leaseToken: job.leaseToken,
          sendAuthorizationToken: authorization.sendAuthorizationToken,
          attemptNo: authorization.attemptNo,
          requestBodyHash: authorization.requestBodyHash,
          ...disposition,
        });
        if (disposition.outcome === 'retryable_failed') counts.retryable += 1;
        else if (disposition.outcome === 'send_result_unknown') counts.unknown += 1;
        else counts.terminal += 1;
      }
    }
    return json(counts, 200);
  } catch {
    return json({ error: 'E_IAP_CONSUMPTION_DRAIN_FAILED' }, 503);
  }
}
