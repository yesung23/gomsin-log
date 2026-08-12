#!/usr/bin/env node
/**
 * Executable proof for the remaining Phase 1A P0 blockers.
 *
 * Every defect this file covers was hidden by an in-memory test double that was
 * more permissive than the database. `memoryEnvironment` auto-filled the issuer
 * certificate, exposed both partners' envelopes, and moved device status by
 * assignment — so approval, epoch readiness and recovery all "passed" while the
 * real schema would have rejected or mis-handled them.
 *
 * So this harness starts a throwaway PostgreSQL 17 cluster, applies the actual
 * migrations, and drives the actual functions as actual RLS actors:
 *
 *   A   owner
 *   B   A's active partner
 *   C   unrelated third user
 *   service_role / no-JWT   the privileged Edge context
 *
 * An authenticated actor is simulated the way PostgREST does it: SET ROLE
 * authenticated plus request.jwt.claim.sub, so RLS policies and auth.uid()
 * behave as they do in production. Nothing here touches a configured Supabase
 * project; the cluster lives in a temp dir on a unix socket and is destroyed on
 * exit.
 *
 * Usage: node scripts/e2ee/p0-harness.mjs [--keep]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const BASELINE = join(import.meta.dirname, 'baseline.sql');

const FORWARD = [
  '031_e2ee_key_foundation.sql',
  '032_e2ee_write_floor.sql',
  '034_e2ee_recovery_challenge_issuance.sql',
  '035_e2ee_phase1a_p0_closure.sql',
  '036_e2ee_device_status_privilege.sql',
];

const keep = process.argv.includes('--keep');
const PG_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };

function have(binary) {
  return spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
}

if (!have('initdb') || !have('pg_ctl') || !have('psql')) {
  console.error('POSTGRES UNAVAILABLE: initdb/pg_ctl/psql not found on PATH.');
  console.error('This is a MISSING VERIFICATION, not a pass.');
  process.exit(2);
}

for (const file of FORWARD) {
  if (!existsSync(join(MIGRATIONS, file))) {
    console.error(`MISSING MIGRATION: ${file}`);
    process.exit(2);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gomsinlog-p0-'));
const dataDir = join(dir, 'pgdata');
const socketDir = join(dir, 'sock');
execFileSync('mkdir', ['-p', socketDir], { env: PG_ENV });

let started = false;
function shutdown() {
  if (started) {
    spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: PG_ENV });
    started = false;
  }
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

const DB = 'p0_closure';

function psql(args, { input } = {}) {
  const result = spawnSync(
    'psql',
    ['-h', socketDir, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', input, env: PG_ENV },
  );
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Run SQL with no authenticated actor: the service_role / Edge context. */
function sql(text) {
  return psql(['-At', '-c', text]);
}

function mustSql(text, label) {
  const result = sql(text);
  if (!result.ok) throw new Error(`${label} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

/**
 * Run SQL as an authenticated user, exactly as PostgREST arranges it.
 *
 * SET ROLE makes RLS apply (a superuser bypasses it, which would make every
 * privacy assertion here meaningless), and the JWT claim is what auth.uid()
 * reads.
 */
function asUser(userId, text) {
  // The claim is set inside a DO block rather than with SELECT set_config(...),
  // because in -At mode a SELECT emits a row that would be prepended to the
  // caller's result and silently corrupt every value comparison below.
  return psql([
    '-At',
    '-c', 'SET ROLE authenticated',
    '-c', `DO $harness$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $harness$`,
    '-c', text,
  ]);
}

function mustAsUser(userId, text, label) {
  const result = asUser(userId, text);
  if (!result.ok) throw new Error(`${label} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

const failures = [];
const passes = [];

function check(condition, message) {
  if (condition) {
    passes.push(message);
    return true;
  }
  failures.push(message);
  return false;
}

/** Assert an operation was refused, and that the refusal named the right code. */
function checkRefused(result, code, message) {
  if (result.ok) {
    failures.push(`${message} — but it SUCCEEDED`);
    return false;
  }
  if (code && !new RegExp(code).test(result.stderr)) {
    failures.push(`${message} — refused, but not with ${code}:\n    ${result.stderr.trim().split('\n').pop()}`);
    return false;
  }
  passes.push(message);
  return true;
}

// ---------------------------------------------------------------------------
// Fixture construction
// ---------------------------------------------------------------------------

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';

/**
 * A 445-byte GLDC1 certificate whose granted-domain byte is real.
 *
 * The bytes are not a valid signature and do not need to be: this harness tests
 * the DATABASE contract — constraints, RLS, and the SQL functions' own checks.
 * Signature verification is the Edge handler's job and is covered by the vitest
 * Edge suite. What must be genuine here is the length and offset 10, because
 * e2ee_certificate_granted_domains reads exactly that.
 */
function certificate(mask, seed) {
  return `overlay(
    overlay(
      decode(repeat('${seed.toString(16).padStart(2, '0')}', 445), 'hex')
      placing decode('${mask.toString(16).padStart(2, '0')}', 'hex') from 11 for 1
    )
    placing decode('474c4443', 'hex') from 1 for 4
  )`;
}

const spki = (seed) => `decode(repeat('${seed.toString(16).padStart(2, '0')}', 91), 'hex')`;
const bytes32 = (seed) => `decode(repeat('${seed.toString(16).padStart(2, '0')}', 32), 'hex')`;
const envelope = (seed) => `decode(repeat('${seed.toString(16).padStart(2, '0')}', 360), 'hex')`;

const MASK = { personal: 1, couple: 2, health: 4, all: 7 };

console.log('› initialising a throwaway PostgreSQL cluster');
execFileSync(
  'initdb',
  ['-D', dataDir, '-U', process.env.USER ?? 'postgres', '-A', 'trust', '--no-sync', '--locale=C', '-E', 'UTF8'],
  { stdio: 'ignore', env: PG_ENV },
);
writeFileSync(join(dataDir, 'postgresql.conf'), [
  `unix_socket_directories = '${socketDir}'`,
  "listen_addresses = ''",
  'fsync = off',
  'full_page_writes = off',
].join('\n') + '\n', { flag: 'a' });
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir}`, '-w', '-l', join(dir, 'pg.log'), 'start'], {
  stdio: 'ignore', env: PG_ENV,
});
started = true;

try {
  console.log('› applying baseline + 031 → 032 → 034 → 035');
  psql(['-c', 'SELECT 1']); // no-op; DB not created yet
  const create = spawnSync('psql', ['-h', socketDir, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q',
    '-c', `CREATE DATABASE ${DB}`], { encoding: 'utf8', env: PG_ENV });
  if (create.status !== 0) throw new Error(`create database failed:\n${create.stderr}`);
  mustPsqlFile(BASELINE, 'baseline');
  for (const file of FORWARD) mustPsqlFile(join(MIGRATIONS, file), `apply ${file}`);

  // The harness grants must mirror production: `authenticated` needs table
  // privileges for RLS to be the thing under test rather than a GRANT error.
  mustSql(`
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;
    GRANT SELECT ON public.couple_members, public.couples TO authenticated;
  `, 'harness grants');

  console.log('› seeding users, couple, devices, certificates, epochs');
  mustSql(`
    INSERT INTO auth.users (id, email) VALUES
      ('${A}', 'a@example.test'), ('${B}', 'b@example.test'), ('${C}', 'c@example.test');

    INSERT INTO public.couples (id) VALUES ('11111111-0000-4000-8000-000000000001');
    INSERT INTO public.couple_members (couple_id, user_id, status) VALUES
      ('11111111-0000-4000-8000-000000000001', '${A}', 'active'),
      ('11111111-0000-4000-8000-000000000001', '${B}', 'active');
  `, 'seed users and couple');

  // Recovery identities. Column widths are enforced by 031; the AEAD nonces
  // live inside enc_rec_*_priv rather than in columns of their own.
  const recoveryIdentity = (user, seed) => `
    INSERT INTO public.recovery_identities
      (user_id, recovery_version, recovery_salt, rec_sig_spki, rec_kem_spki,
       enc_rec_sig_priv, enc_rec_kem_priv, recovery_bundle_fp, bundle_sig)
    VALUES ('${user}', 1, ${bytes32(seed)}, ${spki(seed)}, ${spki(seed + 1)},
       decode(repeat('${seed.toString(16).padStart(2, '0')}', 150), 'hex'),
       decode(repeat('${(seed + 1).toString(16).padStart(2, '0')}', 150), 'hex'),
       ${bytes32(seed + 2)}, decode(repeat('${seed.toString(16).padStart(2, '0')}', 64), 'hex'))
    RETURNING id`;

  const recA = mustSql(recoveryIdentity(A, 0x11), 'recovery identity A');
  const recB = mustSql(recoveryIdentity(B, 0x22), 'recovery identity B');
  const recC = mustSql(recoveryIdentity(C, 0x55), 'recovery identity C');

  const anchor = (user, rec, seed) => `
    INSERT INTO public.recovery_public_anchors
      (user_id, recovery_identity_id, recovery_version, rec_sig_spki, rec_sig_fp, recovery_bundle_fp)
    VALUES ('${user}', '${rec}', 1, ${spki(seed)}, ${bytes32(seed + 3)}, ${bytes32(seed + 2)})
    RETURNING id`;
  const anchorA = mustSql(anchor(A, recA, 0x11), 'anchor A');
  const anchorB = mustSql(anchor(B, recB, 0x22), 'anchor B');
  const anchorC = mustSql(anchor(C, recC, 0x55), 'anchor C');

  // Devices. Inserted without a JWT so the PENDING-only insert trigger does not
  // apply; these represent devices that already completed earlier ceremonies.
  const device = (user, seed, status) => `
    INSERT INTO public.devices (user_id, sig_spki, kem_spki, platform, assurance, status)
    VALUES ('${user}', ${spki(seed)}, ${spki(seed + 1)}, 'ios', 'secure_enclave', '${status}')
    RETURNING id`;

  const a1 = mustSql(device(A, 0x31, 'ACTIVE'), 'device A1');
  const b1 = mustSql(device(B, 0x41, 'ACTIVE'), 'device B1');
  const c1 = mustSql(device(C, 0x51, 'ACTIVE'), 'device C1');

  // Root certificates, issued by each account's recovery identity.
  const rootCert = (user, dev, rec, anchorId, seed, mask) => `
    INSERT INTO public.device_certificates
      (user_id, subject_device_id, issuer_device_id, issuer_certificate_id,
       recovery_public_anchor_id, recovery_identity_id, recovery_version,
       certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
    VALUES ('${user}', '${dev}', NULL, NULL, '${anchorId}', '${rec}', 1,
       ${certificate(mask, seed)}, ${bytes32(seed + 4)}, ${spki(seed)}, ${spki(seed + 1)})
    RETURNING id`;

  const certA1 = mustSql(rootCert(A, a1, recA, anchorA, 0x31, MASK.all), 'cert A1');
  const certB1 = mustSql(rootCert(B, b1, recB, anchorB, 0x41, MASK.all), 'cert B1');
  mustSql(rootCert(C, c1, recC, anchorC, 0x51, MASK.all), 'cert C1');

  console.log('  seeded');

  // -------------------------------------------------------------------------
  // Scenario 1 — D2 certificate carries the verified issuer
  // -------------------------------------------------------------------------
  console.log('› Scenario 1: second-device approval persists the verified issuer');

  // A2 enrolls, approved by A1.
  const a2 = mustSql(device(A, 0x32, 'PENDING'), 'device A2');
  const enrollment = (user, newDev, approver, nonceSeed, mask) => `
    INSERT INTO public.device_enrollments
      (user_id, new_device_id, approver_device_id, enroll_nonce, granted_domains, expires_at)
    VALUES ('${user}', '${newDev}', '${approver}', ${bytes32(nonceSeed)}, ${mask}, now() + interval '10 minutes')
    RETURNING id`;
  const enrollA2 = mustSql(enrollment(A, a2, a1, 0x61, MASK.all), 'enrollment A2');

  const approve = (enrollmentId, newDev, user, rec, issuerCert, seed, mask) => `
    SELECT public.e2ee_commit_device_approval(
      '${enrollmentId}', '${newDev}', ${certificate(mask, seed)}, ${bytes32(seed + 4)},
      ${bytes32(seed + 5)}, decode(repeat('${seed.toString(16).padStart(2, '0')}', 64), 'hex'),
      '${user}', '${rec}', 1::SMALLINT, ${spki(seed)}, ${spki(seed + 1)}, ${issuerCert}
    )`;

  const approved = sql(approve(enrollA2, a2, A, recA, `'${certA1}'`, 0x32, MASK.all));
  check(approved.ok, 'valid D1→D2 approval succeeds against the real constraint');
  if (!approved.ok) console.error(`    ${approved.stderr.trim().split('\n').slice(-3).join('\n    ')}`);

  if (approved.ok) {
    const fk = mustSql(`
      SELECT issuer_certificate_id = '${certA1}'
         AND recovery_public_anchor_id IS NULL
         AND issuer_device_id = '${a1}'
      FROM public.device_certificates WHERE subject_device_id = '${a2}'
    `, 'A2 issuer FK');
    check(fk === 't', 'D2 certificate: issuer_certificate_id = verified D1 cert, recovery anchor NULL');

    const status = mustSql(`SELECT status FROM public.devices WHERE id = '${a2}'`, 'A2 status');
    check(status === 'PROVISIONING', `approval leaves the device PROVISIONING (saw ${status})`);
  }

  // Rejections. Each uses a fresh enrollment so the nonce is never the reason.
  const a3 = mustSql(device(A, 0x33, 'PENDING'), 'device A3');

  const freshEnrollment = (seedBase) => mustSql(
    enrollment(A, a3, a1, seedBase, MASK.all), `enrollment A3 ${seedBase}`,
  );

  checkRefused(
    sql(approve(freshEnrollment(0x62), a3, A, recA, `'${certB1}'`, 0x33, MASK.all)),
    'E2EE_ISSUER_WRONG_ACCOUNT',
    'reject: issuer certificate belonging to another user',
  );

  checkRefused(
    sql(approve(freshEnrollment(0x63), a3, A, recA, 'NULL', 0x33, MASK.all)),
    'E2EE_ISSUER_CERTIFICATE_REQUIRED',
    'reject: missing issuer certificate',
  );

  checkRefused(
    sql(approve(freshEnrollment(0x64), a3, A, recA, `'${'99999999-0000-4000-8000-000000000099'}'`, 0x33, MASK.all)),
    'E2EE_UNKNOWN_ISSUER_CERTIFICATE',
    'reject: unrelated / nonexistent issuer certificate',
  );

  // Client-selected substitution: A2's own fresh certificate is a real row of
  // the right account, but it is not the approver named by the enrollment.
  const a2Cert = mustSql(
    `SELECT id FROM public.device_certificates WHERE subject_device_id = '${a2}'`, 'A2 cert id',
  );
  if (a2Cert) {
    checkRefused(
      sql(approve(freshEnrollment(0x65), a3, A, recA, `'${a2Cert}'`, 0x33, MASK.all)),
      'E2EE_ISSUER_NOT_APPROVER',
      'reject: client substitutes a different same-account certificate',
    );
  }

  // Grant escalation: an issuer holding only personal cannot grant health.
  const a4 = mustSql(device(A, 0x34, 'ACTIVE'), 'device A4');
  const certA4Personal = mustSql(`
    INSERT INTO public.device_certificates
      (user_id, subject_device_id, issuer_device_id, issuer_certificate_id,
       recovery_public_anchor_id, recovery_identity_id, recovery_version,
       certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
    VALUES ('${A}', '${a4}', NULL, NULL, '${anchorA}', '${recA}', 1,
       ${certificate(MASK.personal, 0x34)}, ${bytes32(0x38)}, ${spki(0x34)}, ${spki(0x35)})
    RETURNING id`, 'cert A4 personal-only');
  const a5 = mustSql(device(A, 0x36, 'PENDING'), 'device A5');
  checkRefused(
    sql(approve(
      mustSql(enrollment(A, a5, a4, 0x66, MASK.all), 'enrollment A5'),
      a5, A, recA, `'${certA4Personal}'`, 0x36, MASK.all,
    )),
    'E2EE_ISSUER_GRANT_ESCALATION',
    'reject: issuer grants a domain it does not hold',
  );

  // Revoked issuer.
  const revoke = (user, dev, seq, seed) => `
    INSERT INTO public.revocation_statements
      (user_id, revoked_device_id, revoker_device_id, reason, statement, signature,
       revoked_at, sequence, log_head)
    VALUES ('${user}', '${dev}', NULL, 1,
       decode(repeat('${seed.toString(16).padStart(2, '0')}', 203), 'hex'),
       decode(repeat('${seed.toString(16).padStart(2, '0')}', 64), 'hex'),
       now(), ${seq}, ${bytes32(seed)})`;
  mustSql(revoke(A, a4, 1, 0x71), 'revoke A4');
  const a6 = mustSql(device(A, 0x37, 'PENDING'), 'device A6');
  checkRefused(
    sql(approve(
      mustSql(enrollment(A, a6, a4, 0x67, MASK.personal), 'enrollment A6'),
      a6, A, recA, `'${certA4Personal}'`, 0x37, MASK.personal,
    )),
    'E2EE_ISSUER_REVOKED',
    'reject: revoked issuer device',
  );

  // -------------------------------------------------------------------------
  // Scenario 2 — provisioning gate
  // -------------------------------------------------------------------------
  console.log('› Scenario 2: PENDING → PROVISIONING → ACTIVE');

  // A client may not promote a device by direct UPDATE. Since 036 this is
  // refused by column privilege rather than by the trigger, so the error is
  // PostgreSQL's own permission denial and never reaches
  // E2EE_DEVICE_STATUS_FORBIDDEN — the block simply moved earlier. Both codes
  // are accepted so the assertion states the requirement (refused) rather than
  // pinning the layer that happens to enforce it.
  checkRefused(
    asUser(A, `UPDATE public.devices SET status = 'ACTIVE' WHERE id = '${a2}'`),
    'E2EE_DEVICE_STATUS_FORBIDDEN|permission denied',
    'reject: authenticated client sets status = ACTIVE directly',
  );

  // Nor insert one already ACTIVE.
  checkRefused(
    asUser(A, `
      INSERT INTO public.devices (user_id, sig_spki, kem_spki, platform, assurance, status)
      VALUES ('${A}', ${spki(0x39)}, ${spki(0x3a)}, 'ios', 'secure_enclave', 'ACTIVE')`),
    'E2EE_DEVICE_MUST_START_PENDING',
    'reject: authenticated client inserts an ACTIVE device',
  );

  // A2 has a certificate but no envelopes, so it cannot finalize.
  checkRefused(
    asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a2}')`),
    'E2EE_PROVISIONING_INCOMPLETE',
    'reject: activation before any envelope exists',
  );

  // Build A's personal + health epochs with A1 and recovery covered.
  const scopeKey = (domain, scopeId, ownerUser, ownerCouple, epoch, state) => `
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, owner_couple_id, key_epoch, state)
    VALUES ('${domain}', '${scopeId}', ${ownerUser ? `'${ownerUser}'` : 'NULL'},
            ${ownerCouple ? `'${ownerCouple}'` : 'NULL'}, ${epoch}, '${state}')
    RETURNING id`;

  const personalA = mustSql(scopeKey('personal', A, A, null, 1, 'ACTIVE'), 'personal epoch A');
  const healthA = mustSql(scopeKey('health', A, A, null, 1, 'ACTIVE'), 'health epoch A');

  const putEnvelope = (scopeKeyId, kind, id, senderDev, senderCert, seed, notarized = 'false') => `
    INSERT INTO public.key_envelopes
      (scope_key_id, recipient_kind, recipient_device_id, recipient_recovery_id,
       sender_device_id, sender_certificate_id, envelope, self_notarized)
    VALUES ('${scopeKeyId}', '${kind}',
       ${kind === 'device' ? `'${id}'` : 'NULL'},
       ${kind === 'recovery_identity' ? `'${id}'` : 'NULL'},
       '${senderDev}', '${senderCert}', ${envelope(seed)}, ${notarized})`;

  for (const [scope, seed] of [[personalA, 0x81], [healthA, 0x82]]) {
    mustSql(putEnvelope(scope, 'device', a1, a1, certA1, seed, 'true'), 'envelope A1');
    mustSql(putEnvelope(scope, 'recovery_identity', recA, a1, certA1, seed + 1), 'envelope recA');
  }

  // A2 now holds the personal envelope only: still incomplete, because its
  // certificate grants health too.
  mustSql(putEnvelope(personalA, 'device', a2, a1, certA1, 0x83, 'true'), 'envelope A2 personal');
  checkRefused(
    asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a2}')`),
    'E2EE_PROVISIONING_INCOMPLETE',
    'reject: partial provisioning (personal only, health missing)',
  );

  // Not self-notarized yet — an envelope that still depends on the
  // provisioner's certificate is not finished.
  mustSql(putEnvelope(healthA, 'device', a2, a1, certA1, 0x84, 'false'), 'envelope A2 health');
  checkRefused(
    asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a2}')`),
    'E2EE_PROVISIONING_INCOMPLETE',
    'reject: envelope present but not self-notarized',
  );

  mustSql(`
    UPDATE public.key_envelopes SET self_notarized = true
    WHERE scope_key_id = '${healthA}' AND recipient_device_id = '${a2}'`, 'notarize A2 health');

  const finalized = asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a2}')`);
  check(finalized.ok && /ACTIVE/.test(finalized.stdout),
    'fully provisioned device reaches ACTIVE through the finalization RPC');
  if (!finalized.ok) console.error(`    ${finalized.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  // Direct PENDING → ACTIVE is impossible even through the RPC.
  const a7 = mustSql(device(A, 0x3b, 'PENDING'), 'device A7');
  checkRefused(
    asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a7}')`),
    'E2EE_DEVICE_NOT_PROVISIONING',
    'reject: PENDING → ACTIVE without approval',
  );

  // A revoked device never finalizes.
  checkRefused(
    asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a4}')`),
    'E2EE_DEVICE_NOT_PROVISIONING|E2EE_DEVICE_REVOKED',
    'reject: revoked device cannot finalize',
  );

  // -------------------------------------------------------------------------
  // Scenario 2b — G2: the status gate must not rest on a forgeable signal
  // -------------------------------------------------------------------------
  // A custom GUC is NOT a privilege. Any session may set `gomsinlog.*` at will,
  // so a gate that reads one is asking the attacker whether the attacker is
  // authorised. These drive the escalation directly as `authenticated`, the way
  // a stolen anon-key session would, and every one of them must be refused by
  // the database rather than by application code.
  console.log('› Scenario 2b: direct devices.status escalation');

  const gucNames = ['gomsinlog.e2ee_status_transition'];
  const forgedValues = ['on', 'true', '1', 'allowed', 'internal', 'yes'];

  // `UNIQUE (user_id, sig_spki)` makes a duplicate key a fixture error rather
  // than a finding, and this section needs more throwaway devices than the
  // shared `spki()` helper can express: that one repeats a single byte, so it
  // offers 256 values in total and the rest of the file already spends most of
  // them. These use a repeating two-byte pattern instead, which is 91 bytes as
  // required and cannot collide with a uniform one — `0x5a` is skipped because
  // 5a5a… is precisely the uniform case.
  let g2Seed = 0;
  const nextSeed = () => {
    g2Seed += 1;
    if (g2Seed === 0x5a) g2Seed += 1;
    if (g2Seed > 0xff) throw new Error('G2 fixtures exhausted the seed space');
    return g2Seed;
  };
  const g2Spki = (n) => `decode('${`5a${n.toString(16).padStart(2, '0')}`.repeat(46).slice(0, 182)}', 'hex')`;
  const g2Device = (status) => mustSql(`
    INSERT INTO public.devices (user_id, sig_spki, kem_spki, platform, assurance, status)
    VALUES ('${A}', ${g2Spki(nextSeed())}, ${g2Spki(nextSeed())}, 'ios', 'secure_enclave', '${status}')
    RETURNING id`, `G2 ${status} victim`);
  const victim = (status) => g2Device(status);
  const pendingVictim = () => victim('PENDING');
  const provisioningVictim = () => victim('PROVISIONING');

  for (const guc of gucNames) {
    for (const value of forgedValues) {
      const target = pendingVictim();
      checkRefused(
        asUser(A, `
          DO $g2$ BEGIN PERFORM set_config('${guc}', '${value}', false); END $g2$;
          UPDATE public.devices SET status = 'ACTIVE' WHERE id = '${target}';`),
        null,
        `G2: forged ${guc}='${value}' cannot drive PENDING → ACTIVE`,
      );

      const midway = provisioningVictim();
      checkRefused(
        asUser(A, `
          DO $g2$ BEGIN PERFORM set_config('${guc}', '${value}', false); END $g2$;
          UPDATE public.devices SET status = 'ACTIVE' WHERE id = '${midway}';`),
        null,
        `G2: forged ${guc}='${value}' cannot drive PROVISIONING → ACTIVE`,
      );
    }
  }

  // Transaction-local (`is_local = true`) is the same forgery with a narrower
  // lifetime; it must not be treated any differently.
  const localTarget = pendingVictim();
  checkRefused(
    asUser(A, `
      DO $g2$ BEGIN PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', true); END $g2$;
      UPDATE public.devices SET status = 'ACTIVE' WHERE id = '${localTarget}';`),
    null,
    'G2: transaction-local forged GUC cannot escalate',
  );

  // Sol drove it exactly this way: set_config as its own statement, then the
  // UPDATE as a separate command on the same session.
  const twoStep = pendingVictim();
  checkRefused(
    psql([
      '-At',
      '-c', 'SET ROLE authenticated',
      '-c', `DO $h$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${A}', false); END $h$`,
      '-c', `SELECT set_config('gomsinlog.e2ee_status_transition', 'on', false)`,
      '-c', `UPDATE public.devices SET status = 'ACTIVE' WHERE id = '${twoStep}'`,
    ]),
    null,
    'G2: set_config and UPDATE as separate session commands cannot escalate',
  );

  // A set-based UPDATE must not promote anything, and must not partially apply.
  const bulk1 = pendingVictim();
  const bulk2 = provisioningVictim();
  checkRefused(
    asUser(A, `
      DO $g2$ BEGIN PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', false); END $g2$;
      UPDATE public.devices SET status = 'ACTIVE' WHERE user_id = '${A}';`),
    null,
    'G2: multi-row escalation of every owned device is refused',
  );
  {
    const promoted = mustSql(
      `SELECT count(*) FROM public.devices WHERE id IN ('${bulk1}', '${bulk2}') AND status = 'ACTIVE'`,
      'G2 bulk fallout',
    );
    check(promoted === '0', `G2: multi-row escalation left nothing ACTIVE (saw ${promoted})`);
  }

  // Creating a device already ACTIVE would bypass the transition gate entirely.
  checkRefused(
    asUser(A, `
      INSERT INTO public.devices (user_id, sig_spki, kem_spki, platform, assurance, status)
      VALUES ('${A}', ${g2Spki(nextSeed())}, ${g2Spki(nextSeed())}, 'web', 'web_nonextractable', 'ACTIVE')`),
    null,
    'G2: direct INSERT of an ACTIVE device is refused',
  );

  // PENDING → PROVISIONING is the approval RPC's conclusion, not the client's.
  const beginTarget = pendingVictim();
  checkRefused(
    asUser(A, `
      DO $g2$ BEGIN PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', false); END $g2$;
      UPDATE public.devices SET status = 'PROVISIONING' WHERE id = '${beginTarget}';`),
    null,
    'G2: forged GUC cannot drive PENDING → PROVISIONING',
  );

  // RECOVERY_AUTHENTICATED is likewise a server conclusion.
  const recTarget = pendingVictim();
  checkRefused(
    asUser(A, `
      DO $g2$ BEGIN PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', false); END $g2$;
      UPDATE public.devices SET status = 'RECOVERY_AUTHENTICATED' WHERE id = '${recTarget}';`),
    null,
    'G2: forged GUC cannot drive PENDING → RECOVERY_AUTHENTICATED',
  );

  // The boundary has to be narrow, not merely tight: revoking table UPDATE
  // would be an easy way to pass every attack above and break the app.
  {
    const own = pendingVictim();
    const label = asUser(A, `
      UPDATE public.devices
         SET label_ct = decode('00ff', 'hex'), last_seen_at = now()
       WHERE id = '${own}'`);
    check(label.ok, 'G2: client still updates its own label_ct and last_seen_at');
    if (!label.ok) console.error(`    ${label.stderr.trim().split('\n').pop()}`);
  }

  // Retiring a device is a narrowing, so the owner may ask for it — through the
  // function, which holds the privilege the caller does not.
  {
    const mine = pendingVictim();
    const revoked = asUser(A, `SELECT public.e2ee_revoke_own_device('${mine}')`);
    check(revoked.ok && /REVOKED/.test(revoked.stdout),
      'G2: owner retires its own device through the RPC');
    if (!revoked.ok) console.error(`    ${revoked.stderr.trim().split('\n').pop()}`);

    check(asUser(A, `SELECT public.e2ee_revoke_own_device('${mine}')`).ok,
      'G2: retiring an already-revoked device is idempotent');

    checkRefused(
      asUser(C, `SELECT public.e2ee_revoke_own_device('${mine}')`),
      'E2EE_DEVICE_WRONG_ACCOUNT',
      'G2: an unrelated user cannot retire someone else’s device',
    );
  }

  // Recording a provisioning failure is likewise a narrowing, but only from a
  // state that was genuinely mid-provisioning.
  {
    const midway = provisioningVictim();
    const failed = asUser(A, `SELECT public.e2ee_mark_device_provisioning_failed('${midway}')`);
    check(failed.ok && /PROVISIONING_FAILED/.test(failed.stdout),
      'G2: owner records a provisioning failure through the RPC');
    if (!failed.ok) console.error(`    ${failed.stderr.trim().split('\n').pop()}`);

    checkRefused(
      asUser(C, `SELECT public.e2ee_mark_device_provisioning_failed('${provisioningVictim()}')`),
      'E2EE_DEVICE_WRONG_ACCOUNT',
      'G2: an unrelated user cannot fail someone else’s device',
    );

    // An ACTIVE device must not be walked backwards into a provisioning state.
    checkRefused(
      asUser(A, `SELECT public.e2ee_mark_device_provisioning_failed('${a1}')`),
      'E2EE_DEVICE_NOT_PROVISIONING',
      'G2: an ACTIVE device cannot be marked provisioning-failed',
    );
  }

  // The same reasoning error appears once more in 031. `enforce_write_floor_
  // monotonic` lets a DELETE through when gomsinlog.e2ee_account_destruction is
  // 'on', and its comment claims "a normal authenticated caller can never set
  // the flag". A caller absolutely can set it — that is what G2 was about.
  //
  // It is not exploitable, but not for the reason the comment gives: the floor
  // is protected because `authenticated` was never granted DELETE or UPDATE on
  // the table, so the trigger is never even reached. The grant is doing the
  // work, the flag is not.
  //
  // That makes the grant load-bearing and previously unasserted, which is
  // exactly how G2 happened. These pin it: if a later migration widens the
  // grant, the forged flag becomes a real plaintext-downgrade attack and this
  // fails instead of the property silently disappearing.
  {
    mustSql(`
      INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at)
      VALUES ('user', '${A}', 1, now())
      ON CONFLICT (scope_kind, scope_id) DO UPDATE SET min_cipher_format = 1`,
      'write floor for A');

    checkRefused(
      asUser(A, `
        DO $wf$ BEGIN PERFORM set_config('gomsinlog.e2ee_account_destruction', 'on', false); END $wf$;
        DELETE FROM public.crypto_write_floor WHERE scope_kind = 'user' AND scope_id = '${A}';`),
      'permission denied',
      'G2: forged destruction flag cannot delete the write floor (no DELETE grant)',
    );

    checkRefused(
      asUser(A, `
        DO $wf$ BEGIN PERFORM set_config('gomsinlog.e2ee_account_destruction', 'on', false); END $wf$;
        UPDATE public.crypto_write_floor SET min_cipher_format = 0
         WHERE scope_kind = 'user' AND scope_id = '${A}';`),
      'permission denied',
      'G2: forged destruction flag cannot lower the write floor (no UPDATE grant)',
    );

    const floor = mustSql(
      `SELECT min_cipher_format FROM public.crypto_write_floor WHERE scope_kind = 'user' AND scope_id = '${A}'`,
      'write floor after attack',
    );
    check(floor === '1', `G2: the write floor is unchanged after both attempts (saw ${floor})`);
  }

  // -------------------------------------------------------------------------
  // Scenario 3 + 4 — RLS privacy and server-side readiness
  // -------------------------------------------------------------------------
  console.log('› Scenario 3/4: couple epoch readiness under real RLS');

  const couple = '11111111-0000-4000-8000-000000000001';
  const coupleEpoch = mustSql(scopeKey('couple', couple, null, couple, 1, 'PREPARING'), 'couple epoch');

  // A writes its own side.
  mustSql(putEnvelope(coupleEpoch, 'device', a1, a1, certA1, 0x91, 'true'), 'couple envelope A1');
  mustSql(putEnvelope(coupleEpoch, 'device', a2, a1, certA1, 0x92, 'true'), 'couple envelope A2');
  mustSql(putEnvelope(coupleEpoch, 'recovery_identity', recA, a1, certA1, 0x93), 'couple envelope recA');
  // And B's side exists too (written by B in production).
  mustSql(putEnvelope(coupleEpoch, 'device', b1, b1, certB1, 0x94, 'true'), 'couple envelope B1');
  mustSql(putEnvelope(coupleEpoch, 'recovery_identity', recB, b1, certB1, 0x95), 'couple envelope recB');

  // PRIVACY: A must not be able to read B's envelope rows.
  const aSeesB = mustAsUser(A, `
    SELECT count(*) FROM public.key_envelopes
    WHERE scope_key_id = '${coupleEpoch}' AND recipient_device_id = '${b1}'`,
    'A reads B envelope');
  check(aSeesB === '0', `A's ordinary SELECT of B's envelope returns nothing (saw ${aSeesB})`);

  const aSeesAll = mustAsUser(A, `
    SELECT count(*) FROM public.key_envelopes WHERE scope_key_id = '${coupleEpoch}'`,
    'A reads all couple envelopes');
  check(aSeesAll === '3', `A sees only its own 3 envelopes of 5 (saw ${aSeesAll})`);

  // Yet readiness succeeds, because the RPC counts internally.
  const ready = asUser(A, `SELECT public.e2ee_mark_epoch_ready('${coupleEpoch}')`);
  check(ready.ok && /READY/.test(ready.stdout),
    'complete couple epoch reaches READY even though A cannot see B\'s envelopes');
  if (!ready.ok) console.error(`    ${ready.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  // Scenario 4: remove a required recipient and readiness must fail.
  const incomplete = mustSql(scopeKey('couple', couple, null, couple, 2, 'PREPARING'), 'incomplete epoch');
  mustSql(putEnvelope(incomplete, 'device', a1, a1, certA1, 0x96, 'true'), 'e2 A1');
  mustSql(putEnvelope(incomplete, 'device', a2, a1, certA1, 0x97, 'true'), 'e2 A2');
  mustSql(putEnvelope(incomplete, 'recovery_identity', recA, a1, certA1, 0x98), 'e2 recA');
  mustSql(putEnvelope(incomplete, 'recovery_identity', recB, a1, certA1, 0x99), 'e2 recB');
  // B's DEVICE envelope deliberately absent.
  checkRefused(
    asUser(A, `SELECT public.e2ee_mark_epoch_ready('${incomplete}')`),
    'E2EE_EPOCH_INCOMPLETE',
    'reject: readiness with B\'s device envelope missing',
  );

  // And with B's RECOVERY envelope missing.
  mustSql(putEnvelope(incomplete, 'device', b1, b1, certB1, 0x9a, 'true'), 'e2 B1');
  mustSql(`DELETE FROM public.key_envelopes
           WHERE scope_key_id = '${incomplete}' AND recipient_recovery_id = '${recB}'`,
    'drop recB envelope');
  checkRefused(
    asUser(A, `SELECT public.e2ee_mark_epoch_ready('${incomplete}')`),
    'E2EE_EPOCH_INCOMPLETE',
    'reject: readiness with B\'s recovery envelope missing',
  );

  // Wrong state.
  checkRefused(
    asUser(A, `SELECT public.e2ee_mark_epoch_ready('${coupleEpoch}')`),
    'E2EE_ILLEGAL_EPOCH_TRANSITION',
    'reject: readiness on an epoch that is already READY',
  );

  // -------------------------------------------------------------------------
  // Scenario 8 — unrelated actor
  // -------------------------------------------------------------------------
  console.log('› Scenario 8: unrelated user C');

  checkRefused(
    asUser(C, `SELECT public.e2ee_mark_epoch_ready('${incomplete}')`),
    'E2EE_EPOCH_FORBIDDEN',
    'reject: C marks A/B\'s couple epoch ready',
  );

  checkRefused(
    asUser(C, `SELECT public.e2ee_finalize_device_provisioning('${a2}')`),
    'E2EE_DEVICE_WRONG_ACCOUNT',
    'reject: C finalizes A\'s device',
  );

  // Identifier substitution against the privileged transitions that had no
  // cross-account coverage. Each takes an id straight from the caller, so the
  // only thing standing between C and A's key material is whether the function
  // re-derives ownership from the database instead of trusting the argument.
  // Readiness and finalization were already covered above; these three were
  // not, and an epoch C can activate or abandon is an epoch C can disrupt.
  checkRefused(
    asUser(C, `SELECT public.e2ee_activate_epoch('${coupleEpoch}')`),
    'E2EE_EPOCH_FORBIDDEN',
    'reject: C activates A/B\'s couple epoch',
  );

  checkRefused(
    asUser(C, `SELECT public.e2ee_abandon_epoch('${coupleEpoch}')`),
    'E2EE_EPOCH_FORBIDDEN',
    'reject: C abandons A/B\'s couple epoch',
  );

  checkRefused(
    asUser(C, `SELECT public.e2ee_begin_device_provisioning('${a2}')`),
    'E2EE_DEVICE_WRONG_ACCOUNT',
    'reject: C begins provisioning on A\'s device',
  );

  // The two 036 functions take a device id from the caller too.
  checkRefused(
    asUser(C, `SELECT public.e2ee_revoke_own_device('${a2}')`),
    'E2EE_DEVICE_WRONG_ACCOUNT',
    'reject: C retires A\'s device',
  );

  checkRefused(
    asUser(C, `SELECT public.e2ee_mark_device_provisioning_failed('${a2}')`),
    'E2EE_DEVICE_WRONG_ACCOUNT',
    'reject: C fails A\'s device',
  );

  // A's own scope, addressed by C. Discovery already proves C finds no couple
  // scopes; this proves naming one directly does not help either.
  checkRefused(
    asUser(C, `SELECT public.e2ee_mark_epoch_ready('${personalA}')`),
    'E2EE_EPOCH_FORBIDDEN',
    'reject: C marks A\'s personal scope ready by naming its id',
  );

  const cSeesA = mustAsUser(C, `
    SELECT count(*) FROM public.key_envelopes WHERE scope_key_id = '${coupleEpoch}'`,
    'C reads couple envelopes');
  check(cSeesA === '0', `C sees none of A/B's envelopes (saw ${cSeesA})`);

  const cSeesCouples = mustAsUser(C, 'SELECT count(*) FROM public.e2ee_owned_couple_scope_ids()',
    'C couple discovery');
  check(cSeesCouples === '0', `C discovers no couple scopes (saw ${cSeesCouples})`);

  checkRefused(
    sql(`SET ROLE anon; SELECT count(*) FROM public.key_envelopes`),
    'permission denied',
    'reject: anon reads key_envelopes',
  );

  // -------------------------------------------------------------------------
  // Scenario 6 — server-side couple discovery for recovery
  // -------------------------------------------------------------------------
  console.log('› Scenario 6: recovery discovers couple scopes without UI input');

  const discovered = mustAsUser(A, `
    SELECT string_agg(couple_id::text, ',' ORDER BY couple_id::text)
    FROM public.e2ee_owned_couple_scope_ids()`, 'A couple discovery');
  check(discovered === couple,
    `A's couple scope is discovered server-side with no client input (saw ${discovered})`);

  const discoveredB = mustAsUser(B, `
    SELECT string_agg(couple_id::text, ',' ORDER BY couple_id::text)
    FROM public.e2ee_owned_couple_scope_ids()`, 'B couple discovery');
  check(discoveredB === couple, 'B discovers the same couple scope');

  // A couple with no epoch requires no rotation and must not be reported.
  mustSql(`
    INSERT INTO public.couples (id) VALUES ('22222222-0000-4000-8000-000000000002');
    INSERT INTO public.couple_members (couple_id, user_id, status)
    VALUES ('22222222-0000-4000-8000-000000000002', '${A}', 'inactive');
  `, 'inactive couple');
  const stillOne = mustAsUser(A, 'SELECT count(*) FROM public.e2ee_owned_couple_scope_ids()',
    'A discovery after inactive couple');
  check(stillOne === '1', `an inactive membership is not a rotation target (saw ${stillOne})`);

  // -------------------------------------------------------------------------
  // Coverage helper directly
  // -------------------------------------------------------------------------
  console.log('› coverage helper reports the couple gap after a new epoch');

  // A2 is ACTIVE and covered for personal+health, but the couple epoch above is
  // PREPARING/READY, not ACTIVE, so it is not yet required. Activate it and the
  // requirement appears.
  mustSql(`UPDATE public.scope_keys SET state = 'ACTIVE' WHERE id = '${coupleEpoch}'`,
    'activate couple epoch');
  // An uncertified device has no granted-domain mask to reason from, so the
  // helper refuses rather than returning "nothing missing" — which would read
  // as fully provisioned and is exactly the fail-open this P0 is about.
  checkRefused(
    asUser(A, `SELECT count(*) FROM public.e2ee_missing_device_coverage('${a7}')`),
    'E2EE_DEVICE_UNCERTIFIED',
    'reject: coverage of an uncertified device fails closed rather than reporting complete',
  );

  const a2Missing = mustAsUser(A, `
    SELECT count(*) FROM public.e2ee_missing_device_coverage('${a2}')`, 'A2 coverage');
  check(a2Missing === '0', `A2 holds every required envelope including the couple key (saw ${a2Missing})`);

  // -------------------------------------------------------------------------
  // Scenario 7 — a couple whose epoch is incomplete blocks activation
  // -------------------------------------------------------------------------
  // The multi-couple partial-failure requirement, expressed against the schema
  // this product actually has: `get_my_active_couple_id()` is LIMIT 1 and
  // membership is 1:1, so "one of three rotations failed" is structurally the
  // same condition as "the couple scope this account holds did not complete".
  // What must hold either way is that a device does NOT reach ACTIVE while any
  // required scope is uncovered.
  console.log('› Scenario 7: an uncovered couple scope keeps a device non-ACTIVE');

  // A fresh device for A, certified and provisioning, covered for personal and
  // health but NOT for the now-ACTIVE couple epoch.
  const a8 = mustSql(device(A, 0x3c, 'PENDING'), 'device A8');
  const enrollA8 = mustSql(enrollment(A, a8, a1, 0x68, MASK.all), 'enrollment A8');
  const approvedA8 = sql(approve(enrollA8, a8, A, recA, `'${certA1}'`, 0x3c, MASK.all));
  check(approvedA8.ok, 'a further approval still succeeds');

  for (const [scope, seed] of [[personalA, 0xa1], [healthA, 0xa2]]) {
    mustSql(putEnvelope(scope, 'device', a8, a1, certA1, seed, 'true'), 'A8 personal/health');
  }

  checkRefused(
    asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a8}')`),
    'E2EE_PROVISIONING_INCOMPLETE',
    'reject: device stays non-ACTIVE while the couple scope is uncovered',
  );
  const a8Status = mustSql(`SELECT status FROM public.devices WHERE id = '${a8}'`, 'A8 status');
  check(a8Status === 'PROVISIONING', `the blocked device remains PROVISIONING (saw ${a8Status})`);

  // Cover the couple scope and it completes.
  mustSql(putEnvelope(coupleEpoch, 'device', a8, a1, certA1, 0xa3, 'true'), 'A8 couple');
  const a8Final = asUser(A, `SELECT public.e2ee_finalize_device_provisioning('${a8}')`);
  check(a8Final.ok && /ACTIVE/.test(a8Final.stdout),
    'once every scope is covered the same device reaches ACTIVE');

  // -------------------------------------------------------------------------
  // Scenario 5 — recovery rollback is refused by the ANCHOR, not by the server
  // -------------------------------------------------------------------------
  // The kit anchor is a client-side artifact, so the authoritative test for the
  // rollback attack is in vitest (`src/lib/e2eeP0Closure.test.ts`). What the
  // DATABASE must contribute is that an older generation remains distinguishable:
  // a superseded identity is retained with its own version and fingerprint, and
  // the live-identity index permits exactly one current generation. Without that,
  // no client-side check could tell the two apart.
  console.log('› Scenario 5: the database keeps recovery generations distinguishable');

  mustSql(`
    UPDATE public.recovery_identities SET superseded_at = now() WHERE id = '${recA}';
  `, 'supersede A generation 1');

  const recA2 = mustSql(`
    INSERT INTO public.recovery_identities
      (user_id, recovery_version, recovery_salt, rec_sig_spki, rec_kem_spki,
       enc_rec_sig_priv, enc_rec_kem_priv, recovery_bundle_fp, bundle_sig)
    VALUES ('${A}', 2, ${bytes32(0xb1)}, ${spki(0xb1)}, ${spki(0xb2)},
       decode(repeat('b1', 150), 'hex'), decode(repeat('b2', 150), 'hex'),
       ${bytes32(0xb3)}, decode(repeat('b1', 64), 'hex'))
    RETURNING id`, 'A recovery generation 2');

  const generations = mustSql(`
    SELECT string_agg(recovery_version::text || ':' || (superseded_at IS NULL)::text, ',' ORDER BY recovery_version)
    FROM public.recovery_identities WHERE user_id = '${A}'`, 'A generations');
  check(generations === '1:false,2:true',
    `both generations are retained and exactly one is live (saw ${generations})`);

  const distinctFingerprints = mustSql(`
    SELECT count(DISTINCT recovery_bundle_fp) FROM public.recovery_identities WHERE user_id = '${A}'`,
    'A fingerprints');
  check(distinctFingerprints === '2',
    'the old generation keeps its own bundle fingerprint, so a rollback is detectable');

  // A second live identity is impossible, so a server cannot offer two "current"
  // bundles and let the client pick.
  checkRefused(
    sql(`
      INSERT INTO public.recovery_identities
        (user_id, recovery_version, recovery_salt, rec_sig_spki, rec_kem_spki,
         enc_rec_sig_priv, enc_rec_kem_priv, recovery_bundle_fp, bundle_sig)
      VALUES ('${A}', 3, ${bytes32(0xc1)}, ${spki(0xc1)}, ${spki(0xc2)},
         decode(repeat('c1', 150), 'hex'), decode(repeat('c2', 150), 'hex'),
         ${bytes32(0xc3)}, decode(repeat('c1', 64), 'hex'))`),
    'idx_recovery_identity_live',
    'reject: a second live recovery identity for one account',
  );
  check(recA2 !== '', 'generation 2 is the single live identity');
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

function mustPsqlFile(file, label) {
  const result = spawnSync(
    'psql',
    ['-h', socketDir, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', file],
    { encoding: 'utf8', env: PG_ENV },
  );
  if (result.status !== 0) throw new Error(`${label} failed:\n${(result.stderr ?? '').trim()}`);
  return result.stdout ?? '';
}

// ---------------------------------------------------------------------------

console.log('');
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length > 0) {
  console.error('\nP0 HARNESS: FAIL');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} passed, ${failures.length} failed`);
  process.exit(1);
}

console.log(`\nP0 HARNESS: PASS (${passes.length} assertions)`);
