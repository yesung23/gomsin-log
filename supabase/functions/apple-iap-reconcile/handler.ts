import {
  isCompactJws,
  isVerifiedTransaction,
  json,
  sha256Hex,
  type VerifiedAppleTransaction,
} from '../_shared/appleIapContract.ts';
import { timingSafeEqualSecret } from '../_shared/adminSecret.ts';

export type AppleIapReconcileTarget = {
  userId: string;
  environment: 'Sandbox' | 'Production';
  originalTransactionId: string;
};

export type AppleIapReconcileDeps = {
  schedulerSecret: string | null;
  listTargets: () => Promise<AppleIapReconcileTarget[]>;
  transactionHistory: (target: AppleIapReconcileTarget) => Promise<string[]>;
  verifyTransaction: (signedTransactionJws: string) => Promise<unknown>;
  ingestTransaction: (input: {
    userId: string;
    environment: 'Sandbox' | 'Production';
    transaction: VerifiedAppleTransaction;
    jwsSha256: string;
  }) => Promise<void>;
};

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

  let succeeded = 0;
  let failed = 0;
  let transactions = 0;
  for (const target of targets) {
    try {
      const seen = new Set<string>();
      const history = await deps.transactionHistory(target);
      for (const signedJws of history) {
        if (!isCompactJws(signedJws) || seen.has(signedJws)) continue;
        seen.add(signedJws);
        const verified = await deps.verifyTransaction(signedJws);
        if (!isVerifiedTransaction(verified)) throw new Error('unverified');
        await deps.ingestTransaction({
          userId: target.userId,
          environment: target.environment,
          transaction: verified,
          jwsSha256: await sha256Hex(signedJws),
        });
        transactions += 1;
      }
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  return json({ targets: targets.length, succeeded, failed, transactions }, 200);
}
