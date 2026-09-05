#!/usr/bin/env node
/**
 * Real PostgreSQL 001..089 actor/CAS/deletion/JPEG tests. Only Supabase's
 * auth/storage catalog is stubbed, following record-media-real-chain-harness.
 * That executable has no importable setup API. No hosted API or client tests.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
for (const binary of ['initdb', 'pg_ctl', 'createdb', 'psql']) {
  if (spawnSync(binary, ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error(`MISSING VERIFICATION: ${binary} unavailable.`);
    process.exit(2);
  }
}
const scratchRoot = mkdtempSync('/tmp/gsl-avatar-');
const dataDir = join(scratchRoot, 'data'), socketDir = join(scratchRoot, 'socket');
mkdirSync(socketDir);
const pgEnv = {
  ...process.env, LC_ALL: 'C', LANG: 'C', PGHOST: socketDir,
  PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'profile_avatar_harness',
};
let started = false;
const children = new Set();
process.on('exit', () => {
  for (const child of children) child.kill('SIGKILL');
  if (started) spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { env: pgEnv, stdio: 'ignore' });
  rmSync(scratchRoot, { recursive: true, force: true }); // only our mkdtemp directory
});
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'];
const literal = (value) => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const uuid = (n) => `89000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uuid(1), B = uuid(2), C = uuid(3), D = uuid(5), E = uuid(6), PAIR = uuid(20);
let assertions = 0;
function check(value, label) {
  assertions += 1;
  if (!value) throw new Error(label);
}
function result(sql) {
  return spawnSync('psql', args, { env: pgEnv, input: sql, encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
}
function run(sql, label = 'SQL') {
  const out = result(sql);
  if (out.status !== 0) throw new Error(`${label}: ${out.stderr || out.error?.message || 'psql failed'}`);
  return out.stdout.trim();
}
function actor(user, sql, role = 'authenticated') {
  return `BEGIN;
    SET LOCAL ROLE ${role};
    SET LOCAL "request.jwt.claim.role" = ${literal(role)};
    SET LOCAL "request.jwt.claim.sub" = ${literal(user || '')};
    ${sql}
    COMMIT;`;
}
function denied(sql, expected, label) {
  const out = result(sql);
  check(out.status !== 0 && expected.test(out.stderr), `${label}: expected rejection, got ${out.stderr || out.stdout}`);
}
function read(user, owner = user) {
  return JSON.parse(run(actor(user, `SELECT COALESCE(public.get_profile_avatar('${owner}'), 'null'::JSONB);`)));
}
function writeSql(user, expected, operation, base64) {
  return `SELECT public.set_my_profile_avatar('${user}', ${literal(expected)}, '${operation}', ${literal(base64)});`;
}
function write(user, expected, operation, bytes) {
  return JSON.parse(run(actor(user, writeSql(user, expected, operation, bytes?.toString('base64') ?? null))));
}
function deletionSql(user, attempt) {
  return `SELECT public.begin_account_deletion_v2('${user}', ARRAY[]::UUID[], '${attempt}');`;
}
function session(name) {
  const child = spawn('psql', args, { env: { ...pgEnv, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  const state = { child, stdout: '', stderr: '', exit: undefined };
  child.stdout.on('data', (data) => { state.stdout += data; });
  child.stderr.on('data', (data) => { state.stderr += data; });
  child.on('exit', (code) => { state.exit = code; children.delete(child); });
  return state;
}
async function waitUntil(predicate, label) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timeout: ${label}`);
    await new Promise((done) => setTimeout(done, 15));
  }
}
function hold(user, sql, label, role = 'authenticated') {
  const state = session(label);
  state.child.stdin.write(actor(user, `${sql}\nSELECT '${label}';`, role).replace(/COMMIT;$/, '') + '\n');
  return state;
}
async function finish(state) {
  state.child.stdin.end('COMMIT;\n');
  await waitUntil(() => state.exit !== undefined, 'session completion');
}
async function waitsOnLock(name) {
  await waitUntil(() => run(`SELECT count(*) FROM pg_stat_activity
    WHERE application_name = '${name}' AND wait_event_type = 'Lock';`) === '1', `${name} lock wait`);
}

execFileSync('initdb', ['-D', dataDir, '-U', 'postgres', '--no-sync', '-A', 'trust'], { env: pgEnv, stdio: 'ignore' });
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h ''`, '-w', 'start'], { env: pgEnv, stdio: 'ignore' });
started = true;
execFileSync('createdb', [pgEnv.PGDATABASE], { env: pgEnv, stdio: 'ignore' });
run(`
  CREATE SCHEMA extensions;
  CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT,
    raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB
  );
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;
  CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT false);
  CREATE TABLE storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT REFERENCES storage.buckets(id),
    name TEXT NOT NULL UNIQUE, owner UUID, owner_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
  GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
  CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
    $$ SELECT CASE WHEN array_length(string_to_array(name, '/'), 1) <= 1 THEN ARRAY[]::TEXT[]
      ELSE (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] END $$;
  CREATE FUNCTION storage.filename(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
    $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
  CREATE PUBLICATION supabase_realtime;
`, 'Supabase catalog fixture');
const files = readdirSync(MIGRATIONS).filter((file) => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 89)
  .sort((a, b) => a.localeCompare(b, 'en'));
for (const file of files) {
  if (file === '002_fix_rls_recursion.sql') {
    run(`DROP POLICY IF EXISTS "Users can create couples" ON public.couples;
      DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
      DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
      DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;`);
  }
  run(readFileSync(join(MIGRATIONS, file), 'utf8'), `apply ${file}`);
}
check(run(`SELECT to_regprocedure('public.get_profile_avatar(uuid)') IS NOT NULL
  AND to_regprocedure('public.set_my_profile_avatar(uuid,uuid,uuid,text)') IS NOT NULL;`) === 't',
  '089 avatar RPC contract is missing from the fresh migration chain');
check(files.at(-1) === '089_private_profile_avatars.sql', 'fresh chain must include 089');
run(`
  INSERT INTO auth.users(id, email) VALUES ${[A, B, C, D, E].map((id, i) => `('${id}', 'avatar-${i}@example.test')`).join(',')};
  INSERT INTO public.profiles(id, display_name, role) SELECT id, 'Avatar fixture', 'gomsin' FROM auth.users;
  INSERT INTO public.couples(id) VALUES ('${PAIR}');
  INSERT INTO public.couple_members(couple_id, user_id, role, status) VALUES
    ('${PAIR}', '${A}', 'gomsin', 'active'), ('${PAIR}', '${B}', 'soldier', 'active');
`, 'avatar actors');
const jpeg = (width, height, background) => sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
const photo = await jpeg(16, 16, '#9a6655'), other = await jpeg(16, 16, '#336699');
const edge = await jpeg(256, 256, '#315579');
const progressive = await sharp(photo).jpeg({ progressive: true }).toBuffer();
const grayscale = await sharp(photo).greyscale().jpeg().toBuffer();
// COM padding is a genuine JPEG segment; it does not falsify the SOF dimensions.
function padJpeg(bytes, size) {
  const segment = Buffer.alloc(size - bytes.length, 0x20);
  segment[0] = 0xff; segment[1] = 0xfe; segment.writeUInt16BE(segment.length - 2, 2);
  return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]);
}
const atLimit = padJpeg(photo, 65_536);
check((await sharp(atLimit).metadata()).width === 16, '64KiB fixture is an actual JPEG');
check(read(A) === null && read(B, A) === null, 'missing permitted avatar returns JSON null');
const v1 = uuid(100), v2 = uuid(101), v3 = uuid(102);
const first = write(A, null, v1, photo);
check(first.user_id === A && first.version === v1 && Object.keys(first).length === 2, 'write returns exact agreed contract');
const partnerRead = read(B, A);
check(partnerRead.user_id === A && partnerRead.version === v1
  && partnerRead.jpeg_base64 === photo.toString('base64') && Object.keys(partnerRead).length === 3, 'partner reads exact JSON/JPEG without line breaks');
check(read(C, A) === null, 'unrelated actor denied');
denied(actor(null, `SELECT public.get_profile_avatar('${A}');`, 'anon'), /permission denied/, 'anon read denied');
denied(actor(null, `SELECT public.get_profile_avatar('${A}');`), /not_authenticated/, 'NULL subject read denied');
denied(actor(B, writeSql(A, v1, v2, other.toString('base64'))), /profile_avatar_actor_mismatch/, 'expected identity is not write authority');
denied(actor(null, writeSql(A, v1, v2, other.toString('base64'))), /not_authenticated/, 'NULL subject write denied');
for (const role of ['anon', 'service_role']) {
  denied(actor(A, writeSql(A, v1, v2, other.toString('base64')), role), /permission denied/, role + ' writer denied');
}
for (const sql of [
  `INSERT INTO public.profile_avatars(user_id,jpeg,version) VALUES ('${C}',NULL,'${v2}');`,
  `UPDATE public.profile_avatars SET jpeg=NULL WHERE user_id='${A}';`,
  `DELETE FROM public.profile_avatars WHERE user_id='${A}';`,
]) denied(actor(A, sql), /permission denied/, 'direct owner DML denied');
const invalidation = () => run(`SELECT updated_at::TEXT FROM public.collaboration_invalidations WHERE couple_id='${PAIR}' AND slice='profile';`);
const beforeReplay = invalidation();
const rowBeforeReplay = run(`SELECT updated_at::TEXT FROM public.profile_avatars WHERE user_id='${A}';`);
check(write(A, null, v1, photo).version === v1, 'response-loss replay succeeds');
check(run(`SELECT updated_at::TEXT FROM public.profile_avatars WHERE user_id='${A}';`) === rowBeforeReplay && invalidation() === beforeReplay, 'replay changes neither row nor invalidation');
denied(actor(A, writeSql(A, v1, v1, other.toString('base64'))), /profile_avatar_operation_conflict/, 'same operation different bytes denied');
denied(actor(A, writeSql(A, null, v2, other.toString('base64'))), /profile_avatar_version_conflict/, 'stale expected version denied');
check(read(A).version === v1, 'failed CAS preserves image');
check(write(A, v1, v2, photo).version === v2 && invalidation() === beforeReplay, 'same bytes advance version without visible-change invalidation');
check(write(A, v2, v3, other).version === v3 && invalidation() !== beforeReplay, 'replacement invalidates profile');
const removed = uuid(103);
write(A, v3, removed, null);
check(read(B, A)?.jpeg_base64 === null && read(A)?.version === removed, 'remove retains one null-JPEG row');
denied(actor(A, writeSql(A, v3, v2, photo.toString('base64'))), /profile_avatar_version_conflict/, 'stale save cannot resurrect removed image');
check(write(A, v3, removed, null).version === removed, 'remove replay idempotent');
let current = removed;
for (const [label, bytes] of [['256 square', edge], ['progressive', progressive], ['grayscale', grayscale], ['64KiB', atLimit]]) {
  const next = uuid(110 + assertions);
  write(A, current, next, bytes);
  check(read(A).jpeg_base64 === bytes.toString('base64'), label + ' round trip');
  current = next;
}
const malformedSof = Buffer.from(photo);
const sof = malformedSof.indexOf(Buffer.from([0xff, 0xc0]));
check(sof >= 0, 'baseline fixture has genuine SOF0');
malformedSof.writeUInt16BE(0, sof + 5);
const badSegment = Buffer.from(photo); badSegment.writeUInt16BE(1, 4);
const secondSof = Buffer.concat([photo.subarray(0, sof), photo.subarray(sof, sof + 19), photo.subarray(sof)]);
for (const [label, input] of [
  ['257 square', (await jpeg(257, 257, 'red')).toString('base64')],
  ['not square', (await jpeg(16, 32, 'red')).toString('base64')],
  ['65537 bytes', padJpeg(photo, 65_537).toString('base64')],
  ['zero SOF height', malformedSof.toString('base64')],
  ['bad segment length', badSegment.toString('base64')],
  ['duplicate SOF', secondSof.toString('base64')],
  ['truncated JPEG', photo.subarray(0, -1).toString('base64')],
  ['trailing bytes', Buffer.concat([photo, Buffer.from('extra')]).toString('base64')],
  ['SOI EOI only', Buffer.from([255,216,255,217]).toString('base64')],
  ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')],
  ['external URL', 'https://invalid.example/avatar.jpg'],
  ['data URL', 'data:image/jpeg;base64,' + photo.toString('base64')],
  ['empty', ''], ['invalid base64', '!!!!'], ['whitespace', photo.toString('base64') + '\n'],
]) denied(actor(A, writeSql(A, current, uuid(200), input)), /profile_avatar_invalid_jpeg/, label);
check(read(A).version === current, 'bad input preserves version');
denied(actor(A, `SELECT public.set_my_profile_avatar('${A}','${current}',NULL,NULL);`), /profile_avatar_operation_required/, 'operation required');
denied(actor(A, `SELECT public.set_my_profile_avatar(NULL,'${current}','${uuid(201)}',NULL);`), /profile_avatar_actor_mismatch/, 'expected user required');

// Explicitly corrupt only isolated test fixtures and roll back; the read must
// reject each bad topology independently of the normal mutation constraints.
for (const [label, table, mutation] of [
  ['pending requester', 'couple_members', `UPDATE public.couple_members SET status='pending' WHERE user_id='${B}';`],
  ['pending owner', 'couple_members', `UPDATE public.couple_members SET status='pending' WHERE user_id='${A}';`],
  ['closed with active flags', 'couples', `UPDATE public.couples SET closed_at=clock_timestamp() WHERE id='${PAIR}';`],
]) {
  const probe = run(`BEGIN;
    ALTER TABLE public.${table} DISABLE TRIGGER USER; ${mutation}
    ALTER TABLE public.${table} ENABLE TRIGGER USER;
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claim.role"='authenticated';
    SET LOCAL "request.jwt.claim.sub"='${B}';
    SELECT COALESCE(public.get_profile_avatar('${A}'),'null'::JSONB);
    ROLLBACK;`);
  check(probe === 'null', label + ' denied');
}
const winner = uuid(300), loser = uuid(301);
const writer1 = hold(A, writeSql(A, current, winner, photo.toString('base64')), 'avatar_cas_held');
await waitUntil(() => writer1.stdout.includes('avatar_cas_held'), 'first writer holds');
const writer2 = session('avatar_cas_waiter');
writer2.child.stdin.end(actor(A, writeSql(A, current, loser, other.toString('base64'))));
await waitsOnLock('avatar_cas_waiter');
await finish(writer1);
await waitUntil(() => writer2.exit !== undefined, 'CAS loser done');
check(writer1.exit === 0 && writer2.exit !== 0 && /profile_avatar_version_conflict/.test(writer2.stderr), 'concurrent CAS exactly one winner');
check(read(A).version === winner, 'loser never overwrites winner');
current = winner;
run(`CREATE FUNCTION public.avatar_harness_reject_invalidation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'fixture_invalidation_failed'; END $$;
  CREATE TRIGGER zzz_avatar_harness_reject BEFORE INSERT OR UPDATE ON public.collaboration_invalidations
  FOR EACH ROW EXECUTE FUNCTION public.avatar_harness_reject_invalidation();`);
denied(actor(A, writeSql(A, current, uuid(302), other.toString('base64'))), /fixture_invalidation_failed/, 'invalidation failure aborts transaction');
check(read(A).version === current, 'invalidation failure preserves image');
run(`DROP TRIGGER zzz_avatar_harness_reject ON public.collaboration_invalidations;
  DROP FUNCTION public.avatar_harness_reject_invalidation();`);
write(B, null, uuid(310), other);
run(actor(null, deletionSql(A, uuid(311)), 'service_role'));
check(read(A) === null && read(B, A) === null, 'deletion-pending owner hidden');
check(read(A, B) === null, 'deletion-pending requester denied');
denied(actor(A, writeSql(A, current, uuid(312), photo.toString('base64'))), /account_deletion_pending/, 'pending owner fenced');
denied(actor(B, writeSql(B, uuid(310), uuid(313), photo.toString('base64'))), /account_deletion_pending/, 'partner fence blocks invalidation mutation');
check(run(`SELECT version::TEXT FROM public.profile_avatars WHERE user_id='${B}';`) === uuid(310), 'partner bytes preserved while fenced');
// Auth cannot bypass the existing relationship-close gate. Drive the same
// database phases as delete-account before testing its final FK cascade.
denied(`BEGIN;
  DELETE FROM auth.users WHERE id='${A}'; COMMIT;`,
  /open_relationship_membership_delete_forbidden/, 'premature Auth cascade remains forbidden');
check(run(`SELECT count(*) FROM public.profile_avatars WHERE user_id='${A}';`) === '1',
  'failed early cascade rolls avatar removal back');
run(actor(null, `
  SELECT public.e2ee_prepare_account_deletion_v2('${A}','${uuid(311)}');
  SELECT public.prepare_account_deletion_v2('${A}',ARRAY[]::UUID[],'${uuid(311)}');
  SELECT public.close_account_relationship_generations_v2('${A}','${uuid(311)}');
  SELECT public.cleanup_account_solo_couples_v2('${A}','${uuid(311)}');
  SELECT public.iap_prepare_account_deletion_v2('${A}','${uuid(311)}');
`, 'service_role'), 'existing delete-account database phases');
// Actual FK cascade as the local catalog owner, with no end-user JWT.
// Hosted GoTrue's role/grants are NOT reproduced by this catalog stub.
run(`
  BEGIN;
  DELETE FROM auth.users WHERE id='${A}'; COMMIT;`, 'Auth cascade');
check(run(`SELECT count(*) FROM public.profile_avatars WHERE user_id='${A}';`) === '0', 'cascade removes owner avatar');
check(read(B)?.jpeg_base64 === other.toString('base64'), 'cascade preserves partner avatar');
denied(actor(A, writeSql(A, null, uuid(314), photo.toString('base64'))), /profile_avatar_profile_missing/, 'stale deleted-user JWT cannot recreate avatar');

write(D, null, uuid(320), photo);
const draining = hold(D, writeSql(D, uuid(320), uuid(321), other.toString('base64')), 'avatar_write_draining');
await waitUntil(() => draining.stdout.includes('avatar_write_draining'), 'draining write');
const deleting = session('avatar_deletion_waiter');
deleting.child.stdin.end(actor(null, deletionSql(D, uuid(322)), 'service_role'));
await waitsOnLock('avatar_deletion_waiter');
await finish(draining);
await waitUntil(() => deleting.exit !== undefined, 'deletion after write');
check(draining.exit === 0 && deleting.exit === 0 && read(D) === null, 'deletion drains admitted write then hides avatar');
denied(actor(D, writeSql(D, uuid(321), uuid(323), photo.toString('base64'))), /account_deletion_pending/, 'no late write after marker');
const deletingFirst = hold(null, deletionSql(E, uuid(330)), 'avatar_delete_held', 'service_role');
await waitUntil(() => deletingFirst.stdout.includes('avatar_delete_held'), 'deletion holds');
const late = session('avatar_late_writer');
late.child.stdin.end(actor(E, writeSql(E, null, uuid(331), photo.toString('base64'))));
await waitsOnLock('avatar_late_writer');
await finish(deletingFirst);
await waitUntil(() => late.exit !== undefined, 'late writer done');
check(late.exit !== 0 && /account_deletion_pending/.test(late.stderr), 'write waiting behind deletion fails closed');
check(run(`SELECT count(*) FROM public.profile_avatars WHERE user_id='${E}';`) === '0', 'late first upload leaves no row');
const pair2 = uuid(30);
run(`INSERT INTO public.couples(id) VALUES ('${pair2}');
  UPDATE public.couple_members SET status='disconnected' WHERE user_id='${B}';
  INSERT INTO public.couple_members(couple_id,user_id,role,status) VALUES
  ('${pair2}','${B}','gomsin','active'), ('${pair2}','${C}','soldier','active');`);
check(read(C, B)?.version === uuid(310), 'new active partner sees current identity');
run(actor(B, 'SELECT public.disconnect_couple();'));
check(read(C, B) === null && read(B)?.version === uuid(310), 'real disconnect denies former partner and preserves owner');
check(run(`SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'
  AND schemaname='public' AND tablename='profile_avatars';`) === '0', 'JPEG rows absent from Realtime');
check(run(`SELECT count(*) FROM storage.buckets WHERE id IN ('avatars','profile-avatars');`) === '0', 'no avatar bucket');
check(run(actor(null, 'SELECT public.record_media_cleanup_contract_version();', 'service_role')) === '4', 'record cleanup unchanged');
console.log(`PASS — profile avatars: ${files.length} actual migrations (001..089), ${assertions} assertions; actors, JPEG, CAS, deletion races and cascade.`);
console.log('UNVERIFIED — hosted Auth/PostgREST/Realtime, production, browser/client/UI and physical devices. No remote calls.');
