import {
  bearerToken,
  isCompactJws,
  isVerifiedTransaction,
  json,
  readBoundedJson,
  sha256Hex,
  type VerifiedAppleTransaction,
} from '../_shared/appleIapContract.ts';

type Snapshot = {
  entitlements: Array<{ key: string; active: boolean }>;
  exportCredits: number;
};

type IngestResult = Snapshot & {
  accepted: boolean;
  duplicate: boolean;
  transactionId: string;
};

export type AppleIapSyncDeps = {
  authenticate: (bearer: string) => Promise<string | null>;
  preparePurchase: (
    userId: string,
    productId: string,
    environment: 'Xcode' | 'Sandbox' | 'Production',
  ) => Promise<{ appAccountToken: string }>;
  verifyTransaction: (signedTransactionJws: string) => Promise<unknown>;
  ingestTransaction: (input: {
    userId: string;
    transaction: VerifiedAppleTransaction;
    jwsSha256: string;
  }) => Promise<IngestResult>;
  loadEntitlements: (
    userId: string,
    environment: 'Xcode' | 'Sandbox' | 'Production',
  ) => Promise<Snapshot>;
};

export async function handleAppleIapSync(request: Request, deps: AppleIapSyncDeps): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'E_METHOD_NOT_ALLOWED' }, 405);
  const token = bearerToken(request);
  if (!token) return json({ error: 'E_UNAUTHENTICATED' }, 401);
  const userId = await deps.authenticate(token).catch(() => null);
  if (!userId) return json({ error: 'E_UNAUTHENTICATED' }, 401);

  const body = await readBoundedJson(request);
  if (!body || typeof body !== 'object') return json({ error: 'E_BAD_REQUEST' }, 400);
  const record = body as Record<string, unknown>;
  if (record.action === 'status') {
    if (record.environment !== 'Xcode'
      && record.environment !== 'Sandbox'
      && record.environment !== 'Production') {
      return json({ error: 'E_BAD_REQUEST' }, 400);
    }
    try {
      return json(await deps.loadEntitlements(userId, record.environment), 200);
    } catch {
      return json({ error: 'E_IAP_STATE_UNAVAILABLE' }, 503);
    }
  }
  if (record.action === 'prepare') {
    if (typeof record.productId !== 'string'
      || record.productId.length < 1
      || record.productId.length > 200
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.productId)) {
      return json({ error: 'E_BAD_REQUEST' }, 400);
    }
    if (record.environment !== 'Xcode'
      && record.environment !== 'Sandbox'
      && record.environment !== 'Production') {
      return json({ error: 'E_BAD_REQUEST' }, 400);
    }
    try {
      return json(await deps.preparePurchase(userId, record.productId, record.environment), 200);
    } catch {
      return json({ error: 'E_IAP_SALE_CLOSED' }, 409);
    }
  }

  if (!isCompactJws(record.signedTransactionJws)) {
    return json({ error: 'E_BAD_REQUEST' }, 400);
  }

  let transaction: unknown;
  try {
    transaction = await deps.verifyTransaction(record.signedTransactionJws);
  } catch {
    return json({ error: 'E_UNVERIFIED_TRANSACTION' }, 400);
  }
  if (!isVerifiedTransaction(transaction)) {
    return json({ error: 'E_UNVERIFIED_TRANSACTION' }, 400);
  }

  if (!transaction.appAccountToken) {
    return json({ error: 'E_IAP_ACCOUNT_MISMATCH' }, 409);
  }

  try {
    const result = await deps.ingestTransaction({
      userId,
      transaction,
      jwsSha256: await sha256Hex(record.signedTransactionJws),
    });
    return json(result, 200);
  } catch {
    return json({ error: 'E_IAP_INGEST_FAILED' }, 503);
  }
}
