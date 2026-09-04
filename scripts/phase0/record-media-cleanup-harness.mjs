#!/usr/bin/env node

/**
 * PostgreSQL actor/race harness for migration 083.
 *
 * This runs the migration against a minimal current-schema fixture and proves
 * behavior with real roles, RLS, triggers, transactions, table locks and
 * concurrent backends. It intentionally does not emulate hosted Storage HTTP;
 * that remains a separate staging canary.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_028 = join(ROOT, 'supabase/migrations/028_restore_couple_media_authorization.sql');
const MIGRATION_083 = join(ROOT, 'supabase/migrations/083_record_media_cleanup_jobs.sql');
const DB = 'record_media_cleanup_harness';
// PostgreSQL's Unix socket path is capped at roughly 100 bytes. macOS tmpdir()
// is already deeply nested, so keep this harness-owned path deliberately short.
const scratchRoot = mkdtempSync('/tmp/gsl-rmc-');
const dataDir = join(scratchRoot, 'data');
const socketDir = join(scratchRoot, 'socket');
mkdirSync(socketDir);

const PG_ENV = {
  ...process.env,
  LC_ALL: 'C',
  LANG: 'C',
  PGHOST: socketDir,
  PGUSER: 'postgres',
  PGDATABASE: DB,
};

const IDS = {
  owner: '10000000-0000-4000-8000-000000000001',
  partner: '10000000-0000-4000-8000-000000000002',
  unrelated: '10000000-0000-4000-8000-000000000003',
  former: '10000000-0000-4000-8000-000000000004',
  cascadeUser: '10000000-0000-4000-8000-000000000005',
  coupleCascadeUser: '10000000-0000-4000-8000-000000000006',
  accountUser: '10000000-0000-4000-8000-000000000007',
  couple: '20000000-0000-4000-8000-000000000001',
  cascadeCouple: '20000000-0000-4000-8000-000000000002',
  coupleCascade: '20000000-0000-4000-8000-000000000003',
  accountCouple: '20000000-0000-4000-8000-000000000004',
  ownerRecord: '30000000-0000-4000-8000-000000000001',
  partnerTarget: '30000000-0000-4000-8000-000000000002',
  raceRecord: '30000000-0000-4000-8000-000000000003',
  retryRecord: '30000000-0000-4000-8000-000000000004',
  cascadeRecord: '30000000-0000-4000-8000-000000000005',
  coupleCascadeRecord: '30000000-0000-4000-8000-000000000006',
  accountRecord: '30000000-0000-4000-8000-000000000007',
  siblingRecord: '30000000-0000-4000-8000-000000000008',
  attempt: '40000000-0000-4000-8000-000000000001',
};

let serverStarted = false;
let checks = 0;

function have(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

function cleanup() {
  if (serverStarted) {
    spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], {
      stdio: 'ignore',
      env: PG_ENV,
    });
  }
  if (scratchRoot.startsWith('/tmp/gsl-rmc-')) {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

function psql(args, options = {}) {
  return spawnSync(
    'psql',
    ['-h', socketDir, '-U', 'postgres', '-d', DB, '-X', '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8', env: PG_ENV, ...options },
  );
}

function sql(text) {
  return psql(['-qAt', '-c', text]);
}

function q(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function actorSql(role, userId, text) {
  const claims = userId
    ? `SELECT set_config('request.jwt.claim.sub', ${q(userId)}, true);`
    : "SELECT set_config('request.jwt.claim.sub', '', true);";
  return `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.role', ${q(role)}, true); ${claims} ${text}; COMMIT;`;
}

function asActor(role, userId, text) {
  return sql(actorSql(role, userId, text));
}

function expectOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }
  checks += 1;
  return result.stdout.trim();
}

function expectFail(result, label, pattern) {
  if (result.status === 0) throw new Error(`${label} unexpectedly succeeded`);
  const output = `${result.stderr}\n${result.stdout}`;
  if (pattern && !pattern.test(output)) {
    throw new Error(`${label} failed for the wrong reason:\n${output}`);
  }
  checks += 1;
  return output;
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
  checks += 1;
}

function startSession(role, userId) {
  const child = spawn(
    'psql',
    ['-h', socketDir, '-U', 'postgres', '-d', DB, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { env: PG_ENV, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.role', ${q(role)}, true);`);
  child.stdin.write(userId
    ? `SELECT set_config('request.jwt.claim.sub', ${q(userId)}, true);`
    : "SELECT set_config('request.jwt.claim.sub', '', true);");
  return {
    child,
    write: (text) => child.stdin.write(`${text}\n`),
    output: () => ({ stdout, stderr }),
    close: () => child.stdin.end(),
  };
}

async function waitFor(session, needle, timeoutMs = 5_000) {
  const started = Date.now();
  while (!session.output().stdout.includes(needle)) {
    if (session.output().stderr) throw new Error(session.output().stderr);
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${needle}; output=${JSON.stringify(session.output())}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

if (!['initdb', 'pg_ctl', 'createdb', 'psql'].every(have)) {
  console.error('POSTGRES UNAVAILABLE: initdb/pg_ctl/createdb/psql are required.');
  process.exit(2);
}

execFileSync('initdb', ['-D', dataDir, '-U', 'postgres', '--no-sync', '-A', 'trust'], {
  stdio: 'ignore',
  env: PG_ENV,
});
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h ''`, '-w', 'start'], {
  stdio: 'ignore',
  env: PG_ENV,
});
serverStarted = true;
execFileSync('createdb', ['-h', socketDir, '-U', 'postgres', DB], { stdio: 'ignore', env: PG_ENV });

const fixture = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;

CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
$$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;

CREATE TABLE auth.users (id UUID PRIMARY KEY);
CREATE TABLE public.couples (id UUID PRIMARY KEY, closed_at TIMESTAMPTZ);
CREATE TABLE public.couple_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.account_deletion_requests (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL,
  phase TEXT NOT NULL,
  cancellation_allowed BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE public.daily_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  is_private BOOLEAN NOT NULL DEFAULT false,
  attachments JSONB NOT NULL DEFAULT '[]'::JSONB
);
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_records TO authenticated;
CREATE POLICY daily_record_owner ON public.daily_records
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.push_delivery_state (
  user_id UUID PRIMARY KEY,
  has_unseen BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE public.couple_highlights (id UUID PRIMARY KEY, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.couple_highlight_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id UUID NOT NULL REFERENCES public.couple_highlights(id) ON DELETE CASCADE,
  record_id UUID NOT NULL REFERENCES public.daily_records(id) ON DELETE CASCADE
);
CREATE TABLE public.trigger_audit (position BIGSERIAL PRIMARY KEY, event TEXT NOT NULL);

CREATE FUNCTION public.get_my_active_couple_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT member.couple_id
  FROM public.couple_members AS member
  JOIN public.couples AS relationship ON relationship.id = member.couple_id
  WHERE member.user_id = auth.uid()
    AND member.status = 'active'
    AND relationship.closed_at IS NULL
  ORDER BY member.couple_id
  LIMIT 1
$$;
CREATE FUNCTION public.is_my_account_deletion_pending() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_deletion_requests WHERE user_id = auth.uid()
  )
$$;
CREATE FUNCTION public.assert_account_write_open(UUID[], BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_requests deletion
    WHERE deletion.user_id = ANY($1)
       OR ($2 AND EXISTS (
         SELECT 1
         FROM public.couple_members subject
         JOIN public.couple_members peer ON peer.couple_id = subject.couple_id
         WHERE subject.user_id = ANY($1)
           AND subject.status IN ('active', 'pending')
           AND peer.status IN ('active', 'pending')
           AND peer.user_id = deletion.user_id
       ))
  ) THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
  END IF;
END
$$;
CREATE FUNCTION public.account_write_scope_has_pending(UUID[], BOOLEAN) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_deletion_requests WHERE user_id = ANY($1)
  )
$$;
CREATE FUNCTION public.has_account_write_capability() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT false $$;

CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
CREATE FUNCTION storage.foldername(TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN array_length(string_to_array($1, '/'), 1) <= 1 THEN ARRAY[]::TEXT[]
    ELSE (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1) - 1]
  END
$$;

CREATE FUNCTION public.fixture_account_write_statement() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN NULL;
END
$$;
CREATE FUNCTION public.fixture_storage_write_row() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() = 'service_role' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER aaa_076_account_write_statement
  BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH STATEMENT EXECUTE FUNCTION public.fixture_account_write_statement();
CREATE TRIGGER aaa_076_account_write_row
  BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.fixture_storage_write_row();

CREATE FUNCTION public.fixture_daily_gate() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.trigger_audit(event) VALUES ('aaa_076');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER aaa_076_account_write_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.fixture_daily_gate();

CREATE FUNCTION public.prune_highlight_items_for_record() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.trigger_audit(event) VALUES ('highlight');
  DELETE FROM public.couple_highlight_items WHERE record_id = OLD.id;
  RETURN OLD;
END
$$;
CREATE TRIGGER prune_highlight_items_on_record
  BEFORE DELETE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.prune_highlight_items_for_record();

CREATE FUNCTION public.lower_partner_unseen_on_removal() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.trigger_audit(event) VALUES ('unseen');
  IF OLD.is_private IS FALSE AND NOT EXISTS (
    SELECT 1 FROM public.daily_records
    WHERE couple_id = OLD.couple_id AND user_id = OLD.user_id AND is_private IS FALSE
  ) THEN
    UPDATE public.push_delivery_state
    SET has_unseen = false
    WHERE user_id IN (
      SELECT user_id FROM public.couple_members
      WHERE couple_id = OLD.couple_id AND user_id <> OLD.user_id AND status = 'active'
    );
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER trg_daily_records_partner_unseen_removed
  AFTER DELETE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.lower_partner_unseen_on_removal();

CREATE FUNCTION public.open_account_deletion_write_capability(UUID, UUID, TEXT[]) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended($1::TEXT, 15013));
  PERFORM 1
  FROM public.account_deletion_requests
  WHERE user_id = $1 AND attempt_id = $2 AND phase = ANY($3)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.couples
  WHERE id IN (SELECT couple_id FROM public.couple_members WHERE user_id = $1)
  ORDER BY id
  FOR UPDATE;
  RETURN gen_random_uuid();
END
$$;
CREATE FUNCTION public.close_account_write_capability(UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT true $$;

CREATE FUNCTION public.close_account_relationship_generations_v2(UUID, UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_capability_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  v_capability_id := public.open_account_deletion_write_capability(
    $1,
    $2,
    ARRAY['relational_prepared', 'relationships_closed']::TEXT[]
  );
  UPDATE public.couples SET closed_at = now()
  WHERE id IN (SELECT couple_id FROM public.couple_members WHERE user_id = $1);
  UPDATE public.account_deletion_requests SET phase = 'relationships_closed' WHERE user_id = $1;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN jsonb_build_object('ok', true, 'phase', 'relationships_closed', 'closed_count', 1);
END
$$;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID) TO service_role;
`;

expectOk(psql(['-q', '-c', fixture]), 'create PostgreSQL fixture');
expectOk(psql(['-q', '-f', MIGRATION_028]), 'apply migration 028');
expectOk(psql(['-q', '-f', MIGRATION_083]), 'apply migration 083');
expectOk(psql(['-q', '-c', `
CREATE FUNCTION public.fixture_log_cleanup_job() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.trigger_audit(event) VALUES ('083_job');
  RETURN NEW;
END
$$;
CREATE TRIGGER fixture_log_cleanup_job
  AFTER INSERT ON public.record_media_cleanup_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fixture_log_cleanup_job();
`]), 'install cleanup trigger audit probe');

const insertFixtures = `
INSERT INTO auth.users(id) VALUES
  ('${IDS.owner}'), ('${IDS.partner}'), ('${IDS.unrelated}'), ('${IDS.former}'),
  ('${IDS.cascadeUser}'), ('${IDS.coupleCascadeUser}'), ('${IDS.accountUser}');
INSERT INTO public.couples(id) VALUES
  ('${IDS.couple}'), ('${IDS.cascadeCouple}'), ('${IDS.coupleCascade}'), ('${IDS.accountCouple}');
INSERT INTO public.couple_members(couple_id, user_id, status) VALUES
  ('${IDS.couple}', '${IDS.owner}', 'active'),
  ('${IDS.couple}', '${IDS.partner}', 'active'),
  ('${IDS.couple}', '${IDS.former}', 'disconnected'),
  ('${IDS.cascadeCouple}', '${IDS.cascadeUser}', 'active'),
  ('${IDS.coupleCascade}', '${IDS.coupleCascadeUser}', 'active'),
  ('${IDS.accountCouple}', '${IDS.accountUser}', 'active');
INSERT INTO public.daily_records(id, user_id, couple_id, is_private) VALUES
  ('${IDS.ownerRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.partnerTarget}', '${IDS.owner}', '${IDS.couple}', true),
  ('${IDS.cascadeRecord}', '${IDS.cascadeUser}', '${IDS.cascadeCouple}', false),
  ('${IDS.coupleCascadeRecord}', '${IDS.coupleCascadeUser}', '${IDS.coupleCascade}', false),
  ('${IDS.accountRecord}', '${IDS.accountUser}', '${IDS.accountCouple}', false),
  ('${IDS.siblingRecord}', '${IDS.partner}', '${IDS.couple}', false);
INSERT INTO public.push_delivery_state(user_id, has_unseen) VALUES ('${IDS.partner}', true);
INSERT INTO public.couple_highlights(id) VALUES ('50000000-0000-4000-8000-000000000001');
INSERT INTO public.couple_highlight_items(highlight_id, record_id)
VALUES ('50000000-0000-4000-8000-000000000001', '${IDS.ownerRecord}');
TRUNCATE public.trigger_audit;
`;
expectOk(psql(['-q', '-c', insertFixtures]), 'insert actor fixtures');

expectEqual(
  expectOk(sql("SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.record_media_cleanup_jobs'::regclass"), 'read job RLS'),
  'true',
  'cleanup jobs must have RLS enabled',
);
expectEqual(
  expectOk(sql("SELECT count(*)::text FROM pg_constraint WHERE conrelid = 'public.record_media_cleanup_jobs'::regclass AND contype = 'f'"), 'read job foreign keys'),
  '0',
  'cleanup tombstones must have no destructive foreign keys',
);
expectEqual(
  expectOk(sql("SELECT concat_ws('|', has_table_privilege('anon', 'public.record_media_cleanup_jobs', 'SELECT'), has_table_privilege('authenticated', 'public.record_media_cleanup_jobs', 'SELECT'), has_table_privilege('service_role', 'public.record_media_cleanup_jobs', 'SELECT'))"), 'read cleanup table grants'),
  'f|f|f',
  'no API role may read cleanup rows directly',
);

for (const [role, actor, label] of [
  ['authenticated', IDS.partner, 'active partner'],
  ['authenticated', IDS.unrelated, 'unrelated user'],
  ['authenticated', IDS.former, 'former partner'],
  ['authenticated', null, 'authenticated without uid'],
]) {
  const value = expectOk(
    asActor(role, actor, `SELECT public.delete_my_record('${IDS.partnerTarget}', '${actor ?? IDS.owner}', '${IDS.couple}')::text`),
    `${label} owner RPC`,
  );
  expectEqual(value.split('\n').at(-1), 'false', `${label} must receive non-disclosing false`);
}
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `SELECT public.delete_my_record('99999999-0000-4000-8000-000000000001', '${IDS.owner}', '${IDS.couple}')::text`), 'missing record RPC').split('\n').at(-1),
  'false',
  'missing record must match unauthorized false',
);
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `SELECT public.delete_my_record('${IDS.partnerTarget}', '${IDS.owner}', '${IDS.cascadeCouple}')::text`), 'wrong couple RPC').split('\n').at(-1),
  'false',
  'wrong couple must be non-disclosing',
);
expectFail(
  asActor('anon', null, `SELECT public.delete_my_record('${IDS.partnerTarget}', '${IDS.owner}', '${IDS.couple}')`),
  'anonymous owner RPC',
  /permission denied/i,
);
expectFail(
  asActor('service_role', null, `SELECT public.delete_my_record('${IDS.partnerTarget}', '${IDS.owner}', '${IDS.couple}')`),
  'service role owner RPC',
  /permission denied/i,
);

expectOk(sql(`INSERT INTO public.account_deletion_requests(user_id, attempt_id, phase) VALUES ('${IDS.partner}', '${IDS.attempt}', 'media_cleanup')`), 'install partner account fence');
expectFail(
  asActor('authenticated', IDS.owner, `SELECT public.delete_my_record('${IDS.partnerTarget}', '${IDS.owner}', '${IDS.couple}')`),
  'owner RPC while partner deletion is pending',
  /account_deletion_pending/i,
);
expectOk(sql(`DELETE FROM public.account_deletion_requests WHERE user_id = '${IDS.partner}'`), 'remove partner account fence');

expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `SELECT public.delete_my_record('${IDS.ownerRecord}', '${IDS.owner}', '${IDS.couple}')::text`), 'owner atomic delete').split('\n').at(-1),
  'true',
  'owner RPC must delete its exact active record',
);
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `SELECT public.delete_my_record('${IDS.ownerRecord}', '${IDS.owner}', '${IDS.couple}')::text`), 'owner idempotent retry').split('\n').at(-1),
  'false',
  'retry must return the same non-disclosing false as missing',
);
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.ownerRecord}'`), 'count owner tombstones'),
  '1',
  'one immutable tombstone must represent one record',
);
expectEqual(
  expectOk(sql("SELECT string_agg(event, ',' ORDER BY position) FROM public.trigger_audit"), 'read trigger order'),
  'aaa_076,083_job,highlight,unseen',
  'write gate, cleanup queue, highlight prune and unseen lowering must retain order',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', (SELECT count(*) FROM public.couple_highlight_items WHERE record_id = '${IDS.ownerRecord}'), (SELECT has_unseen FROM public.push_delivery_state WHERE user_id = '${IDS.partner}'))`), 'read highlight/unseen effects'),
  '0|f',
  'highlight and unseen behavior must still execute',
);
expectFail(
  sql(`UPDATE public.record_media_cleanup_jobs SET couple_id = '${IDS.cascadeCouple}' WHERE record_id = '${IDS.ownerRecord}'`),
  'mutate immutable cleanup identity',
  /record_media_cleanup_identity_immutable/i,
);

expectOk(sql(`DELETE FROM auth.users WHERE id = '${IDS.cascadeUser}'`), 'delete auth user with record cascade');
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.cascadeRecord}' AND owner_user_id = '${IDS.cascadeUser}'`), 'read auth cascade tombstone'),
  '1',
  'auth cascade must leave an owner tombstone after the user row disappears',
);
expectOk(sql(`DELETE FROM public.couples WHERE id = '${IDS.coupleCascade}'`), 'delete couple with record cascade');
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.coupleCascadeRecord}' AND couple_id = '${IDS.coupleCascade}'`), 'read couple cascade tombstone'),
  '1',
  'couple cascade must leave a tombstone after the parent disappears',
);

expectOk(sql(`INSERT INTO storage.objects(bucket_id, name) VALUES ('couple-media', '${IDS.couple}/${IDS.partnerTarget}/legacy.jpg')`), 'insert old-client object');
expectFail(
  asActor('authenticated', IDS.owner, `DELETE FROM storage.objects WHERE name = '${IDS.couple}/${IDS.partnerTarget}/legacy.jpg'`),
  'old client direct Storage DELETE',
  /permission denied/i,
);
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM storage.objects WHERE name = '${IDS.couple}/${IDS.partnerTarget}/legacy.jpg'`), 'confirm old-client object survived'),
  '1',
  'revoked authenticated DELETE must preserve the blob',
);

expectOk(sql(`UPDATE public.record_media_cleanup_jobs SET state = 'completed', completed_at = now(), updated_at = now() WHERE state <> 'completed'`), 'retire earlier jobs');
expectOk(sql(`INSERT INTO public.daily_records(id, user_id, couple_id) VALUES ('${IDS.raceRecord}', '${IDS.owner}', '${IDS.couple}')`), 'insert race record');

const uploader = startSession('authenticated', IDS.owner);
uploader.write(`INSERT INTO storage.objects(bucket_id, name) VALUES ('couple-media', '${IDS.couple}/${IDS.raceRecord}/inflight.jpg'); SELECT 'UPLOAD_READY';`);
await waitFor(uploader, 'UPLOAD_READY');

const deleter = startSession('authenticated', IDS.owner);
deleter.write(`SELECT public.delete_my_record('${IDS.raceRecord}', '${IDS.owner}', '${IDS.couple}')::text || '|DELETE_DONE'; COMMIT;`);
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
if (deleter.output().stdout.includes('DELETE_DONE')) {
  throw new Error('record deletion did not wait for the in-flight Storage writer');
}
checks += 1;
uploader.write('COMMIT;');
uploader.close();
await waitFor(deleter, 'DELETE_DONE');
deleter.close();
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', (SELECT count(*) FROM public.daily_records WHERE id = '${IDS.raceRecord}'), (SELECT count(*) FROM storage.objects WHERE name = '${IDS.couple}/${IDS.raceRecord}/inflight.jpg'), (SELECT count(*) FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.raceRecord}'))`), 'read upload/delete race outcome'),
  '0|1|1',
  'delete must commit only after the upload and retain a cleanup job for it',
);

expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${IDS.couple}/${IDS.raceRecord}/inflight.jpg'`),
  'BYPASSRLS service delete without lease',
  /record_media_cleanup_lease_required/i,
);
const leaseOne = '60000000-0000-4000-8000-000000000001';
expectEqual(
  expectOk(asActor('service_role', null, `SELECT record_id::text FROM public.claim_record_media_cleanup_job('${leaseOne}', 120)`), 'claim cleanup job').split('\n').at(-1),
  IDS.raceRecord,
  'claim must return exactly one pending job',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT count(*)::text FROM public.claim_record_media_cleanup_job('60000000-0000-4000-8000-000000000002', 120)`), 'overlapping claim').split('\n').at(-1),
  '0',
  'an active lease must not be claimed twice',
);
expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${IDS.couple}/${IDS.partnerTarget}/legacy.jpg'`),
  'leased worker sibling-prefix delete',
  /record_media_cleanup_lease_required/i,
);
expectOk(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${IDS.couple}/${IDS.raceRecord}/inflight.jpg'`),
  'leased worker exact-prefix delete',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job('${IDS.raceRecord}', '${leaseOne}')::text`), 'complete cleanup job').split('\n').at(-1),
  'true',
  'leased job must complete',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job('${IDS.raceRecord}', '${leaseOne}')::text`), 'replay complete response').split('\n').at(-1),
  'true',
  'completion response loss retry must be idempotent',
);

expectOk(sql(`INSERT INTO public.daily_records(id, user_id, couple_id) VALUES ('${IDS.retryRecord}', '${IDS.owner}', '${IDS.couple}'); DELETE FROM public.daily_records WHERE id = '${IDS.retryRecord}'`), 'create retry job');
for (let attempt = 1; attempt <= 8; attempt += 1) {
  const lease = `61000000-0000-4000-8000-${String(attempt).padStart(12, '0')}`;
  expectEqual(
    expectOk(asActor('service_role', null, `SELECT record_id::text FROM public.claim_record_media_cleanup_job('${lease}', 120)`), `claim retry ${attempt}`).split('\n').at(-1),
    IDS.retryRecord,
    `retry ${attempt} must claim the same job`,
  );
  const state = expectOk(
    asActor('service_role', null, `SELECT public.fail_record_media_cleanup_job('${IDS.retryRecord}', '${lease}', 'E_STORAGE_TRANSIENT')`),
    `fail retry ${attempt}`,
  ).split('\n').at(-1);
  expectEqual(state, attempt === 8 ? 'blocked' : 'pending', `failure ${attempt} state`);
  expectEqual(
    expectOk(asActor('service_role', null, `SELECT public.fail_record_media_cleanup_job('${IDS.retryRecord}', '${lease}', 'E_STORAGE_TRANSIENT')`), `replay failure ${attempt}`).split('\n').at(-1),
    state,
    `failure response loss ${attempt} must not double count`,
  );
  expectOk(sql(`UPDATE public.record_media_cleanup_jobs SET next_attempt_at = now() WHERE record_id = '${IDS.retryRecord}'`), `rewind retry ${attempt}`);
}
expectEqual(
  expectOk(sql(`SELECT failure_count::text || '|' || state FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.retryRecord}'`), 'read blocked retry job'),
  '8|blocked',
  'bounded retries must end in blocked state',
);

expectOk(sql(`INSERT INTO public.daily_records(id, user_id, couple_id) VALUES ('${IDS.accountRecord}', '${IDS.accountUser}', '${IDS.accountCouple}') ON CONFLICT DO NOTHING; DELETE FROM public.daily_records WHERE id = '${IDS.accountRecord}'; INSERT INTO public.account_deletion_requests(user_id, attempt_id, phase) VALUES ('${IDS.accountUser}', '${IDS.attempt}', 'relational_prepared')`), 'create account deletion barrier fixture');
expectFail(
  asActor('service_role', null, `SELECT public.close_account_relationship_generations_v2('${IDS.accountUser}', '${IDS.attempt}')`),
  'relationship close with pending cleanup',
  /record_media_cleanup_pending/i,
);
expectEqual(
  expectOk(sql(`SELECT (closed_at IS NULL)::text FROM public.couples WHERE id = '${IDS.accountCouple}'`), 'read relationship after pending barrier'),
  'true',
  'pending cleanup must keep relationship generation open',
);
expectOk(sql(`UPDATE public.record_media_cleanup_jobs SET state = 'completed', completed_at = now(), updated_at = now() WHERE record_id = '${IDS.accountRecord}'`), 'complete account cleanup fixture');
const advisoryBlocker = startSession('service_role', null);
advisoryBlocker.write(`SELECT pg_advisory_xact_lock(hashtextextended('${IDS.accountUser}'::TEXT, 15013)); SELECT 'ADVISORY_HELD';`);
await waitFor(advisoryBlocker, 'ADVISORY_HELD');
const relationshipCloser = startSession('service_role', null);
relationshipCloser.write(`SELECT public.close_account_relationship_generations_v2('${IDS.accountUser}', '${IDS.attempt}'); COMMIT; SELECT 'CLOSE_DONE';`);
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
if (relationshipCloser.output().stdout.includes('CLOSE_DONE')) {
  throw new Error('relationship close did not wait at the account advisory boundary');
}
checks += 1;
expectOk(
  sql(`BEGIN; SELECT 1 FROM public.account_deletion_requests WHERE user_id = '${IDS.accountUser}' FOR UPDATE NOWAIT; ROLLBACK`),
  'relationship close must acquire advisory before deletion marker',
);
advisoryBlocker.write('ROLLBACK;');
advisoryBlocker.close();
await waitFor(relationshipCloser, 'CLOSE_DONE');
relationshipCloser.close();
expectEqual(
  expectOk(sql(`SELECT (closed_at IS NOT NULL)::text FROM public.couples WHERE id = '${IDS.accountCouple}'`), 'read relationship after completed barrier'),
  'true',
  'completed cleanup permits relationship closure',
);

console.log(`PASS — record/media cleanup PostgreSQL actor/race harness: ${checks} assertions`);
