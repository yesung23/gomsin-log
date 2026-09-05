import { Capacitor } from '@capacitor/core';
import {
  GomsinlogAppleAuth,
  type AppleAuthPlugin,
  type AppleAuthorizeResult,
  type AppleCredentialState,
  type AppleFullName,
} from '@gomsinlog/capacitor-apple-auth';
import { appleLoginEnabled } from '@/lib/appleLoginFeature';
import { AUTH_CALLBACK_TIMEOUT_MS } from '@/lib/async';
import type { AppleSessionAttempt } from '@/lib/authSessionGuard';

export const APPLE_AUTH_PLUGIN_NAME = 'GomsinlogAppleAuth';

const NONCE_BYTES = 32;
const MAX_STATE_BYTES = 128;
const MAX_IDENTITY_TOKEN_BYTES = 16_384;
const MAX_AUTHORIZATION_CODE_BYTES = 4_096;
const MAX_APPLE_USER_ID_BYTES = 512;
const MAX_NAME_COMPONENT_BYTES = 256;
const MAX_FORMATTED_NAME_BYTES = 512;
const MAX_ONBOARDING_NICKNAME_CHARACTERS = 12;
const NAME_CANDIDATE_TTL_MS = 5 * 60_000;

export type AppleAuthBoundaryCode =
  | 'E_BAD_REQUEST'
  | 'E_RANDOMNESS'
  | 'E_STATE_MISMATCH'
  | 'E_MALFORMED_RESPONSE';

export class AppleAuthBoundaryError extends Error {
  constructor(readonly code: AppleAuthBoundaryCode) {
    super('Native Apple authentication did not satisfy the local contract.');
    this.name = 'AppleAuthBoundaryError';
  }
}

export type NativeAppleAuthorization =
  | {
      status: 'success';
      identityToken: string;
      authorizationCode: string;
      appleUserId: string;
      rawNonce: string;
      fullName: AppleFullName | null;
    }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

export type NativeAppleCredentialState = AppleCredentialState | 'unavailable';

export type AppleAuthClientDependencies = {
  isFeatureEnabled: () => boolean;
  isNativePlatform: () => boolean;
  getPlatform: () => string;
  isPluginAvailable: (name: string) => boolean;
  isLoggingDisabled: () => boolean;
  plugin: Pick<AppleAuthPlugin, 'authorize' | 'getCredentialState'>;
  randomBytes: (size: number) => Uint8Array;
  sha256Hex: (value: string) => Promise<string>;
};

export type AppleAuthClient = {
  isAvailable: () => boolean;
  authorize: () => Promise<NativeAppleAuthorization>;
  getCredentialState: (userId: string) => Promise<{ state: NativeAppleCredentialState }>;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isBoundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0
    && value.length <= maxBytes && byteLength(value) <= maxBytes;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index]);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function validateFullName(value: unknown): AppleFullName | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppleAuthBoundaryError('E_MALFORMED_RESPONSE');
  }
  const allowed = new Set([
    'namePrefix',
    'givenName',
    'middleName',
    'familyName',
    'nameSuffix',
    'nickname',
    'formatted',
  ]);
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    throw new AppleAuthBoundaryError('E_MALFORMED_RESPONSE');
  }
  const result: AppleFullName = {};
  for (const key of allowed) {
    const part = source[key];
    if (part === undefined) continue;
    const limit = key === 'formatted' ? MAX_FORMATTED_NAME_BYTES : MAX_NAME_COMPONENT_BYTES;
    if (!isBoundedString(part, limit)) {
      throw new AppleAuthBoundaryError('E_MALFORMED_RESPONSE');
    }
    result[key as keyof AppleFullName] = part;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function validateCredentialResponse(
  response: AppleAuthorizeResult,
  expectedState: string,
  rawNonce: string,
): NativeAppleAuthorization {
  if (!response || typeof response !== 'object' || response.state !== expectedState) {
    throw new AppleAuthBoundaryError('E_STATE_MISMATCH');
  }
  const record = response as unknown as Record<string, unknown>;
  if (response.status === 'cancelled') {
    if (!hasExactKeys(record, ['state', 'status'])) {
      throw new AppleAuthBoundaryError('E_MALFORMED_RESPONSE');
    }
    return { status: 'cancelled' };
  }
  if (
    response.status !== 'success'
    || !hasExactKeys(record, [
      'authorizationCode',
      'fullName',
      'identityToken',
      'state',
      'status',
      'userId',
    ])
    || !isBoundedString(response.identityToken, MAX_IDENTITY_TOKEN_BYTES)
    || !isBoundedString(response.authorizationCode, MAX_AUTHORIZATION_CODE_BYTES)
    || !isBoundedString(response.userId, MAX_APPLE_USER_ID_BYTES)
  ) {
    throw new AppleAuthBoundaryError('E_MALFORMED_RESPONSE');
  }
  return {
    status: 'success',
    identityToken: response.identityToken,
    authorizationCode: response.authorizationCode,
    appleUserId: response.userId,
    rawNonce,
    fullName: validateFullName(response.fullName),
  };
}

export function createAppleAuthClient(dependencies: AppleAuthClientDependencies): AppleAuthClient {
  let authorizationInFlight: Promise<NativeAppleAuthorization> | null = null;

  const isAvailable = (): boolean => {
    try {
      return dependencies.isFeatureEnabled()
        && dependencies.isNativePlatform()
        && dependencies.getPlatform() === 'ios'
        && dependencies.isPluginAvailable(APPLE_AUTH_PLUGIN_NAME)
        && dependencies.isLoggingDisabled();
    } catch {
      return false;
    }
  };

  const authorize = (): Promise<NativeAppleAuthorization> => {
    if (authorizationInFlight) return authorizationInFlight;
    if (!isAvailable()) return Promise.resolve({ status: 'unavailable' });

    const operation = (async (): Promise<NativeAppleAuthorization> => {
      const nonceBytes = dependencies.randomBytes(NONCE_BYTES);
      const stateBytes = dependencies.randomBytes(NONCE_BYTES);
      if (nonceBytes.byteLength !== NONCE_BYTES || stateBytes.byteLength !== NONCE_BYTES) {
        throw new AppleAuthBoundaryError('E_RANDOMNESS');
      }
      const rawNonce = base64Url(nonceBytes);
      const state = base64Url(stateBytes);
      if (!isBoundedString(state, MAX_STATE_BYTES)) {
        throw new AppleAuthBoundaryError('E_RANDOMNESS');
      }
      const hashedNonce = await dependencies.sha256Hex(rawNonce);
      if (!/^[a-f0-9]{64}$/u.test(hashedNonce)) {
        throw new AppleAuthBoundaryError('E_RANDOMNESS');
      }
      const response = await dependencies.plugin.authorize({ hashedNonce, state });
      return validateCredentialResponse(response, state, rawNonce);
    })();

    const tracked = operation.finally(() => {
      if (authorizationInFlight === tracked) authorizationInFlight = null;
    });
    authorizationInFlight = tracked;
    return tracked;
  };

  const getCredentialState = async (
    userId: string,
  ): Promise<{ state: NativeAppleCredentialState }> => {
    if (!isAvailable()) return { state: 'unavailable' };
    if (!isBoundedString(userId, MAX_APPLE_USER_ID_BYTES)) {
      throw new AppleAuthBoundaryError('E_BAD_REQUEST');
    }
    const response = await dependencies.plugin.getCredentialState({ userId });
    if (!response || typeof response !== 'object' || Array.isArray(response)
      || !hasExactKeys(response as unknown as Record<string, unknown>, ['state']) || ![
      'authorized',
      'revoked',
      'not_found',
      'transferred',
      'unknown',
    ].includes(response.state)) {
      throw new AppleAuthBoundaryError('E_MALFORMED_RESPONSE');
    }
    return { state: response.state };
  };

  return { isAvailable, authorize, getCredentialState };
}

function secureRandomBytes(size: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new AppleAuthBoundaryError('E_RANDOMNESS');
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(size));
}

export async function sha256NonceChallenge(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new AppleAuthBoundaryError('E_RANDOMNESS');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const appleAuthClient = createAppleAuthClient({
  isFeatureEnabled: appleLoginEnabled,
  isNativePlatform: () => Capacitor.isNativePlatform(),
  getPlatform: () => Capacitor.getPlatform(),
  isPluginAvailable: (name) => Capacitor.isPluginAvailable(name),
  // Capacitor logs bridge options and response bodies in Debug builds. Refuse
  // credential transport unless both this flag and the native guard are quiet.
  isLoggingDisabled: () => Capacitor.isLoggingEnabled === false,
  plugin: GomsinlogAppleAuth,
  randomBytes: secureRandomBytes,
  sha256Hex: sha256NonceChallenge,
});

export function isNativeAppleLoginAvailable(): boolean {
  return appleAuthClient.isAvailable();
}

export function authorizeWithNativeApple(): Promise<NativeAppleAuthorization> {
  return appleAuthClient.authorize();
}

export function getNativeAppleCredentialState(
  userId: string,
): Promise<{ state: NativeAppleCredentialState }> {
  return appleAuthClient.getCredentialState(userId);
}

/** Bound the ID-token grant before auth-js can persist a late session. Other
 * requests retain the existing Google PKCE/refresh/logout transport unchanged. */
export function createAppleTokenTimeoutFetch(
  fetchImpl: typeof fetch,
  currentAttempt?: () => AppleSessionAttempt | undefined,
): typeof fetch {
  return async (input, init) => {
    let url: URL;
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    } catch {
      return fetchImpl(input, init);
    }
    if (url.pathname !== '/auth/v1/token' || url.searchParams.get('grant_type') !== 'id_token') {
      return fetchImpl(input, init);
    }
    const attempt = currentAttempt?.();
    attempt?.assertCurrent();
    const controller = new AbortController();
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const forwardAbort = () => controller.abort();
    const abortError = () => new DOMException('Apple token exchange did not complete.', 'AbortError');
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(abortError());
    });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    attempt?.signal.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(forwardAbort, AUTH_CALLBACK_TIMEOUT_MS);
    try {
      if (callerSignal?.aborted || attempt?.signal.aborted) throw abortError();
      const response = await Promise.race([
        fetchImpl(input, { ...init, signal: controller.signal }), aborted,
      ]);
      const body = [101, 103, 204, 205, 304].includes(response.status)
        ? null
        : await Promise.race([response.arrayBuffer(), aborted]);
      if (controller.signal.aborted) throw abortError();
      attempt?.assertCurrent();
      const buffered = new Response(body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
      if (attempt) {
        const readJson = buffered.json.bind(buffered);
        buffered.json = async () => {
          attempt.assertCurrent();
          const value: unknown = await readJson();
          attempt.bindSessionResponse(value);
          return value;
        };
      }
      return buffered;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
      attempt?.signal.removeEventListener('abort', forwardAbort);
      controller.signal.removeEventListener('abort', rejectAbort);
    }
  };
}

type AppleNameCandidate = {
  userId: string;
  value: string;
  expiresAt: number;
};

let appleNameCandidate: AppleNameCandidate | null = null;
const appleNameCandidateListeners = new Set<(userId: string) => void>();

function nicknameCandidate(fullName: AppleFullName): string | null {
  const joined = [fullName.familyName, fullName.middleName, fullName.givenName]
    .filter((part): part is string => typeof part === 'string')
    .join('');
  const value = (fullName.formatted || joined || fullName.nickname || '').trim();
  if (!value) return null;
  return Array.from(value).slice(0, MAX_ONBOARDING_NICKNAME_CHARACTERS).join('');
}

/** Called only after Supabase has verified the ID token and returned a session user. */
export function stageVerifiedAppleNameCandidate(
  userId: string,
  fullName: AppleFullName | null,
): void {
  if (!fullName || !isBoundedString(userId, MAX_APPLE_USER_ID_BYTES)) return;
  const value = nicknameCandidate(fullName);
  if (!value) return;
  appleNameCandidate = {
    userId,
    value,
    expiresAt: Date.now() + NAME_CANDIDATE_TTL_MS,
  };
  for (const listener of appleNameCandidateListeners) {
    try {
      listener(userId);
    } catch {
      // A presentation subscriber must not turn an already verified Supabase
      // session into an apparent authentication failure.
    }
  }
}

export function consumeAppleNameCandidate(userId: string): string | null {
  const candidate = appleNameCandidate;
  appleNameCandidate = null;
  if (!candidate || candidate.userId !== userId || candidate.expiresAt < Date.now()) return null;
  return candidate.value;
}

export function clearAppleNameCandidate(): void {
  appleNameCandidate = null;
}

export function subscribeAppleNameCandidate(listener: (userId: string) => void): () => void {
  appleNameCandidateListeners.add(listener);
  return () => appleNameCandidateListeners.delete(listener);
}
