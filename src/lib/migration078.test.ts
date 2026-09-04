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

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/078_account_deletion_fence_inspection.sql'),
  'utf8',
);

type CommandResult = { status: number | null; stdout: string; stderr: string };

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations');
const migration074 = readFileSync(
  join(migrationDirectory, '074_immutable_relationship_generation.sql'),
  'utf8',
);

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

function asyncCommand(
  file: string,
  args: string[],
  input: string,
): { ready: Promise<void>; done: Promise<CommandResult> } {
  const child = spawn(file, args, {
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' },
  });
  let stdout = '';
  let stderr = '';
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const done = new Promise<CommandResult>((resolveDone) => {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes('078_READY')) resolveReady();
    });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => {
      rejectReady(error);
      resolveDone({ status: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (status) => {
      resolveReady();
      resolveDone({ status, stdout, stderr });
    });
  });
  child.stdin.end(input);
  return { ready, done };
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
  email TEXT,
  raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB
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

describe('migration 078 account-deletion fence inspection contract', () => {
  it('adds one read-only, service-role-only inspection RPC', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.inspect_account_deletion_fence_v2\(\s*p_user_id UUID\s*\)\s*RETURNS JSONB/i,
    );
    expect(migration).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/i);
    expect(migration).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.inspect_account_deletion_fence_v2\(UUID\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.inspect_account_deletion_fence_v2\(UUID\)\s+TO service_role/i,
    );
  });

  it('serializes with deletion attempts and returns only bounded fence state', () => {
    const lockAt = migration.indexOf('hashtextextended(p_user_id::TEXT, 15013)');
    const readAt = migration.indexOf('FROM public.account_deletion_requests');
    expect(lockAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(lockAt);
    expect(migration).toContain("'pending', false");
    expect(migration).toContain("'pending', true");
    expect(migration).toContain("'attempt_id', v_attempt_id");
    expect(migration).toContain("'phase', v_phase");
  });

  it('does not mutate the deletion fence or widen table access', () => {
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\s+(?:TABLE\s+)?public\.account_deletion_requests/i);
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?public\.account_deletion_requests/i);
    expect(migration).toMatch(/^BEGIN;[\s\S]*COMMIT;\s*$/);
  });
});

describePostgres.sequential('migration 078 PostgreSQL integration', () => {
  const userId = '78000000-0000-4000-8000-000000000001';
  const attemptId = '78000000-0000-4000-8000-000000000002';
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
    statement: string,
  ): CommandResult => sql(`
\\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE ${role};
SET LOCAL "request.jwt.claim.role" = '${role}';
${statement}
COMMIT;
`);
  const asService = (statement: string): CommandResult => asActor('service_role', statement);
  const inspect = (): Record<string, unknown> => {
    const result = asService(
      `SELECT public.inspect_account_deletion_fence_v2('${userId}');`,
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'gomsinlog-078-'));
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
    const predecessors = readdirSync(migrationDirectory)
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .filter((file) => Number.parseInt(file.slice(0, 3), 10) <= 77)
      .sort();
    for (const file of predecessors) {
      if (file === '002_fix_rls_recursion.sql') {
        expectSql(PRE_002_RECURSION_DROPS, 'fresh-chain 002 policy bridge');
      }
      expectSql(readFileSync(join(migrationDirectory, file), 'utf8'), file);
    }
    expectSql(`
INSERT INTO auth.users (id, email)
VALUES ('${userId}', 'migration078@example.test');
`, 'migration 078 fixture');
    expectSql(migration, 'migration 078');
  }, 90_000);

  afterAll(() => {
    if (dataDirectory && PG_BIN) {
      command(join(PG_BIN, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('executes the migration and exposes the RPC only to service_role', () => {
    expect(expectSql(
      "SELECT to_regprocedure('public.inspect_account_deletion_fence_v2(uuid)') IS NOT NULL;",
    )).toBe('t');
    expect(expectSql(`
SELECT NOT has_function_privilege('anon', 'public.inspect_account_deletion_fence_v2(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.inspect_account_deletion_fence_v2(uuid)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.inspect_account_deletion_fence_v2(uuid)', 'EXECUTE');
`)).toBe('t');

    for (const role of ['anon', 'authenticated'] as const) {
      const denied = asActor(
        role,
        `SELECT public.inspect_account_deletion_fence_v2('${userId}');`,
      );
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain('42501');
    }
  });

  it('observes no fence, the real begin/cancel fence, and no inspection mutation', () => {
    expect(inspect()).toEqual({ ok: true, pending: false });

    const begun = asService(`
SELECT public.begin_account_deletion_v2(
  '${userId}', '{}'::uuid[], '${attemptId}'
);
`);
    expect(begun.status, begun.stderr).toBe(0);
    expect(begun.stdout).toContain(attemptId);
    expect(begun.stdout).toContain('media_cleanup');

    const before = expectSql(`
SELECT row_to_json(deletion)::text
FROM public.account_deletion_requests AS deletion
WHERE deletion.user_id = '${userId}';
`, 'fence before inspection');
    expect(inspect()).toEqual({
      ok: true,
      pending: true,
      attempt_id: attemptId,
      phase: 'media_cleanup',
    });
    const after = expectSql(`
SELECT row_to_json(deletion)::text
FROM public.account_deletion_requests AS deletion
WHERE deletion.user_id = '${userId}';
`, 'fence after inspection');
    expect(after).toBe(before);

    const cancelled = asService(
      `SELECT public.cancel_account_deletion_v2('${userId}', '${attemptId}');`,
    );
    expect(cancelled.status, cancelled.stderr).toBe(0);
    expect(cancelled.stdout.trim()).toBe('t');
    expect(inspect()).toEqual({ ok: true, pending: false });
  });

  it('uses the same advisory-lock namespace as real begin and cancel', () => {
    const lockNamespace = migration074.match(
      /hashtextextended\(p_user_id::TEXT,\s*(\d+)\)/i,
    )?.[1];
    expect(lockNamespace).toBe('15013');
    expect(migration).toContain(`hashtextextended(p_user_id::TEXT, ${lockNamespace})`);
    const begun = asService(`
SELECT public.begin_account_deletion_v2(
  '${userId}', '{}'::uuid[], '${attemptId}'
);
`);
    expect(begun.status, begun.stderr).toBe(0);
    expect(begun.stdout).toContain('media_cleanup');
    const cancelled = asService(`
SELECT public.cancel_account_deletion_v2('${userId}', '${attemptId}');
`);
    expect(cancelled.status, cancelled.stderr).toBe(0);
    expect(cancelled.stdout.trim()).toBe('t');
  });

  it('blocks inspection behind an uncommitted real begin lock', async () => {
    const holder = asyncCommand(
      join(PG_BIN!, 'psql'),
      psqlArgs(),
      `
\\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.role" = 'service_role';
SELECT public.begin_account_deletion_v2(
  '${userId}', '{}'::uuid[], '${attemptId}'
);
SELECT '078_READY';
SELECT pg_sleep(0.5);
ROLLBACK;
`,
    );
    await holder.ready;

    const blocked = asService(`
SET LOCAL lock_timeout = '100ms';
SELECT public.inspect_account_deletion_fence_v2('${userId}');
`);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('55P03');

    const finished = await holder.done;
    expect(finished.status, finished.stderr).toBe(0);
  });
});
