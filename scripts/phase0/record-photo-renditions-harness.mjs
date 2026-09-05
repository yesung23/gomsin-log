#!/usr/bin/env node
/**
 * Dedicated local PostgreSQL 001..090 photo-rendition contract harness.
 * Only Supabase catalog/auth helpers are fixtures; migrations run unchanged.
 * The historical duplicate-002 policy bootstrap matches the existing chain harness.
 * No hosted API, Storage byte transport or server image-decoding claim.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
// Run the original 084..088 regression assertions with 090 installed, without
// editing/copying that shared harness on disk. Only two missing catalog columns
// in its deliberately minimal fixture are supplied. Every original test stays.
if (process.argv.includes('--regression-084')) {
  const sourcePath = join(ROOT, 'scripts/phase0/record-media-cleanup-harness.mjs');
  let source = readFileSync(sourcePath, 'utf8');
  const rootAnchor = "const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');";
  const migrationAnchor = "expectOk(psql(['-q', '-f', MIGRATION_088]), 'apply migration 088 after conflict removal');";
  for (const anchor of [rootAnchor,migrationAnchor]) {
    if (source.split(anchor).length !== 2) throw new Error('Shared harness changed: integration anchor must be reviewed.');
  }
  source = source.replace(rootAnchor, `const ROOT = ${JSON.stringify(ROOT)};`);
  source = source.replace(migrationAnchor, migrationAnchor + '\n' +
    `expectOk(sql("CREATE TABLE public.profiles (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE); ALTER TABLE public.daily_records ADD COLUMN cipher_format SMALLINT NOT NULL DEFAULT 0;"), '090 minimal catalog additions');\n` +
    `expectOk(psql(['-q','-f',join(ROOT,'supabase/migrations/090_record_photo_renditions.sql')]), 'install 090 before unchanged legacy regression');\n`);
  console.log('090 integration mode — unchanged existing 084..088 actor/race assertions follow.');
  const regression = spawnSync(process.execPath,['--input-type=module'],{
    input:source,encoding:'utf8',stdio:['pipe','inherit','inherit'],timeout:120_000,
  });
  if (regression.error) console.error(regression.error.message);
  process.exit(regression.status ?? 1);
}
for (const binary of ['initdb', 'pg_ctl', 'createdb', 'psql']) {
  if (spawnSync(binary, ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error(`MISSING VERIFICATION: ${binary} unavailable.`);
    process.exit(2);
  }
}
const scratchRoot = mkdtempSync('/tmp/gsl-photo-');
const dataDir = join(scratchRoot, 'data'), socketDir = join(scratchRoot, 'socket');
mkdirSync(socketDir);
const pgEnv = {
  ...process.env, LC_ALL: 'C', LANG: 'C', PGHOST: socketDir,
  PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'record_photo_renditions_harness',
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
const uuid = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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

const files = readdirSync(MIGRATIONS)
  .filter((file) => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 90)
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
const RECORD = uuid(40);
run(`
  INSERT INTO auth.users(id,email) VALUES
    ('${A}','photo-a@example.test'), ('${B}','photo-b@example.test');
  INSERT INTO public.profiles(id,display_name,role) VALUES
    ('${A}','Photo A','gomsin'), ('${B}','Photo B','soldier');
  INSERT INTO public.couples(id) VALUES ('${PAIR}');
  INSERT INTO public.couple_members(couple_id,user_id,role,status) VALUES
    ('${PAIR}','${A}','gomsin','active'), ('${PAIR}','${B}','soldier','active');
  INSERT INTO public.daily_records(id,user_id,couple_id,record_date,is_private)
    VALUES ('${RECORD}','${A}','${PAIR}',CURRENT_DATE,false);
`, 'seed source and actors');
check(run(actor(null, 'SELECT public.record_media_cleanup_contract_version();', 'service_role')) === '4',
  'existing cleanup contract stays 4');
const photo = {
  screen_master: { media_object_id: uuid(100), width_px: 1600, height_px: 1200, byte_size: 123456, sha256: 'a'.repeat(64) },
  thumbnail: { media_object_id: uuid(101), width_px: 640, height_px: 480, byte_size: 23456, sha256: 'b'.repeat(64) },
};
const begun = JSON.parse(run(actor(A, `SELECT public.begin_record_photo_mutation(
  '${uuid(200)}','${RECORD}','${A}','${PAIR}',1,2,ARRAY[]::TEXT[],
  ${literal(JSON.stringify([photo]))}::JSONB);`), 'owner atomically reserves master and thumbnail'));
check(begun.state === 'pending' && Number(begun.desired_object_count) === 2,
  'one logical photo reserves exactly two physical objects');
check(run(`SELECT count(*) FROM public.record_media_objects
  WHERE record_id='${RECORD}' AND state='reserved';`) === '2', 'both stable IDs reserved');
check(run(`SELECT count(*) FROM public.record_photo_metadata
  WHERE record_id='${RECORD}';`) === '1', 'one metadata row bound to the reservation');
check(files.at(-1) === '090_record_photo_renditions.sql', 'requires the full 001..090 chain');
const arr = (items, type = 'TEXT') => `ARRAY[${items.map(literal).join(',')}]::${type}[]`;
const path = (record, id, couple = PAIR) => `${couple}/${record}/${id}.jpg`;
const photoFor = (id, overrides = {}) => ({
  screen_master: { ...photo.screen_master, media_object_id: uuid(id) },
  thumbnail: { ...photo.thumbnail, media_object_id: uuid(id + 1) }, ...overrides,
});
const begin = ({ op = uuid(200), record = RECORD, user = A, couple = PAIR, base = 1,
  paths = [], photos = [photo], ids } = {}) => `SELECT public.${ids ? 'begin_record_media_mutation' : 'begin_record_photo_mutation'}(
  '${op}','${record}','${user}','${couple}',${base},${base + 1},${arr(paths)},
  ${ids ? arr(ids, 'UUID') : literal(JSON.stringify(photos)) + '::JSONB'});`;
const metadata = (user, records = [RECORD]) => JSON.parse(run(actor(user,
  `SELECT public.get_record_photo_metadata(${arr(records, 'UUID')});`)));
const upload = (record, id, user = A, couple = PAIR) => `INSERT INTO storage.objects(bucket_id,name,owner_id)
  VALUES('couple-media','${path(record, id, couple)}','${user}');`;
const commit = (record, op) => `UPDATE public.daily_records SET log_text='fixture',
  last_media_operation_id='${op}' WHERE id='${record}';`;
const abandon = (record, op, user = A, couple = PAIR) => `SELECT public.abandon_record_media_mutation(
  '${op}','${record}','${user}','${couple}');`;
const deletion = (user, attempt, records = []) => `SELECT public.begin_account_deletion_v2(
  '${user}',${arr(records,'UUID')},'${attempt}');`;
let day = 1;
function seedRecord(record, user = A, couple = PAIR, privateRecord = false) {
  run(`INSERT INTO public.daily_records(id,user_id,couple_id,record_date,is_private)
    VALUES('${record}','${user}','${couple}',CURRENT_DATE - ${day++},${privateRecord});`);
}
function publish(record, op, pair, user = A, couple = PAIR) {
  run(actor(user, begin({ record, op, photos: [pair], user, couple })));
  run(actor(user, upload(record, pair.screen_master.media_object_id, user, couple)
    + upload(record, pair.thumbnail.media_object_id, user, couple)));
  run(actor(user, commit(record, op)));
}
function altered(patch) { const copy = structuredClone(photo); patch(copy); return copy; }
for (const [label, alteredPhoto] of [
  ['zero width', altered(p => { p.screen_master.width_px = 0; })],
  ['negative height', altered(p => { p.thumbnail.height_px = -1; })],
  ['fractional dimension', altered(p => { p.thumbnail.width_px = 1.5; })],
  ['numeric string', altered(p => { p.screen_master.width_px = '1600'; })],
  ['master edge cap', altered(p => { p.screen_master.height_px = 2049; })],
  ['thumb edge cap', altered(p => { p.thumbnail.width_px = 641; })],
  ['master byte cap', altered(p => { p.screen_master.byte_size = 10485761; })],
  ['thumb byte cap', altered(p => { p.thumbnail.byte_size = 1048577; })],
  ['huge number', altered(p => { p.thumbnail.byte_size = 1e100; })],
  ['upsized thumbnail', altered(p => { p.screen_master.width_px = 100; })],
  ['uppercase hash', altered(p => { p.screen_master.sha256 = 'A'.repeat(64); })],
  ['hash wrong length', altered(p => { p.thumbnail.sha256 = 'b'.repeat(63); })],
  ['external URL', altered(p => { p.screen_master.url = 'https://example.test/photo.jpg'; })],
  ['MIME spoof', altered(p => { p.thumbnail.mime_type = 'image/svg+xml'; })],
  ['missing field', altered(p => { delete p.thumbnail.sha256; })],
  ['NULL descriptor', altered(p => { p.thumbnail = null; })],
  ['same two IDs', altered(p => { p.thumbnail.media_object_id = p.screen_master.media_object_id; })],
  ['invalid UUID', altered(p => { p.thumbnail.media_object_id = 'not-uuid'; })],
]) {
  denied(actor(A, begin({ photos: [alteredPhoto] })), /photo_metadata_invalid/, label);
}
for (const photos of [null, {}, [photo, photo], Array(33).fill(photo), [{ ...photo, purpose: 'print' }]]) {
  denied(actor(A, begin({ photos })), /photo_metadata_invalid/, 'invalid bounded photo array/unknown fields');
}
check(metadata(A).length === 0 && metadata(B).length === 0, 'pending registration invisible to both');
check(JSON.parse(run(actor(A, begin()))).state === 'pending', 'lost begin response replay');
check(run(`SELECT count(*) FROM public.record_photo_metadata;`) === '1', 'replay creates no metadata duplicates');
denied(actor(A, begin({ photos: [altered(p => { p.screen_master.byte_size++; })] })),
  /photo_operation_conflict/, 'same operation different bytes');
denied(actor(A, begin({ photos: [photoFor(102)] })), /photo_operation_conflict/, 'same operation different IDs');
denied(actor(A, begin({ photos: [{ screen_master: photo.thumbnail, thumbnail: photo.screen_master }] })),
  /photo_metadata_invalid|photo_operation_conflict/, 'swapped pair invalid');

run(`INSERT INTO auth.users(id,email) VALUES ('${C}','photo-c@example.test'),
  ('${D}','photo-d@example.test'),('${E}','photo-e@example.test');
  INSERT INTO public.profiles(id,display_name,role) VALUES ('${C}','C','gomsin'),
  ('${D}','D','gomsin'),('${E}','E','soldier');
  INSERT INTO public.couple_members(couple_id,user_id,role,status) VALUES
  ('${PAIR}','${E}','soldier','pending'),('${PAIR}','${D}','gomsin','disconnected');`);
for (const [user, label] of [[B,'partner'],[C,'unrelated'],[D,'former'],[E,'pending']]) {
  denied(actor(user, begin({ user })), /media_mutation_unavailable/, `${label} cannot reserve owner record`);
  check(metadata(user).length === 0, `${label} cannot read reserved registration`);
}
denied(actor(B, begin()), /media_mutation_unavailable/, 'expected actor spoof');
for (const role of ['anon','service_role']) {
  denied(actor(null, begin(), role), /permission denied/, `${role} begin denied`);
  denied(actor(null, 'SELECT public.get_record_photo_metadata(ARRAY[]::UUID[]);', role),
    /permission denied/, `${role} read RPC denied`);
}
denied(actor(null, begin()), /media_mutation_unavailable/, 'NULL actor begin denied');
denied(actor(null, 'SELECT public.get_record_photo_metadata(ARRAY[]::UUID[]);'),
  /media_mutation_unavailable/, 'NULL actor read denied');
for (const role of ['anon','authenticated','service_role']) {
  for (const statement of ['SELECT * FROM public.record_photo_metadata;',
    'DELETE FROM public.record_photo_metadata;',
    "UPDATE public.record_photo_metadata SET master_width_px=1;",
    'INSERT INTO public.record_photo_metadata DEFAULT VALUES;']) {
    denied(actor(A, statement, role), /permission denied/, `${role} private table denied`);
  }
}
for (const signature of [
  'begin_record_media_mutation_internal_090(uuid,uuid,uuid,uuid,bigint,bigint,text[],uuid[])',
  'begin_record_photo_dispatch_090(uuid,uuid,uuid,uuid,bigint,bigint,text[],uuid[],jsonb)',
  'normalize_record_photos_090(jsonb)', 'can_read_record_photo_metadata_090(uuid,uuid,uuid)',
]) {
  check(run(`SELECT has_function_privilege('authenticated','public.${signature}','EXECUTE');`) === 'f',
    'no private-function bypass');
}
check(run("SELECT relrowsecurity FROM pg_class WHERE oid='public.record_photo_metadata'::regclass;") === 't', 'metadata RLS enabled');
for (const input of ['NULL::UUID[]', `ARRAY['${RECORD}',NULL]::UUID[]`,
  arr([RECORD,RECORD], 'UUID'), arr(Array.from({length:101},(_,i)=>uuid(5000+i)), 'UUID'),
  `ARRAY[ARRAY['${RECORD}'],ARRAY['${uuid(999)}']]::UUID[]`]) {
  denied(actor(A, `SELECT public.get_record_photo_metadata(${input});`),
    /photo_metadata_invalid/, 'malformed batch denied without truncation');
}
check(metadata(A, []).length === 0, 'empty batch valid');
check(metadata(A, Array.from({length:100},(_,i)=>uuid(5000+i))).length === 0, '100 valid unknown IDs empty');

run(actor(A, upload(RECORD, photo.screen_master.media_object_id)));
denied(actor(A, commit(RECORD, uuid(200))), /media_upload_incomplete_or_ambiguous/, 'partial upload cannot publish');
check(run(`SELECT state FROM public.record_media_mutations WHERE operation_id='${uuid(200)}';`) === 'pending',
  'failed publication rolls operation back');
check(metadata(A).length === 0, 'partial upload still unreadable');
denied(actor(A, upload(RECORD, uuid(999))), /media_upload|record_media|unreserved/, 'unbound upload cannot smuggle thumbnail');
denied(actor(B, upload(RECORD, photo.thumbnail.media_object_id, B)), /row-level security|media_upload/, 'partner cannot fill reservation');
run(actor(A, upload(RECORD, photo.thumbnail.media_object_id)));
run(actor(A, commit(RECORD, uuid(200))));
check(JSON.parse(run(actor(A, begin()))).state === 'committed', 'lost commit response replay');
check(metadata(A).length === 1 && metadata(B).length === 1, 'published shared pair readable');
const readPhoto = metadata(A)[0];
check(readPhoto.source_revision === uuid(200) && readPhoto.media_id === photo.screen_master.media_object_id
  && readPhoto.screen_master.mime_type === 'image/jpeg' && readPhoto.thumbnail.width_px === 640,
  'frozen output metadata/source revision exact');
check(!JSON.stringify(readPhoto).includes('storage_path') && !JSON.stringify(readPhoto).includes('url'),
  'metadata response contains no URL/path');
for (const user of [C,D,E]) check(metadata(user).length === 0, 'noncurrent actor cannot read published pair');
denied(actor(A, begin({ photos: [altered(p => { p.thumbnail.sha256 = 'c'.repeat(64); })] })),
  /photo_operation_conflict/, 'committed replay changed hash rejected');

// Old editor only sends the master; its linked thumbnail remains in the manifest.
const masterPath = path(RECORD, photo.screen_master.media_object_id);
const thumbPath = path(RECORD, photo.thumbnail.media_object_id);
denied(actor(A, begin({ op:uuid(201), base:2, paths:[thumbPath], ids:[] })),
  /media_mutation_unavailable/, 'naked linked thumbnail denied');
const oldEdit = JSON.parse(run(actor(A, begin({op:uuid(201), base:2, paths:[masterPath], ids:[]}))));
check(oldEdit.desired_object_count === 2, 'old editor master expands linked thumbnail');
run(actor(A, commit(RECORD, uuid(201))));
check(metadata(B)[0].source_revision === uuid(200), 'text edit preserves immutable source revision');
check(run(`SELECT count(*) FROM public.record_media_objects WHERE record_id='${RECORD}' AND state='active';`) === '2',
  'old editor does not retire hidden thumbnail');
const explicitBoth = JSON.parse(run(actor(A, begin({op:uuid(202), base:3, paths:[masterPath,thumbPath], ids:[]}))));
check(explicitBoth.desired_object_count === 2, 'explicit bound pair not doubled');
run(actor(A, commit(RECORD, uuid(202))));

// Private/closed/owner-inactive/cipher fixtures are isolated reversible catalog
// states, not attempts to modify crypto using the new feature.
function projectedState(table, update, assertion) {
  const out = run(`BEGIN; ALTER TABLE public.${table} DISABLE TRIGGER USER;
    ${update}
    SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.role"='authenticated';
    SET LOCAL "request.jwt.claim.sub"='${B}';
    SELECT jsonb_array_length(public.get_record_photo_metadata(${arr([RECORD], 'UUID')}));
    ROLLBACK;`);
  check(out === '0', assertion);
}
projectedState('daily_records', `UPDATE public.daily_records SET is_private=true WHERE id='${RECORD}';`, 'private pair denied to partner');
projectedState('couples', `UPDATE public.couples SET closed_at=clock_timestamp() WHERE id='${PAIR}';`, 'closed couple pair denied');
projectedState('couple_members', `UPDATE public.couple_members SET status='disconnected' WHERE user_id='${A}';`,
  'inactive source owner pair denied');
for (const viewer of [A,B]) {
  check(run(`BEGIN; ALTER TABLE public.daily_records DISABLE TRIGGER USER;
    UPDATE public.daily_records SET cipher_format=1 WHERE id='${RECORD}';
    SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${viewer}';
    SELECT jsonb_array_length(public.get_record_photo_metadata(${arr([RECORD], 'UUID')}));
    ROLLBACK;`) === '0', 'cipher >=1 metadata excluded for owner and partner');
}
const privateRecord=uuid(41); seedRecord(privateRecord,A,PAIR,true);
publish(privateRecord,uuid(210),photoFor(110));
check(metadata(A,[privateRecord]).length === 1 && metadata(B,[privateRecord]).length === 0, 'private owner retains metadata access');
const otherRecord=uuid(42); seedRecord(otherRecord);
denied(actor(A, begin({record:otherRecord,op:uuid(211),paths:[masterPath],photos:[]})),
  /media_mutation_unavailable/, 'foreign record master path denied');
denied(actor(A, begin({record:otherRecord,op:uuid(212),photos:[photo]})),
  /media_mutation_unavailable/, 'foreign record pair UUID binding denied');
denied(actor(A, begin({record:otherRecord,op:uuid(212),photos:[{
  screen_master:{...photo.screen_master,media_object_id:photo.thumbnail.media_object_id},
  thumbnail:{...photo.thumbnail,media_object_id:uuid(113)}}]})),
  /media_object_id_retired|media_mutation_unavailable/, 'cross-role reused thumbnail denied');
check(run(`SELECT count(*) FROM public.record_media_mutations WHERE record_id='${otherRecord}';`) === '0',
  'failed foreign registration atomic rollback');
const tiny = photoFor(120);
tiny.screen_master.width_px=16; tiny.screen_master.height_px=8; tiny.screen_master.byte_size=100;
tiny.thumbnail.width_px=16; tiny.thumbnail.height_px=8; tiny.thumbnail.byte_size=100;
publish(otherRecord,uuid(213),tiny);
check(metadata(A,[otherRecord])[0].thumbnail.width_px===16, 'small images need not reach 640px');

// 32 logical photos really reserve/publish 64 physical objects. The legacy
// endpoint cannot reserve 33 unpaired objects or mix 32 retained masters + one.
const capRecord=uuid(43); seedRecord(capRecord);
const capPhotos=Array.from({length:32},(_,i)=>photoFor(1000+i*2));
denied(actor(A, begin({record:capRecord,op:uuid(220),ids:Array.from({length:33},(_,i)=>uuid(2000+i))})),
  /media_mutation_unavailable/, 'legacy 33 unpaired denied');
const capBegin=JSON.parse(run(actor(A, begin({record:capRecord,op:uuid(221),photos:capPhotos}))));
check(capBegin.desired_object_count===64, '32 photos reserve 64 physical objects');
run(actor(A,capPhotos.map(p=>upload(capRecord,p.screen_master.media_object_id)+upload(capRecord,p.thumbnail.media_object_id)).join('\n')));
run(actor(A,commit(capRecord,uuid(221))));
check(metadata(A,[capRecord]).length===32, '32 logical photos publish');
const capPaths=capPhotos.map(p=>path(capRecord,p.screen_master.media_object_id));
denied(actor(A,begin({record:capRecord,op:uuid(222),base:2,paths:capPaths,ids:[uuid(2100)]})),
  /media_mutation_unavailable/, '32 retained masters plus unpaired exceeds logical cap');
const capOld=JSON.parse(run(actor(A,begin({record:capRecord,op:uuid(223),base:2,paths:capPaths,ids:[]}))));
check(capOld.desired_object_count===64, 'old editor retains 32 pairs');
run(actor(A,commit(capRecord,uuid(223))));

// Abandon after a partial upload schedules exactly the uploaded master, while
// the never-uploaded thumb is a settled tombstone. Neither is readable.
const abandonRecord=uuid(44), abandonPhoto=photoFor(130); seedRecord(abandonRecord);
run(actor(A,begin({record:abandonRecord,op:uuid(230),photos:[abandonPhoto]})));
run(actor(A,upload(abandonRecord,abandonPhoto.screen_master.media_object_id)));
run(actor(A,abandon(abandonRecord,uuid(230))));
check(run(`SELECT string_agg(state,',' ORDER BY media_object_id) FROM public.record_media_objects
  WHERE record_id='${abandonRecord}';`)==='cleanup_pending,deleted','partial abandon states exact');
check(metadata(A,[abandonRecord]).length===0,'abandoned metadata private');
denied(actor(A,upload(abandonRecord,abandonPhoto.thumbnail.media_object_id)),
  /media_upload|record_media/, 'no late thumbnail after abandon');
check(JSON.parse(run(actor(A,begin({record:abandonRecord,op:uuid(230),photos:[abandonPhoto]})))).state==='abandoned',
  'abandoned same-request replay does not resurrect pair');
denied(actor(A,begin({record:abandonRecord,op:uuid(230),photos:[{...abandonPhoto,
  thumbnail:{...abandonPhoto.thumbnail,byte_size:20}}]})),/photo_operation_conflict/,
  'abandoned changed metadata replay rejected');

// Replacement queues both old objects; an old-editor removal queues both new.
const replacement=photoFor(140);
run(actor(A,begin({op:uuid(240),base:4,photos:[replacement]})));
run(actor(A,upload(RECORD,replacement.screen_master.media_object_id)+upload(RECORD,replacement.thumbnail.media_object_id)));
run(actor(A,commit(RECORD,uuid(240))));
check(run(`SELECT count(*) FROM public.record_media_objects WHERE media_object_id=ANY(
  ${arr([photo.screen_master.media_object_id,photo.thumbnail.media_object_id],'UUID')}) AND state='cleanup_pending';`)==='2',
  'replacement retires both old objects');
check(metadata(A).length===1 && metadata(A)[0].media_id===replacement.screen_master.media_object_id,
  'metadata only active replacement');
run(actor(A,begin({op:uuid(241),base:5,ids:[]})));
run(actor(A,commit(RECORD,uuid(241))));
check(metadata(A).length===0, 'old-editor remove hides metadata');
denied(actor(A,begin({op:uuid(201),base:2,photos:[],paths:[
  path(uuid(999),photo.screen_master.media_object_id),
  path(uuid(999),photo.thumbnail.media_object_id)]})),/media_mutation_unavailable/,
  'terminal replay cannot substitute foreign namespace for the same object UUIDs');
check(run(`SELECT count(*) FROM public.record_media_objects WHERE record_id='${RECORD}' AND state='cleanup_pending';`)==='4',
  'remove queues both current objects too');

// Stale reservation expiry uses the existing 086 worker, without a new queue.
const expiryRecord=uuid(45), expiryPhoto=photoFor(150); seedRecord(expiryRecord);
run(actor(A,begin({record:expiryRecord,op:uuid(250),photos:[expiryPhoto]})));
run(actor(A,upload(expiryRecord,expiryPhoto.thumbnail.media_object_id)));
run(`UPDATE public.record_media_mutations SET created_at=clock_timestamp()-interval '20 minutes'
  WHERE operation_id='${uuid(250)}';`);
check(run(actor(null,'SELECT public.expire_stale_record_media_mutation();','service_role'))==='t',
  'existing expiry settles stale photo mutation');
check(run(`SELECT string_agg(state,',' ORDER BY media_object_id) FROM public.record_media_objects
  WHERE record_id='${expiryRecord}';`)==='deleted,cleanup_pending','expiry queues uploaded thumb only');
check(metadata(A,[expiryRecord]).length===0, 'expired metadata excluded');

let leaseNumber=6000;
function cleanupObject(id) {
  const lease=uuid(leaseNumber++);
  run(`UPDATE public.record_media_objects SET next_attempt_at=clock_timestamp()+interval '1 day'
    WHERE state='cleanup_pending';
    UPDATE public.record_media_objects SET next_attempt_at=clock_timestamp() WHERE media_object_id='${id}';`);
  const job=JSON.parse(run(actor(null,`SELECT to_jsonb(job) FROM public.claim_record_media_object_cleanup_job(
    '${lease}',120) job;`,'service_role')));
  check(job.media_object_id===id,'existing worker claims exact rendition object');
  const resolved=run(actor(null,`SELECT storage_path FROM public.resolve_record_media_object_cleanup_path(
    '${id}','${job.storage_object_id}','${lease}');`,'service_role'));
  check(resolved.endsWith('/'+id+'.jpg'),'existing resolver returns exact UUID path');
  run(actor(null,`DELETE FROM storage.objects WHERE id='${job.storage_object_id}';`,'service_role'));
  check(run(actor(null,`SELECT public.settle_record_media_object_cleanup_job(
    '${id}','${job.storage_object_id}','${lease}');`,'service_role'))==='t','exact rendition cleanup settled');
}
for (const id of [photo.screen_master.media_object_id,photo.thumbnail.media_object_id,
  replacement.screen_master.media_object_id,replacement.thumbnail.media_object_id,
  abandonPhoto.screen_master.media_object_id,expiryPhoto.thumbnail.media_object_id]) cleanupObject(id);
check(run(`SELECT count(*) FROM storage.objects WHERE name LIKE '${PAIR}/${RECORD}/%';`)==='0',
  'both generations physically removed by existing cleanup');
check(JSON.parse(run(actor(A,begin()))).state==='committed',
  'terminal replay after physical cleanup still checks retained immutable request');
denied(actor(A,begin({photos:[altered(p=>{p.screen_master.byte_size++;})]})),
  /photo_operation_conflict/,'changed request after cleanup rejected');
check(metadata(A).length===0,'settled historical metadata never published');

// Real competing PostgreSQL backends, synchronized on pg_stat_activity locks.
const raceRecord=uuid(46), racePhoto=photoFor(160); seedRecord(raceRecord);
const winner=hold(A,begin({record:raceRecord,op:uuid(260),photos:[racePhoto]})+
  upload(raceRecord,racePhoto.screen_master.media_object_id)+upload(raceRecord,racePhoto.thumbnail.media_object_id)+
  commit(raceRecord,uuid(260)),'photo_cas_winner');
await waitUntil(()=>winner.stdout.includes('photo_cas_winner'),'publication held');
const loser=session('photo_cas_loser');
loser.child.stdin.end(actor(A,begin({record:raceRecord,op:uuid(261),photos:[photoFor(162)]})));
await waitsOnLock('photo_cas_loser'); await finish(winner);
await waitUntil(()=>loser.exit!==undefined,'stale competing begin');
check(winner.exit===0 && loser.exit!==0 && /media_mutation_stale_revision/.test(loser.stderr),
  'concurrent CAS one winner and no second reservation');
check(run(`SELECT count(*) FROM public.record_photo_metadata WHERE record_id='${raceRecord}';`)==='1',
  'loser leaves no metadata');
const replayRecord=uuid(47), replayPhoto=photoFor(170); seedRecord(replayRecord);
const replayFirst=hold(A,begin({record:replayRecord,op:uuid(270),photos:[replayPhoto]}),'photo_replay_first');
await waitUntil(()=>replayFirst.stdout.includes('photo_replay_first'),'first begin held');
const replaySecond=session('photo_replay_second');
replaySecond.child.stdin.end(actor(A,begin({record:replayRecord,op:uuid(270),photos:[replayPhoto]})));
await waitsOnLock('photo_replay_second'); await finish(replayFirst);
await waitUntil(()=>replaySecond.exit!==undefined,'same operation concurrent replay');
check(replayFirst.exit===0 && replaySecond.exit===0 && replaySecond.stdout.includes('"pending"'),
  'concurrent identical begin idempotent');
check(run(`SELECT count(*) FROM public.record_photo_metadata WHERE record_id='${replayRecord}';`)==='1',
  'concurrent retry one metadata row');
run(actor(A,abandon(replayRecord,uuid(270))));

const deleteSql=(record,user=A,couple=PAIR)=>`SELECT public.delete_my_record('${record}','${user}','${couple}');`;
const deleteRecord=uuid(48), deletePhoto=photoFor(180); seedRecord(deleteRecord);
const publication=hold(A,begin({record:deleteRecord,op:uuid(280),photos:[deletePhoto]})+
  upload(deleteRecord,deletePhoto.screen_master.media_object_id)+upload(deleteRecord,deletePhoto.thumbnail.media_object_id)+
  commit(deleteRecord,uuid(280)),'photo_publish_before_delete');
await waitUntil(()=>publication.stdout.includes('photo_publish_before_delete'),'publication before delete held');
const recordDelete=session('photo_record_delete_waiter');
recordDelete.child.stdin.end(actor(A,deleteSql(deleteRecord)));
await waitsOnLock('photo_record_delete_waiter'); await finish(publication);
await waitUntil(()=>recordDelete.exit!==undefined,'record delete after publication');
check(publication.exit===0 && recordDelete.exit===0,'record delete drains publication');
check(run(`SELECT count(*) FROM public.record_photo_metadata WHERE record_id='${deleteRecord}';`)==='0',
  'record cascade removes metadata without deleting cleanup ledger');
check(run(`SELECT count(*) FROM public.record_media_objects WHERE record_id='${deleteRecord}'
  AND state='superseded';`)==='2','record delete preserves both identities under existing prefix authority');
check(metadata(A,[deleteRecord]).length===0,'deleted record no metadata');
const deleteFirstRecord=uuid(49); seedRecord(deleteFirstRecord);
const deleteFirst=hold(A,deleteSql(deleteFirstRecord),'photo_delete_first');
await waitUntil(()=>deleteFirst.stdout.includes('photo_delete_first'),'delete first held');
const lateBegin=session('photo_late_begin');
lateBegin.child.stdin.end(actor(A,begin({record:deleteFirstRecord,op:uuid(290),photos:[photoFor(190)]})));
await waitsOnLock('photo_late_begin'); await finish(deleteFirst);
await waitUntil(()=>lateBegin.exit!==undefined,'late begin after record deletion');
check(lateBegin.exit!==0 && /media_mutation_unavailable/.test(lateBegin.stderr),'late begin cannot resurrect deleted record');
check(run(`SELECT count(*) FROM public.record_media_objects WHERE record_id='${deleteFirstRecord}';`)==='0',
  'delete-first leaves no reserved objects');

// Account fence with a separate real pair: A's broad prior fixtures cannot
// accidentally make the cascade proof vacuous. Both actors own a published pair.
const F=uuid(7),G=uuid(8), H=uuid(9),I=uuid(10),accountPair=uuid(21),secondPair=uuid(22);
run(`INSERT INTO auth.users(id,email) VALUES ('${F}','photo-f@example.test'),('${G}','photo-g@example.test'),
  ('${H}','photo-h@example.test'),('${I}','photo-i@example.test');
  INSERT INTO public.profiles(id,display_name,role) VALUES ('${F}','F','gomsin'),('${G}','G','soldier'),
  ('${H}','H','gomsin'),('${I}','I','soldier');
  INSERT INTO public.couples(id) VALUES ('${accountPair}'),('${secondPair}');
  INSERT INTO public.couple_members(couple_id,user_id,role,status) VALUES
  ('${accountPair}','${F}','gomsin','active'),('${accountPair}','${G}','soldier','active'),
  ('${secondPair}','${H}','gomsin','active'),('${secondPair}','${I}','soldier','active');`);
const fRecord=uuid(50),gRecord=uuid(51),hRecord=uuid(52);
seedRecord(fRecord,F,accountPair); seedRecord(gRecord,G,accountPair); seedRecord(hRecord,H,secondPair);
const fPhoto=photoFor(300),gPhoto=photoFor(302);
publish(fRecord,uuid(400),fPhoto,F,accountPair); publish(gRecord,uuid(401),gPhoto,G,accountPair);
check(metadata(F,[fRecord,gRecord]).length===2 && metadata(G,[fRecord,gRecord]).length===2,'pre-fence both owners pairs visible');
const admitted=hold(F,begin({record:fRecord,op:uuid(402),user:F,couple:accountPair,base:2,
  paths:[path(fRecord,fPhoto.screen_master.media_object_id,accountPair)],ids:[]})+
  commit(fRecord,uuid(402)),'photo_account_admitted_write');
await waitUntil(()=>admitted.stdout.includes('photo_account_admitted_write'),'admitted write held');
const fence=session('photo_account_fence_waiter');
fence.child.stdin.end(actor(null,deletion(F,uuid(403),[fRecord]),'service_role'));
await waitsOnLock('photo_account_fence_waiter'); await finish(admitted);
await waitUntil(()=>fence.exit!==undefined,'account fence after admitted write');
check(admitted.exit===0 && fence.exit===0,'account fence drains admitted pair edit');
check(metadata(F,[gRecord]).length===0,'deleting requester cannot read partner metadata');
check(metadata(G,[fRecord]).length===0,'source owner deletion marker hides pair');
check(metadata(G,[gRecord]).length===1,'unmarked partner retains own metadata');
denied(actor(F,begin({record:fRecord,op:uuid(404),user:F,couple:accountPair,base:3,photos:[]})),
  /account_deletion_pending/,'deleting owner cannot register');
denied(actor(G,begin({record:gRecord,op:uuid(405),user:G,couple:accountPair,base:2,photos:[]})),
  /account_deletion_pending/,'relationship participant fence protects partner write too');
denied(actor(F,upload(fRecord,uuid(9999),F,accountPair)),/account_deletion_pending/,'post-fence upload denied');
denied(`DELETE FROM auth.users WHERE id='${F}';`,/open_relationship_membership_delete_forbidden/,
  'cannot bypass account relationship-close gate');
check(run(`SELECT count(*) FROM public.record_photo_metadata WHERE owner_user_id='${F}';`)==='1',
  'failed early cascade leaves owner metadata');
// Drive the same database deletion phases as the Edge handler. Its physical
// media transport is represented only by local Storage catalog rows.
run(actor(null,`SELECT public.e2ee_prepare_account_deletion_v2('${F}','${uuid(403)}');
  SELECT public.prepare_account_deletion_v2('${F}',${arr([fRecord],'UUID')},'${uuid(403)}');`,'service_role'));
check(run(`SELECT count(*) FROM public.record_photo_metadata WHERE owner_user_id='${F}';`)==='0',
  'relational preparation cascades owner metadata');
denied(actor(null,`SELECT public.close_account_relationship_generations_v2('${F}','${uuid(403)}');`,'service_role'),
  /record_media_cleanup_pending/,'existing account gate waits for pair cleanup');
const prefixLease=uuid(leaseNumber++);
run(`UPDATE public.record_media_cleanup_jobs SET next_attempt_at=clock_timestamp()+interval '1 day'
  WHERE state='pending';
  UPDATE public.record_media_cleanup_jobs SET next_attempt_at=clock_timestamp() WHERE record_id='${fRecord}';`);
check(run(actor(null,`SELECT record_id FROM public.claim_record_media_cleanup_job('${prefixLease}',120);`,'service_role'))===fRecord,
  'existing prefix worker claims deleted account record');
run(actor(null,`DELETE FROM storage.objects WHERE bucket_id='couple-media'
  AND name LIKE '${accountPair}/${fRecord}/%';`,'service_role'));
check(run(actor(null,`SELECT public.complete_record_media_cleanup_job('${fRecord}','${prefixLease}');`,'service_role'))==='t',
  'account prefix cleanup settles after both exact deletions');
check(run(`SELECT count(*) FROM public.record_media_objects WHERE record_id='${fRecord}' AND state='deleted';`)==='2',
  'existing prefix completion settles both rendition ledger rows');
run(actor(null,`SELECT public.close_account_relationship_generations_v2('${F}','${uuid(403)}');
  SELECT public.cleanup_account_solo_couples_v2('${F}','${uuid(403)}');
  SELECT public.iap_prepare_account_deletion_v2('${F}','${uuid(403)}');`,'service_role'));
run(`DELETE FROM auth.users WHERE id='${F}';`);
check(run(`SELECT count(*) FROM public.profiles WHERE id='${F}';`)==='0','actual local Auth cascade removes owner');
check(run(`SELECT count(*) FROM public.record_photo_metadata WHERE owner_user_id='${G}';`)==='1',
  'account cascade preserves partner metadata row');
check(run(`SELECT count(*) FROM storage.objects WHERE name LIKE '${accountPair}/${gRecord}/%';`)==='2',
  'account deletion preserves partner physical pair');
check(metadata(G,[gRecord]).length===0,'closed generation feature-read restriction remains after cascade');

const fenceFirst=hold(null,deletion(H,uuid(410),[hRecord]),'photo_account_delete_first','service_role');
await waitUntil(()=>fenceFirst.stdout.includes('photo_account_delete_first'),'account fence held first');
const lateRegistration=session('photo_account_late_registration');
lateRegistration.child.stdin.end(actor(H,begin({record:hRecord,op:uuid(411),user:H,couple:secondPair,photos:[photoFor(310)]})));
await waitsOnLock('photo_account_late_registration'); await finish(fenceFirst);
await waitUntil(()=>lateRegistration.exit!==undefined,'late registration after account fence');
check(lateRegistration.exit!==0 && /account_deletion_pending/.test(lateRegistration.stderr),
  'account-delete-first rejects blocked photo registration');
check(run(`SELECT count(*) FROM public.record_photo_metadata WHERE record_id='${hRecord}';`)==='0',
  'fenced first registration leaves no metadata or pair');
check(run(actor(null,'SELECT public.record_media_cleanup_contract_version();','service_role'))==='4',
  'cleanup contract remains exactly 4 after all operations');
function hasSqlstate(user, sql, expected, label) {
  const out=result(actor(user,sql));
  // Ask PostgreSQL itself to classify the error rather than guessing from text.
  const checked=run(actor(user,`DO $state$ BEGIN
    ${sql.replace(/^SELECT /,'PERFORM ')}
    RAISE EXCEPTION 'expected SQLSTATE was not raised';
    EXCEPTION WHEN SQLSTATE '${expected}' THEN NULL;
    END $state$;`));
  check(out.status!==0 && checked==='',label);
}
hasSqlstate(A,'SELECT public.get_record_photo_metadata(NULL::UUID[]);','22023','NULL batch SQLSTATE exact');
hasSqlstate(A,begin({photos:[altered(p=>{p.screen_master.width_px=2049;})]}),'22023','descriptor SQLSTATE exact');
hasSqlstate(A,begin({photos:[altered(p=>{p.screen_master.byte_size++;})]}),'40001','replay conflict SQLSTATE exact');
hasSqlstate(B,begin({user:B}),'42501','foreign owner SQLSTATE exact');
// Typed UUID[] coercion occurs before any function executes (native 22P02).
hasSqlstate(A,"SELECT public.get_record_photo_metadata(ARRAY['bad-uuid']::UUID[]);",'22P02','native UUID coercion distinguished');
const formatRecord=uuid(56),formatPhoto=photoFor(330); seedRecord(formatRecord);
run(actor(A,begin({record:formatRecord,op:uuid(430),photos:[formatPhoto]})));
run(actor(A,upload(formatRecord,formatPhoto.screen_master.media_object_id).replace('.jpg','.png')+
  upload(formatRecord,formatPhoto.thumbnail.media_object_id)));
denied(actor(A,commit(formatRecord,uuid(430))),/photo_metadata_invalid/,'noncanonical JPEG path cannot publish metadata');
check(metadata(A,[formatRecord]).length===0,'rejected format remains unpublished');
run(actor(A,abandon(formatRecord,uuid(430))));

// Mutation controls run only inside this isolated cluster and roll back the
// changed function with its probe. They prove the real positive/negative
// assertions distinguish broken authorization and old-editor preservation.
function mutatedDefinition(signature, before, after) {
  const definition=run(`SELECT pg_get_functiondef('${signature}'::regprocedure);`);
  check(definition.split(before).length===2,'mutation anchor must match exactly once');
  return definition.replace(before,after);
}
const privateReadMutant=mutatedDefinition(
  'public.can_read_record_photo_metadata_090(uuid,uuid,uuid)',
  'AND (r.user_id=auth.uid() OR NOT r.is_private)',
  'AND true',
);
const leakedPrivateCount=run(`BEGIN; ${privateReadMutant};
  SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${B}';
  SELECT jsonb_array_length(public.get_record_photo_metadata(${arr([privateRecord],'UUID')}));
  ROLLBACK;`);
check(leakedPrivateCount==='1','removing privacy guard makes the private-partner denial test fail');
check(metadata(B,[privateRecord]).length===0,'rollback restores private-partner denial');

const expansionMutant=mutatedDefinition(
  'public.begin_record_photo_dispatch_090(uuid,uuid,uuid,uuid,bigint,bigint,text[],uuid[],jsonb)',
  'v_paths := array_append(v_paths,v_thumb_path);',
  'NULL;',
);
const retainedPrivate=begin({record:privateRecord,op:uuid(450),base:2,
  paths:[path(privateRecord,uuid(110))],ids:[]});
const expansionProbe=(definition='')=>JSON.parse(run(`BEGIN; ${definition};
  SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${A}';
  ${retainedPrivate} ROLLBACK;`));
check(expansionProbe(expansionMutant).desired_object_count===1,
  'removing expansion makes the old-editor two-object preservation test fail');
check(expansionProbe().desired_object_count===2,'rollback restores the linked thumbnail expansion');
console.log(`PASS — record photo renditions PostgreSQL full chain: ${files.length} migration files through 090, ${assertions} assertions.`);
console.log('LOCAL ONLY — client-reported measurements, no server image decode, hosted API, Storage transport or remote verification.');
