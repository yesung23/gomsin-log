import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/087_immutable_daily_record_created_at.sql',
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

type CommandResult = { status: number | null; stdout: string; stderr: string };

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      'i',
    ),
  );
  return match?.[1] ?? '';
}

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
  return [
    '/opt/homebrew/opt/postgresql@17/bin',
    '/usr/local/opt/postgresql@17/bin',
  ].find((candidate) => existsSync(join(candidate, 'initdb'))) ?? null;
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
const describePostgres = PG_BIN && migration ? describe : describe.skip;

const OWNER_ID = '87000000-0000-4000-8000-000000000001';
const PARTNER_ID = '87000000-0000-4000-8000-000000000002';
const THIRD_PARTY_ID = '87000000-0000-4000-8000-000000000003';
const COUPLE_ID = '87000000-0000-4000-8000-000000000004';
const RECORD_ID = '87000000-0000-4000-8000-000000000005';
const MEDIA_OPERATION_ID = '87000000-0000-4000-8000-000000000006';

const PRE_087_SCHEMA = `
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
END
$roles$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $fn$;
CREATE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $fn$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

CREATE TABLE public.daily_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  couple_id UUID NOT NULL,
  record_date DATE NOT NULL,
  log_text TEXT NOT NULL DEFAULT '',
  is_private BOOLEAN NOT NULL DEFAULT false,
  attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
  media_manifest_revision BIGINT NOT NULL DEFAULT 0,
  last_media_operation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, UPDATE ON public.daily_records TO anon, authenticated, service_role;
CREATE POLICY daily_records_owner_update
  ON public.daily_records
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY daily_records_owner_select
  ON public.daily_records
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE FUNCTION public.enforce_daily_record_identity_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.couple_id IS DISTINCT FROM NEW.couple_id
  THEN
    RAISE EXCEPTION 'daily_record_identity_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_daily_record_identity_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aab_085_daily_record_identity_immutable
  BEFORE UPDATE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_daily_record_identity_immutable();

CREATE TABLE public.media_trigger_audit (
  record_id UUID NOT NULL,
  operation_id UUID NOT NULL
);
CREATE FUNCTION public.test_media_commit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.last_media_operation_id IS DISTINCT FROM NEW.last_media_operation_id
    AND NEW.last_media_operation_id IS NOT NULL
  THEN
    INSERT INTO public.media_trigger_audit (record_id, operation_id)
    VALUES (NEW.id, NEW.last_media_operation_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zzz_084_commit_record_media_mutation
  BEFORE UPDATE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.test_media_commit_trigger();

INSERT INTO public.daily_records (
  id,
  user_id,
  couple_id,
  record_date,
  log_text,
  created_at
)
VALUES (
  '${RECORD_ID}',
  '${OWNER_ID}',
  '${COUPLE_ID}',
  DATE '2026-09-05',
  'before',
  TIMESTAMPTZ '2026-09-05T01:02:03.123456Z'
);
`;

describe('migration 087 immutable daily record created_at contract', () => {
  it('fails closed unless the exact 085 function and trigger binding exist', () => {
    expect(migration, 'migration 087 must exist').not.toBe('');
    const preflightAt = migration.indexOf('DO $preflight$');
    const replacementAt = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.enforce_daily_record_identity_immutable()',
    );
    expect(preflightAt).toBeGreaterThan(-1);
    expect(replacementAt).toBeGreaterThan(preflightAt);
    expect(migration).toMatch(/to_regprocedure\(\s*'public\.enforce_daily_record_identity_immutable\(\)'\s*\)/i);
    expect(migration).toMatch(/tgname\s*=\s*'aab_085_daily_record_identity_immutable'/i);
    expect(migration).toMatch(/tgrelid\s*=\s*v_table_oid/i);
    expect(migration).toMatch(/tgfoid\s*=\s*v_function_oid/i);
    expect(migration).toMatch(/tgtype\s*=\s*19/i);
    expect(migration).toMatch(/tgenabled\s*=\s*'O'/i);
    expect(migration).toMatch(/NOT\s+tgisinternal/i);
    expect(migration).toMatch(/attname\s*=\s*'created_at'/i);
    expect(migration).toMatch(/atttypid\s*=\s*'timestamp with time zone'::regtype/i);
    expect(migration).toMatch(/attnotnull/i);
    expect(migration).toMatch(/NOT\s+attisdropped/i);
    expect(migration).toMatch(/ERRCODE\s*=\s*'55000'/i);
  });

  it('extends the existing immutable identity function with created_at', () => {
    const body = functionBody('enforce_daily_record_identity_immutable');
    expect(body).toMatch(/OLD\.id IS DISTINCT FROM NEW\.id/i);
    expect(body).toMatch(/OLD\.user_id IS DISTINCT FROM NEW\.user_id/i);
    expect(body).toMatch(/OLD\.couple_id IS DISTINCT FROM NEW\.couple_id/i);
    expect(body).toMatch(/OLD\.created_at IS DISTINCT FROM NEW\.created_at/i);
    expect(body).toMatch(/daily_record_created_at_immutable/i);
    expect(body).toMatch(/ERRCODE\s*=\s*'55000'/i);
  });

  it('constrains every existing and future cursor timestamp to the client-supported finite range', () => {
    const constraintAt = migration.indexOf('daily_records_created_at_cursor_range');
    const replacementAt = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.enforce_daily_record_identity_immutable()',
    );
    expect(constraintAt).toBeGreaterThan(-1);
    expect(constraintAt).toBeLessThan(replacementAt);
    expect(migration).toMatch(
      /CHECK\s*\(\s*created_at\s*>=\s*TIMESTAMPTZ\s*'0001-01-01 00:00:00\+00'/i,
    );
    expect(migration).toMatch(
      /created_at\s*<\s*TIMESTAMPTZ\s*'10000-01-01 00:00:00\+00'/i,
    );
  });

  it('keeps the trigger in place, closes direct execution, and adds no index', () => {
    expect(migration).not.toMatch(/\b(?:DROP|CREATE)\s+TRIGGER\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_daily_record_identity_immutable\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enforce_daily_record_identity_immutable\(\)[\s\S]*FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toMatch(/\bBEGIN;[\s\S]*COMMIT;[\s\S]*NOTIFY pgrst, 'reload schema';\s*$/i);
  });
});

describePostgres.sequential('migration 087 PostgreSQL upgrade and actor behavior', () => {
  let root = '';
  let dataDirectory = '';
  let socketDirectory = '';
  let port = 0;
  let triggerOidBefore = '';
  let functionOidBefore = '';

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
SET LOCAL "request.jwt.claim.sub" = '${userId ?? ''}';
${statement}
COMMIT;
`);

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'gomsinlog-087-'));
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

    expectSql(PRE_087_SCHEMA, 'pre-087 schema');
    triggerOidBefore = expectSql(`
SELECT oid::TEXT
FROM pg_trigger
WHERE tgrelid = 'public.daily_records'::regclass
  AND tgname = 'aab_085_daily_record_identity_immutable';
`);
    functionOidBefore = expectSql(
      "SELECT to_regprocedure('public.enforce_daily_record_identity_immutable()')::oid::TEXT;",
    );
    expectSql(migration, 'migration 087');
  }, 30_000);

  afterAll(() => {
    if (dataDirectory && PG_BIN) {
      command(join(PG_BIN, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('replaces the function without recreating or rebinding the trigger', () => {
    expect(expectSql(`
SELECT oid::TEXT
FROM pg_trigger
WHERE tgrelid = 'public.daily_records'::regclass
  AND tgname = 'aab_085_daily_record_identity_immutable'
  AND tgfoid = to_regprocedure('public.enforce_daily_record_identity_immutable()')
  AND tgtype = 19
  AND NOT tgisinternal;
`)).toBe(triggerOidBefore);
    expect(expectSql(
      "SELECT to_regprocedure('public.enforce_daily_record_identity_immutable()')::oid::TEXT;",
    )).toBe(functionOidBefore);
    expect(expectSql(`
SELECT NOT has_function_privilege(
         'anon',
         'public.enforce_daily_record_identity_immutable()',
         'EXECUTE'
       )
   AND NOT has_function_privilege(
         'authenticated',
         'public.enforce_daily_record_identity_immutable()',
         'EXECUTE'
       );
`)).toBe('t');
  });

  it('allows the owner to update normal content, visibility, and media fields', () => {
    const updated = asActor('authenticated', OWNER_ID, `
WITH changed AS (
  UPDATE public.daily_records
  SET log_text = 'normal update',
      is_private = true,
      attachments = '[{"type":"photo","name":"photo.jpg","path":"c/r/photo.jpg"}]'::JSONB,
      media_manifest_revision = 1,
      last_media_operation_id = '${MEDIA_OPERATION_ID}',
      updated_at = clock_timestamp()
  WHERE id = '${RECORD_ID}'
  RETURNING log_text, is_private, media_manifest_revision
)
SELECT row_to_json(changed)::TEXT FROM changed;
`);
    expect(updated.status, updated.stderr).toBe(0);
    expect(JSON.parse(updated.stdout.trim())).toEqual({
      log_text: 'normal update',
      is_private: true,
      media_manifest_revision: 1,
    });
    expect(expectSql('SELECT count(*) FROM public.media_trigger_audit;')).toBe('1');
  });

  it('allows a no-op created_at assignment', () => {
    const result = asActor('authenticated', OWNER_ID, `
WITH changed AS (
  UPDATE public.daily_records
  SET created_at = created_at,
      log_text = 'no-op timestamp allowed'
  WHERE id = '${RECORD_ID}'
  RETURNING log_text
)
SELECT count(*) FROM changed;
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('1');
  });

  it('denies an owner created_at mutation with SQLSTATE 55000', () => {
    const result = asActor('authenticated', OWNER_ID, `
UPDATE public.daily_records
SET created_at = created_at + INTERVAL '1 microsecond'
WHERE id = '${RECORD_ID}';
`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('55000');
    expect(result.stderr).toContain('daily_record_created_at_immutable');
  });

  it('rolls back a multi-field mutation before the later media trigger', () => {
    expectSql('TRUNCATE public.media_trigger_audit;');
    const before = expectSql(
      `SELECT log_text FROM public.daily_records WHERE id = '${RECORD_ID}';`,
    );
    const result = asActor('authenticated', OWNER_ID, `
UPDATE public.daily_records
SET log_text = 'must roll back',
    created_at = created_at + INTERVAL '1 microsecond',
    last_media_operation_id = '87000000-0000-4000-8000-000000000007'
WHERE id = '${RECORD_ID}';
`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('daily_record_created_at_immutable');
    expect(expectSql(
      `SELECT log_text FROM public.daily_records WHERE id = '${RECORD_ID}';`,
    )).toBe(before);
    expect(expectSql('SELECT count(*) FROM public.media_trigger_audit;')).toBe('0');
  });

  it.each([
    ['partner', 'authenticated' as const, PARTNER_ID],
    ['third party', 'authenticated' as const, THIRD_PARTY_ID],
    ['anon', 'anon' as const, null],
  ])('keeps %s unable to update the owner record', (_label, role, userId) => {
    const result = asActor(role, userId, `
WITH changed AS (
  UPDATE public.daily_records
  SET log_text = 'unauthorized update'
  WHERE id = '${RECORD_ID}'
  RETURNING 1
)
SELECT count(*) FROM changed;
`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('0');
    expect(expectSql(
      `SELECT log_text = 'unauthorized update' FROM public.daily_records WHERE id = '${RECORD_ID}';`,
    )).toBe('f');
  });

  it('keeps id, user_id, and couple_id immutable', () => {
    for (const assignment of [
      "id = '87000000-0000-4000-8000-000000000008'",
      `user_id = '${PARTNER_ID}'`,
      "couple_id = '87000000-0000-4000-8000-000000000009'",
    ]) {
      const result = asActor('service_role', null, `
UPDATE public.daily_records SET ${assignment} WHERE id = '${RECORD_ID}';
`);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('55000');
      expect(result.stderr).toContain('daily_record_identity_immutable');
    }
  });

  it('keeps service_role subject to created_at immutability', () => {
    const result = asActor('service_role', null, `
UPDATE public.daily_records
SET created_at = created_at - INTERVAL '1 second'
WHERE id = '${RECORD_ID}';
`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('55000');
    expect(result.stderr).toContain('daily_record_created_at_immutable');
  });

  it.each([
    ["TIMESTAMPTZ 'infinity'", 'infinity'],
    ["TIMESTAMPTZ '-infinity'", '-infinity'],
    ["TIMESTAMPTZ '10000-01-01 00:00:00+00'", 'five-digit year'],
  ])('rejects a new %s cursor timestamp', (timestampLiteral, label) => {
    const result = sql(`
\\set VERBOSITY verbose
INSERT INTO public.daily_records (
  id, user_id, couple_id, record_date, log_text, created_at
) VALUES (
  gen_random_uuid(), '${OWNER_ID}', '${COUPLE_ID}', DATE '2026-09-05', '${label}', ${timestampLiteral}
);
`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('23514');
    expect(result.stderr).toContain('daily_records_created_at_cursor_range');
  });

  it.each([
    [
      'the trigger is missing',
      'DROP TRIGGER aab_085_daily_record_identity_immutable ON public.daily_records;',
    ],
    [
      'the trigger is rebound',
      `
CREATE FUNCTION public.wrong_identity_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
DROP TRIGGER aab_085_daily_record_identity_immutable ON public.daily_records;
CREATE TRIGGER aab_085_daily_record_identity_immutable
  BEFORE UPDATE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.wrong_identity_trigger();
`,
    ],
    [
      'the trigger is disabled',
      'ALTER TABLE public.daily_records DISABLE TRIGGER aab_085_daily_record_identity_immutable;',
    ],
    [
      'created_at is nullable',
      'ALTER TABLE public.daily_records ALTER COLUMN created_at DROP NOT NULL;',
    ],
  ])('fails closed before replacement when %s', (_label, corruptBinding) => {
    const result = sql(`
\\set VERBOSITY verbose
BEGIN;
${corruptBinding}
${migration}
`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('55000');
    expect(result.stderr).toContain('migration_087_requires_exact_085_identity_trigger');
    expect(expectSql(`
SELECT tgfoid = to_regprocedure('public.enforce_daily_record_identity_immutable()')
FROM pg_trigger
WHERE tgrelid = 'public.daily_records'::regclass
  AND tgname = 'aab_085_daily_record_identity_immutable';
`)).toBe('t');
  });

  it('refuses to freeze an already-invalid timestamp into the immutable cursor contract', () => {
    expectSql(`
ALTER TABLE public.daily_records
  DROP CONSTRAINT daily_records_created_at_cursor_range;
ALTER TABLE public.daily_records
  DISABLE TRIGGER aab_085_daily_record_identity_immutable;
UPDATE public.daily_records
SET created_at = TIMESTAMPTZ '-infinity'
WHERE id = '${RECORD_ID}';
ALTER TABLE public.daily_records
  ENABLE TRIGGER aab_085_daily_record_identity_immutable;
`);

    const result = sql(`
\\set VERBOSITY verbose
${migration}
`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('23514');
    expect(result.stderr).toContain('daily_records_created_at_cursor_range');
    expect(expectSql(`
SELECT created_at = TIMESTAMPTZ '-infinity'
FROM public.daily_records
WHERE id = '${RECORD_ID}';
`)).toBe('t');
  });
});
