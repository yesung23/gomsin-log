#!/usr/bin/env node

/**
 * Bounded fresh-chain compatibility gate for record/media lifecycle migration
 * 086. Unlike the focused actor/race harness, this applies every active SQL
 * migration from 001 through 086, in canonical filename order, to one fresh
 * PostgreSQL cluster before exercising the final record-media contract.
 *
 * Hosted Supabase Storage HTTP is intentionally out of scope. The storage
 * catalog helpers mirror Supabase's foldername/filename behavior and the
 * focused harness separately drives the actor and concurrency matrix.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const migrationFiles = readdirSync(MIGRATIONS)
  .filter((file) => /^\d{3}_.+[.]sql$/.test(file))
  .filter((file) => Number(file.slice(0, 3)) <= 86)
  .sort((left, right) => left.localeCompare(right, 'en'));

const expectedLastMigration = '086_reconcile_record_media_cleanup.sql';
if (migrationFiles.at(-1) !== expectedLastMigration) {
  console.error(`MISSING VERIFICATION: canonical chain does not end at ${expectedLastMigration}.`);
  process.exit(2);
}

for (const binary of ['initdb', 'pg_ctl', 'createdb', 'psql']) {
  if (spawnSync(binary, ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error(`POSTGRES UNAVAILABLE: ${binary} is required.`);
    console.error('This is a MISSING VERIFICATION, not a pass.');
    process.exit(2);
  }
}

const scratchRoot = mkdtempSync(join(tmpdir(), 'gsl-rmc-chain-'));
const dataDir = join(scratchRoot, 'data');
const socketDir = join(scratchRoot, 'socket');
const scratchSql = join(scratchRoot, 'input.sql');
execFileSync('mkdir', ['-p', socketDir]);

const DB = 'record_media_real_chain';
const PG_ENV = {
  ...process.env,
  LC_ALL: 'C',
  LANG: 'C',
  LC_MESSAGES: 'C',
  PGHOST: socketDir,
  PGUSER: 'postgres',
  PGDATABASE: DB,
};
let serverStarted = false;

function cleanup() {
  if (serverStarted) {
    spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], {
      env: PG_ENV,
      stdio: 'ignore',
    });
  }
  if (scratchRoot.includes('gsl-rmc-chain-')) rmSync(scratchRoot, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

function psqlScript(text) {
  writeFileSync(scratchSql, text);
  return spawnSync(
    'psql',
    ['-h', socketDir, '-U', 'postgres', '-d', DB, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', scratchSql],
    { env: PG_ENV, encoding: 'utf8' },
  );
}

function mustRun(text, label) {
  const result = psqlScript(text);
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

execFileSync('initdb', ['-D', dataDir, '-U', 'postgres', '--no-sync', '-A', 'trust'], {
  env: PG_ENV,
  stdio: 'ignore',
});
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h ''`, '-w', 'start'], {
  env: PG_ENV,
  stdio: 'ignore',
});
serverStarted = true;
execFileSync('createdb', ['-h', socketDir, '-U', 'postgres', DB], { env: PG_ENV, stdio: 'ignore' });

mustRun(`
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $stub$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$stub$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $fn$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
  $fn$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $fn$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT NOT NULL UNIQUE,
  owner UUID,
  owner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
  $fn$ SELECT CASE
    WHEN array_length(string_to_array(name, '/'), 1) <= 1 THEN ARRAY[]::TEXT[]
    ELSE (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  END $fn$;
CREATE FUNCTION storage.filename(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
  $fn$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $fn$;
CREATE PUBLICATION supabase_realtime;
`, 'create Supabase catalog stub');

const preRecursionDrops = `
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;
DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;
`;

for (const file of migrationFiles) {
  if (file === '002_fix_rls_recursion.sql') {
    mustRun(preRecursionDrops, 'prepare historical duplicate 002 fresh-chain state');
  }
  mustRun(readFileSync(join(MIGRATIONS, file), 'utf8'), `apply ${file}`);
}

const USER_A = '84000000-0000-4000-8000-000000000001';
const USER_B = '84000000-0000-4000-8000-000000000002';
const COUPLE = '84000000-0000-4000-8000-000000000003';
const RECORD = '84000000-0000-4000-8000-000000000004';
const OPERATION = '84000000-0000-4000-8000-000000000005';

mustRun(`
INSERT INTO auth.users(id, email) VALUES
  ('${USER_A}', 'chain-a@example.test'),
  ('${USER_B}', 'chain-b@example.test');
INSERT INTO public.profiles(id, display_name, role) VALUES
  ('${USER_A}', 'Chain A', 'gomsin'),
  ('${USER_B}', 'Chain B', 'soldier');
INSERT INTO public.couples(id) VALUES ('${COUPLE}');
INSERT INTO public.couple_members(couple_id, user_id, role, status) VALUES
  ('${COUPLE}', '${USER_A}', 'gomsin', 'active'),
  ('${COUPLE}', '${USER_B}', 'soldier', 'active');
INSERT INTO public.daily_records(id, user_id, couple_id, record_date, log_text, is_private)
VALUES ('${RECORD}', '${USER_A}', '${COUPLE}', CURRENT_DATE, 'legacy chain fixture', false);
`, 'seed 001..086 compatibility actor');

const serviceVersion = mustRun(`
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT public.record_media_cleanup_contract_version()::text;
COMMIT;
`, 'probe 086 contract as service role').split('\n').at(-1);
expectEqual(serviceVersion, '3', '001..086 service contract version');

const beginState = mustRun(`
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '${USER_A}', true);
SELECT public.begin_record_media_mutation(
  '${OPERATION}', '${RECORD}', '${USER_A}', '${COUPLE}', 1, 2,
  ARRAY[]::TEXT[], ARRAY[]::UUID[]
) ->> 'state';
COMMIT;
`, 'begin 086 mutation on the real chain').split('\n').at(-1);
expectEqual(beginState, 'pending', '001..086 owner begin');

const committedShape = mustRun(`
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '${USER_A}', true);
UPDATE public.daily_records
SET log_text = 'ordinary v1 edit', last_media_operation_id = '${OPERATION}'
WHERE id = '${RECORD}'
RETURNING content_revision::text || '|' || media_contract_version::text || '|' || media_manifest_revision::text;
COMMIT;
`, 'commit 086 mutation after actual E2EE revision trigger').split('\n').at(-1);
expectEqual(committedShape, '2|1|2', '001..086 E2EE-before-media trigger compatibility');

const catalogShape = mustRun(`
SELECT concat_ws('|',
  (to_regclass('public.record_media_mutations') IS NOT NULL)::text,
  (to_regclass('public.record_media_objects') IS NOT NULL)::text,
  (to_regprocedure('public.record_media_cleanup_contract_version()') IS NOT NULL)::text,
  (to_regprocedure('public.enforce_daily_record_identity_immutable()') IS NOT NULL)::text,
  (EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.daily_records'::regclass
      AND tgname = 'aab_085_daily_record_identity_immutable'
      AND NOT tgisinternal
  ))::text,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'daily_records'
     AND column_name IN ('media_contract_version', 'media_manifest_revision', 'last_media_operation_id'))::text
);
`, 'read final 086 catalog shape');
expectEqual(catalogShape, 'true|true|true|true|true|3', '001..086 final catalog shape');

const identityRewrite = psqlScript(`
UPDATE public.daily_records
SET id = '84000000-0000-4000-8000-000000000099'
WHERE id = '${RECORD}';
`);
if (
  identityRewrite.status === 0 ||
  !/daily_record_identity_immutable/i.test(`${identityRewrite.stderr}\n${identityRewrite.stdout}`)
) {
  throw new Error(
    `001..086 identity gate failed for the wrong reason:\n${identityRewrite.stderr || identityRewrite.stdout}`,
  );
}

const oldWriter = psqlScript(`
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '${USER_A}', true);
UPDATE public.daily_records SET log_text = 'stale old client' WHERE id = '${RECORD}';
COMMIT;
`);
if (oldWriter.status === 0 || !/media_operation_required/i.test(`${oldWriter.stderr}\n${oldWriter.stdout}`)) {
  throw new Error(`001..086 old-writer gate failed for the wrong reason:\n${oldWriter.stderr || oldWriter.stdout}`);
}

console.log(
  `PASS — record/media real migration-chain compatibility: ${migrationFiles.length} migrations (001..086), 6 assertions`,
);
