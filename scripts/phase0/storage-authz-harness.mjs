#!/usr/bin/env node
/**
 * Executable proof for the Phase 0 baseline: migrations 028, 029 and 030.
 *
 * The string-level tests next to these migrations prove the SQL text says what
 * we think it says. They cannot prove the policies DENY anything, because a
 * predicate that reads correctly can still be wrong: `couple_id = NULL` looks
 * restrictive and matches nothing, `(a OR b)` looks restrictive and matches
 * everything. The only honest proof of a deny rule is a real actor being
 * refused by a real database.
 *
 * So this harness starts a throwaway PostgreSQL 17 cluster, applies the actual
 * migration chain 001..030, and drives the actual policies as actual RLS
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
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
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

console.log('phase 0 baseline harness — migrations 001..030 on a throwaway PostgreSQL 17\n');

execFileSync('initdb', ['-D', dataDir, '-U', 'postgres', '--no-sync', '-A', 'trust'], {
  stdio: 'ignore', env: PG_ENV,
});
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h ''`, '-w', 'start'], {
  stdio: 'ignore', env: PG_ENV,
});
started = true;
execFileSync('createdb', ['-h', socketDir, '-U', 'postgres', DB], { stdio: 'ignore', env: PG_ENV });

const stub = psql(['-f', '/dev/stdin'], { input: SUPABASE_STUB });
if (!stub.ok) throw new Error(`Supabase stub failed:\n${stub.stderr}`);

for (const file of ORDER) {
  if (file === '002_fix_rls_recursion.sql') {
    const pre = psql(['-c', PRE_002_RECURSION_DROPS]);
    if (!pre.ok) throw new Error(`002 pre-drop failed:\n${pre.stderr}`);
  }
  const applied = psql(['-f', '/dev/stdin'], { input: readFileSync(join(MIGRATIONS, file), 'utf8') });
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
