import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripSqlComments } from '@/test/sqlModel';

type CommandResult = { status: number | null; stdout: string; stderr: string };

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/076_account_deletion_write_fence.sql',
);
let migration = '';
try {
  migration = readFileSync(migrationPath, 'utf8');
} catch {
  // A missing migration is the required pre-implementation RED state.
}

const PRIVATE_HELPERS = [
  'lock_account_write_scope(uuid[],boolean)',
  'account_write_scope_has_pending(uuid[],boolean)',
  'assert_account_write_open(uuid[],boolean)',
  'open_trusted_account_write_capability(uuid[],boolean)',
  'open_account_deletion_write_capability(uuid,uuid,text[])',
  'close_account_write_capability(uuid)',
  'has_account_write_capability()',
  'enforce_account_deletion_write_statement()',
  'enforce_account_deletion_write_row()',
] as const;

const WRAPPED_RPC_NAMES = [
  'reorder_trip_items',
  'save_couple_highlight',
  'set_partner_username',
  'e2ee_start_couple_pairing',
  'e2ee_confirm_couple_pairing',
  'e2ee_mark_couple_pairing_active',
  'register_push_token',
  'clear_my_unseen',
  'grant_cycle_sensitive_consent',
  'activate_e2ee_write_floor',
  'e2ee_begin_device_provisioning',
  'e2ee_finalize_device_provisioning',
  'e2ee_mark_epoch_ready',
  'e2ee_activate_epoch',
  'e2ee_abandon_epoch',
  'e2ee_revoke_own_device',
  'e2ee_mark_device_provisioning_failed',
  'e2ee_commit_device_approval',
  'e2ee_issue_recovery_challenge',
  'e2ee_commit_recovery_authentication',
  'push_delivery_candidates',
  'mark_push_delivered',
  'release_push_claim',
  'revoke_my_push_tokens',
  'e2ee_prepare_account_deletion_v2',
  'prepare_account_deletion_v2',
  'close_account_relationship_generations_v2',
  'cleanup_account_solo_couples_v2',
] as const;

const RELATIONSHIP_BOUNDARY_RPCS = [
  'create_invitation',
  'create_couple_and_invitation',
  'create_couple_and_invitation_v2',
  'redeem_invitation',
  'redeem_invitation_v2',
  'regenerate_invitation',
  'disconnect_couple',
] as const;

const EXPOSED_MUTATOR_BOUNDARIES = [
  'begin_account_deletion_v2(uuid,uuid[],uuid)',
  'cancel_account_deletion_v2(uuid,uuid)',
  'create_couple_and_invitation(text,text)',
  'create_couple_and_invitation_v2(text,text,text)',
  'create_invitation(uuid,text)',
  'disconnect_couple()',
  'grant_cycle_sensitive_consent(uuid,bigint,text)',
  'push_delivery_candidates(uuid,timestamp with time zone,integer)',
  'redeem_invitation(text)',
  'redeem_invitation_v2(text,text)',
  'regenerate_invitation(text)',
  'revoke_cycle_sensitive_consent(uuid)',
] as const;

const PROTECTED_TABLES = [
  'public.profiles',
  'public.contact_preferences',
  'public.product_events',
  'public.cycle_periods',
  'public.cycle_daily_logs',
  'public.cycle_settings',
  'public.cycle_entries',
  'public.legacy_cycle_entries_backup',
  'public.user_sensitive_consents',
  'public.cycle_sharing_preferences',
  'public.cycle_support_signals',
  'public.device_push_tokens',
  'public.push_delivery_state',
  'public.recovery_identities',
  'public.recovery_public_anchors',
  'public.devices',
  'public.device_certificates',
  'public.device_enrollments',
  'public.recovery_challenges',
  'public.revocation_statements',
  'public.migration_ledger',
  'public.scope_keys',
  'public.key_envelopes',
  'public.crypto_write_floor',
  'public.couples',
  'public.couple_members',
  'public.invitation_codes',
  'public.invitation_attempts',
  'public.daily_records',
  'public.briefings',
  'public.events',
  'public.trips',
  'public.trip_items',
  'public.trip_checklists',
  'public.couple_tasks',
  'public.talk_about_marks',
  'public.collaboration_invalidations',
  'public.crypto_pairings',
  'public.diary_pages',
  'public.couple_highlights',
  'public.couple_highlight_items',
  'storage.objects',
] as const;

describe('migration 076 static account-deletion write-fence contract', () => {
  it('exists, is transactional and forward-only, and reloads PostgREST after commit', () => {
    expect(migration.length, 'migration 076 must exist').toBeGreaterThan(0);
    const executable = stripSqlComments(migration);
    expect(executable).toMatch(/^\s*BEGIN\s*;/i);
    expect(executable).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(executable).not.toMatch(
      /\bDELETE\s+FROM\s+(?!public\.account_deletion_write_capabilities\b)/i,
    );
    expect(executable).toMatch(/\bCOMMIT\s*;/i);
    expect(executable).toMatch(/NOTIFY\s+pgrst\s*,\s*'reload schema'\s*;/i);
    expect(executable.indexOf('COMMIT;')).toBeLessThan(executable.indexOf('NOTIFY pgrst'));
    expect(executable).toContain('migration_076_already_applied');
  });

  it('implements 074 lock order and a fixed denial without logging identifiers', () => {
    const executable = stripSqlComments(migration);
    const lockStart = executable.indexOf('FUNCTION public.lock_account_write_scope');
    const lockEnd = executable.indexOf('FUNCTION public.account_write_scope_has_pending');
    const lockBody = executable.slice(lockStart, lockEnd);
    const ordered = [
      lockBody.indexOf('v_couples_before'),
      lockBody.indexOf('v_participants_before'),
      lockBody.indexOf('15013'),
      lockBody.indexOf('account_deletion_requests'),
      lockBody.indexOf('ORDER BY relationship.id'),
      lockBody.lastIndexOf('v_participants_after'),
    ];
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(lockBody).toMatch(/FOR UPDATE/i);
    expect(executable).toMatch(
      /ERRCODE\s*=\s*'42501'[\s\S]*MESSAGE\s*=\s*'account_deletion_pending'/i,
    );
    expect(executable).not.toMatch(/RAISE\s+(?:NOTICE|LOG|WARNING|INFO)/i);
  });

  it('uses private SECURITY DEFINER helpers and a non-forgeable capability row', () => {
    const executable = stripSqlComments(migration);
    const compacted = executable.replace(/\s+/g, '').toLowerCase();
    expect(executable).toMatch(/CREATE TABLE public\.account_deletion_write_capabilities/i);
    expect(executable).toMatch(/backend_pid[\s\S]*transaction_id[\s\S]*capability_id/i);
    expect(executable).toMatch(
      /ALTER TABLE public\.account_deletion_write_capabilities ENABLE ROW LEVEL SECURITY/i,
    );
    expect(executable).toMatch(
      /REVOKE ALL ON TABLE public\.account_deletion_write_capabilities\s+FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(executable).not.toMatch(/current_setting\('gomsinlog\.[^']*capabil/i);
    for (const helper of PRIVATE_HELPERS) {
      const name = helper.slice(0, helper.indexOf('('));
      expect(executable).toContain(`FUNCTION public.${name}`);
      expect(compacted).toContain(`functionpublic.${helper}`);
    }
  });

  it('puts locking in BEFORE STATEMENT and exact exceptions in BEFORE ROW', () => {
    const executable = stripSqlComments(migration);
    expect(executable).toMatch(
      /BEFORE INSERT OR UPDATE OR DELETE[\s\S]*FOR EACH STATEMENT[\s\S]*enforce_account_deletion_write_statement/i,
    );
    expect(executable).toMatch(
      /BEFORE INSERT OR UPDATE OR DELETE[\s\S]*FOR EACH ROW[\s\S]*enforce_account_deletion_write_row/i,
    );
    expect(executable).toContain('TG_ARGV[0]');
    expect(executable).toContain('user_sensitive_consents');
    expect(executable).toContain('cycle_sharing_preferences');
    expect(executable).toContain('PROVISIONING_FAILED');
    expect(executable).toContain('ABANDONED');
    expect(executable).toContain('revocation_statements');
  });

  it('wraps pre-lock mutators while preserving 074/075 relationship functions', () => {
    const executable = stripSqlComments(migration);
    for (const name of WRAPPED_RPC_NAMES) {
      expect(executable).toContain(`${name}_internal_076`);
    }
    for (const name of RELATIONSHIP_BOUNDARY_RPCS) {
      expect(executable).not.toContain(`${name}_internal_076`);
    }
    expect(executable).not.toContain('15014');
    expect(executable).not.toMatch(
      /CREATE(?: OR REPLACE)? FUNCTION public\.lock_relationship_mutation_boundary/i,
    );
  });
});

function command(file: string, args: string[], input?: string): CommandResult {
  const result = spawnSync(file, args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function postgresBinDirectory(): string | null {
  const configured = command('pg_config', ['--bindir']);
  const fromConfig = configured.status === 0 ? configured.stdout.trim() : '';
  if (fromConfig && existsSync(join(fromConfig, 'initdb'))) return fromConfig;
  const candidates = [
    '/opt/homebrew/opt/postgresql@17/bin',
    '/usr/local/opt/postgresql@17/bin',
  ];
  if (existsSync('/usr/lib/postgresql')) {
    const versions = readdirSync('/usr/lib/postgresql').sort((left, right) => (
      Number.parseInt(right, 10) - Number.parseInt(left, 10)
    ));
    candidates.push(...versions.map((version) => `/usr/lib/postgresql/${version}/bin`));
  }
  return candidates.find((candidate) => existsSync(join(candidate, 'initdb'))) ?? null;
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not reserve a PostgreSQL test port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

const PG_BIN = postgresBinDirectory();
const describePostgres = PG_BIN ? describe : describe.skip;

const SUPABASE_STUB = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
  $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $fn$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
  $fn$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $fn$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT NOT NULL,
  owner UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated;
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE AS
$fn$
DECLARE parts TEXT[];
BEGIN
  SELECT string_to_array(name, '/') INTO parts;
  RETURN parts[1:array_length(parts, 1) - 1];
END
$fn$;
CREATE PUBLICATION supabase_realtime;
`;

const PRE_002_RECURSION_DROPS = `
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;
DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;
`;

const U = {
  deleting: '76000000-0000-4000-8000-000000000001',
  partner: '76000000-0000-4000-8000-000000000002',
  former: '76000000-0000-4000-8000-000000000003',
  formerDeleting: '76000000-0000-4000-8000-000000000004',
  inviterDeleting: '76000000-0000-4000-8000-000000000005',
  invitee: '76000000-0000-4000-8000-000000000006',
  personalDeleting: '76000000-0000-4000-8000-000000000007',
  pipeline: '76000000-0000-4000-8000-000000000008',
  cancellation: '76000000-0000-4000-8000-000000000009',
  writerFirst: '76000000-0000-4000-8000-000000000010',
  markerFirst: '76000000-0000-4000-8000-000000000011',
  serviceDirect: '76000000-0000-4000-8000-000000000012',
  storageDeleting: '76000000-0000-4000-8000-000000000013',
  storagePartner: '76000000-0000-4000-8000-000000000014',
  consentWriterFirst: '76000000-0000-4000-8000-000000000015',
  consentMarkerFirst: '76000000-0000-4000-8000-000000000016',
  tombstoneDeleting: '76000000-0000-4000-8000-000000000017',
} as const;

const ID = {
  couple: '76100000-0000-4000-8000-000000000001',
  formerCouple: '76100000-0000-4000-8000-000000000002',
  inviteCouple: '76100000-0000-4000-8000-000000000003',
  storageCouple: '76100000-0000-4000-8000-000000000004',
  deletingRecord: '76200000-0000-4000-8000-000000000001',
  partnerRecord: '76200000-0000-4000-8000-000000000002',
  storageRecord: '76200000-0000-4000-8000-000000000003',
  storageDeletingRecord: '76200000-0000-4000-8000-000000000004',
  deletingMedia: '76300000-0000-4000-8000-000000000001',
  partnerMedia: '76300000-0000-4000-8000-000000000002',
  storageDeletingMedia: '76300000-0000-4000-8000-000000000003',
  deviceRevoke: '76400000-0000-4000-8000-000000000001',
  deviceFail: '76400000-0000-4000-8000-000000000002',
  challengeDevice: '76400000-0000-4000-8000-000000000003',
  epochAbandon: '76500000-0000-4000-8000-000000000001',
  epochMixed: '76500000-0000-4000-8000-000000000002',
  epochReady: '76500000-0000-4000-8000-000000000003',
  pairing: '76600000-0000-4000-8000-000000000001',
  challenge: '76700000-0000-4000-8000-000000000001',
  recoveryIdentity: '76800000-0000-4000-8000-000000000001',
  pipelineAttempt: '76900000-0000-4000-8000-000000000001',
  cancelAttempt: '76900000-0000-4000-8000-000000000002',
  deletingAttempt: '76900000-0000-4000-8000-000000000003',
  formerAttempt: '76900000-0000-4000-8000-000000000004',
  inviterAttempt: '76900000-0000-4000-8000-000000000005',
  personalAttempt: '76900000-0000-4000-8000-000000000006',
  serviceAttempt: '76900000-0000-4000-8000-000000000007',
  writerAttempt: '76900000-0000-4000-8000-000000000008',
  markerAttempt: '76900000-0000-4000-8000-000000000009',
  storageAttempt: '76900000-0000-4000-8000-000000000010',
  consentWriterAttempt: '76900000-0000-4000-8000-000000000011',
  consentMarkerAttempt: '76900000-0000-4000-8000-000000000012',
  tombstoneAttempt: '76900000-0000-4000-8000-000000000013',
} as const;

const INVITE_HASH = '76'.repeat(32);

describePostgres.sequential('migration 076 PostgreSQL 17 integration', () => {
  let root = '';
  let dataDirectory = '';
  let socketDirectory = '';
  let port = 0;

  const psqlArgs = () => [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-h', socketDirectory,
    '-p', String(port),
    '-U', 'postgres',
    '-d', 'postgres',
  ];
  const sql = (source: string): CommandResult => command(
    join(PG_BIN!, 'psql'),
    psqlArgs(),
    source,
  );
  const expectSql = (source: string, label = 'SQL'): string => {
    const result = sql(source);
    expect(result.status, `${label}: ${result.stderr}`).toBe(0);
    return result.stdout.trim();
  };
  const asActor = (
    role: 'anon' | 'authenticated' | 'service_role',
    userId: string | null,
    statement: string,
  ): CommandResult => sql(`
\\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE ${role};
SET LOCAL "request.jwt.claim.role" = '${role}';
${userId ? `SET LOCAL "request.jwt.claim.sub" = '${userId}';` : ''}
${statement}
COMMIT;
`);
  const asUser = (userId: string, statement: string): CommandResult => (
    asActor('authenticated', userId, statement)
  );
  const asService = (statement: string): CommandResult => (
    asActor('service_role', null, statement)
  );
  const expectUser = (userId: string, statement: string): string => {
    const result = asUser(userId, statement);
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const expectService = (statement: string): string => {
    const result = asService(statement);
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const expectFence = (result: CommandResult): void => {
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('42501');
    expect(result.stderr).toContain('account_deletion_pending');
  };
  const beginDeletion = (
    userId: string,
    attemptId: string,
    records = "'{}'::uuid[]",
  ) => expectService(
    `SELECT public.begin_account_deletion_v2('${userId}', ${records}, '${attemptId}');`,
  );
  const asyncSql = (source: string): Promise<CommandResult> => new Promise((resolveRun) => {
    const child = spawn(join(PG_BIN!, 'psql'), psqlArgs(), {
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
    child.stdin.end(source);
  });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'gomsinlog-076-'));
    dataDirectory = join(root, 'data');
    socketDirectory = join(root, 'socket');
    mkdirSync(socketDirectory);
    port = await freePort();

    const initialized = command(join(PG_BIN!, 'initdb'), [
      '--no-sync', '--auth-local=trust', '--auth-host=trust',
      '--encoding=UTF8', '--locale=C', '--username=postgres', '-D', dataDirectory,
    ]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = command(join(PG_BIN!, 'pg_ctl'), [
      '-D', dataDirectory,
      '-o', `-F -k ${socketDirectory} -p ${port} -c listen_addresses=''`,
      '-l', join(root, 'postgres.log'), '-w', 'start',
    ]);
    expect(started.status, started.stderr).toBe(0);

    expectSql(SUPABASE_STUB, 'Supabase stub');
    const migrationsDirectory = resolve(process.cwd(), 'supabase/migrations');
    const predecessors = readdirSync(migrationsDirectory)
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .filter((file) => Number.parseInt(file.slice(0, 3), 10) <= 75)
      .sort();
    for (const file of predecessors) {
      if (file === '002_fix_rls_recursion.sql') {
        expectSql(PRE_002_RECURSION_DROPS, 'fresh-chain 002 policy bridge');
      }
      expectSql(readFileSync(join(migrationsDirectory, file), 'utf8'), file);
    }

    const users = Object.values(U);
    const userRows = users
      .map((userId, index) => `('${userId}', 'migration076-${index}@example.test')`)
      .join(',\n');
    const profileRows = users
      .map((userId, index) => `('${userId}', 'User ${index}', 'gomsin', 'm076user${index}')`)
      .join(',\n');
    expectSql(`
INSERT INTO auth.users (id, email) VALUES ${userRows};
INSERT INTO public.profiles (id, display_name, role, username) VALUES ${profileRows};
INSERT INTO public.couples (id, relationship_context, closed_at) VALUES
  ('${ID.couple}', 'general', NULL),
  ('${ID.formerCouple}', 'general', now()),
  ('${ID.inviteCouple}', 'general', NULL),
  ('${ID.storageCouple}', 'general', NULL);
INSERT INTO public.couple_members (couple_id, user_id, role, status) VALUES
  ('${ID.couple}', '${U.deleting}', 'gomsin', 'active'),
  ('${ID.couple}', '${U.partner}', 'soldier', 'active'),
  ('${ID.formerCouple}', '${U.former}', 'gomsin', 'disconnected'),
  ('${ID.formerCouple}', '${U.formerDeleting}', 'soldier', 'disconnected'),
  ('${ID.inviteCouple}', '${U.inviterDeleting}', 'gomsin', 'active'),
  ('${ID.storageCouple}', '${U.storageDeleting}', 'gomsin', 'active'),
  ('${ID.storageCouple}', '${U.storagePartner}', 'soldier', 'active');
INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
VALUES ('${ID.inviteCouple}', '${INVITE_HASH}', '${U.inviterDeleting}');
INSERT INTO public.daily_records (id, user_id, couple_id, log_text, is_private) VALUES
  ('${ID.deletingRecord}', '${U.deleting}', '${ID.couple}', 'owner-before-marker', false),
  ('${ID.partnerRecord}', '${U.partner}', '${ID.couple}', 'partner-before-marker', false),
  ('${ID.storageRecord}', '${U.storagePartner}', '${ID.storageCouple}', 'storage-race', false),
  ('${ID.storageDeletingRecord}', '${U.storageDeleting}', '${ID.storageCouple}', 'storage-delete', false);
INSERT INTO storage.objects (id, bucket_id, name, owner) VALUES
  ('${ID.deletingMedia}', 'couple-media', '${ID.couple}/${ID.deletingRecord}/owner.jpg', '${U.deleting}'),
  ('${ID.partnerMedia}', 'couple-media', '${ID.couple}/${ID.partnerRecord}/partner.jpg', '${U.partner}'),
  ('${ID.storageDeletingMedia}', 'couple-media', '${ID.storageCouple}/${ID.storageDeletingRecord}/cleanup.jpg', '${U.storageDeleting}');
INSERT INTO public.user_sensitive_consents
  (user_id, consent_type, version, granted_at, revoked_at, revision)
VALUES ('${U.personalDeleting}', 'cycle', '2026-08-09', now(), NULL, 1);
INSERT INTO public.cycle_sharing_preferences
  (user_id, share_current_period, share_prediction_window, share_fertility_window)
VALUES ('${U.personalDeleting}', false, false, false);
INSERT INTO public.device_push_tokens (user_id, platform, token)
VALUES ('${U.personalDeleting}', 'ios', 'm076-token');
INSERT INTO public.devices (id, user_id, sig_spki, kem_spki, platform, assurance, status) VALUES
  ('${ID.deviceRevoke}', '${U.personalDeleting}', decode(repeat('01',91),'hex'), decode(repeat('02',91),'hex'), 'ios', 'secure_enclave', 'PENDING'),
  ('${ID.deviceFail}', '${U.personalDeleting}', decode(repeat('03',91),'hex'), decode(repeat('04',91),'hex'), 'ios', 'secure_enclave', 'PENDING'),
  ('${ID.challengeDevice}', '${U.personalDeleting}', decode(repeat('05',91),'hex'), decode(repeat('06',91),'hex'), 'ios', 'secure_enclave', 'PENDING');
INSERT INTO public.scope_keys (id, domain, scope_id, owner_user_id, key_epoch, state) VALUES
  ('${ID.epochAbandon}', 'personal', '${U.personalDeleting}', '${U.personalDeleting}', 1, 'PREPARING'),
  ('${ID.epochMixed}', 'health', '${U.personalDeleting}', '${U.personalDeleting}', 1, 'PREPARING'),
  ('${ID.epochReady}', 'personal', '${U.personalDeleting}', '${U.personalDeleting}', 2, 'READY');
INSERT INTO public.recovery_challenges
  (id, user_id, recovery_identity_id, recovery_version, new_device_id, challenge_nonce, issued_at, expires_at)
VALUES
  ('${ID.challenge}', '${U.personalDeleting}', '${ID.recoveryIdentity}', 1, '${ID.challengeDevice}', decode(repeat('07',32),'hex'), now(), now() + interval '10 minutes');
INSERT INTO public.crypto_pairings
  (id, couple_id, state, pairing_nonce, transcript, transcript_hash, proposed_by_user_id, expires_at)
VALUES
  ('${ID.pairing}', '${ID.couple}', 'TRANSCRIPT_PROPOSED', decode(repeat('08',32),'hex'), decode(repeat('09',440),'hex'), decode(repeat('0a',32),'hex'), '${U.partner}', now() + interval '5 minutes');
`, 'migration 076 fixtures');

    expectSql(migration, 'migration 076');
  }, 90_000);

  afterAll(() => {
    if (dataDirectory && PG_BIN) {
      command(join(PG_BIN, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('applies on full 001..075 under PostgreSQL 17 and fails closed on replay', () => {
    const version = Number(expectSql('SHOW server_version_num;'));
    expect(version).toBeGreaterThanOrEqual(170_000);
    expect(version).toBeLessThan(180_000);
    const replay = sql(migration);
    expect(replay.status).not.toBe(0);
    expect(replay.stderr).toContain('migration_076_already_applied');
    expect(expectSql(
      "SELECT to_regprocedure('public.lock_account_write_scope(uuid[],boolean)') IS NOT NULL;",
    )).toBe('t');
  });

  it('keeps helpers private and covers authenticated writable and required tables', () => {
    for (const helper of PRIVATE_HELPERS) {
      expect(expectSql(`
SELECT NOT has_function_privilege('anon', 'public.${helper}', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.${helper}', 'EXECUTE')
   AND NOT has_function_privilege('service_role', 'public.${helper}', 'EXECUTE');
`), helper).toBe('t');
    }
    expect(expectSql(`
SELECT NOT has_table_privilege(
         'anon', 'public.account_deletion_write_capabilities', 'SELECT,INSERT,UPDATE,DELETE'
       )
   AND NOT has_table_privilege(
         'authenticated', 'public.account_deletion_write_capabilities', 'SELECT,INSERT,UPDATE,DELETE'
       )
   AND NOT has_table_privilege(
         'service_role', 'public.account_deletion_write_capabilities', 'SELECT,INSERT,UPDATE,DELETE'
       );
`)).toBe('t');

    expect(expectSql(`
SELECT count(*)
FROM pg_proc AS function
JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
WHERE namespace.nspname = 'public'
  AND function.proname LIKE '%\\_internal\\_076' ESCAPE '\\';
`)).toBe(String(WRAPPED_RPC_NAMES.length));
    expect(expectSql(`
SELECT count(*)
FROM pg_proc AS function
JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
WHERE namespace.nspname = 'public'
  AND function.proname LIKE '%\\_internal\\_076' ESCAPE '\\'
  AND (
    has_function_privilege('anon', function.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', function.oid, 'EXECUTE')
    OR has_function_privilege('service_role', function.oid, 'EXECUTE')
  );
`)).toBe('0');

    expect(expectSql(`
WITH mismatched AS (
  SELECT exposed.oid::regprocedure::text AS signature
  FROM pg_proc AS internal
  JOIN pg_namespace AS namespace ON namespace.oid = internal.pronamespace
  JOIN pg_proc AS exposed
    ON exposed.pronamespace = internal.pronamespace
   AND exposed.proname = replace(internal.proname, '_internal_076', '')
   AND exposed.proargtypes = internal.proargtypes
  WHERE namespace.nspname = 'public'
    AND internal.proname LIKE '%\\_internal\\_076' ESCAPE '\\'
    AND (
      exposed.prorettype IS DISTINCT FROM internal.prorettype
      OR exposed.proretset IS DISTINCT FROM internal.proretset
      OR exposed.proallargtypes IS DISTINCT FROM internal.proallargtypes
      OR exposed.proargmodes IS DISTINCT FROM internal.proargmodes
      OR exposed.proargnames IS DISTINCT FROM internal.proargnames
      OR exposed.pronargdefaults IS DISTINCT FROM internal.pronargdefaults
      OR pg_get_expr(exposed.proargdefaults, 0)
         IS DISTINCT FROM pg_get_expr(internal.proargdefaults, 0)
      OR exposed.provolatile IS DISTINCT FROM internal.provolatile
      OR exposed.proisstrict IS DISTINCT FROM internal.proisstrict
      OR exposed.proconfig IS DISTINCT FROM internal.proconfig
    )
)
SELECT COALESCE(string_agg(signature, ',' ORDER BY signature), '')
FROM mismatched;
`)).toBe('');

    expect(expectSql(`
WITH writable AS (
  SELECT n.nspname, c.relname, c.oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p')
    AND n.nspname IN ('public','storage')
    AND (
      has_table_privilege('authenticated', c.oid, 'INSERT')
      OR has_table_privilege('authenticated', c.oid, 'UPDATE')
    )
), missing AS (
  SELECT writable.*
  FROM writable
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = writable.oid
      AND t.tgname = 'aaa_076_account_write_statement'
      AND NOT t.tgisinternal
  )
)
SELECT count(*) FROM missing;
`)).toBe('0');

    for (const table of PROTECTED_TABLES) {
      expect(expectSql(`
SELECT count(*) = 2
FROM pg_trigger
WHERE tgrelid = '${table}'::regclass
  AND tgname IN ('aaa_076_account_write_statement','aaa_076_account_write_row')
  AND tgtype IN (30, 31)
  AND NOT tgisinternal;
`), table).toBe('t');
    }
  });

  it('classifies every externally executable SECURITY DEFINER mutator', () => {
    const exposedMutators = expectSql(`
SELECT function.oid::regprocedure::text
FROM pg_proc AS function
JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
WHERE namespace.nspname = 'public'
  AND function.prosecdef
  AND (
    has_function_privilege('authenticated', function.oid, 'EXECUTE')
    OR has_function_privilege('service_role', function.oid, 'EXECUTE')
  )
  AND function.prosrc ~* '(^|[^a-z_])(insert|update|delete|lock[[:space:]]+table)([^a-z_]|$)'
ORDER BY function.oid::regprocedure::text;
`);
    expect(exposedMutators.split('\n')).toEqual(EXPOSED_MUTATOR_BOUNDARIES);
  });

  it('denies owner INSERT, UPDATE, multi-row, upsert, CTE, and expansion RPC writes', () => {
    beginDeletion(U.personalDeleting, ID.personalAttempt);
    const gender = asUser(
      U.personalDeleting,
      "UPDATE public.profiles SET gender_identity='woman' WHERE id=auth.uid();",
    );
    expectFence(gender);
    expect(expectSql(
      `SELECT gender_identity IS NULL FROM public.profiles WHERE id='${U.personalDeleting}';`,
    )).toBe('t');

    const multi = asUser(U.personalDeleting, `
INSERT INTO public.product_events (user_id, kind, screen)
VALUES (auth.uid(), 'screen_view', 'home'), (auth.uid(), 'screen_view', 'diary');
`);
    expectFence(multi);
    expect(expectSql(
      `SELECT count(*) FROM public.product_events WHERE user_id='${U.personalDeleting}';`,
    )).toBe('0');

    const cteUpsert = asUser(U.personalDeleting, `
WITH attempted AS (
  INSERT INTO public.contact_preferences (user_id, weekday_start)
  VALUES (auth.uid(), time '17:00')
  ON CONFLICT (user_id) DO UPDATE SET weekday_start=excluded.weekday_start
  RETURNING user_id
)
SELECT count(*) FROM attempted;
`);
    expectFence(cteUpsert);
    expect(expectSql(
      `SELECT count(*) FROM public.contact_preferences WHERE user_id='${U.personalDeleting}';`,
    )).toBe('0');

    for (const statement of [
      "SELECT public.register_push_token('ios','replacement-token');",
      'SELECT public.clear_my_unseen();',
      `SELECT * FROM public.grant_cycle_sensitive_consent('${U.personalDeleting}',1,'2026-08-09');`,
      `SELECT public.e2ee_begin_device_provisioning('${ID.challengeDevice}');`,
      `SELECT public.e2ee_mark_epoch_ready('${ID.epochMixed}');`,
      `SELECT public.activate_e2ee_write_floor('user','${U.personalDeleting}','${ID.challengeDevice}');`,
    ]) {
      expectFence(asUser(U.personalDeleting, statement));
    }
  });

  it('blocks partner shared writes but leaves partner personal and former-user writes open', () => {
    beginDeletion(
      U.deleting,
      ID.deletingAttempt,
      `ARRAY['${ID.deletingRecord}'::uuid]`,
    );
    const shared = asUser(U.partner, `
INSERT INTO public.events (couple_id, created_by, title, event_type, start_date)
VALUES ('${ID.couple}', auth.uid(), 'blocked', 'anniversary', current_date);
`);
    expectFence(shared);
    expect(expectSql(
      `SELECT count(*) FROM public.events WHERE couple_id='${ID.couple}';`,
    )).toBe('0');

    const sharedDelete = asUser(
      U.partner,
      `DELETE FROM public.daily_records WHERE id='${ID.partnerRecord}';`,
    );
    expectFence(sharedDelete);
    expect(expectSql(
      `SELECT count(*) FROM public.daily_records WHERE id='${ID.partnerRecord}';`,
    )).toBe('1');

    expectUser(
      U.partner,
      "UPDATE public.profiles SET profile_caption='still mine' WHERE id=auth.uid();",
    );
    expect(expectSql(
      `SELECT profile_caption FROM public.profiles WHERE id='${U.partner}';`,
    )).toBe('still mine');

    beginDeletion(U.formerDeleting, ID.formerAttempt);
    expectUser(
      U.former,
      "UPDATE public.profiles SET profile_caption='former unaffected' WHERE id=auth.uid();",
    );
    expect(expectSql(
      `SELECT profile_caption FROM public.profiles WHERE id='${U.former}';`,
    )).toBe('former unaffected');
  });

  it('preserves 075 creation/gender and opaque redemption fencing', () => {
    expectUser(
      U.invitee,
      "UPDATE public.profiles SET gender_identity='woman' WHERE id=auth.uid();",
    );
    expect(expectSql(
      `SELECT gender_identity FROM public.profiles WHERE id='${U.invitee}';`,
    )).toBe('woman');

    const create = asUser(U.personalDeleting, `
SELECT public.create_couple_and_invitation_v2(
  'gomsin', '${'77'.repeat(32)}', 'general'
);
`);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain('42501');

    beginDeletion(U.inviterDeleting, ID.inviterAttempt);
    const redemption = JSON.parse(expectUser(U.invitee, `
SELECT public.redeem_invitation_v2('${INVITE_HASH}', 'general');
`));
    expect(redemption).toMatchObject({ ok: false, error_code: 'invalid_or_expired' });
    expect(expectSql(
      `SELECT used FROM public.invitation_codes WHERE code_hash='${INVITE_HASH}';`,
    )).toBe('f');
    expect(expectSql(
      `SELECT count(*) FROM public.couple_members WHERE user_id='${U.invitee}';`,
    )).toBe('0');
  });

  it('blocks non-FK E2EE orphan recreation and listed shared/service mutators', () => {
    const orphan = asUser(U.personalDeleting, `
INSERT INTO public.recovery_public_anchors
  (user_id, recovery_identity_id, recovery_version, rec_sig_spki, rec_sig_fp, recovery_bundle_fp)
VALUES
  (auth.uid(), gen_random_uuid(), 2, decode(repeat('11',91),'hex'),
   decode(repeat('12',32),'hex'), decode(repeat('13',32),'hex'));
`);
    expectFence(orphan);

    const calls: Array<[
      'authenticated' | 'service_role',
      string | null,
      string,
    ]> = [
      ['authenticated', U.partner, "SELECT public.reorder_trip_items('{}'::uuid[], '{}'::integer[]);"],
      ['authenticated', U.partner, "SELECT public.save_couple_highlight(NULL, 'blocked', '{}'::uuid[], 0);"],
      ['authenticated', U.partner, "SELECT public.set_partner_username('blocked_name');"],
      ['authenticated', U.partner, `SELECT public.e2ee_start_couple_pairing(
        '${ID.couple}', decode(repeat('01',32),'hex'), decode(repeat('02',440),'hex'),
        decode(repeat('03',32),'hex'), now(), now()+interval '5 minutes'
      );`],
      ['authenticated', U.partner, `SELECT public.e2ee_confirm_couple_pairing(
        '${ID.pairing}', '${ID.challengeDevice}', decode(repeat('04',64),'hex')
      );`],
      ['authenticated', U.partner, `SELECT public.e2ee_mark_couple_pairing_active(
        '${ID.pairing}', '${ID.epochMixed}'
      );`],
      ['service_role', null, `SELECT * FROM public.e2ee_issue_recovery_challenge(
        '${U.personalDeleting}','${ID.challengeDevice}',decode(repeat('05',32),'hex'),300
      );`],
      ['service_role', null, `SELECT public.e2ee_begin_device_provisioning(
        '${ID.challengeDevice}'
      );`],
      ['service_role', null, `SELECT public.e2ee_finalize_device_provisioning(
        '${ID.challengeDevice}'
      );`],
      ['service_role', null, `SELECT public.e2ee_commit_recovery_authentication(
        '${ID.challenge}','${ID.challengeDevice}','${ID.recoveryIdentity}',1::smallint
      );`],
      ['service_role', null, `SELECT public.e2ee_commit_device_approval(
        gen_random_uuid(),'${ID.challengeDevice}',decode(repeat('06',445),'hex'),
        decode(repeat('07',32),'hex'),decode(repeat('08',32),'hex'),
        decode(repeat('09',64),'hex'),'${U.personalDeleting}','${ID.recoveryIdentity}',
        1::smallint,decode(repeat('0a',91),'hex'),decode(repeat('0b',91),'hex'),gen_random_uuid()
      );`],
    ];
    for (const [role, user, statement] of calls) {
      expectFence(asActor(role, user, statement));
    }
  });

  it('allows exact one-way privacy reductions and rejects mixed mutations', () => {
    beginDeletion(U.tombstoneDeleting, ID.tombstoneAttempt);
    expectUser(
      U.tombstoneDeleting,
      `SELECT * FROM public.revoke_cycle_sensitive_consent('${U.tombstoneDeleting}');`,
    );
    expect(expectSql(`
SELECT version = '2026-08-09'
   AND revision = 1
   AND revoked_at IS NOT NULL
FROM public.user_sensitive_consents
WHERE user_id='${U.tombstoneDeleting}';
`)).toBe('t');

    expectUser(
      U.personalDeleting,
      `SELECT * FROM public.revoke_cycle_sensitive_consent('${U.personalDeleting}');`,
    );
    expect(expectSql(`
SELECT revoked_at IS NOT NULL
FROM public.user_sensitive_consents
WHERE user_id='${U.personalDeleting}';
`)).toBe('t');
    expectFence(asUser(U.personalDeleting, `
UPDATE public.user_sensitive_consents
SET revoked_at=now(), version='mixed-change'
WHERE user_id=auth.uid() AND consent_type='cycle';
`));
    expect(expectSql(`
SELECT version FROM public.user_sensitive_consents
WHERE user_id='${U.personalDeleting}';
`)).toBe('2026-08-09');

    expectUser(U.personalDeleting, `
UPDATE public.cycle_sharing_preferences
SET share_current_period=false, share_prediction_window=false,
    share_fertility_window=false, updated_at=now()
WHERE user_id=auth.uid();
`);
    expect(expectSql(`
SELECT NOT share_current_period
   AND NOT share_prediction_window
   AND NOT share_fertility_window
FROM public.cycle_sharing_preferences
WHERE user_id='${U.personalDeleting}';
`)).toBe('t');
    expectFence(asUser(U.personalDeleting, `
UPDATE public.cycle_sharing_preferences
SET share_current_period=false, share_prediction_window=false,
    share_fertility_window=false, created_at=created_at+interval '1 second'
WHERE user_id=auth.uid();
`));

    expect(expectUser(
      U.personalDeleting,
      `SELECT public.e2ee_revoke_own_device('${ID.deviceRevoke}');`,
    )).toBe('REVOKED');
    expect(expectUser(
      U.personalDeleting,
      `SELECT public.e2ee_mark_device_provisioning_failed('${ID.deviceFail}');`,
    )).toBe('PROVISIONING_FAILED');
    expect(expectUser(
      U.personalDeleting,
      `SELECT public.e2ee_abandon_epoch('${ID.epochAbandon}');`,
    )).toBe('ABANDONED');
    expect(expectUser(
      U.personalDeleting,
      `SELECT public.e2ee_abandon_epoch('${ID.epochReady}');`,
    )).toBe('ABANDONED');

    expectSql('GRANT UPDATE (status, revoked_at, label_ct) ON public.devices TO authenticated;');
    expectSql('GRANT UPDATE (state, rotation_reason) ON public.scope_keys TO authenticated;');
    expectSql(`
CREATE POLICY migration076_test_scope_key_update
ON public.scope_keys FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());
`);
    expectFence(asUser(U.personalDeleting, `
UPDATE public.devices
SET status='REVOKED', revoked_at=now(), label_ct=decode('aa','hex')
WHERE id='${ID.challengeDevice}';
`));
    expectFence(asUser(U.personalDeleting, `
UPDATE public.scope_keys SET state='ABANDONED', rotation_reason='mixed'
WHERE id='${ID.epochMixed}';
`));

    expectUser(U.personalDeleting, `
INSERT INTO public.revocation_statements
  (user_id, revoked_device_id, reason, statement, signature, revoked_at, sequence, log_head)
VALUES
  (auth.uid(), '${ID.challengeDevice}', 1, decode(repeat('14',203),'hex'),
   decode(repeat('15',64),'hex'), now(), 1, decode(repeat('16',32),'hex'));
`);
    expectUser(U.personalDeleting, 'SELECT public.revoke_my_push_tokens();');
    expect(expectSql(`
SELECT count(*) FROM public.device_push_tokens
WHERE user_id='${U.personalDeleting}';
`)).toBe('0');
  });

  it('denies service_role direct DML but runs the exact v2 deletion pipeline', () => {
    beginDeletion(U.serviceDirect, ID.serviceAttempt);
    expectSql('GRANT INSERT, UPDATE ON public.product_events TO service_role;');
    expectFence(asService(`
INSERT INTO public.product_events (user_id, couple_id, kind, screen)
VALUES ('${U.serviceDirect}', NULL, 'screen_view', 'service-direct');
`));

    expectService(`
DO $test$
DECLARE
  v_fenced BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.e2ee_issue_recovery_challenge(
      '${U.cancellation}', gen_random_uuid(), decode(repeat('20',32),'hex'), 300
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.product_events
      (user_id, couple_id, kind, screen, occurred_on)
    VALUES
      ('${U.cancellation}', NULL, 'record_composed', 'home', current_date);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM = 'account_deletion_pending' THEN
      v_fenced := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_fenced THEN
    RAISE EXCEPTION 'account_write_capability_leaked';
  END IF;
END
$test$;
`);
    expect(expectSql(`
SELECT count(*) FROM public.product_events
WHERE user_id='${U.cancellation}' AND kind='record_composed';
`)).toBe('0');

    expectService(`
SELECT public.begin_account_deletion_v2(
  '${U.pipeline}', '{}'::uuid[], '${ID.pipelineAttempt}'
);
`);
    const wrongAttempt = asService(`
SELECT public.e2ee_prepare_account_deletion_v2(
  '${U.pipeline}','${ID.serviceAttempt}'
);
`);
    expect(wrongAttempt.status).not.toBe(0);
    expect(wrongAttempt.stderr).toContain('stale_account_deletion_attempt');

    const wrongPhase = asService(`
SELECT public.prepare_account_deletion_v2(
  '${U.pipeline}','{}'::uuid[],'${ID.pipelineAttempt}'
);
`);
    expect(wrongPhase.status).not.toBe(0);
    expect(wrongPhase.stderr).toContain('illegal_account_deletion_phase');

    expect(JSON.parse(expectService(`
SELECT public.e2ee_prepare_account_deletion_v2(
  '${U.pipeline}','${ID.pipelineAttempt}'
);
`))).toMatchObject({ ok: true, phase: 'e2ee_prepared' });
    expect(JSON.parse(expectService(`
SELECT public.prepare_account_deletion_v2(
  '${U.pipeline}','{}'::uuid[],'${ID.pipelineAttempt}'
);
`))).toMatchObject({ ok: true, phase: 'relational_prepared' });
    expect(JSON.parse(expectService(`
SELECT public.close_account_relationship_generations_v2(
  '${U.pipeline}','${ID.pipelineAttempt}'
);
`))).toMatchObject({ ok: true, phase: 'relationships_closed' });
    expect(JSON.parse(expectService(`
SELECT public.cleanup_account_solo_couples_v2(
  '${U.pipeline}','${ID.pipelineAttempt}'
);
`))).toMatchObject({ ok: true, phase: 'solo_cleanup_complete' });
    expect(expectSql(
      'SELECT count(*) FROM public.account_deletion_write_capabilities;',
    )).toBe('0');
  });

  it('allows owner media delete, blocks partner upload, and honors exact cancellation', () => {
    const partnerUpload = asUser(U.partner, `
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES (
  'couple-media',
  '${ID.couple}/${ID.partnerRecord}/after-marker.jpg',
  auth.uid()
);
`);
    expectFence(partnerUpload);

    expectUser(
      U.deleting,
      `DELETE FROM storage.objects WHERE id='${ID.deletingMedia}';`,
    );
    expect(expectSql(
      `SELECT count(*) FROM storage.objects WHERE id='${ID.deletingMedia}';`,
    )).toBe('0');

    beginDeletion(U.cancellation, ID.cancelAttempt);
    expectFence(asUser(
      U.cancellation,
      "UPDATE public.profiles SET profile_caption='blocked' WHERE id=auth.uid();",
    ));
    expect(expectService(`
SELECT public.cancel_account_deletion_v2(
  '${U.cancellation}','${ID.cancelAttempt}'
);
`)).toBe('t');
    expectUser(
      U.cancellation,
      "UPDATE public.profiles SET profile_caption='after cancel' WHERE id=auth.uid();",
    );
    expect(expectSql(`
SELECT profile_caption FROM public.profiles
WHERE id='${U.cancellation}';
`)).toBe('after cancel');
  });

  it('preserves the 074 storage drain without advisory-lock inversion', async () => {
    const writer = asyncSql(`
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5s';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role"='authenticated';
SET LOCAL "request.jwt.claim.sub"='${U.storagePartner}';
LOCK TABLE storage.objects IN ROW EXCLUSIVE MODE;
SELECT pg_sleep(0.7);
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES (
  'couple-media',
  '${ID.storageCouple}/${ID.storageRecord}/writer-first.jpg',
  auth.uid()
);
COMMIT;
`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const deletionStartedAt = Date.now();
    const deletion = asService(`
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5s';
SELECT public.begin_account_deletion_v2(
  '${U.storageDeleting}',
  ARRAY['${ID.storageDeletingRecord}'::uuid],
  '${ID.storageAttempt}'
);
`);
    const deletionWaitMs = Date.now() - deletionStartedAt;
    const writerResult = await writer;

    expect(writerResult.status, writerResult.stderr).toBe(0);
    expect(deletion.status, deletion.stderr).toBe(0);
    expect(deletionWaitMs).toBeGreaterThanOrEqual(400);
    expect(expectSql(`
SELECT count(*) FROM storage.objects
WHERE name='${ID.storageCouple}/${ID.storageRecord}/writer-first.jpg';
`)).toBe('1');
    expect(`${writerResult.stderr}${deletion.stderr}`)
      .not.toMatch(/deadlock detected|lock timeout|statement timeout/i);

    expectService(`
DELETE FROM storage.objects
WHERE id='${ID.storageDeletingMedia}';
`);
    expect(expectSql(`
SELECT count(*) FROM storage.objects
WHERE id='${ID.storageDeletingMedia}';
`)).toBe('0');

    const unrelatedServiceDelete = asService(`
DELETE FROM storage.objects
WHERE id='${ID.partnerMedia}';
`);
    expectFence(unrelatedServiceDelete);
    expect(expectSql(`
SELECT count(*) FROM storage.objects
WHERE id='${ID.partnerMedia}';
`)).toBe('1');
  }, 10_000);

  it('serializes the 070 consent grant in both race directions', async () => {
    const grant = asyncSql(`
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5s';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role"='authenticated';
SET LOCAL "request.jwt.claim.sub"='${U.consentWriterFirst}';
SELECT * FROM public.grant_cycle_sensitive_consent(
  '${U.consentWriterFirst}', 0, '2026-08-09'
);
SELECT pg_sleep(0.7);
COMMIT;
`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const deletionAfterGrant = asService(`
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5s';
SELECT public.begin_account_deletion_v2(
  '${U.consentWriterFirst}','{}'::uuid[],'${ID.consentWriterAttempt}'
);
`);
    const grantResult = await grant;
    expect(grantResult.status, grantResult.stderr).toBe(0);
    expect(deletionAfterGrant.status, deletionAfterGrant.stderr).toBe(0);

    const marker = asyncSql(`
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5s';
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role"='service_role';
SELECT public.begin_account_deletion_v2(
  '${U.consentMarkerFirst}','{}'::uuid[],'${ID.consentMarkerAttempt}'
);
SELECT pg_sleep(0.7);
COMMIT;
`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const grantAfterMarker = asUser(U.consentMarkerFirst, `
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5s';
SELECT * FROM public.grant_cycle_sensitive_consent(
  '${U.consentMarkerFirst}', 0, '2026-08-09'
);
`);
    const markerResult = await marker;
    expect(markerResult.status, markerResult.stderr).toBe(0);
    expectFence(grantAfterMarker);
    expect(expectSql(`
SELECT count(*) FROM public.user_sensitive_consents
WHERE user_id='${U.consentMarkerFirst}';
`)).toBe('0');
    expect(
      `${grantResult.stderr}${deletionAfterGrant.stderr}${markerResult.stderr}${grantAfterMarker.stderr}`,
    ).not.toMatch(/deadlock detected|lock timeout|statement timeout/i);
  }, 10_000);

  it('serializes writer-first and marker-first races without deadlock', async () => {
    const writer = asyncSql(`
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role"='authenticated';
SET LOCAL "request.jwt.claim.sub"='${U.writerFirst}';
UPDATE public.profiles
SET profile_caption='writer won first'
WHERE id=auth.uid();
SELECT pg_sleep(0.7);
COMMIT;
`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const writerBeginAt = Date.now();
    const deletionAfterWriter = asService(`
SET LOCAL lock_timeout='3s';
SELECT public.begin_account_deletion_v2(
  '${U.writerFirst}','{}'::uuid[],'${ID.writerAttempt}'
);
`);
    const writerWaitMs = Date.now() - writerBeginAt;
    const writerResult = await writer;
    expect(writerResult.status, writerResult.stderr).toBe(0);
    expect(deletionAfterWriter.status, deletionAfterWriter.stderr).toBe(0);
    expect(writerWaitMs).toBeGreaterThanOrEqual(400);
    expect(expectSql(`
SELECT profile_caption FROM public.profiles
WHERE id='${U.writerFirst}';
`)).toBe('writer won first');

    const marker = asyncSql(`
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role"='service_role';
SELECT public.begin_account_deletion_v2(
  '${U.markerFirst}','{}'::uuid[],'${ID.markerAttempt}'
);
SELECT pg_sleep(0.7);
COMMIT;
`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const markerBeginAt = Date.now();
    const writeAfterMarker = asUser(U.markerFirst, `
SET LOCAL lock_timeout='3s';
UPDATE public.profiles
SET profile_caption='must not land'
WHERE id=auth.uid();
`);
    const markerWaitMs = Date.now() - markerBeginAt;
    const markerResult = await marker;
    expect(markerResult.status, markerResult.stderr).toBe(0);
    expectFence(writeAfterMarker);
    expect(markerWaitMs).toBeGreaterThanOrEqual(400);
    expect(expectSql(`
SELECT profile_caption IS NULL FROM public.profiles
WHERE id='${U.markerFirst}';
`)).toBe('t');
    expect(
      `${writerResult.stderr}${deletionAfterWriter.stderr}${markerResult.stderr}${writeAfterMarker.stderr}`,
    ).not.toMatch(/deadlock detected|lock timeout/i);
  }, 10_000);
});
