import {
  APPLE_NATIVE_CLIENT_ID,
  AppleCredentialError,
  type EncryptedRefreshToken,
} from '../_shared/appleAuthCredentials.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 8_192;
const MAX_AUTHORIZATION_CODE_BYTES = 4_096;

type BeginRegistration =
  | { state: 'ready'; claimToken: string; tokenId: string }
  | { state: 'covered' | 'completed'; generation: number; unresolvedExchange: boolean }
  | { state: 'replay' | 'deletion_pending' | 'rate_limited' | 'capacity_limited' | 'busy' | 'captured' | 'identity_conflict' };
type CaptureRegistration = { state: 'captured' | 'stale' };
type PreparePromotion =
  | { state: 'prepared' | 'completed'; generation: number }
  | { state: 'deletion_pending' | 'stale' | 'identity_conflict' };
type PromoteRegistration =
  | { state: 'registered' | 'completed'; generation: number; unresolvedExchange?: boolean }
  | { state: 'deletion_pending' | 'stale' | 'identity_conflict' };

type EncryptionInput = {
  userId: string;
  audience: typeof APPLE_NATIVE_CLIENT_ID;
  attemptId: string;
  tokenId: string;
  refreshToken: string;
} & (
  | { aadKind: 'quarantine' }
  | { aadKind: 'verified'; appleSubject: string; generation: number }
);

export type AppleRegistrationDeps = {
  authenticate: (bearer: string) => Promise<{ userId: string; appleSubject: string } | null>;
  digestCode: (authorizationCode: string) => Promise<string>;
  beginRegistration: (input: {
    userId: string; appleSubject: string; attemptId: string; codeDigest: string;
  }) => Promise<BeginRegistration>;
  exchangeCode: (input: { authorizationCode: string; audience: typeof APPLE_NATIVE_CLIENT_ID }) => Promise<{ idToken: string; refreshToken: string }>;
  verifyIdentityToken: (idToken: string, audience: typeof APPLE_NATIVE_CLIENT_ID) => Promise<{ subject: string }>;
  encryptRefreshToken: (input: EncryptionInput) => Promise<EncryptedRefreshToken>;
  captureRegistration: (input: {
    userId: string; attemptId: string; claimToken: string; tokenId: string; encrypted: EncryptedRefreshToken;
  }) => Promise<CaptureRegistration>;
  preparePromotion: (input: {
    userId: string; attemptId: string; claimToken: string; tokenId: string; appleSubject: string;
  }) => Promise<PreparePromotion>;
  promoteRegistration: (input: {
    userId: string; attemptId: string; claimToken: string; tokenId: string;
    appleSubject: string; generation: number; encrypted: EncryptedRefreshToken;
  }) => Promise<PromoteRegistration>;
  failRegistration: (input: {
    userId: string; attemptId: string; claimToken: string;
    outcome: 'rejected' | 'uncertain'; failureCode: string;
    tokenOutcome: 'revoked' | 'retryable' | null;
  }) => Promise<void>;
  revokeToken: (refreshToken: string) => Promise<void>;
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  return token.length > 0 && token.length <= 8_192 ? token : null;
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
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

function validRegistrationBody(value: unknown): value is {
  attemptId: string;
  authorizationCode: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['attemptId', 'authorizationCode'])) {
    return false;
  }
  return typeof record.attemptId === 'string' && UUID.test(record.attemptId) &&
    typeof record.authorizationCode === 'string' && record.authorizationCode.length >= 1 &&
    new TextEncoder().encode(record.authorizationCode).byteLength <= MAX_AUTHORIZATION_CODE_BYTES &&
    ![...record.authorizationCode].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
}

async function twice<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    return await operation();
  }
}

async function revokeOutcome(
  deps: AppleRegistrationDeps,
  refreshToken: string,
): Promise<'revoked' | 'retryable'> {
  try {
    await deps.revokeToken(refreshToken);
    return 'revoked';
  } catch {
    return 'retryable';
  }
}

async function recordFailure(
  deps: AppleRegistrationDeps,
  input: Parameters<AppleRegistrationDeps['failRegistration']>[0],
): Promise<boolean> {
  try {
    await twice(() => deps.failRegistration(input));
    return true;
  } catch {
    return false;
  }
}

function exchangeFailure(error: AppleCredentialError): {
  status: number;
  body: Record<string, unknown>;
  outcome: 'rejected' | 'uncertain';
} {
  if (error.code === 'CODE_INVALID') {
    return {
      status: 409,
      body: { error: 'E_APPLE_CODE_INVALID', reauthorizationRequired: true },
      outcome: 'rejected',
    };
  }
  if (error.code === 'TOKEN_RESPONSE_INVALID') {
    return {
      status: 502,
      body: { error: 'E_APPLE_TOKEN_RESPONSE_INVALID', reauthorizationRequired: true },
      outcome: 'uncertain',
    };
  }
  if (error.outcome === 'configuration') {
    return { status: 503, body: { error: 'E_APPLE_NOT_CONFIGURED' }, outcome: 'uncertain' };
  }
  return {
    status: 503,
    body: { error: 'E_APPLE_EXCHANGE_UNCERTAIN', reauthorizationRequired: true },
    outcome: 'uncertain',
  };
}

async function settleObtainedTokenFailure(input: {
  deps: AppleRegistrationDeps;
  userId: string;
  attemptId: string;
  claimToken: string;
  refreshToken: string;
  failureCode: string;
  captureProven: boolean;
}): Promise<boolean> {
  const tokenOutcome = await revokeOutcome(input.deps, input.refreshToken);
  return await recordFailure(input.deps, {
    userId: input.userId,
    attemptId: input.attemptId,
    claimToken: input.claimToken,
    outcome: !input.captureProven && tokenOutcome === 'retryable' ? 'uncertain' : 'rejected',
    failureCode: input.failureCode,
    tokenOutcome,
  });
}

export async function handleAppleAuthCredentialRegistration(
  request: Request,
  deps: AppleRegistrationDeps,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'E_METHOD_NOT_ALLOWED' }, 405);
  const bearer = bearerToken(request);
  if (!bearer) return json({ error: 'E_UNAUTHENTICATED' }, 401);
  const identity = await deps.authenticate(bearer).catch(() => null);
  if (!identity) return json({ error: 'E_UNAUTHENTICATED' }, 401);
  const body = await readBoundedJson(request);
  if (!validRegistrationBody(body)) return json({ error: 'E_BAD_REQUEST' }, 400);

  let begun: BeginRegistration;
  try {
    begun = await deps.beginRegistration({
      userId: identity.userId,
      appleSubject: identity.appleSubject,
      attemptId: body.attemptId,
      codeDigest: await deps.digestCode(body.authorizationCode),
    });
  } catch {
    return json({ error: 'E_REGISTRATION_STATE_UNAVAILABLE' }, 503);
  }
  if (begun.state === 'covered' || begun.state === 'completed') {
    return json({
      registered: true,
      duplicate: true,
      generation: begun.generation,
      unresolvedExchange: begun.unresolvedExchange,
    }, 200);
  }
  const beginFailures: Record<string, [number, string]> = {
    replay: [409, 'E_APPLE_CODE_REPLAYED'],
    deletion_pending: [409, 'E_ACCOUNT_DELETION_PENDING'],
    rate_limited: [429, 'E_RATE_LIMITED'],
    capacity_limited: [429, 'E_CREDENTIAL_CAPACITY'],
    busy: [409, 'E_REGISTRATION_IN_PROGRESS'],
    captured: [409, 'E_REGISTRATION_RECONCILIATION_REQUIRED'],
    identity_conflict: [409, 'E_APPLE_IDENTITY_CONFLICT'],
  };
  if (begun.state !== 'ready') {
    const [status, error] = beginFailures[begun.state];
    return json({ error }, status);
  }

  let exchanged: { idToken: string; refreshToken: string };
  try {
    exchanged = await deps.exchangeCode({
      authorizationCode: body.authorizationCode,
      audience: APPLE_NATIVE_CLIENT_ID,
    });
  } catch (error) {
    const bounded = error instanceof AppleCredentialError
      ? error
      : new AppleCredentialError('EXCHANGE_UNKNOWN', 'uncertain');
    const failure = exchangeFailure(bounded);
    const recorded = await recordFailure(deps, {
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      outcome: failure.outcome,
      failureCode: bounded.code,
      tokenOutcome: null,
    });
    return recorded ? json(failure.body, failure.status) : json({ error: 'E_REGISTRATION_STATE_UNAVAILABLE' }, 503);
  }

  let quarantine: EncryptedRefreshToken;
  try {
    quarantine = await deps.encryptRefreshToken({
      aadKind: 'quarantine',
      userId: identity.userId,
      audience: APPLE_NATIVE_CLIENT_ID,
      attemptId: body.attemptId,
      tokenId: begun.tokenId,
      refreshToken: exchanged.refreshToken,
    });
  } catch {
    const recorded = await settleObtainedTokenFailure({
      deps,
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      refreshToken: exchanged.refreshToken,
      failureCode: 'QUARANTINE_ENCRYPTION_FAILED',
      captureProven: false,
    });
    return recorded
      ? json({ error: 'E_CREDENTIAL_STORAGE_UNCERTAIN', reauthorizationRequired: true }, 503)
      : json({ error: 'E_REGISTRATION_STATE_UNAVAILABLE' }, 503);
  }

  let captured = false;
  try {
    captured = (await twice(() => deps.captureRegistration({
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      tokenId: begun.tokenId,
      encrypted: quarantine,
    }))).state === 'captured';
  } catch {
    captured = false;
  }
  if (!captured) {
    const recorded = await settleObtainedTokenFailure({
      deps,
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      refreshToken: exchanged.refreshToken,
      failureCode: 'QUARANTINE_CAPTURE_UNPROVEN',
      captureProven: false,
    });
    return recorded
      ? json({ error: 'E_CREDENTIAL_STORAGE_UNCERTAIN', reauthorizationRequired: true }, 503)
      : json({ error: 'E_REGISTRATION_STATE_UNAVAILABLE' }, 503);
  }

  let verifiedSubject: string;
  try {
    verifiedSubject = (await deps.verifyIdentityToken(
      exchanged.idToken,
      APPLE_NATIVE_CLIENT_ID,
    )).subject;
  } catch (error) {
    const bounded = error instanceof AppleCredentialError
      ? error
      : new AppleCredentialError('TOKEN_SIGNATURE_INVALID', 'rejected');
    const recorded = await settleObtainedTokenFailure({
      deps,
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      refreshToken: exchanged.refreshToken,
      failureCode: bounded.code,
      captureProven: true,
    });
    return recorded
      ? json({ error: 'E_APPLE_ID_TOKEN_INVALID' }, 400)
      : json({ error: 'E_REGISTRATION_STATE_UNAVAILABLE' }, 503);
  }
  if (verifiedSubject !== identity.appleSubject) {
    const recorded = await settleObtainedTokenFailure({
      deps,
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      refreshToken: exchanged.refreshToken,
      failureCode: 'IDENTITY_MISMATCH',
      captureProven: true,
    });
    return recorded
      ? json({ error: 'E_APPLE_IDENTITY_MISMATCH' }, 409)
      : json({ error: 'E_REGISTRATION_STATE_UNAVAILABLE' }, 503);
  }

  let prepared: PreparePromotion;
  try {
    prepared = await twice(() => deps.preparePromotion({
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      tokenId: begun.tokenId,
      appleSubject: verifiedSubject,
    }));
  } catch {
    return json({ error: 'E_CREDENTIAL_STORAGE_UNCERTAIN', reauthorizationRequired: true }, 503);
  }
  if (prepared.state !== 'prepared' && prepared.state !== 'completed') {
    await settleObtainedTokenFailure({
      deps,
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      refreshToken: exchanged.refreshToken,
      failureCode: prepared.state === 'identity_conflict' ? 'IDENTITY_CONFLICT' : 'PROMOTION_REFUSED',
      captureProven: true,
    });
    if (prepared.state === 'identity_conflict') return json({ error: 'E_APPLE_IDENTITY_CONFLICT' }, 409);
    if (prepared.state === 'deletion_pending') return json({ error: 'E_ACCOUNT_DELETION_PENDING' }, 409);
    return json({ error: 'E_CREDENTIAL_STORAGE_UNCERTAIN', reauthorizationRequired: true }, 503);
  }
  if (prepared.state === 'completed') {
    return json({ registered: true, duplicate: true, generation: prepared.generation }, 200);
  }

  let verifiedCiphertext: EncryptedRefreshToken;
  try {
    verifiedCiphertext = await deps.encryptRefreshToken({
      aadKind: 'verified',
      userId: identity.userId,
      appleSubject: verifiedSubject,
      generation: prepared.generation,
      audience: APPLE_NATIVE_CLIENT_ID,
      attemptId: body.attemptId,
      tokenId: begun.tokenId,
      refreshToken: exchanged.refreshToken,
    });
  } catch {
    await settleObtainedTokenFailure({
      deps,
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      refreshToken: exchanged.refreshToken,
      failureCode: 'VERIFIED_ENCRYPTION_FAILED',
      captureProven: true,
    });
    return json({ error: 'E_CREDENTIAL_STORAGE_UNCERTAIN', reauthorizationRequired: true }, 503);
  }

  let promoted: PromoteRegistration;
  try {
    promoted = await twice(() => deps.promoteRegistration({
      userId: identity.userId,
      attemptId: body.attemptId,
      claimToken: begun.claimToken,
      tokenId: begun.tokenId,
      appleSubject: verifiedSubject,
      generation: prepared.generation,
      encrypted: verifiedCiphertext,
    }));
  } catch {
    return json({ error: 'E_CREDENTIAL_STORAGE_UNCERTAIN', reauthorizationRequired: true }, 503);
  }
  if (promoted.state === 'registered' || promoted.state === 'completed') {
    return json({
      registered: true,
      duplicate: promoted.state === 'completed',
      generation: promoted.generation,
      unresolvedExchange: promoted.unresolvedExchange ?? false,
    }, 200);
  }
  if (promoted.state === 'deletion_pending') return json({ error: 'E_ACCOUNT_DELETION_PENDING' }, 409);
  if (promoted.state === 'identity_conflict') return json({ error: 'E_APPLE_IDENTITY_CONFLICT' }, 409);
  return json({ error: 'E_CREDENTIAL_STORAGE_UNCERTAIN', reauthorizationRequired: true }, 503);
}
