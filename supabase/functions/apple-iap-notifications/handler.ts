import {
  isCompactJws,
  isVerifiedNotification,
  isVerifiedTransaction,
  json,
  readBoundedJson,
  sha256Hex,
  type VerifiedAppleNotification,
  type VerifiedAppleTransaction,
} from '../_shared/appleIapContract.ts';

export type AppleIapNotificationDeps = {
  verifyNotification: (signedPayload: string) => Promise<unknown>;
  verifyTransaction: (signedTransactionJws: string) => Promise<unknown>;
  persistVerifiedNotification: (input: {
    notification: VerifiedAppleNotification;
    transaction: VerifiedAppleTransaction | null;
    notificationJwsSha256: string;
    transactionJwsSha256: string | null;
  }) => Promise<{ duplicate: boolean; stale: boolean }>;
};

export async function handleAppleIapNotification(
  request: Request,
  deps: AppleIapNotificationDeps,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'E_METHOD_NOT_ALLOWED' }, 405);
  const body = await readBoundedJson(request);
  const signedPayload = body && typeof body === 'object'
    ? (body as Record<string, unknown>).signedPayload
    : null;
  if (!isCompactJws(signedPayload)) return json({ error: 'E_BAD_REQUEST' }, 400);

  let notification: unknown;
  try {
    notification = await deps.verifyNotification(signedPayload);
  } catch {
    return json({ error: 'E_UNVERIFIED_NOTIFICATION' }, 400);
  }
  if (!isVerifiedNotification(notification)) {
    return json({ error: 'E_UNVERIFIED_NOTIFICATION' }, 400);
  }

  const nestedJws = notification.data?.signedTransactionInfo ?? null;
  let transaction: VerifiedAppleTransaction | null = null;
  let transactionJwsSha256: string | null = null;
  if (nestedJws != null) {
    if (!isCompactJws(nestedJws)) return json({ error: 'E_UNVERIFIED_TRANSACTION' }, 400);
    let verified: unknown;
    try {
      verified = await deps.verifyTransaction(nestedJws);
    } catch {
      return json({ error: 'E_UNVERIFIED_TRANSACTION' }, 400);
    }
    if (!isVerifiedTransaction(verified)) {
      return json({ error: 'E_UNVERIFIED_TRANSACTION' }, 400);
    }
    if (verified.environment !== notification.environment) {
      return json({ error: 'E_IAP_ENVIRONMENT_MISMATCH' }, 409);
    }
    transaction = verified;
    transactionJwsSha256 = await sha256Hex(nestedJws);
  }

  try {
    const result = await deps.persistVerifiedNotification({
      notification,
      transaction,
      notificationJwsSha256: await sha256Hex(signedPayload),
      transactionJwsSha256,
    });
    return json({ received: true, ...result }, 200);
  } catch {
    return json({ error: 'E_IAP_PERSIST_FAILED' }, 503);
  }
}
