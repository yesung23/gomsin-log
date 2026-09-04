export type AppleEnvironment = 'Sandbox' | 'Production' | 'Xcode';
export type AppleTransactionType =
  | 'Auto-Renewable Subscription'
  | 'Non-Consumable'
  | 'Consumable';
export type AppleTransactionEventKind = 'purchase' | 'refund' | 'revoke' | 'refund_reversed';
export type AppleRevocationType = 'REFUND_FULL' | 'REFUND_PRORATED' | 'FAMILY_REVOKE';
export type AppleConsumptionRequestReason =
  | 'UNINTENDED_PURCHASE'
  | 'FULFILLMENT_ISSUE'
  | 'UNSATISFIED_WITH_PURCHASE'
  | 'LEGAL'
  | 'OTHER';

export type VerifiedAppleTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  type: AppleTransactionType;
  appAccountToken?: string | null;
  bundleId: string;
  environment: AppleEnvironment;
  purchaseDate: number;
  signedDate: number;
  expiresDate?: number | null;
  revocationDate?: number | null;
  revocationReason?: number | null;
  quantity?: number;
  revocationType?: AppleRevocationType | null;
  revocationPercentage?: number | null;
  inAppOwnershipType?: string | null;
};

export type VerifiedAppleNotification = {
  notificationUUID: string;
  notificationType: string;
  subtype?: string | null;
  signedDate: number;
  environment: AppleEnvironment;
  data?: {
    signedTransactionInfo?: string | null;
    consumptionRequestReason?: AppleConsumptionRequestReason | null;
  } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const TRANSACTION_ID = /^[1-9][0-9]{0,19}$/;
const NOTIFICATION_KIND = /^[A-Z0-9_]{1,64}$/;
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const APPLE_TRANSACTION_TYPES = new Set<AppleTransactionType>([
  'Auto-Renewable Subscription',
  'Non-Consumable',
  'Consumable',
]);
const APPLE_REVOCATION_TYPES = new Set<AppleRevocationType>([
  'REFUND_FULL',
  'REFUND_PRORATED',
  'FAMILY_REVOKE',
]);
const APPLE_CONSUMPTION_REQUEST_REASONS = new Set<AppleConsumptionRequestReason>([
  'UNINTENDED_PURCHASE',
  'FULFILLMENT_ISSUE',
  'UNSATISFIED_WITH_PURCHASE',
  'LEGAL',
  'OTHER',
]);
const ENTITLEMENT_TRANSACTION_NOTIFICATIONS = new Set([
  'SUBSCRIBED',
  'DID_CHANGE_RENEWAL_PREF',
  'DID_CHANGE_RENEWAL_STATUS',
  'OFFER_REDEEMED',
  'DID_RENEW',
  'EXPIRED',
  'DID_FAIL_TO_RENEW',
  'GRACE_PERIOD_EXPIRED',
  'PRICE_INCREASE',
  'REFUND_DECLINED',
  'RENEWAL_EXTENDED',
  'RENEWAL_EXTENSION',
  'ONE_TIME_CHARGE',
]);

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isCompactJws(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 32_768 &&
    JWS.test(value);
}

export function appleTransactionEventKind(
  notificationType: string,
): AppleTransactionEventKind | null {
  if (notificationType === 'REFUND') return 'refund';
  if (notificationType === 'REFUND_REVERSED') return 'refund_reversed';
  if (notificationType === 'REVOKE') return 'revoke';
  return ENTITLEMENT_TRANSACTION_NOTIFICATIONS.has(notificationType) ? 'purchase' : null;
}

function isAppleUInt64(value: unknown): value is string {
  if (typeof value !== 'string' || !TRANSACTION_ID.test(value)) return false;
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
}

export function isVerifiedTransaction(value: unknown): value is VerifiedAppleTransaction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const quantity = item.quantity ?? 1;
  const revocationType = item.revocationType ?? null;
  const revocationPercentage = item.revocationPercentage ?? null;
  const hasRevocation = item.revocationDate != null;
  const validRevocation = !hasRevocation
    ? revocationType == null && revocationPercentage == null
    : revocationType == null
    ? revocationPercentage == null
    : APPLE_REVOCATION_TYPES.has(revocationType as AppleRevocationType) &&
      (revocationPercentage == null
        ? revocationType !== 'REFUND_PRORATED'
        : Number.isInteger(revocationPercentage) &&
          Number(revocationPercentage) >= 0 &&
          Number(revocationPercentage) <= 100_000 &&
          (revocationType === 'REFUND_PRORATED'
            ? Number(revocationPercentage) > 0 && Number(revocationPercentage) < 100_000
            : Number(revocationPercentage) === 100_000));
  return isAppleUInt64(item.transactionId) &&
    isAppleUInt64(item.originalTransactionId) &&
    typeof item.productId === 'string' && PRODUCT_ID.test(item.productId) &&
    APPLE_TRANSACTION_TYPES.has(item.type as AppleTransactionType) &&
    (item.appAccountToken == null || isUuid(item.appAccountToken)) &&
    typeof item.bundleId === 'string' && item.bundleId.length > 0 && item.bundleId.length <= 200 &&
    (item.environment === 'Sandbox' || item.environment === 'Production' ||
      item.environment === 'Xcode') &&
    Number.isSafeInteger(item.purchaseDate) && Number(item.purchaseDate) > 0 &&
    Number.isSafeInteger(item.signedDate) && Number(item.signedDate) > 0 &&
    Number.isInteger(quantity) && Number(quantity) >= 1 && Number(quantity) <= 10 &&
    (item.expiresDate == null ||
      (Number.isSafeInteger(item.expiresDate) && Number(item.expiresDate) > 0)) &&
    (item.revocationDate == null ||
      (Number.isSafeInteger(item.revocationDate) && Number(item.revocationDate) > 0)) &&
    (item.revocationReason == null || Number.isSafeInteger(item.revocationReason)) &&
    validRevocation;
}

export function isVerifiedNotification(value: unknown): value is VerifiedAppleNotification {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const data = item.data && typeof item.data === 'object'
    ? item.data as Record<string, unknown>
    : null;
  const reason = data?.consumptionRequestReason ?? null;
  const validReason = item.notificationType === 'CONSUMPTION_REQUEST'
    ? APPLE_CONSUMPTION_REQUEST_REASONS.has(reason as AppleConsumptionRequestReason)
    : reason == null;
  return isUuid(item.notificationUUID) &&
    typeof item.notificationType === 'string' &&
    NOTIFICATION_KIND.test(item.notificationType) &&
    (item.subtype == null ||
      (typeof item.subtype === 'string' && NOTIFICATION_KIND.test(item.subtype))) &&
    Number.isSafeInteger(item.signedDate) &&
    Number(item.signedDate) > 0 &&
    (item.environment === 'Sandbox' || item.environment === 'Production' ||
      item.environment === 'Xcode') &&
    (item.data == null || typeof item.data === 'object') &&
    validReason;
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get('Authorization');
  if (!value?.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length);
  return token.length > 0 && token.length <= 8192 ? token : null;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readBoundedJson(
  request: Request,
  maxBytes = 40_000,
): Promise<unknown | null> {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
