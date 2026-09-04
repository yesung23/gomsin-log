import {
  isCompactJws,
  isUuid,
  isVerifiedTransaction,
  json,
  sha256Hex,
  type VerifiedAppleTransaction,
} from '../_shared/appleIapContract.ts';
import { timingSafeEqualSecret } from '../_shared/adminSecret.ts';

// Supabase's Free hosted Edge runtime is capped at 150 seconds. Each Apple
// request has its own 30-second timeout, so only two one-page checkpoints are
// claimed per invocation to leave room for verification and durable writes.
export const MAX_RECONCILIATION_TARGETS = 2;
export const MAX_RECONCILIATION_TRANSACTIONS_PER_TARGET = 20;

export type AppleIapHistoryPage = {
  signedTransactions: string[];
  nextRevision: string;
  hasMore: boolean;
};

export type AppleIapReconcileTarget = {
  checkpointId: string;
  leaseToken: string;
  userId: string;
  environment: 'Sandbox' | 'Production';
  anchorTransactionId: string;
  revision: string | null;
  appAccountTokenHash: string;
};

export type AppleIapReconcileDeps = {
  schedulerSecret: string | null;
  listTargets: () => Promise<AppleIapReconcileTarget[]>;
  transactionHistory: (target: AppleIapReconcileTarget) => Promise<AppleIapHistoryPage>;
  verifyTransaction: (signedTransactionJws: string) => Promise<unknown>;
  ingestTransaction: (input: {
    userId: string;
    environment: 'Sandbox' | 'Production';
    transaction: VerifiedAppleTransaction;
    jwsSha256: string;
  }) => Promise<void>;
  recordReview: (input: {
    checkpointId: string;
    leaseToken: string;
    environment: 'Sandbox' | 'Production';
    transaction: VerifiedAppleTransaction;
    jwsSha256: string;
    reasonCode: 'TOKEN_BINDING_MISSING' | 'TOKEN_BINDING_MISMATCH';
  }) => Promise<void>;
  completeTarget: (input: {
    checkpointId: string;
    leaseToken: string;
    succeeded: boolean;
    errorCode: string | null;
    nextRevision: string | null;
    hasMore: boolean | null;
  }) => Promise<void>;
};

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096;
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

  let targets: AppleIapReconcileTarget[];
  try {
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
        !isUuid(target.userId) ||
        (target.environment !== 'Sandbox' && target.environment !== 'Production') ||
        !/^[1-9][0-9]{0,19}$/.test(target.anchorTransactionId) ||
        (target.revision !== null && !isRevision(target.revision)) ||
        !/^[a-f0-9]{64}$/.test(target.appAccountTokenHash)
      ) {
        throw new Error('invalid reconciliation target');
      }
      const seen = new Set<string>();
      const history = await deps.transactionHistory(target);
      if (
        !history || !Array.isArray(history.signedTransactions) ||
        history.signedTransactions.length > MAX_RECONCILIATION_TRANSACTIONS_PER_TARGET ||
        !isRevision(history.nextRevision) || typeof history.hasMore !== 'boolean'
      ) {
        throw new Error('history batch exceeds limit');
      }
      for (const signedJws of history.signedTransactions) {
        if (!isCompactJws(signedJws)) throw new Error('invalid signed transaction');
        if (seen.has(signedJws)) continue;
        seen.add(signedJws);
        const verified = await deps.verifyTransaction(signedJws);
        if (!isVerifiedTransaction(verified)) throw new Error('unverified');
        if (verified.environment !== target.environment) {
          throw new Error('cross-environment transaction');
        }
        const jwsSha256 = await sha256Hex(signedJws);
        const verifiedTokenHash = verified.appAccountToken
          ? await sha256Hex(verified.appAccountToken.toLowerCase())
          : null;
        if (verifiedTokenHash !== target.appAccountTokenHash) {
          await deps.recordReview({
            checkpointId: target.checkpointId,
            leaseToken: target.leaseToken,
            environment: target.environment,
            transaction: verified,
            jwsSha256,
            reasonCode: verifiedTokenHash === null
              ? 'TOKEN_BINDING_MISSING'
              : 'TOKEN_BINDING_MISMATCH',
          });
          reviews += 1;
          continue;
        }
        await deps.ingestTransaction({
          userId: target.userId,
          environment: target.environment,
          transaction: verified,
          jwsSha256,
        });
        transactions += 1;
      }
      await deps.completeTarget({
        checkpointId: target.checkpointId,
        leaseToken: target.leaseToken,
        succeeded: true,
        errorCode: null,
        nextRevision: history.nextRevision,
        hasMore: history.hasMore,
      });
      succeeded += 1;
    } catch {
      try {
        await deps.completeTarget({
          checkpointId: target.checkpointId,
          leaseToken: target.leaseToken,
          succeeded: false,
          errorCode: 'RECONCILIATION_TARGET_FAILED',
          nextRevision: null,
          hasMore: null,
        });
      } catch {
        // An expired or lost lease is intentionally left for the database
        // sweeper/next claim; never expose target identity in logs or output.
      }
      failed += 1;
    }
  }
  return json(
    { targets: targets.length, succeeded, failed, transactions, reviews },
    failed > 0 ? 503 : 200,
  );
}
