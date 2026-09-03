export type AppleEnvironment = 'Sandbox' | 'Production' | 'Xcode';

export type VerifiedAppleTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  type: string;
  appAccountToken?: string | null;
  bundleId: string;
  environment: AppleEnvironment;
  purchaseDate: number;
  signedDate: number;
  expiresDate?: number | null;
  revocationDate?: number | null;
  revocationReason?: number | null;
  inAppOwnershipType?: string | null;
};

export type VerifiedAppleNotification = {
  notificationUUID: string;
  notificationType: string;
  subtype?: string | null;
  signedDate: number;
  environment: AppleEnvironment;
  data?: { signedTransactionInfo?: string | null } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const TRANSACTION_ID = /^[1-9][0-9]{0,19}$/;
const NOTIFICATION_KIND = /^[A-Z0-9_]{1,64}$/;
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isCompactJws(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 32_768 && JWS.test(value);
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
  return isAppleUInt64(item.transactionId)
    && isAppleUInt64(item.originalTransactionId)
    && typeof item.productId === 'string' && PRODUCT_ID.test(item.productId)
    && typeof item.type === 'string' && item.type.length > 0 && item.type.length <= 64
    && (item.appAccountToken == null || isUuid(item.appAccountToken))
    && typeof item.bundleId === 'string' && item.bundleId.length > 0 && item.bundleId.length <= 200
    && (item.environment === 'Sandbox' || item.environment === 'Production' || item.environment === 'Xcode')
    && Number.isSafeInteger(item.purchaseDate) && Number(item.purchaseDate) > 0
    && Number.isSafeInteger(item.signedDate) && Number(item.signedDate) > 0
    && (item.expiresDate == null || (Number.isSafeInteger(item.expiresDate) && Number(item.expiresDate) > 0))
    && (item.revocationDate == null || (Number.isSafeInteger(item.revocationDate) && Number(item.revocationDate) > 0))
    && (item.revocationReason == null || Number.isSafeInteger(item.revocationReason));
}

export function isVerifiedNotification(value: unknown): value is VerifiedAppleNotification {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isUuid(item.notificationUUID)
    && typeof item.notificationType === 'string'
    && NOTIFICATION_KIND.test(item.notificationType)
    && (item.subtype == null || (typeof item.subtype === 'string' && NOTIFICATION_KIND.test(item.subtype)))
    && Number.isSafeInteger(item.signedDate)
    && Number(item.signedDate) > 0
    && (item.environment === 'Sandbox' || item.environment === 'Production' || item.environment === 'Xcode')
    && (item.data == null || typeof item.data === 'object');
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

export async function readBoundedJson(request: Request, maxBytes = 40_000): Promise<unknown | null> {
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
