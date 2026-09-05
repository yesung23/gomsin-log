import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type CryptoKey as JoseCryptoKey,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from 'npm:jose@6.2.3';

export const APPLE_NATIVE_CLIENT_ID = 'app.gomsinlog';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const MAX_RESPONSE_BYTES = 65_536;
const MAX_REFRESH_TOKEN_BYTES = 4_096;
const MAX_ID_TOKEN_BYTES = 32_768;
const KEY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const APPLE_TEAM_OR_KEY_ID = /^[A-Za-z0-9]{10}$/;
const PROVIDER_IDENTIFIER = /^[a-z][a-z0-9_-]{0,63}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERIFIED_NON_APPLE_PROVIDERS = new Set(['email', 'google']);

export type AppleCredentialFailureOutcome =
  | 'rejected'
  | 'uncertain'
  | 'retryable'
  | 'configuration'
  | 'unrecoverable';

export class AppleCredentialError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: AppleCredentialFailureOutcome,
  ) {
    super(code);
    this.name = 'AppleCredentialError';
  }
}

export type AppleAuthCredentialConfig = {
  teamId: string;
  signingKeyId: string;
  privateKeyP8: string;
  activeCredentialKeyId: string;
  credentialKeys: ReadonlyMap<string, Uint8Array>;
};

type Env = (key: string) => string | undefined;
type Fetch = typeof fetch;

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('invalid base64');
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 8_192) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function parseCredentialKeys(raw: string | undefined): Map<string, Uint8Array> {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error('APPLE_AUTH_CREDENTIAL_KEYS is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('APPLE_AUTH_CREDENTIAL_KEYS is invalid');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 8) {
    throw new Error('APPLE_AUTH_CREDENTIAL_KEYS is invalid');
  }
  const keys = new Map<string, Uint8Array>();
  for (const [keyId, encoded] of entries) {
    if (!KEY_NAME.test(keyId) || typeof encoded !== 'string') {
      throw new Error('APPLE_AUTH_CREDENTIAL_KEYS is invalid');
    }
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(encoded);
    } catch {
      throw new Error('APPLE_AUTH_CREDENTIAL_KEYS is invalid');
    }
    if (bytes.byteLength !== 32) {
      throw new Error('APPLE_AUTH_CREDENTIAL_KEYS is invalid');
    }
    keys.set(keyId, bytes);
  }
  return keys;
}

export function loadAppleAuthCredentialConfig(env: Env): AppleAuthCredentialConfig {
  const teamId = env('APPLE_AUTH_TEAM_ID') ?? '';
  const signingKeyId = env('APPLE_AUTH_SIGNING_KEY_ID') ?? '';
  const privateKeyP8 = env('APPLE_AUTH_PRIVATE_KEY_P8') ?? '';
  const activeCredentialKeyId = env('APPLE_AUTH_CREDENTIAL_ACTIVE_KEY_ID') ?? '';
  if (
    !APPLE_TEAM_OR_KEY_ID.test(teamId) ||
    !APPLE_TEAM_OR_KEY_ID.test(signingKeyId) ||
    privateKeyP8.length > 20_000 ||
    !/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/.test(privateKeyP8) ||
    !KEY_NAME.test(activeCredentialKeyId)
  ) {
    throw new Error('Apple credential configuration is invalid');
  }
  const credentialKeys = parseCredentialKeys(env('APPLE_AUTH_CREDENTIAL_KEYS'));
  if (!credentialKeys.has(activeCredentialKeyId)) {
    throw new Error('Apple active credential key is unavailable');
  }
  return {
    teamId,
    signingKeyId,
    privateKeyP8,
    activeCredentialKeyId,
    credentialKeys,
  };
}

export function extractVerifiedAppleSubject(user: unknown): string | null {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
  const record = user as Record<string, unknown>;
  if (typeof record.id !== 'string' || !Array.isArray(record.identities)) return null;
  const subjects = new Set<string>();
  for (const value of record.identities) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const identity = value as Record<string, unknown>;
    const data = identity.identity_data;
    const subject = data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>).sub
      : null;
    if (
      identity.provider === 'apple' &&
      identity.user_id === record.id &&
      typeof subject === 'string' && subject.length >= 1 && subject.length <= 255
    ) {
      subjects.add(subject);
    }
  }
  return subjects.size === 1 ? [...subjects][0] : null;
}

export async function createAppleClientSecret(
  config: AppleAuthCredentialConfig,
  clientId: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string> {
  if (clientId !== APPLE_NATIVE_CLIENT_ID) {
    throw new AppleCredentialError('APPLE_CLIENT_CONFIGURATION', 'configuration');
  }
  let key: JoseCryptoKey;
  try {
    key = await importPKCS8(config.privateKeyP8, 'ES256');
  } catch {
    throw new AppleCredentialError('APPLE_CLIENT_CONFIGURATION', 'configuration');
  }
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.signingKeyId })
    .setIssuer(config.teamId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 300)
    .setAudience(APPLE_ISSUER)
    .setSubject(clientId)
    .sign(key);
}

export function createAppleRemoteJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(APPLE_JWKS_URL), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });
}

export async function verifyAppleIdentityToken(
  token: string,
  audience: string,
  key: JoseCryptoKey | JWTVerifyGetKey,
): Promise<{ subject: string }> {
  if (
    typeof token !== 'string' || token.length < 12 || token.length > MAX_ID_TOKEN_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new AppleCredentialError('TOKEN_SIGNATURE_INVALID', 'rejected');
  }
  try {
    const options: JWTVerifyOptions = {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience,
      clockTolerance: 5,
      requiredClaims: ['iat', 'exp', 'iss', 'aud', 'sub'],
    };
    const result = typeof key === 'function'
      ? await jwtVerify(token, key, options)
      : await jwtVerify(token, key, options);
    if (
      typeof result.payload.sub !== 'string' ||
      result.payload.sub.length < 1 || result.payload.sub.length > 255
    ) {
      throw new AppleCredentialError('TOKEN_SUBJECT_INVALID', 'rejected');
    }
    if (
      typeof result.payload.iat !== 'number' ||
      !Number.isSafeInteger(result.payload.iat) ||
      result.payload.iat > Math.floor(Date.now() / 1_000) + 5
    ) {
      throw new AppleCredentialError('TOKEN_ISSUED_AT_INVALID', 'rejected');
    }
    return { subject: result.payload.sub };
  } catch (error) {
    if (error instanceof AppleCredentialError) throw error;
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
    if (code === 'ERR_JWT_EXPIRED') {
      throw new AppleCredentialError('TOKEN_EXPIRED', 'rejected');
    }
    if (
      code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' &&
      error && typeof error === 'object' && 'claim' in error &&
      (error as { claim: unknown }).claim === 'aud'
    ) {
      throw new AppleCredentialError('TOKEN_AUDIENCE_INVALID', 'rejected');
    }
    throw new AppleCredentialError('TOKEN_SIGNATURE_INVALID', 'rejected');
  }
}

type RefreshTokenContext = {
  userId: string;
  audience: typeof APPLE_NATIVE_CLIENT_ID;
  attemptId: string;
  tokenId: string;
} & (
  | { aadKind: 'quarantine' }
  | { aadKind: 'verified'; appleSubject: string; generation: number }
);

function authenticatedContext(input: RefreshTokenContext & {
  keyId: string;
  cryptoVersion: number;
}): Uint8Array {
  const common = [
    input.aadKind === 'quarantine'
      ? 'gomsinlog.apple-refresh-token.quarantine'
      : 'gomsinlog.apple-refresh-token.verified',
    input.cryptoVersion,
    input.keyId,
    input.userId,
    input.audience,
    input.attemptId,
    input.tokenId,
  ];
  return new TextEncoder().encode(JSON.stringify(
    input.aadKind === 'verified'
      ? [...common, input.appleSubject, input.generation]
      : common,
  ));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

async function importAesKey(bytes: Uint8Array): Promise<globalThis.CryptoKey> {
  return await crypto.subtle.importKey('raw', arrayBuffer(bytes), { name: 'AES-GCM' }, false, [
    'encrypt', 'decrypt',
  ]);
}

export type EncryptedRefreshToken = {
  ciphertextB64: string;
  nonceB64: string;
  keyId: string;
  cryptoVersion: 1;
};

export async function encryptRefreshToken(
  input: RefreshTokenContext & {
    config: AppleAuthCredentialConfig;
    refreshToken: string;
  },
): Promise<EncryptedRefreshToken> {
  const plaintext = new TextEncoder().encode(input.refreshToken);
  if (plaintext.byteLength < 1 || plaintext.byteLength > MAX_REFRESH_TOKEN_BYTES) {
    throw new AppleCredentialError('TOKEN_RESPONSE_INVALID', 'uncertain');
  }
  const keyId = input.config.activeCredentialKeyId;
  const keyBytes = input.config.credentialKeys.get(keyId);
  if (!keyBytes) throw new AppleCredentialError('KEY_UNAVAILABLE', 'configuration');
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoVersion = 1 as const;
  const aad = authenticatedContext({ ...input, keyId, cryptoVersion });
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM', iv: arrayBuffer(nonce),
      additionalData: arrayBuffer(aad), tagLength: 128,
    },
    await importAesKey(keyBytes),
    arrayBuffer(plaintext),
  );
  return {
    ciphertextB64: encodeBase64(new Uint8Array(ciphertext)),
    nonceB64: encodeBase64(nonce),
    keyId,
    cryptoVersion,
  };
}

export async function decryptRefreshToken(
  input: RefreshTokenContext & {
    config: AppleAuthCredentialConfig;
    ciphertextB64: string;
    nonceB64: string;
    keyId: string;
    cryptoVersion: number;
  },
): Promise<string> {
  const keyBytes = input.config.credentialKeys.get(input.keyId);
  if (!keyBytes) throw new AppleCredentialError('KEY_UNAVAILABLE', 'configuration');
  if (input.cryptoVersion !== 1) {
    throw new AppleCredentialError('CREDENTIAL_UNRECOVERABLE', 'unrecoverable');
  }
  try {
    const nonce = decodeBase64(input.nonceB64);
    const ciphertext = decodeBase64(input.ciphertextB64);
    if (nonce.byteLength !== 12 || ciphertext.byteLength < 17 || ciphertext.byteLength > 8_192) {
      throw new Error('invalid encrypted credential');
    }
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM', iv: arrayBuffer(nonce),
        additionalData: arrayBuffer(authenticatedContext({ ...input, cryptoVersion: 1 })),
        tagLength: 128,
      },
      await importAesKey(keyBytes),
      arrayBuffer(ciphertext),
    );
    const token = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    if (token.length < 1 || new TextEncoder().encode(token).byteLength > MAX_REFRESH_TOKEN_BYTES) {
      throw new Error('invalid decrypted credential');
    }
    return token;
  } catch (error) {
    if (error instanceof AppleCredentialError) throw error;
    throw new AppleCredentialError('CREDENTIAL_UNRECOVERABLE', 'unrecoverable');
  }
}

type AppleResponseDeadline = {
  response: Response;
  signal: AbortSignal;
  close: () => void;
  timeoutCode: string;
  timeoutOutcome: AppleCredentialFailureOutcome;
};

async function readBoundedText(
  response: Response,
  deadline?: AppleResponseDeadline,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    let removeAbortListener = () => {};
    try {
      const read = reader.read();
      chunk = deadline
        ? await Promise.race([
          read,
          new Promise<never>((_resolve, reject) => {
            const abort = () => reject(new DOMException('aborted', 'AbortError'));
            if (deadline.signal.aborted) abort();
            else {
              deadline.signal.addEventListener('abort', abort, { once: true });
              removeAbortListener = () => deadline.signal.removeEventListener('abort', abort);
            }
          }),
        ])
        : await read;
    } catch (error) {
      if (deadline?.signal.aborted) {
        try { void reader.cancel().catch(() => {}); } catch { /* already aborted */ }
        throw new AppleCredentialError(deadline.timeoutCode, deadline.timeoutOutcome);
      }
      throw error;
    } finally {
      removeAbortListener();
    }
    const { value, done } = chunk;
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      try { void reader.cancel().catch(() => {}); } catch { /* stream already closed */ }
      throw new AppleCredentialError('EXCHANGE_NON_JSON', 'uncertain');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function postAppleForm(input: {
  url: string;
  form: URLSearchParams;
  timeoutMs: number;
  fetchImpl: Fetch;
  timeoutCode: string;
  networkOutcome: AppleCredentialFailureOutcome;
}): Promise<AppleResponseDeadline> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: input.form,
      signal: controller.signal,
    });
    return {
      response,
      signal: controller.signal,
      close: () => clearTimeout(timer),
      timeoutCode: input.timeoutCode,
      timeoutOutcome: input.networkOutcome,
    };
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new AppleCredentialError(input.timeoutCode, input.networkOutcome);
    }
    throw new AppleCredentialError(
      input.url === APPLE_TOKEN_URL ? 'EXCHANGE_NETWORK' : 'REVOKE_NETWORK',
      input.networkOutcome,
    );
  }
}

async function boundedErrorCode(
  response: Response,
  deadline: AppleResponseDeadline,
): Promise<string | null> {
  let text: string;
  try {
    text = await readBoundedText(response, deadline);
  } catch (error) {
    if (error instanceof AppleCredentialError) throw error;
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    const code = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).error
      : null;
    return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export async function exchangeAuthorizationCode(input: {
  authorizationCode: string;
  audience: string;
  timeoutMs: number;
  clientSecret: () => Promise<string>;
  fetchImpl?: Fetch;
}): Promise<{ refreshToken: string; idToken: string }> {
  const clientSecret = await input.clientSecret();
  const deadline = await postAppleForm({
    url: APPLE_TOKEN_URL,
    form: new URLSearchParams({
      client_id: input.audience,
      client_secret: clientSecret,
      code: input.authorizationCode,
      grant_type: 'authorization_code',
    }),
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl ?? fetch,
    timeoutCode: 'EXCHANGE_TIMEOUT',
    networkOutcome: 'uncertain',
  });
  const { response } = deadline;
  try {
    if (response.status === 400) {
      const code = await boundedErrorCode(response, deadline);
      if (code === 'invalid_grant') throw new AppleCredentialError('CODE_INVALID', 'rejected');
      throw new AppleCredentialError('APPLE_CLIENT_CONFIGURATION', 'configuration');
    }
    if (response.status === 429) {
      throw new AppleCredentialError('EXCHANGE_RATE_LIMITED', 'uncertain');
    }
    if (response.status >= 500) {
      throw new AppleCredentialError('EXCHANGE_SERVER', 'uncertain');
    }
    if (response.status !== 200) {
      throw new AppleCredentialError('EXCHANGE_REJECTED', 'uncertain');
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBoundedText(response, deadline));
    } catch (error) {
      if (error instanceof AppleCredentialError) throw error;
      throw new AppleCredentialError('EXCHANGE_NON_JSON', 'uncertain');
    }
    const record = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    if (
      typeof record.refresh_token !== 'string' || record.refresh_token.length < 1 ||
      new TextEncoder().encode(record.refresh_token).byteLength > MAX_REFRESH_TOKEN_BYTES ||
      typeof record.id_token !== 'string' || record.id_token.length < 12 ||
      record.id_token.length > MAX_ID_TOKEN_BYTES
    ) {
      throw new AppleCredentialError('TOKEN_RESPONSE_INVALID', 'uncertain');
    }
    return { refreshToken: record.refresh_token, idToken: record.id_token };
  } finally {
    deadline.close();
  }
}

export async function revokeRefreshToken(input: {
  refreshToken: string;
  audience: string;
  timeoutMs: number;
  clientSecret: () => Promise<string>;
  fetchImpl?: Fetch;
}): Promise<void> {
  const clientSecret = await input.clientSecret();
  const deadline = await postAppleForm({
    url: APPLE_REVOKE_URL,
    form: new URLSearchParams({
      client_id: input.audience,
      client_secret: clientSecret,
      token: input.refreshToken,
      token_type_hint: 'refresh_token',
    }),
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl ?? fetch,
    timeoutCode: 'REVOKE_TIMEOUT',
    networkOutcome: 'retryable',
  });
  const { response } = deadline;
  try {
    if (response.status === 200) return;
    if (response.status === 400) {
      const code = await boundedErrorCode(response, deadline);
      if (code === 'invalid_client') {
        throw new AppleCredentialError('APPLE_CLIENT_CONFIGURATION', 'configuration');
      }
      throw new AppleCredentialError('REVOKE_REJECTED', 'unrecoverable');
    }
    if (response.status === 429) {
      throw new AppleCredentialError('REVOKE_RATE_LIMITED', 'retryable');
    }
    if (response.status >= 500) {
      throw new AppleCredentialError('REVOKE_SERVER', 'retryable');
    }
    throw new AppleCredentialError('REVOKE_REJECTED', 'unrecoverable');
  } finally {
    deadline.close();
  }
}

type AppleCredentialRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

export type AppleDeletionRevocationResult =
  | { status: 'not_required' }
  | {
    status: 'manual_required';
    reason:
      | 'no_credential'
      | 'credential_unrecoverable'
      | 'exchange_uncertain'
      | 'provider_identity_unverified';
  }
  | {
    status: 'retry_required';
    reason: 'provider_unavailable' | 'configuration_recovery' | 'operator_review_required';
  }
  | { status: 'revoked' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type ProviderEvidence = 'apple' | 'verified_non_apple' | 'unknown';

function classifyProviderEvidence(user: unknown): ProviderEvidence {
  if (!isRecord(user) || typeof user.id !== 'string' || !isRecord(user.app_metadata)) return 'unknown';
  if (extractVerifiedAppleSubject(user) !== null) return 'apple';
  const metadata = user.app_metadata;
  const providers = metadata.providers;
  const identities = user.identities;
  if (!Array.isArray(providers) || providers.length === 0 || !Array.isArray(identities) || identities.length === 0) return 'unknown';
  if (!providers.every((provider) => typeof provider === 'string' && PROVIDER_IDENTIFIER.test(provider))) return 'unknown';
  if (!identities.every((identity) => isRecord(identity) && typeof identity.provider === 'string' && PROVIDER_IDENTIFIER.test(identity.provider) && identity.user_id === user.id)) return 'unknown';
  const identityProviders = identities.map((identity) => (identity as Record<string, unknown>).provider as string);
  if (providers.includes('apple') || identityProviders.includes('apple')) return 'apple';
  if (typeof metadata.provider !== 'string' || !PROVIDER_IDENTIFIER.test(metadata.provider)) return 'unknown';
  const providerSet = [...new Set(providers)].sort();
  const identityProviderSet = [...new Set(identityProviders)].sort();
  if (providerSet.length !== identityProviderSet.length || providerSet.some((provider, index) => provider !== identityProviderSet[index])) return 'unknown';
  if (!providerSet.includes(metadata.provider)) return 'unknown';
  if (!providerSet.every((provider) => VERIFIED_NON_APPLE_PROVIDERS.has(provider))) return 'unknown';
  return 'verified_non_apple';
}

async function settleDeletionRevocation(input: {
  admin: AppleCredentialRpcClient;
  userId: string;
  attemptId: string;
  deletionLifecycleId: string;
  tokenId: string;
  leaseToken: string;
  outcome: 'revoked' | 'retryable' | 'configuration' | 'manual_required';
  errorCode: string | null;
}): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await input.admin.rpc(
      'apple_auth_complete_deletion_revocation',
      {
        p_user_id: input.userId,
        p_attempt_id: input.attemptId,
        p_deletion_lifecycle_id: input.deletionLifecycleId,
        p_token_id: input.tokenId,
        p_lease_token: input.leaseToken,
        p_outcome: input.outcome,
        p_error_code: input.errorCode,
      },
    );
    if (error || !isRecord(data)) return null;
    const expected = input.outcome === 'manual_required' ? 'manual_required' : input.outcome;
    return data.state === expected ? data : null;
  } catch {
    return null;
  }
}

function manualResult(reason: unknown): AppleDeletionRevocationResult | null {
  if (reason === 'EXCHANGE_UNCERTAIN') {
    return { status: 'manual_required', reason: 'exchange_uncertain' };
  }
  if (reason === 'APPLE_PROVIDER_WITHOUT_TOKEN' || reason === 'PRE091_NO_TOKEN') {
    return { status: 'manual_required', reason: 'no_credential' };
  }
  if (reason === 'PROVIDER_IDENTITY_UNVERIFIED') {
    return { status: 'manual_required', reason: 'provider_identity_unverified' };
  }
  if (reason === 'TOKEN_MANUAL_REQUIRED' || reason === 'KEY_IRRECOVERABLY_LOST') {
    return { status: 'manual_required', reason: 'credential_unrecoverable' };
  }
  return null;
}

function terminalResult(value: Record<string, unknown>, prefix = ''): AppleDeletionRevocationResult | null {
  const state = value[`${prefix}state`];
  const reason = value[`${prefix}reason`];
  const provenance = value[`${prefix}provenance`];
  if (state === 'revoked' && reason === 'ALL_KNOWN_TOKENS_REVOKED' && provenance === 'provider_http_200') return { status: 'revoked' };
  if (state === 'not_required' && (
    (reason === 'VERIFIED_NO_APPLE_PROVIDER' && provenance === 'runtime_admin_identity') ||
    (reason === 'PRE091_NO_APPLE_PROVIDER' && provenance === 'operator_account_evidence')
  )) return { status: 'not_required' };
  if (state !== 'manual_required') return null;
  if (
    (reason === 'EXCHANGE_UNCERTAIN' && provenance === 'runtime_admin_identity') ||
    (reason === 'APPLE_PROVIDER_WITHOUT_TOKEN' && provenance === 'runtime_admin_identity') ||
    (reason === 'PROVIDER_IDENTITY_UNVERIFIED' && provenance === 'runtime_admin_identity') ||
    (reason === 'TOKEN_MANUAL_REQUIRED' && provenance === 'runtime_admin_identity') ||
    (reason === 'KEY_IRRECOVERABLY_LOST' && provenance === 'operator_token_evidence') ||
    (reason === 'PRE091_NO_TOKEN' && provenance === 'operator_account_evidence')
  ) return manualResult(reason);
  return null;
}

/**
 * Revoke the server-held Apple refresh token inside an exact deletion fence.
 *
 * `retry_required` is deliberately fail-closed: the caller must stop before
 * any E2EE or relational deletion. `manual_required` follows TN3194's fallback
 * for an Apple account whose usable server credential cannot be recovered;
 * deletion may continue, but the response must preserve that guidance state.
 */
export async function revokeAppleCredentialForDeletion(input: {
  admin: AppleCredentialRpcClient;
  user: unknown;
  attemptId: string;
  env: Env;
  fetchImpl?: Fetch;
  createClientSecret?: (
    config: AppleAuthCredentialConfig,
    audience: string,
  ) => Promise<string>;
}): Promise<AppleDeletionRevocationResult> {
  if (!isRecord(input.user) || typeof input.user.id !== 'string') {
    return { status: 'retry_required', reason: 'provider_unavailable' };
  }
  const userId = input.user.id;
  let deletionLifecycleId: string | null = null;
  for (let processed = 0; processed < 3; processed += 1) {
    let claim: unknown;
    try {
      const { data, error } = await input.admin.rpc(
        'apple_auth_claim_deletion_revocation',
        { p_user_id: userId, p_attempt_id: input.attemptId },
      );
      if (error) return { status: 'retry_required', reason: 'provider_unavailable' };
      claim = data;
    } catch {
      return { status: 'retry_required', reason: 'provider_unavailable' };
    }
    if (!isRecord(claim) || typeof claim.state !== 'string') {
      return { status: 'retry_required', reason: 'provider_unavailable' };
    }
    const claimLifecycleId = claim.deletion_lifecycle_id;
    if (typeof claimLifecycleId !== 'string' || !CANONICAL_UUID.test(claimLifecycleId)) {
      return { status: 'retry_required', reason: 'provider_unavailable' };
    }
    if (deletionLifecycleId !== null && deletionLifecycleId !== claimLifecycleId) {
      return { status: 'retry_required', reason: 'operator_review_required' };
    }
    deletionLifecycleId = claimLifecycleId;
    if (claim.state === 'revoked' || claim.state === 'not_required' || claim.state === 'manual_required') {
      return terminalResult(claim) ?? { status: 'retry_required', reason: 'operator_review_required' };
    }
    if (claim.state === 'operator_review_required') {
      return { status: 'retry_required', reason: 'operator_review_required' };
    }
    if (claim.state === 'none') {
      const providerEvidence = classifyProviderEvidence(input.user);
      const outcome = providerEvidence === 'verified_non_apple' ? 'not_required' : 'manual_required';
      const reason = providerEvidence === 'apple'
        ? 'APPLE_PROVIDER_WITHOUT_TOKEN'
        : providerEvidence === 'verified_non_apple' ? 'VERIFIED_NO_APPLE_PROVIDER' : 'PROVIDER_IDENTITY_UNVERIFIED';
      try {
        const { data, error } = await input.admin.rpc('apple_auth_finalize_deletion_no_token', {
          p_user_id: userId,
          p_attempt_id: input.attemptId,
          p_deletion_lifecycle_id: claimLifecycleId,
          p_outcome: outcome,
          p_reason: reason,
        });
        if (error || !isRecord(data)) {
          return { status: 'retry_required', reason: 'provider_unavailable' };
        }
        if (data.state === 'not_required' || data.state === 'manual_required') {
          return terminalResult(data) ?? { status: 'retry_required', reason: 'operator_review_required' };
        }
        if (data.state === 'operator_review_required') {
          return { status: 'retry_required', reason: 'operator_review_required' };
        }
      } catch {
        return { status: 'retry_required', reason: 'provider_unavailable' };
      }
      return { status: 'retry_required', reason: 'provider_unavailable' };
    }
    if (claim.state === 'busy') {
      return { status: 'retry_required', reason: 'provider_unavailable' };
    }
    if (
      claim.state !== 'claimed' || typeof claim.token_id !== 'string' ||
      typeof claim.lease_token !== 'string' ||
      (claim.aad_kind !== 'quarantine' && claim.aad_kind !== 'verified') ||
      claim.audience !== APPLE_NATIVE_CLIENT_ID ||
      typeof claim.registration_attempt_id !== 'string' ||
      typeof claim.ciphertext_b64 !== 'string' || typeof claim.nonce_b64 !== 'string' ||
      typeof claim.key_id !== 'string' || claim.crypto_version !== 1 ||
      (claim.aad_kind === 'verified' && (
        typeof claim.verified_subject !== 'string' ||
        typeof claim.generation !== 'number' || !Number.isSafeInteger(claim.generation) ||
        claim.generation <= 0
      ))
    ) {
      return { status: 'retry_required', reason: 'provider_unavailable' };
    }

    const settle = async (
      outcome: 'revoked' | 'retryable' | 'configuration' | 'manual_required',
      errorCode: string | null,
    ) => await settleDeletionRevocation({
      admin: input.admin,
      userId,
      attemptId: input.attemptId,
      deletionLifecycleId: claimLifecycleId,
      tokenId: claim.token_id as string,
      leaseToken: claim.lease_token as string,
      outcome,
      errorCode,
    });

    let config: AppleAuthCredentialConfig;
    try {
      config = loadAppleAuthCredentialConfig(input.env);
    } catch {
      return await settle('configuration', 'APPLE_CLIENT_CONFIGURATION')
        ? { status: 'retry_required', reason: 'configuration_recovery' }
        : { status: 'retry_required', reason: 'provider_unavailable' };
    }

    let refreshToken: string;
    try {
      const common = {
        config,
        userId,
        audience: APPLE_NATIVE_CLIENT_ID as typeof APPLE_NATIVE_CLIENT_ID,
        attemptId: claim.registration_attempt_id,
        tokenId: claim.token_id,
        ciphertextB64: claim.ciphertext_b64,
        nonceB64: claim.nonce_b64,
        keyId: claim.key_id,
        cryptoVersion: claim.crypto_version,
      };
      refreshToken = claim.aad_kind === 'verified'
        ? await decryptRefreshToken({
          ...common,
          aadKind: 'verified',
          appleSubject: claim.verified_subject as string,
          generation: claim.generation as number,
        })
        : await decryptRefreshToken({ ...common, aadKind: 'quarantine' });
    } catch (error) {
      if (error instanceof AppleCredentialError && error.code === 'CREDENTIAL_UNRECOVERABLE') {
        const settled = await settle('manual_required', error.code);
        if (!settled) return { status: 'retry_required', reason: 'provider_unavailable' };
        if (settled.all_settled === true) {
          return terminalResult(settled, 'terminal_') ?? { status: 'retry_required', reason: 'operator_review_required' };
        }
        continue;
      }
      return await settle(
          'configuration',
          error instanceof AppleCredentialError ? error.code : 'KEY_UNAVAILABLE',
        )
        ? { status: 'retry_required', reason: 'configuration_recovery' }
        : { status: 'retry_required', reason: 'provider_unavailable' };
    }

    try {
      await revokeRefreshToken({
        refreshToken,
        audience: APPLE_NATIVE_CLIENT_ID,
        timeoutMs: 10_000,
        clientSecret: () => input.createClientSecret
          ? input.createClientSecret(config, APPLE_NATIVE_CLIENT_ID)
          : createAppleClientSecret(config, APPLE_NATIVE_CLIENT_ID),
        fetchImpl: input.fetchImpl,
      });
      const settled = await settle('revoked', null);
      if (!settled) return { status: 'retry_required', reason: 'provider_unavailable' };
      if (settled.all_settled === true) {
        return terminalResult(settled, 'terminal_') ?? { status: 'retry_required', reason: 'operator_review_required' };
      }
    } catch (error) {
      const failure = error instanceof AppleCredentialError
        ? error
        : new AppleCredentialError('REVOKE_NETWORK', 'retryable');
      const outcome = failure.outcome === 'unrecoverable'
        ? 'manual_required'
        : failure.outcome === 'configuration' ? 'configuration' : 'retryable';
      const settled = await settle(outcome, failure.code);
      if (!settled) return { status: 'retry_required', reason: 'provider_unavailable' };
      if (outcome === 'configuration') {
        return { status: 'retry_required', reason: 'configuration_recovery' };
      }
      if (outcome === 'retryable') {
        return { status: 'retry_required', reason: 'provider_unavailable' };
      }
      if (settled.all_settled === true) {
        return terminalResult(settled, 'terminal_') ?? { status: 'retry_required', reason: 'operator_review_required' };
      }
    }
  }
  return { status: 'retry_required', reason: 'provider_unavailable' };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
