import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleVerifyRecovery } from './handler.ts';
import { decodePgBytea } from '../_shared/e2eeVerify.ts';
import { parseAllowedOrigins, resolveCors } from '../delete-account/_shared/cors.ts';

const DB_READ_FAILURE = 'E_DB_READ_FAILED';
const failClosedRead = (): never => { throw new Error(DB_READ_FAILURE); };

/**
 * Thin Deno entrypoint. All decisions live in `handler.ts` so they are covered
 * by the vitest suite; this file only injects the platform pieces.
 *
 * Binary values go through the shared codec and nowhere else. An earlier
 * revision read the deployment identity with `atob(...)`, which base64-decoded a
 * `bytea` hex string and produced garbage that would have failed every origin
 * comparison for an untraceable reason.
 *
 * DENO RUNTIME: UNEXECUTED. No Deno toolchain is available in this environment.
 */
Deno.serve(async (request) => {
  // The helper takes (method, origin, allowlist) and the allowlist is a parsed
  // array, not the raw env string. An earlier revision called it as
  // resolveCors(origin, env), which type-checks under `any` and silently
  // evaluated the wrong arguments.
  const cors = resolveCors(
    request.method,
    request.headers.get('Origin'),
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  );
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
  }
  if (!cors.configured || !cors.allowed) {
    return new Response(JSON.stringify({ error: 'E_ORIGIN_NOT_ALLOWED' }), { status: 403, headers: cors.headers });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: caller } = await admin.auth.getUser(authorization.replace('Bearer ', ''));
  if (!caller?.user) {
    return new Response(JSON.stringify({ error: 'E_UNAUTHENTICATED' }), { status: 401, headers: cors.headers });
  }

  const body = await request.json().catch(() => ({}));
  let outcome;
  try {
    outcome = await handleVerifyRecovery(body, caller.user.id, {
    now: () => Date.now(),
    getServerOriginId: async () => {
      const { data, error } = await admin.from('crypto_deployment').select('server_origin_id').maybeSingle();
      if (error) failClosedRead();
      if (!data?.server_origin_id) return null;
      // `bytea`, so the hex codec. Not base64.
      return decodePgBytea(data.server_origin_id);
    },
    // By stable uuid, never by the challenge bytes. The nonce is a secret bound
    // into the signature; making it the row address would turn a guessed value
    // into a database lookup and force a bytea comparison against caller text.
    getChallenge: async (id) => {
      const { data, error } = await admin.from('recovery_challenges')
        .select('id,user_id,recovery_identity_id,challenge_nonce,recovery_version,new_device_id,issued_at,expires_at,consumed_at')
        .eq('id', id).maybeSingle();
      if (error) failClosedRead();
      return data ?? null;
    },
    getCurrentRecoveryIdentity: async (userId) => {
      const { data, error } = await admin.from('recovery_identities')
        .select('id,recovery_version,rec_sig_spki,superseded_at')
        .eq('user_id', userId).is('superseded_at', null).maybeSingle();
      if (error) failClosedRead();
      return data ?? null;
    },
    getDevice: async (id) => {
      const { data, error } = await admin.from('devices').select('id,user_id,sig_spki,kem_spki,status').eq('id', id).maybeSingle();
      if (error) failClosedRead();
      return data ?? null;
    },
    countRecentAttempts: async (userId) => {
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const { count, error } = await admin.from('recovery_challenges')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('issued_at', since);
      if (error) failClosedRead();
      return count ?? 0;
    },
    commitAuthentication: async ({ challengeId, deviceId, recoveryIdentityId, recoveryVersion }) => {
      // One transaction. Consuming the challenge and moving the device must
      // succeed or fail together: a failure between them would burn a valid
      // single-use credential and leave the device unable to retry.
      const { error } = await admin.rpc('e2ee_commit_recovery_authentication', {
        p_challenge_id: challengeId,
        p_device_id: deviceId,
        // Re-checked inside the transaction, under the row lock, so a rotation
        // cannot interleave between this handler's check and the commit.
        p_recovery_identity_id: recoveryIdentityId,
        p_recovery_version: recoveryVersion,
      });
      if (error) {
        return {
          ok: false,
          code: error.message.includes('ALREADY_USED')
            ? 'E_CHALLENGE_ALREADY_USED'
            : error.message.includes('IDENTITY_MISMATCH') || error.message.includes('SUPERSEDED')
              ? 'E_RECOVERY_IDENTITY_MISMATCH'
              : 'E_COMMIT_FAILED',
        };
      }
      return { ok: true };
    },
    // IDs and error codes only. Never key material, never a recovery code.
    logEvent: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === DB_READ_FAILURE) {
      return new Response(JSON.stringify({ error: DB_READ_FAILURE }), {
        status: 503,
        headers: { ...cors.headers, 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { ...cors.headers, 'Content-Type': 'application/json' },
  });
});
