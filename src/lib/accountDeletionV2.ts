/**
 * Account Deletion V2 Capability Contract & Client Storage.
 *
 * Deliberately pure and dependency-free: no React, no Supabase client, no store.
 *
 * V2 protocol operates on an unguessable, capability-bearing recoveryToken and a
 * canonical UUIDv4 operationId. The client persists this capability durably and
 * communicates with the delete-account handler via PUT requests with protocol: 2.
 */

export const ACCOUNT_DELETION_V2_PROTOCOL = 2 as const;
export const ACCOUNT_DELETION_V2_STORAGE_KEY_PREFIX = 'gomsinlog.accountDeletionV2.';

export interface AccountDeletionV2Capability {
  version: 2;
  userId: string;
  operationId: string;
  recoveryToken: string;
  createdAt: string;
}

export type AccountDeletionV2Action = 'prepare' | 'status' | 'finalize';

export interface AccountDeletionV2RequestBody {
  protocol: 2;
  action: AccountDeletionV2Action;
  operationId: string;
  recoveryToken: string;
}

export type AccountDeletionV2State =
  | 'prepared'
  | 'deleting'
  | 'auth_delete_ready'
  | 'completed';

export type AccountDeletionV2StorageLoadResult =
  | { kind: 'absent' }
  | { kind: 'valid'; capability: AccountDeletionV2Capability }
  | { kind: 'corrupt' };

export interface AccountDeletionV2StoragePort {
  save(capability: AccountDeletionV2Capability): boolean;
  load(userId: string): AccountDeletionV2StorageLoadResult;
  remove(userId: string): boolean;
}

/* ------------------------------------------------------------------ *
 * Validation Primitives
 * ------------------------------------------------------------------ */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_32_REGEX = /^[A-Za-z0-9_-]{43}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_REGEX.test(value);
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_REGEX.test(value);
}

export function hasExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return actualKeys.length === sortedExpected.length
    && actualKeys.every((key, index) => key === sortedExpected[index]);
}

export function decodeBase64Url32(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !BASE64URL_32_REGEX.test(value)) {
    return null;
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '=';
  try {
    const binary = atob(base64);
    if (binary.length !== 32) return null;
    const bytes = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const canonical = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    return canonical === value ? bytes : null;
  } catch {
    return null;
  }
}

export function encodeBase64Url32(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw new Error('[gomsinlog] encodeBase64Url32 requires exactly 32 bytes');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function isValidRecoveryToken(value: unknown): value is string {
  return decodeBase64Url32(value) !== null;
}

const CAPABILITY_KEYS = ['version', 'userId', 'operationId', 'recoveryToken', 'createdAt'] as const;

export function parseAccountDeletionV2Capability(value: unknown): AccountDeletionV2Capability | null {
  if (!hasExactKeys(value, CAPABILITY_KEYS)) {
    return null;
  }
  if (value.version !== 2) return null;
  if (!isCanonicalUuid(value.userId)) return null;
  if (!isUuidV4(value.operationId)) return null;
  if (!isValidRecoveryToken(value.recoveryToken)) return null;
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    return null;
  }
  return {
    version: 2,
    userId: value.userId,
    operationId: value.operationId,
    recoveryToken: value.recoveryToken,
    createdAt: value.createdAt,
  };
}

export function serializeAccountDeletionV2Capability(capability: AccountDeletionV2Capability): string {
  const parsed = parseAccountDeletionV2Capability(capability);
  if (!parsed) {
    throw new Error('[gomsinlog] Cannot serialize malformed AccountDeletionV2Capability');
  }
  return JSON.stringify(parsed);
}

/* ------------------------------------------------------------------ *
 * Capability Generation
 * ------------------------------------------------------------------ */

export function generateAccountDeletionV2Capability(userId: string): AccountDeletionV2Capability {
  if (!isCanonicalUuid(userId)) {
    throw new Error('[gomsinlog] Invalid canonical userId for Account Deletion V2 capability');
  }
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('[gomsinlog] Web Crypto API is unavailable');
  }

  const operationId = crypto.randomUUID().toLowerCase();
  if (!isUuidV4(operationId)) {
    throw new Error('[gomsinlog] crypto.randomUUID() generated non-canonical UUIDv4');
  }

  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const recoveryToken = encodeBase64Url32(tokenBytes);
  if (!isValidRecoveryToken(recoveryToken)) {
    throw new Error('[gomsinlog] Generated recoveryToken failed validation');
  }

  const capability: AccountDeletionV2Capability = {
    version: 2,
    userId,
    operationId,
    recoveryToken,
    createdAt: new Date().toISOString(),
  };

  const validated = parseAccountDeletionV2Capability(capability);
  if (!validated) {
    throw new Error('[gomsinlog] Generated capability failed self-validation');
  }
  return validated;
}

/* ------------------------------------------------------------------ *
 * Durable Storage
 * ------------------------------------------------------------------ */

export function accountDeletionV2KeyFor(userId: string): string {
  return `${ACCOUNT_DELETION_V2_STORAGE_KEY_PREFIX}${userId}`;
}

export class LocalStorageAccountDeletionV2Storage implements AccountDeletionV2StoragePort {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage) {
    this.storage = storage;
  }

  save(capability: AccountDeletionV2Capability): boolean {
    const validated = parseAccountDeletionV2Capability(capability);
    if (!validated) return false;
    try {
      const serialized = JSON.stringify(validated);
      this.storage.setItem(accountDeletionV2KeyFor(validated.userId), serialized);
      return true;
    } catch {
      return false;
    }
  }

  load(userId: string): AccountDeletionV2StorageLoadResult {
    if (!isCanonicalUuid(userId)) {
      return { kind: 'corrupt' };
    }
    let raw: string | null;
    try {
      raw = this.storage.getItem(accountDeletionV2KeyFor(userId));
    } catch {
      return { kind: 'corrupt' };
    }

    if (raw === null) {
      return { kind: 'absent' };
    }

    try {
      const parsedJson = JSON.parse(raw);
      const capability = parseAccountDeletionV2Capability(parsedJson);
      if (!capability || capability.userId !== userId) {
        return { kind: 'corrupt' };
      }
      return { kind: 'valid', capability };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  remove(userId: string): boolean {
    if (!userId) return false;
    try {
      this.storage.removeItem(accountDeletionV2KeyFor(userId));
      return true;
    } catch {
      return false;
    }
  }
}

let defaultStorage: AccountDeletionV2StoragePort = new LocalStorageAccountDeletionV2Storage();

export function setDefaultAccountDeletionV2Storage(storage: AccountDeletionV2StoragePort): void {
  defaultStorage = storage;
}

export function saveAccountDeletionV2Capability(
  capability: AccountDeletionV2Capability,
  storage: AccountDeletionV2StoragePort = defaultStorage,
): boolean {
  return storage.save(capability);
}

export function loadAccountDeletionV2Capability(
  userId: string,
  storage: AccountDeletionV2StoragePort = defaultStorage,
): AccountDeletionV2StorageLoadResult {
  return storage.load(userId);
}

export function removeAccountDeletionV2Capability(
  userId: string,
  storage: AccountDeletionV2StoragePort = defaultStorage,
): boolean {
  return storage.remove(userId);
}

/* ------------------------------------------------------------------ *
 * Request Body & Response Types
 * ------------------------------------------------------------------ */

export function buildAccountDeletionV2RequestBody(
  action: AccountDeletionV2Action,
  capability: AccountDeletionV2Capability,
): AccountDeletionV2RequestBody {
  const parsed = parseAccountDeletionV2Capability(capability);
  if (!parsed) {
    throw new Error('[gomsinlog] Cannot build request body for invalid capability');
  }
  return {
    protocol: 2,
    action,
    operationId: parsed.operationId,
    recoveryToken: parsed.recoveryToken,
  };
}

export type AccountDeletionV2PrepareResult =
  | { kind: 'prepared'; operationId: string }
  | { kind: 'conflict'; error: string }
  | { kind: 'unauthenticated'; error: string }
  | { kind: 'failed'; status?: number; error?: string; retryAfterSeconds?: number };

export type AccountDeletionV2StatusResult =
  | { kind: 'status'; operationId: string; state: AccountDeletionV2State; retryAfterSeconds?: number }
  | { kind: 'not_found'; error: string }
  | { kind: 'failed'; status?: number; error?: string; retryAfterSeconds?: number };

export type AccountDeletionV2FinalizeResult =
  | { kind: 'completed'; operationId: string; warnings: string[] }
  | { kind: 'pending'; operationId: string; state: 'prepared' | 'deleting' | 'auth_delete_ready'; retryAfterSeconds: number }
  | { kind: 'busy'; operationId: string; state: string; retryAfterSeconds: number }
  | { kind: 'not_found'; error: string }
  | { kind: 'unauthenticated'; error: string }
  | { kind: 'forbidden'; error: string }
  | { kind: 'failed'; status?: number; error?: string; retryAfterSeconds?: number };

export function coerceWarnings(body: unknown): string[] {
  if (!isObject(body)) return [];
  const warnings = body.warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((entry): entry is string => typeof entry === 'string');
}

export function parseAccountDeletionV2PrepareResponse(
  body: unknown,
  expectedOperationId: string,
  httpStatus = 200,
): AccountDeletionV2PrepareResult {
  if (httpStatus === 401) {
    return { kind: 'unauthenticated', error: 'Authentication required' };
  }
  if (httpStatus === 409) {
    return { kind: 'conflict', error: 'Operation conflict' };
  }
  if (httpStatus === 200 && isObject(body) && body.success === true && body.operationId === expectedOperationId && body.state === 'prepared') {
    return { kind: 'prepared', operationId: expectedOperationId };
  }
  const retryAfterSeconds = isObject(body) && typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined;
  const error = isObject(body) && typeof body.error === 'string' ? body.error : undefined;
  return { kind: 'failed', status: httpStatus, error, retryAfterSeconds };
}

export function parseAccountDeletionV2StatusResponse(
  body: unknown,
  expectedOperationId: string,
  httpStatus = 200,
): AccountDeletionV2StatusResult {
  if (httpStatus === 404) {
    return { kind: 'not_found', error: 'Operation not found' };
  }
  const validStates: AccountDeletionV2State[] = ['prepared', 'deleting', 'auth_delete_ready', 'completed'];
  if (httpStatus === 200 && isObject(body) && body.success === true && body.operationId === expectedOperationId && typeof body.state === 'string' && validStates.includes(body.state as AccountDeletionV2State)) {
    const state = body.state as AccountDeletionV2State;
    const retryAfterSeconds = typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined;
    return { kind: 'status', operationId: expectedOperationId, state, retryAfterSeconds };
  }
  const retryAfterSeconds = isObject(body) && typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined;
  const error = isObject(body) && typeof body.error === 'string' ? body.error : undefined;
  return { kind: 'failed', status: httpStatus, error, retryAfterSeconds };
}

export function parseAccountDeletionV2FinalizeResponse(
  body: unknown,
  expectedOperationId: string,
  httpStatus = 200,
): AccountDeletionV2FinalizeResult {
  if (httpStatus === 401) {
    return { kind: 'unauthenticated', error: 'Authentication required' };
  }
  if (httpStatus === 403) {
    return { kind: 'forbidden', error: 'Forbidden' };
  }
  if (httpStatus === 404) {
    return { kind: 'not_found', error: 'Operation not found' };
  }
  if (httpStatus === 409 && isObject(body) && body.operationId === expectedOperationId && typeof body.state === 'string') {
    const retryAfterSeconds = typeof body.retryAfterSeconds === 'number' ? Math.max(1, body.retryAfterSeconds) : 1;
    return { kind: 'busy', operationId: expectedOperationId, state: body.state, retryAfterSeconds };
  }
  if (httpStatus === 503 && isObject(body) && body.operationId === expectedOperationId && (body.state === 'prepared' || body.state === 'deleting' || body.state === 'auth_delete_ready')) {
    const retryAfterSeconds = typeof body.retryAfterSeconds === 'number' ? Math.max(1, body.retryAfterSeconds) : 1;
    return { kind: 'pending', operationId: expectedOperationId, state: body.state, retryAfterSeconds };
  }
  if (httpStatus === 200 && isObject(body) && body.success === true && body.operationId === expectedOperationId && body.state === 'completed') {
    return { kind: 'completed', operationId: expectedOperationId, warnings: coerceWarnings(body) };
  }
  const retryAfterSeconds = isObject(body) && typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined;
  const error = isObject(body) && typeof body.error === 'string' ? body.error : undefined;
  return { kind: 'failed', status: httpStatus, error, retryAfterSeconds };
}
