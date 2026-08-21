#!/usr/bin/env node
/**
 * Executable proof for the real fresh active chain through migration 045.
 *
 * The string-level tests next to these migrations prove the SQL text says what
 * we think it says. They cannot prove the policies DENY anything, because a
 * predicate that reads correctly can still be wrong: `couple_id = NULL` looks
 * restrictive and matches nothing, `(a OR b)` looks restrictive and matches
 * everything. The only honest proof of a deny rule is a real actor being
 * refused by a real database.
 *
 * So this harness starts a throwaway PostgreSQL 17 cluster, applies the actual
 * active migration chain 001..040 + 043..045 (041/042 are frozen), and drives
 * the actual policies as actual RLS
 * actors, in the same shape as `scripts/e2ee/p0-harness.mjs`:
 *
 *   A   owner, member of couple 1
 *   B   A's active partner in couple 1
 *   C   unrelated third user, sole member of couple 2
 *   anon / service_role   the unauthenticated and privileged contexts
 *
 * An authenticated actor is simulated the way PostgREST does it: SET ROLE
 * authenticated plus request.jwt.claim.sub, so RLS and auth.uid() behave as
 * they do in production. Nothing here touches a configured Supabase project;
 * the cluster lives in a temp dir on a unix socket and is destroyed on exit.
 *
 * WHAT THIS HARNESS DOES NOT PROVE
 * --------------------------------
 * Supabase owns the `storage` schema, so this file supplies a stub of the three
 * objects the policies rest on: `storage.buckets`, `storage.objects` and
 * `storage.foldername()`. The stub mirrors Supabase's own definitions, and
 * `foldername` in particular is the documented "all path segments except the
 * last" behaviour. A pass therefore proves the POLICY PREDICATES are correct
 * given that contract. It does not prove Supabase's storage internals match the
 * stub, and it is not evidence that any of this reached production — see
 * `supabase/migrations/README.md` for deployment state.
 *
 * Usage: node scripts/phase0/storage-authz-harness.mjs [--keep]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

/**
 * The documented apply order.
 *
 * The two 002 files share a number on purpose — both already ran in production
 * and renaming them would desynchronise history from the database
 * (README "002 번호 중복"). Full-filename lexicographic order puts `_and_rpc`
 * before `_recursion`, and that is the order production saw.
 */
const ORDER = [
  '001_initial_schema.sql',
  '002_fix_rls_and_rpc.sql',
  '002_fix_rls_recursion.sql',
  '003_add_emotion_flow.sql',
  '004_create_cycle_tables.sql',
  '005_secure_rls_policies.sql',
  '006_auth_and_rpc_fixes.sql',
  '007_storage_policies.sql',
  '008_membership_integrity.sql',
  '009_remote_core_security_hotfix.sql',
  '010_revoke_anon_rpc_access.sql',
  '011_create_missing_feature_tables.sql',
  '012_authenticated_core_table_grants.sql',
  '013_invitation_hardening.sql',
  '014_feature_privacy_and_collaboration.sql',
  '015_security_followup.sql',
  '016_couple_state_visibility.sql',
  '017_partner_profile_hardening_and_schema_reload.sql',
  '018_shared_tasks_and_trip_places.sql',
  '019_call_topics_and_trip_timetable.sql',
  '020_fix_uuid_active_couple_lookup.sql',
  '021_restore_profile_military_info.sql',
  '022_cycle_v3_schema.sql',
  '023_lock_legacy_cycle_backup.sql',
  '024_cycle_v3_account_deletion.sql',
  '025_partner_cycle_projection.sql',
  '026_projection_requires_consent.sql',
  '027_fix_account_deletion_column.sql',
  '028_restore_couple_media_authorization.sql',
  '029_cleanup_solo_couples_on_account_deletion.sql',
  '030_harden_create_invitation_search_path.sql',
  // Phase 1A is frozen and untouched here, but it must be PRESENT: 031 hangs
  // couple `scope_keys` and `crypto_pairings` off `public.couples` ON DELETE
  // CASCADE, and 029 deletes that parent row. Stopping at 030 would leave the
  // two cascades 031 most deliberately guards completely unexercised.
  '031_e2ee_key_foundation.sql',
  '032_e2ee_write_floor.sql',
  '034_e2ee_recovery_challenge_issuance.sql',
  '035_e2ee_phase1a_p0_closure.sql',
  '036_e2ee_device_status_privilege.sql',
  '037_harden_e2ee_account_deletion_survivor_detection.sql',
  '038_bilateral_talk_about_marks.sql',
  '039_daily_records_content_envelope.sql',
  '040_e2ee_write_floor_scope_semantics.sql',
  '043_conversation_bridge_completion.sql',
  '044_unlink_crypto_pairing_authority.sql',
  '045_harden_e2ee_write_floor_activation.sql',
  '046_require_actor_for_device_provisioning.sql',
  '047_care_signal_feeling_unwell.sql',
  '048_push_delivery_metadata.sql',
  '049_product_events.sql',
  '050_lv_funnel_readout.sql',
  '051_audit_closure_overload_and_forgeable_couple.sql',
  '052_unseen_flag_survives_no_record.sql',
  '053_pending_acts_not_shared_history.sql',
  '054_shared_at_is_server_state.sql',
  '055_notified_through_is_the_send_decision.sql',
];

/**
 * The one deviation the README prescribes for a fresh database.
 *
 * `002_fix_rls_recursion.sql` recreates policies that `002_fix_rls_and_rpc.sql`
 * already created, without dropping them first, so a brand-new cluster fails at
 * `policy already exists`. Production never hit this because the two files
 * landed against different intermediate states. 005 and 009 redefine every one
 * of these policies later, so the end state is identical either way.
 */
const PRE_002_RECURSION_DROPS = `
  DROP POLICY IF EXISTS "Users can create couples" ON public.couples;
  DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
  DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
  DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;
`;

/** The Supabase-managed objects the app migrations assume already exist. */
const SUPABASE_STUB = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $stub$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$stub$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;

-- Supabase reads the JWT claim and NOTHING else. An earlier version of this stub
-- fell back to current_user, which is strictly more permissive than production:
-- a bare SET ROLE service_role with no claim would have satisfied 029's gate
-- here and been refused in reality.
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
  $fn$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $fn$;

-- Supabase's storage schema, reduced to what the couple-media policies touch.
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT NOT NULL,
  owner UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Supabase grants schema USAGE and table DML to both roles; the deny must come
-- from RLS, not from a missing GRANT. Withholding these here would make every
-- negative assertion below pass for the wrong reason.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
GRANT SELECT ON storage.buckets TO anon, authenticated;

-- Supabase's definition: every path segment except the final filename.
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE AS
$fn$
DECLARE
  parts TEXT[];
BEGIN
  SELECT string_to_array(name, '/') INTO parts;
  RETURN parts[1:array_length(parts, 1) - 1];
END
$fn$;

CREATE PUBLICATION supabase_realtime;
`;

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

for (const file of ORDER) {
  if (!existsSync(join(MIGRATIONS, file))) {
    console.error(`MISSING MIGRATION: ${file}`);
    process.exit(2);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gomsinlog-phase0-'));
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

const DB = 'phase0_baseline';

function psql(args, { input } = {}) {
  const result = spawnSync(
    'psql',
    ['-h', socketDir, '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
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

/** Run SQL as an authenticated user, exactly as PostgREST arranges it. */
function asUser(userId, text) {
  return psql([
    '-At',
    '-c', 'SET ROLE authenticated',
    '-c', `DO $harness$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $harness$`,
    '-c', text,
  ]);
}

/** Run SQL as the anon role, with no JWT subject at all. */
function asAnon(text) {
  return psql(['-At', '-c', 'SET ROLE anon', '-c', text]);
}

/**
 * Run SQL as the Edge Function does: the service_role key.
 *
 * Both halves matter. SET ROLE is what the EXECUTE grant is checked against,
 * and the role claim is what `auth.role()` reads — 029 gates on the claim, so a
 * bare superuser session is refused exactly like an ordinary caller.
 */
function asServiceRole(text) {
  return psql([
    '-At',
    '-c', `DO $harness$ BEGIN PERFORM set_config('request.jwt.claim.role', 'service_role', false); END $harness$`,
    '-c', 'SET ROLE service_role',
    '-c', text,
  ]);
}

/** Whether a statement succeeded, for cases where failure IS the assertion. */
function mustSqlOk(text) {
  return sql(text).ok;
}

function mustAsServiceRole(text, label) {
  const result = asServiceRole(text);
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

/** A read is "denied" when RLS filters the row away, i.e. the count is 0. */
function checkVisible(userId, predicate, expected, message) {
  const result = asUser(userId, `SELECT count(*) FROM storage.objects WHERE ${predicate}`);
  if (!result.ok) {
    failures.push(`${message} — query errored:\n    ${result.stderr.trim()}`);
    return false;
  }
  const actual = Number(result.stdout.trim());
  return check(actual === expected, `${message} (saw ${actual}, expected ${expected})`);
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

// Derived from ORDER rather than typed, because the typed version was already
// wrong: it still said 043..050 with 051 in the chain, and had said 043..045
// long after that stopped being true.
const chainSpan = `${ORDER[0].slice(0, 3)}..${ORDER[ORDER.length - 1].slice(0, 3)}`;
console.log(`active fresh-chain harness — ${ORDER.length} migrations (${chainSpan}, 041/042 frozen) on throwaway PostgreSQL 17\n`);

execFileSync('initdb', ['-D', dataDir, '-U', 'postgres', '--no-sync', '-A', 'trust'], {
  stdio: 'ignore', env: PG_ENV,
});
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h ''`, '-w', 'start'], {
  stdio: 'ignore', env: PG_ENV,
});
started = true;
execFileSync('createdb', ['-h', socketDir, '-U', 'postgres', DB], { stdio: 'ignore', env: PG_ENV });

/*
  Scripts reach psql through a scratch FILE, not `-f /dev/stdin`.

  The stdin form worked on the author's machine and failed the first time this
  harness ran on a Linux CI runner: `psql: error: /dev/stdin: No such device or
  address`. `spawnSync`'s `input` is a pipe, and psql reopens the path it is
  given rather than reading the descriptor it already has -- so on a runner where
  /dev/stdin resolves through /proc to a pipe that is no longer openable, the
  read fails. A real file has no such ambiguity on any platform.

  Worth stating plainly: this bug was invisible for as long as nothing but a
  developer's laptop ever ran these harnesses. It surfaced within minutes of the
  CI job existing.
*/
const scratchSql = join(dir, 'harness-input.sql');
function psqlScript(text) {
  writeFileSync(scratchSql, text);
  return psql(['-f', scratchSql]);
}

const stub = psqlScript(SUPABASE_STUB);
if (!stub.ok) throw new Error(`Supabase stub failed:\n${stub.stderr}`);

for (const file of ORDER) {
  if (file === '002_fix_rls_recursion.sql') {
    const pre = psql(['-c', PRE_002_RECURSION_DROPS]);
    if (!pre.ok) throw new Error(`002 pre-drop failed:\n${pre.stderr}`);
  }
  const applied = psqlScript(readFileSync(join(MIGRATIONS, file), 'utf8'));
  if (!applied.ok) {
    console.error(`MIGRATION FAILED: ${file}\n${applied.stderr}`);
    process.exit(1);
  }
}
console.log(`applied ${ORDER.length} migrations\n`);

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';
const COUPLE1 = '11111111-0000-4000-8000-000000000001';
const COUPLE2 = '22222222-0000-4000-8000-000000000002';
const SHARED = '5ha5ed00-0000-4000-8000-00000000000f'.replace(/[^0-9a-f-]/g, '0');
const PRIVATE = 'da7a0000-0000-4000-8000-0000000000f1';
const OTHER = 'c0c0c0c0-0000-4000-8000-0000000000c2';

mustSql(`
  INSERT INTO auth.users (id, email) VALUES
    ('${A}', 'a@example.test'), ('${B}', 'b@example.test'), ('${C}', 'c@example.test');
  INSERT INTO public.profiles (id, display_name, role) VALUES
    ('${A}', 'A', 'gomsin'), ('${B}', 'B', 'soldier'), ('${C}', 'C', 'gomsin');
  INSERT INTO public.couples (id) VALUES ('${COUPLE1}'), ('${COUPLE2}');
  INSERT INTO public.couple_members (couple_id, user_id, role, status) VALUES
    ('${COUPLE1}', '${A}', 'gomsin', 'active'),
    ('${COUPLE1}', '${B}', 'soldier', 'active'),
    ('${COUPLE2}', '${C}', 'gomsin', 'active');

  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private) VALUES
    ('${SHARED}',  '${A}', '${COUPLE1}', CURRENT_DATE, 'shared',  false),
    ('${PRIVATE}', '${A}', '${COUPLE1}', CURRENT_DATE, 'private', true),
    ('${OTHER}',   '${C}', '${COUPLE2}', CURRENT_DATE, 'other',   false);

  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('couple-media', '${COUPLE1}/${SHARED}/photo.jpg',  '${A}'),
    ('couple-media', '${COUPLE1}/${PRIVATE}/secret.jpg','${A}'),
    ('couple-media', '${COUPLE2}/${OTHER}/theirs.jpg',  '${C}');
`, 'fixture');

const sharedObj = `name = '${COUPLE1}/${SHARED}/photo.jpg'`;
const privateObj = `name = '${COUPLE1}/${PRIVATE}/secret.jpg'`;
const foreignObj = `name = '${COUPLE2}/${OTHER}/theirs.jpg'`;

// ---------------------------------------------------------------------------
// 028 — couple-media authorization
// ---------------------------------------------------------------------------

check(
  mustSql(`SELECT public FROM storage.buckets WHERE id = 'couple-media'`, 'bucket') === 'f',
  '028 the couple-media bucket is private',
);

// Read
checkVisible(A, sharedObj, 1, '028 owner reads their own shared media');
checkVisible(A, privateObj, 1, '028 owner reads their own private media');
checkVisible(B, sharedObj, 1, '028 active partner reads shared media');
checkVisible(B, privateObj, 0, "028 active partner CANNOT read the owner's private media");
checkVisible(C, sharedObj, 0, "028 unrelated user CANNOT read another couple's media");
checkVisible(C, privateObj, 0, "028 unrelated user CANNOT read another couple's private media");
checkVisible(A, foreignObj, 0, "028 owner CANNOT read an unrelated couple's media");

/**
 * Isolate the storage policy's own private-media clause.
 *
 * The assertion above passes even if `record.is_private = false` is deleted from
 * the SELECT policy, because the EXISTS subquery runs as the CALLING user and
 * `daily_records` RLS already hides A's private row from B. Two layers deny the
 * same thing, and the outer one is therefore untested by the natural fixture.
 *
 * A mutation test proved that: removing the clause left every assertion green.
 * So this block lends the partner enough record visibility to reach the storage
 * predicate, and requires storage to refuse on its own. Deleting the clause from
 * 028 now fails here, which is the whole point of keeping it.
 */
mustSql(
  `CREATE POLICY "harness_temporary_record_visibility" ON public.daily_records
     FOR SELECT TO authenticated USING (true)`,
  'temporary record visibility',
);
checkVisible(
  B, privateObj, 0,
  '028 storage refuses private media on its own, even when record RLS would allow the row',
);
checkVisible(
  B, sharedObj, 1,
  '028 the isolation policy is actually in force (shared media still readable)',
);
mustSql(
  `DROP POLICY "harness_temporary_record_visibility" ON public.daily_records`,
  'drop temporary record visibility',
);

/**
 * The symmetric check on the OTHER layer.
 *
 * Asserting this through `storage.objects` would be the mirror image of the same
 * mistake: the storage clause alone already denies, so the assertion would stay
 * green even if `daily_records` RLS stopped hiding private rows. Query the record
 * table directly, which is the only thing that isolates that layer.
 */
const partnerSeesRecords = asUser(
  B, `SELECT count(*) FROM public.daily_records WHERE id = '${PRIVATE}'`,
);
check(
  partnerSeesRecords.ok && partnerSeesRecords.stdout.trim() === '0',
  '028/009 record RLS independently hides the private record row from the partner',
);
const partnerSeesShared = asUser(
  B, `SELECT count(*) FROM public.daily_records WHERE id = '${SHARED}'`,
);
check(
  partnerSeesShared.ok && partnerSeesShared.stdout.trim() === '1',
  '028/009 the partner can still see the shared record row (the check discriminates)',
);

const anonRead = asAnon(`SELECT count(*) FROM storage.objects WHERE ${sharedObj}`);
check(
  !anonRead.ok || Number(anonRead.stdout.trim()) === 0,
  '028 anon CANNOT read couple media',
);

// Delete.
//
// An RLS-filtered DELETE is not an error — it simply matches no row and reports
// `DELETE 0`. So the assertion is the survival of the object, not the exit code:
// checking `ok === false` here would pass for a refusal that never happened.
function checkSurvivesDelete(actor, predicate, message) {
  asUser(actor, `DELETE FROM storage.objects WHERE ${predicate}`);
  const remaining = Number(mustSql(
    `SELECT count(*) FROM storage.objects WHERE ${predicate}`, 'delete recount',
  ));
  check(remaining === 1, `${message} (object ${remaining === 1 ? 'survived' : 'was DELETED'})`);
}

checkSurvivesDelete(B, sharedObj, "028 active partner CANNOT delete the owner's media");
checkSurvivesDelete(C, sharedObj, '028 unrelated user CANNOT delete couple media');

// Update — there is no UPDATE policy, so every actor must be refused.
for (const [actor, label] of [[A, 'owner'], [B, 'partner']]) {
  const update = asUser(actor, `UPDATE storage.objects SET name = name || '.x' WHERE ${sharedObj}`);
  const survived = Number(mustSql(
    `SELECT count(*) FROM storage.objects WHERE ${sharedObj}`, 'recount',
  )) === 1;
  check(update.ok === false || survived, `028 ${label} CANNOT rename an object (no UPDATE policy)`);
}

// Insert
const forged = asUser(B, `
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('couple-media', '${COUPLE1}/${SHARED}/forged.jpg', '${B}')`);
check(forged.ok === false, "028 partner CANNOT upload into the owner's record folder");

const crossCouple = asUser(C, `
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('couple-media', '${COUPLE1}/${SHARED}/inject.jpg', '${C}')`);
check(crossCouple.ok === false, '028 unrelated user CANNOT upload into another couple');

const ownUpload = asUser(A, `
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('couple-media', '${COUPLE1}/${SHARED}/second.jpg', '${A}')`);
check(ownUpload.ok === true, '028 owner CAN upload into their own record folder');

const flatPath = asUser(A, `
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('couple-media', 'loose.jpg', '${A}')`);
check(flatPath.ok === false, '028 a path outside {couple}/{record}/{file} is refused');

const deepPath = asUser(A, `
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('couple-media', '${COUPLE1}/${SHARED}/nested/deep.jpg', '${A}')`);
check(deepPath.ok === false, '028 a deeper path than the canonical three segments is refused');

// The remaining name guards. Each of these is refused by exactly one predicate,
// so deleting that predicate from 028 turns the corresponding assertion red.
for (const [label, objectName] of [
  ['a dot segment', `${COUPLE1}/${SHARED}/.hidden`],
  ['a leading-dot folder', `.${COUPLE1}/${SHARED}/photo.jpg`],
  ['a double slash', `${COUPLE1}//${SHARED}/photo.jpg`],
  ['a trailing slash (empty filename)', `${COUPLE1}/${SHARED}/`],
]) {
  const attempt = asUser(A, `
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('couple-media', '${objectName}', '${A}')`);
  check(attempt.ok === false, `028 ${label} in the object name is refused`);
}

/**
 * The account-deletion race guard on INSERT.
 *
 * 015 added `is_my_account_deletion_pending()` so an upload cannot land after the
 * Edge Function has enumerated the objects it is about to purge. Nothing else in
 * this fixture creates a pending request, so without this block the guard has no
 * coverage at all.
 */
mustSql(
  `INSERT INTO public.account_deletion_requests (user_id, expected_record_ids)
   VALUES ('${A}', ARRAY['${SHARED}']::uuid[])`,
  'pending deletion',
);
const uploadWhilePending = asUser(A, `
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('couple-media', '${COUPLE1}/${SHARED}/during-deletion.jpg', '${A}')`);
check(
  uploadWhilePending.ok === false,
  '028 an upload is refused while the owner has a pending account deletion',
);
checkVisible(A, sharedObj, 1, '028 a pending deletion does not block reads');
mustSql(`DELETE FROM public.account_deletion_requests WHERE user_id = '${A}'`, 'clear pending');

/**
 * The length guard on the READ and DELETE sides.
 *
 * Only a privileged writer can seed a non-canonical object, so the SELECT and
 * DELETE length predicates are unreachable from the INSERT tests above.
 */
mustSql(`
  INSERT INTO storage.objects (bucket_id, name, owner)
  VALUES ('couple-media', '${COUPLE1}/${SHARED}/nested/seeded.jpg', '${A}')
`, 'seed deep object');
const deepObj = `name = '${COUPLE1}/${SHARED}/nested/seeded.jpg'`;
checkVisible(A, deepObj, 0, '028 even the owner CANNOT read a non-canonical deep path');
checkSurvivesDelete(A, deepObj, '028 even the owner CANNOT delete a non-canonical deep path');
mustSql(`DELETE FROM storage.objects WHERE ${deepObj}`, 'remove seeded deep object');

// Owner deletes their own object.
const ownDelete = asUser(A, `DELETE FROM storage.objects WHERE name = '${COUPLE1}/${SHARED}/second.jpg'`);
check(
  ownDelete.ok
  && Number(mustSql(
    `SELECT count(*) FROM storage.objects WHERE name = '${COUPLE1}/${SHARED}/second.jpg'`, 'recount',
  )) === 0,
  '028 owner CAN delete their own media',
);

// Disconnect must close server-side authorization for both sides.
mustSql(`UPDATE public.couple_members SET status = 'disconnected' WHERE couple_id = '${COUPLE1}'`, 'disconnect');
checkVisible(B, sharedObj, 0, '028 a disconnected partner loses read access');
checkVisible(A, sharedObj, 0, '028 a disconnected owner loses read access through the couple predicate');
mustSql(`UPDATE public.couple_members SET status = 'active' WHERE couple_id = '${COUPLE1}'`, 'reconnect');
checkVisible(B, sharedObj, 1, '028 reconnecting restores partner read access');

// ---------------------------------------------------------------------------
// 029 — solo couple cleanup
// ---------------------------------------------------------------------------

/**
 * Two independent gates, tested independently.
 *
 * The EXECUTE grant stops an ordinary caller before the body runs, so asserting
 * only "an authenticated call fails" would stay green even if the in-body
 * `auth.role()` check were deleted — and it would also pass if the function
 * simply did not exist. Both assertions therefore match on the error text, and
 * the second one holds EXECUTE so it can reach the body.
 */
const authenticatedCall = asUser(A, `SELECT public.cleanup_account_solo_couples('${A}')`);
check(
  authenticatedCall.ok === false && /permission denied for function/.test(authenticatedCall.stderr),
  '029 an authenticated caller is refused by the EXECUTE grant',
);

// Holds EXECUTE (SET ROLE service_role) but presents no service_role claim.
const unclaimedCall = psql([
  '-At',
  '-c', 'SET ROLE service_role',
  '-c', `SELECT public.cleanup_account_solo_couples('${A}')`,
]);
check(
  unclaimedCall.ok === false && /Service role required/.test(unclaimedCall.stderr),
  '029 a caller holding EXECUTE but no service_role claim is refused by the in-body gate',
);

/**
 * The cascade 031 cares about most.
 *
 * `scope_keys.owner_couple_id` and `crypto_pairings.couple_id` are ON DELETE
 * CASCADE from `public.couples` (031:399, 031:947). 031 deliberately kept couple
 * keys OFF `auth.users` so that one account deletion could not shred the
 * partner's envelopes — and 029 reintroduces a route to them through the parent
 * couple row. These assertions pin that the route is only ever taken when there
 * is no partner left to strand.
 */
mustSql(`
  INSERT INTO public.scope_keys (domain, scope_id, owner_couple_id, key_epoch, state) VALUES
    ('couple', '${COUPLE1}', '${COUPLE1}', 1, 'ACTIVE'),
    ('couple', '${COUPLE2}', '${COUPLE2}', 1, 'ACTIVE');
`, 'seed couple scope keys');

// A paired couple must survive the departure of one member.
check(
  mustAsServiceRole(`SELECT public.cleanup_account_solo_couples('${A}')`, '029 paired') === '0',
  '029 a couple with a surviving member is NOT deleted',
);
check(
  mustSql(`SELECT count(*) FROM public.couples WHERE id = '${COUPLE1}'`, 'couple1') === '1',
  '029 the paired couple row still exists',
);
check(
  mustSql(`SELECT count(*) FROM public.daily_records WHERE couple_id = '${COUPLE1}'`, 'records') === '2',
  "029 the surviving partner's shared records are untouched",
);
check(
  mustSql(
    `SELECT count(*) FROM public.scope_keys WHERE owner_couple_id = '${COUPLE1}'`, 'csk1',
  ) === '1',
  "029 the surviving partner's couple scope key is NOT cascaded away",
);

// A former partner counts as a surviving member: still no deletion.
mustSql(`UPDATE public.couple_members SET status = 'disconnected' WHERE couple_id = '${COUPLE1}' AND user_id = '${B}'`, 'part');
check(
  mustAsServiceRole(`SELECT public.cleanup_account_solo_couples('${A}')`, '029 former') === '0',
  '029 a couple whose only other member is disconnected is still NOT deleted',
);

// A genuinely solo couple is cleaned up, deterministically.
check(
  mustAsServiceRole(`SELECT public.cleanup_account_solo_couples('${C}')`, '029 solo') === '1',
  '029 a sole-member couple IS deleted',
);
check(
  mustSql(`SELECT count(*) FROM public.couples WHERE id = '${COUPLE2}'`, 'couple2') === '0',
  '029 the solo couple row is gone',
);
check(
  mustSql(
    `SELECT count(*) FROM public.scope_keys WHERE owner_couple_id = '${COUPLE2}'`, 'csk2',
  ) === '0',
  '029 the solo couple\'s scope key cascades away with it (no surviving partner to strand)',
);
check(
  mustAsServiceRole(`SELECT public.cleanup_account_solo_couples('${C}')`, '029 repeat') === '0',
  '029 a second run deletes nothing (idempotent)',
);
check(
  mustSql(`SELECT count(*) FROM public.couples WHERE id = '${COUPLE1}'`, 'couple1 again') === '1',
  '029 cleaning one account never touches an unrelated couple',
);

// ---------------------------------------------------------------------------
// 030 — create_invitation search_path hardening
// ---------------------------------------------------------------------------

check(
  mustSql(`
    SELECT array_to_string(proconfig, ',') FROM pg_proc
    WHERE oid = 'public.create_invitation(uuid, text)'::regprocedure
  `, '030 proconfig') === 'search_path=public, pg_temp',
  '030 create_invitation pins search_path to public, pg_temp',
);
check(
  mustSql(`
    SELECT prosecdef::text FROM pg_proc
    WHERE oid = 'public.create_invitation(uuid, text)'::regprocedure
  `, '030 secdef') === 'true',
  '030 create_invitation is still SECURITY DEFINER',
);
check(
  mustSql(`
    SELECT has_function_privilege('authenticated', 'public.create_invitation(uuid, text)', 'EXECUTE')::text
  `, '030 grant') === 'true',
  '030 authenticated retains EXECUTE (no behavioural regression)',
);
check(
  mustSql(`
    SELECT has_function_privilege('anon', 'public.create_invitation(uuid, text)', 'EXECUTE')::text
  `, '030 anon') === 'false',
  '030 anon has no EXECUTE',
);

// The real proof: a temp-table shadow of couple_members must no longer be
// consulted. Before 030 this let a caller mint a code for someone else's couple.
mustSql(`UPDATE public.couple_members SET status = 'active' WHERE couple_id = '${COUPLE1}'`, 'restore');
const shadow = psql([
  '-At',
  '-c', 'SET ROLE authenticated',
  '-c', `DO $h$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${C}', false); END $h$`,
  // C is not a member of couple 1. Shadow the table the check reads.
  '-c', `CREATE TEMP TABLE couple_members (couple_id UUID, user_id UUID, status TEXT)`,
  '-c', `INSERT INTO couple_members VALUES ('${COUPLE1}', '${C}', 'active')`,
  '-c', `SELECT public.create_invitation('${COUPLE1}', 'attacker-chosen-hash')`,
]);
check(
  shadow.ok === false && /Active member access required/.test(shadow.stderr),
  '030 a pg_temp shadow of couple_members CANNOT mint a code for another couple',
);
check(
  mustSql(`SELECT count(*) FROM public.invitation_codes WHERE code_hash = 'attacker-chosen-hash'`, 'codes') === '0',
  '030 no invitation row was created by the shadowing attempt',
);

// A legitimate member still works.
const legit = asUser(A, `SELECT public.create_invitation('${COUPLE1}', 'legit-hash') IS NOT NULL`);
check(legit.ok && legit.stdout.trim() === 't', '030 an active member CAN still create an invitation');

// ---------------------------------------------------------------------------
// 037 — the real account-deletion ordering, across the survivor matrix
// ---------------------------------------------------------------------------

/**
 * Drive the sequence the Edge Function actually performs, not the RPC alone:
 *
 *   e2ee_prepare_account_deletion(A)   crypto
 *   -> prepare_account_deletion(A)     relational
 *   -> cleanup_account_solo_couples(A) couple metadata (029)
 *
 * The defect 037 fixes only appears across that ordering: step 1 decided "no
 * surviving partner" from `status = 'active'` and shredded the couple keys,
 * then step 3 correctly kept the couple row for a non-active member. Testing
 * either step alone shows nothing wrong.
 *
 * Step 2 is omitted deliberately. `prepare_account_deletion` touches records,
 * events and trips but never `couple_members.status` and never couple-owned
 * crypto, so it cannot influence this invariant; including it would add a large
 * fixture (expected_record_ids, plan ownership transfer) for no extra coverage.
 * Its own `status = 'active'` partner lookup governs who INHERITS shared plans,
 * which is a different question from who still needs a key, and 037 leaves it
 * alone on purpose.
 *
 * Each scenario gets its own couple and users so the cases cannot contaminate
 * one another.
 */

/** Fixed-width fixture bytes, in the shapes 031's CHECK constraints require. */
const spki = (seed) => `decode(repeat('${seed}', 91), 'hex')`;
const bytes32 = (seed) => `decode(repeat('${seed}', 32), 'hex')`;
const envelopeBytes = (seed) => `decode(repeat('${seed}', 360), 'hex')`;
/** A syntactically valid 445-byte GLDC1 certificate. Not a real signature — see p0-harness.mjs. */
const certificateBytes = (seed) =>
  `overlay(decode(repeat('${seed}', 445), 'hex') placing decode('474c4443', 'hex') from 1 for 4)`;

function deletionScenario({ label, partnerStatus, expectKeysSurvive }) {
  const suffix = label.replace(/[^a-z]/gi, '').slice(0, 4).toLowerCase().padEnd(4, 'x');
  const hex = [...suffix].map((c) => (c.charCodeAt(0) % 16).toString(16)).join('');
  const owner = `d0000000-0000-4000-8000-0000${hex}0001`;
  const partner = `d0000000-0000-4000-8000-0000${hex}0002`;
  const couple = `c0000000-0000-4000-8000-0000${hex}0003`;
  const device = `d0000000-0000-4000-8000-0000${hex}0004`;
  const key = `c0000000-0000-4000-8000-0000${hex}0005`;
  const recoveryId = `c0000000-0000-4000-8000-0000${hex}0006`;
  const anchorId = `c0000000-0000-4000-8000-0000${hex}0007`;
  const certId = `c0000000-0000-4000-8000-0000${hex}0008`;
  const envelopeId = `c0000000-0000-4000-8000-0000${hex}0009`;
  const otherRecord = `c0000000-0000-4000-8000-0000${hex}000a`;

  const members = partnerStatus === null
    ? `('${couple}', '${owner}', 'gomsin', 'active')`
    : `('${couple}', '${owner}', 'gomsin', 'active'),
       ('${couple}', '${partner}', 'soldier', '${partnerStatus}')`;

  mustSql(`
    INSERT INTO auth.users (id) VALUES ('${owner}')${partnerStatus === null ? '' : `, ('${partner}')`};
    INSERT INTO public.profiles (id, display_name, role) VALUES
      ('${owner}', 'owner', 'gomsin')${partnerStatus === null ? '' : `, ('${partner}', 'partner', 'soldier')`};
    INSERT INTO public.couples (id) VALUES ('${couple}');
    INSERT INTO public.couple_members (couple_id, user_id, role, status) VALUES ${members};

    -- Inserted BEFORE the write floor below: once a couple-scope floor row
    -- exists, enforce_e2ee_write_floor refuses any new plaintext
    -- daily_records write for this couple, and this fixture's plaintext
    -- shared record is a pre-existing row from before that floor activated,
    -- exactly like the write floor's own "legacy plaintext stays readable"
    -- contract.
    INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
      VALUES ('${otherRecord}', '${owner}', '${couple}', CURRENT_DATE, '${label} shared record', false);
    INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('couple-media', '${couple}/${otherRecord}/photo.jpg', '${owner}');

    INSERT INTO public.scope_keys (id, domain, scope_id, owner_couple_id, key_epoch, state)
      VALUES ('${key}', 'couple', '${couple}', '${couple}', 1, 'ACTIVE');
    INSERT INTO public.crypto_pairings (couple_id, state, pairing_nonce, transcript_hash, proposed_by_user_id)
      VALUES ('${couple}', 'CRYPTO_ACTIVE', decode(repeat('${hex.slice(0, 2)}', 32), 'hex'),
              decode(repeat('${hex.slice(2, 4)}', 32), 'hex'), '${owner}');
    INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format)
      VALUES ('couple', '${couple}', 1);
  `, `${label}: fixture`);

  // A REAL envelope chain for the partner: recovery identity -> public anchor
  // -> root device certificate -> device -> the envelope that actually wraps
  // the couple scope key to that device. Asserting "the scope key row still
  // exists" is not the same claim as "the surviving member can still open it";
  // the second claim needs this full chain, in the exact shapes 031's CHECK
  // constraints require (see scripts/e2ee/p0-harness.mjs for the same pattern).
  if (partnerStatus !== null) {
    mustSql(`
      INSERT INTO public.devices (id, user_id, sig_spki, kem_spki, platform, assurance, status)
      VALUES ('${device}', '${partner}', ${spki('ab')}, ${spki('cd')}, 'ios', 'secure_enclave', 'ACTIVE');

      INSERT INTO public.recovery_identities
        (id, user_id, recovery_version, recovery_salt, rec_sig_spki, rec_kem_spki,
         enc_rec_sig_priv, enc_rec_kem_priv, recovery_bundle_fp, bundle_sig)
      VALUES ('${recoveryId}', '${partner}', 1, ${bytes32('11')}, ${spki('11')}, ${spki('12')},
        decode(repeat('11', 150), 'hex'), decode(repeat('12', 150), 'hex'), ${bytes32('13')},
        decode(repeat('11', 64), 'hex'));

      INSERT INTO public.recovery_public_anchors
        (id, user_id, recovery_identity_id, recovery_version, rec_sig_spki, rec_sig_fp, recovery_bundle_fp)
      VALUES ('${anchorId}', '${partner}', '${recoveryId}', 1, ${spki('11')}, ${bytes32('14')}, ${bytes32('13')});

      INSERT INTO public.device_certificates
        (id, user_id, subject_device_id, issuer_device_id, issuer_certificate_id,
         recovery_public_anchor_id, recovery_identity_id, recovery_version,
         certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
      VALUES ('${certId}', '${partner}', '${device}', NULL, NULL, '${anchorId}', '${recoveryId}', 1,
        ${certificateBytes('ab')}, ${bytes32('15')}, ${spki('ab')}, ${spki('cd')});

      INSERT INTO public.key_envelopes
        (id, scope_key_id, recipient_kind, recipient_device_id, sender_device_id,
         sender_certificate_id, envelope, self_notarized)
      VALUES ('${envelopeId}', '${key}', 'device', '${device}', '${device}', '${certId}',
        ${envelopeBytes('99')}, true);
    `, `${label}: partner envelope chain`);
  }

  /**
   * Ground truth, checked once and reused by every disconnected/pending
   * scenario below: `key_envelopes` SELECT is gated purely on recipient
   * ownership (`recipient_device_id`'s `user_id = auth.uid()`), not on couple
   * membership status. A disconnected or pending member CAN still fetch the
   * bytes of an envelope addressed to their own device -- by design. The
   * architecture revokes by epoch rotation, not by deleting or hiding already
   * -issued envelopes (E2EE_PHASE_1A_ARCHITECTURE_V2_1.md §12: "keys already
   * held ... stay exposed"; AGENTS.md §10: previously accessed partner data
   * cannot be claimed remotely revocable). Asserting the opposite here would
   * be a false test, not a security proof, so this records what the harness
   * intentionally does NOT assert and why -- before proving what it does.
   */
  if (partnerStatus === 'disconnected' || partnerStatus === 'pending') {
    const envelopeStillFetchable = asUser(
      partner, `SELECT octet_length(envelope) FROM public.key_envelopes WHERE id = '${envelopeId}'`,
    );
    check(
      envelopeStillFetchable.ok && envelopeStillFetchable.stdout.trim() === '360',
      `037 ${label}: (expected, not a defect) the envelope recipient can still fetch their own row`,
    );
  }

  // The real ordering.
  const prepared = sql(`SELECT public.e2ee_prepare_account_deletion('${owner}')`);
  check(prepared.ok, `037 ${label}: e2ee preparation completes`);
  mustAsServiceRole(`SELECT public.cleanup_account_solo_couples('${owner}')`, `${label}: 029`);

  const keys = mustSql(
    `SELECT count(*) FROM public.scope_keys WHERE owner_couple_id = '${couple}'`, 'k',
  );
  const pairings = mustSql(
    `SELECT count(*) FROM public.crypto_pairings WHERE couple_id = '${couple}'`, 'p',
  );
  const floor = mustSql(
    `SELECT count(*) FROM public.crypto_write_floor WHERE scope_kind = 'couple' AND scope_id = '${couple}'`, 'f',
  );
  const coupleRow = mustSql(
    `SELECT count(*) FROM public.couples WHERE id = '${couple}'`, 'c',
  );

  const want = expectKeysSurvive ? '1' : '0';
  check(keys === want, `037 ${label}: couple scope key ${expectKeysSurvive ? 'SURVIVES' : 'is cleaned'} (saw ${keys})`);
  check(pairings === want, `037 ${label}: crypto pairing ${expectKeysSurvive ? 'SURVIVES' : 'is cleaned'} (saw ${pairings})`);
  check(floor === want, `037 ${label}: couple write floor ${expectKeysSurvive ? 'SURVIVES' : 'is cleaned'} (saw ${floor})`);

  // The invariant that binds the two layers together: the couple row and its
  // cryptographic state must appear or disappear TOGETHER. Comparing each to
  // `want` separately would let the split-brain through — that is exactly the
  // shape of the bug, a surviving row beside destroyed keys — so compare them
  // to each other as well.
  check(coupleRow === want, `037 ${label}: couple row is ${want === '1' ? 'kept' : 'removed'} (saw ${coupleRow})`);
  check(
    coupleRow === keys,
    `037 ${label}: couple row and couple keys agree (row=${coupleRow}, keys=${keys})`,
  );

  if (partnerStatus !== null) {
    // THE REQUESTED PROOF, on the real row: not "a scope key with this
    // owner_couple_id exists somewhere" but "the specific envelope addressed
    // to B's device, wrapping the specific couple epoch B needs, is still
    // there after the real deletion sequence."
    const envelopeSurvives = mustSql(
      `SELECT count(*) FROM public.key_envelopes WHERE id = '${envelopeId}' AND scope_key_id = '${key}'`,
      'envelope recount',
    );
    check(
      envelopeSurvives === want,
      `037 ${label}: B's actual envelope for the couple epoch ${expectKeysSurvive ? 'SURVIVES' : 'is cleaned (cascaded from scope_keys)'} (saw ${envelopeSurvives})`,
    );
  }

  /**
   * THE REAL ENFORCEMENT PATH for "preserved crypto does not restore
   * authorization": the couple `scope_keys` row -- the thing that tells a
   * client which epoch is current -- is gated on active membership, and
   * neither the shared record nor the shared media object becomes reachable
   * merely because the underlying keys survived. This is the actual
   * RLS-protected relation the application uses, not an isolated read of
   * `get_my_active_couple_id()`.
   */
  if (partnerStatus === 'disconnected' || partnerStatus === 'pending') {
    const scopeKeyVisible = asUser(
      partner, `SELECT count(*) FROM public.scope_keys WHERE id = '${key}'`,
    );
    check(
      scopeKeyVisible.ok && scopeKeyVisible.stdout.trim() === '0',
      `037 ${label}: B still CANNOT see the couple scope_keys row through authenticated RLS`,
    );
    const recordVisible = asUser(
      partner, `SELECT count(*) FROM public.daily_records WHERE id = '${otherRecord}'`,
    );
    check(
      recordVisible.ok && recordVisible.stdout.trim() === '0',
      `037 ${label}: B still CANNOT read the couple's shared daily_records row`,
    );
    const mediaVisible = asUser(
      partner, `SELECT count(*) FROM storage.objects WHERE name = '${couple}/${otherRecord}/photo.jpg'`,
    );
    check(
      mediaVisible.ok && mediaVisible.stdout.trim() === '0',
      `037 ${label}: B still CANNOT read the couple's shared storage object`,
    );
  }
}

deletionScenario({ label: 'active survivor', partnerStatus: 'active', expectKeysSurvive: true });
deletionScenario({ label: 'disconnected survivor', partnerStatus: 'disconnected', expectKeysSurvive: true });
deletionScenario({ label: 'pending survivor', partnerStatus: 'pending', expectKeysSurvive: true });
deletionScenario({ label: 'truly solo', partnerStatus: null, expectKeysSurvive: false });

/**
 * The deleting user's own membership need not be active either.
 *
 * A mutual disconnect leaves BOTH rows non-active. The 031 body located the
 * couple through the deleting user's own ACTIVE row, so this case skipped
 * couple cleanup entirely and stranded a write floor that no cascade can reach
 * (`crypto_write_floor` has no foreign key to `couples`).
 */
const soloD = 'd0000000-0000-4000-8000-00000000ff01';
const coupleD = 'c0000000-0000-4000-8000-00000000ff02';
mustSql(`
  INSERT INTO auth.users (id) VALUES ('${soloD}');
  INSERT INTO public.profiles (id, display_name, role) VALUES ('${soloD}', 'solo', 'gomsin');
  INSERT INTO public.couples (id) VALUES ('${coupleD}');
  INSERT INTO public.couple_members (couple_id, user_id, role, status)
    VALUES ('${coupleD}', '${soloD}', 'gomsin', 'disconnected');
  INSERT INTO public.scope_keys (domain, scope_id, owner_couple_id, key_epoch, state)
    VALUES ('couple', '${coupleD}', '${coupleD}', 1, 'ACTIVE');
  INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format)
    VALUES ('couple', '${coupleD}', 1);
`, 'disconnected solo fixture');
mustSql(`SELECT public.e2ee_prepare_account_deletion('${soloD}')`, 'disconnected solo prepare');
check(
  mustSql(
    `SELECT count(*) FROM public.crypto_write_floor WHERE scope_kind = 'couple' AND scope_id = '${coupleD}'`, 'f',
  ) === '0',
  '037 a disconnected sole member still gets their couple write floor cleaned (no unreachable orphan)',
);

/**
 * Direct proof of the FK cascade the solo branch relies on.
 *
 * In the "truly solo" scenario above, RECIPIENT OWNED already deletes the
 * lone user's own envelope before the couple-scope loop ever runs, so that
 * scenario alone cannot show whether `DELETE FROM scope_keys WHERE
 * domain = 'couple' ...` genuinely cascades to `key_envelopes` -- it never had
 * anything left to cascade. A row can still be left over for a device that no
 * longer belongs to any current couple member (e.g. an account that already
 * completed its OWN deletion earlier while this couple still had a survivor,
 * or any future write path RECIPIENT OWNED does not anticipate), and 037's
 * solo cleanup must still remove it. Proven directly against the schema's
 * `ON DELETE CASCADE`, independent of ordering with the RPC's other deletes.
 */
const cascadeCouple = 'c0000000-0000-4000-8000-0000cacd0001';
const cascadeKey = 'c0000000-0000-4000-8000-0000cacd0002';
const cascadeUser = 'd0000000-0000-4000-8000-0000cacd0003';
const cascadeDevice = 'd0000000-0000-4000-8000-0000cacd0004';
const cascadeRecovery = 'c0000000-0000-4000-8000-0000cacd0005';
const cascadeAnchor = 'c0000000-0000-4000-8000-0000cacd0006';
const cascadeCert = 'c0000000-0000-4000-8000-0000cacd0007';
const cascadeEnvelope = 'c0000000-0000-4000-8000-0000cacd0008';
mustSql(`
  INSERT INTO auth.users (id) VALUES ('${cascadeUser}');
  INSERT INTO public.couples (id) VALUES ('${cascadeCouple}');
  INSERT INTO public.scope_keys (id, domain, scope_id, owner_couple_id, key_epoch, state)
    VALUES ('${cascadeKey}', 'couple', '${cascadeCouple}', '${cascadeCouple}', 1, 'ACTIVE');
  INSERT INTO public.devices (id, user_id, sig_spki, kem_spki, platform, assurance, status)
    VALUES ('${cascadeDevice}', '${cascadeUser}', ${spki('c1')}, ${spki('c2')}, 'ios', 'secure_enclave', 'ACTIVE');
  INSERT INTO public.recovery_identities
    (id, user_id, recovery_version, recovery_salt, rec_sig_spki, rec_kem_spki,
     enc_rec_sig_priv, enc_rec_kem_priv, recovery_bundle_fp, bundle_sig)
    VALUES ('${cascadeRecovery}', '${cascadeUser}', 1, ${bytes32('c3')}, ${spki('c3')}, ${spki('c4')},
      decode(repeat('c3', 150), 'hex'), decode(repeat('c4', 150), 'hex'), ${bytes32('c5')},
      decode(repeat('c3', 64), 'hex'));
  INSERT INTO public.recovery_public_anchors
    (id, user_id, recovery_identity_id, recovery_version, rec_sig_spki, rec_sig_fp, recovery_bundle_fp)
    VALUES ('${cascadeAnchor}', '${cascadeUser}', '${cascadeRecovery}', 1, ${spki('c3')}, ${bytes32('c6')}, ${bytes32('c5')});
  INSERT INTO public.device_certificates
    (id, user_id, subject_device_id, issuer_device_id, issuer_certificate_id,
     recovery_public_anchor_id, recovery_identity_id, recovery_version,
     certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
    VALUES ('${cascadeCert}', '${cascadeUser}', '${cascadeDevice}', NULL, NULL, '${cascadeAnchor}', '${cascadeRecovery}', 1,
      ${certificateBytes('c1')}, ${bytes32('c7')}, ${spki('c1')}, ${spki('c2')});
  INSERT INTO public.key_envelopes
    (id, scope_key_id, recipient_kind, recipient_device_id, sender_device_id, sender_certificate_id, envelope, self_notarized)
    VALUES ('${cascadeEnvelope}', '${cascadeKey}', 'device', '${cascadeDevice}', '${cascadeDevice}', '${cascadeCert}',
      ${envelopeBytes('c9')}, true);
`, 'cascade fixture: an envelope with no owning couple_members row at all');

check(
  mustSql(`SELECT count(*) FROM public.key_envelopes WHERE id = '${cascadeEnvelope}'`, 'before') === '1',
  '037 cascade proof: the envelope exists before cleanup',
);
// Exactly the predicate 037's solo branch runs.
mustSql(
  `DELETE FROM public.scope_keys WHERE domain = 'couple' AND owner_couple_id = '${cascadeCouple}'`,
  'cascade proof: couple scope key delete',
);
check(
  mustSql(`SELECT count(*) FROM public.key_envelopes WHERE id = '${cascadeEnvelope}'`, 'after') === '0',
  '037 cascade proof: deleting the couple scope key CASCADES to its envelope',
);

// ---------------------------------------------------------------------------
// 038 — bilateral talk-about marks, as real RLS actors
// ---------------------------------------------------------------------------

/**
 * The fixture from the top of this file is reused: A and B are the active
 * couple 1, C is an unrelated user in couple 2, SHARED is A's shared record
 * and PRIVATE is A's private one.
 *
 * Every assertion below runs as `authenticated` with a real JWT subject, so
 * the thing under test is the policy, not a client-side filter.
 */
/** A second shared record for couple 1, created by this block. */
const OTHER2 = 'a0000000-0000-4000-8000-00000000ab01';

function marksVisibleTo(userId) {
  const result = asUser(userId, `SELECT count(*) FROM public.talk_about_marks`);
  return result.ok ? Number(result.stdout.trim()) : -1;
}

function markAs(userId, recordId, coupleId) {
  return asUser(userId, `
    INSERT INTO public.talk_about_marks (record_id, couple_id, actor_user_id)
    VALUES ('${recordId}', '${coupleId}', '${userId}')`);
}

// Reset to a clean, fully-active couple 1 (earlier blocks toggled membership).
mustSql(
  `UPDATE public.couple_members SET status = 'active' WHERE couple_id = '${COUPLE1}'`,
  'reactivate couple 1',
);
mustSql(`DELETE FROM public.talk_about_marks`, 'clear marks');

// --- The feature itself: both partners can mark, both can see -------------
const ownerMark = markAs(A, SHARED, COUPLE1);
check(ownerMark.ok, '038 the record owner CAN mark their own shared record');

const partnerMark = markAs(B, SHARED, COUPLE1);
check(
  partnerMark.ok,
  '038 the active partner CAN mark the other partner\'s shared record (the bilateral point)',
);

check(marksVisibleTo(A) === 2, '038 A sees both marks (own and partner\'s)');
check(marksVisibleTo(B) === 2, '038 B sees both marks (own and partner\'s)');

check(
  mustSql(
    `SELECT count(DISTINCT actor_user_id) FROM public.talk_about_marks WHERE record_id = '${SHARED}'`,
    'attribution',
  ) === '2',
  '038 each mark is attributed to its own actor, so "who marked this" is representable',
);

// --- Determinism: a repeat mark is not a second row -----------------------
const duplicate = asUser(A, `
  INSERT INTO public.talk_about_marks (record_id, couple_id, actor_user_id)
  VALUES ('${SHARED}', '${COUPLE1}', '${A}')
  ON CONFLICT (record_id, actor_user_id) DO NOTHING`);
check(
  duplicate.ok && marksVisibleTo(A) === 2,
  '038 re-marking is idempotent under ON CONFLICT -- no duplicate row',
);
const rawDuplicate = markAs(A, SHARED, COUPLE1);
check(
  rawDuplicate.ok === false && /duplicate key|unique/i.test(rawDuplicate.stderr),
  '038 a bare duplicate INSERT is refused by the uniqueness constraint, not silently doubled',
);

// --- Private records are not markable by the partner ----------------------
const partnerMarksPrivate = markAs(B, PRIVATE, COUPLE1);
check(
  partnerMarksPrivate.ok === false,
  "038 the partner CANNOT mark the owner's private record",
);
const ownerMarksPrivate = markAs(A, PRIVATE, COUPLE1);
check(
  ownerMarksPrivate.ok === false,
  '043 the OWNER CANNOT mark an own-private record; Conversation Bridge is shared-record only',
);

/**
 * Isolate the policy's own `is_private` clause.
 *
 * The assertion above passes even with that clause deleted, because
 * `daily_records` RLS already hides A's private row from B's sub-select --
 * the same two-layers-deny-the-same-thing trap that made an earlier storage
 * assertion in this file vacuous. Lending B enough record visibility to
 * reach the mark policy leaves only the outer clause standing.
 */
mustSql(
  `CREATE POLICY "harness_tmp_all_records" ON public.daily_records
     FOR SELECT TO authenticated USING (true)`,
  'temporary record visibility',
);
const partnerMarksPrivateIsolated = markAs(B, PRIVATE, COUPLE1);
check(
  partnerMarksPrivateIsolated.ok === false,
  '043 the mark policy refuses any private target ON ITS OWN, even when record RLS would allow the read',
);
mustSql(
  `DROP POLICY "harness_tmp_all_records" ON public.daily_records`,
  'drop temporary record visibility',
);

// --- Cross-couple: C is in couple 2 and must reach nothing ----------------
check(marksVisibleTo(C) === 0, "038 an unrelated user CANNOT read another couple's marks");
check(
  markAs(C, SHARED, COUPLE1).ok === false,
  "038 an unrelated user CANNOT mark another couple's record",
);
// ...including when they attribute the row to themselves and name their OWN
// couple, but point `record_id` at a record they do not own. This is the
// forged-id case, and it is the record/couple agreement clause that stops it.
check(
  markAs(C, SHARED, COUPLE2).ok === false,
  '038 a forged record_id from another couple is refused even under the caller\'s own couple_id',
);
asUser(C, `DELETE FROM public.talk_about_marks WHERE record_id = '${SHARED}'`);
check(
  Number(mustSql(
    `SELECT count(*) FROM public.talk_about_marks WHERE record_id = '${SHARED}'`, 'survive',
  )) === 2,
  "038 an unrelated user CANNOT delete another couple's marks",
);

// --- No UPDATE path at all ------------------------------------------------
const updateAttempt = asUser(B, `
  UPDATE public.talk_about_marks SET created_at = now() - interval '1 year'
  WHERE record_id = '${SHARED}'`);
check(
  updateAttempt.ok === false && /permission denied/i.test(updateAttempt.stderr),
  '038 nobody can UPDATE a mark -- there is no grant and no policy',
);

// --- created_at cannot be forged (column-level INSERT grant) --------------
const forgedTimestamp = asUser(B, `
  INSERT INTO public.talk_about_marks (record_id, couple_id, actor_user_id, created_at)
  VALUES ('${OTHER}', '${COUPLE1}', '${B}', now() + interval '10 years')`);
check(
  forgedTimestamp.ok === false && /permission denied/i.test(forgedTimestamp.stderr),
  '038 a client CANNOT supply created_at -- the column-level grant omits it',
);

// --- Attribution cannot be forged ----------------------------------------
mustSql(`DELETE FROM public.talk_about_marks WHERE record_id = '${SHARED}' AND actor_user_id = '${B}'`, 'tidy');
check(
  asUser(B, `
    INSERT INTO public.talk_about_marks (record_id, couple_id, actor_user_id)
    VALUES ('${SHARED}', '${COUPLE1}', '${A}')`).ok === false,
  '038 B CANNOT create a mark attributed to A',
);

// --- Either partner may complete, which is the 이야기했어요 resolution -----
markAs(B, SHARED, COUPLE1);
const partnerClears = asUser(B, `
  DELETE FROM public.talk_about_marks WHERE record_id = '${SHARED}' AND actor_user_id = '${A}'`);
check(
  partnerClears.ok
  && Number(mustSql(
    `SELECT count(*) FROM public.talk_about_marks WHERE record_id = '${SHARED}' AND actor_user_id = '${A}'`,
    'cleared',
  )) === 0,
  '038 either partner may withdraw the other\'s mark before completion',
);

mustSql(`DELETE FROM public.talk_about_marks WHERE record_id = '${SHARED}'`, 'reset before completion');
markAs(A, SHARED, COUPLE1);
markAs(B, SHARED, COUPLE1);
const partnerCompletes = asUser(B, `
  UPDATE public.talk_about_marks SET is_completed = true WHERE record_id = '${SHARED}'`);
check(
  partnerCompletes.ok
  && Number(mustSql(
    `SELECT count(*) FROM public.talk_about_marks WHERE record_id = '${SHARED}' AND is_completed = true`,
    'completed',
  )) === 2,
  '043 either active partner CAN complete both marks without changing the source record',
);
const reopenAttempt = asUser(B, `
  UPDATE public.talk_about_marks SET is_completed = false WHERE record_id = '${SHARED}'`);
check(
  reopenAttempt.ok
  && Number(mustSql(
    `SELECT count(*) FROM public.talk_about_marks WHERE record_id = '${SHARED}' AND is_completed = false`,
    'completion remains monotonic',
  )) === 0,
  '043 a completed topic CANNOT be reopened through the client update path',
);
const reMarkCompleted = asUser(A, `
  DELETE FROM public.talk_about_marks
  WHERE record_id = '${SHARED}' AND actor_user_id = '${A}' AND is_completed = true`);
const reMarkAfterCompletion = markAs(A, SHARED, COUPLE1);
check(
  reMarkCompleted.ok
  && reMarkAfterCompletion.ok
  && Number(mustSql(
    `SELECT count(*) FROM public.talk_about_marks WHERE record_id = '${SHARED}' AND actor_user_id = '${A}' AND is_completed = false`,
    're-marked pending item',
  )) === 1,
  '043 a user can create one new pending mark after completing their earlier mark',
);
mustSql(`DELETE FROM public.talk_about_marks WHERE record_id = '${SHARED}'`, 'tidy completed marks');

// --- Record deletion keeps only the opaque source id -----------------------
mustSql(`DELETE FROM public.talk_about_marks`, 'reset');
markAs(A, SHARED, COUPLE1);
check(
  Number(mustSql(`SELECT count(*) FROM public.talk_about_marks`, 'before')) === 1,
  '038 a mark exists before the record is deleted',
);
mustSql(`DELETE FROM public.daily_records WHERE id = '${SHARED}'`, 'delete record');
check(
  Number(mustSql(`SELECT count(*) FROM public.talk_about_marks`, 'after')) === 1
  && mustSql(`SELECT record_id FROM public.talk_about_marks LIMIT 1`, 'opaque source id') === SHARED,
  '043 deleting the record retains only its opaque id for a generic unavailable Conversation Bridge item',
);
mustSql(`DELETE FROM public.talk_about_marks`, 'tidy deleted-source mark');

// --- Disconnect closes access both ways -----------------------------------
mustSql(`
  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
  VALUES ('${OTHER2}', '${A}', '${COUPLE1}', CURRENT_DATE, 'post-delete shared', false)
`, 'reseed shared record');
markAs(A, OTHER2, COUPLE1);
check(marksVisibleTo(B) === 1, '038 the partner sees the mark while the couple is active');

mustSql(
  `UPDATE public.daily_records SET is_private = true WHERE id = '${OTHER2}'`,
  'make marked record private',
);
check(
  marksVisibleTo(B) === 0,
  '043 making a previously shared record private removes its marks before they can reveal private-record existence',
);
mustSql(
  `UPDATE public.daily_records SET is_private = false WHERE id = '${OTHER2}'`,
  'restore shared record for disconnect assertions',
);
markAs(A, OTHER2, COUPLE1);

mustSql(
  `UPDATE public.couple_members SET status = 'disconnected' WHERE couple_id = '${COUPLE1}'`,
  'disconnect',
);
check(marksVisibleTo(B) === 0, '038 a disconnected partner CANNOT read the marks');
check(marksVisibleTo(A) === 0, '038 a disconnected owner loses access through the same predicate');
check(
  markAs(B, OTHER2, COUPLE1).ok === false,
  '038 a disconnected partner CANNOT create a new mark',
);

/**
 * Isolate the ACTIVE-membership gate on INSERT.
 *
 * The assertion above passes even if the policy accepts any membership row
 * regardless of status, because `daily_records`' own partner-read policy is
 * also scoped to the active couple -- so the EXISTS sub-select fails first
 * and the membership clause is never reached. Verified by mutation: weakening
 * `couple_id = get_my_active_couple_id()` to a plain membership lookup left
 * every assertion green. Lending the disconnected partner record visibility
 * removes the inner layer and leaves only the gate under test.
 */
mustSql(
  `CREATE POLICY "harness_tmp_all_records_disc" ON public.daily_records
     FOR SELECT TO authenticated USING (true)`,
  'temporary record visibility (disconnect)',
);
check(
  markAs(B, OTHER2, COUPLE1).ok === false,
  '038 the INSERT policy refuses a disconnected member ON ITS OWN, even when the record is readable',
);
mustSql(
  `DROP POLICY "harness_tmp_all_records_disc" ON public.daily_records`,
  'drop temporary record visibility (disconnect)',
);
asUser(B, `DELETE FROM public.talk_about_marks WHERE record_id = '${OTHER2}'`);
check(
  Number(mustSql(`SELECT count(*) FROM public.talk_about_marks WHERE record_id = '${OTHER2}'`, 'still')) === 1,
  '038 a disconnected partner CANNOT delete an existing mark',
);

mustSql(
  `UPDATE public.couple_members SET status = 'active' WHERE couple_id = '${COUPLE1}'`,
  'reconnect',
);
check(marksVisibleTo(B) === 1, '038 reconnecting restores read access');

// --- anon gets nothing ----------------------------------------------------
const anonMarkRead = asAnon(`SELECT count(*) FROM public.talk_about_marks`);
check(
  !anonMarkRead.ok || Number(anonMarkRead.stdout.trim()) === 0,
  '038 anon CANNOT read marks',
);
const anonMarkWrite = asAnon(`
  INSERT INTO public.talk_about_marks (record_id, couple_id, actor_user_id)
  VALUES ('${OTHER2}', '${COUPLE1}', '${A}')`);
check(anonMarkWrite.ok === false, '038 anon CANNOT create a mark');

// --- daily_records write access is exactly as it was ----------------------
// The reason this table exists at all: adding the feature must not have
// widened the partner's access to the author's record row.
asUser(B, `
  UPDATE public.daily_records SET log_text = 'partner overwrote this' WHERE id = '${OTHER2}'`);
check(
  Number(mustSql(
    `SELECT count(*) FROM public.daily_records WHERE id = '${OTHER2}' AND log_text = 'post-delete shared'`,
    'unchanged',
  )) === 1,
  '038 the partner STILL cannot write the author\'s daily_records row',
);

// ---------------------------------------------------------------------------
// 047 — the care-signal vocabulary, asserted against the database
//
// 047 was reviewed and its client-side vocabulary is pinned in
// `featurePrivacy.test.ts`, but nothing checked the CHECK itself against a real
// database. It joined the chain as "applies cleanly", which is a different claim
// from "accepts one kind and refuses the graded ones".
//
// That gap matters more in the COMBINED tree than it did alone: 048-050 run
// after 047 here for the first time, and a later migration that redefined this
// constraint would have gone unnoticed.
// ---------------------------------------------------------------------------

const kindCheck = mustSql(`
  SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'public.cycle_support_signals'::regclass
    AND conname = 'cycle_support_signals_kind_check'`, '047 constraint');

check(
  kindCheck.includes('feeling_unwell'),
  '047 the approved kind survives every migration that runs after it',
);
for (const refused of ['pain_mild', 'pain_moderate', 'pain_severe']) {
  check(
    !kindCheck.includes(refused),
    `047 the graded pain vocabulary the review refused is absent (${refused})`,
  );
}
check(
  (kindCheck.match(/'/g) ?? []).length / 2 === 5,
  `047 the vocabulary is exactly five kinds (got: ${kindCheck})`,
);

// And the constraint actually behaves, rather than merely reading correctly.
/*
  Inserted as the OWNER, the way the product does it.

  A superuser insert is refused by 014's workspace trigger ("Support signal is
  outside the active couple workspace"), which is the correct behaviour and
  is itself worth having crossed: the vocabulary check is not the only thing
  standing between a caller and this table.
*/
check(
  asUser(A, `
    INSERT INTO public.cycle_support_signals (couple_id, owner_id, shared_for_date, kind)
    VALUES ('${COUPLE1}', '${A}', CURRENT_DATE, 'feeling_unwell')`).ok,
  '047 the owner can actually send the approved kind',
);
check(
  !asUser(A, `
    INSERT INTO public.cycle_support_signals (couple_id, owner_id, shared_for_date, kind)
    VALUES ('${COUPLE1}', '${A}', CURRENT_DATE - 1, 'pain_severe')`).ok,
  '047 a graded pain kind is refused by the database, not merely by the client',
);
check(
  !asUser(B, `
    INSERT INTO public.cycle_support_signals (couple_id, owner_id, shared_for_date, kind)
    VALUES ('${COUPLE1}', '${A}', CURRENT_DATE - 2, 'feeling_unwell')`).ok,
  '047 the partner cannot send a care signal ON THE OWNER\'S BEHALF',
);

// ---------------------------------------------------------------------------
// 048 — push delivery metadata
//
// The rule this section exists for is the negative one. A `나만 보기` record is
// invisible to the partner, so notifying them about it would leak the single fact
// the privacy setting exists to hide: that anything was written at all. Everything
// else here is ordinary authorization; that one is the product.
// ---------------------------------------------------------------------------

const D = 'dddddddd-0000-4000-8000-00000000000d';
const E = 'eeeeeeee-0000-4000-8000-00000000000e';
const COUPLE3 = '33333333-0000-4000-8000-000000000003';

mustSql(`
  INSERT INTO auth.users (id, email) VALUES
    ('${D}', 'd@example.test'), ('${E}', 'e@example.test');
  INSERT INTO public.profiles (id, display_name, role) VALUES
    ('${D}', 'D', 'gomsin'), ('${E}', 'E', 'soldier');
  INSERT INTO public.couples (id) VALUES ('${COUPLE3}');
  INSERT INTO public.couple_members (couple_id, user_id, role, status) VALUES
    ('${COUPLE3}', '${D}', 'gomsin', 'active'),
    ('${COUPLE3}', '${E}', 'soldier', 'active');
`, '048 fixture');

function unseenOf(userId) {
  // COALESCE, because "no row yet" and "row saying false" are the same fact: this
  // person has nothing waiting. A missing row is the normal state before the first
  // act, not an error.
  return mustSql(
    `SELECT COALESCE((SELECT has_unseen FROM public.push_delivery_state WHERE user_id = '${userId}'), FALSE)`,
    'read has_unseen',
  );
}

// --- the flag is raised by an act, and only by a visible one ----------------

check(unseenOf(E) === 'f', '048 a fresh membership starts with nothing to be invited back for');

mustSql(`
  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
  VALUES ('d0000000-0000-4000-8000-000000000001', '${D}', '${COUPLE3}', CURRENT_DATE, 'shared', false)`,
  '048 shared insert');
check(unseenOf(E) === 't', '048 a SHARED record raises the partner\'s merged flag');
check(unseenOf(D) === 'f', '048 the author is never notified about their own act');

mustSql(`UPDATE public.push_delivery_state SET has_unseen = FALSE WHERE user_id IN ('${D}', '${E}')`, 'reset');
mustSql(`
  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
  VALUES ('d0000000-0000-4000-8000-000000000002', '${D}', '${COUPLE3}', CURRENT_DATE, 'private', true)`,
  '048 private insert');
check(
  unseenOf(E) === 'f',
  '048 a PRIVATE record raises NOTHING, so the notification cannot leak that it exists',
);

/*
  051 -- and retracting a shared record takes the invitation back with it.

  048 attached its trigger to AFTER INSERT only, so the guard it calls "the
  single most important line in the file" held at insert and not across the
  flip. Post, change your mind, make it private: the partner is still summoned,
  and arrives to nothing. The payload is generic, so no content leaks -- but the
  bit that does leak is the one the privacy switch exists to withhold, that
  something was written.

  The second case is why the fix is conditional. Another shared record of the
  author's is still a real thing the partner has not been told about, and
  clearing the flag would swallow it.
*/
mustSql(`UPDATE public.push_delivery_state SET has_unseen = FALSE WHERE user_id IN ('${D}', '${E}')`, 'reset 2');
mustSql(`UPDATE public.daily_records SET is_private = false
         WHERE id = 'd0000000-0000-4000-8000-000000000002'`, '051 share it');
check(unseenOf(E) === 't', '051 sharing a previously private record raises the flag');
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'd0000000-0000-4000-8000-000000000001'`, '051 retract the other');
check(
  unseenOf(E) === 't',
  '051 retracting ONE record leaves the flag up, because another is still shared',
);
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'd0000000-0000-4000-8000-000000000002'`, '051 retract the last');
check(
  unseenOf(E) === 'f',
  '051 retracting the LAST shared record lowers it, so nobody is summoned to nothing',
);

/*
  052 -- and the same is true when the record stops existing.

  048 and 051 both reasoned about `is_private` changing and neither about the row
  going away. Deleting a shared record left the partner summoned to a couple
  space with nothing in it.

  The instance that matters is not deletion by hand. `daily_records.user_id` is
  ON DELETE CASCADE from `auth.users`, so closing an account deletes everything
  that account wrote -- and the surviving partner was then told, in their next
  contact window, that their partner had ACTED. What happened is that they left.
*/
mustSql(`UPDATE public.push_delivery_state SET has_unseen = FALSE WHERE user_id IN ('${D}', '${E}')`, 'reset 3');
mustSql(`
  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
  VALUES ('d0000000-0000-4000-8000-000000000003', '${D}', '${COUPLE3}', CURRENT_DATE, 'first', false),
         ('d0000000-0000-4000-8000-000000000004', '${D}', '${COUPLE3}', CURRENT_DATE, 'second', false)`,
  '052 two shared');
check(unseenOf(E) === 't', '052 two shared records raise the flag');
mustSql(`DELETE FROM public.daily_records WHERE id = 'd0000000-0000-4000-8000-000000000003'`, '052 delete one');
check(
  unseenOf(E) === 't',
  '052 deleting ONE leaves the flag up, because another is still shared',
);
mustSql(`DELETE FROM public.daily_records WHERE id = 'd0000000-0000-4000-8000-000000000004'`, '052 delete last');
check(
  unseenOf(E) === 'f',
  '052 deleting the LAST shared record lowers it, on the path 051 did not cover',
);

// A private record never raised anything, so removing it must not lower a flag
// that something else put up.
mustSql(`INSERT INTO public.push_delivery_state (user_id, has_unseen) VALUES ('${E}', TRUE)
     ON CONFLICT (user_id) DO UPDATE SET has_unseen = TRUE`, '052 raise by hand');
mustSql(`
  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
  VALUES ('d0000000-0000-4000-8000-000000000005', '${D}', '${COUPLE3}', CURRENT_DATE, 'private', true)`,
  '052 private insert');
mustSql(`DELETE FROM public.daily_records WHERE id = 'd0000000-0000-4000-8000-000000000005'`, '052 delete private');
check(
  unseenOf(E) === 't',
  '052 removing a PRIVATE record lowers nothing, because it never raised anything',
);
mustSql(`UPDATE public.push_delivery_state SET has_unseen = FALSE WHERE user_id = '${E}'`, 'reset 4');



// --- the partner cannot observe the flag ------------------------------------
// `has_unseen` is delivery state, not a read receipt. A read receipt is defined
// by the PARTNER learning something, so the test is that they cannot.

mustSql(`INSERT INTO public.push_delivery_state (user_id, has_unseen) VALUES ('${E}', TRUE)
     ON CONFLICT (user_id) DO UPDATE SET has_unseen = TRUE`, 'raise');
const partnerReadsFlag = asUser(D, `
  SELECT count(*) FROM public.push_delivery_state WHERE user_id = '${E}' AND has_unseen IS TRUE`);
check(
  !partnerReadsFlag.ok || partnerReadsFlag.stdout.trim() === '0',
  '048 the partner CANNOT read the other side\'s delivery flag',
);

// --- who may ask who to notify ----------------------------------------------
// The Edge Function's whole view of the world. If `authenticated` could call it,
// any account could enumerate every couple's delivery schedule.

check(asUser(E, `SELECT public.register_push_token('ios', 'token-e')`).ok
  && asUser(D, `SELECT public.register_push_token('android', 'token-d')`).ok,
  '048 an account can register its own device');
check(!asUser(D, `SELECT public.register_push_token('desktop', 'token-x')`).ok,
  '048 an unsupported platform is refused');
check(!asUser(D, `SELECT public.register_push_token('ios', '   ')`).ok,
  '048 an empty token is refused');
check(!psql(['-At', '-c', 'SET ROLE authenticated', '-c', `SELECT public.register_push_token('ios', 'token-null')`]).ok,
  '048 a NULL actor CANNOT register a token');

// The device-handover case, which a plain INSERT could not express: the token
// UNIQUE would reject the arriving account and the DEPARTED one would keep
// receiving that phone's notifications.
check(asUser(D, `SELECT public.register_push_token('ios', 'token-e')`).ok,
  '048 a handed-over device can be claimed by the account now using it');
check(mustSql(`SELECT user_id FROM public.device_push_tokens WHERE token = 'token-e'`, 'handover') === D,
  '048 claiming a token TAKES it, so the previous account stops receiving that device',
);
check(mustSql(`SELECT count(*) FROM public.device_push_tokens WHERE token = 'token-e'`, 'no dup') === '1',
  '048 a handover leaves exactly one owner, never two');

// Put E back on its own device for the delivery tests below.
mustSql(`DELETE FROM public.device_push_tokens WHERE token = 'token-e'`, 'reset handover');
check(asUser(E, `SELECT public.register_push_token('ios', 'token-e')`).ok, '048 re-registered');

check(!asUser(D, 'SELECT * FROM public.push_delivery_candidates()').ok,
  '048 an authenticated user CANNOT ask who is due a notification');
// The grant is not the only gate (029's shape): EXECUTE without the service_role
// claim is still refused, so a mis-issued GRANT cannot expose the schedule.
check(!psql(['-At',
  '-c', 'GRANT EXECUTE ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) TO authenticated',
  '-c', 'SET ROLE authenticated',
  '-c', 'SELECT * FROM public.push_delivery_candidates()']).ok,
  '048 EXECUTE without the service_role claim is refused in the body');
mustSql('REVOKE EXECUTE ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) FROM authenticated', 'restore grant');
check(!asAnon('SELECT * FROM public.push_delivery_candidates()').ok,
  '048 anon CANNOT ask who is due a notification');

// 20:00 KST on a Wednesday sits inside the migration-001 weekday default window.
const INSIDE = `TIMESTAMPTZ '2026-08-19 20:00+09'`;
const OUTSIDE = `TIMESTAMPTZ '2026-08-19 03:00+09'`;

const dueInside = mustAsServiceRole(
  `SELECT count(*) FROM public.push_delivery_candidates(${INSIDE}) WHERE user_id = '${E}'`,
  '048 candidates inside window');
check(dueInside === '1', '048 service_role CAN ask, and a raised flag inside contact hours is due');

const dueOutside = mustAsServiceRole(
  `SELECT count(*) FROM public.push_delivery_candidates(${OUTSIDE}) WHERE user_id = '${E}'`,
  '048 candidates outside window');
check(dueOutside === '0', '048 nobody is notified outside the hours they typed in');

// --- the sender learns nothing about what happened ---------------------------
// Three columns, none of them content, no event kind and no count. `3개` is a
// debt; the payload the device builds says 새로운 소식 for every kind alike.
const shape = mustAsServiceRole(
  `SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
   FROM pg_proc p
   JOIN pg_type t ON t.oid = p.prorettype
   JOIN pg_class c ON c.reltype = t.oid
   JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
   WHERE p.proname = 'push_delivery_candidates'`,
  '048 candidate shape');
check(
  shape === '' || shape === null || !/log_text|content|emotion|count/i.test(shape),
  '048 the sender\'s view carries no content, no event kind and no count',
);

// --- at most one send per recipient per day ---------------------------------

mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${INSIDE})`, '048 mark delivered');
check(unseenOf(E) === 'f', '048 delivering lowers the flag');
check(
  mustAsServiceRole(
    `SELECT count(*) FROM public.push_delivery_candidates(${INSIDE}) WHERE user_id = '${E}'`,
    '048 second look') === '0',
  '048 a delivered recipient is not due again',
);

// Raised again the same day -- a second act -- still does not earn a second send.
mustSql(`UPDATE public.push_delivery_state SET has_unseen = TRUE WHERE user_id = '${E}'`, 'raise again');
check(
  mustAsServiceRole(
    `SELECT count(*) FROM public.push_delivery_candidates(TIMESTAMPTZ '2026-08-19 21:00+09') WHERE user_id = '${E}'`,
    '048 same day') === '0',
  '048 a SECOND act on the same day earns no second notification',
);
check(
  mustAsServiceRole(
    `SELECT count(*) FROM public.push_delivery_candidates(TIMESTAMPTZ '2026-08-20 20:00+09') WHERE user_id = '${E}'`,
    '048 next day') === '1',
  '048 the next Korean-local day starts a new allowance',
);

// --- clearing one's own flag -------------------------------------------------

const clearedByOther = asUser(D, 'SELECT public.clear_my_unseen()');
check(clearedByOther.ok && unseenOf(E) === 't',
  '048 clearing acts on the caller\'s own row, never on the partner\'s');
check(asUser(E, 'SELECT public.clear_my_unseen()').ok && unseenOf(E) === 'f',
  '048 someone already in the app can stop being invited back to it');
check(!psql(['-At', '-c', 'SET ROLE authenticated', '-c', 'SELECT public.clear_my_unseen()']).ok,
  '048 a NULL actor CANNOT clear anything');
check(!asAnon('SELECT public.clear_my_unseen()').ok, '048 anon CANNOT clear anything');

// --- token ownership ---------------------------------------------------------

const partnerCountsTokens = asUser(D, `SELECT count(*) FROM public.device_push_tokens WHERE user_id = '${E}'`);
check(
  // Either the grant is absent (query fails) or RLS filters every row away. Both
  // are denials; asserting only on the count would pass vacuously on an error.
  !partnerCountsTokens.ok || partnerCountsTokens.stdout.trim() === '0',
  '048 a partner CANNOT see how many devices the other carries',
);
check(!asUser(D, `INSERT INTO public.device_push_tokens (user_id, platform, token) VALUES ('${E}', 'ios', 'forged')`).ok,
  '048 nobody can write the token table directly, for any account including their own');
check(!asAnon('SELECT count(*) FROM public.device_push_tokens').ok
  || asAnon('SELECT count(*) FROM public.device_push_tokens').stdout.trim() === '0',
  '048 anon sees no tokens');

check(!psql(['-At', '-c', 'SET ROLE authenticated', '-c', 'SELECT public.revoke_my_push_tokens()']).ok,
  '048 a NULL actor CANNOT revoke tokens');
check(asUser(E, 'SELECT public.revoke_my_push_tokens()').ok
  && mustSql(`SELECT count(*) FROM public.device_push_tokens WHERE user_id = '${E}'`, 'after revoke') === '0'
  && mustSql(`SELECT count(*) FROM public.device_push_tokens WHERE user_id = '${D}'`, 'others intact') === '1',
  '048 signing out revokes only the caller\'s own tokens',
);

// --- unlink ends delivery, on both sides ------------------------------------
// §14.4: an ended relationship must not be able to notify. Both the tokens and
// the flags go, so a later reconnection cannot fire a notification left standing
// from the previous relationship.

mustSql(`
  INSERT INTO public.device_push_tokens (user_id, platform, token) VALUES ('${E}', 'ios', 'token-e2');
  INSERT INTO public.push_delivery_state (user_id, has_unseen) VALUES ('${D}', TRUE), ('${E}', TRUE)
    ON CONFLICT (user_id) DO UPDATE SET has_unseen = TRUE`, '048 pre-unlink');
check(asUser(D, 'SELECT public.disconnect_couple()').ok, '048 unlink succeeds');
check(
  mustSql(
    `SELECT count(*) FROM public.device_push_tokens WHERE user_id IN ('${D}', '${E}')`,
    'tokens after unlink') === '0',
  '048 unlink revokes the push tokens of BOTH members',
);
check(
  mustSql(
    `SELECT count(*) FROM public.push_delivery_state WHERE user_id IN ('${D}', '${E}') AND has_unseen IS TRUE`,
    'flags after unlink') === '0',
  '048 unlink lowers both merged flags, so reconnecting cannot fire a stale one',
);
check(
  mustAsServiceRole(
    `SELECT count(*) FROM public.push_delivery_candidates(${INSIDE}) WHERE user_id IN ('${D}', '${E}')`,
    'candidates after unlink') === '0',
  '048 a disconnected relationship produces no delivery candidates',
);

// ---------------------------------------------------------------------------
// 049 — the measurement pipe, and what it structurally cannot become
//
// §19 permits a date bucket and forbids precise times; it forbids content,
// emotion labels, health of any kind, and behavioural surveillance. The
// assertions below are mostly about ABSENCE, because that is what the rules
// actually require.
// ---------------------------------------------------------------------------

// The one that matters most: no column can hold a time of day.
const timeCols = mustSql(`
  SELECT count(*) FROM information_schema.columns
  WHERE table_name = 'product_events'
    AND data_type IN ('timestamp with time zone', 'timestamp without time zone', 'time without time zone')`,
  '049 time columns');
check(
  timeCols === '0',
  '049 the table has NO timestamp column, so it cannot log when someone opens the app',
);
check(
  mustSql(`SELECT data_type FROM information_schema.columns
           WHERE table_name = 'product_events' AND column_name = 'occurred_on'`, '049 bucket type') === 'date',
  '049 the only temporal column is a DATE bucket',
);

// No column could hold content even if a caller tried.
const textCols = mustSql(`
  SELECT COALESCE(string_agg(column_name, ',' ORDER BY column_name), '')
  FROM information_schema.columns
  WHERE table_name = 'product_events' AND data_type IN ('text', 'character varying')`,
  '049 text columns');
check(
  textCols === 'error_code,kind,screen',
  `049 the only text columns are the three closed/bounded ones (got: ${textCols})`,
);
check(
  mustSql(`SELECT data_type FROM information_schema.columns
           WHERE table_name = 'product_events' AND column_name = 'subject_id'`, '049 subject type') === 'uuid',
  '049 the subject is a UUID, so a record id fits and a record\'s text does not',
);

// The vocabulary is closed, and names nothing forbidden.
const kinds = mustSql(`
  SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'public.product_events'::regclass AND conname LIKE '%kind%'`,
  '049 kind constraint');
check(kinds.includes('record_composed'), '049 the event vocabulary is a CHECK constraint, not free text');
for (const forbidden of ['cycle', 'health', 'emotion', 'mood', 'dwell', 'session', 'streak']) {
  check(
    !kinds.includes(forbidden),
    `049 no event kind names anything §19 forbids (${forbidden})`,
  );
}

// Ownership, in both directions.
mustSql(`
  INSERT INTO public.product_events (user_id, kind, occurred_on)
  VALUES ('${D}', 'record_composed', CURRENT_DATE), ('${E}', 'briefing_opened', CURRENT_DATE)`,
  '049 fixture');

const partnerReadsEvents = asUser(D, `SELECT count(*) FROM public.product_events WHERE user_id = '${E}'`);
check(
  !partnerReadsEvents.ok || partnerReadsEvents.stdout.trim() === '0',
  '049 the partner CANNOT read the other side\'s activity',
);
check(
  asUser(D, `SELECT count(*) FROM public.product_events WHERE user_id = '${D}'`).stdout.trim() === '1',
  '049 an account can read its own',
);
check(
  !asUser(D, `INSERT INTO public.product_events (user_id, kind, occurred_on)
              VALUES ('${E}', 'record_composed', CURRENT_DATE)`).ok,
  '049 nobody can attribute an event to another account',
);
check(!asAnon('SELECT count(*) FROM public.product_events').ok
  || asAnon('SELECT count(*) FROM public.product_events').stdout.trim() === '0',
  '049 anon sees nothing');

// An event is a fact. Nobody edits or erases one.
check(
  !asUser(D, `UPDATE public.product_events SET kind = 'briefing_opened' WHERE user_id = '${D}'`).ok
    || mustSql(`SELECT count(*) FROM public.product_events WHERE user_id = '${D}' AND kind = 'record_composed'`,
      '049 unchanged') === '1',
  '049 events cannot be rewritten, not even one\'s own',
);
check(
  !asUser(D, `DELETE FROM public.product_events WHERE user_id = '${D}'`).ok
    || mustSql(`SELECT count(*) FROM public.product_events WHERE user_id = '${D}'`, '049 still there') === '1',
  '049 events cannot be deleted by the session that wrote them',
);

// The vocabulary refuses anything outside it.
check(
  !mustSqlOk(`INSERT INTO public.product_events (user_id, kind, occurred_on)
              VALUES ('${D}', 'partner_read_my_record', CURRENT_DATE)`),
  '049 an event kind outside the closed set is refused by the database',
);

// --- §7.6 feasibility: can a client learn when the partner joined? ----------
// Not a contract this branch relies on. Recorded because the work log claimed
// the "show them what you wrote before?" question was blocked on fetching a
// join time, and that claim should be true or corrected rather than repeated.

const partnerJoin = asUser(A, `
  SELECT count(*) FROM public.couple_members
  WHERE couple_id = '${COUPLE1}' AND user_id = '${B}' AND joined_at IS NOT NULL`);
check(
  partnerJoin.ok && partnerJoin.stdout.trim() === '1',
  '§7.6 an active member CAN read the partner\'s joined_at, so the reveal prompt is not blocked on new SQL',
);

// ---------------------------------------------------------------------------
// 050 — the LV read-out, and what it refuses to return
// ---------------------------------------------------------------------------

// The couple axis exists, and is not client-supplied.
check(
  mustSql(`SELECT count(*) FROM information_schema.columns
           WHERE table_name = 'product_events' AND column_name = 'couple_id'`, '050 col') === '1',
  '050 events can be grouped by couple, which is the unit LV measures',
);
/*
  This assertion used to read the column's DEFAULT expression and check that the
  text contained `get_my_active_couple_id`. It passed. It also could not fail:
  a DEFAULT applies only when the column is OMITTED, and 049's INSERT policy
  constrained `user_id` alone, so any authenticated account could name any
  couple_id it liked and the catalogue string never changed.

  The `user_id` case ten lines above was always tested the right way -- by having
  a second real actor attempt the forgery. This is now that test, for the column
  it was actually missing on. 051 is the policy that makes it pass.
*/
check(
  !asUser(D, `INSERT INTO public.product_events (kind, occurred_on, couple_id)
              VALUES ('record_composed', CURRENT_DATE, '11111111-1111-1111-1111-111111111111')`).ok,
  '051 an account CANNOT attribute its events to a couple it does not belong to',
);
check(
  asUser(D, `INSERT INTO public.product_events (kind, occurred_on)
             VALUES ('briefing_opened', CURRENT_DATE)`).ok,
  '051 omitting the couple still works, so the pre-connection funnel is not blocked',
);

// Still no partner axis: the RLS scope is unchanged.
/*
  Dated into a window of its own.

  049's fixture writes at CURRENT_DATE, and an overlapping range would have this
  section asserting on both sets at once -- which is how a read-out test starts
  measuring the fixture instead of the function.
*/
mustSql(`
  INSERT INTO public.product_events (user_id, couple_id, kind, occurred_on) VALUES
    ('${D}', '${COUPLE3}', 'couple_connected', DATE '2026-07-01'),
    ('${D}', '${COUPLE3}', 'record_composed',  DATE '2026-07-01'),
    ('${E}', '${COUPLE3}', 'record_composed',  DATE '2026-07-02'),
    ('${D}', '${COUPLE3}', 'briefing_opened',  DATE '2026-07-02'),
    ('${D}', '${COUPLE3}', 'briefing_to_original', DATE '2026-07-02')`,
  '050 fixture');
const partnerReadsCoupleEvents = asUser(D, `
  SELECT count(*) FROM public.product_events WHERE user_id = '${E}'`);
check(
  !partnerReadsCoupleEvents.ok || partnerReadsCoupleEvents.stdout.trim() === '0',
  '050 adding the couple axis did NOT give the partner a read',
);

// Who may run a read-out.
check(!asUser(D, `SELECT * FROM public.lv_funnel_readout(DATE '2026-07-01', DATE '2026-07-31')`).ok,
  '050 an authenticated user CANNOT run the read-out');
check(!asAnon(`SELECT * FROM public.lv_funnel_readout(DATE '2026-07-01', DATE '2026-07-31')`).ok,
  '050 anon CANNOT run the read-out');
check(!psql(['-At',
  '-c', 'GRANT EXECUTE ON FUNCTION public.lv_funnel_readout(DATE, DATE) TO authenticated',
  '-c', 'SET ROLE authenticated',
  '-c', `SELECT * FROM public.lv_funnel_readout(DATE '2026-07-01', DATE '2026-07-31')`]).ok,
  '050 EXECUTE without the service_role claim is refused in the body');
mustSql('REVOKE EXECUTE ON FUNCTION public.lv_funnel_readout(DATE, DATE) FROM authenticated', 'restore');

// What it returns: numbers, never rows about a person.
const readoutShape = mustAsServiceRole(
  // OUT columns of a RETURNS TABLE function live in proargnames/proargmodes,
  // not in a pg_class row -- there is no composite type to inspect.
  `SELECT string_agg(name, ',' ORDER BY ord) FROM (
     SELECT unnest(p.proargnames) AS name,
            generate_subscripts(p.proargnames, 1) AS ord,
            unnest(p.proargmodes) AS mode
     FROM pg_proc p WHERE p.proname = 'lv_funnel_readout'
   ) x WHERE mode = 't'`, '050 shape');
check(
  readoutShape === 'metric,value',
  `050 the read-out returns a metric and a number, never a row about a person (got: ${readoutShape})`,
);

const readout = mustAsServiceRole(
  `SELECT string_agg(metric || '=' || value, ',' ORDER BY metric)
   FROM public.lv_funnel_readout(DATE '2026-07-01', DATE '2026-07-31')`, '050 readout');
check(readout.includes('couples_connected=1'), '050 counts connected couples');
check(readout.includes('couples_writing=1'),
  '050 counts the COUPLE that wrote, not the two accounts in it');
check(readout.includes('records_composed=2'), `050 still counts the records themselves (got: ${readout})`);
check(readout.includes('briefing_to_original_ratio=1.0000'),
  `050 reports the summary-to-original RATE (got: ${readout})`);

check(
  mustAsServiceRole(
    `SELECT string_agg(metric || '=' || value, ',' ORDER BY metric)
     FROM public.lv_funnel_readout(DATE '2026-06-01', DATE '2026-06-30')`, '050 empty window')
    .includes('briefing_to_original_ratio=0'),
  '050 an empty window divides by nothing instead of failing',
);
check(!asServiceRole(`SELECT * FROM public.lv_funnel_readout(DATE '2026-07-31', DATE '2026-07-01')`).ok,
  '050 a reversed range is refused rather than silently returning zero');

// Retention as a count, not a list of who came back.
const retention = mustAsServiceRole(
  `SELECT string_agg(metric || '=' || value, ',' ORDER BY metric)
   FROM public.lv_couple_return_count(DATE '2026-07-01', DATE '2026-07-01', DATE '2026-07-02', DATE '2026-07-02')`,
  '050 retention');
check(retention.includes('couples_active_first=1') && retention.includes('couples_returned=1'),
  '050 retention answers HOW MANY couples returned');
const retentionShape = mustAsServiceRole(
  `SELECT string_agg(name, ',' ORDER BY ord) FROM (
     SELECT unnest(p.proargnames) AS name,
            generate_subscripts(p.proargnames, 1) AS ord,
            unnest(p.proargmodes) AS mode
     FROM pg_proc p WHERE p.proname = 'lv_couple_return_count'
   ) x WHERE mode = 't'`, '050 retention shape');
check(retentionShape === 'metric,value',
  '050 retention never returns WHICH couples came back');
check(!asUser(D, `SELECT * FROM public.lv_couple_return_count(DATE '2026-07-01', DATE '2026-07-01', DATE '2026-07-02', DATE '2026-07-02')`).ok,
  '050 an authenticated user CANNOT run the retention read-out');

// ---------------------------------------------------------------------------
// 051 -- three things a full-chain read found that no single migration showed
// ---------------------------------------------------------------------------

/*
  A dropped function came back as an overload.

  031 created `e2ee_commit_recovery_authentication(UUID, UUID)`. 034 DROPPED that
  signature and replaced it with a four-argument form carrying the identity,
  device and downgrade checks. 035 then ran CREATE OR REPLACE on the TWO-argument
  signature -- it was editing 031's body and did not know 034 had deleted it --
  so PostgreSQL overloaded instead of replacing, and re-granted EXECUTE.

  Counting overloads is the assertion, because that is the failure: not a wrong
  body, but a second body nobody meant to still exist. The write-floor harness
  already guards `e2ee_floor_for` this exact way; this function never got the
  same line.
*/
check(
  mustSql(`SELECT count(*) FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname = 'e2ee_commit_recovery_authentication'`,
    '051 recovery overloads') === '1',
  '051 the weak two-argument recovery commit is gone, leaving exactly one hardened form',
);
check(
  mustSql(`SELECT p.pronargs::text FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname = 'e2ee_commit_recovery_authentication'`,
    '051 recovery survivor') === '4',
  '051 and the one that survived is the four-argument form 034 wrote',
);

/*
  A NULL range used to be answered rather than refused. `NULL < NULL` is NULL, so
  the order check passed and both windows matched nothing -- reporting zero
  retention as a measurement.
*/
/*
  Run AS service_role on purpose. The first version of this used the superuser
  helper, where the function refuses on the role check before it ever reaches the
  range check -- so it passed against a build with no NULL guard at all. It was
  testing the wrong refusal.
*/
check(
  !asServiceRole(`SELECT * FROM public.lv_couple_return_count(NULL::DATE, NULL::DATE, NULL::DATE, NULL::DATE)`).ok,
  '051 a NULL read-out range is refused rather than answered with zero',
);

/*
  The general form of what 051 §1 fixed.

  Counting one function's overloads catches that function. What made C1 possible
  was the shape: a migration DROPPING a signature, and a later one running
  CREATE OR REPLACE on it without knowing, so PostgreSQL overloads instead of
  replacing and both bodies ship. Nothing prevents that happening to the next
  function, and nothing would have reported it.

  Extension functions are excluded by `pg_depend.deptype = 'e'` -- pgcrypto
  legitimately ships a dozen overloaded pairs, and asserting zero without that
  filter would be a test that fails for a correct tree.

  Verified once by probe over the whole chain: after this filter the count is
  ZERO. Every application function in `public` has exactly one signature, so any
  future overload is either deliberate -- and this line is where the author says
  so -- or the bug 051 spent a section on.
*/
const appOverloads = mustSql(`
  SELECT COALESCE(string_agg(x.line, ', '), 'none') FROM (
    SELECT p.proname || ' (' || count(*)::text || ')' AS line
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
       )
     GROUP BY p.proname HAVING count(*) > 1
     ORDER BY p.proname
  ) x`, '051 overload sweep');
check(
  appOverloads === 'none',
  `051 NO application function in public is overloaded, so no dropped signature came back (found: ${appOverloads})`,
);

// ---------------------------------------------------------------------------
// 053 -- the flag means "an act is pending", not "shared records exist"
// ---------------------------------------------------------------------------
/*
  051 and 052 lowered the flag only when NO other shared record of the author's
  remained. Measured against the real chain, that failed the sequence it most
  needed: an OLD shared record predating the recipient's last clear kept the flag
  up after the only NEW act was withdrawn.

  Each case below drives the real paths -- `clear_my_unseen()` as the recipient,
  `mark_push_delivered()` as service_role -- rather than writing the state by
  hand, because the boundary those two functions move is the whole mechanism.
*/
function resetPendingFixture(label) {
  mustSql(`UPDATE public.couple_members SET status = 'active'
           WHERE couple_id = '${COUPLE3}' AND user_id IN ('${D}', '${E}')`, `${label} membership`);
  mustSql(`DELETE FROM public.daily_records WHERE couple_id = '${COUPLE3}'`, `${label} records`);
  mustSql(`DELETE FROM public.push_delivery_state WHERE user_id IN ('${D}', '${E}')`, `${label} state`);
}
function shareRecord(id, note, label) {
  mustSql(`INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
           VALUES ('${id}', '${D}', '${COUPLE3}', CURRENT_DATE, '${note}', false)`, label);
}
function clearAsRecipient(label) {
  const r = asUser(E, 'SELECT public.clear_my_unseen()');
  if (!r.ok) throw new Error(`${label} clear failed:\n${r.stderr}`);
}

// --- case 1: old shared R1 + clear + R2 + retract ---------------------------
resetPendingFixture('053-1');
shareRecord('e5300000-0000-4000-8000-000000000001', 'R1 old', '053-1 R1');
clearAsRecipient('053-1');
check(unseenOf(E) === 'f', '053 the real clear path lowers the flag');
shareRecord('e5300000-0000-4000-8000-000000000002', 'R2 new', '053-1 R2');
check(unseenOf(E) === 't', '053 a new shared act raises it again');
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'e5300000-0000-4000-8000-000000000002'`, '053-1 retract');
check(
  unseenOf(E) === 'f',
  '053 RETRACTING the only new act cancels it, even though an older shared record remains',
);

// --- case 2: same, by deletion ---------------------------------------------
resetPendingFixture('053-2');
shareRecord('e5300000-0000-4000-8000-000000000003', 'R1 old', '053-2 R1');
clearAsRecipient('053-2');
shareRecord('e5300000-0000-4000-8000-000000000004', 'R2 new', '053-2 R2');
check(unseenOf(E) === 't', '053 (delete case) the new act raises the flag');
mustSql(`DELETE FROM public.daily_records
         WHERE id = 'e5300000-0000-4000-8000-000000000004'`, '053-2 delete');
check(
  unseenOf(E) === 'f',
  '053 DELETING the only new act cancels it, even though an older shared record remains',
);

// --- case 3: two genuinely pending acts, one withdrawn ----------------------
resetPendingFixture('053-3');
clearAsRecipient('053-3');
shareRecord('e5300000-0000-4000-8000-000000000005', 'P1', '053-3 P1');
shareRecord('e5300000-0000-4000-8000-000000000006', 'P2', '053-3 P2');
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'e5300000-0000-4000-8000-000000000006'`, '053-3 withdraw one');
check(
  unseenOf(E) === 't',
  '053 withdrawing ONE of two pending acts leaves the flag up, because the other is still owed',
);
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'e5300000-0000-4000-8000-000000000005'`, '053-3 withdraw other');
check(unseenOf(E) === 'f', '053 withdrawing the second one finally cancels it');

// --- case 4: the recipient looks BETWEEN two acts ---------------------------
resetPendingFixture('053-4');
shareRecord('e5300000-0000-4000-8000-000000000007', 'A1', '053-4 A1');
clearAsRecipient('053-4 first look');
shareRecord('e5300000-0000-4000-8000-000000000008', 'A2', '053-4 A2');
clearAsRecipient('053-4 second look');
check(unseenOf(E) === 'f', '053 a clear between acts accounts for both');
shareRecord('e5300000-0000-4000-8000-000000000009', 'A3', '053-4 A3');
check(unseenOf(E) === 't', '053 an act after the second look is still pending');
mustSql(`DELETE FROM public.daily_records
         WHERE id = 'e5300000-0000-4000-8000-000000000009'`, '053-4 withdraw A3');
check(
  unseenOf(E) === 'f',
  '053 withdrawing it cancels, with TWO older shared records present',
);

// --- case 5: a delivery lands between two acts ------------------------------
resetPendingFixture('053-5');
shareRecord('e5300000-0000-4000-8000-00000000000a', 'B1', '053-5 B1');
check(unseenOf(E) === 't', '053 (delivery case) the first act raises the flag');
// 055 made the decision time a required argument. `now()` is the honest value
// here: nothing is shared between this line and the previous one.
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', now())`, '053-5 deliver');
check(unseenOf(E) === 'f', '053 delivery lowers the flag');
shareRecord('e5300000-0000-4000-8000-00000000000b', 'B2', '053-5 B2');
check(unseenOf(E) === 't', '053 an act after delivery is pending again');
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'e5300000-0000-4000-8000-00000000000b'`, '053-5 withdraw B2');
check(
  unseenOf(E) === 'f',
  '053 withdrawing it cancels, because delivery moved the boundary past B1',
);

// --- the boundary is the recipient's own, and stays invisible ---------------
const partnerReadsBoundary = asUser(D,
  `SELECT count(*) FROM public.push_delivery_state WHERE user_id = '${E}'`);
check(
  !partnerReadsBoundary.ok || partnerReadsBoundary.stdout.trim() === '0',
  '053 the author CANNOT read the recipient\'s boundary, so it is not a read receipt',
);
resetPendingFixture('053-cleanup');

// ---------------------------------------------------------------------------
// 054 -- `shared_at` is server state, and a client cannot write it
// ---------------------------------------------------------------------------
/*
  053 made the entire cancellation rule depend on `daily_records.shared_at`, and
  left it writable. `authenticated` holds a table-level UPDATE grant (012), RLS
  is row-level and cannot withhold one column, and 053's stamping trigger fired
  only `BEFORE INSERT OR UPDATE OF is_private` -- so an UPDATE that did not name
  that column never ran it, and one that named it at an unchanged value ran it
  into a branch that assigned nothing.

  These drive the forge as the record's OWN AUTHOR through RLS, which is the
  only actor who can reach the row at all, and then assert the product outcome
  rather than the column: a false invitation left standing after the only new
  act was withdrawn. Before 054 the last check below measured `t`.
*/
const FORGED = "now() + interval '100 years'";

// --- the column cannot be written on any of the three paths ----------------
resetPendingFixture('054-1');
shareRecord('e5400000-0000-4000-8000-000000000001', 'F1', '054-1 F1');

const forgeBare = asUser(D,
  `UPDATE public.daily_records SET shared_at = ${FORGED}
    WHERE id = 'e5400000-0000-4000-8000-000000000001'`);
check(
  forgeBare.ok,
  '054 the author CAN issue the update (so the next check measures the trigger, not a denial)',
);
check(
  mustSql(`SELECT shared_at > now() + interval '90 years'
             FROM public.daily_records
            WHERE id = 'e5400000-0000-4000-8000-000000000001'`, '054 bare forge') === 'f',
  '054 an UPDATE that does not name is_private cannot set shared_at',
);

asUser(D,
  `UPDATE public.daily_records SET is_private = false, shared_at = ${FORGED}
    WHERE id = 'e5400000-0000-4000-8000-000000000001'`);
check(
  mustSql(`SELECT shared_at > now() + interval '90 years'
             FROM public.daily_records
            WHERE id = 'e5400000-0000-4000-8000-000000000001'`, '054 named forge') === 'f',
  '054 naming is_private at an UNCHANGED value cannot set shared_at either',
);

asUser(D,
  `INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private, shared_at)
   VALUES ('e5400000-0000-4000-8000-000000000002', '${D}', '${COUPLE3}', CURRENT_DATE, 'F2', false, ${FORGED})`);
check(
  mustSql(`SELECT COALESCE(max((shared_at > now() + interval '90 years')::text), 'absent')
             FROM public.daily_records
            WHERE id = 'e5400000-0000-4000-8000-000000000002'`, '054 insert forge') !== 't',
  '054 a submitted shared_at is discarded at INSERT too',
);

// --- the product outcome: the forge cannot manufacture an invitation --------
resetPendingFixture('054-2');
shareRecord('e5400000-0000-4000-8000-000000000003', 'old R1', '054-2 R1');
clearAsRecipient('054-2');
asUser(D,
  `UPDATE public.daily_records SET shared_at = ${FORGED}
    WHERE id = 'e5400000-0000-4000-8000-000000000003'`);
shareRecord('e5400000-0000-4000-8000-000000000004', 'new R2', '054-2 R2');
check(unseenOf(E) === 't', '054 the new act raises the flag');
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'e5400000-0000-4000-8000-000000000004'`, '054-2 withdraw R2');
check(
  unseenOf(E) === 'f',
  '054 withdrawing the only new act still cancels it, even after the author skewed an older record\'s shared_at',
);

// --- 053's semantics are unchanged by the widened trigger -------------------
resetPendingFixture('054-3');
shareRecord('e5400000-0000-4000-8000-000000000005', 'v1', '054-3 v1');
const stampBefore = mustSql(`SELECT shared_at FROM public.daily_records
                              WHERE id = 'e5400000-0000-4000-8000-000000000005'`, '054-3 before');
mustSql(`UPDATE public.daily_records SET log_text = 'v2'
          WHERE id = 'e5400000-0000-4000-8000-000000000005'`, '054-3 edit');
check(
  mustSql(`SELECT shared_at FROM public.daily_records
            WHERE id = 'e5400000-0000-4000-8000-000000000005'`, '054-3 after') === stampBefore,
  '054 editing a still-shared record does NOT restamp it, so an edit is not an act',
);
mustSql(`UPDATE public.daily_records SET is_private = true
          WHERE id = 'e5400000-0000-4000-8000-000000000005'`, '054-3 retract');
check(
  mustSql(`SELECT COALESCE(shared_at::text, 'NULL') FROM public.daily_records
            WHERE id = 'e5400000-0000-4000-8000-000000000005'`, '054-3 retracted') === 'NULL',
  '054 retracting still erases the stamp, so no history of changing one\'s mind survives',
);
mustSql(`UPDATE public.daily_records SET is_private = false
          WHERE id = 'e5400000-0000-4000-8000-000000000005'`, '054-3 reshare');
check(
  mustSql(`SELECT shared_at > '${stampBefore}'::timestamptz FROM public.daily_records
            WHERE id = 'e5400000-0000-4000-8000-000000000005'`, '054-3 reshared') === 't',
  '054 re-sharing restamps, so it is a new act',
);
resetPendingFixture('054-cleanup');

// ---------------------------------------------------------------------------
// 055 -- a notification covers what existed when it was DECIDED
// ---------------------------------------------------------------------------

/*
  053 gave the recipient a boundary and `mark_push_delivered()` set it to its OWN
  clock. The send was decided earlier, at `push_delivery_candidates()`, so every
  act shared in between fell behind a boundary drawn by a notification that could
  not have contained it -- flag down, stamp behind the line, never selected
  again. Not a delayed notification: a deleted one.

  Timestamps here are FIXED rather than `now()` wherever an assertion depends on
  the Korean-local clock. An earlier draft used `now()` for the daily-cap case
  and passed on a laptop at 23:52 KST for the wrong reason -- the recipient was
  outside their contact window, so the cap was never the thing being measured.

  `INSIDE` is 20:00 KST on Wednesday 2026-08-19, inside the migration-001 weekday
  default. Records created by `shareRecord` are stamped by the server at real
  `now()`, which is necessarily LATER than that fixed instant -- so "shared after
  the decision" is a property of the fixture, not of when this file is run.
*/

/*
  E has NO device token at this point, and that is not incidental: the 048
  section ends by calling `disconnect_couple()`, which revokes both sides'
  tokens. `push_delivery_candidates` inner-joins `device_push_tokens`, so every
  candidate assertion below would have counted zero and passed for the wrong
  reason -- "not due" is indistinguishable from "has no phone". The 053 section
  never noticed because it only ever called `mark_push_delivered`.
*/
check(asUser(E, `SELECT public.register_push_token('ios', 'token-e-055')`).ok,
  '055 the recipient has a device again, so a zero candidate count means NOT DUE');

const INSIDE_LATER = `TIMESTAMPTZ '2026-08-19 20:30+09'`;
const NEXT_DAY = `TIMESTAMPTZ '2026-08-20 20:00+09'`;
const boundaryOf = (userId) =>
  mustSql(`SELECT COALESCE(notified_through::text, 'NULL') FROM public.push_delivery_state
            WHERE user_id = '${userId}'`, 'boundary');
const dueAt = (whenSql) => mustAsServiceRole(
  `SELECT count(*) FROM public.push_delivery_candidates(${whenSql}) WHERE user_id = '${E}'`,
  '055 due');

// --- the decision instant comes back with the batch --------------------------
resetPendingFixture('055-0');
shareRecord('e5500000-0000-4000-8000-000000000001', 'D0', '055-0 D0');
check(
  mustAsServiceRole(
    `SELECT count(*) FROM public.push_delivery_candidates(${INSIDE})
      WHERE user_id = '${E}' AND decided_at = ${INSIDE}`, '055-0 decided_at') === '1',
  '055 push_delivery_candidates hands back the instant it decided',
);

// --- case A: candidate -> new act -> successful mark -------------------------
resetPendingFixture('055-A');
shareRecord('e5500000-0000-4000-8000-00000000000a', 'R1', '055-A R1');
check(unseenOf(E) === 't', '055 (case A) the first act raises the flag');
// The send is decided HERE. R2 is shared after it, so no notification issued
// from this decision could have been about R2.
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${INSIDE})`, '055-A mark');
check(
  unseenOf(E) === 't',
  '055 (case A) an act shared after the send decision SURVIVES the mark',
);
check(
  boundaryOf(E) !== 'NULL' && mustSql(
    `SELECT notified_through = ${INSIDE} FROM public.push_delivery_state
      WHERE user_id = '${E}'`, '055-A boundary') === 't',
  '055 (case A) the boundary is the decision instant, not the mark instant',
);

/*
  NEGATIVE PROOF, and the reason the check above is not a tautology.

  Same fixture, same order, one difference: the mark is taken against the clock
  AT MARK TIME -- which is precisely what shipped before 055, and what the Edge
  Function got for free from `p_now DEFAULT now()`. The act must be lost. If this
  ever passes with the flag still up, the assertion above has stopped
  discriminating and is measuring nothing.
*/
resetPendingFixture('055-A-neg');
shareRecord('e5500000-0000-4000-8000-00000000000b', 'R1', '055-A-neg R1');
const negDecision = mustSql('SELECT now()', '055-A-neg decide');
shareRecord('e5500000-0000-4000-8000-00000000000c', 'R2', '055-A-neg R2');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', now())`, '055-A-neg mark');
check(
  unseenOf(E) === 'f' && negDecision !== '',
  '055 NEGATIVE PROOF: marking against the MARK-time clock still loses the racing act',
);

// --- case E: the daily cap and the race, together ----------------------------
resetPendingFixture('055-E');
shareRecord('e5500000-0000-4000-8000-00000000000e', 'R2 racing', '055-E R2');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${INSIDE})`, '055-E mark');
check(unseenOf(E) === 't', '055 (case E) the racing act leaves the flag raised');
check(
  dueAt(INSIDE_LATER) === '0',
  '055 (case E) the raised flag does NOT buy a second send the same day -- the cap holds',
);
check(
  dueAt(NEXT_DAY) === '1',
  '055 (case E) and the act is delivered on the NEXT run, which is the point: it waits, it is not erased',
);

// --- case D: the racing act is withdrawn during delivery ---------------------
resetPendingFixture('055-D');
shareRecord('e5500000-0000-4000-8000-0000000000d1', 'retracted', '055-D R');
mustSql(`UPDATE public.daily_records SET is_private = true
         WHERE id = 'e5500000-0000-4000-8000-0000000000d1'`, '055-D retract');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${INSIDE})`, '055-D mark');
check(
  unseenOf(E) === 'f',
  '055 (case D) an act RETRACTED before the mark leaves nothing pending, so no invitation to nothing',
);

resetPendingFixture('055-D2');
shareRecord('e5500000-0000-4000-8000-0000000000d2', 'deleted', '055-D2 R');
mustSql(`DELETE FROM public.daily_records
          WHERE id = 'e5500000-0000-4000-8000-0000000000d2'`, '055-D2 delete');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${INSIDE})`, '055-D2 mark');
check(
  unseenOf(E) === 'f',
  '055 (case D) and the same when it is DELETED rather than retracted',
);

// --- case B: the mark fails, so nothing is recorded --------------------------
/*
  A failed mark is a mark that never ran -- the handler only calls it when a
  device took the notification, and counts the person failed if it throws. What
  the database owes is that the un-marked state is still a due state.
*/
resetPendingFixture('055-B');
shareRecord('e5500000-0000-4000-8000-0000000000b1', 'R1', '055-B R1');
check(
  boundaryOf(E) === 'NULL'
    && mustSql(`SELECT last_notified_at IS NULL FROM public.push_delivery_state
                 WHERE user_id = '${E}'`, '055-B stamp') === 't',
  '055 (case B) a send that was never marked stamps neither the day nor the boundary',
);
check(dueAt(INSIDE) === '1', '055 (case B) so the next run still owes them -- delivery failure is retry-safe');

// --- case C: several devices, one decision, one mark -------------------------
resetPendingFixture('055-C');
shareRecord('e5500000-0000-4000-8000-0000000000c1', 'R1', '055-C R1');
check(asUser(E, `SELECT public.register_push_token('android', 'token-e-2')`).ok,
  '055 (case C) a second device registers');
const perDevice = mustAsServiceRole(
  `SELECT count(*)::text || '/' || count(DISTINCT decided_at)::text
     FROM public.push_delivery_candidates(${INSIDE}) WHERE user_id = '${E}'`, '055-C rows');
check(
  perDevice === '2/1',
  '055 (case C) two devices are two rows carrying ONE decision instant, so the boundary cannot differ per device',
);
mustSql(`DELETE FROM public.device_push_tokens WHERE token = 'token-e-2'`, '055-C cleanup');

// --- the recipient's own look outranks a late mark ---------------------------
/*
  `GREATEST` in the upsert, and it is not decoration. Someone who opened the app
  between the decision and the mark already has a LATER boundary from
  `clear_my_unseen()`. Writing the decision flat would drag it backwards and
  re-pend acts they have already read -- notifying them tomorrow about what they
  looked at today.
*/
resetPendingFixture('055-G');
shareRecord('e5500000-0000-4000-8000-0000000000g1'.replace(/g/g, '9'), 'R1', '055-G R1');
clearAsRecipient('055-G');
const lookedAt = boundaryOf(E);
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${INSIDE})`, '055-G late mark');
check(
  boundaryOf(E) === lookedAt,
  '055 a recipient\'s own look outranks a late mark: the boundary never moves backwards',
);
check(unseenOf(E) === 'f', '055 and nothing they already read is re-pended by that mark');

// --- a DELAYED OLDER mark must not reopen a day already spent ----------------
/*
  `notified_through` moves forward only. `last_notified_at` did not, and the two
  are load-bearing for different things: the boundary decides what a notification
  covered, the stamp decides whether today's single send has been spent.

  Two senders, reverse order -- which is not exotic, it is what a retry queue and
  a re-invoked scheduler produce between them:

    W1 decides on D1, its mark is delayed
    W2 decides on D2, its mark lands FIRST   -> last_notified_at = D2
    a new act arrives on D2                  -> has_unseen = t
    W1's delayed mark finally lands (D1)     -> last_notified_at = D1  <-- backwards

  The recipient's D2 send is now un-spent. The next run sees a stamp dated D1,
  reads the cap as open, and sends them a SECOND notification on D2. The daily
  cap is the one promise this surface makes to someone's lock screen, and it is
  broken by bookkeeping arriving out of order rather than by anything the user or
  the author did.

  `notified_through` is unaffected either way -- its GREATEST already refuses to
  go backwards -- which is exactly why this survived: every boundary assertion in
  this file kept passing while the stamp beside it went backwards.
*/
const D1_DECISION = INSIDE;                                   // 2026-08-19 20:00 KST
const D2_DECISION = NEXT_DAY;                                 // 2026-08-20 20:00 KST
const D2_LATER = `TIMESTAMPTZ '2026-08-20 20:30+09'`;
const stampOf = (userId) =>
  mustSql(`SELECT COALESCE(last_notified_at::text, 'NULL') FROM public.push_delivery_state
            WHERE user_id = '${userId}'`, 'stamp');

resetPendingFixture('055-H');
shareRecord('e5500000-0000-4000-8000-0000000000h1'.replace(/h/g, '8'), 'R1', '055-H R1');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${D2_DECISION})`, '055-H W2 mark');
const stampAfterD2 = mustSql(
  `SELECT last_notified_at = ${D2_DECISION} FROM public.push_delivery_state
    WHERE user_id = '${E}'`, '055-H D2 stamp');
shareRecord('e5500000-0000-4000-8000-0000000000h2'.replace(/h/g, '8'), 'R2 on D2', '055-H R2');
check(unseenOf(E) === 't', '055 (case H) the D2 act raises the flag, so a second D2 send is only barred by the cap');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${D1_DECISION})`, '055-H W1 delayed mark');

check(
  stampAfterD2 === 't'
    && mustSql(`SELECT last_notified_at = ${D2_DECISION} FROM public.push_delivery_state
                 WHERE user_id = '${E}'`, '055-H stamp holds') === 't',
  `055 (case H) a DELAYED OLDER mark does not drag last_notified_at backwards (stamp now ${stampOf(E)})`,
);
check(
  dueAt(D2_LATER) === '0',
  '055 (case H) so the day it already spent stays spent: no SECOND notification on D2',
);
check(
  mustSql(`SELECT notified_through >= ${D2_DECISION} FROM public.push_delivery_state
            WHERE user_id = '${E}'`, '055-H boundary') === 't',
  '055 (case H) and the boundary is still the forward-most one, as GREATEST already guaranteed',
);

/*
  The control. Monotonicity must bar only BACKWARD movement -- if it also barred
  the ordinary case, the cap would jam shut and nobody would ever be notified
  twice because nobody would be notified again at all.
*/
resetPendingFixture('055-H2');
shareRecord('e5500000-0000-4000-8000-0000000000h3'.replace(/h/g, '8'), 'R1', '055-H2 R1');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${D1_DECISION})`, '055-H2 D1 mark');
check(dueAt(INSIDE_LATER) === '0', '055 (case H) a normal D1 send still spends D1');
check(
  dueAt(D2_DECISION) === '1',
  '055 (case H) and D1 -> D2 still opens exactly one D2 batch, so the guard bars only BACKWARD movement',
);
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${D2_DECISION})`, '055-H2 D2 mark');
check(
  mustSql(`SELECT last_notified_at = ${D2_DECISION} FROM public.push_delivery_state
            WHERE user_id = '${E}'`, '055-H2 forward') === 't',
  '055 (case H) a NEWER mark still moves the stamp forward',
);

/*
  And the recipient's own look, against a late mark, measured on the STAMP as
  well as the boundary. 055-G proved the boundary; the stamp was never asserted
  there, which is the gap this case closes from the other side.
*/
resetPendingFixture('055-H3');
shareRecord('e5500000-0000-4000-8000-0000000000h4'.replace(/h/g, '8'), 'R1', '055-H3 R1');
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${D2_DECISION})`, '055-H3 D2 mark');
clearAsRecipient('055-H3');
const boundaryAfterLook = boundaryOf(E);
mustAsServiceRole(`SELECT public.mark_push_delivered('${E}', ${D1_DECISION})`, '055-H3 late D1 mark');
check(
  boundaryOf(E) === boundaryAfterLook
    && mustSql(`SELECT last_notified_at = ${D2_DECISION} FROM public.push_delivery_state
                 WHERE user_id = '${E}'`, '055-H3 stamp') === 't',
  '055 (case H) a look followed by a late mark moves NEITHER the boundary nor the stamp backwards',
);

// --- what the sender still cannot do -----------------------------------------
check(
  !asUser(D, `SELECT public.mark_push_delivered('${E}', now())`).ok,
  '055 an authenticated account still CANNOT mark anyone delivered',
);
check(
  !asAnon(`SELECT public.mark_push_delivered('${E}', now())`).ok,
  '055 and neither can anon',
);
/*
  THE FUNCTION CONTRACT, read out of the catalog whole rather than sampled.

  What stood here counted rows in `pg_proc WHERE proname = ...` and, below,
  matched the result type with a regular expression. Both passed under mutation:
  giving `p_decided_at` back its `DEFAULT now()` left the count at one, and
  adding an `extra_meta TEXT` column to the sender's view left
  `/decided_at timestamp with time zone/` matching and none of the forbidden
  words present. A test that a mutation survives is not coverage; it is a
  sentence about coverage.

  So compare the whole identity in one string: how many functions of that name
  live in `public`, their exact identity arguments, how many of those arguments
  are DEFAULTED, and the complete result type. `count(*)` is inside the compared
  value on purpose -- a dropped function yields `0 ;; ;; ;;`, which matches no
  expectation, so this cannot pass vacuously the way a bare `string_agg` over an
  empty set would.

  `pronargdefaults` is not incidental. It is the entire load-bearing claim of
  055 for `mark_push_delivered`: a caller that forgets the decision instant must
  fail loudly rather than silently receive `now()` and erase an act. And the two
  functions differ here -- `push_delivery_candidates(p_now DEFAULT now())` is
  MEANT to have one default -- so a single shared expectation would have to be
  loose enough to accept both, which is how this hole was dug the first time.
*/
function functionContract(schemaName, functionName) {
  return mustSql(
    `SELECT count(*)::text
            || ' ;; ' || COALESCE(string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY p.oid), '')
            || ' ;; ' || COALESCE(string_agg(p.pronargdefaults::text, ' | ' ORDER BY p.oid), '')
            || ' ;; ' || COALESCE(string_agg(pg_get_function_result(p.oid), ' | ' ORDER BY p.oid), '')
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = '${schemaName}' AND p.proname = '${functionName}'`,
    `contract ${functionName}`);
}

const CANDIDATES_CONTRACT =
  '1 ;; p_now timestamp with time zone ;; 1 ;; '
  + 'TABLE(user_id uuid, platform text, token text, decided_at timestamp with time zone)';
const MARK_CONTRACT =
  '1 ;; p_user_id uuid, p_decided_at timestamp with time zone ;; 0 ;; void';

const candidatesContract = functionContract('public', 'push_delivery_candidates');
check(
  candidatesContract === CANDIDATES_CONTRACT,
  `055 push_delivery_candidates has EXACTLY one signature, one defaulted argument and that exact result type`
    + ` -- so an extra OUT column or a stale overload is a failure, not a shrug (got: ${candidatesContract})`,
);

/*
  And the vacuity guard, asserted rather than argued. `count(*)` sits inside the
  compared string precisely so that a DROPPED function cannot slip through: the
  reader returns a leading `0` for a name that does not exist, and no expectation
  in this file begins with `0`. Written against a name that is deliberately
  absent, so it keeps holding whatever happens to the two real functions.
*/
const absentContract = functionContract('public', 'mark_push_delivered_absent_by_design');
check(
  absentContract.startsWith('0 ;;') && absentContract !== CANDIDATES_CONTRACT
    && absentContract !== MARK_CONTRACT,
  `055 the contract reader reports ABSENCE as a leading 0, so a dropped function fails this`
    + ` check instead of passing it on an empty result (got: ${absentContract})`,
);

const markContract = functionContract('public', 'mark_push_delivered');
check(
  markContract === MARK_CONTRACT,
  `055 mark_push_delivered has EXACTLY one signature, ZERO defaulted arguments and returns void`
    + ` -- pronargdefaults = 0 is the whole point: a caller that forgets the decision instant must FAIL,`
    + ` not silently receive now() (got: ${markContract})`,
);
check(
  mustSql(`SELECT count(*) FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name LIKE '%notification%'`, '055 no history') === '0',
  '055 no notification-history table was added to fix this',
);
/*
  Read through `pg_get_function_result`, NOT by joining `pg_proc` to `pg_class`
  the way the 048 shape check does. A `RETURNS TABLE` function has `prorettype`
  = the `record` pseudo-type, which owns no `pg_class` row, so that join yields
  NOTHING -- and 048's check tolerates the empty string, which means it has been
  passing vacuously since the day it was written. It would not have noticed a
  `log_text` column arriving in the sender's view. Left in place rather than
  rewritten here, since fixing it is not this change's business; named so the
  next reader does not mistake it for coverage.
*/
check(
  candidatesContract.endsWith(
    'TABLE(user_id uuid, platform text, token text, decided_at timestamp with time zone)'),
  `055 the sender's view gains a clock reading and NOTHING else -- compared whole, so a column`
    + ` nobody thought to forbid fails too (got: ${candidatesContract})`,
);

mustSql(`DELETE FROM public.device_push_tokens WHERE token = 'token-e-055'`, '055 token cleanup');
resetPendingFixture('055-cleanup');

// ---------------------------------------------------------------------------
// 052 -- account closure. LAST, because it deletes an actor the rest of this
// file uses. Placed here after an earlier version ran mid-file and took every
// subsequent assertion down with it.
// ---------------------------------------------------------------------------

/*
  052's stated limit, measured rather than assumed.

  The header says account closure depends on the CASCADE reaching
  `daily_records` while the departing member's `couple_members` row still
  exists, and that PostgreSQL does not order cascaded deletes between tables.
  That is a claim about this database's behaviour, so it gets an assertion
  instead of a hedge -- if it turns out to hold reliably, the comment is too
  pessimistic; if it does not, the harness says so out loud.
*/
/*
  Self-contained on purpose. An earlier version leaned on the INSERT trigger to
  raise the flag, and by this point in the file the couple's membership has been
  moved around by other sections, so the raise did not happen and the test failed
  for a reason that had nothing to do with what it measures.

  Membership is restored explicitly, the flag is set directly rather than through
  a trigger, and what is under test is the ONE thing 052 added: closing an account
  takes the invitation down with the records.
*/
mustSql(`UPDATE public.couple_members SET status = 'active'
         WHERE couple_id = '${COUPLE3}' AND user_id IN ('${D}', '${E}')`, '052 restore membership');
mustSql(`DELETE FROM public.daily_records WHERE couple_id = '${COUPLE3}'`, '052 clear records');
mustSql(`
  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private)
  VALUES ('d0000000-0000-4000-8000-000000000006', '${D}', '${COUPLE3}', CURRENT_DATE, 'last words', false)`,
  '052 closure fixture');
mustSql(`INSERT INTO public.push_delivery_state (user_id, has_unseen) VALUES ('${E}', TRUE)
     ON CONFLICT (user_id) DO UPDATE SET has_unseen = TRUE`, '052 raise directly');
check(unseenOf(E) === 't', '052 closure fixture leaves the flag up before the account closes');
mustSql(`DELETE FROM auth.users WHERE id = '${D}'`, '052 close the account');
/*
  Measured: the flag DOES come down. On PostgreSQL 17 the cascade reaches
  `daily_records` while the departing `couple_members` row is still there, so
  the trigger finds the partner and lowers it.

  Asserted as `f` rather than "either value". An assertion that accepts both
  outcomes measures nothing -- it is the shape this audit spent a migration
  correcting -- so the observed behaviour is pinned. If a future PostgreSQL
  orders the cascade differently this goes red, which is the report worth
  having: 052's header says that case is possible, and this is what would tell
  us it arrived.
*/
check(
  unseenOf(E) === 'f',
  '052 closing an account lowers the surviving partner\'s flag, so nobody is told that a departure was an act',
);

// ---------------------------------------------------------------------------
// 054 -- the UPGRADE PATH, on a second database
// ---------------------------------------------------------------------------

/*
  Everything above runs against a chain applied in one go, which can only ever
  prove what the END STATE does. A repair statement is not part of the end state:
  it is a thing that happens once, while the chain is being applied, to rows that
  are already wrong. Applying 001..055 to an empty cluster runs 054's repair over
  zero skewed rows and reports nothing, forever.

  That gap hid a real defect. 054 installed its stamping trigger and THEN issued
  the repair, and every row the repair targets is `is_private = FALSE` and stays
  that way -- so each UPDATE entered the trigger's no-transition branch,
  `NEW.shared_at := OLD.shared_at`, and the trigger restored the exact forged
  value the statement existed to erase. Both statements ran. Both reported rows
  updated. Neither changed anything, and the end-state tests above stayed green
  throughout because a fresh database has nothing to repair.

  So this runs the migration the way an existing deployment would meet it: apply
  001..053, forge `shared_at` into the future as the record's own author THROUGH
  RLS -- not as superuser, or the forge would prove nothing about what a client
  can do -- and only then apply 054.
*/

const UPGRADE_DB = 'phase0_upgrade';
execFileSync('createdb', ['-h', socketDir, '-U', 'postgres', UPGRADE_DB], { stdio: 'ignore', env: PG_ENV });

const upgradeScratch = join(dir, 'upgrade-input.sql');
function upgradePsql(args, { input } = {}) {
  const result = spawnSync(
    'psql',
    ['-h', socketDir, '-U', 'postgres', '-d', UPGRADE_DB, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', input, env: PG_ENV },
  );
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function upgradeScript(text) {
  writeFileSync(upgradeScratch, text);
  return upgradePsql(['-f', upgradeScratch]);
}
function upgradeSql(text, label) {
  const result = upgradePsql(['-At', '-c', text]);
  if (!result.ok) throw new Error(`${label} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}
function upgradeAsUser(userId, text) {
  return upgradePsql([
    '-At',
    '-c', 'SET ROLE authenticated',
    '-c', `DO $harness$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $harness$`,
    '-c', text,
  ]);
}
function applyTo(file) {
  if (file === '002_fix_rls_recursion.sql') upgradePsql(['-c', PRE_002_RECURSION_DROPS]);
  const applied = upgradeScript(readFileSync(join(MIGRATIONS, file), 'utf8'));
  if (!applied.ok) throw new Error(`upgrade-path migration ${file} failed:\n${applied.stderr}`);
}

const REPAIRED_BY = '054_shared_at_is_server_state.sql';
const beforeRepair = ORDER.slice(0, ORDER.indexOf(REPAIRED_BY));
const fromRepair = ORDER.slice(ORDER.indexOf(REPAIRED_BY));

const upgradeStub = upgradeScript(SUPABASE_STUB);
if (!upgradeStub.ok) throw new Error(`upgrade stub failed:\n${upgradeStub.stderr}`);
for (const file of beforeRepair) applyTo(file);

const UA = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const UB = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const UCOUPLE = '44444444-0000-4000-8000-000000000004';
const UP_FORGED = 'f0f0f0f0-0000-4000-8000-000000000001';
const UP_RETRACTED = 'f0f0f0f0-0000-4000-8000-000000000002';

upgradeSql(`
  INSERT INTO auth.users (id, email) VALUES ('${UA}', 'ua@example.test'), ('${UB}', 'ub@example.test');
  INSERT INTO public.profiles (id, display_name, role) VALUES ('${UA}', 'UA', 'gomsin'), ('${UB}', 'UB', 'soldier');
  INSERT INTO public.couples (id) VALUES ('${UCOUPLE}');
  INSERT INTO public.couple_members (couple_id, user_id, role, status) VALUES
    ('${UCOUPLE}', '${UA}', 'gomsin', 'active'), ('${UCOUPLE}', '${UB}', 'soldier', 'active');
`, 'upgrade fixture');

// Shared through the real path, so 053's trigger stamps them the way production would.
const shared = upgradeAsUser(UA, `
  INSERT INTO public.daily_records (id, user_id, couple_id, record_date, log_text, is_private) VALUES
    ('${UP_FORGED}',    '${UA}', '${UCOUPLE}', CURRENT_DATE,     'skewed forward', false),
    ('${UP_RETRACTED}', '${UA}', '${UCOUPLE}', CURRENT_DATE - 1, 'private but stamped', false)`);
check(shared.ok, '054/upgrade the author can share records on the pre-054 chain');

// The forge, as the record's own author, through RLS -- the exact statement
// 054's header says a client could issue against 053.
const forge = upgradeAsUser(UA,
  `UPDATE public.daily_records SET shared_at = now() + interval '100 years'
    WHERE id IN ('${UP_FORGED}', '${UP_RETRACTED}')`);
check(forge.ok, '054/upgrade the forge is ACCEPTED on the 053 chain (so the next check measures a repair, not a denial)');
check(
  upgradeSql(`SELECT count(*) FROM public.daily_records
               WHERE shared_at > GREATEST(updated_at, created_at)`, 'upgrade skew') === '2',
  '054/upgrade both rows carry a future shared_at before 054 runs',
);

// A private row holding a stamp, which the second repair statement owns.
upgradeAsUser(UA, `UPDATE public.daily_records SET is_private = true WHERE id = '${UP_RETRACTED}'`);
upgradeSql(`UPDATE public.daily_records SET shared_at = now() + interval '100 years'
             WHERE id = '${UP_RETRACTED}'`, 'upgrade private stamp');

// --- and now the migration under test meets those rows ----------------------
for (const file of fromRepair) applyTo(file);

check(
  upgradeSql(`SELECT count(*) FROM public.daily_records
               WHERE is_private = FALSE AND shared_at IS NOT NULL
                 AND shared_at > GREATEST(updated_at, created_at)`, 'upgrade repaired') === '0',
  '054/upgrade applying 054 to an ALREADY-SKEWED database actually repairs it',
);
check(
  upgradeSql(`SELECT COALESCE(shared_at::text, 'NULL') FROM public.daily_records
               WHERE id = '${UP_RETRACTED}'`, 'upgrade private') === 'NULL',
  '054/upgrade a private row keeps no stamp, so no history of changing one\'s mind survives the upgrade',
);
check(
  upgradeSql(`SELECT shared_at <= GREATEST(updated_at, created_at) FROM public.daily_records
               WHERE id = '${UP_FORGED}'`, 'upgrade honest') === 't',
  '054/upgrade the repaired stamp is the honest one: no later than the row was last touched',
);
// The trigger has to survive the reordering that made the repair run at all.
const postForge = upgradeAsUser(UA,
  `UPDATE public.daily_records SET shared_at = now() + interval '100 years' WHERE id = '${UP_FORGED}'`);
check(
  postForge.ok && upgradeSql(`SELECT shared_at > now() + interval '50 years'
                                FROM public.daily_records WHERE id = '${UP_FORGED}'`, 'upgrade reforge') === 'f',
  '054/upgrade the column is still unwritable AFTER the upgrade, so repairing it did not cost the guard',
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`${passes.length} passed`);
for (const pass of passes) console.log(`  ok   ${pass}`);
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILED`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
console.log('\nPhase 0 baseline contracts hold.');
