import { createClient } from 'npm:@supabase/supabase-js@2';
import { MAX_CHAIN_DEPTH, handleApproveDevice, type CertificateRow } from './handler.ts';
import { decodePgBytea, encodePgBytea } from '../_shared/e2eeVerify.ts';
import { parseAllowedOrigins, resolveCors } from '../delete-account/_shared/cors.ts';

/**
 * Thin Deno entrypoint. All decisions live in `handler.ts` so they are covered
 * by the vitest suite; this file only injects the platform pieces.
 *
 * Binary values go through the shared codec in `_shared/e2eeVerify.ts` and
 * nowhere else. An earlier revision of this file base64-decoded a `bytea`
 * column — `atob(String(server_origin_id).replace(/^\\x/, ''))` — which turned
 * the deployment identity into 16 bytes of nonsense and would have failed every
 * certificate origin check for a reason nobody could have traced from the error.
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

  const CERTIFICATE_COLUMNS = 'id,subject_device_id,issuer_certificate_id,certificate,subject_sig_spki,subject_kem_spki';

  const body = await request.json().catch(() => ({}));
  const outcome = await handleApproveDevice(body, caller.user.id, {
    now: () => Date.now(),
    getServerOriginId: async () => {
      const { data } = await admin.from('crypto_deployment').select('server_origin_id').maybeSingle();
      if (!data?.server_origin_id) return null;
      // `bytea`, so the hex codec. Not base64.
      return decodePgBytea(data.server_origin_id);
    },
    // By stable uuid. The nonce is bound into the transcript, never used as the
    // row address: comparing a `bytea` column against caller-supplied text made
    // the lookup depend on a transport encoding.
    getEnrollment: async (enrollmentId) => {
      const { data } = await admin.from('device_enrollments')
        .select('id,user_id,new_device_id,approver_device_id,enroll_nonce,granted_domains,created_at,expires_at,approved_at,consumed_at')
        .eq('id', enrollmentId).maybeSingle();
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
    getCertificateChain: async (deviceId) => {
      // Walk `issuer_certificate_id` upward. The handler verifies every link
      // root-first; this adapter only assembles the path and never decides
      // whether any of it is trustworthy.
      const { data: leaf } = await admin.from('device_certificates')
        .select(CERTIFICATE_COLUMNS)
        .eq('subject_device_id', deviceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!leaf) return [];

      const chain: CertificateRow[] = [leaf as CertificateRow];
      const seen = new Set<string>([leaf.id as string]);
      let issuerId = leaf.issuer_certificate_id as string | null;
      while (issuerId && chain.length < MAX_CHAIN_DEPTH) {
        if (seen.has(issuerId)) break;
        seen.add(issuerId);
        const { data: parent } = await admin.from('device_certificates')
          .select(CERTIFICATE_COLUMNS).eq('id', issuerId).maybeSingle();
        if (!parent) break;
        chain.push(parent as CertificateRow);
        issuerId = parent.issuer_certificate_id as string | null;
      }
      return chain;
    },
    isDeviceRevoked: async (deviceId) => {
      const { count } = await admin.from('revocation_statements')
        .select('id', { count: 'exact', head: true })
        .eq('revoked_device_id', deviceId);
      return (count ?? 0) > 0;
    },
    getRevocationLogHead: async (userId) => {
      const { data } = await admin.from('revocation_statements')
        .select('log_head')
        .eq('user_id', userId)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.log_head ? String(data.log_head) : null;
    },
    commitApproval: async (input) => {
      // One transaction: consume the nonce, persist the certificate, then move
      // the operational status. Never the three as separate best-effort steps.
      const { error } = await admin.rpc('e2ee_commit_device_approval', {
        p_enrollment_id: input.enrollmentId,
        p_new_device_id: input.newDeviceId,
        p_certificate: encodePgBytea(input.certificate),
        p_certificate_fp: encodePgBytea(input.certificateFp),
        p_transcript_hash: encodePgBytea(input.transcriptHash),
        p_approval_signature: encodePgBytea(input.approvalSignature),
        p_user_id: input.userId,
        p_recovery_identity_id: input.recoveryIdentityId,
        p_recovery_version: input.recoveryVersion,
        p_subject_sig_spki: encodePgBytea(input.subjectSigSpki),
        p_subject_kem_spki: encodePgBytea(input.subjectKemSpki),
      });
      if (error) {
        return {
          ok: false,
          code: error.message.includes('ALREADY_USED') ? 'E_NONCE_ALREADY_USED' : 'E_COMMIT_FAILED',
        };
      }
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
