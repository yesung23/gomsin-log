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
} as const;

const HASH = {
  ab: 'a'.repeat(64),
  stale: 'b'.repeat(64),
  bNew: 'c'.repeat(64),
  de: 'd'.repeat(64),
  eNew: 'e'.repeat(64),
  fg: 'f'.repeat(64),
  rejectedAfterClose: '9'.repeat(64),
} as const;

const BASELINE = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TABLE auth.users (id UUID PRIMARY KEY);

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
  ('${USERS.legacy}');

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

  const psqlArgs = () => [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-h', socketDirectory,
    '-p', String(port),
    '-d', 'postgres',
  ];

  const sql = (source: string): CommandResult => command(
    join(PG_BIN!, 'psql'),
    psqlArgs(),
    source,
  );

  const expectSql = (source: string): string => {
    const result = sql(source);
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

    let migration = '';
    try {
      migration = readFileSync(resolve(
        process.cwd(),
        'supabase/migrations/074_immutable_relationship_generation.sql',
      ), 'utf8');
    } catch {
      // Empty SQL keeps the RED state observable through missing functions below.
    }
    expectSql(migration);
  }, 30_000);

  afterAll(() => {
    if (dataDirectory && PG_BIN) {
      command(join(PG_BIN, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

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

  it('uses a prepared service-only idempotent close for account deletion and denies every weaker actor', () => {
    const oldCouple = expectUser(
      USERS.d,
      `SELECT public.create_couple_and_invitation('gomsin', '${HASH.de}');`,
    );
    expect(JSON.parse(expectUser(
      USERS.e,
      `SELECT public.redeem_invitation('${HASH.de}');`,
    ))).toMatchObject({ ok: true, couple_id: oldCouple });

    expectSql(`
INSERT INTO public.account_deletion_requests (user_id)
VALUES ('${USERS.d}');
`);

    const authenticated = asUser(
      USERS.d,
      `SELECT public.close_account_relationship_generations('${USERS.d}');`,
    );
    expect(authenticated.status).not.toBe(0);
    expect(authenticated.stderr).toContain('permission denied for function');

    const anon = asActor(
      'anon',
      null,
      `SELECT public.close_account_relationship_generations('${USERS.d}');`,
    );
    expect(anon.status).not.toBe(0);
    expect(anon.stderr).toContain('permission denied for function');

    const serviceWithoutClaim = sql(`
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.close_account_relationship_generations('${USERS.d}');
COMMIT;
`);
    expect(serviceWithoutClaim.status).not.toBe(0);
    expect(serviceWithoutClaim.stderr).toContain('Service role required');

    const first = asActor(
      'service_role',
      null,
      `SELECT public.close_account_relationship_generations('${USERS.d}');`,
    );
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout.trim())).toEqual({ ok: true, closed_count: 1 });

    const second = asActor(
      'service_role',
      null,
      `SELECT public.close_account_relationship_generations('${USERS.d}');`,
    );
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout.trim())).toEqual({ ok: true, closed_count: 0 });

    const unrelated = asUser(USERS.outsider, 'SELECT public.disconnect_couple();');
    expect(unrelated.status).not.toBe(0);
    expect(unrelated.stderr).toContain('Active couple not found');

    const newCouple = expectUser(
      USERS.e,
      `SELECT public.create_couple_and_invitation('soldier', '${HASH.eNew}');`,
    );
    expect(newCouple).not.toBe(oldCouple);
  });

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
