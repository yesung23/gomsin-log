import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import { createAdminClientFetch, parseAdminSecretKey } from '../_shared/adminSecret.ts';
import { parseAllowedOrigins, resolveCors } from '../delete-account/_shared/cors.ts';
import {
  APPLE_NATIVE_CLIENT_ID,
  createAppleClientSecret,
  createAppleRemoteJwks,
  encryptRefreshToken,
  exchangeAuthorizationCode,
  extractVerifiedAppleSubject,
  loadAppleAuthCredentialConfig,
  revokeRefreshToken,
  sha256Hex,
  verifyAppleIdentityToken,
} from '../_shared/appleAuthCredentials.ts';
import { handleAppleAuthCredentialRegistration } from './handler.ts';

const appleJwks = createAppleRemoteJwks();

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(response.body, { status: response.status, headers: merged });
}

function errorResponse(
  error: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return withHeaders(new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  }), headers);
}

function record(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

Deno.serve(async (request) => {
  const cors = resolveCors(
    request.method,
    request.headers.get('Origin'),
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  );
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: cors.configured && cors.allowed ? 204 : 403, headers: cors.headers });
  }
  if (!cors.configured || !cors.allowed) {
    return errorResponse('E_ORIGIN_NOT_ALLOWED', 403, cors.headers);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const secret = parseAdminSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  let config;
  try {
    config = loadAppleAuthCredentialConfig((key) => Deno.env.get(key));
  } catch {
    return errorResponse('E_APPLE_NOT_CONFIGURED', 503, cors.headers);
  }
  if (!url || !secret) {
    return errorResponse('E_APPLE_NOT_CONFIGURED', 503, cors.headers);
  }

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createAdminClientFetch(url, secret) },
  });
  const response = await handleAppleAuthCredentialRegistration(request, {
    authenticate: async (bearer) => {
      const { data, error } = await admin.auth.getUser(bearer);
      const user = data.user;
      if (error || !user || user.app_metadata?.account_deletion_pending === true) return null;
      const appleSubject = extractVerifiedAppleSubject(user);
      return appleSubject ? { userId: user.id, appleSubject } : null;
    },
    digestCode: sha256Hex,
    beginRegistration: async ({ userId, appleSubject, attemptId, codeDigest }) => {
      const { data, error } = await admin.rpc('apple_auth_begin_registration', {
        p_user_id: userId,
        p_verified_subject: appleSubject,
        p_attempt_id: attemptId,
        p_code_digest: codeDigest,
      });
      const row = record(data);
      if (error || !row || typeof row.state !== 'string') {
        throw new Error('E_REGISTRATION_STATE_UNAVAILABLE');
      }
      if (
        (row.state === 'completed' || row.state === 'covered') && typeof row.generation === 'number' &&
        Number.isSafeInteger(row.generation) && row.generation > 0
        && typeof row.unresolved_exchange === 'boolean'
      ) {
        return {
          state: row.state,
          generation: row.generation,
          unresolvedExchange: row.unresolved_exchange,
        };
      }
      if (
        row.state === 'ready' && typeof row.claim_token === 'string' &&
        typeof row.token_id === 'string'
      ) {
        return {
          state: 'ready' as const,
          claimToken: row.claim_token,
          tokenId: row.token_id,
        };
      }
      if (['replay', 'deletion_pending', 'rate_limited', 'capacity_limited', 'busy', 'captured', 'identity_conflict'].includes(row.state)) {
        return { state: row.state as 'replay' | 'deletion_pending' | 'rate_limited' | 'capacity_limited' | 'busy' | 'captured' | 'identity_conflict' };
      }
      throw new Error('E_REGISTRATION_STATE_UNAVAILABLE');
    },
    exchangeCode: ({ authorizationCode, audience }) => exchangeAuthorizationCode({
      authorizationCode,
      audience,
      timeoutMs: 10_000,
      clientSecret: () => createAppleClientSecret(config, audience),
    }),
    verifyIdentityToken: (token, audience) => verifyAppleIdentityToken(
      token,
      audience,
      appleJwks,
    ),
    encryptRefreshToken: (input) => encryptRefreshToken({ config, ...input }),
    captureRegistration: async ({ userId, attemptId, claimToken, tokenId, encrypted }) => {
      const { data, error } = await admin.rpc('apple_auth_capture_registration', {
        p_user_id: userId,
        p_attempt_id: attemptId,
        p_claim_token: claimToken,
        p_token_id: tokenId,
        p_ciphertext_b64: encrypted.ciphertextB64,
        p_nonce_b64: encrypted.nonceB64,
        p_key_id: encrypted.keyId,
        p_crypto_version: encrypted.cryptoVersion,
      });
      const row = record(data);
      if (error || !row || !['captured', 'stale'].includes(String(row.state))) {
        throw new Error('E_CREDENTIAL_STORAGE_UNCERTAIN');
      }
      return { state: row.state as 'captured' | 'stale' };
    },
    preparePromotion: async ({ userId, attemptId, claimToken, tokenId, appleSubject }) => {
      const { data, error } = await admin.rpc('apple_auth_prepare_registration_promotion', {
        p_user_id: userId,
        p_attempt_id: attemptId,
        p_claim_token: claimToken,
        p_token_id: tokenId,
        p_verified_subject: appleSubject,
      });
      const row = record(data);
      if (error || !row || typeof row.state !== 'string') {
        throw new Error('E_CREDENTIAL_STORAGE_UNCERTAIN');
      }
      if (['prepared', 'completed'].includes(row.state) && typeof row.generation === 'number'
        && Number.isSafeInteger(row.generation) && row.generation > 0) {
        return { state: row.state as 'prepared' | 'completed', generation: row.generation };
      }
      if (['deletion_pending', 'stale', 'identity_conflict'].includes(row.state)) {
        return { state: row.state as 'deletion_pending' | 'stale' | 'identity_conflict' };
      }
      throw new Error('E_CREDENTIAL_STORAGE_UNCERTAIN');
    },
    promoteRegistration: async ({
      userId, attemptId, claimToken, tokenId, appleSubject, generation, encrypted,
    }) => {
      const { data, error } = await admin.rpc('apple_auth_promote_registration', {
        p_user_id: userId,
        p_attempt_id: attemptId,
        p_claim_token: claimToken,
        p_token_id: tokenId,
        p_verified_subject: appleSubject,
        p_generation: generation,
        p_ciphertext_b64: encrypted.ciphertextB64,
        p_nonce_b64: encrypted.nonceB64,
        p_key_id: encrypted.keyId,
        p_crypto_version: encrypted.cryptoVersion,
      });
      const row = record(data);
      if (error || !row || typeof row.state !== 'string') {
        throw new Error('E_CREDENTIAL_STORAGE_UNCERTAIN');
      }
      if (
        (row.state === 'registered' || row.state === 'completed') &&
        typeof row.generation === 'number' && Number.isSafeInteger(row.generation) &&
        row.generation > 0
      ) {
        return {
          state: row.state,
          generation: row.generation,
          unresolvedExchange: row.unresolved_exchange === true,
        };
      }
      if (['deletion_pending', 'stale', 'identity_conflict'].includes(row.state)) {
        return { state: row.state as 'deletion_pending' | 'stale' | 'identity_conflict' };
      }
      throw new Error('E_CREDENTIAL_STORAGE_UNCERTAIN');
    },
    failRegistration: async ({ userId, attemptId, claimToken, outcome, failureCode, tokenOutcome }) => {
      const { data, error } = await admin.rpc('apple_auth_fail_registration', {
        p_user_id: userId,
        p_attempt_id: attemptId,
        p_claim_token: claimToken,
        p_outcome: outcome,
        p_failure_code: failureCode,
        p_token_outcome: tokenOutcome,
      });
      if (error || data !== true) throw new Error('E_REGISTRATION_STATE_UNAVAILABLE');
    },
    revokeToken: (refreshToken) => revokeRefreshToken({
      refreshToken,
      audience: APPLE_NATIVE_CLIENT_ID,
      timeoutMs: 10_000,
      clientSecret: () => createAppleClientSecret(config, APPLE_NATIVE_CLIENT_ID),
    }),
  });
  return withHeaders(response, cors.headers);
});
