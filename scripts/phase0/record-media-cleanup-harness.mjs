#!/usr/bin/env node

/**
 * PostgreSQL actor/race harness for migrations 083 through 088.
 *
 * This runs the migration against a minimal current-schema fixture and proves
 * behavior with real roles, RLS, triggers, transactions, record-scoped
 * advisory locks and concurrent backends. It intentionally does not emulate
 * hosted Storage HTTP; that remains a separate staging canary.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_028 = join(ROOT, 'supabase/migrations/028_restore_couple_media_authorization.sql');
const MIGRATION_083 = join(ROOT, 'supabase/migrations/083_record_media_cleanup_jobs.sql');
const MIGRATION_084 = join(ROOT, 'supabase/migrations/084_record_media_object_lifecycle.sql');
const MIGRATION_085 = join(ROOT, 'supabase/migrations/085_harden_record_media_cleanup.sql');
const MIGRATION_086 = join(ROOT, 'supabase/migrations/086_reconcile_record_media_cleanup.sql');
const MIGRATION_088 = join(ROOT, 'supabase/migrations/088_block_live_record_prefix_cleanup.sql');
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
  lifecycleAccountUser: '10000000-0000-4000-8000-000000000008',
  fenceUser: '10000000-0000-4000-8000-000000000009',
  couple: '20000000-0000-4000-8000-000000000001',
  cascadeCouple: '20000000-0000-4000-8000-000000000002',
  coupleCascade: '20000000-0000-4000-8000-000000000003',
  accountCouple: '20000000-0000-4000-8000-000000000004',
  lifecycleAccountCouple: '20000000-0000-4000-8000-000000000005',
  fenceCouple: '20000000-0000-4000-8000-000000000006',
  foreignFenceCouple: '20000000-0000-4000-8000-000000000007',
  ownerRecord: '30000000-0000-4000-8000-000000000001',
  partnerTarget: '30000000-0000-4000-8000-000000000002',
  raceRecord: '30000000-0000-4000-8000-000000000003',
  retryRecord: '30000000-0000-4000-8000-000000000004',
  cascadeRecord: '30000000-0000-4000-8000-000000000005',
  coupleCascadeRecord: '30000000-0000-4000-8000-000000000006',
  accountRecord: '30000000-0000-4000-8000-000000000007',
  siblingRecord: '30000000-0000-4000-8000-000000000008',
  lifecycleRecord: '30000000-0000-4000-8000-000000000009',
  leasedDeleteRecord: '30000000-0000-4000-8000-000000000010',
  beginRaceRecord: '30000000-0000-4000-8000-000000000011',
  abandonRaceRecord: '30000000-0000-4000-8000-000000000012',
  expiryRaceRecord: '30000000-0000-4000-8000-000000000013',
  commitRaceRecord: '30000000-0000-4000-8000-000000000014',
  deleteFirstRecord: '30000000-0000-4000-8000-000000000015',
  lifecycleAccountRecord: '30000000-0000-4000-8000-000000000016',
  scopeHoldRecord: '30000000-0000-4000-8000-000000000017',
  scopeOtherRecord: '30000000-0000-4000-8000-000000000018',
  identityV0Record: '30000000-0000-4000-8000-000000000019',
  identityV0Replacement: '30000000-0000-4000-8000-000000000020',
  identityV1Record: '30000000-0000-4000-8000-000000000021',
  identityV1Replacement: '30000000-0000-4000-8000-000000000022',
  fenceRecord: '30000000-0000-4000-8000-000000000023',
  foreignFenceRecord: '30000000-0000-4000-8000-000000000024',
  attempt: '40000000-0000-4000-8000-000000000001',
  fenceAttempt: '40000000-0000-4000-8000-000000000002',
};

const RECONCILE = {
  owner: '86000000-0000-4000-8000-000000000001',
  couple: '86000000-0000-4000-8000-000000000002',
  completedRecord: '86000000-0000-4000-8000-000000000003',
  completedMedia: '86000000-0000-4000-8000-000000000004',
  completedLease: '86000000-0000-4000-8000-000000000005',
  ledgerRecord: '86000000-0000-4000-8000-000000000006',
  ledgerOperation: '86000000-0000-4000-8000-000000000007',
  ledgerMedia: '86000000-0000-4000-8000-000000000008',
  orphanRecord: '86000000-0000-4000-8000-000000000009',
  orphanMedia: '86000000-0000-4000-8000-000000000010',
  liveRecord: '86000000-0000-4000-8000-000000000011',
  liveMedia: '86000000-0000-4000-8000-000000000012',
  existingJobRecord: '86000000-0000-4000-8000-000000000013',
  existingJobOperation: '86000000-0000-4000-8000-000000000014',
  photoOwner: '86000000-0000-4000-8000-000000000015',
  photoCouple: '86000000-0000-4000-8000-000000000016',
  photoRecord: '86000000-0000-4000-8000-000000000017',
  photoAttempt: '86000000-0000-4000-8000-000000000018',
  photoLease: '86000000-0000-4000-8000-000000000019',
  prefixLease: '86000000-0000-4000-8000-000000000020',
  staleOrphanRecord: '86000000-0000-4000-8000-000000000021',
  staleOrphanOperation: '86000000-0000-4000-8000-000000000022',
  staleOrphanLease: '86000000-0000-4000-8000-000000000023',
  staleLiveRecord: '86000000-0000-4000-8000-000000000024',
  staleLiveOperation: '86000000-0000-4000-8000-000000000025',
  staleLiveMedia: '86000000-0000-4000-8000-000000000026',
};

const PREFLIGHT = {
  owner: '86100000-0000-4000-8000-000000000001',
  unrelated: '86100000-0000-4000-8000-000000000002',
  couple: '86100000-0000-4000-8000-000000000003',
  otherCouple: '86100000-0000-4000-8000-000000000004',
  record: '86100000-0000-4000-8000-000000000005',
  otherRecord: '86100000-0000-4000-8000-000000000006',
};

const LIVE_PREFIX_FENCE = {
  pendingRecord: '86200000-0000-4000-8000-000000000001',
  expiredRecord: '86200000-0000-4000-8000-000000000002',
  normalRecord: '86200000-0000-4000-8000-000000000003',
  completionRecord: '86200000-0000-4000-8000-000000000004',
  pendingLease: '86200000-0000-4000-8000-000000000005',
  expiredLease: '86200000-0000-4000-8000-000000000006',
  normalLease: '86200000-0000-4000-8000-000000000007',
  completionLease: '86200000-0000-4000-8000-000000000008',
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

function typedArray(values, type) {
  if (values.length === 0) return `ARRAY[]::${type}[]`;
  return `ARRAY[${values.map(q).join(',')}]::${type}[]`;
}

function beginMutationSql({ operationId, recordId, userId, coupleId, baseRevision, paths = [], mediaIds = [] }) {
  return `SELECT public.begin_record_media_mutation(${q(operationId)}::UUID, ${q(recordId)}::UUID, ${q(userId)}::UUID, ${q(coupleId)}::UUID, ${baseRevision}, ${baseRevision + 1}, ${typedArray(paths, 'TEXT')}, ${typedArray(mediaIds, 'UUID')}) ->> 'state'`;
}

function mutationStatusSql(operationId, recordId, userId, coupleId) {
  return `SELECT public.record_media_mutation_status(${q(operationId)}::UUID, ${q(recordId)}::UUID, ${q(userId)}::UUID, ${q(coupleId)}::UUID) ->> 'state'`;
}

function abandonMutationSql(operationId, recordId, userId, coupleId) {
  return `SELECT public.abandon_record_media_mutation(${q(operationId)}::UUID, ${q(recordId)}::UUID, ${q(userId)}::UUID, ${q(coupleId)}::UUID) ->> 'state'`;
}

function replaceCleanupContractVersionSql(version) {
  return `CREATE OR REPLACE FUNCTION public.record_media_cleanup_contract_version()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  RETURN ${version};
END;
$$;`;
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

async function waitForExit(session, timeoutMs = 5_000) {
  if (session.child.exitCode !== null) return session.output();
  await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error('timed out waiting for PostgreSQL session exit')), timeoutMs);
    session.child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
  return session.output();
}

async function expectSessionBlocked(session, completionNeedle, label) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const output = session.output();
  if (output.stderr || output.stdout.includes(completionNeedle) || session.child.exitCode !== null) {
    throw new Error(`${label} did not wait at the record advisory boundary: ${JSON.stringify(output)}`);
  }
  checks += 1;
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
  attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
  content_revision BIGINT NOT NULL DEFAULT 1
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
  )
$$;
CREATE FUNCTION public.has_account_write_capability() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(current_setting('app.fixture_account_write_capability', true), '') = 'open'
$$;

CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  owner UUID,
  owner_id TEXT
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
CREATE FUNCTION storage.foldername(TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN array_length(string_to_array($1, '/'), 1) <= 1 THEN ARRAY[]::TEXT[]
    ELSE (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1) - 1]
  END
$$;
CREATE FUNCTION storage.filename(TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array($1, '/'))[array_length(string_to_array($1, '/'), 1)]
$$;

-- Hosted Storage writes the authenticated owner's current owner_id claim.
-- Direct SQL fixtures emulate that service behavior for lifecycle tests.
CREATE FUNCTION public.fixture_storage_owner_id() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL THEN
    NEW.owner_id := coalesce(NEW.owner_id, auth.uid()::TEXT);
    NEW.owner := coalesce(NEW.owner, auth.uid());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER aaa_fixture_storage_owner_id
  BEFORE INSERT ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.fixture_storage_owner_id();

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
expectOk(psql(['-q', '-f', MIGRATION_084]), 'apply migration 084');
expectOk(psql(['-q', '-f', MIGRATION_085]), 'apply migration 085');

for (const version of [20, 21]) {
  expectOk(sql(replaceCleanupContractVersionSql(version)), `install false v${version} predecessor`);
  expectFail(
    psql(['-q', '-f', MIGRATION_086]),
    `reject false v${version} predecessor`,
    /migration_086_contract_predecessor_mismatch/i,
  );
  expectEqual(
    expectOk(
      asActor('service_role', null, 'SELECT public.record_media_cleanup_contract_version()::text'),
      `read rolled-back v${version} predecessor`,
    ).split('\n').at(-1),
    String(version),
    `086 rejection must leave the v${version} predecessor untouched`,
  );
}
expectOk(sql(replaceCleanupContractVersionSql(2)), 'restore exact v2 predecessor');

const ledgerIdentityCases = [
  {
    label: 'wrong bucket',
    bucket: 'other-media',
    path: `${PREFLIGHT.couple}/${PREFLIGHT.record}/photo.jpg`,
    ownerId: PREFLIGHT.owner,
  },
  {
    label: 'wrong couple path',
    bucket: 'couple-media',
    path: `${PREFLIGHT.otherCouple}/${PREFLIGHT.record}/photo.jpg`,
    ownerId: PREFLIGHT.owner,
  },
  {
    label: 'wrong record path',
    bucket: 'couple-media',
    path: `${PREFLIGHT.couple}/${PREFLIGHT.otherRecord}/photo.jpg`,
    ownerId: PREFLIGHT.owner,
  },
  {
    label: 'wrong current owner_id',
    bucket: 'couple-media',
    path: `${PREFLIGHT.couple}/${PREFLIGHT.record}/photo.jpg`,
    ownerId: PREFLIGHT.unrelated,
  },
];
for (const [index, identityCase] of ledgerIdentityCases.entries()) {
  const suffix = String(index + 1).padStart(12, '0');
  const mediaObjectId = `86110000-0000-4000-8000-${suffix}`;
  const storageObjectId = `86120000-0000-4000-8000-${suffix}`;
  expectOk(sql(`
    INSERT INTO storage.objects(id, bucket_id, name, owner_id)
    VALUES ('${storageObjectId}', '${identityCase.bucket}', '${identityCase.path}', '${identityCase.ownerId}');
    INSERT INTO public.record_media_objects(
      media_object_id, storage_object_id, record_id, couple_id, owner_user_id, state
    ) VALUES (
      '${mediaObjectId}', '${storageObjectId}', '${PREFLIGHT.record}',
      '${PREFLIGHT.couple}', '${PREFLIGHT.owner}', 'active'
    );
  `), `seed ledger-bound ${identityCase.label}`);
  const output = expectFail(
    psql(['-q', '-f', MIGRATION_086]),
    `reject ledger-bound ${identityCase.label}`,
    /record_media_cleanup_identity_ambiguous/i,
  );
  if (output.includes(identityCase.path) || output.includes(identityCase.ownerId)) {
    throw new Error(`ledger-bound ${identityCase.label} failure exposed Storage identity`);
  }
  checks += 1;
  expectEqual(
    expectOk(sql(`SELECT concat_ws('|',
      (SELECT count(*) FROM public.record_media_objects WHERE media_object_id = '${mediaObjectId}'),
      (SELECT count(*) FROM storage.objects WHERE id = '${storageObjectId}'))`),
    `read atomic ${identityCase.label} rejection`),
    '1|1',
    `086 ${identityCase.label} rejection must preserve both ledger and Storage rows`,
  );
  expectOk(sql(`
    DELETE FROM public.record_media_objects WHERE media_object_id = '${mediaObjectId}';
    DELETE FROM storage.objects WHERE id = '${storageObjectId}';
  `), `retire ledger-bound ${identityCase.label}`);
}

const reconcilePhotoPath = `${RECONCILE.photoCouple}/${RECONCILE.photoRecord}/photo.jpg`;
const reconcileCompletedPath = `${RECONCILE.couple}/${RECONCILE.completedRecord}/${RECONCILE.completedMedia}.jpg`;
expectOk(psql(['-q', '-c', `
INSERT INTO auth.users(id) VALUES ('${RECONCILE.owner}'), ('${RECONCILE.photoOwner}');
INSERT INTO public.couples(id) VALUES ('${RECONCILE.couple}'), ('${RECONCILE.photoCouple}');
INSERT INTO public.couple_members(couple_id, user_id, status)
VALUES ('${RECONCILE.couple}', '${RECONCILE.owner}', 'active');
INSERT INTO public.daily_records(id, user_id, couple_id, is_private)
VALUES ('${RECONCILE.liveRecord}', '${RECONCILE.owner}', '${RECONCILE.couple}', false);
INSERT INTO public.account_deletion_requests(user_id, attempt_id, phase)
VALUES ('${RECONCILE.photoOwner}', '${RECONCILE.photoAttempt}', 'relational_prepared');

INSERT INTO public.record_media_cleanup_jobs(
  record_id, couple_id, owner_user_id, state, lease_id, completed_at
) VALUES
  (
    '${RECONCILE.completedRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
    'completed', '${RECONCILE.completedLease}', clock_timestamp()
  ),
  (
    '${RECONCILE.existingJobRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
    'pending', NULL, NULL
  );
INSERT INTO storage.objects(bucket_id, name, owner_id) VALUES
  ('couple-media', '${reconcileCompletedPath}', '${RECONCILE.owner}'),
  ('couple-media', '${RECONCILE.couple}/${RECONCILE.orphanRecord}/${RECONCILE.orphanMedia}.jpg', '${RECONCILE.owner}'),
  ('couple-media', '${RECONCILE.couple}/${RECONCILE.liveRecord}/${RECONCILE.liveMedia}.jpg', '${RECONCILE.owner}'),
  ('couple-media', '${reconcilePhotoPath}', '${RECONCILE.photoOwner}');

INSERT INTO public.record_media_mutations(
  operation_id, record_id, couple_id, owner_user_id, base_content_revision,
  target_content_revision, desired_object_count, upload_reservation_count
) VALUES
  (
    '${RECONCILE.ledgerOperation}', '${RECONCILE.ledgerRecord}',
    '${RECONCILE.couple}', '${RECONCILE.owner}', 1, 2, 1, 0
  ),
  (
    '${RECONCILE.existingJobOperation}', '${RECONCILE.existingJobRecord}',
    '${RECONCILE.couple}', '${RECONCILE.owner}', 1, 2, 0, 0
  );
WITH object AS (
  INSERT INTO storage.objects(bucket_id, name, owner_id)
  VALUES (
    'couple-media',
    '${RECONCILE.couple}/${RECONCILE.ledgerRecord}/${RECONCILE.ledgerMedia}.jpg',
    '${RECONCILE.owner}'
  )
  RETURNING id
)
INSERT INTO public.record_media_objects(
  media_object_id, storage_object_id, record_id, couple_id, owner_user_id, state
)
SELECT '${RECONCILE.ledgerMedia}', object.id, '${RECONCILE.ledgerRecord}',
       '${RECONCILE.couple}', '${RECONCILE.owner}', 'active'
FROM object;
`]), 'seed migration 086 reconciliation fixtures');

expectOk(psql(['-q', '-f', MIGRATION_086]), 'apply migration 086');
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT state FROM public.record_media_cleanup_jobs
      WHERE record_id = '${RECONCILE.completedRecord}'),
    (SELECT state FROM public.record_media_cleanup_jobs
      WHERE record_id = '${RECONCILE.ledgerRecord}'),
    (SELECT state FROM public.record_media_mutations
      WHERE operation_id = '${RECONCILE.ledgerOperation}'),
    (SELECT state FROM public.record_media_mutations
      WHERE operation_id = '${RECONCILE.existingJobOperation}'),
    (SELECT state FROM public.record_media_objects
      WHERE media_object_id = '${RECONCILE.ledgerMedia}'),
    (SELECT state FROM public.record_media_objects
      WHERE media_object_id = '${RECONCILE.orphanMedia}'),
    (SELECT count(*) FROM public.record_media_objects AS media
      JOIN storage.objects AS object ON object.id = media.storage_object_id
      WHERE object.name = '${reconcilePhotoPath}' AND media.state = 'cleanup_pending'),
    (SELECT count(*) FROM public.record_media_objects
      WHERE media_object_id = '${RECONCILE.liveMedia}'))`), 'read migration 086 reconciliation'),
  'pending|pending|abandoned|abandoned|superseded|cleanup_pending|1|0',
  '086 must reopen residue, retire recordless pending work, recover jobless work, adopt exact orphans and preserve live v0 media',
);
expectEqual(
  expectOk(sql(`SELECT count(*)::text
    FROM public.record_media_objects AS media
    JOIN storage.objects AS object ON object.id = media.storage_object_id
    WHERE media.media_object_id = '${RECONCILE.orphanMedia}'
      AND media.record_id = '${RECONCILE.orphanRecord}'
      AND media.couple_id = '${RECONCILE.couple}'
      AND media.owner_user_id = '${RECONCILE.owner}'
      AND object.owner_id = '${RECONCILE.owner}'`), 'verify exact orphan attribution'),
  '1',
  '086 must bind an orphan only to its exact Storage id and current owner_id',
);

const [photoMediaObjectId, photoStorageObjectId] = expectOk(
  sql(`SELECT concat_ws('|', media.media_object_id, object.id)
    FROM public.record_media_objects AS media
    JOIN storage.objects AS object ON object.id = media.storage_object_id
    WHERE object.name = '${reconcilePhotoPath}'`),
  'read generated photo.jpg cleanup identity',
).split('|');
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    public.record_media_uuid_from_name(storage.filename(object.name)) IS NULL,
    media.media_object_id IS NOT NULL,
    media.record_id = '${RECONCILE.photoRecord}',
    media.couple_id = '${RECONCILE.photoCouple}',
    media.owner_user_id = '${RECONCILE.photoOwner}',
    media.storage_object_id = object.id)
  FROM public.record_media_objects AS media
  JOIN storage.objects AS object ON object.id = media.storage_object_id
  WHERE object.id = '${photoStorageObjectId}'`), 'verify generated photo.jpg ledger'),
  't|t|t|t|t|t',
  '086 must assign a new ledger UUID while preserving exact Storage UUID and routing identity',
);
expectFail(
  asActor('service_role', null, `SELECT public.assert_account_record_media_cleanup_complete(
    '${RECONCILE.photoOwner}', '${RECONCILE.photoAttempt}')`),
  'photo.jpg account fence before exact cleanup',
  /record_media_cleanup_pending/i,
);
expectOk(sql(`
UPDATE public.record_media_objects
SET next_attempt_at = clock_timestamp() + interval '1 day'
WHERE state = 'cleanup_pending';
UPDATE public.record_media_objects
SET next_attempt_at = clock_timestamp()
WHERE media_object_id = '${photoMediaObjectId}';
`), 'prioritize photo.jpg exact cleanup');
expectEqual(
  expectOk(asActor('service_role', null, `SELECT media_object_id::text
    FROM public.claim_record_media_object_cleanup_job('${RECONCILE.photoLease}', 120)`),
  'claim photo.jpg exact cleanup').split('\n').at(-1),
  photoMediaObjectId,
  'photo.jpg must be claimable only by its generated immutable ledger UUID',
);
expectOk(sql(`UPDATE storage.objects SET owner_id = '${RECONCILE.owner}'
  WHERE id = '${photoStorageObjectId}'`), 'corrupt exact object current owner_id');
const exactResolveMismatch = expectFail(
  asActor('service_role', null, `SELECT storage_path
    FROM public.resolve_record_media_object_cleanup_path(
      '${photoMediaObjectId}', '${photoStorageObjectId}', '${RECONCILE.photoLease}')`),
  'resolve exact object after current owner_id mismatch',
  /record_media_cleanup_identity_ambiguous/i,
);
if (exactResolveMismatch.includes(reconcilePhotoPath) || exactResolveMismatch.includes(RECONCILE.owner)) {
  throw new Error('exact resolver identity failure exposed Storage identity');
}
checks += 1;
const exactDeleteMismatch = expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE id = '${photoStorageObjectId}'`),
  'delete exact object after current owner_id mismatch',
  /record_media_cleanup_identity_ambiguous/i,
);
if (exactDeleteMismatch.includes(reconcilePhotoPath) || exactDeleteMismatch.includes(RECONCILE.owner)) {
  throw new Error('exact delete identity failure exposed Storage identity');
}
checks += 1;
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM storage.objects WHERE id = '${photoStorageObjectId}'`),
  'read exact object after wrong-owner delete'),
  '1',
  'wrong-owner exact object must survive cleanup DELETE',
);
expectOk(sql(`UPDATE storage.objects SET owner_id = '${RECONCILE.photoOwner}'
  WHERE id = '${photoStorageObjectId}'`), 'restore exact object current owner_id');
expectEqual(
  expectOk(asActor('service_role', null, `SELECT storage_path
    FROM public.resolve_record_media_object_cleanup_path(
      '${photoMediaObjectId}', '${photoStorageObjectId}', '${RECONCILE.photoLease}')`),
  'resolve restored photo.jpg exact path').split('\n').at(-1),
  reconcilePhotoPath,
  'exact resolver must return only the matching current-owner Storage path',
);
expectOk(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE id = '${photoStorageObjectId}'`),
  'delete restored photo.jpg exact object',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.settle_record_media_object_cleanup_job(
    '${photoMediaObjectId}', '${photoStorageObjectId}', '${RECONCILE.photoLease}')::text`),
  'settle photo.jpg exact cleanup').split('\n').at(-1),
  'true',
  'photo.jpg exact cleanup must settle by immutable Storage UUID',
);
expectOk(
  asActor('service_role', null, `SELECT public.assert_account_record_media_cleanup_complete(
    '${RECONCILE.photoOwner}', '${RECONCILE.photoAttempt}')`),
  'close photo.jpg account deletion fence after exact cleanup',
);

expectOk(sql(`
UPDATE public.record_media_cleanup_jobs
SET next_attempt_at = clock_timestamp() + interval '1 day'
WHERE state = 'pending';
UPDATE public.record_media_cleanup_jobs
SET next_attempt_at = clock_timestamp()
WHERE record_id = '${RECONCILE.completedRecord}';
`), 'prioritize reconciled prefix cleanup');
expectEqual(
  expectOk(asActor('service_role', null, `SELECT record_id::text
    FROM public.claim_record_media_cleanup_job('${RECONCILE.prefixLease}', 120)`),
  'claim reconciled prefix cleanup').split('\n').at(-1),
  RECONCILE.completedRecord,
  'reopened completed prefix must be claimable with a fresh lease',
);
expectOk(sql(`UPDATE storage.objects SET owner_id = '${RECONCILE.photoOwner}'
  WHERE name = '${reconcileCompletedPath}'`), 'corrupt prefix object current owner_id');
const prefixDeleteMismatch = expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${reconcileCompletedPath}'`),
  'delete prefix object after current owner_id mismatch',
  /record_media_cleanup_identity_ambiguous/i,
);
if (prefixDeleteMismatch.includes(reconcileCompletedPath) || prefixDeleteMismatch.includes(RECONCILE.photoOwner)) {
  throw new Error('prefix delete identity failure exposed Storage identity');
}
checks += 1;
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM storage.objects WHERE name = '${reconcileCompletedPath}'`),
  'read prefix object after wrong-owner delete'),
  '1',
  'wrong-owner prefix object must survive cleanup DELETE',
);
expectOk(sql(`UPDATE storage.objects SET owner_id = '${RECONCILE.owner}'
  WHERE name = '${reconcileCompletedPath}'`), 'restore prefix object current owner_id');
expectOk(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${reconcileCompletedPath}'`),
  'delete restored prefix object',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job(
    '${RECONCILE.completedRecord}', '${RECONCILE.prefixLease}')::text`),
  'settle restored prefix cleanup').split('\n').at(-1),
  'true',
  'restored-owner prefix cleanup must settle normally',
);

const staleOrphanPath = `${RECONCILE.couple}/${RECONCILE.staleOrphanRecord}/legacy.jpg`;
expectOk(sql(`
INSERT INTO public.daily_records(id, user_id, couple_id, is_private)
VALUES ('${RECONCILE.staleLiveRecord}', '${RECONCILE.owner}', '${RECONCILE.couple}', false);
INSERT INTO public.record_media_cleanup_jobs(
  record_id, couple_id, owner_user_id, state, lease_id, completed_at
) VALUES (
  '${RECONCILE.staleOrphanRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
  'completed', '${RECONCILE.staleOrphanLease}', clock_timestamp()
);
INSERT INTO storage.objects(bucket_id, name, owner_id)
VALUES ('couple-media', '${staleOrphanPath}', '${RECONCILE.owner}');
INSERT INTO public.record_media_mutations(
  operation_id, record_id, couple_id, owner_user_id, base_content_revision,
  target_content_revision, desired_object_count, upload_reservation_count,
  created_at, updated_at
) VALUES
  (
    '${RECONCILE.staleOrphanOperation}', '${RECONCILE.staleOrphanRecord}',
    '${RECONCILE.couple}', '${RECONCILE.owner}', 1, 2, 0, 0,
    clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '30 minutes'
  ),
  (
    '${RECONCILE.staleLiveOperation}', '${RECONCILE.staleLiveRecord}',
    '${RECONCILE.couple}', '${RECONCILE.owner}', 1, 2, 1, 1,
    clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '20 minutes'
  );
INSERT INTO public.record_media_objects(
  media_object_id, record_id, couple_id, owner_user_id,
  reservation_operation_id, state, created_at, updated_at
) VALUES (
  '${RECONCILE.staleLiveMedia}', '${RECONCILE.staleLiveRecord}',
  '${RECONCILE.couple}', '${RECONCILE.owner}',
  '${RECONCILE.staleLiveOperation}', 'reserved',
  clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '20 minutes'
);
`), 'seed oldest-recordless then live stale mutation');
expectEqual(
  expectOk(asActor('service_role', null,
    'SELECT public.expire_stale_record_media_mutation()::text'),
  'expire recordless and later live stale mutations').split('\n').at(-1),
  'true',
  'recordless stale work must not hide later live stale mutation expiry',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT state FROM public.record_media_mutations
      WHERE operation_id = '${RECONCILE.staleOrphanOperation}'),
    (SELECT state FROM public.record_media_mutations
      WHERE operation_id = '${RECONCILE.staleLiveOperation}'),
    (SELECT state FROM public.record_media_objects
      WHERE media_object_id = '${RECONCILE.staleLiveMedia}'),
    (SELECT state FROM public.record_media_cleanup_jobs
      WHERE record_id = '${RECONCILE.staleOrphanRecord}'),
    (SELECT count(*) FROM storage.objects WHERE name = '${staleOrphanPath}'))`),
  'read recordless/live stale expiry outcome'),
  'abandoned|abandoned|deleted|completed|1',
  'recordless mutation must become terminal despite completed job and physical remainder while later live work advances',
);
expectOk(sql(`
DELETE FROM storage.objects WHERE name = '${staleOrphanPath}';
DELETE FROM public.record_media_objects WHERE media_object_id = '${RECONCILE.staleLiveMedia}';
DELETE FROM public.record_media_mutations
WHERE operation_id IN ('${RECONCILE.staleOrphanOperation}', '${RECONCILE.staleLiveOperation}');
DELETE FROM public.record_media_cleanup_jobs WHERE record_id = '${RECONCILE.staleOrphanRecord}';
DELETE FROM public.daily_records WHERE id = '${RECONCILE.staleLiveRecord}';
`), 'retire recordless/live stale expiry fixtures');
expectOk(sql(`
DELETE FROM storage.objects WHERE owner_id = '${RECONCILE.owner}';
UPDATE public.record_media_objects
SET state = 'deleted', deleted_at = coalesce(deleted_at, clock_timestamp())
WHERE owner_user_id = '${RECONCILE.owner}' AND state <> 'deleted';
UPDATE public.record_media_cleanup_jobs
SET state = 'completed', completed_at = coalesce(completed_at, clock_timestamp())
WHERE owner_user_id = '${RECONCILE.owner}' AND state <> 'completed';
`), 'retire migration 086 reconciliation fixtures');

// 088 must refuse the exact legacy shape that exposed a live prefix to broad
// cleanup. The failed migration is atomic and its content-free error must not
// disclose a record, couple, owner or Storage path.
expectOk(sql(`INSERT INTO public.record_media_cleanup_jobs(
  record_id, couple_id, owner_user_id, state, lease_id, completed_at
) VALUES (
  '${RECONCILE.liveRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
  'completed', '${LIVE_PREFIX_FENCE.completionLease}', clock_timestamp()
)`), 'seed same-identity live record cleanup conflict');
const migration088Conflict = expectFail(
  psql(['-q', '-f', MIGRATION_088]),
  'reject migration 088 live-record prefix conflict',
  /migration_088_live_record_cleanup_conflict/i,
);
for (const secretValue of [
  RECONCILE.liveRecord,
  RECONCILE.couple,
  RECONCILE.owner,
  `${RECONCILE.couple}/${RECONCILE.liveRecord}`,
]) {
  if (migration088Conflict.includes(secretValue)) {
    throw new Error('migration 088 conflict disclosed cleanup identity');
  }
}
checks += 1;
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT count(*) FROM public.daily_records WHERE id = '${RECONCILE.liveRecord}'),
    (SELECT state FROM public.record_media_cleanup_jobs WHERE record_id = '${RECONCILE.liveRecord}'),
    (SELECT count(*) FROM storage.objects
      WHERE name LIKE '${RECONCILE.couple}/${RECONCILE.liveRecord}/%'))`),
  'read atomic migration 088 rejection'),
  '1|completed|0',
  '088 rejection must preserve the live record and cleanup job without deleting Storage',
);
expectOk(sql(`DELETE FROM public.record_media_cleanup_jobs
  WHERE record_id = '${RECONCILE.liveRecord}'`), 'remove migration 088 conflict');
expectOk(psql(['-q', '-f', MIGRATION_088]), 'apply migration 088 after conflict removal');

// The queue must skip both pending and expired-leased poison rows, then claim
// the oldest normal recordless namespace in the same invocation.
expectOk(sql(`
INSERT INTO public.daily_records(id, user_id, couple_id, is_private) VALUES
  ('${LIVE_PREFIX_FENCE.pendingRecord}', '${RECONCILE.owner}', '${RECONCILE.couple}', false),
  ('${LIVE_PREFIX_FENCE.expiredRecord}', '${RECONCILE.owner}', '${RECONCILE.couple}', false);
INSERT INTO public.record_media_cleanup_jobs(
  record_id, couple_id, owner_user_id, state, lease_id, lease_expires_at,
  next_attempt_at, created_at, updated_at
) VALUES
  (
    '${LIVE_PREFIX_FENCE.pendingRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
    'pending', NULL, NULL, clock_timestamp() - interval '3 hours',
    clock_timestamp() - interval '3 hours', clock_timestamp() - interval '3 hours'
  ),
  (
    '${LIVE_PREFIX_FENCE.expiredRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
    'leased', '${LIVE_PREFIX_FENCE.expiredLease}', clock_timestamp() - interval '1 minute',
    clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '2 hours'
  ),
  (
    '${LIVE_PREFIX_FENCE.normalRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
    'pending', NULL, NULL, clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 hour'
  );
`), 'seed live poison and normal prefix jobs');
expectEqual(
  expectOk(asActor('service_role', null, `SELECT record_id::text
    FROM public.claim_record_media_cleanup_job('${LIVE_PREFIX_FENCE.normalLease}', 120)`),
  'claim while earlier live poison jobs exist').split('\n').at(-1),
  LIVE_PREFIX_FENCE.normalRecord,
  'claim must skip every live pending or expired-leased prefix job',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT state FROM public.record_media_cleanup_jobs
      WHERE record_id = '${LIVE_PREFIX_FENCE.pendingRecord}'),
    (SELECT state FROM public.record_media_cleanup_jobs
      WHERE record_id = '${LIVE_PREFIX_FENCE.expiredRecord}'),
    (SELECT state FROM public.record_media_cleanup_jobs
      WHERE record_id = '${LIVE_PREFIX_FENCE.normalRecord}'))`),
  'read skipped live prefix states'),
  'pending|leased|leased',
  'skipped poison jobs must remain untouched while normal work is leased',
);

// Force the impossible post-088 anomaly directly: the original lease trigger
// accepts the prefix, then 088 must veto deletion because its record is live.
const livePrefixPath = `${RECONCILE.couple}/${LIVE_PREFIX_FENCE.pendingRecord}/live.jpg`;
expectOk(sql(`
UPDATE public.record_media_cleanup_jobs
SET state = 'leased', lease_id = '${LIVE_PREFIX_FENCE.pendingLease}',
    lease_expires_at = clock_timestamp() + interval '2 minutes'
WHERE record_id = '${LIVE_PREFIX_FENCE.pendingRecord}';
INSERT INTO storage.objects(bucket_id, name, owner_id)
VALUES ('couple-media', '${livePrefixPath}', '${RECONCILE.owner}');
`), 'force anomalous live leased prefix');
const liveDeleteConflict = expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${livePrefixPath}'`),
  'block live-record prefix Storage delete',
  /record_media_cleanup_live_record_conflict/i,
);
for (const secretValue of [
  LIVE_PREFIX_FENCE.pendingRecord,
  RECONCILE.couple,
  RECONCILE.owner,
  livePrefixPath,
]) {
  if (liveDeleteConflict.includes(secretValue)) {
    throw new Error('live prefix deletion failure disclosed cleanup identity');
  }
}
checks += 1;
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM storage.objects
    WHERE name = '${livePrefixPath}'`), 'read object after live prefix veto'),
  '1',
  'live-record prefix veto must preserve the physical object',
);

// Completed response replay is also fenced before 086 can reopen any state.
expectOk(sql(`INSERT INTO public.daily_records(id, user_id, couple_id, is_private)
  VALUES ('${LIVE_PREFIX_FENCE.completionRecord}', '${RECONCILE.owner}', '${RECONCILE.couple}', false);
INSERT INTO public.record_media_cleanup_jobs(
  record_id, couple_id, owner_user_id, state, lease_id, completed_at
) VALUES (
  '${LIVE_PREFIX_FENCE.completionRecord}', '${RECONCILE.couple}', '${RECONCILE.owner}',
  'completed', '${LIVE_PREFIX_FENCE.completionLease}', clock_timestamp()
)`), 'seed live completed replay anomaly');
const liveCompletionConflict = expectFail(
  asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job(
    '${LIVE_PREFIX_FENCE.completionRecord}', '${LIVE_PREFIX_FENCE.completionLease}')`),
  'block live-record completed replay',
  /record_media_cleanup_live_record_conflict/i,
);
if (liveCompletionConflict.includes(LIVE_PREFIX_FENCE.completionRecord)) {
  throw new Error('live completion failure disclosed record identity');
}
checks += 1;
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', state, lease_id, completed_at IS NOT NULL)
    FROM public.record_media_cleanup_jobs
    WHERE record_id = '${LIVE_PREFIX_FENCE.completionRecord}'`),
  'read state after live completed replay veto'),
  `completed|${LIVE_PREFIX_FENCE.completionLease}|t`,
  'live completed replay veto must not reopen or mutate the cleanup job',
);

expectOk(sql(`
DELETE FROM storage.objects WHERE name = '${livePrefixPath}';
DELETE FROM public.record_media_cleanup_jobs WHERE record_id IN (
  '${LIVE_PREFIX_FENCE.pendingRecord}', '${LIVE_PREFIX_FENCE.expiredRecord}',
  '${LIVE_PREFIX_FENCE.normalRecord}', '${LIVE_PREFIX_FENCE.completionRecord}'
);
DELETE FROM public.daily_records WHERE id IN (
  '${LIVE_PREFIX_FENCE.pendingRecord}', '${LIVE_PREFIX_FENCE.expiredRecord}',
  '${LIVE_PREFIX_FENCE.completionRecord}'
);
DELETE FROM public.record_media_cleanup_jobs WHERE record_id IN (
  '${LIVE_PREFIX_FENCE.pendingRecord}', '${LIVE_PREFIX_FENCE.expiredRecord}',
  '${LIVE_PREFIX_FENCE.completionRecord}'
);
`), 'retire migration 088 live-prefix fixtures');
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
  ('${IDS.cascadeUser}'), ('${IDS.coupleCascadeUser}'), ('${IDS.accountUser}'),
  ('${IDS.fenceUser}');
INSERT INTO public.couples(id) VALUES
  ('${IDS.couple}'), ('${IDS.cascadeCouple}'), ('${IDS.coupleCascade}'), ('${IDS.accountCouple}'),
  ('${IDS.fenceCouple}'), ('${IDS.foreignFenceCouple}');
INSERT INTO public.couple_members(couple_id, user_id, status) VALUES
  ('${IDS.couple}', '${IDS.owner}', 'active'),
  ('${IDS.couple}', '${IDS.partner}', 'active'),
  ('${IDS.couple}', '${IDS.former}', 'disconnected'),
  ('${IDS.cascadeCouple}', '${IDS.cascadeUser}', 'active'),
  ('${IDS.coupleCascade}', '${IDS.coupleCascadeUser}', 'active'),
  ('${IDS.accountCouple}', '${IDS.accountUser}', 'active'),
  ('${IDS.fenceCouple}', '${IDS.fenceUser}', 'active');
INSERT INTO public.daily_records(id, user_id, couple_id, is_private) VALUES
  ('${IDS.ownerRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.partnerTarget}', '${IDS.owner}', '${IDS.couple}', true),
  ('${IDS.cascadeRecord}', '${IDS.cascadeUser}', '${IDS.cascadeCouple}', false),
  ('${IDS.coupleCascadeRecord}', '${IDS.coupleCascadeUser}', '${IDS.coupleCascade}', false),
  ('${IDS.accountRecord}', '${IDS.accountUser}', '${IDS.accountCouple}', false),
  ('${IDS.siblingRecord}', '${IDS.partner}', '${IDS.couple}', false),
  ('${IDS.identityV0Record}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.identityV1Record}', '${IDS.owner}', '${IDS.couple}', true),
  ('${IDS.fenceRecord}', '${IDS.fenceUser}', '${IDS.fenceCouple}', false),
  ('${IDS.foreignFenceRecord}', '${IDS.unrelated}', '${IDS.foreignFenceCouple}', false);
INSERT INTO public.push_delivery_state(user_id, has_unseen) VALUES ('${IDS.partner}', true);
INSERT INTO public.couple_highlights(id) VALUES ('50000000-0000-4000-8000-000000000001');
INSERT INTO public.couple_highlight_items(highlight_id, record_id)
VALUES ('50000000-0000-4000-8000-000000000001', '${IDS.ownerRecord}');
TRUNCATE public.trigger_audit;
`;
expectOk(psql(['-q', '-c', insertFixtures]), 'insert actor fixtures');

const IDENTITY = {
  adoptOperation: '43000000-0000-4000-8000-000000000001',
  removeOperation: '43000000-0000-4000-8000-000000000002',
  mediaObject: '72000000-0000-4000-8000-000000000001',
  fenceMediaObject: '72000000-0000-4000-8000-000000000002',
  foreignMediaObject: '72000000-0000-4000-8000-000000000003',
  fenceUnledgeredRecord: '72000000-0000-4000-8000-000000000004',
  fenceUnledgeredMedia: '72000000-0000-4000-8000-000000000005',
};

expectOk(
  asActor('authenticated', IDS.owner, `UPDATE public.daily_records
    SET is_private = true WHERE id = '${IDS.identityV0Record}'`),
  'ordinary v0 content update',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', id, user_id, couple_id, is_private::text)
    FROM public.daily_records WHERE id = '${IDS.identityV0Record}'`), 'read ordinary v0 update'),
  `${IDS.identityV0Record}|${IDS.owner}|${IDS.couple}|true`,
  'v0 content updates must remain available without changing routing identity',
);
for (const [assignment, label] of [
  [`id = '${IDS.identityV0Replacement}'`, 'v0 record id'],
  [`couple_id = '${IDS.cascadeCouple}'`, 'v0 couple id'],
]) {
  expectFail(
    asActor('authenticated', IDS.owner, `UPDATE public.daily_records SET ${assignment}
      WHERE id = '${IDS.identityV0Record}'`),
    `${label} mutation`,
    /daily_record_identity_immutable/i,
  );
}
expectFail(
  sql(`UPDATE public.daily_records SET user_id = '${IDS.unrelated}'
    WHERE id = '${IDS.identityV0Record}'`),
  'v0 owner id mutation through privileged path',
  /daily_record_identity_immutable/i,
);

const identityV1Path = `${IDS.couple}/${IDS.identityV1Record}/${IDENTITY.mediaObject}.jpg`;
expectOk(asActor('authenticated', IDS.owner, `INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${identityV1Path}')`), 'insert identity v1 legacy object');
expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
  operationId: IDENTITY.adoptOperation,
  recordId: IDS.identityV1Record,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 1,
  paths: [identityV1Path],
})), 'begin identity v1 adoption');
expectOk(asActor('authenticated', IDS.owner, `UPDATE public.daily_records
  SET content_revision = 2, last_media_operation_id = '${IDENTITY.adoptOperation}'
  WHERE id = '${IDS.identityV1Record}'`), 'commit identity v1 adoption');
expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
  operationId: IDENTITY.removeOperation,
  recordId: IDS.identityV1Record,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 2,
})), 'begin valid identity-change media operation');
expectFail(
  sql(`UPDATE public.daily_records SET
    id = '${IDS.identityV1Replacement}',
    user_id = '${IDS.unrelated}',
    couple_id = '${IDS.cascadeCouple}',
    content_revision = 3,
    last_media_operation_id = '${IDENTITY.removeOperation}'
    WHERE id = '${IDS.identityV1Record}'`),
  'v1 identity mutation with valid media operation',
  /daily_record_identity_immutable/i,
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT count(*) FROM public.daily_records WHERE id = '${IDS.identityV1Record}'
      AND user_id = '${IDS.owner}' AND couple_id = '${IDS.couple}'),
    (SELECT count(*) FROM public.daily_records WHERE id = '${IDS.identityV1Replacement}'),
    (SELECT state FROM public.record_media_mutations
      WHERE operation_id = '${IDENTITY.removeOperation}'),
    (SELECT state FROM public.record_media_objects
      WHERE media_object_id = '${IDENTITY.mediaObject}'))`), 'read identity-change rollback state'),
  '1|0|pending|active',
  'failed v1 identity change must roll back record, operation and object transitions',
);

expectOk(sql(`
INSERT INTO public.account_deletion_requests(user_id, attempt_id, phase)
VALUES ('${IDS.fenceUser}', '${IDS.fenceAttempt}', 'relational_prepared');
DELETE FROM public.daily_records WHERE id = '${IDS.fenceRecord}';
UPDATE public.record_media_cleanup_jobs
SET state = 'completed', completed_at = clock_timestamp(), updated_at = clock_timestamp()
WHERE record_id = '${IDS.fenceRecord}';
WITH object AS (
  INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${IDS.fenceCouple}/${IDS.fenceRecord}/${IDENTITY.fenceMediaObject}.jpg')
  RETURNING id
)
INSERT INTO public.record_media_objects(
  media_object_id, storage_object_id, record_id, couple_id, owner_user_id, state
)
SELECT '${IDENTITY.fenceMediaObject}', object.id, '${IDS.fenceRecord}', '${IDS.fenceCouple}',
       '${IDS.unrelated}', 'active'
FROM object;
`), 'insert wrong-owner object in deleting owner namespace');
for (const state of ['active', 'reserved', 'superseded']) {
  expectOk(sql(`UPDATE public.record_media_objects SET state = '${state}'
    WHERE media_object_id = '${IDENTITY.fenceMediaObject}'`), `set defensive fence ${state} state`);
  const output = expectFail(
    asActor('service_role', null, `SELECT public.close_account_relationship_generations_v2(
      '${IDS.fenceUser}', '${IDS.fenceAttempt}')`),
    `account close with ${state} object in owned namespace`,
    /record_media_cleanup_pending/i,
  );
  if (output.includes(IDENTITY.fenceMediaObject) || output.includes(IDS.unrelated)) {
    throw new Error(`account cleanup fence exposed foreign object identity for ${state}`);
  }
  checks += 1;
}
expectFail(
  asActor('authenticated', IDS.fenceUser, `SELECT public.assert_account_record_media_cleanup_complete(
    '${IDS.fenceUser}', '${IDS.fenceAttempt}')`),
  'authenticated caller probing account cleanup object existence',
  /permission denied/i,
);
expectOk(sql(`
UPDATE public.record_media_objects
SET state = 'deleted', deleted_at = clock_timestamp()
WHERE media_object_id = '${IDENTITY.fenceMediaObject}';
INSERT INTO public.record_media_objects(
  media_object_id, record_id, couple_id, owner_user_id, state
) VALUES (
  '${IDENTITY.foreignMediaObject}', '${IDS.foreignFenceRecord}', '${IDS.foreignFenceCouple}',
  '${IDS.unrelated}', 'active'
);
`), 'retire target object and retain unrelated live object');
const fenceUnledgeredPath = `${IDS.fenceCouple}/${IDENTITY.fenceUnledgeredRecord}/${IDENTITY.fenceUnledgeredMedia}.jpg`;
expectOk(sql(`INSERT INTO storage.objects(bucket_id, name, owner_id)
  VALUES ('couple-media', '${fenceUnledgeredPath}', '${IDS.fenceUser}')`),
  'insert owner-attributable unledgered cleanup object');
const unledgeredFenceOutput = expectFail(
  asActor('service_role', null, `SELECT public.close_account_relationship_generations_v2(
    '${IDS.fenceUser}', '${IDS.fenceAttempt}')`),
  'account close with owner-attributable unledgered Storage object',
  /record_media_cleanup_pending/i,
);
if (
  unledgeredFenceOutput.includes(IDENTITY.fenceUnledgeredRecord)
  || unledgeredFenceOutput.includes(IDENTITY.fenceUnledgeredMedia)
) {
  throw new Error('account cleanup fence exposed unledgered Storage identity');
}
checks += 1;
expectOk(sql(`DELETE FROM storage.objects WHERE name = '${fenceUnledgeredPath}'`),
  'retire owner-attributable unledgered cleanup object');
expectOk(
  asActor('service_role', null, `SELECT public.close_account_relationship_generations_v2(
    '${IDS.fenceUser}', '${IDS.fenceAttempt}')`),
  'account close with only an unrelated namespace object',
);
expectEqual(
  expectOk(sql(`SELECT (closed_at IS NOT NULL)::text FROM public.couples
    WHERE id = '${IDS.fenceCouple}'`), 'read defensive fence relationship close'),
  'true',
  'unrelated namespaces must not block or disclose their object existence',
);
expectOk(sql('TRUNCATE public.trigger_audit'), 'clear identity test trigger audit');

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
expectFail(
  asActor('service_role', null, `SELECT set_config('app.fixture_account_write_capability', 'open', true);
    DELETE FROM storage.objects WHERE name = '${IDS.couple}/${IDS.raceRecord}/inflight.jpg'`),
  'account capability cannot bypass couple-media worker lease',
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

// ---------------------------------------------------------------------------
// 084 opaque object lifecycle, actor matrix, read gate and replay contracts.
// ---------------------------------------------------------------------------

const LIFECYCLE = {
  initialOperation: '41000000-0000-4000-8000-000000000001',
  ordinaryOperation: '41000000-0000-4000-8000-000000000002',
  competingOperation: '41000000-0000-4000-8000-000000000003',
  removeOperation: '41000000-0000-4000-8000-000000000004',
  reuseOperation: '41000000-0000-4000-8000-000000000005',
  accountAttempt: '41000000-0000-4000-8000-000000000006',
  legacyMedia: '70000000-0000-4000-8000-000000000001',
  newMedia: '70000000-0000-4000-8000-000000000002',
};
const lifecycleLegacyPath = `${IDS.couple}/${IDS.lifecycleRecord}/${LIFECYCLE.legacyMedia}.jpg`;
const lifecycleNewPath = `${IDS.couple}/${IDS.lifecycleRecord}/${LIFECYCLE.newMedia}.jpg`;

expectOk(sql(`
INSERT INTO auth.users(id) VALUES ('${IDS.lifecycleAccountUser}');
INSERT INTO public.couples(id) VALUES ('${IDS.lifecycleAccountCouple}');
INSERT INTO public.couple_members(couple_id, user_id, status)
VALUES ('${IDS.lifecycleAccountCouple}', '${IDS.lifecycleAccountUser}', 'active');
INSERT INTO public.daily_records(id, user_id, couple_id, is_private) VALUES
  ('${IDS.lifecycleRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.leasedDeleteRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.beginRaceRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.abandonRaceRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.expiryRaceRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.commitRaceRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.deleteFirstRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.scopeHoldRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.scopeOtherRecord}', '${IDS.owner}', '${IDS.couple}', false),
  ('${IDS.lifecycleAccountRecord}', '${IDS.lifecycleAccountUser}', '${IDS.lifecycleAccountCouple}', false);
`), 'insert migration 084 actor fixtures');

expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    array_length(storage.foldername('${lifecycleLegacyPath}'), 1),
    (storage.foldername('${lifecycleLegacyPath}'))[1],
    (storage.foldername('${lifecycleLegacyPath}'))[2],
    storage.filename('${lifecycleLegacyPath}'))`), 'probe real Storage path helpers'),
  `2|${IDS.couple}|${IDS.lifecycleRecord}|${LIFECYCLE.legacyMedia}.jpg`,
  'foldername must expose two folders while filename carries object identity',
);

for (const tableName of ['record_media_mutations', 'record_media_mutation_items', 'record_media_objects']) {
  expectEqual(
    expectOk(sql(`SELECT concat_ws('|', relrowsecurity::text,
      has_table_privilege('anon', 'public.${tableName}', 'SELECT')::text,
      has_table_privilege('authenticated', 'public.${tableName}', 'SELECT')::text,
      has_table_privilege('service_role', 'public.${tableName}', 'SELECT')::text)
      FROM pg_class WHERE oid = 'public.${tableName}'::regclass`), `read ${tableName} privacy contract`),
    'true|false|false|false',
    `${tableName} must be RLS-private with every direct API read revoked`,
  );
  expectEqual(
    expectOk(sql(`SELECT count(*)::text FROM pg_constraint
      WHERE conrelid = 'public.${tableName}'::regclass AND contype = 'f'`), `read ${tableName} foreign keys`),
    '0',
    `${tableName} tombstones must not cascade through record/account foreign keys`,
  );
}
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('record_media_mutations', 'record_media_mutation_items', 'record_media_objects')
      AND column_name ~ '(path|filename|signed_url|content_envelope|display_order|media_type|user_content)'`), 'scan lifecycle ledger column names'),
  '0',
  'lifecycle ledgers must contain no path, filename, URL, envelope, user content or display metadata',
);
expectEqual(
  expectOk(asActor('service_role', null, 'SELECT public.record_media_cleanup_contract_version()::text'), 'service contract probe').split('\n').at(-1),
  '4',
  'service cleanup contract must expose exact version 4',
);
expectFail(
  asActor('authenticated', IDS.owner, 'SELECT public.record_media_cleanup_contract_version()'),
  'authenticated contract probe',
  /permission denied/i,
);

expectOk(asActor(
  'authenticated',
  IDS.owner,
  `INSERT INTO storage.objects(bucket_id, name) VALUES ('couple-media', '${lifecycleLegacyPath}')`,
), 'insert true v0 legacy object');
for (const [actor, expected, label] of [
  [IDS.owner, '1', 'owner'],
  [IDS.partner, '1', 'active partner'],
  [IDS.unrelated, '0', 'unrelated actor'],
  [IDS.former, '0', 'former partner'],
]) {
  expectEqual(
    expectOk(asActor('authenticated', actor, `SELECT count(*)::text FROM storage.objects WHERE name = '${lifecycleLegacyPath}'`), `${label} v0 read`).split('\n').at(-1),
    expected,
    `${label} v0 read policy`,
  );
}
expectFail(
  asActor('anon', null, `SELECT count(*) FROM storage.objects WHERE name = '${lifecycleLegacyPath}'`),
  'anonymous v0 read',
  /permission denied/i,
);

for (const [actor, recordId, coupleId, label] of [
  [IDS.partner, IDS.lifecycleRecord, IDS.couple, 'active partner'],
  [IDS.unrelated, IDS.lifecycleRecord, IDS.couple, 'unrelated actor'],
  [IDS.former, IDS.lifecycleRecord, IDS.couple, 'former partner'],
  [IDS.owner, IDS.lifecycleRecord, IDS.lifecycleAccountCouple, 'wrong couple'],
  [IDS.owner, IDS.siblingRecord, IDS.couple, 'wrong owner record'],
]) {
  expectFail(
    asActor('authenticated', actor, beginMutationSql({
      operationId: '41999999-9999-4999-8999-999999999999',
      recordId,
      userId: actor,
      coupleId,
      baseRevision: 1,
    })),
    `${label} begin mutation`,
    /media_mutation_unavailable/i,
  );
}
expectFail(
  asActor('anon', null, beginMutationSql({
    operationId: '41999999-9999-4999-8999-999999999998',
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 1,
  })),
  'anonymous begin mutation',
  /permission denied/i,
);
expectFail(
  asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: '41999999-9999-4999-8999-999999999997',
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 2,
  })),
  'stale owner begin mutation',
  /media_mutation_stale_revision/i,
);

const initialBegin = beginMutationSql({
  operationId: LIFECYCLE.initialOperation,
  recordId: IDS.lifecycleRecord,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 1,
  paths: [lifecycleLegacyPath],
  mediaIds: [LIFECYCLE.newMedia],
});
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, initialBegin), 'owner begins v1 adoption').split('\n').at(-1),
  'pending',
  'owner must reserve the exact final object set',
);
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, initialBegin), 'replay owner begin response').split('\n').at(-1),
  'pending',
  'same-operation begin replay must return the existing reservation',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT count(*) FROM public.record_media_mutations WHERE operation_id = '${LIFECYCLE.initialOperation}'),
    (SELECT count(*) FROM public.record_media_mutation_items WHERE operation_id = '${LIFECYCLE.initialOperation}'),
    (SELECT count(*) FROM public.record_media_objects WHERE record_id = '${IDS.lifecycleRecord}'))`), 'count replay-safe lifecycle rows'),
  '1|2|2',
  'begin replay must not duplicate operation, item or object identity',
);
expectFail(
  asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: LIFECYCLE.competingOperation,
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 1,
    paths: [lifecycleLegacyPath],
  })),
  'second pending mutation on one record',
  /media_mutation_busy/i,
);

expectOk(asActor(
  'authenticated',
  IDS.owner,
  `INSERT INTO storage.objects(bucket_id, name) VALUES ('couple-media', '${lifecycleNewPath}')`,
), 'upload exact reserved media object');
for (const [actor, label] of [[IDS.owner, 'owner'], [IDS.partner, 'active partner']]) {
  expectEqual(
    expectOk(asActor('authenticated', actor, `SELECT count(*)::text FROM storage.objects WHERE name = '${lifecycleNewPath}'`), `${label} reserved read`).split('\n').at(-1),
    '0',
    `${label} must not read an uncommitted reservation even while the record is v0`,
  );
}
expectFail(
  asActor('authenticated', IDS.owner, `INSERT INTO storage.objects(bucket_id, name)
    VALUES ('couple-media', '${IDS.couple}/${IDS.lifecycleRecord}/70000000-0000-4000-8000-000000000099.jpg')`),
  'upload without exact reservation',
  /media_upload_reservation_required/i,
);
expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${lifecycleNewPath}'`),
  'service object delete without exact lease',
  /record_media_cleanup_lease_required/i,
);

expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `UPDATE public.daily_records
    SET content_revision = 2, last_media_operation_id = '${LIFECYCLE.initialOperation}'
    WHERE id = '${IDS.lifecycleRecord}'
    RETURNING concat_ws('|', media_contract_version, media_manifest_revision, content_revision)`), 'commit v1 media adoption').split('\n').at(-1),
  '1|2|2',
  'record CAS must atomically stamp v1 and the manifest revision',
);
expectEqual(
  expectOk(sql(`SELECT string_agg(state, ',' ORDER BY media_object_id)
    FROM public.record_media_objects WHERE record_id = '${IDS.lifecycleRecord}'`), 'read committed object states'),
  'active,active',
  'both adopted and uploaded objects must activate atomically',
);
for (const [actor, label] of [[IDS.owner, 'owner'], [IDS.partner, 'active partner']]) {
  expectEqual(
    expectOk(asActor('authenticated', actor, `SELECT count(*)::text FROM storage.objects
      WHERE name IN ('${lifecycleLegacyPath}', '${lifecycleNewPath}')`), `${label} active v1 reads`).split('\n').at(-1),
    '2',
    `${label} must read only active v1 ledger objects`,
  );
}
for (const [actor, expected, label] of [
  [IDS.owner, 'committed', 'owner'],
  [IDS.partner, 'unavailable', 'partner'],
  [IDS.unrelated, 'unavailable', 'unrelated actor'],
  [IDS.former, 'unavailable', 'former partner'],
]) {
  expectEqual(
    expectOk(asActor('authenticated', actor, mutationStatusSql(
      LIFECYCLE.initialOperation,
      IDS.lifecycleRecord,
      actor,
      IDS.couple,
    )), `${label} mutation status`).split('\n').at(-1),
    expected,
    `${label} status must preserve the non-disclosing identity boundary`,
  );
}
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, initialBegin), 'replay committed begin').split('\n').at(-1),
  'committed',
  'committed operation begin replay must be terminal and duplicate-free',
);
expectFail(
  asActor('authenticated', IDS.owner, `UPDATE public.daily_records SET is_private = true
    WHERE id = '${IDS.lifecycleRecord}'`),
  'v1 old writer without operation',
  /media_operation_required/i,
);

const ordinaryBegin = beginMutationSql({
  operationId: LIFECYCLE.ordinaryOperation,
  recordId: IDS.lifecycleRecord,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 2,
  paths: [lifecycleLegacyPath, lifecycleNewPath],
});
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, ordinaryBegin), 'begin ordinary v1 text revision').split('\n').at(-1),
  'pending',
  'ordinary v1 edits must carry the unchanged manifest',
);
expectFail(
  asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: LIFECYCLE.competingOperation,
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 2,
    paths: [lifecycleLegacyPath, lifecycleNewPath],
  })),
  'same-base competing mutation',
  /media_mutation_busy/i,
);
expectOk(asActor('authenticated', IDS.owner, `UPDATE public.daily_records
  SET content_revision = 3, last_media_operation_id = '${LIFECYCLE.ordinaryOperation}'
  WHERE id = '${IDS.lifecycleRecord}'`), 'commit ordinary v1 text revision');
expectFail(
  asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: LIFECYCLE.competingOperation,
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 2,
    paths: [lifecycleLegacyPath, lifecycleNewPath],
  })),
  'same-base loser after winner commit',
  /media_mutation_stale_revision/i,
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', content_revision,
    (SELECT count(*) FROM public.record_media_mutations
      WHERE record_id = '${IDS.lifecycleRecord}' AND state = 'committed'))
    FROM public.daily_records WHERE id = '${IDS.lifecycleRecord}'`), 'read same-base winner'),
  '3|2',
  'only one same-base operation may advance each revision',
);

expectOk(sql(`INSERT INTO public.account_deletion_requests(user_id, attempt_id, phase)
  VALUES ('${IDS.partner}', '${LIFECYCLE.accountAttempt}', 'media_cleanup')`), 'install peer deletion fence for media status');
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, mutationStatusSql(
    LIFECYCLE.ordinaryOperation,
    IDS.lifecycleRecord,
    IDS.owner,
    IDS.couple,
  )), 'status under peer account fence').split('\n').at(-1),
  'unavailable',
  'status must fail closed while either active participant is deleting',
);
expectFail(
  asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: '41000000-0000-4000-8000-000000000099',
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 3,
    paths: [lifecycleLegacyPath, lifecycleNewPath],
  })),
  'begin under peer account fence',
  /account_deletion_pending/i,
);
expectOk(sql(`DELETE FROM public.account_deletion_requests WHERE user_id = '${IDS.partner}'`), 'remove peer deletion fence');
expectFail(
  asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: '41000000-0000-4000-8000-000000000098',
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 3,
    paths: [lifecycleLegacyPath, lifecycleLegacyPath, lifecycleNewPath],
  })),
  'duplicate lifecycle path manifest',
  /media_mutation_unavailable/i,
);

const removeBegin = beginMutationSql({
  operationId: LIFECYCLE.removeOperation,
  recordId: IDS.lifecycleRecord,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 3,
  paths: [lifecycleLegacyPath],
});
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, removeBegin), 'begin logical object removal').split('\n').at(-1),
  'pending',
  'logical removal operation must begin',
);
expectOk(asActor('authenticated', IDS.owner, `UPDATE public.daily_records
  SET content_revision = 4, last_media_operation_id = '${LIFECYCLE.removeOperation}'
  WHERE id = '${IDS.lifecycleRecord}'`), 'commit logical object removal');
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', state,
      (storage_object_id IS NOT NULL)::text,
      (SELECT count(*) FROM storage.objects WHERE name = '${lifecycleNewPath}'))
    FROM public.record_media_objects WHERE media_object_id = '${LIFECYCLE.newMedia}'`), 'read logical removal state'),
  'cleanup_pending|true|1',
  'logical removal must enqueue durable cleanup without pretending physical deletion',
);
for (const [actor, label] of [[IDS.owner, 'owner'], [IDS.partner, 'partner']]) {
  expectEqual(
    expectOk(asActor('authenticated', actor, `SELECT count(*)::text FROM storage.objects WHERE name = '${lifecycleNewPath}'`), `${label} post-removal read`).split('\n').at(-1),
    '0',
    `${label} signing/read access must stop in the logical removal transaction`,
  );
}

// Exact object cleanup is leased by immutable Storage UUID, never by a stored
// path. A sibling or same-name replacement cannot borrow that authority.
const lifecycleObjectLease = '62000000-0000-4000-8000-000000000001';
const lifecycleStorageId = expectOk(
  sql(`SELECT id::text FROM storage.objects WHERE name = '${lifecycleNewPath}'`),
  'read transient cleanup Storage identity',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT media_object_id::text || '|' || storage_object_id::text
    FROM public.claim_record_media_object_cleanup_job('${lifecycleObjectLease}', 120)`), 'claim exact object cleanup').split('\n').at(-1),
  `${LIFECYCLE.newMedia}|${lifecycleStorageId}`,
  'object worker must claim the exact opaque object and Storage identity',
);
expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${lifecycleLegacyPath}'`),
  'object lease sibling delete',
  /record_media_cleanup_lease_required/i,
);
expectOk(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE id = '${lifecycleStorageId}'`),
  'object lease exact delete',
);
expectOk(sql(`INSERT INTO storage.objects(bucket_id, name) VALUES ('couple-media', '${lifecycleNewPath}')`), 'simulate same-name recreated object');
expectFail(
  asActor('service_role', null, `DELETE FROM storage.objects WHERE name = '${lifecycleNewPath}'`),
  'object lease recreated-object delete',
  /record_media_cleanup_lease_required/i,
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.settle_record_media_object_cleanup_job(
    '${LIFECYCLE.newMedia}', '${lifecycleStorageId}', '${lifecycleObjectLease}')::text`), 'settle exact object cleanup').split('\n').at(-1),
  'true',
  'settlement must verify disappearance of the exact immutable Storage UUID',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.settle_record_media_object_cleanup_job(
    '${LIFECYCLE.newMedia}', '${lifecycleStorageId}', '${lifecycleObjectLease}')::text`), 'replay object settlement response').split('\n').at(-1),
  'true',
  'object settlement response-loss replay must be idempotent',
);
expectOk(sql(`DELETE FROM storage.objects WHERE name = '${lifecycleNewPath}'`), 'remove recreated object fixture');
expectFail(
  asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: LIFECYCLE.reuseOperation,
    recordId: IDS.lifecycleRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 4,
    paths: [lifecycleLegacyPath],
    mediaIds: [LIFECYCLE.newMedia],
  })),
  'reuse deleted stable object identity',
  /media_object_id_retired/i,
);

const removeLastOperation = '41000000-0000-4000-8000-000000000007';
expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
  operationId: removeLastOperation,
  recordId: IDS.lifecycleRecord,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 4,
})), 'begin removal of final active object');
expectOk(asActor('authenticated', IDS.owner, `UPDATE public.daily_records
  SET content_revision = 5, last_media_operation_id = '${removeLastOperation}'
  WHERE id = '${IDS.lifecycleRecord}'`), 'commit removal of final active object');
const lifecycleLegacyStorageId = expectOk(
  sql(`SELECT storage_object_id::text FROM public.record_media_objects
    WHERE media_object_id = '${LIFECYCLE.legacyMedia}'`),
  'read blocked-object Storage identity',
);
for (let attempt = 1; attempt <= 8; attempt += 1) {
  const leaseId = `62000000-0000-4000-8000-${String(attempt + 1).padStart(12, '0')}`;
  expectEqual(
    expectOk(asActor('service_role', null, `SELECT media_object_id::text
      FROM public.claim_record_media_object_cleanup_job('${leaseId}', 120)`), `claim object failure ${attempt}`).split('\n').at(-1),
    LIFECYCLE.legacyMedia,
    `object failure ${attempt} must claim the same exact object`,
  );
  const expectedState = attempt === 8 ? 'blocked' : 'pending';
  expectEqual(
    expectOk(asActor('service_role', null, `SELECT public.fail_record_media_object_cleanup_job(
      '${LIFECYCLE.legacyMedia}',
      '${lifecycleLegacyStorageId}',
      '${leaseId}', 'E_STORAGE_TRANSIENT')`), `fail object cleanup ${attempt}`).split('\n').at(-1),
    expectedState,
    `object failure ${attempt} must use bounded state`,
  );
  expectEqual(
    expectOk(asActor('service_role', null, `SELECT public.fail_record_media_object_cleanup_job(
      '${LIFECYCLE.legacyMedia}',
      '${lifecycleLegacyStorageId}',
      '${leaseId}', 'E_STORAGE_TRANSIENT')`), `replay object failure ${attempt}`).split('\n').at(-1),
    expectedState,
    `object failure replay ${attempt} must not double count`,
  );
  if (attempt < 8) {
    expectOk(sql(`UPDATE public.record_media_objects SET next_attempt_at = clock_timestamp()
      WHERE media_object_id = '${LIFECYCLE.legacyMedia}'`), `rewind object retry ${attempt}`);
  }
}
expectEqual(
  expectOk(sql(`SELECT failure_count::text || '|' || state
    FROM public.record_media_objects WHERE media_object_id = '${LIFECYCLE.legacyMedia}'`), 'read blocked object cleanup'),
  '8|blocked',
  'object cleanup retries must stop after the bounded eighth failure',
);
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `SELECT public.delete_my_record(
    '${IDS.lifecycleRecord}', '${IDS.owner}', '${IDS.couple}')::text`), 'delete record with nonleased object work').split('\n').at(-1),
  'true',
  'record deletion must supersede nonleased object work into one prefix job',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT state FROM public.record_media_objects WHERE media_object_id = '${LIFECYCLE.legacyMedia}'),
    (SELECT state FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.lifecycleRecord}'))`), 'read superseded object and prefix job'),
  'superseded|pending',
  'full-prefix cleanup must become the sole owner after record deletion',
);
expectFail(
  asActor('authenticated', IDS.owner, `INSERT INTO storage.objects(bucket_id, name)
    VALUES ('couple-media', '${lifecycleLegacyPath}')`),
  'upload under retired record prefix',
  /record_id_retired_for_media_cleanup/i,
);
const lifecyclePrefixLease = '62000000-0000-4000-8000-000000000099';
expectEqual(
  expectOk(asActor('service_role', null, `SELECT record_id::text
    FROM public.claim_record_media_cleanup_job('${lifecyclePrefixLease}', 120)`), 'claim lifecycle prefix cleanup').split('\n').at(-1),
  IDS.lifecycleRecord,
  'prefix cleanup must claim the retired lifecycle namespace',
);
expectOk(
  asActor('service_role', null, `DELETE FROM storage.objects
    WHERE name = '${lifecycleLegacyPath}'`),
  'delete final lifecycle prefix object',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job(
    '${IDS.lifecycleRecord}', '${lifecyclePrefixLease}')::text`), 'settle lifecycle prefix cleanup').split('\n').at(-1),
  'true',
  'fresh-empty prefix settlement must complete',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
    (SELECT state FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.lifecycleRecord}'),
    (SELECT string_agg(state, ',' ORDER BY media_object_id)
      FROM public.record_media_objects WHERE record_id = '${IDS.lifecycleRecord}'),
    (SELECT count(*) FROM storage.objects
      WHERE name LIKE '${IDS.couple}/${IDS.lifecycleRecord}/%'))`), 'read prefix settlement ledger state'),
  'completed|deleted,deleted|0',
  'prefix settlement must retire every non-deleted ledger object in the exact empty namespace',
);
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job(
    '${IDS.lifecycleRecord}', '${lifecyclePrefixLease}')::text`), 'replay lifecycle prefix settlement').split('\n').at(-1),
  'true',
  'prefix object retirement must remain idempotent after response loss',
);

const replayResidueMedia = '70000000-0000-4000-8000-000000000099';
const replayResiduePath = `${IDS.couple}/${IDS.lifecycleRecord}/${replayResidueMedia}.jpg`;
expectOk(sql(`INSERT INTO storage.objects(bucket_id, name, owner_id)
  VALUES ('couple-media', '${replayResiduePath}', '${IDS.owner}')`),
  'insert matching residue after completed response');
expectEqual(
  expectOk(asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job(
    '${IDS.lifecycleRecord}', '${lifecyclePrefixLease}')::text`),
  'replay contaminated completed prefix settlement').split('\n').at(-1),
  'false',
  'completed replay must reject residue and atomically reopen the prefix job',
);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', state, completed_at IS NULL,
    next_attempt_at <= clock_timestamp())
    FROM public.record_media_cleanup_jobs WHERE record_id = '${IDS.lifecycleRecord}'`),
  'read reopened completed prefix job'),
  'pending|t|t',
  'reopened residue must be immediately claimable with no completed marker',
);
expectOk(sql(`
DELETE FROM storage.objects WHERE name = '${replayResiduePath}';
UPDATE public.record_media_cleanup_jobs
SET state = 'completed', lease_id = '${lifecyclePrefixLease}',
    lease_expires_at = NULL, completed_at = clock_timestamp()
WHERE record_id = '${IDS.lifecycleRecord}';
`), 'restore completed prefix after replay-residue proof');

expectOk(sql(`INSERT INTO storage.objects(bucket_id, name, owner_id)
  VALUES ('couple-media', '${replayResiduePath}', '${IDS.unrelated}')`),
  'insert wrong-owner completed-prefix residue');
const completedMismatchOutput = expectFail(
  asActor('service_role', null, `SELECT public.complete_record_media_cleanup_job(
    '${IDS.lifecycleRecord}', '${lifecyclePrefixLease}')`),
  'replay completed prefix with wrong current Storage owner',
  /record_media_cleanup_identity_ambiguous/i,
);
if (completedMismatchOutput.includes(replayResiduePath) || completedMismatchOutput.includes(IDS.unrelated)) {
  throw new Error('completed-prefix identity failure exposed Storage identity');
}
checks += 1;
expectOk(sql(`DELETE FROM storage.objects WHERE name = '${replayResiduePath}'`),
  'retire wrong-owner completed-prefix residue');

// An actively leased exact-object job wins over record deletion; once expired,
// the retry can safely supersede it without reversing the lock order.
const leasedMedia = '70000000-0000-4000-8000-000000000003';
const leasedPath = `${IDS.couple}/${IDS.leasedDeleteRecord}/${leasedMedia}.jpg`;
const leasedAdoptOperation = '41000000-0000-4000-8000-000000000008';
const leasedRemoveOperation = '41000000-0000-4000-8000-000000000009';
const activeObjectLease = '62000000-0000-4000-8000-000000000010';
expectOk(asActor('authenticated', IDS.owner, `INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${leasedPath}')`), 'insert leased-delete legacy object');
expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
  operationId: leasedAdoptOperation,
  recordId: IDS.leasedDeleteRecord,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 1,
  paths: [leasedPath],
})), 'begin leased-delete adoption');
expectOk(asActor('authenticated', IDS.owner, `UPDATE public.daily_records
  SET content_revision = 2, last_media_operation_id = '${leasedAdoptOperation}'
  WHERE id = '${IDS.leasedDeleteRecord}'`), 'commit leased-delete adoption');
expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
  operationId: leasedRemoveOperation,
  recordId: IDS.leasedDeleteRecord,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 2,
})), 'begin leased-delete logical removal');
expectOk(asActor('authenticated', IDS.owner, `UPDATE public.daily_records
  SET content_revision = 3, last_media_operation_id = '${leasedRemoveOperation}'
  WHERE id = '${IDS.leasedDeleteRecord}'`), 'commit leased-delete logical removal');
expectOk(sql(`UPDATE public.record_media_objects SET next_attempt_at = clock_timestamp() + interval '1 day'
  WHERE state = 'cleanup_pending' AND media_object_id <> '${leasedMedia}'`), 'defer unrelated object cleanup candidates');
expectEqual(
  expectOk(asActor('service_role', null, `SELECT media_object_id::text
    FROM public.claim_record_media_object_cleanup_job('${activeObjectLease}', 120)`), 'claim active delete-race object lease').split('\n').at(-1),
  leasedMedia,
  'active object lease fixture must claim the intended object',
);
expectFail(
  asActor('authenticated', IDS.owner, `SELECT public.delete_my_record(
    '${IDS.leasedDeleteRecord}', '${IDS.owner}', '${IDS.couple}')`),
  'record delete during active object lease',
  /record_media_object_cleanup_leased/i,
);
expectEqual(
  expectOk(sql(`SELECT count(*)::text FROM public.daily_records WHERE id = '${IDS.leasedDeleteRecord}'`), 'read record after leased delete refusal'),
  '1',
  'active object lease refusal must leave the record intact for retry',
);
expectOk(sql(`UPDATE public.record_media_objects SET lease_expires_at = clock_timestamp() - interval '1 second'
  WHERE media_object_id = '${leasedMedia}'`), 'expire active object lease');
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `SELECT public.delete_my_record(
    '${IDS.leasedDeleteRecord}', '${IDS.owner}', '${IDS.couple}')::text`), 'retry record delete after lease expiry').split('\n').at(-1),
  'true',
  'expired exact-object work must be superseded by prefix cleanup',
);
expectEqual(
  expectOk(sql(`SELECT state FROM public.record_media_objects WHERE media_object_id = '${leasedMedia}'`), 'read expired object supersession'),
  'superseded',
  'record deletion must leave no independently claimable object work',
);

// ---------------------------------------------------------------------------
// 084 record-scoped Storage fences. Each waiter takes the documented
// account/couple/record/mutation/object order before the shared advisory key.
// The uploader takes only the record key before consulting lifecycle state.
// ---------------------------------------------------------------------------

const RACES = {
  beginOperation: '42000000-0000-4000-8000-000000000001',
  abandonOperation: '42000000-0000-4000-8000-000000000002',
  expiryOperation: '42000000-0000-4000-8000-000000000003',
  commitOperation: '42000000-0000-4000-8000-000000000004',
  deleteOperation: '42000000-0000-4000-8000-000000000005',
  scopeOperation: '42000000-0000-4000-8000-000000000006',
  accountAdoptOperation: '42000000-0000-4000-8000-000000000007',
  accountRemoveOperation: '42000000-0000-4000-8000-000000000008',
  beginMedia: '71000000-0000-4000-8000-000000000001',
  abandonMedia: '71000000-0000-4000-8000-000000000002',
  expiryMedia: '71000000-0000-4000-8000-000000000003',
  commitMedia: '71000000-0000-4000-8000-000000000004',
  deleteMedia: '71000000-0000-4000-8000-000000000005',
  scopeMedia: '71000000-0000-4000-8000-000000000006',
  accountMedia: '71000000-0000-4000-8000-000000000007',
};

const beginRacePath = `${IDS.couple}/${IDS.beginRaceRecord}/${RACES.beginMedia}.jpg`;
const beginRaceUploader = startSession('authenticated', IDS.owner);
beginRaceUploader.write(`INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${beginRacePath}'); SELECT 'BEGIN_UPLOAD_HELD';`);
await waitFor(beginRaceUploader, 'BEGIN_UPLOAD_HELD');
const beginRaceWaiter = startSession('authenticated', IDS.owner);
beginRaceWaiter.write(`${beginMutationSql({
  operationId: RACES.beginOperation,
  recordId: IDS.beginRaceRecord,
  userId: IDS.owner,
  coupleId: IDS.couple,
  baseRevision: 1,
  paths: [beginRacePath],
})}; COMMIT; SELECT 'BEGIN_ADOPTION_DONE';`);
await expectSessionBlocked(
  beginRaceWaiter,
  'BEGIN_ADOPTION_DONE',
  'begin mutation versus pre-v1 in-flight upload',
);
beginRaceUploader.write('COMMIT;');
beginRaceUploader.close();
await waitFor(beginRaceWaiter, 'BEGIN_ADOPTION_DONE');
beginRaceWaiter.close();
await waitForExit(beginRaceUploader);
await waitForExit(beginRaceWaiter);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', mutation.state, media.state,
      (media.storage_object_id = object.id)::text)
    FROM public.record_media_mutations AS mutation
    JOIN public.record_media_objects AS media
      ON media.reservation_operation_id IS NULL
     AND media.record_id = mutation.record_id
    JOIN storage.objects AS object ON object.name = '${beginRacePath}'
    WHERE mutation.operation_id = '${RACES.beginOperation}'
      AND media.media_object_id = '${RACES.beginMedia}'`), 'read begin/upload fence outcome'),
  'pending|active|true',
  'begin must drain and adopt the pre-v1 upload by opaque Storage identity',
);

const abandonRacePath = `${IDS.couple}/${IDS.abandonRaceRecord}/${RACES.abandonMedia}.jpg`;
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: RACES.abandonOperation,
    recordId: IDS.abandonRaceRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 1,
    mediaIds: [RACES.abandonMedia],
  })), 'begin abandon/upload race').split('\n').at(-1),
  'pending',
  'abandon/upload race reservation must begin',
);
const abandonRaceUploader = startSession('authenticated', IDS.owner);
abandonRaceUploader.write(`INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${abandonRacePath}'); SELECT 'ABANDON_UPLOAD_HELD';`);
await waitFor(abandonRaceUploader, 'ABANDON_UPLOAD_HELD');
const abandonRaceWaiter = startSession('authenticated', IDS.owner);
abandonRaceWaiter.write(`${abandonMutationSql(
  RACES.abandonOperation,
  IDS.abandonRaceRecord,
  IDS.owner,
  IDS.couple,
)}; COMMIT; SELECT 'ABANDON_DONE';`);
await expectSessionBlocked(abandonRaceWaiter, 'ABANDON_DONE', 'abandon versus in-flight reserved upload');
abandonRaceUploader.write('COMMIT;');
abandonRaceUploader.close();
await waitFor(abandonRaceWaiter, 'ABANDON_DONE');
abandonRaceWaiter.close();
await waitForExit(abandonRaceUploader);
await waitForExit(abandonRaceWaiter);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', mutation.state, media.state,
      (media.storage_object_id = object.id)::text)
    FROM public.record_media_mutations AS mutation
    JOIN public.record_media_objects AS media
      ON media.reservation_operation_id = mutation.operation_id
    JOIN storage.objects AS object ON object.name = '${abandonRacePath}'
    WHERE mutation.operation_id = '${RACES.abandonOperation}'`), 'read abandon/upload fence outcome'),
  'abandoned|cleanup_pending|true',
  'abandon must drain the upload and queue its exact immutable Storage object',
);
expectOk(
  sql(`DELETE FROM storage.objects WHERE name = '${abandonRacePath}'`),
  'remove abandoned v0 object before stable-id reuse probe',
);
expectFail(
  asActor('authenticated', IDS.owner, `INSERT INTO storage.objects(bucket_id, name)
    VALUES ('couple-media', '${abandonRacePath}')`),
  'v0 tombstoned stable object upload reuse',
  /media_upload_reservation_required/i,
);

const expiryRacePath = `${IDS.couple}/${IDS.expiryRaceRecord}/${RACES.expiryMedia}.jpg`;
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: RACES.expiryOperation,
    recordId: IDS.expiryRaceRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 1,
    mediaIds: [RACES.expiryMedia],
  })), 'begin expiry/upload race').split('\n').at(-1),
  'pending',
  'expiry/upload race reservation must begin',
);
expectOk(sql(`UPDATE public.record_media_mutations
  SET created_at = clock_timestamp() - interval '16 minutes'
  WHERE operation_id = '${RACES.expiryOperation}'`), 'age expiry race mutation');
const expiryRaceUploader = startSession('authenticated', IDS.owner);
expiryRaceUploader.write(`INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${expiryRacePath}'); SELECT 'EXPIRY_UPLOAD_HELD';`);
await waitFor(expiryRaceUploader, 'EXPIRY_UPLOAD_HELD');
const expiryRaceWaiter = startSession('service_role', null);
expiryRaceWaiter.write(`SELECT public.expire_stale_record_media_mutation()::text;
  COMMIT; SELECT 'EXPIRY_DONE';`);
await expectSessionBlocked(expiryRaceWaiter, 'EXPIRY_DONE', 'expiry versus in-flight reserved upload');
expiryRaceUploader.write('COMMIT;');
expiryRaceUploader.close();
await waitFor(expiryRaceWaiter, 'EXPIRY_DONE');
expiryRaceWaiter.close();
await waitForExit(expiryRaceUploader);
await waitForExit(expiryRaceWaiter);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', mutation.state, media.state,
      (media.storage_object_id = object.id)::text)
    FROM public.record_media_mutations AS mutation
    JOIN public.record_media_objects AS media
      ON media.reservation_operation_id = mutation.operation_id
    JOIN storage.objects AS object ON object.name = '${expiryRacePath}'
    WHERE mutation.operation_id = '${RACES.expiryOperation}'`), 'read expiry/upload fence outcome'),
  'abandoned|cleanup_pending|true',
  'expiry must drain the upload and queue its exact immutable Storage object',
);

const commitRacePath = `${IDS.couple}/${IDS.commitRaceRecord}/${RACES.commitMedia}.jpg`;
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: RACES.commitOperation,
    recordId: IDS.commitRaceRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 1,
    mediaIds: [RACES.commitMedia],
  })), 'begin commit/upload race').split('\n').at(-1),
  'pending',
  'commit/upload race reservation must begin',
);
const commitRaceUploader = startSession('authenticated', IDS.owner);
commitRaceUploader.write(`INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${commitRacePath}'); SELECT 'COMMIT_UPLOAD_HELD';`);
await waitFor(commitRaceUploader, 'COMMIT_UPLOAD_HELD');
const commitRaceWaiter = startSession('authenticated', IDS.owner);
commitRaceWaiter.write(`UPDATE public.daily_records
  SET content_revision = 2, last_media_operation_id = '${RACES.commitOperation}'
  WHERE id = '${IDS.commitRaceRecord}'; COMMIT; SELECT 'MEDIA_COMMIT_DONE';`);
await expectSessionBlocked(commitRaceWaiter, 'MEDIA_COMMIT_DONE', 'record commit versus in-flight reserved upload');
commitRaceUploader.write('COMMIT;');
commitRaceUploader.close();
await waitFor(commitRaceWaiter, 'MEDIA_COMMIT_DONE');
commitRaceWaiter.close();
await waitForExit(commitRaceUploader);
await waitForExit(commitRaceWaiter);
expectEqual(
  expectOk(sql(`SELECT concat_ws('|', record.media_contract_version,
      mutation.state, media.state, (media.storage_object_id = object.id)::text)
    FROM public.daily_records AS record
    JOIN public.record_media_mutations AS mutation
      ON mutation.operation_id = record.last_media_operation_id
    JOIN public.record_media_objects AS media
      ON media.reservation_operation_id = mutation.operation_id
    JOIN storage.objects AS object ON object.name = '${commitRacePath}'
    WHERE record.id = '${IDS.commitRaceRecord}'`), 'read commit/upload fence outcome'),
  '1|committed|active|true',
  'record CAS must drain response-lost Storage INSERT and bind it exactly once',
);

const deleteFirstPath = `${IDS.couple}/${IDS.deleteFirstRecord}/${RACES.deleteMedia}.jpg`;
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, beginMutationSql({
    operationId: RACES.deleteOperation,
    recordId: IDS.deleteFirstRecord,
    userId: IDS.owner,
    coupleId: IDS.couple,
    baseRevision: 1,
    mediaIds: [RACES.deleteMedia],
  })), 'begin delete-first reservation').split('\n').at(-1),
  'pending',
  'delete-first race reservation must begin',
);
const deleteFirstDeleter = startSession('authenticated', IDS.owner);
deleteFirstDeleter.write(`SELECT public.delete_my_record(
  '${IDS.deleteFirstRecord}', '${IDS.owner}', '${IDS.couple}')::text;
  SELECT 'DELETE_PREFIX_HELD';`);
await waitFor(deleteFirstDeleter, 'DELETE_PREFIX_HELD');
const deleteFirstUploader = startSession('authenticated', IDS.owner);
deleteFirstUploader.write(`INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${deleteFirstPath}'); COMMIT; SELECT 'LATE_UPLOAD_DONE';`);
deleteFirstUploader.close();
await expectSessionBlocked(
  deleteFirstUploader,
  'LATE_UPLOAD_DONE',
  'late upload versus uncommitted retired-prefix tombstone',
);
deleteFirstDeleter.write('COMMIT;');
deleteFirstDeleter.close();
await waitForExit(deleteFirstDeleter);
const lateUploadOutput = await waitForExit(deleteFirstUploader);
if (!/record_id_retired_for_media_cleanup/i.test(lateUploadOutput.stderr)) {
  throw new Error(`late upload failed for the wrong reason: ${JSON.stringify(lateUploadOutput)}`);
}
checks += 1;
expectEqual(
  expectOk(sql(`SELECT concat_ws('|',
      (SELECT count(*) FROM public.daily_records WHERE id = '${IDS.deleteFirstRecord}'),
      (SELECT count(*) FROM storage.objects WHERE name = '${deleteFirstPath}'),
      (SELECT count(*) FROM public.record_media_cleanup_jobs
        WHERE record_id = '${IDS.deleteFirstRecord}'))`), 'read delete-first/late-upload outcome'),
  '0|0|1',
  'late upload must resume after deletion and reject the retired record prefix',
);

const scopeHoldPath = `${IDS.couple}/${IDS.scopeHoldRecord}/${RACES.scopeMedia}.jpg`;
const scopeHoldUploader = startSession('authenticated', IDS.owner);
scopeHoldUploader.write(`INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${scopeHoldPath}'); SELECT 'SCOPE_UPLOAD_HELD';`);
await waitFor(scopeHoldUploader, 'SCOPE_UPLOAD_HELD');
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, `SET LOCAL statement_timeout = '750ms';
    ${beginMutationSql({
      operationId: RACES.scopeOperation,
      recordId: IDS.scopeOtherRecord,
      userId: IDS.owner,
      coupleId: IDS.couple,
      baseRevision: 1,
    })}`), 'begin on unrelated record while Storage writer is held').split('\n').at(-1),
  'pending',
  'record-scoped fencing must not serialize unrelated record operations',
);
scopeHoldUploader.write('COMMIT;');
scopeHoldUploader.close();
await waitForExit(scopeHoldUploader);
expectEqual(
  expectOk(asActor('authenticated', IDS.owner, abandonMutationSql(
    RACES.scopeOperation,
    IDS.scopeOtherRecord,
    IDS.owner,
    IDS.couple,
  )), 'abandon unrelated scope probe').split('\n').at(-1),
  'abandoned',
  'unrelated scope probe must remain safely abandonable',
);

// The 083 account-close wrapper calls 084's replacement assertion. Both
// retryable cleanup_pending and terminal blocked exact-object work must stop
// relationship/Auth destruction until an operator resolves the object.
const accountPath = `${IDS.lifecycleAccountCouple}/${IDS.lifecycleAccountRecord}/${RACES.accountMedia}.jpg`;
expectOk(asActor('authenticated', IDS.lifecycleAccountUser, `INSERT INTO storage.objects(bucket_id, name)
  VALUES ('couple-media', '${accountPath}')`), 'insert account-close legacy media');
expectOk(asActor('authenticated', IDS.lifecycleAccountUser, beginMutationSql({
  operationId: RACES.accountAdoptOperation,
  recordId: IDS.lifecycleAccountRecord,
  userId: IDS.lifecycleAccountUser,
  coupleId: IDS.lifecycleAccountCouple,
  baseRevision: 1,
  paths: [accountPath],
})), 'begin account-close media adoption');
expectOk(asActor('authenticated', IDS.lifecycleAccountUser, `UPDATE public.daily_records
  SET content_revision = 2, last_media_operation_id = '${RACES.accountAdoptOperation}'
  WHERE id = '${IDS.lifecycleAccountRecord}'`), 'commit account-close media adoption');
expectOk(asActor('authenticated', IDS.lifecycleAccountUser, beginMutationSql({
  operationId: RACES.accountRemoveOperation,
  recordId: IDS.lifecycleAccountRecord,
  userId: IDS.lifecycleAccountUser,
  coupleId: IDS.lifecycleAccountCouple,
  baseRevision: 2,
})), 'begin account-close logical removal');
expectOk(asActor('authenticated', IDS.lifecycleAccountUser, `UPDATE public.daily_records
  SET content_revision = 3, last_media_operation_id = '${RACES.accountRemoveOperation}'
  WHERE id = '${IDS.lifecycleAccountRecord}'`), 'commit account-close logical removal');
expectOk(sql(`INSERT INTO public.account_deletion_requests(user_id, attempt_id, phase)
  VALUES ('${IDS.lifecycleAccountUser}', '${LIFECYCLE.accountAttempt}', 'relational_prepared')`), 'install lifecycle account-close request');
expectFail(
  asActor('service_role', null, `SELECT public.close_account_relationship_generations_v2(
    '${IDS.lifecycleAccountUser}', '${LIFECYCLE.accountAttempt}')`),
  'account close with cleanup_pending object work',
  /record_media_cleanup_pending/i,
);
expectOk(sql(`UPDATE public.record_media_objects
  SET state = 'blocked', failure_count = 8, last_error_code = 'E_STORAGE_BLOCKED'
  WHERE media_object_id = '${RACES.accountMedia}'`), 'mark account-close object blocked');
expectFail(
  asActor('service_role', null, `SELECT public.close_account_relationship_generations_v2(
    '${IDS.lifecycleAccountUser}', '${LIFECYCLE.accountAttempt}')`),
  'account close with blocked object work',
  /record_media_cleanup_pending/i,
);
expectEqual(
  expectOk(sql(`SELECT (closed_at IS NULL)::text FROM public.couples
    WHERE id = '${IDS.lifecycleAccountCouple}'`), 'read lifecycle relationship after cleanup barriers'),
  'true',
  'pending and blocked object work must leave the relationship open',
);

console.log(`PASS — record/media cleanup PostgreSQL actor/race harness: ${checks} assertions`);
