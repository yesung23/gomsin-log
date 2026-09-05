import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
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

type CommandResult = { status: number | null; stdout: string; stderr: string };

function command(file: string, args: string[], input?: string): CommandResult {
  const result = spawnSync(file, args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    maxBuffer: 16 * 1024 * 1024,
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
    const versions = readdirSync('/usr/lib/postgresql').sort((a, b) => (
      Number.parseInt(b, 10) - Number.parseInt(a, 10)
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

const USERS = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
  d: '00000000-0000-4000-8000-00000000000d',
  e: '00000000-0000-4000-8000-00000000000e',
  f: '00000000-0000-4000-8000-00000000000f',
  g: '00000000-0000-4000-8000-000000000010',
  outsider: '00000000-0000-4000-8000-000000000011',
  legacy: '00000000-0000-4000-8000-000000000012',
  h: '00000000-0000-4000-8000-000000000013',
  i: '00000000-0000-4000-8000-000000000014',
  j: '00000000-0000-4000-8000-000000000015',
  k: '00000000-0000-4000-8000-000000000016',
  l: '00000000-0000-4000-8000-000000000017',
  m: '00000000-0000-4000-8000-000000000018',
  n: '00000000-0000-4000-8000-000000000019',
  o: '00000000-0000-4000-8000-00000000001a',
  p: '00000000-0000-4000-8000-00000000001b',
  q: '00000000-0000-4000-8000-00000000001c',
  r: '00000000-0000-4000-8000-00000000001d',
  s: '00000000-0000-4000-8000-00000000001e',
  t: '00000000-0000-4000-8000-00000000001f',
  u: '00000000-0000-4000-8000-000000000020',
  v: '00000000-0000-4000-8000-000000000021',
  legacyDeletion: '00000000-0000-4000-8000-000000000022',
  w: '00000000-0000-4000-8000-000000000023',
  x: '00000000-0000-4000-8000-000000000024',
  y: '00000000-0000-4000-8000-000000000025',
  z: '00000000-0000-4000-8000-000000000026',
  aa: '00000000-0000-4000-8000-000000000027',
} as const;

const ATTEMPTS = {
  a: '20000000-0000-4000-8000-000000000001',
  b: '20000000-0000-4000-8000-000000000002',
  c: '20000000-0000-4000-8000-000000000003',
  d: '20000000-0000-4000-8000-000000000004',
  e: '20000000-0000-4000-8000-000000000005',
  f: '20000000-0000-4000-8000-000000000006',
  g: '20000000-0000-4000-8000-000000000007',
} as const;

const HASH = {
  ab: 'a'.repeat(64),
  stale: 'b'.repeat(64),
  bNew: 'c'.repeat(64),
  de: 'd'.repeat(64),
  eNew: 'e'.repeat(64),
  fg: 'f'.repeat(64),
  rejectedAfterClose: '9'.repeat(64),
  mutation: '1'.repeat(64),
  target: '2'.repeat(64),
  mutationReuse: '3'.repeat(64),
  accountRace: '4'.repeat(64),
  regenerateRace: '5'.repeat(64),
  regenerateAfterClose: '6'.repeat(64),
  accountCreateAfterClose: '0'.repeat(64),
  soloDeletion: '7'.repeat(64),
  legacyBlocked: '8'.repeat(64),
  deletionPartner: 'a1'.repeat(32),
  deletionInvitee: 'b2'.repeat(32),
} as const;

const BASELINE = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
DO $roles$
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
END;
$roles$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TABLE auth.users (id UUID PRIMARY KEY);

CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role TEXT,
  avatar_path TEXT,
  username TEXT,
  military_info JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE public.couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anniversary_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  membership_revision BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE public.couple_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('gomsin', 'soldier')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disconnected')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (couple_id, user_id)
);

CREATE UNIQUE INDEX idx_user_active_couple
  ON public.couple_members (user_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.get_my_active_couple_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*), min(couple_id::TEXT)::UUID
  INTO v_count, v_couple_id
  FROM public.couple_members
  WHERE user_id = v_uid
    AND status = 'active';

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Multiple active couples found for user';
  END IF;
  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_active_couple_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;

ALTER TABLE public.couple_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own couple membership"
  ON public.couple_members FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "Users can view active partner couple membership"
  ON public.couple_members FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND status = 'active'
    AND couple_id = public.get_my_active_couple_id()
  );

ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active members can view couple"
  ON public.couples FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND id = public.get_my_active_couple_id()
  );
CREATE POLICY "Active members can update couple"
  ON public.couples FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND id = public.get_my_active_couple_id()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND id = public.get_my_active_couple_id()
  );

REVOKE ALL ON TABLE public.couples, public.couple_members FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.couples TO authenticated;
GRANT SELECT ON TABLE public.couple_members TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.couples TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.couple_members TO service_role;

CREATE OR REPLACE FUNCTION public.bump_membership_revision()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.couples
  SET membership_revision = membership_revision + 1
  WHERE id = COALESCE(NEW.couple_id, OLD.couple_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_membership_revision
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.couple_members
  FOR EACH ROW EXECUTE FUNCTION public.bump_membership_revision();

CREATE TABLE public.invitation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  used BOOLEAN NOT NULL DEFAULT false,
  used_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_invitation_codes_one_unused_hash
  ON public.invitation_codes (code_hash) WHERE used = false;

REVOKE ALL ON TABLE public.invitation_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invitation_codes TO service_role;

CREATE OR REPLACE FUNCTION public.consume_invitation(p_code_hash TEXT)
RETURNS UUID LANGUAGE sql
AS $$ SELECT NULL::UUID $$;

CREATE TABLE public.invitation_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  succeeded BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.account_deletion_requests (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  expected_record_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.deletion_test_control (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  e2ee_mode TEXT NOT NULL DEFAULT 'success',
  e2ee_calls INTEGER NOT NULL DEFAULT 0,
  prepare_calls INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.e2ee_prepare_account_deletion(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  INSERT INTO public.deletion_test_control (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT e2ee_mode INTO v_mode
  FROM public.deletion_test_control
  WHERE user_id = p_user_id;

  -- Deliberately write before a possible refusal. The wrapper test verifies
  -- that its nested PL/pgSQL subtransaction rolls this back exactly.
  UPDATE public.deletion_test_control
  SET e2ee_calls = e2ee_calls + 1
  WHERE user_id = p_user_id;

  IF v_mode = 'exact_orphan' THEN
    RAISE EXCEPTION
      'E2EE_DELETION_WOULD_ORPHAN_PARTNER: couple epoch % has no surviving envelope for the remaining partner',
      7
      USING ERRCODE = 'P0001';
  ELSIF v_mode = 'unrelated_p0001' THEN
    RAISE EXCEPTION 'unrelated application refusal' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('partner_remains', false, 'deleted_devices', 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(
  p_user_id UUID,
  p_expected_record_ids UUID[] DEFAULT '{}'::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  INSERT INTO public.deletion_test_control (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.deletion_test_control
  SET prepare_calls = prepare_calls + 1
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'records_deleted', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_prepare_account_deletion(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) TO service_role;

CREATE TABLE public.crypto_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN (
    'CRYPTO_PENDING', 'TRANSCRIPT_PROPOSED', 'CONFIRMED_ONE', 'CONFIRMED_BOTH',
    'EPOCH_PREPARING', 'CRYPTO_ACTIVE', 'TRANSCRIPT_EXPIRED',
    'TRANSCRIPT_REJECTED', 'UNLINKED'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.device_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE
);

CREATE TABLE public.push_delivery_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  has_unseen BOOLEAN NOT NULL DEFAULT false,
  claim_id UUID,
  claimed_at TIMESTAMPTZ,
  claimed_until TIMESTAMPTZ
);

INSERT INTO auth.users (id) VALUES
  ('${USERS.a}'), ('${USERS.b}'), ('${USERS.c}'), ('${USERS.d}'),
  ('${USERS.e}'), ('${USERS.f}'), ('${USERS.g}'), ('${USERS.outsider}'),
  ('${USERS.legacy}'), ('${USERS.h}'), ('${USERS.i}'), ('${USERS.j}'),
  ('${USERS.k}'), ('${USERS.l}'), ('${USERS.m}'), ('${USERS.n}'),
  ('${USERS.o}'), ('${USERS.p}'), ('${USERS.q}'), ('${USERS.r}'),
  ('${USERS.s}'), ('${USERS.t}'), ('${USERS.u}'), ('${USERS.v}'),
  ('${USERS.legacyDeletion}'), ('${USERS.w}'), ('${USERS.x}'),
  ('${USERS.y}'), ('${USERS.z}'), ('${USERS.aa}');

INSERT INTO public.profiles (id, display_name, role, username)
SELECT id, 'Fixture user', 'gomsin', 'fixture-' || right(id::TEXT, 4)
FROM auth.users;

INSERT INTO public.account_deletion_requests (user_id)
VALUES ('${USERS.legacyDeletion}');

INSERT INTO public.couples (id)
VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.couple_members (couple_id, user_id, role, status)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '${USERS.legacy}',
  'gomsin',
  'disconnected'
);
`;

describePostgres.sequential('migration 074 PostgreSQL 17 relationship lifecycle', () => {
  let root = '';
  let dataDirectory = '';
  let socketDirectory = '';
  let port = 0;
  let cleanupMigration = '';
  let snapshotMigration = '';
  let migration = '';

  const psqlArgs = (database = 'postgres') => [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-h', socketDirectory,
    '-p', String(port),
    '-d', database,
  ];

  const sql = (source: string, database = 'postgres'): CommandResult => command(
    join(PG_BIN!, 'psql'),
    psqlArgs(database),
    source,
  );

  const expectSql = (source: string, database = 'postgres'): string => {
    const result = sql(source, database);
    expect(result.status, result.stderr).toBe(0);
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

  const startHeldTransaction = (source: string, markerText: string) => {
    const child: ChildProcessWithoutNullStreams = spawn(
      join(PG_BIN!, 'psql'),
      psqlArgs(),
      { env: { ...process.env, LC_ALL: 'C' } },
    );
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });

    const marker = new Promise<void>((resolveMarker, rejectMarker) => {
      const timeout = setTimeout(
        () => rejectMarker(new Error(`${markerText} marker timed out`)),
        5_000,
      );
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.includes(markerText)) {
          clearTimeout(timeout);
          resolveMarker();
        }
      });
    });
    const completed = new Promise<CommandResult>((resolveResult) => {
      child.once('close', (status) => resolveResult({ status, stdout, stderr }));
    });
    child.stdin.end(source);
    return { marker, completed };
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'gomsinlog-074-'));
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

    expectSql(BASELINE);

    try {
      cleanupMigration = readFileSync(resolve(
        process.cwd(),
        'supabase/migrations/029_cleanup_solo_couples_on_account_deletion.sql',
      ), 'utf8');
      snapshotMigration = readFileSync(resolve(
        process.cwd(),
        'supabase/migrations/073_authoritative_relationship_snapshot.sql',
      ), 'utf8');
      migration = readFileSync(resolve(
        process.cwd(),
        'supabase/migrations/074_immutable_relationship_generation.sql',
      ), 'utf8');
    } catch {
      // Empty SQL keeps the RED state observable through missing functions below.
    }
    expectSql(cleanupMigration);
    expectSql(snapshotMigration);
    expectSql(migration);
  }, 30_000);

  afterAll(() => {
    if (dataDirectory && PG_BIN) {
      command(join(PG_BIN, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('fails the whole legacy backfill when ancillary authority cannot be safely attributed', () => {
    const cases = [
      {
        name: 'unused_invitation',
        error: 'relationship_generation_legacy_unused_invitation',
        setup: `
INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
VALUES ('10000000-0000-4000-8000-000000000001', '${'7'.repeat(64)}', '${USERS.legacy}');
`,
        preserved: `
SELECT count(*) FROM public.invitation_codes
WHERE couple_id = '10000000-0000-4000-8000-000000000001' AND used = false;
`,
      },
      {
        name: 'live_pairing',
        error: 'relationship_generation_legacy_live_pairing',
        setup: `
INSERT INTO public.crypto_pairings (couple_id, state)
VALUES ('10000000-0000-4000-8000-000000000001', 'CRYPTO_ACTIVE');
`,
        preserved: `
SELECT count(*) FROM public.crypto_pairings
WHERE couple_id = '10000000-0000-4000-8000-000000000001' AND state = 'CRYPTO_ACTIVE';
`,
      },
      {
        name: 'push_token',
        error: 'relationship_generation_legacy_push_token_ambiguous',
        setup: `
INSERT INTO public.couples (id)
VALUES ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.couple_members (couple_id, user_id, role, status)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  '${USERS.legacy}',
  'gomsin',
  'active'
);
INSERT INTO public.device_push_tokens (user_id, platform, token)
VALUES ('${USERS.legacy}', 'ios', 'legacy-token');
`,
        preserved: `
SELECT
  (SELECT count(*) FROM public.device_push_tokens WHERE user_id = '${USERS.legacy}')::TEXT
  || ':' ||
  (SELECT count(*) FROM public.couple_members
   WHERE user_id = '${USERS.legacy}' AND status = 'active')::TEXT;
`,
      },
      {
        name: 'delivery_state',
        error: 'relationship_generation_legacy_delivery_state_ambiguous',
        setup: `
INSERT INTO public.push_delivery_state (
  user_id, has_unseen, claim_id, claimed_at, claimed_until
)
VALUES (
  '${USERS.legacy}', true, gen_random_uuid(), now(), now() + interval '5 minutes'
);
`,
        preserved: `
SELECT count(*) FROM public.push_delivery_state
WHERE user_id = '${USERS.legacy}'
  AND (has_unseen OR claim_id IS NOT NULL OR claimed_at IS NOT NULL OR claimed_until IS NOT NULL);
`,
      },
    ] as const;

    for (const legacyCase of cases) {
      const database = `gomsinlog_074_${legacyCase.name}`;
      expectSql(`CREATE DATABASE ${database};`);
      try {
        expectSql(BASELINE, database);
        expectSql(cleanupMigration, database);
        expectSql(snapshotMigration, database);
        expectSql(legacyCase.setup, database);

        const blocked = sql(migration, database);
        expect(blocked.status).not.toBe(0);
        expect(blocked.stderr).toContain(legacyCase.error);
        expect(expectSql(legacyCase.preserved, database)).toBe(
          legacyCase.name === 'push_token' ? '1:1' : '1',
        );

        // ALTER TABLE and the backfill are inside the same transaction as the
        // preflight; refusal must leave even the additive column unapplied.
        expect(expectSql(`
SELECT count(*)
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'couples'
  AND column_name = 'closed_at';
`, database)).toBe('0');
      } finally {
        expectSql(`DROP DATABASE ${database} WITH (FORCE);`);
      }
    }
  }, 20_000);

  it('backfills a historical no-open-member generation without rewriting membership', () => {
    const result = expectSql(`
SELECT jsonb_build_object(
  'closed', relationship.closed_at IS NOT NULL,
  'status', member.status
)
FROM public.couples AS relationship
JOIN public.couple_members AS member ON member.couple_id = relationship.id
WHERE relationship.id = '10000000-0000-4000-8000-000000000001';
`);
    expect(JSON.parse(result)).toEqual({ closed: true, status: 'disconnected' });
  });

  it('backfills legacy deletion rows into a non-cancellable fail-closed phase', () => {
    const state = JSON.parse(expectSql(`
SELECT jsonb_build_object(
  'attempt_present', attempt_id IS NOT NULL,
  'phase', phase,
  'cancellation_allowed', cancellation_allowed,
  'phase_updated_present', phase_updated_at IS NOT NULL
)
FROM public.account_deletion_requests
WHERE user_id = '${USERS.legacyDeletion}';
`));
    expect(state).toEqual({
      attempt_present: true,
      phase: 'legacy_blocked',
      cancellation_allowed: false,
      phase_updated_present: true,
    });

    const tokenlessCancel = asActor(
      'service_role',
      null,
      `SELECT public.cancel_account_deletion('${USERS.legacyDeletion}');`,
    );
    expect(tokenlessCancel.status).not.toBe(0);
    expect(tokenlessCancel.stderr).toContain('account_deletion_attempt_required');
    expect(expectSql(`
SELECT count(*) FROM public.account_deletion_requests
WHERE user_id = '${USERS.legacyDeletion}';
`)).toBe('1');

    for (const mutation of [
      `UPDATE public.account_deletion_requests
       SET phase = 'media_cleanup', cancellation_allowed = false
       WHERE user_id = '${USERS.legacyDeletion}';`,
      `UPDATE public.account_deletion_requests
       SET phase = 'unknown_phase'
       WHERE user_id = '${USERS.legacyDeletion}';`,
    ]) {
      const invalid = sql(`BEGIN; ${mutation} COMMIT;`);
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toContain('account_deletion_requests_');
    }
  });

  it('fences concurrent begin so attempt A cannot cancel or mutate attempt B', async () => {
    const first = startHeldTransaction(`
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
SELECT public.begin_account_deletion_v2(
  '${USERS.p}', '{}'::UUID[], '${ATTEMPTS.a}'
);
\\echo FIRST_BEGIN_HELD
SELECT pg_sleep(0.7);
COMMIT;
`, 'FIRST_BEGIN_HELD');
    await first.marker;

    const startedAt = Date.now();
    const second = asActor('service_role', null, `
SELECT public.begin_account_deletion_v2(
  '${USERS.p}', '{}'::UUID[], '${ATTEMPTS.b}'
);
`);
    const blockedForMs = Date.now() - startedAt;
    const firstResult = await first.completed;
    expect(firstResult.status, `${firstResult.stdout}\n${firstResult.stderr}`).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(blockedForMs).toBeGreaterThanOrEqual(400);
    expect(JSON.parse(second.stdout.trim())).toMatchObject({
      ok: true,
      attempt_id: ATTEMPTS.b,
      phase: 'media_cleanup',
    });

    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.p}', '${ATTEMPTS.a}');
`).stdout.trim()).toBe('f');
    expect(expectSql(`
SELECT attempt_id::TEXT || ':' || phase || ':' || cancellation_allowed::TEXT
FROM public.account_deletion_requests
WHERE user_id = '${USERS.p}';
`)).toBe(`${ATTEMPTS.b}:media_cleanup:true`);

    for (const call of [
      `SELECT public.e2ee_prepare_account_deletion_v2('${USERS.p}', '${ATTEMPTS.a}');`,
      `SELECT public.prepare_account_deletion_v2('${USERS.p}', '{}'::UUID[], '${ATTEMPTS.a}');`,
      `SELECT public.close_account_relationship_generations_v2('${USERS.p}', '${ATTEMPTS.a}');`,
      `SELECT public.cleanup_account_solo_couples_v2('${USERS.p}', '${ATTEMPTS.a}');`,
    ]) {
      const stale = asActor('service_role', null, call);
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain('stale_account_deletion_attempt');
    }

    expect(expectSql(`
SELECT COALESCE((
  SELECT e2ee_calls::TEXT || ':' || prepare_calls::TEXT
  FROM public.deletion_test_control WHERE user_id = '${USERS.p}'
), '0:0');
`)).toBe('0:0');
    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.p}', '${ATTEMPTS.b}');
`).stdout.trim()).toBe('t');
  }, 10_000);

  it('allows cancellation only before E2EE and serializes cancel-vs-E2EE in both orders', () => {
    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.t}', '{}'::UUID[], '${ATTEMPTS.c}');
`).status).toBe(0);
    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.t}', '${ATTEMPTS.c}');
`).stdout.trim()).toBe('t');

    const e2eeAfterCancel = asActor('service_role', null, `
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.t}', '${ATTEMPTS.c}');
`);
    expect(e2eeAfterCancel.status).not.toBe(0);
    expect(e2eeAfterCancel.stderr).toContain('stale_account_deletion_attempt');

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.t}', '{}'::UUID[], '${ATTEMPTS.d}');
`).status).toBe(0);
    const e2eeFirst = asActor('service_role', null, `
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.t}', '${ATTEMPTS.d}');
`);
    expect(e2eeFirst.status, e2eeFirst.stderr).toBe(0);
    expect(JSON.parse(e2eeFirst.stdout.trim())).toMatchObject({
      ok: true,
      phase: 'e2ee_prepared',
    });
    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.t}', '${ATTEMPTS.d}');
`).stdout.trim()).toBe('f');
    expect(expectSql(`
SELECT phase || ':' || cancellation_allowed::TEXT
FROM public.account_deletion_requests WHERE user_id = '${USERS.t}';
`)).toBe('e2ee_prepared:false');

    const retryBegin = asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.t}', '{}'::UUID[], '${ATTEMPTS.e}');
`);
    expect(retryBegin.status, retryBegin.stderr).toBe(0);
    expect(JSON.parse(retryBegin.stdout.trim())).toMatchObject({
      ok: true,
      attempt_id: ATTEMPTS.e,
      phase: 'e2ee_prepared',
    });
    const oldAttemptPrepare = asActor('service_role', null, `
SELECT public.prepare_account_deletion_v2('${USERS.t}', '{}'::UUID[], '${ATTEMPTS.d}');
`);
    expect(oldAttemptPrepare.status).not.toBe(0);
    expect(oldAttemptPrepare.stderr).toContain('stale_account_deletion_attempt');
    const retryPrepare = asActor('service_role', null, `
SELECT public.prepare_account_deletion_v2('${USERS.t}', '{}'::UUID[], '${ATTEMPTS.e}');
`);
    expect(retryPrepare.status, retryPrepare.stderr).toBe(0);
    expect(JSON.parse(retryPrepare.stdout.trim())).toMatchObject({
      ok: true,
      phase: 'relational_prepared',
    });
  });

  it('queues real cancel-vs-E2EE races and honors whichever fence transition commits first', async () => {
    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.u}', '{}'::UUID[], '${ATTEMPTS.a}');
`).status).toBe(0);

    const e2eeFirst = startHeldTransaction(`
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.u}', '${ATTEMPTS.a}');
\\echo E2EE_PHASE_HELD
SELECT pg_sleep(0.7);
COMMIT;
`, 'E2EE_PHASE_HELD');
    await e2eeFirst.marker;
    const cancelStartedAt = Date.now();
    const cancelAfterE2ee = asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.u}', '${ATTEMPTS.a}');
`);
    const cancelBlockedForMs = Date.now() - cancelStartedAt;
    const e2eeResult = await e2eeFirst.completed;
    expect(e2eeResult.status, `${e2eeResult.stdout}\n${e2eeResult.stderr}`).toBe(0);
    expect(cancelBlockedForMs).toBeGreaterThanOrEqual(400);
    expect(cancelAfterE2ee.status, cancelAfterE2ee.stderr).toBe(0);
    expect(cancelAfterE2ee.stdout.trim()).toBe('f');

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.aa}', '{}'::UUID[], '${ATTEMPTS.b}');
`).status).toBe(0);
    const cancelFirst = startHeldTransaction(`
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
SELECT public.cancel_account_deletion_v2('${USERS.aa}', '${ATTEMPTS.b}');
\\echo CANCEL_PHASE_HELD
SELECT pg_sleep(0.7);
COMMIT;
`, 'CANCEL_PHASE_HELD');
    await cancelFirst.marker;
    const e2eeStartedAt = Date.now();
    const e2eeAfterCancel = asActor('service_role', null, `
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.aa}', '${ATTEMPTS.b}');
`);
    const e2eeBlockedForMs = Date.now() - e2eeStartedAt;
    const cancelResult = await cancelFirst.completed;
    expect(cancelResult.status, `${cancelResult.stdout}\n${cancelResult.stderr}`).toBe(0);
    expect(e2eeBlockedForMs).toBeGreaterThanOrEqual(400);
    expect(e2eeAfterCancel.status).not.toBe(0);
    expect(e2eeAfterCancel.stderr).toContain('stale_account_deletion_attempt');
  }, 10_000);

  it('returns a structured rollback only for the exact E2EE orphan refusal', () => {
    expectSql(`
INSERT INTO public.deletion_test_control (user_id, e2ee_mode)
VALUES ('${USERS.r}', 'exact_orphan'), ('${USERS.s}', 'unrelated_p0001');
`);

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.r}', '{}'::UUID[], '${ATTEMPTS.e}');
`).status).toBe(0);
    const exact = asActor('service_role', null, `
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.r}', '${ATTEMPTS.e}');
`);
    expect(exact.status, exact.stderr).toBe(0);
    expect(JSON.parse(exact.stdout.trim())).toEqual({
      ok: false,
      phase: 'media_cleanup',
      refusal_code: 'e2ee_would_orphan_partner',
      rollback_confirmed: true,
    });
    expect(expectSql(`
SELECT e2ee_calls FROM public.deletion_test_control WHERE user_id = '${USERS.r}';
`)).toBe('0');
    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.r}', '${ATTEMPTS.e}');
`).stdout.trim()).toBe('t');

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.s}', '{}'::UUID[], '${ATTEMPTS.f}');
`).status).toBe(0);
    const unrelated = asActor('service_role', null, `
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.s}', '${ATTEMPTS.f}');
`);
    expect(unrelated.status).not.toBe(0);
    expect(unrelated.stderr).toContain('unrelated application refusal');
    expect(expectSql(`
SELECT e2ee_calls FROM public.deletion_test_control WHERE user_id = '${USERS.s}';
`)).toBe('0');
    expect(expectSql(`
SELECT attempt_id::TEXT || ':' || phase || ':' || cancellation_allowed::TEXT
FROM public.account_deletion_requests WHERE user_id = '${USERS.s}';
`)).toBe(`${ATTEMPTS.f}:media_cleanup:true`);
    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.s}', '${ATTEMPTS.f}');
`).stdout.trim()).toBe('t');
  });

  it('denies weak/no-claim actors and permits only a claimed service role', () => {
    for (const actor of [
      asActor('anon', null, `SELECT public.begin_account_deletion_v2('${USERS.q}', '{}'::UUID[], '${ATTEMPTS.g}');`),
      asActor('authenticated', USERS.q, `SELECT public.begin_account_deletion_v2('${USERS.q}', '{}'::UUID[], '${ATTEMPTS.g}');`),
    ]) {
      expect(actor.status).not.toBe(0);
      expect(actor.stderr).toContain('permission denied for function');
    }

    const noClaim = sql(`
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.begin_account_deletion_v2('${USERS.q}', '{}'::UUID[], '${ATTEMPTS.g}');
COMMIT;
`);
    expect(noClaim.status).not.toBe(0);
    expect(noClaim.stderr).toContain('Service role required');

    const claimed = asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.q}', '{}'::UUID[], '${ATTEMPTS.g}');
`);
    expect(claimed.status, claimed.stderr).toBe(0);

    for (const legacyCall of [
      `SELECT public.begin_account_deletion('${USERS.q}', '{}'::UUID[]);`,
      `SELECT public.cancel_account_deletion('${USERS.q}');`,
      `SELECT public.prepare_account_deletion('${USERS.q}', '{}'::UUID[]);`,
      `SELECT public.cleanup_account_solo_couples('${USERS.q}');`,
    ]) {
      const legacy = asActor('service_role', null, legacyCall);
      expect(legacy.status).not.toBe(0);
      expect(legacy.stderr).toContain('account_deletion_attempt_required');
    }

    for (const internalCall of [
      `SELECT public.e2ee_prepare_account_deletion('${USERS.q}');`,
      `SELECT public.close_account_relationship_generations('${USERS.q}');`,
      `SELECT public.lock_account_deletion_attempt_v2('${USERS.q}', '${ATTEMPTS.g}');`,
      `SELECT public.e2ee_prepare_account_deletion_internal_074('${USERS.q}');`,
      `SELECT public.prepare_account_deletion_internal_074('${USERS.q}', '{}'::UUID[]);`,
      `SELECT public.cleanup_account_solo_couples_internal_074('${USERS.q}');`,
      `SELECT public.close_account_relationship_generations_internal_074('${USERS.q}');`,
    ]) {
      const legacy = asActor('service_role', null, internalCall);
      expect(legacy.status).not.toBe(0);
      expect(legacy.stderr).toContain('permission denied for function');
    }

    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.q}', '${ATTEMPTS.g}');
`).stdout.trim()).toBe('t');
  });

  it('blocks the deleted-member reuse exploit, identity moves, forged capabilities, and direct client DML', () => {
    const couple = expectUser(
      USERS.h,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.mutation}');`,
    );
    expect(JSON.parse(expectUser(
      USERS.i,
      `SELECT public.redeem_invitation('${HASH.mutation}');`,
    ))).toMatchObject({ ok: true, couple_id: couple });

    const targetCouple = expectUser(
      USERS.j,
      `SELECT public.create_couple_and_invitation('soldier', '${HASH.target}');`,
    );

    // PostgreSQL 17 reproduction of the reported exploit. Without the DELETE
    // guard, H disappears, I regenerates an invitation, and C joins the exact
    // same relationship UUID. ROLLBACK keeps the fixture reusable either way.
    const reuseExploit = sql(`
BEGIN;
DELETE FROM public.couple_members
WHERE couple_id = '${couple}' AND user_id = '${USERS.h}';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '${USERS.i}';
SELECT public.regenerate_invitation('${HASH.mutationReuse}');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '${USERS.c}';
SELECT public.redeem_invitation('${HASH.mutationReuse}');
ROLLBACK;
`);
    expect(reuseExploit.status).not.toBe(0);
    expect(reuseExploit.stderr).toContain('open_relationship_membership_delete_forbidden');

    const userMove = sql(`
BEGIN;
UPDATE public.couple_members
SET user_id = '${USERS.k}'
WHERE couple_id = '${couple}' AND user_id = '${USERS.h}';
ROLLBACK;
`);
    expect(userMove.status).not.toBe(0);
    expect(userMove.stderr).toContain('relationship_membership_identity_immutable');

    const coupleMove = sql(`
BEGIN;
UPDATE public.couple_members
SET couple_id = '${targetCouple}'
WHERE couple_id = '${couple}' AND user_id = '${USERS.h}';
ROLLBACK;
`);
    expect(coupleMove.status).not.toBe(0);
    expect(coupleMove.stderr).toContain('relationship_membership_identity_immutable');

    const authenticatedDelete = asUser(
      USERS.h,
      `DELETE FROM public.couple_members
       WHERE couple_id = '${couple}' AND user_id = '${USERS.h}';`,
    );
    expect(authenticatedDelete.status).not.toBe(0);
    expect(authenticatedDelete.stderr).toContain('permission denied');

    const forgedAuthenticatedClose = asUser(USERS.h, `
SELECT set_config('gomsinlog.relationship_terminal_close', 'on', true);
UPDATE public.couples SET closed_at = now() WHERE id = '${couple}';
`);
    expect(forgedAuthenticatedClose.status).not.toBe(0);
    expect(forgedAuthenticatedClose.stderr).toContain('permission denied');

    const emptyCouple = expectSql(`
INSERT INTO public.couples DEFAULT VALUES RETURNING id;
`);
    const forgedServiceClose = asActor('service_role', null, `
SELECT set_config('gomsinlog.relationship_terminal_close', 'on', true);
UPDATE public.couples SET closed_at = now() WHERE id = '${emptyCouple}';
`);
    expect(forgedServiceClose.status).not.toBe(0);
    expect(forgedServiceClose.stderr).toContain('relationship_generation_close_not_authorized');

    expect(expectUser(USERS.h, `
WITH changed AS (
  UPDATE public.couples
  SET anniversary_date = DATE '2026-09-03', updated_at = now()
  WHERE id = '${couple}'
  RETURNING 1
)
SELECT count(*) FROM changed;
`)).toBe('1');

    expect(expectUser(USERS.outsider, `
WITH changed AS (
  UPDATE public.couples
  SET anniversary_date = DATE '2026-09-04', updated_at = now()
  WHERE id = '${couple}'
  RETURNING 1
)
SELECT count(*) FROM changed;
`)).toBe('0');

    const anonCreate = asActor(
      'anon',
      null,
      `SELECT public.create_couple_and_invitation('gomsin', '${'8'.repeat(64)}');`,
    );
    expect(anonCreate.status).not.toBe(0);
    expect(anonCreate.stderr).toContain('permission denied for function');
  });

  it('blocks every invitation and membership path when any relevant account is deleting', () => {
    const partnerCouple = expectUser(
      USERS.v,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.legacyBlocked}');`,
    );
    expect(JSON.parse(expectUser(
      USERS.w,
      `SELECT public.redeem_invitation('${HASH.legacyBlocked}');`,
    ))).toMatchObject({ ok: true, couple_id: partnerCouple });

    const reissueHash = 'b3'.repeat(32);
    expect(asActor('service_role', null, `
INSERT INTO public.invitation_codes (
  couple_id, code_hash, created_by, expires_at
) VALUES (
  '${partnerCouple}', '${reissueHash}', '${USERS.v}',
  CURRENT_TIMESTAMP - INTERVAL '1 hour'
);
`).status).toBe(0);

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.w}', '{}'::UUID[], '${ATTEMPTS.a}');
`).status).toBe(0);

    const directReissueBlocked = asActor('service_role', null, `
UPDATE public.invitation_codes
SET expires_at = CURRENT_TIMESTAMP + INTERVAL '1 hour'
WHERE code_hash = '${reissueHash}';
`);
    expect(directReissueBlocked.status).not.toBe(0);
    expect(directReissueBlocked.stderr).toContain('relationship_deletion_pending');

    const legacyCreateBlocked = asUser(USERS.v, `
SELECT public.create_invitation('${partnerCouple}', '${'c3'.repeat(32)}');
`);
    expect(legacyCreateBlocked.status).not.toBe(0);
    expect(legacyCreateBlocked.stderr).toContain('relationship_deletion_pending');

    const regenerateBlocked = asUser(
      USERS.v,
      `SELECT public.regenerate_invitation('${'d4'.repeat(32)}');`,
    );
    expect(regenerateBlocked.status).not.toBe(0);
    expect(regenerateBlocked.stderr).toContain('relationship_deletion_pending');

    const directInsertBlocked = asActor('service_role', null, `
INSERT INTO public.couple_members (couple_id, user_id, role, status)
VALUES ('${partnerCouple}', '${USERS.x}', 'soldier', 'pending');
`);
    expect(directInsertBlocked.status).not.toBe(0);
    expect(directInsertBlocked.stderr).toContain('relationship_deletion_pending');

    const directInvitationBlocked = asActor('service_role', null, `
INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
VALUES ('${partnerCouple}', '${'f6'.repeat(32)}', '${USERS.v}');
`);
    expect(directInvitationBlocked.status).not.toBe(0);
    expect(directInvitationBlocked.stderr).toContain('relationship_deletion_pending');

    const authenticatedInvitationDml = asUser(USERS.v, `
INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
VALUES ('${partnerCouple}', '${'07'.repeat(32)}', '${USERS.v}');
`);
    expect(authenticatedInvitationDml.status).not.toBe(0);
    expect(authenticatedInvitationDml.stderr).toContain('permission denied');

    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.w}', '${ATTEMPTS.a}');
`).stdout.trim()).toBe('t');

    const creatorCouple = expectUser(
      USERS.y,
      `SELECT public.create_couple_and_invitation('soldier', '${HASH.deletionPartner}');`,
    );
    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.y}', '{}'::UUID[], '${ATTEMPTS.b}');
`).status).toBe(0);

    const creatorMarked = JSON.parse(expectUser(
      USERS.z,
      `SELECT public.redeem_invitation('${HASH.deletionPartner}');`,
    ));
    expect(creatorMarked).toMatchObject({
      ok: false,
      couple_id: null,
      error_code: 'invalid_or_expired',
    });

    const creatorLegacyBlocked = asUser(USERS.y, `
SELECT public.create_invitation('${creatorCouple}', '${'e5'.repeat(32)}');
`);
    expect(creatorLegacyBlocked.status).not.toBe(0);
    expect(creatorLegacyBlocked.stderr).toContain('relationship_deletion_pending');

    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.y}', '${ATTEMPTS.b}');
`).stdout.trim()).toBe('t');

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.z}', '{}'::UUID[], '${ATTEMPTS.c}');
`).status).toBe(0);
    const inviteeMarked = JSON.parse(expectUser(
      USERS.z,
      `SELECT public.redeem_invitation('${HASH.deletionPartner}');`,
    ));
    expect(inviteeMarked).toMatchObject({
      ok: false,
      couple_id: null,
      error_code: 'invalid_request',
    });
    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.z}', '${ATTEMPTS.c}');
`).stdout.trim()).toBe('t');

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.x}', '{}'::UUID[], '${ATTEMPTS.d}');
`).status).toBe(0);
    const subjectMarked = asActor('service_role', null, `
INSERT INTO public.couple_members (couple_id, user_id, role, status)
VALUES ('${creatorCouple}', '${USERS.x}', 'gomsin', 'active');
`);
    expect(subjectMarked.status).not.toBe(0);
    expect(subjectMarked.stderr).toContain('relationship_deletion_pending');
    expect(asActor('service_role', null, `
SELECT public.cancel_account_deletion_v2('${USERS.x}', '${ATTEMPTS.d}');
`).stdout.trim()).toBe('t');
  });

  it('disconnects A+B atomically, invalidates stale authority, and forces B onto a new couple id', () => {
    const oldCouple = expectUser(
      USERS.a,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.ab}');`,
    );
    const redeemed = JSON.parse(expectUser(
      USERS.b,
      `SELECT public.redeem_invitation('${HASH.ab}');`,
    ));
    expect(redeemed).toMatchObject({ ok: true, couple_id: oldCouple, error_code: null });
    expect(JSON.parse(expectUser(
      USERS.a,
      'SELECT public.get_my_relationship_snapshot_v2();',
    ))).toMatchObject({
      contract_version: 2,
      lifecycle: 'active',
      couple_id: oldCouple,
      partner: { user_id: USERS.b },
    });

    expectSql(`
INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
VALUES ('${oldCouple}', '${HASH.stale}', '${USERS.a}');
INSERT INTO public.crypto_pairings (couple_id, state)
VALUES ('${oldCouple}', 'CRYPTO_ACTIVE');
INSERT INTO public.device_push_tokens (user_id, platform, token)
VALUES ('${USERS.a}', 'ios', 'token-a'), ('${USERS.b}', 'android', 'token-b');
INSERT INTO public.push_delivery_state (
  user_id, has_unseen, claim_id, claimed_at, claimed_until
)
VALUES
  ('${USERS.a}', true, gen_random_uuid(), now(), now() + interval '5 minutes'),
  ('${USERS.b}', true, gen_random_uuid(), now(), now() + interval '5 minutes');
`);

    expectUser(USERS.a, 'SELECT public.disconnect_couple();');
    const state = JSON.parse(expectSql(`
SELECT jsonb_build_object(
  'closed', relationship.closed_at IS NOT NULL,
  'active_members', count(*) FILTER (WHERE member.status IN ('active', 'pending')),
  'disconnected_members', count(*) FILTER (WHERE member.status = 'disconnected'),
  'unused_invites', (SELECT count(*) FROM public.invitation_codes WHERE couple_id = relationship.id AND used = false),
  'live_pairings', (SELECT count(*) FROM public.crypto_pairings WHERE couple_id = relationship.id AND state <> 'UNLINKED'),
  'tokens', (SELECT count(*) FROM public.device_push_tokens WHERE user_id IN ('${USERS.a}', '${USERS.b}')),
  'unseen', (SELECT count(*) FROM public.push_delivery_state WHERE user_id IN ('${USERS.a}', '${USERS.b}') AND (has_unseen OR claim_id IS NOT NULL OR claimed_at IS NOT NULL OR claimed_until IS NOT NULL))
)
FROM public.couples AS relationship
JOIN public.couple_members AS member ON member.couple_id = relationship.id
WHERE relationship.id = '${oldCouple}'
GROUP BY relationship.id;
`));
    expect(state).toEqual({
      closed: true,
      active_members: 0,
      disconnected_members: 2,
      unused_invites: 0,
      live_pairings: 0,
      tokens: 0,
      unseen: 0,
    });
    expect(JSON.parse(expectUser(
      USERS.a,
      'SELECT public.get_my_relationship_snapshot_v2();',
    ))).toMatchObject({
      contract_version: 2,
      lifecycle: 'disconnected',
      couple_id: oldCouple,
      partner: null,
    });

    const staleRedeem = JSON.parse(expectUser(
      USERS.c,
      `SELECT public.redeem_invitation('${HASH.stale}');`,
    ));
    expect(staleRedeem).toMatchObject({ ok: false, error_code: 'invalid_or_expired' });

    const lateInvitation = sql(`
INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
VALUES ('${oldCouple}', '${HASH.rejectedAfterClose}', '${USERS.a}');
`);
    expect(lateInvitation.status).not.toBe(0);
    expect(lateInvitation.stderr).toContain('closed_relationship_generation');

    const reactivation = sql(`
UPDATE public.couple_members
SET status = 'active'
WHERE couple_id = '${oldCouple}' AND user_id = '${USERS.b}';
`);
    expect(reactivation.status).not.toBe(0);
    expect(reactivation.stderr).toContain('closed_relationship_generation');

    const reopen = sql(`UPDATE public.couples SET closed_at = NULL WHERE id = '${oldCouple}';`);
    expect(reopen.status).not.toBe(0);
    expect(reopen.stderr).toContain('relationship_generation_is_terminal');

    const newCouple = expectUser(
      USERS.b,
      `SELECT public.create_couple_and_invitation('soldier', '${HASH.bNew}');`,
    );
    expect(newCouple).not.toBe(oldCouple);
  });

  it('uses fenced service-only legal phases for account deletion and denies every weaker actor', () => {
    const oldCouple = expectUser(
      USERS.d,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.de}');`,
    );
    expect(JSON.parse(expectUser(
      USERS.e,
      `SELECT public.redeem_invitation('${HASH.de}');`,
    ))).toMatchObject({ ok: true, couple_id: oldCouple });

    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.d}', '{}'::UUID[], '${ATTEMPTS.e}');
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.d}', '${ATTEMPTS.e}');
SELECT public.prepare_account_deletion_v2('${USERS.d}', '{}'::UUID[], '${ATTEMPTS.e}');
`).status).toBe(0);

    const authenticated = asUser(
      USERS.d,
      `SELECT public.close_account_relationship_generations_v2('${USERS.d}', '${ATTEMPTS.e}');`,
    );
    expect(authenticated.status).not.toBe(0);
    expect(authenticated.stderr).toContain('permission denied for function');

    const anon = asActor(
      'anon',
      null,
      `SELECT public.close_account_relationship_generations_v2('${USERS.d}', '${ATTEMPTS.e}');`,
    );
    expect(anon.status).not.toBe(0);
    expect(anon.stderr).toContain('permission denied for function');

    const serviceWithoutClaim = sql(`
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.close_account_relationship_generations_v2('${USERS.d}', '${ATTEMPTS.e}');
COMMIT;
`);
    expect(serviceWithoutClaim.status).not.toBe(0);
    expect(serviceWithoutClaim.stderr).toContain('Service role required');

    const first = asActor(
      'service_role',
      null,
      `SELECT public.close_account_relationship_generations_v2('${USERS.d}', '${ATTEMPTS.e}');`,
    );
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout.trim())).toEqual({
      ok: true,
      phase: 'relationships_closed',
      closed_count: 1,
    });

    const second = asActor(
      'service_role',
      null,
      `SELECT public.close_account_relationship_generations_v2('${USERS.d}', '${ATTEMPTS.e}');`,
    );
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout.trim())).toMatchObject({
      ok: true,
      phase: 'relationships_closed',
      closed_count: 0,
    });

    const unrelated = asUser(USERS.outsider, 'SELECT public.disconnect_couple();');
    expect(unrelated.status).not.toBe(0);
    expect(unrelated.stderr).toContain('Active couple not found');

    const newCouple = expectUser(
      USERS.e,
      `SELECT public.create_couple_and_invitation('soldier', '${HASH.eNew}');`,
    );
    expect(newCouple).not.toBe(oldCouple);

    const soloCouple = expectUser(
      USERS.k,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.soloDeletion}');`,
    );
    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.k}', '{}'::UUID[], '${ATTEMPTS.f}');
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.k}', '${ATTEMPTS.f}');
SELECT public.prepare_account_deletion_v2('${USERS.k}', '{}'::UUID[], '${ATTEMPTS.f}');
`).status).toBe(0);
    const soloClose = asActor(
      'service_role',
      null,
      `SELECT public.close_account_relationship_generations_v2('${USERS.k}', '${ATTEMPTS.f}');`,
    );
    expect(soloClose.status, soloClose.stderr).toBe(0);
    expect(JSON.parse(soloClose.stdout.trim())).toEqual({
      ok: true,
      phase: 'relationships_closed',
      closed_count: 1,
    });

    const soloCleanup = asActor(
      'service_role',
      null,
      `SELECT public.cleanup_account_solo_couples_v2('${USERS.k}', '${ATTEMPTS.f}');`,
    );
    expect(soloCleanup.status, soloCleanup.stderr).toBe(0);
    expect(JSON.parse(soloCleanup.stdout.trim())).toEqual({
      ok: true,
      phase: 'solo_cleanup_complete',
      deleted_count: 1,
    });
    expect(expectSql(`SELECT count(*) FROM public.couples WHERE id = '${soloCouple}';`)).toBe('0');
  });

  it('serializes relationship creation behind account close and preserves the deletion barrier', async () => {
    const couple = expectUser(
      USERS.l,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.accountRace}');`,
    );
    expect(JSON.parse(expectUser(
      USERS.m,
      `SELECT public.redeem_invitation('${HASH.accountRace}');`,
    ))).toMatchObject({ ok: true, couple_id: couple });
    expect(asActor('service_role', null, `
SELECT public.begin_account_deletion_v2('${USERS.l}', '{}'::UUID[], '${ATTEMPTS.g}');
SELECT public.e2ee_prepare_account_deletion_v2('${USERS.l}', '${ATTEMPTS.g}');
SELECT public.prepare_account_deletion_v2('${USERS.l}', '{}'::UUID[], '${ATTEMPTS.g}');
`).status).toBe(0);

    const closer = startHeldTransaction(`
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
SELECT public.close_account_relationship_generations_v2('${USERS.l}', '${ATTEMPTS.g}');
\\echo ACCOUNT_CLOSE_HELD
SELECT pg_sleep(0.9);
COMMIT;
`, 'ACCOUNT_CLOSE_HELD');
    await closer.marker;

    const startedAt = Date.now();
    const create = asUser(
      USERS.l,
      `SELECT public.create_couple_and_invitation(
        'gomsin', '${HASH.accountCreateAfterClose}'
      );`,
    );
    const blockedForMs = Date.now() - startedAt;

    const closeResult = await closer.completed;
    expect(closeResult.status, `${closeResult.stdout}\n${closeResult.stderr}`).toBe(0);
    expect(blockedForMs).toBeGreaterThanOrEqual(500);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain('Account deletion pending');
    expect(expectSql(`
SELECT (closed_at IS NOT NULL)::TEXT || ':' || (
  SELECT count(*) FROM public.couple_members
  WHERE couple_id = '${couple}' AND status IN ('active', 'pending')
)::TEXT
FROM public.couples WHERE id = '${couple}';
`)).toBe('true:0');
  }, 10_000);

  it('serializes invitation regeneration behind disconnect and never reopens that generation', async () => {
    const couple = expectUser(
      USERS.n,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.regenerateRace}');`,
    );
    expect(JSON.parse(expectUser(
      USERS.o,
      `SELECT public.redeem_invitation('${HASH.regenerateRace}');`,
    ))).toMatchObject({ ok: true, couple_id: couple });

    const closer = startHeldTransaction(`
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '${USERS.n}';
SELECT public.disconnect_couple();
\\echo DISCONNECT_HELD
SELECT pg_sleep(0.9);
COMMIT;
`, 'DISCONNECT_HELD');
    await closer.marker;

    const startedAt = Date.now();
    const regenerate = asUser(
      USERS.n,
      `SELECT public.regenerate_invitation('${HASH.regenerateAfterClose}');`,
    );
    const blockedForMs = Date.now() - startedAt;

    const closeResult = await closer.completed;
    expect(closeResult.status, `${closeResult.stdout}\n${closeResult.stderr}`).toBe(0);
    expect(blockedForMs).toBeGreaterThanOrEqual(500);
    expect(regenerate.status).not.toBe(0);
    expect(regenerate.stderr).toContain('relationship_participant_set_changed');
    expect(expectSql(`
SELECT (closed_at IS NOT NULL)::TEXT || ':' || (
  SELECT count(*) FROM public.invitation_codes
  WHERE couple_id = '${couple}' AND used = false
)::TEXT
FROM public.couples WHERE id = '${couple}';
`)).toBe('true:0');
  }, 10_000);

  it('serializes a redeem behind an uncommitted close and returns no access to the closed generation', async () => {
    const couple = expectUser(
      USERS.f,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.fg}');`,
    );

    const closeSql = `
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '${USERS.f}';
SELECT public.disconnect_couple();
\\echo CLOSE_HELD
SELECT pg_sleep(0.9);
COMMIT;
`;
    const closer: ChildProcessWithoutNullStreams = spawn(
      join(PG_BIN!, 'psql'),
      psqlArgs(),
      { env: { ...process.env, LC_ALL: 'C' } },
    );
    let closeStdout = '';
    let closeStderr = '';
    closer.stderr.on('data', (chunk) => { closeStderr += String(chunk); });

    const marker = new Promise<void>((resolveMarker, rejectMarker) => {
      const timeout = setTimeout(() => rejectMarker(new Error('close lock marker timed out')), 5_000);
      closer.stdout.on('data', (chunk) => {
        closeStdout += String(chunk);
        if (closeStdout.includes('CLOSE_HELD')) {
          clearTimeout(timeout);
          resolveMarker();
        }
      });
    });
    closer.stdin.end(closeSql);
    await marker;

    const startedAt = Date.now();
    const redeem = asUser(
      USERS.g,
      `SELECT public.redeem_invitation('${HASH.fg}');`,
    );
    const blockedForMs = Date.now() - startedAt;

    const closeStatus = await new Promise<number | null>((resolveStatus) => {
      closer.once('close', resolveStatus);
    });
    expect(closeStatus, `${closeStdout}\n${closeStderr}`).toBe(0);
    expect(redeem.status, redeem.stderr).toBe(0);
    expect(blockedForMs).toBeGreaterThanOrEqual(500);
    expect(JSON.parse(redeem.stdout.trim())).toMatchObject({
      ok: false,
      couple_id: null,
      error_code: 'invalid_or_expired',
    });

    const finalState = expectSql(`
SELECT (closed_at IS NOT NULL)::TEXT || ':' || (
  SELECT count(*) FROM public.couple_members
  WHERE couple_id = '${couple}' AND status IN ('active', 'pending')
)::TEXT
FROM public.couples WHERE id = '${couple}';
`);
    expect(finalState).toBe('true:0');
  }, 10_000);
});
