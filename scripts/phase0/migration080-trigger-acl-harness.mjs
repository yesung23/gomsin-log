#!/usr/bin/env node
/**
 * PostgreSQL trigger-ACL actor proof for migration 080.
 *
 * Runs the real migration in a throwaway local cluster and proves that API
 * roles lose direct EXECUTE access while the already-installed trigger keeps
 * working. No configured Supabase project is read or mutated.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const migration = join(root, 'supabase/migrations/080_revoke_private_record_trigger_execute.sql');
const keep = process.argv.includes('--keep');
const environment = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };
let assertions = 0;

function have(binary) {
  return spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
}

if (!existsSync(migration)) {
  console.error('BLOCKED — migration 080 is not present.');
  process.exit(2);
}
if (!['initdb', 'pg_ctl', 'psql'].every(have)) {
  console.error('BLOCKED — PostgreSQL actor harness requires initdb, pg_ctl, and psql on PATH.');
  console.error('UNVERIFIED — no migration 080 actor assertions were executed.');
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'gomsinlog-migration080-'));
const dataDirectory = join(scratch, 'pgdata');
const socketDirectory = join(scratch, 'sock');
execFileSync('mkdir', ['-p', socketDirectory], { env: environment });
let started = false;

function cleanup() {
  if (started) {
    spawnSync('pg_ctl', ['-D', dataDirectory, '-m', 'immediate', 'stop'], {
      env: environment,
      stdio: 'ignore',
    });
  }
  if (!keep) rmSync(scratch, { recursive: true, force: true });
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function psql(args) {
  return spawnSync(
    'psql',
    [
      '-h', socketDirectory,
      '-U', 'postgres',
      '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1',
      '-X',
      '-q',
      ...args,
    ],
    { encoding: 'utf8', env: environment },
  );
}

function expectOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label}: ${(result.stderr ?? '').trim()}`);
  }
  assertions += 1;
  return (result.stdout ?? '').trim();
}

function scalar(sql, label) {
  return expectOk(psql(['-At', '-c', sql]), label).split('\n')[0] ?? '';
}

function expectScalar(sql, expected, label) {
  const actual = scalar(sql, label);
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  assertions += 1;
}

function explicitExecuteGrantSql(role, signature) {
  return `
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc AS p
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))
      ) AS acl
      JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE p.oid = '${signature}'::regprocedure
        AND grantee.rolname = '${role}'
        AND acl.privilege_type = 'EXECUTE'
    )::text
  `;
}

function publicExecuteGrantSql(signature) {
  return `
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc AS p
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))
      ) AS acl
      WHERE p.oid = '${signature}'::regprocedure
        AND acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    )::text
  `;
}

try {
  expectOk(
    spawnSync(
      'initdb',
      ['-D', dataDirectory, '--no-locale', '-A', 'trust', '-U', 'postgres'],
      { encoding: 'utf8', env: environment, stdio: 'inherit' },
    ),
    'initdb',
  );
  expectOk(
    spawnSync(
      'pg_ctl',
      ['-D', dataDirectory, '-o', `-k ${socketDirectory} -h ''`, '-w', 'start'],
      { encoding: 'utf8', env: environment, stdio: 'inherit' },
    ),
    'pg_ctl start',
  );
  started = true;

  expectOk(psql(['-c', `
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;

    CREATE TABLE public.daily_records (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      visibility text NOT NULL DEFAULT 'shared',
      trigger_ran boolean NOT NULL DEFAULT false
    );

    CREATE FUNCTION public.clear_talk_about_marks_when_record_private()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $function$
    BEGIN
      IF NEW.visibility = 'private' THEN
        NEW.trigger_ran := true;
      END IF;
      RETURN NEW;
    END;
    $function$;

    REVOKE ALL ON FUNCTION public.clear_talk_about_marks_when_record_private()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.clear_talk_about_marks_when_record_private()
      TO anon, authenticated, service_role;

    CREATE SCHEMA unrelated_internal;
    CREATE FUNCTION unrelated_internal.preexisting_acl_function()
    RETURNS integer
    LANGUAGE sql
    AS 'SELECT 1';
    REVOKE ALL ON FUNCTION unrelated_internal.preexisting_acl_function()
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION unrelated_internal.preexisting_acl_function()
      TO authenticated, service_role;

    CREATE TRIGGER clear_talk_about_marks_when_record_private_trigger
    BEFORE UPDATE OF visibility ON public.daily_records
    FOR EACH ROW
    EXECUTE FUNCTION public.clear_talk_about_marks_when_record_private();

    INSERT INTO public.daily_records DEFAULT VALUES;
    GRANT SELECT, UPDATE ON public.daily_records TO authenticated;
  `]), 'install pre-080 trigger fixture');

  expectScalar(
    publicExecuteGrantSql('public.clear_talk_about_marks_when_record_private()'),
    'false',
    'target has no pre-080 PUBLIC execute grant',
  );
  for (const role of ['anon', 'authenticated', 'service_role']) {
    expectScalar(
      explicitExecuteGrantSql(role, 'public.clear_talk_about_marks_when_record_private()'),
      'true',
      `${role} has an explicit pre-080 execute grant`,
    );
    expectScalar(
      `SELECT has_function_privilege('${role}', 'public.clear_talk_about_marks_when_record_private()', 'EXECUTE')::text`,
      'true',
      `${role} can execute before migration 080`,
    );
  }
  for (const [role, expected] of [
    ['anon', 'false'],
    ['authenticated', 'true'],
    ['service_role', 'true'],
  ]) {
    expectScalar(
      `SELECT has_function_privilege('${role}', 'unrelated_internal.preexisting_acl_function()', 'EXECUTE')::text`,
      expected,
      `unrelated preexisting ACL starts ${role}=${expected}`,
    );
  }

  expectOk(psql(['-c', `
    REVOKE ALL ON FUNCTION public.clear_talk_about_marks_when_record_private()
      FROM PUBLIC;
  `]), 'apply PUBLIC-only mutation control');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    expectScalar(
      `SELECT has_function_privilege('${role}', 'public.clear_talk_about_marks_when_record_private()', 'EXECUTE')::text`,
      'true',
      `PUBLIC-only revoke leaves ${role} explicit execute in place`,
    );
  }

  expectOk(psql(['-f', migration]), 'apply migration 080');

  expectScalar(
    publicExecuteGrantSql('public.clear_talk_about_marks_when_record_private()'),
    'false',
    'target still has no PUBLIC execute grant after migration 080',
  );
  for (const role of ['anon', 'authenticated', 'service_role']) {
    expectScalar(
      explicitExecuteGrantSql(role, 'public.clear_talk_about_marks_when_record_private()'),
      'false',
      `${role} explicit execute grant is removed by migration 080`,
    );
    expectScalar(
      `SELECT has_function_privilege('${role}', 'public.clear_talk_about_marks_when_record_private()', 'EXECUTE')::text`,
      'false',
      `${role} cannot execute the trigger function after migration 080`,
    );
  }
  expectScalar(
    "SELECT has_function_privilege('postgres', 'public.clear_talk_about_marks_when_record_private()', 'EXECUTE')::text",
    'true',
    'function owner retains execute',
  );
  for (const [role, expected] of [
    ['anon', 'false'],
    ['authenticated', 'true'],
    ['service_role', 'true'],
  ]) {
    expectScalar(
      `SELECT has_function_privilege('${role}', 'unrelated_internal.preexisting_acl_function()', 'EXECUTE')::text`,
      expected,
      `migration 080 preserves unrelated preexisting ACL for ${role}`,
    );
  }

  expectOk(psql(['-c', `
    CREATE FUNCTION unrelated_internal.future_unrelated_function()
    RETURNS integer
    LANGUAGE sql
    AS 'SELECT 1';

    CREATE FUNCTION public.future_authenticated_rpc()
    RETURNS integer
    LANGUAGE sql
    AS 'SELECT 2';
    REVOKE ALL ON FUNCTION public.future_authenticated_rpc()
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.future_authenticated_rpc() TO authenticated;
  `]), 'create post-080 blast-radius fixtures');

  for (const role of ['anon', 'authenticated', 'service_role']) {
    expectScalar(
      `SELECT has_function_privilege('${role}', 'unrelated_internal.future_unrelated_function()', 'EXECUTE')::text`,
      'true',
      `migration 080 does not alter ${role} defaults outside its exact target`,
    );
  }
  expectScalar(
    "SELECT has_function_privilege('authenticated', 'public.future_authenticated_rpc()', 'EXECUTE')::text",
    'true',
    'an exact authenticated RPC grant still works',
  );
  expectScalar(
    "SELECT has_function_privilege('anon', 'public.future_authenticated_rpc()', 'EXECUTE')::text",
    'false',
    'the exact RPC grant does not leak to anon',
  );
  expectScalar(
    "SELECT has_function_privilege('service_role', 'public.future_authenticated_rpc()', 'EXECUTE')::text",
    'false',
    'the exact RPC grant does not leak to service_role',
  );

  expectOk(psql([
    '-c', 'SET ROLE authenticated',
    '-c', "UPDATE public.daily_records SET visibility = 'private' WHERE id = 1",
  ]), 'existing trigger still runs for authenticated table updates');
  expectScalar(
    'SELECT trigger_ran::text FROM public.daily_records WHERE id = 1',
    'true',
    'revoking direct execute does not disable the existing trigger',
  );
  expectScalar(
    "SELECT count(*)::text FROM pg_proc WHERE proname = '_migration_080_default_acl_probe'",
    '0',
    'migration probe is removed',
  );

  console.log(`PASS — migration 080 PostgreSQL actor proof (${assertions} assertions).`);
  console.log('PRODUCTION: NOT APPLIED. Remote Supabase: UNVERIFIED.');
} catch (error) {
  console.error(`FAIL — ${error instanceof Error ? error.message : String(error)}`);
  console.error('PRODUCTION: NOT APPLIED. Remote Supabase: UNVERIFIED.');
  process.exitCode = 1;
}
