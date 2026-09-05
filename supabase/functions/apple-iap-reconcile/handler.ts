import {
  isCompactJws,
  hashAppAccountToken,
  isUuid,
  isVerifiedTransaction,
  json,
  sha256Hex,
  type VerifiedAppleTransaction,
} from '../_shared/appleIapContract.ts';
import { timingSafeEqualSecret } from '../_shared/adminSecret.ts';

// Keep one Apple-customer anchor inside a conservative soft deadline so the
// worker still has time to settle or release its lease before platform expiry.
export const MAX_RECONCILIATION_TARGETS = 1;
export const MAX_RECONCILIATION_TRANSACTIONS_PER_TARGET = 20;
export const RECONCILIATION_RUNTIME_BUDGET_MS = 125_000;
export const RECONCILIATION_FINALIZATION_RESERVE_MS = 10_000;
export const MAX_RECONCILIATION_HISTORY_TIMEOUT_MS = 25_000;
const RECONCILIATION_PAGE_PROCESSING_RESERVE_MS = 30_000;
const RECONCILIATION_SETTLEMENT_RESERVE_MS = 20_000;
const MIN_NETWORK_TIMEOUT_MS = 1_000;

export type AppleIapHistoryPage = {
  signedTransactions: string[];
  nextRevision: string;
  hasMore: boolean;
};

export type AppleIapReconcileTarget = {
  checkpointId: string;
  leaseToken: string;
  environment: 'Sandbox' | 'Production';
  anchorTransactionId: string;
  revision: string | null;
};

export type AppleIapReconciliationTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  productType: VerifiedAppleTransaction['type'];
  bundleId: string;
  appAccountTokenHash: string | null;
  purchaseDateMs: number;
  signedDateMs: number;
  expiresDateMs: number | null;
  revocationDateMs: number | null;
  eventKind: 'purchase' | 'refund' | 'revoke';
  jwsSha256: string;
  quantity: number;
  revocationType: VerifiedAppleTransaction['revocationType'];
  revocationPercentage: number | null;
};

export type AppleIapReconcileDeps = {
  schedulerSecret: string | null;
  invocationStartedAtMs: number;
  monotonicNow: () => number;
  listTargets: () => Promise<AppleIapReconcileTarget[]>;
  transactionHistory: (
    target: AppleIapReconcileTarget,
    timeoutMs: number,
  ) => Promise<AppleIapHistoryPage>;
  verifyTransaction: (signedTransactionJws: string) => Promise<unknown>;
  settlePage: (input: {
    checkpointId: string;
    leaseToken: string;
    environment: 'Sandbox' | 'Production';
    expectedRevision: string | null;
    nextRevision: string;
    hasMore: boolean;
    transactions: AppleIapReconciliationTransaction[];
  }) => Promise<{ applied: number; reviewed: number }>;
  failTarget: (input: {
    checkpointId: string;
    leaseToken: string;
    errorCode: string;
  }) => Promise<void>;
};

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096;
}

function runtimeNow(deps: AppleIapReconcileDeps): number {
  const value = deps.monotonicNow();
  if (
    !Number.isFinite(deps.invocationStartedAtMs) || deps.invocationStartedAtMs < 0 ||
    !Number.isFinite(value) || value < deps.invocationStartedAtMs
  ) {
    throw new Error('RECONCILIATION_RUNTIME_CLOCK_INVALID');
  }
  return value;
}

function requireRuntime(
  deps: AppleIapReconcileDeps,
  runtimeDeadline: number,
  reserveMs: number,
): number {
  const remaining = runtimeDeadline - runtimeNow(deps) - reserveMs;
  if (!Number.isFinite(remaining) || remaining < MIN_NETWORK_TIMEOUT_MS) {
    throw new Error('RECONCILIATION_RUNTIME_EXHAUSTED');
  }
  return remaining;
}

function failureCode(error: unknown): string {
  return error instanceof Error && error.message === 'RECONCILIATION_RUNTIME_EXHAUSTED'
    ? 'RECONCILIATION_RUNTIME_EXHAUSTED'
    : 'RECONCILIATION_TARGET_FAILED';
}

export async function handleAppleIapReconcile(
  request: Request,
  deps: AppleIapReconcileDeps,
): Promise<Response> {
  const provided = request.headers.get('x-iap-scheduler-secret');
  if (request.method !== 'POST') return json({ error: 'E_METHOD_NOT_ALLOWED' }, 405);
  if (
    !deps.schedulerSecret || !provided ||
    !(await timingSafeEqualSecret(provided, deps.schedulerSecret))
  ) {
    return json({ error: 'E_UNAUTHENTICATED' }, 401);
  }

  let runtimeDeadline: number;
  let targets: AppleIapReconcileTarget[];
  try {
    runtimeDeadline = deps.invocationStartedAtMs + RECONCILIATION_RUNTIME_BUDGET_MS;
    requireRuntime(
      deps,
      runtimeDeadline,
      RECONCILIATION_FINALIZATION_RESERVE_MS +
        RECONCILIATION_SETTLEMENT_RESERVE_MS +
        RECONCILIATION_PAGE_PROCESSING_RESERVE_MS,
    );
    targets = await deps.listTargets();
  } catch {
    return json({ error: 'E_IAP_RECONCILE_FAILED' }, 503);
  }
  if (!Array.isArray(targets) || targets.length > MAX_RECONCILIATION_TARGETS) {
    return json({ error: 'E_IAP_RECONCILE_BATCH_LIMIT' }, 503);
  }

  let succeeded = 0;
  let failed = 0;
  let transactions = 0;
  let reviews = 0;
  for (const target of targets) {
    try {
      if (
        !isUuid(target.checkpointId) || !isUuid(target.leaseToken) ||
        (target.environment !== 'Sandbox' && target.environment !== 'Production') ||
        !/^[1-9][0-9]{0,19}$/.test(target.anchorTransactionId) ||
        (target.revision !== null && !isRevision(target.revision))
      ) {
        throw new Error('invalid reconciliation target');
      }

      const availableForHistory = requireRuntime(
        deps,
        runtimeDeadline,
        RECONCILIATION_FINALIZATION_RESERVE_MS +
          RECONCILIATION_SETTLEMENT_RESERVE_MS +
          RECONCILIATION_PAGE_PROCESSING_RESERVE_MS,
      );
      const history = await deps.transactionHistory(
        target,
        Math.min(MAX_RECONCILIATION_HISTORY_TIMEOUT_MS, Math.floor(availableForHistory)),
      );
      if (
        !history || !Array.isArray(history.signedTransactions) ||
        history.signedTransactions.length > MAX_RECONCILIATION_TRANSACTIONS_PER_TARGET ||
        !isRevision(history.nextRevision) || typeof history.hasMore !== 'boolean'
      ) {
        throw new Error('history batch exceeds limit');
      }

      const seen = new Set<string>();
      const page: AppleIapReconciliationTransaction[] = [];
      for (const signedJws of history.signedTransactions) {
        if (!isCompactJws(signedJws)) throw new Error('invalid signed transaction');
        if (seen.has(signedJws)) continue;
        seen.add(signedJws);
        requireRuntime(
          deps,
          runtimeDeadline,
          RECONCILIATION_FINALIZATION_RESERVE_MS +
            RECONCILIATION_SETTLEMENT_RESERVE_MS,
        );
        const verified = await deps.verifyTransaction(signedJws);
        if (!isVerifiedTransaction(verified)) throw new Error('unverified');
        if (verified.environment !== target.environment) {
          throw new Error('cross-environment transaction');
        }
        const appAccountTokenHash = verified.appAccountToken
          ? await hashAppAccountToken(verified.appAccountToken)
          : null;
        page.push({
          transactionId: verified.transactionId,
          originalTransactionId: verified.originalTransactionId,
          productId: verified.productId,
          productType: verified.type,
          bundleId: verified.bundleId,
          appAccountTokenHash,
          purchaseDateMs: verified.purchaseDate,
          signedDateMs: verified.signedDate,
          expiresDateMs: verified.expiresDate ?? null,
          revocationDateMs: verified.revocationDate ?? null,
          eventKind: verified.revocationDate
            ? verified.revocationType === 'FAMILY_REVOKE' ? 'revoke' : 'refund'
            : 'purchase',
          jwsSha256: await sha256Hex(signedJws),
          quantity: verified.quantity ?? 1,
          revocationType: verified.revocationType ?? null,
          revocationPercentage: verified.revocationPercentage ?? null,
        });
      }

      requireRuntime(
        deps,
        runtimeDeadline,
        RECONCILIATION_FINALIZATION_RESERVE_MS +
          RECONCILIATION_SETTLEMENT_RESERVE_MS,
      );
      const settled = await deps.settlePage({
        checkpointId: target.checkpointId,
        leaseToken: target.leaseToken,
        environment: target.environment,
        expectedRevision: target.revision,
        nextRevision: history.nextRevision,
        hasMore: history.hasMore,
        transactions: page,
      });
      if (
        !Number.isInteger(settled.applied) || settled.applied < 0 ||
        !Number.isInteger(settled.reviewed) || settled.reviewed < 0 ||
        settled.applied + settled.reviewed !== page.length
      ) {
        throw new Error('invalid reconciliation settlement');
      }
      transactions += settled.applied;
      reviews += settled.reviewed;
      succeeded += 1;
    } catch (error) {
      try {
        requireRuntime(deps, runtimeDeadline, RECONCILIATION_FINALIZATION_RESERVE_MS);
        await deps.failTarget({
          checkpointId: target.checkpointId,
          leaseToken: target.leaseToken,
          errorCode: failureCode(error),
        });
      } catch {
        // An expired or lost lease is intentionally left for the next claim.
        // Never expose transaction or account identity in logs or output.
      }
      failed += 1;
    }
  }
  return json(
    { targets: targets.length, succeeded, failed, transactions, reviews },
    failed > 0 ? 503 : 200,
  );
}
