import { spawnSync } from 'node:child_process';
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
import {
  canExecute,
  executePrivileges,
  jsonbObjectKeys,
  parseFunctionDefinitions,
  stripSqlComments,
} from '@/test/sqlModel';

type CommandResult = { status: number | null; stdout: string; stderr: string };

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/075_relationship_context_and_optional_gender.sql',
);
let migration = '';
try {
  migration = readFileSync(migrationPath, 'utf8');
} catch {
  // Keep the pre-implementation RED state observable through assertions.
}

const definitions = () => parseFunctionDefinitions(migration);
const definition = (signature: string) => {
  const found = definitions().find((candidate) => candidate.signature === signature);
  expect(found, `${signature} must be defined by migration 075`).toBeDefined();
  return found!;
};

describe('migration 075 static relationship-context contract', () => {
  it('is a forward-only transaction that adds the two metadata columns without touching health data', () => {
    expect(migration.length, 'migration 075 must exist').toBeGreaterThan(0);
    const executable = stripSqlComments(migration);

    expect(executable).toMatch(/\bBEGIN\s*;/i);
    expect(executable).toMatch(/\bCOMMIT\s*;/i);
    expect(executable).toMatch(/ALTER TABLE public\.couples[\s\S]*ADD COLUMN IF NOT EXISTS relationship_context TEXT/i);
    expect(executable).toMatch(/ALTER TABLE public\.profiles[\s\S]*ADD COLUMN IF NOT EXISTS gender_identity TEXT/i);
    expect(executable).not.toMatch(/\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(executable).not.toMatch(/\b(?:cycle_|period_|symptom|health_note|user_sensitive_consents)\b/i);
    expect(executable).not.toMatch(/\bCREATE\s+POLICY\b/i);
  });

  it('defines the exact v2 signatures, fixed search paths, and authenticated actor checks', () => {
    const create = definition('public.create_couple_and_invitation_v2(TEXT, TEXT, TEXT)');
    expect(create.args).toEqual([
      'p_role TEXT',
      'p_code_hash TEXT',
      'p_relationship_context TEXT',
    ]);
    expect(create.returns).toBe('UUID');
    expect(create.security).toBe('DEFINER');
    expect(create.searchPath).toEqual(['public', 'pg_temp']);
    expect(create.body).toMatch(/v_uid UUID := auth\.uid\(\)/i);
    expect(create.body).toMatch(/IF v_uid IS NULL THEN[\s\S]*ERRCODE = '42501'/i);
    expect(create.body).toMatch(/p_role IS DISTINCT FROM 'gomsin'/i);
    expect(create.body).toMatch(/p_relationship_context IS DISTINCT FROM 'general'/i);
    expect(create.body).toMatch(/INSERT INTO public\.couples\s*\(relationship_context\)[\s\S]*VALUES\s*\('general'\)/i);
    expect(create.body).toMatch(/VALUES\s*\(v_couple_id, v_uid, 'gomsin', 'active'\)/i);

    const redeem = definition('public.redeem_invitation_v2(TEXT, TEXT)');
    expect(redeem.args).toEqual([
      'p_code_hash TEXT',
      'p_expected_relationship_context TEXT',
    ]);
    expect(redeem.returns).toBe('JSONB');
    expect(redeem.security).toBe('DEFINER');
    expect(redeem.searchPath).toEqual(['public', 'pg_temp']);
    expect(redeem.body).toMatch(/v_uid UUID := auth\.uid\(\)/i);
    expect(redeem.body).toMatch(/p_expected_relationship_context IS DISTINCT FROM 'general'/i);
    expect(redeem.body).toMatch(/VALUES\s*\(\s*v_invite\.couple_id,\s*v_uid,\s*'soldier',\s*'active'\s*\)/i);
  });

  it('keeps redemption lock and revalidation order before consuming an invitation', () => {
    const body = definition('public.redeem_invitation_v2(TEXT, TEXT)').body;
    const ordered = [
      body.indexOf('15014'),
      body.indexOf('SELECT invitation.id'),
      body.indexOf('lock_relationship_mutation_boundary'),
      body.indexOf('SELECT relationship.*'),
      body.indexOf("v_relationship.relationship_context IS DISTINCT FROM 'general'"),
      body.indexOf('ELSIF NOT EXISTS'),
      body.indexOf('UPDATE public.invitation_codes'),
      body.indexOf('INSERT INTO public.couple_members'),
    ];

    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(body).not.toMatch(/hashtextextended\([^)]*,\s*15013\)/i);
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.lock_relationship_mutation_boundary/i);
  });

  it('keeps legacy redemption military-only with the same opaque response keys', () => {
    const legacy = definition('public.redeem_invitation(TEXT)');
    const modern = definition('public.redeem_invitation_v2(TEXT, TEXT)');

    expect(legacy.body).toMatch(/relationship_context IS DISTINCT FROM 'military'/i);
    expect(legacy.body).toMatch(/lock_relationship_mutation_boundary/i);
    const legacyKeys = jsonbObjectKeys(legacy.body);
    const modernKeys = jsonbObjectKeys(modern.body);
    for (const keys of [...legacyKeys, ...modernKeys]) {
      expect(new Set(keys)).toEqual(new Set(['ok', 'couple_id', 'error_code']));
    }
  });

  it('preserves projection response shapes while suppressing service for general couples', () => {
    const service = definition('public.get_partner_service_info()');
    expect(service.returnColumns).toEqual([
      'branch',
      'military_status',
      'enlistment_date',
      'expected_discharge_date',
      'discharge_date',
      'discharge_date_source',
    ]);
    expect(service.body).toMatch(/relationship\.relationship_context\s*=\s*'military'/i);

    const snapshot = definition('public.get_my_relationship_snapshot_v2()');
    expect(snapshot.returns).toBe('JSONB');
    expect(snapshot.volatility).toBe('STABLE');
    expect(snapshot.body).toMatch(/selected_couple\.relationship_context\s*=\s*'military'/i);
    expect(jsonbObjectKeys(snapshot.body)).toEqual([
      [
        'branch',
        'military_status',
        'enlistment_date',
        'expected_discharge_date',
        'discharge_date',
        'discharge_date_source',
      ],
      ['user_id', 'joined_at', 'display_name', 'role', 'avatar_path', 'username', 'service'],
      [
        'contract_version',
        'owner_user_id',
        'lifecycle',
        'couple_id',
        'relation_revision',
        'partner',
        'invitation_active',
        'invitation_expires_at',
      ],
    ]);
    expect(snapshot.body).not.toMatch(/gender_identity/i);
  });

  it('adds relationship context to the existing lifecycle response without leaking gender', () => {
    const state = definition('public.get_my_couple_state()');
    const payloads = jsonbObjectKeys(state.body);

    expect(payloads).toHaveLength(2);
    expect(new Set(payloads[0])).toEqual(new Set(payloads[1]));
    expect(payloads[0]).toContain('relationship_context');
    expect(state.body).not.toMatch(/gender_identity/i);
  });

  it('revokes default execution and grants only authenticated on every client RPC', () => {
    const signatures = [
      'public.create_couple_and_invitation_v2(TEXT, TEXT, TEXT)',
      'public.redeem_invitation_v2(TEXT, TEXT)',
      'public.redeem_invitation(TEXT)',
      'public.get_partner_service_info()',
      'public.get_my_relationship_snapshot_v2()',
      'public.get_my_couple_state()',
    ];

    for (const signature of signatures) {
      const rpc = definition(signature);
      expect(rpc.security).toBe('DEFINER');
      expect(rpc.searchPath).toEqual(['public', 'pg_temp']);
      const privileges = executePrivileges(migration, signature);
      expect(privileges.statementsApplied).toBeGreaterThanOrEqual(3);
      expect(canExecute(privileges, 'authenticated')).toBe(true);
      expect(canExecute(privileges, 'anon')).toBe(false);
      expect(canExecute(privileges, 'service_role')).toBe(false);
    }
  });
});

function command(file: string, args: string[], input?: string): CommandResult {
  const result = spawnSync(file, args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' },
    maxBuffer: 32 * 1024 * 1024,
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
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
GRANT SELECT ON storage.buckets TO anon, authenticated;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE AS
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

const PRE_002_RECURSION_DROPS = `
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;
DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;
`;

const USERS = {
  invalidRole: '00000000-0000-4000-8000-000000000101',
  invalidMilitary: '00000000-0000-4000-8000-000000000102',
  invalidOther: '00000000-0000-4000-8000-000000000103',
  generalCreator: '00000000-0000-4000-8000-000000000104',
  generalJoiner: '00000000-0000-4000-8000-000000000105',
  legacyRejectCreator: '00000000-0000-4000-8000-000000000106',
  legacyRejectJoiner: '00000000-0000-4000-8000-000000000107',
  militaryCreator: '00000000-0000-4000-8000-000000000108',
  militaryJoiner: '00000000-0000-4000-8000-000000000109',
  expectedMismatchCreator: '00000000-0000-4000-8000-000000000110',
  expectedMismatchJoiner: '00000000-0000-4000-8000-000000000111',
  projectionCreator: '00000000-0000-4000-8000-000000000112',
  projectionJoiner: '00000000-0000-4000-8000-000000000113',
  genderOwner: '00000000-0000-4000-8000-000000000114',
  genderOutsider: '00000000-0000-4000-8000-000000000115',
  deletingCreator: '00000000-0000-4000-8000-000000000116',
  deletingInviter: '00000000-0000-4000-8000-000000000117',
  deletingInvitee: '00000000-0000-4000-8000-000000000118',
} as const;

const HASH = {
  invalidRole: '1'.repeat(64),
  invalidMilitary: '2'.repeat(64),
  invalidOther: '3'.repeat(64),
  general: '4'.repeat(64),
  legacyReject: '5'.repeat(64),
  military: '6'.repeat(64),
  expectedMismatch: '7'.repeat(64),
  projection: '8'.repeat(64),
  deletingCreator: '9'.repeat(64),
  deletingInviter: 'a'.repeat(64),
} as const;

const LEGACY_COUPLE = '10000000-0000-4000-8000-000000000075';

describePostgres.sequential('migration 075 PostgreSQL 17 integration', () => {
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

  const expectUser = (userId: string, statement: string): string => {
    const result = asUser(userId, statement);
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'gomsinlog-075-'));
    dataDirectory = join(root, 'data');
    socketDirectory = join(root, 'socket');
    mkdirSync(socketDirectory);
    port = await freePort();

    const initialized = command(join(PG_BIN!, 'initdb'), [
      '--no-sync',
      '--auth-local=trust',
      '--auth-host=trust',
      '--encoding=UTF8',
      '--locale=C',
      '--username=postgres',
      '-D', dataDirectory,
    ]);
    expect(initialized.status, initialized.stderr).toBe(0);

    const started = command(join(PG_BIN!, 'pg_ctl'), [
      '-D', dataDirectory,
      '-o', `-F -k ${socketDirectory} -p ${port} -c listen_addresses=''`,
      '-l', join(root, 'postgres.log'),
      '-w', 'start',
    ]);
    expect(started.status, started.stderr).toBe(0);

    expectSql(SUPABASE_STUB, 'Supabase stub');
    const migrationsDirectory = resolve(process.cwd(), 'supabase/migrations');
    const predecessors = readdirSync(migrationsDirectory)
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .filter((file) => Number.parseInt(file.slice(0, 3), 10) <= 74)
      .sort();

    for (const file of predecessors) {
      if (file === '002_fix_rls_recursion.sql') {
        expectSql(PRE_002_RECURSION_DROPS, 'fresh-chain 002 policy bridge');
      }
      expectSql(readFileSync(join(migrationsDirectory, file), 'utf8'), file);
    }

    const users = Object.values(USERS);
    const userRows = users
      .map((userId, index) => `('${userId}', 'migration075-${index}@example.test')`)
      .join(',\n');
    const profileRows = users
      .map((userId, index) => `('${userId}', 'User ${index}', 'gomsin', 'm075user${index}')`)
      .join(',\n');
    expectSql(`
INSERT INTO auth.users (id, email) VALUES ${userRows};
INSERT INTO public.profiles (id, display_name, role, username) VALUES ${profileRows};
INSERT INTO public.couples (id) VALUES ('${LEGACY_COUPLE}');
`, 'migration 075 fixtures');

    expectSql(migration, 'migration 075');
  }, 60_000);

  afterAll(() => {
    if (dataDirectory && PG_BIN) {
      command(join(PG_BIN, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('backfills legacy rows and enforces default, NOT NULL, CHECK, and immutability', () => {
    const serverVersion = Number(expectSql('SHOW server_version_num;'));
    expect(serverVersion).toBeGreaterThanOrEqual(170_000);
    expect(serverVersion).toBeLessThan(180_000);

    expect(expectSql(`
SELECT relationship_context FROM public.couples WHERE id = '${LEGACY_COUPLE}';
`)).toBe('military');

    const column = JSON.parse(expectSql(`
SELECT jsonb_build_object(
  'nullable', column_definition.is_nullable,
  'default', column_definition.column_default
)
FROM information_schema.columns AS column_definition
WHERE column_definition.table_schema = 'public'
  AND column_definition.table_name = 'couples'
  AND column_definition.column_name = 'relationship_context';
`));
    expect(column).toEqual({ nullable: 'NO', default: "'military'::text" });
    expect(expectSql(`
SELECT count(*)
FROM pg_constraint
WHERE conrelid = 'public.couples'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%relationship_context%military%general%';
`)).toBe('1');

    const changed = sql(`
UPDATE public.couples SET relationship_context = 'general'
WHERE id = '${LEGACY_COUPLE}';
`);
    expect(changed.status).not.toBe(0);
    expect(changed.stderr).toContain('relationship_context_is_immutable');
    expect(expectSql(`
SELECT relationship_context FROM public.couples WHERE id = '${LEGACY_COUPLE}';
`)).toBe('military');

    const invalid = sql("INSERT INTO public.couples (relationship_context) VALUES ('friendship');");
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('couples_relationship_context_check');
  });

  it('creates general generations only for a literal gomsin creator', () => {
    for (const [userId, role, context, hash] of [
      [USERS.invalidRole, 'soldier', 'general', HASH.invalidRole],
      [USERS.invalidMilitary, 'gomsin', 'military', HASH.invalidMilitary],
      [USERS.invalidOther, 'gomsin', 'friendship', HASH.invalidOther],
    ] as const) {
      const rejected = asUser(userId, `
SELECT public.create_couple_and_invitation_v2('${role}', '${hash}', '${context}');
`);
      expect(rejected.status).not.toBe(0);
      expect(expectSql(`
SELECT count(*) FROM public.couple_members
WHERE user_id = '${userId}' AND status IN ('active', 'pending');
`)).toBe('0');
    }

    const coupleId = expectUser(USERS.generalCreator, `
SELECT public.create_couple_and_invitation_v2('gomsin', '${HASH.general}', 'general');
`);
    expect(expectSql(`
SELECT relationship.relationship_context || ':' || member.role || ':' || member.status
FROM public.couples AS relationship
JOIN public.couple_members AS member ON member.couple_id = relationship.id
WHERE relationship.id = '${coupleId}' AND member.user_id = '${USERS.generalCreator}';
`)).toBe('general:gomsin:active');
    expect(JSON.parse(expectUser(
      USERS.generalCreator,
      'SELECT public.get_my_couple_state();',
    ))).toMatchObject({ relationship_context: 'general' });
  });

  it('redeems a general invitation into the literal soldier slot', () => {
    const result = JSON.parse(expectUser(USERS.generalJoiner, `
SELECT public.redeem_invitation_v2('${HASH.general}', 'general');
`));
    expect(result).toMatchObject({ ok: true, error_code: null });
    expect(expectSql(`
SELECT member.role || ':' || member.status || ':' || invitation.used::TEXT
FROM public.couple_members AS member
JOIN public.invitation_codes AS invitation ON invitation.couple_id = member.couple_id
WHERE member.user_id = '${USERS.generalJoiner}'
  AND invitation.code_hash = '${HASH.general}';
`)).toBe('soldier:active:true');
  });

  it('makes legacy redemption reject a general code without consuming it', () => {
    expectUser(USERS.legacyRejectCreator, `
SELECT public.create_couple_and_invitation_v2('gomsin', '${HASH.legacyReject}', 'general');
`);
    const rejected = JSON.parse(expectUser(USERS.legacyRejectJoiner, `
SELECT public.redeem_invitation('${HASH.legacyReject}');
`));
    expect(rejected).toEqual({ ok: false, couple_id: null, error_code: 'invalid_or_expired' });
    expect(expectSql(`
SELECT used::TEXT || ':' || COALESCE(used_by::TEXT, 'null')
FROM public.invitation_codes WHERE code_hash = '${HASH.legacyReject}';
`)).toBe('false:null');

    const accepted = JSON.parse(expectUser(USERS.legacyRejectJoiner, `
SELECT public.redeem_invitation_v2('${HASH.legacyReject}', 'general');
`));
    expect(accepted.ok).toBe(true);
  });

  it('leaves both input-context and generation-context mismatches unused', () => {
    expectUser(USERS.expectedMismatchCreator, `
SELECT public.create_couple_and_invitation_v2('gomsin', '${HASH.expectedMismatch}', 'general');
`);
    const wrongExpected = JSON.parse(expectUser(USERS.expectedMismatchJoiner, `
SELECT public.redeem_invitation_v2('${HASH.expectedMismatch}', 'military');
`));
    expect(wrongExpected).toEqual({ ok: false, couple_id: null, error_code: 'invalid_request' });
    expect(expectSql(`
SELECT used FROM public.invitation_codes WHERE code_hash = '${HASH.expectedMismatch}';
`)).toBe('f');

    const militaryCouple = expectUser(USERS.militaryCreator, `
SELECT public.create_couple_and_invitation('gomsin', '${HASH.military}');
`);
    const wrongGeneration = JSON.parse(expectUser(USERS.militaryJoiner, `
SELECT public.redeem_invitation_v2('${HASH.military}', 'general');
`));
    expect(wrongGeneration).toEqual({ ok: false, couple_id: null, error_code: 'invalid_or_expired' });
    expect(expectSql(`
SELECT relationship.relationship_context || ':' || invitation.used::TEXT
FROM public.couples AS relationship
JOIN public.invitation_codes AS invitation ON invitation.couple_id = relationship.id
WHERE relationship.id = '${militaryCouple}' AND invitation.code_hash = '${HASH.military}';
`)).toBe('military:false');

    const legacyAccepted = JSON.parse(expectUser(USERS.militaryJoiner, `
SELECT public.redeem_invitation('${HASH.military}');
`));
    expect(legacyAccepted).toMatchObject({ ok: true, couple_id: militaryCouple, error_code: null });
    expect(expectSql(`
SELECT role FROM public.couple_members
WHERE user_id = '${USERS.militaryJoiner}' AND couple_id = '${militaryCouple}';
`)).toBe('soldier');
  });

  it('returns no stale service payload from either projection for a general couple', () => {
    const coupleId = expectUser(USERS.projectionCreator, `
SELECT public.create_couple_and_invitation_v2('gomsin', '${HASH.projection}', 'general');
`);
    const joined = JSON.parse(expectUser(USERS.projectionJoiner, `
SELECT public.redeem_invitation_v2('${HASH.projection}', 'general');
`));
    expect(joined.ok).toBe(true);
    expectSql(`
UPDATE public.profiles
SET military_info = jsonb_build_object(
  'branch', 'army',
  'militaryStatus', 'serving',
  'enlistmentDate', '2025-01-01',
  'expectedDischargeDate', '2026-01-01',
  'dischargeDateSource', 'manual'
)
WHERE id = '${USERS.projectionJoiner}';
`);

    expect(expectUser(
      USERS.projectionCreator,
      'SELECT count(*) FROM public.get_partner_service_info();',
    )).toBe('0');
    const snapshot = JSON.parse(expectUser(
      USERS.projectionCreator,
      'SELECT public.get_my_relationship_snapshot_v2();',
    ));
    expect(snapshot).toMatchObject({ lifecycle: 'active', couple_id: coupleId });
    expect(snapshot.partner.service).toBeNull();

    // Positive control: 075 narrows only general generations. The established
    // military allowlist remains available to the eligible military pair.
    expectSql(`
UPDATE public.profiles
SET military_info = jsonb_build_object(
  'branch', 'army',
  'militaryStatus', 'serving',
  'enlistmentDate', '2025-02-01',
  'expectedDischargeDate', '2026-02-01',
  'dischargeDateSource', 'manual'
)
WHERE id = '${USERS.militaryJoiner}';
`);
    expect(expectUser(USERS.militaryCreator, `
SELECT branch || ':' || military_status
FROM public.get_partner_service_info();
`)).toBe('army:serving');
    const militarySnapshot = JSON.parse(expectUser(
      USERS.militaryCreator,
      'SELECT public.get_my_relationship_snapshot_v2();',
    ));
    expect(militarySnapshot.partner.service).toMatchObject({
      branch: 'army',
      military_status: 'serving',
    });
  });

  it('keeps optional gender nullable, checked, owner-only, and absent from every policy', () => {
    const column = JSON.parse(expectSql(`
SELECT jsonb_build_object(
  'nullable', column_definition.is_nullable,
  'default_is_null', column_definition.column_default IS NULL
)
FROM information_schema.columns AS column_definition
WHERE column_definition.table_schema = 'public'
  AND column_definition.table_name = 'profiles'
  AND column_definition.column_name = 'gender_identity';
`));
    expect(column).toEqual({ nullable: 'YES', default_is_null: true });

    expect(expectUser(USERS.genderOwner, `
UPDATE public.profiles SET gender_identity = 'woman'
WHERE id = '${USERS.genderOwner}' RETURNING gender_identity;
`)).toBe('woman');
    expect(expectUser(USERS.genderOutsider, `
SELECT count(*) FROM public.profiles WHERE id = '${USERS.genderOwner}';
`)).toBe('0');
    expect(expectUser(USERS.genderOutsider, `
UPDATE public.profiles SET gender_identity = 'man'
WHERE id = '${USERS.genderOwner}' RETURNING gender_identity;
`)).toBe('');
    expect(expectSql(`
SELECT gender_identity FROM public.profiles WHERE id = '${USERS.genderOwner}';
`)).toBe('woman');

    const invalid = asUser(USERS.genderOwner, `
UPDATE public.profiles SET gender_identity = 'soldier'
WHERE id = '${USERS.genderOwner}';
`);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('profiles_gender_identity_check');
    expectUser(USERS.genderOwner, `
UPDATE public.profiles SET gender_identity = NULL
WHERE id = '${USERS.genderOwner}';
`);
    expect(expectSql(`
SELECT gender_identity IS NULL FROM public.profiles WHERE id = '${USERS.genderOwner}';
`)).toBe('t');

    expect(expectSql(`
SELECT count(*)
FROM pg_policy AS policy
WHERE policy.polrelid IN ('public.profiles'::regclass, 'public.couples'::regclass,
                          'public.couple_members'::regclass)
  AND (
    COALESCE(pg_get_expr(policy.polqual, policy.polrelid), '') ILIKE '%gender_identity%'
    OR COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '') ILIKE '%gender_identity%'
  );
`)).toBe('0');
  });

  it('keeps 074 deletion markers effective on both new relationship RPCs', () => {
    expectSql(`
INSERT INTO public.account_deletion_requests (user_id, expected_record_ids)
VALUES ('${USERS.deletingCreator}', '{}'::UUID[]);
`);
    const create = asUser(USERS.deletingCreator, `
SELECT public.create_couple_and_invitation_v2(
  'gomsin', '${HASH.deletingCreator}', 'general'
);
`);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain('Account deletion pending');

    expectUser(USERS.deletingInviter, `
SELECT public.create_couple_and_invitation_v2(
  'gomsin', '${HASH.deletingInviter}', 'general'
);
`);
    expectSql(`
INSERT INTO public.account_deletion_requests (user_id, expected_record_ids)
VALUES ('${USERS.deletingInviter}', '{}'::UUID[]);
`);
    const redeem = JSON.parse(expectUser(USERS.deletingInvitee, `
SELECT public.redeem_invitation_v2('${HASH.deletingInviter}', 'general');
`));
    expect(redeem).toEqual({ ok: false, couple_id: null, error_code: 'invalid_or_expired' });
    expect(expectSql(`
SELECT used FROM public.invitation_codes WHERE code_hash = '${HASH.deletingInviter}';
`)).toBe('f');
  });

  it('has exact signatures, fixed search_path, and authenticated-only execution in PostgreSQL', () => {
    const rows = JSON.parse(expectSql(`
SELECT jsonb_agg(jsonb_build_object(
  'signature', target.signature,
  'identity_args', pg_get_function_identity_arguments(procedure.oid),
  'result', pg_get_function_result(procedure.oid),
  'security_definer', procedure.prosecdef,
  'fixed_path', procedure.proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[],
  'authenticated', has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
  'anon', has_function_privilege('anon', procedure.oid, 'EXECUTE'),
  'service_role', has_function_privilege('service_role', procedure.oid, 'EXECUTE')
) ORDER BY target.signature)
FROM (VALUES
  ('public.create_couple_and_invitation_v2(text,text,text)',
   'public.create_couple_and_invitation_v2(text,text,text)'::regprocedure),
  ('public.get_my_couple_state()', 'public.get_my_couple_state()'::regprocedure),
  ('public.get_my_relationship_snapshot_v2()',
   'public.get_my_relationship_snapshot_v2()'::regprocedure),
  ('public.get_partner_service_info()', 'public.get_partner_service_info()'::regprocedure),
  ('public.redeem_invitation(text)', 'public.redeem_invitation(text)'::regprocedure),
  ('public.redeem_invitation_v2(text,text)',
   'public.redeem_invitation_v2(text,text)'::regprocedure)
) AS target(signature, oid)
JOIN pg_proc AS procedure ON procedure.oid = target.oid;
`));

    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.security_definer, row.signature).toBe(true);
      expect(row.fixed_path, row.signature).toBe(true);
      expect(row.authenticated, row.signature).toBe(true);
      expect(row.anon, row.signature).toBe(false);
      expect(row.service_role, row.signature).toBe(false);
    }
    expect(rows.find((row: { signature: string }) => (
      row.signature.includes('create_couple_and_invitation_v2')
    ))).toMatchObject({
      identity_args: 'p_role text, p_code_hash text, p_relationship_context text',
      result: 'uuid',
    });
    expect(rows.find((row: { signature: string }) => (
      row.signature.includes('redeem_invitation_v2')
    ))).toMatchObject({
      identity_args: 'p_code_hash text, p_expected_relationship_context text',
      result: 'jsonb',
    });
  });
});
