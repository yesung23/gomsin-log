import { Buffer } from 'node:buffer';
import { Environment, SignedDataVerifier } from 'npm:@apple/app-store-server-library@3.1.0';

type Env = (key: string) => string | undefined;
type AppleVerifierLike = {
  verifyAndDecodeTransaction: (jws: string) => Promise<unknown>;
  verifyAndDecodeNotification: (jws: string) => Promise<unknown>;
};
type VerifierFactory = (
  roots: Buffer[],
  onlineChecks: boolean,
  environment: Environment,
  bundleId: string,
  appAppleId?: number,
) => AppleVerifierLike;

const BUNDLE_ID = 'app.gomsinlog';

function records(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function normalizeTransaction(value: unknown): Record<string, unknown> {
  const item = records(value);
  return {
    transactionId: item.transactionId,
    originalTransactionId: item.originalTransactionId,
    productId: item.productId,
    type: item.type,
    appAccountToken: item.appAccountToken ?? null,
    bundleId: item.bundleId,
    environment: item.environment,
    purchaseDate: item.purchaseDate,
    signedDate: item.signedDate,
    expiresDate: item.expiresDate ?? null,
    revocationDate: item.revocationDate ?? null,
    revocationReason: item.revocationReason ?? null,
    quantity: item.quantity ?? 1,
    revocationType: item.revocationType ?? null,
    revocationPercentage: item.revocationPercentage ?? null,
    inAppOwnershipType: item.inAppOwnershipType ?? null,
  };
}

export function normalizeNotification(value: unknown): Record<string, unknown> {
  const item = records(value);
  const data = records(item.data);
  return {
    notificationUUID: item.notificationUUID,
    notificationType: item.notificationType,
    subtype: item.subtype ?? null,
    signedDate: item.signedDate,
    environment: data.environment,
    data: item.data == null ? null : {
      signedTransactionInfo: data.signedTransactionInfo ?? null,
      ...(data.consumptionRequestReason == null
        ? {}
        : { consumptionRequestReason: data.consumptionRequestReason }),
    },
  };
}

function decodeRootCertificates(raw: string | undefined): Buffer[] {
  if (!raw) throw new Error('APPLE_IAP_ROOT_CA_CERTS_BASE64 is required');
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new Error('APPLE_IAP_ROOT_CA_CERTS_BASE64 must be JSON');
  }
  if (
    !Array.isArray(values) || values.length < 1 || values.length > 8 ||
    values.some((value) => typeof value !== 'string' || value.length < 4 || value.length > 16_384)
  ) {
    throw new Error('APPLE_IAP_ROOT_CA_CERTS_BASE64 is invalid');
  }
  return values.map((value) => Buffer.from(value as string, 'base64'));
}

function positiveAppId(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('APPLE_IAP_APPLE_ID is required');
  return value;
}

async function verifyWithAny(
  verifiers: AppleVerifierLike[],
  operation: keyof AppleVerifierLike,
  jws: string,
): Promise<unknown> {
  let lastError: unknown = new Error('Apple JWS verification failed');
  for (const verifier of verifiers) {
    try {
      return await verifier[operation](jws);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function createAppleIapVerifier(
  env: Env = (key) => Deno.env.get(key),
  factory: VerifierFactory = (...args) => new SignedDataVerifier(...args),
) {
  const bundleId = env('APPLE_IAP_BUNDLE_ID');
  if (bundleId !== BUNDLE_ID) throw new Error('Apple IAP bundle id is not pinned');
  const appAppleId = positiveAppId(env('APPLE_IAP_APPLE_ID'));
  const roots = decodeRootCertificates(env('APPLE_IAP_ROOT_CA_CERTS_BASE64'));
  const verifiers: AppleVerifierLike[] = [
    factory(roots, true, Environment.PRODUCTION, bundleId, appAppleId),
    factory(roots, true, Environment.SANDBOX, bundleId),
  ];
  if (env('APPLE_IAP_ALLOW_XCODE_TESTING') === 'true') {
    verifiers.push(factory(roots, false, Environment.XCODE, bundleId));
  }

  return {
    async verifyTransaction(jws: string) {
      return normalizeTransaction(
        await verifyWithAny(
          verifiers,
          'verifyAndDecodeTransaction',
          jws,
        ),
      );
    },
    async verifyNotification(jws: string) {
      return normalizeNotification(
        await verifyWithAny(
          verifiers,
          'verifyAndDecodeNotification',
          jws,
        ),
      );
    },
  };
}
