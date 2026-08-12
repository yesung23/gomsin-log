import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleIssueRecoveryChallenge, type IssuedChallengeRow } from './handler.ts';
import { encodePgBytea } from '../_shared/e2eeVerify.ts';
import { parseAllowedOrigins, resolveCors } from '../delete-account/_shared/cors.ts';

/**
 * Thin Deno entrypoint. All decisions live in `handler.ts` so they are covered
 * by the vitest suite; this file only injects the platform pieces.
 *
 * DENO RUNTIME: UNEXECUTED. No Deno toolchain is available in this environment,
 * so this file has never been type-checked or run by `deno`. The handler it
 * wraps is fully covered under vitest. Production activation stays blocked.
 */
Deno.serve(async (request) => {
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
  const outcome = await handleIssueRecoveryChallenge(body, caller.user.id, {
    now: () => Date.now(),
    // The only randomness on this path, and it is server-side. A client-chosen
    // challenge would make a captured signature replayable forever.
    randomChallenge: () => crypto.getRandomValues(new Uint8Array(32)),
    getDevice: async (id) => {
      const { data } = await admin.from('devices').select('id,user_id,status').eq('id', id).maybeSingle();
      return data ?? null;
    },
    getCurrentRecoveryIdentity: async (userId) => {
      const { data } = await admin.from('recovery_identities')
        .select('id,user_id,recovery_version,superseded_at')
        .eq('user_id', userId).is('superseded_at', null).maybeSingle();
      return data ?? null;
    },
    countIssuedLastHour: async (userId) => {
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const { count } = await admin.from('recovery_challenges')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('issued_at', since);
      return count ?? 0;
    },
    issue: async ({ userId, deviceId, challenge, ttlSeconds }) => {
      // One narrow RPC. It re-checks ownership, device state and identity
      // liveness under a row lock, so the handler's checks above are the
      // readable rejection and this is the one that cannot be raced.
      const { data, error } = await admin.rpc('e2ee_issue_recovery_challenge', {
        p_user_id: userId,
        p_device_id: deviceId,
        // `bytea` parameter: hex literal, never base64.
        p_challenge: encodePgBytea(challenge),
        p_ttl_seconds: ttlSeconds,
      });
      if (error) {
        const message = error.message ?? '';
        const code = message.includes('E2EE_DEVICE_NOT_PENDING') ? 'E_DEVICE_NOT_PENDING'
          : message.includes('E2EE_DEVICE_WRONG_ACCOUNT') ? 'E_WRONG_ACCOUNT'
            : message.includes('E2EE_NO_RECOVERY_IDENTITY') ? 'E_NO_RECOVERY_IDENTITY'
              : message.includes('E2EE_UNKNOWN_DEVICE') ? 'E_UNKNOWN_DEVICE'
                : 'E_ISSUE_FAILED';
        return { ok: false, code };
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { ok: false, code: 'E_ISSUE_FAILED' };
      return { ok: true, row: row as IssuedChallengeRow };
    },
    // IDs and error codes only. NEVER the challenge bytes: a logged challenge
    // is a live credential sitting in a log aggregator.
    logEvent: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
  });

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { ...cors.headers, 'Content-Type': 'application/json' },
  });
});
