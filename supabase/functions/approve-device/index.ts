import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleApproveDevice } from './handler.ts';
import { parseAllowedOrigins, resolveCors } from '../delete-account/_shared/cors.ts';

/**
 * Thin Deno entrypoint. All decisions live in `handler.ts` so they are covered
 * by the vitest suite; this file only injects the platform pieces.
 */
/** Postgres bytea hex literal. */
function toPgBytea(bytes: Uint8Array): string {
  let out = '\\x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

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
  const outcome = await handleApproveDevice(body, caller.user.id, {
    now: () => Date.now(),
    getServerOriginId: async () => {
      const { data } = await admin.from('crypto_deployment').select('server_origin_id').maybeSingle();
      if (!data?.server_origin_id) return null;
      return Uint8Array.from(atob(String(data.server_origin_id).replace(/^\\x/, '')), (c) => c.charCodeAt(0));
    },
    getEnrollmentByNonce: async (nonce) => {
      const { data } = await admin.from('device_enrollments').select('*').eq('enroll_nonce', nonce).maybeSingle();
      return data ?? null;
    },
    getDevice: async (id) => {
      const { data } = await admin.from('devices').select('id,user_id,sig_spki,kem_spki,status').eq('id', id).maybeSingle();
      return data ?? null;
    },
    getRecoveryAnchor: async (userId) => {
      const { data } = await admin.from('recovery_identities')
        .select('id,recovery_version,rec_sig_spki,recovery_bundle_fp')
        .eq('user_id', userId).is('superseded_at', null).maybeSingle();
      return data ?? null;
    },
    getDeviceCertificate: async (deviceId) => {
      // The handler verifies these bytes; it never trusts a grant mask read
      // out of them by this adapter.
      const { data } = await admin.from('device_certificates')
        .select('certificate').eq('subject_device_id', deviceId).maybeSingle();
      return data?.certificate ? { certificate: String(data.certificate) } : null;
    },
    commitApproval: async (input) => {
      // One transaction: consume the nonce, persist the certificate, then move
      // the operational status. Never the three as separate best-effort steps.
      const { error } = await admin.rpc('e2ee_commit_device_approval', {
        p_enrollment_id: input.enrollmentId,
        p_new_device_id: input.newDeviceId,
        p_certificate: toPgBytea(input.certificate),
        p_certificate_fp: toPgBytea(input.certificateFp),
        p_transcript_hash: toPgBytea(input.transcriptHash),
        p_approval_signature: toPgBytea(input.approvalSignature),
        p_user_id: input.userId,
        p_recovery_identity_id: input.recoveryIdentityId,
        p_recovery_version: input.recoveryVersion,
        p_subject_sig_spki: toPgBytea(input.subjectSigSpki),
        p_subject_kem_spki: toPgBytea(input.subjectKemSpki),
      });
      if (error) return { ok: false, code: error.message.includes('ALREADY_USED') ? 'E_NONCE_ALREADY_USED' : 'E_COMMIT_FAILED' };
      return { ok: true };
    },
    // IDs and error codes only. Never key material, never user content.
    logEvent: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
  });

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { ...cors.headers, 'Content-Type': 'application/json' },
  });
});
