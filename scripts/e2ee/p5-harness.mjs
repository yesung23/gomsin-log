#!/usr/bin/env node
/**
 * Executable proof for the P5 `daily_records` E2EE slice.
 *
 * Static SQL inspection cannot establish any of the claims below. A trigger that
 * reads correctly still passes vacuously when RLS refuses first; a domain check
 * that looks exhaustive still admits a forged header if it only compares the
 * client's own two columns to each other. This repository has already shipped
 * that exact vacuity twice — 028 private media and 038's membership gate — so
 * every boundary here is driven against a real PostgreSQL cluster, as real RLS
 * actors, and the ones that matter are MUTATION TESTED: the check is removed and
 * the assertion must then fail.
 *
 * Actors, arranged exactly as PostgREST arranges them:
 *
 *   A         author
 *   B         A's active partner
 *   C         unrelated third user
 *   D         A's FORMER partner (membership row present, status disconnected)
 *   anon      the unauthenticated role
 *   no-JWT    the service_role / Edge context (RLS bypassed)
 *
 * Nothing here touches a configured Supabase project. The cluster lives in a
 * temp dir on a unix socket and is destroyed on exit.
 *
 * Usage: node scripts/e2ee/p5-harness.mjs [--keep]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const BASELINE = join(import.meta.dirname, 'p5-baseline.sql');

const FORWARD = [
  '031_e2ee_key_foundation.sql',
  '032_e2ee_write_floor.sql',
  '034_e2ee_recovery_challenge_issuance.sql',
  '035_e2ee_phase1a_p0_closure.sql',
  '036_e2ee_device_status_privilege.sql',
  '039_daily_records_content_envelope.sql',
];

const keep = process.argv.includes('--keep');
const PG_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };

function have(binary) {
  return spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
}

if (!have('initdb') || !have('pg_ctl') || !have('psql')) {
  console.error('POSTGRES UNAVAILABLE: initdb/pg_ctl/psql not found on PATH.');
  console.error('This is a MISSING VERIFICATION, not a pass.');
  process.exit(2);
}

for (const file of FORWARD) {
  if (!existsSync(join(MIGRATIONS, file))) {
    console.error(`MISSING MIGRATION: ${file}`);
    process.exit(2);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gomsinlog-p5-'));
const dataDir = join(dir, 'pgdata');
const socketDir = join(dir, 'sock');
execFileSync('mkdir', ['-p', socketDir], { env: PG_ENV });

let started = false;
function shutdown() {
  if (started) {
    spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: PG_ENV });
    started = false;
  }
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

const DB = 'p5_slice';

function psql(args, { input, db } = {}) {
  const result = spawnSync(
    'psql',
    ['-h', socketDir, '-d', db ?? DB, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', input, env: PG_ENV },
  );
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** No authenticated actor: the service_role / Edge context. */
function sql(text, db) {
  return psql(['-At', '-c', text], { db });
}

function mustSql(text, label, db) {
  const result = sql(text, db);
  if (!result.ok) throw new Error(`${label} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

/**
 * Run SQL as an authenticated user, the way PostgREST does it.
 *
 * SET ROLE is what makes RLS apply at all — a superuser bypasses it, which would
 * silently void every authorization assertion in this file.
 */
function asRole(role, userId, text, db) {
  const args = ['-At', '-c', `SET ROLE ${role}`];
  if (userId) {
    // Set inside a DO block: in -At mode `SELECT set_config(...)` emits a row
    // that would be prepended to the caller's result and corrupt comparisons.
    args.push('-c', `DO $h$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $h$`);
  }
  args.push('-c', text);
  return psql(args, { db });
}

const asUser = (userId, text, db) => asRole('authenticated', userId, text, db);
const asAnon = (text, db) => asRole('anon', null, text, db);

function mustAsUser(userId, text, label, db) {
  const result = asUser(userId, text, db);
  if (!result.ok) throw new Error(`${label} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

const failures = [];
const passes = [];

function check(condition, message) {
  if (condition) {
    passes.push(message);
    return true;
  }
  failures.push(message);
  return false;
}

/** Assert an operation was refused, and that the refusal named the right cause. */
function checkRefused(result, code, message) {
  if (result.ok) {
    failures.push(`${message} — but it SUCCEEDED`);
    return false;
  }
  if (code && !new RegExp(code).test(result.stderr)) {
    failures.push(`${message} — refused, but not with ${code}:\n    ${result.stderr.trim().split('\n').pop()}`);
    return false;
  }
  passes.push(message);
  return true;
}

// ---------------------------------------------------------------------------
// Actors and fixtures
// ---------------------------------------------------------------------------

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';
const D = 'dddddddd-0000-4000-8000-00000000000d';

const COUPLE_AB = '11111111-0000-4000-8000-000000000001';
const COUPLE_C = '22222222-0000-4000-8000-000000000002';
/** A's former couple with D. Both memberships are `disconnected`. */
const COUPLE_AD = '33333333-0000-4000-8000-000000000003';
const COUPLE_ORPHAN = '44444444-0000-4000-8000-000000000004';

/**
 * A syntactically real GLE1 envelope, built in SQL.
 *
 * The AEAD is not verifiable here and does not need to be: this harness tests
 * the DATABASE contract. What must be genuine is the byte layout the trigger
 * reads — magic "GLE1" at 0, format version at 4, domain at 7, big-endian u64
 * epoch at 12 — because 039 reads exactly those offsets. Everything else is
 * filler of the correct width.
 *
 * `domain` is the WIRE value: personal 1, health 2, couple 3.
 */
function envelope(domain, epoch, opts = {}) {
  const { plaintextBytes = 64, magic = '474c4531', formatVersion = 1 } = opts;
  const epochHex = BigInt(epoch).toString(16).padStart(16, '0');
  // Header bytes 0..19 are spelled out; 20..91 plus ciphertext and tag are filler.
  const head = magic
    + formatVersion.toString(16).padStart(2, '0')
    + '01' // protocol_id
    + '01' // suite_id
    + domain.toString(16).padStart(2, '0')
    + '00' // flags
    + '000000' // reserved
    + epochHex;
  const filler = 'ab'.repeat(72 + plaintextBytes + 16);
  return `decode('${head}${filler}', 'hex')`;
}

const DOMAIN_WIRE = { personal: 1, health: 2, couple: 3 };

console.log('› initialising a throwaway PostgreSQL cluster');
execFileSync(
  'initdb',
  ['-D', dataDir, '-U', process.env.USER ?? 'postgres', '-A', 'trust', '--no-sync', '--locale=C', '-E', 'UTF8'],
  { stdio: 'ignore', env: PG_ENV },
);
writeFileSync(join(dataDir, 'postgresql.conf'), [
  `unix_socket_directories = '${socketDir}'`,
  "listen_addresses = ''",
  'fsync = off',
  'full_page_writes = off',
].join('\n') + '\n', { flag: 'a' });
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir}`, '-w', '-l', join(dir, 'pg.log'), 'start'], {
  stdio: 'ignore', env: PG_ENV,
});
started = true;

function mustPsqlFile(file, label, db) {
  const result = spawnSync(
    'psql',
    ['-h', socketDir, '-d', db ?? DB, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', file],
    { encoding: 'utf8', env: PG_ENV },
  );
  if (result.status !== 0) throw new Error(`${label} failed:\n${(result.stderr ?? '').trim()}`);
  return result.stdout ?? '';
}

function createDatabase(name) {
  const create = spawnSync('psql', ['-h', socketDir, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q',
    '-c', `CREATE DATABASE ${name}`], { encoding: 'utf8', env: PG_ENV });
  if (create.status !== 0) throw new Error(`create database ${name} failed:\n${create.stderr}`);
}

/**
 * Build a fully seeded database and return its name.
 *
 * `mutate` receives the raw SQL of each migration and may rewrite it. That is
 * how the mutation tests below remove a single check and prove the assertion
 * covering it then fails — a check nothing depends on is not a control.
 */
function buildDatabase(name, opts = {}) {
  const { mutate, baselineFile = BASELINE } = opts;
  createDatabase(name);
  mustPsqlFile(baselineFile, `baseline (${name})`, name);

  for (const file of FORWARD) {
    const original = readFileSync(join(MIGRATIONS, file), 'utf8');
    const text = mutate ? mutate(file, original) : original;
    if (text === original) {
      mustPsqlFile(join(MIGRATIONS, file), `apply ${file} (${name})`, name);
    } else {
      const patched = join(dir, `${name}-${file}`);
      writeFileSync(patched, text);
      mustPsqlFile(patched, `apply mutated ${file} (${name})`, name);
    }
  }
  return name;
}

/** Seed users, couples and epochs into an already-migrated database. */
function seed(name) {
  mustSql(`
    INSERT INTO auth.users (id, email) VALUES
      ('${A}', 'a@example.test'), ('${B}', 'b@example.test'),
      ('${C}', 'c@example.test'), ('${D}', 'd@example.test');

    INSERT INTO public.couples (id) VALUES ('${COUPLE_AB}'), ('${COUPLE_C}'), ('${COUPLE_AD}');

    INSERT INTO public.couple_members (couple_id, user_id, status) VALUES
      ('${COUPLE_AB}', '${A}', 'active'),
      ('${COUPLE_AB}', '${B}', 'active'),
      ('${COUPLE_C}',  '${C}', 'active'),
      ('${COUPLE_AD}', '${A}', 'disconnected'),
      ('${COUPLE_AD}', '${D}', 'disconnected');
  `, `seed users (${name})`, name);

  const scopeKey = (domain, scopeId, ownerUser, ownerCouple, epoch, state) => `
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, owner_couple_id, key_epoch, state)
    VALUES ('${domain}', '${scopeId}', ${ownerUser ? `'${ownerUser}'` : 'NULL'},
            ${ownerCouple ? `'${ownerCouple}'` : 'NULL'}, ${epoch}, '${state}')`;

  // A retired personal epoch, so "RETIRED stays readable but never writable" is
  // testable; C's own couple epoch, for the cross-couple theft test.
  mustSql(scopeKey('personal', A, A, null, 1, 'RETIRED'), 'A personal epoch 1 retired', name);
  mustSql(scopeKey('personal', A, A, null, 2, 'ACTIVE'), 'A personal epoch 2', name);
  mustSql(scopeKey('health', A, A, null, 1, 'ACTIVE'), 'A health epoch', name);
  mustSql(scopeKey('couple', COUPLE_AB, null, COUPLE_AB, 1, 'ACTIVE'), 'AB couple epoch', name);
  mustSql(scopeKey('couple', COUPLE_C, null, COUPLE_C, 7, 'ACTIVE'), 'C couple epoch', name);
  return name;
}

/** Activate both of A's write floors, the way the client bootstrap will. */
function activateFloors(name) {
  mustAsUser(A, `SELECT public.activate_e2ee_write_floor('user', '${A}', NULL)`, 'personal floor', name);
  mustAsUser(A, `SELECT public.activate_e2ee_write_floor('couple', '${COUPLE_AB}', NULL)`, 'couple floor', name);
}

/** Insert one record. Every column is explicit, so nothing is implied. */
function insertRecord(row) {
  const value = (key, fallback = 'NULL') => (row[key] === undefined ? fallback : row[key]);
  return `
    INSERT INTO public.daily_records
      (id, user_id, couple_id, record_date, record_time, log_text, reaction,
       attachments, emotion_flow, is_private, cipher_format, content_revision,
       key_domain, key_epoch, content_envelope)
    VALUES (
      '${row.id}', '${row.userId}', '${row.coupleId}', '2026-08-14',
      ${value('recordTime')}, ${value('logText', "''")}, ${value('reaction')},
      ${value('attachments', "'[]'::jsonb")}, ${value('emotionFlow', "'[]'::jsonb")},
      ${row.isPrivate ? 'true' : 'false'}, ${value('cipherFormat', '0')},
      ${value('contentRevision', '1')}, ${value('keyDomain')}, ${value('keyEpoch')},
      ${value('envelope')})`;
}

let uid = 0;
const nextId = () => `00000000-0000-4000-8000-${(++uid).toString(16).padStart(12, '0')}`;

/** A well-formed encrypted SHARED record written by A, under the CSK. */
function sharedEncrypted(overrides = {}) {
  return insertRecord({
    id: nextId(),
    userId: A,
    coupleId: COUPLE_AB,
    isPrivate: false,
    cipherFormat: '1',
    contentRevision: '1',
    keyDomain: "'couple'",
    keyEpoch: '1',
    envelope: envelope(DOMAIN_WIRE.couple, 1),
    ...overrides,
  });
}

/** A well-formed encrypted PRIVATE record written by A, under the PMK. */
function privateEncrypted(overrides = {}) {
  return insertRecord({
    id: nextId(),
    userId: A,
    coupleId: COUPLE_AB,
    isPrivate: true,
    cipherFormat: '1',
    contentRevision: '1',
    keyDomain: "'personal'",
    keyEpoch: '2',
    envelope: envelope(DOMAIN_WIRE.personal, 2),
    ...overrides,
  });
}

try {
  console.log(`› applying p5 baseline + ${FORWARD.map((f) => f.slice(0, 3)).join(' → ')}`);
  buildDatabase(DB);
  seed(DB);
  console.log('  seeded: A, B (active), C (unrelated), D (former partner)');

  // =========================================================================
  // Scenario 0 — the fixture is not lying about production
  // =========================================================================
  // If the baseline's RLS drifted from 009, every denial below could be denied
  // for the wrong reason. Compare the live predicates against the migration.
  console.log('› Scenario 0: the harness fixture matches the real migrations');

  const migration009 = readFileSync(join(MIGRATIONS, '009_remote_core_security_hotfix.sql'), 'utf8');
  const livePolicies = mustSql(`
    SELECT policyname || '|' || COALESCE(qual, '') || '|' || COALESCE(with_check, '')
    FROM pg_policies WHERE tablename = 'daily_records' ORDER BY policyname`, 'live policies');

  check(livePolicies.split('\n').length === 2, 'daily_records carries exactly the two production policies');
  check(
    /is_private = false/.test(livePolicies) && /user_id <> auth\.uid\(\)/.test(livePolicies),
    'the partner SELECT policy really requires shared + not-self',
  );
  check(
    migration009.includes('AND user_id <> auth.uid()') && migration009.includes('AND is_private = false'),
    'that predicate is the one 009 actually defines (fixture has not drifted)',
  );

  const anonPrivileges = mustSql(`
    SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_name = 'daily_records'`, 'anon grants');
  check(anonPrivileges === '0', 'anon holds no privilege on daily_records at all');

  // =========================================================================
  // Scenario 1 — the legacy plaintext client is untouched until activation
  // =========================================================================
  console.log('› Scenario 1: legacy plaintext behaviour before activation');

  const legacyId = nextId();
  const legacyWrite = asUser(A, insertRecord({
    id: legacyId, userId: A, coupleId: COUPLE_AB, isPrivate: false,
    logText: "'오늘은 눈이 왔어'", recordTime: "'09:30'",
  }));
  check(legacyWrite.ok, 'legacy plaintext INSERT still succeeds with no floor activated');
  if (!legacyWrite.ok) console.error(`    ${legacyWrite.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  const legacyShape = mustSql(`
    SELECT cipher_format || '|' || content_revision || '|' || (content_envelope IS NULL)::int
    FROM public.daily_records WHERE id = '${legacyId}'`, 'legacy row shape');
  check(legacyShape === '0|1|1', `a legacy row is cipher_format 0, revision 1, no envelope (saw ${legacyShape})`);

  checkRefused(
    asUser(A, insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: false,
      logText: "'평문'", envelope: envelope(DOMAIN_WIRE.couple, 1),
    })),
    'E2EE_ENVELOPE_ON_PLAINTEXT',
    'reject: plaintext row carrying a content envelope (no second content channel)',
  );

  checkRefused(
    asUser(A, sharedEncrypted()),
    'E2EE_FLOOR_NOT_ACTIVE',
    'reject: encrypted write before the floor is activated',
  );

  // =========================================================================
  // Scenario 2 — activation, then the happy path
  // =========================================================================
  console.log('› Scenario 2: floor activation and the encrypted happy path');

  activateFloors(DB);
  passes.push('A activates the personal and couple write floors');

  checkRefused(
    asUser(C, `SELECT public.activate_e2ee_write_floor('user', '${A}', NULL)`),
    'E2EE_FLOOR_SCOPE_FORBIDDEN',
    "reject: unrelated user activates another account's personal floor",
  );
  checkRefused(
    asUser(C, `SELECT public.activate_e2ee_write_floor('couple', '${COUPLE_AB}', NULL)`),
    'E2EE_FLOOR_SCOPE_FORBIDDEN',
    "reject: unrelated user activates another couple's floor",
  );

  const sharedId = nextId();
  const sharedWrite = asUser(A, sharedEncrypted({ id: sharedId }));
  check(sharedWrite.ok, 'A writes a SHARED record encrypted under the couple domain (CSK)');
  if (!sharedWrite.ok) console.error(`    ${sharedWrite.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  const privateId = nextId();
  const privateWrite = asUser(A, privateEncrypted({ id: privateId }));
  check(privateWrite.ok, 'A writes a PRIVATE record encrypted under the personal domain (PMK)');
  if (!privateWrite.ok) console.error(`    ${privateWrite.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  // =========================================================================
  // Scenario 3 — no plaintext residue on an encrypted row
  // =========================================================================
  console.log('› Scenario 3: plaintext residue, field by field');

  const residue = {
    log_text: { logText: "'남아있는 본문'" },
    reaction: { reaction: "'good'" },
    attachments: { attachments: '\'[{"type":"photo","name":"a.jpg","path":"p"}]\'::jsonb' },
    emotion_flow: { emotionFlow: '\'[{"emotion":"happy"}]\'::jsonb' },
    record_time: { recordTime: "'09:30'" },
  };
  for (const [column, override] of Object.entries(residue)) {
    checkRefused(
      asUser(A, sharedEncrypted(override)),
      `E2EE_PLAINTEXT_RESIDUE: ${column}`,
      `reject: encrypted row keeping plaintext ${column}`,
    );
  }

  const clean = mustSql(`
    SELECT count(*) FROM public.daily_records
    WHERE cipher_format >= 1
      AND (COALESCE(log_text, '') <> '' OR reaction IS NOT NULL
        OR COALESCE(attachments, '[]'::jsonb) <> '[]'::jsonb
        OR COALESCE(emotion_flow, '[]'::jsonb) <> '[]'::jsonb
        OR record_time IS NOT NULL)`, 'residue scan');
  check(clean === '0', `no stored encrypted row carries any protected plaintext (saw ${clean})`);

  const envelopeMissing = mustSql(`
    SELECT count(*) FROM public.daily_records
    WHERE cipher_format >= 1 AND content_envelope IS NULL`, 'envelope presence');
  check(envelopeMissing === '0', 'every encrypted row carries its content envelope');

  checkRefused(
    asUser(A, sharedEncrypted({ envelope: 'NULL' })),
    'E2EE_ENVELOPE_REQUIRED',
    'reject: encrypted row with no envelope (the data-loss direction)',
  );

  // =========================================================================
  // Scenario 4 — downgrade and floor enforcement after activation
  // =========================================================================
  console.log('› Scenario 4: downgrade and post-activation plaintext');

  checkRefused(
    asUser(A, `
      UPDATE public.daily_records
      SET cipher_format = 0, content_envelope = NULL, log_text = '평문으로 되돌리기',
          content_revision = content_revision + 1
      WHERE id = '${sharedId}'`),
    'E2EE_DOWNGRADE_FORBIDDEN',
    'reject: ciphertext → plaintext downgrade',
  );

  checkRefused(
    asUser(A, insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: false, logText: "'새 평문'",
    })),
    'E2EE_WRITE_FLOOR',
    'reject: new plaintext INSERT after the floor is active',
  );

  checkRefused(
    asUser(A, `UPDATE public.daily_records SET log_text = '수정' WHERE id = '${legacyId}'`),
    'E2EE_WRITE_FLOOR',
    'reject: editing a legacy plaintext row without transitioning it to ciphertext',
  );

  const legacyStillReadable = mustAsUser(A,
    `SELECT log_text FROM public.daily_records WHERE id = '${legacyId}'`, 'legacy read');
  check(legacyStillReadable === '오늘은 눈이 왔어',
    'a legacy plaintext row stays readable forever (migration plan, not a leak)');

  const migrated = asUser(A, `
    UPDATE public.daily_records
    SET cipher_format = 1, content_revision = content_revision + 1,
        key_domain = 'couple', key_epoch = 1,
        content_envelope = ${envelope(DOMAIN_WIRE.couple, 1)},
        log_text = '', reaction = NULL, attachments = '[]'::jsonb,
        emotion_flow = '[]'::jsonb, record_time = NULL
    WHERE id = '${legacyId}'`);
  check(migrated.ok, 'a legacy row migrates to ciphertext in one atomic UPDATE');
  if (!migrated.ok) console.error(`    ${migrated.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  // =========================================================================
  // Scenario 5 — domain routing: PMK and CSK cannot be swapped
  // =========================================================================
  console.log('› Scenario 5: PMK / CSK domain routing');

  checkRefused(
    asUser(A, insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: true,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'couple'", keyEpoch: '1',
      envelope: envelope(DOMAIN_WIRE.couple, 1),
    })),
    'E2EE_DOMAIN_BINDING',
    'reject: PRIVATE record encrypted under the couple key (CSK)',
  );

  checkRefused(
    asUser(A, insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: false,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'personal'", keyEpoch: '2',
      envelope: envelope(DOMAIN_WIRE.personal, 2),
    })),
    'E2EE_DOMAIN_BINDING',
    'reject: SHARED record encrypted under the personal key (PMK)',
  );

  // HRK must never stand in for PMK or CSK. A really does hold an ACTIVE health
  // epoch, so this is not passing because the key is absent.
  const healthEpochExists = mustSql(`
    SELECT count(*) FROM public.scope_keys
    WHERE domain = 'health' AND owner_user_id = '${A}' AND state = 'ACTIVE'`, 'health epoch');
  check(healthEpochExists === '1', 'A holds a real ACTIVE health epoch (so the next check is not vacuous)');

  checkRefused(
    asUser(A, insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: true,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'health'", keyEpoch: '1',
      envelope: envelope(DOMAIN_WIRE.health, 1),
    })),
    'E2EE_DOMAIN_UNSUPPORTED|E2EE_DOMAIN_BINDING|violates check constraint',
    'reject: HRK / health domain used for a daily record',
  );

  // Forged routing metadata: the envelope is sealed under the PERSONAL key but
  // declares the couple domain. Both routing columns agree with each other and
  // with `is_private`, so 032 alone would accept this and hand B a row they can
  // never open. Only reading the header closes it.
  checkRefused(
    asUser(A, sharedEncrypted({ envelope: envelope(DOMAIN_WIRE.personal, 1) })),
    'E2EE_ENVELOPE_DOMAIN_MISMATCH',
    'reject: forged routing — envelope sealed under PMK but declared couple domain',
  );

  checkRefused(
    asUser(A, privateEncrypted({ envelope: envelope(DOMAIN_WIRE.couple, 2) })),
    'E2EE_ENVELOPE_DOMAIN_MISMATCH',
    'reject: forged routing — envelope sealed under CSK but declared personal domain',
  );

  checkRefused(
    asUser(A, sharedEncrypted({ envelope: envelope(DOMAIN_WIRE.couple, 1, { magic: '00000000' }) })),
    'E2EE_ENVELOPE_MAGIC',
    'reject: content envelope that is not a GLE1 envelope',
  );

  checkRefused(
    asUser(A, sharedEncrypted({ envelope: envelope(DOMAIN_WIRE.couple, 1, { formatVersion: 9 }) })),
    'E2EE_ENVELOPE_FORMAT',
    'reject: unsupported GLE1 format version',
  );

  checkRefused(
    asUser(A, sharedEncrypted({ envelope: "decode('474c4531', 'hex')" })),
    'E2EE_ENVELOPE_TRUNCATED',
    'reject: envelope too short to be a GLE1 envelope',
  );

  // =========================================================================
  // Scenario 6 — epoch: ACTIVE only for writes, RETIRED stays readable
  // =========================================================================
  console.log('› Scenario 6: epoch enforcement');

  checkRefused(
    asUser(A, insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: true,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'personal'", keyEpoch: '1',
      envelope: envelope(DOMAIN_WIRE.personal, 1),
    })),
    'E2EE_STALE_EPOCH',
    'reject: write under a RETIRED personal epoch (stale device)',
  );

  checkRefused(
    asUser(A, sharedEncrypted({ keyEpoch: '9', envelope: envelope(DOMAIN_WIRE.couple, 9) })),
    'E2EE_STALE_EPOCH',
    'reject: write under an epoch that does not exist',
  );

  checkRefused(
    asUser(A, sharedEncrypted({ keyEpoch: '7', envelope: envelope(DOMAIN_WIRE.couple, 7) })),
    'E2EE_STALE_EPOCH',
    "reject: another couple's ACTIVE epoch used for this couple_id",
  );

  checkRefused(
    asUser(A, sharedEncrypted({ envelope: envelope(DOMAIN_WIRE.couple, 2) })),
    'E2EE_ENVELOPE_EPOCH_MISMATCH',
    'reject: forged routing — envelope epoch contradicts key_epoch',
  );

  // Rotation: retire epoch 2, activate 3. The row written under 2 must stay
  // readable, and epoch 2 must stop accepting writes.
  mustSql(`
    UPDATE public.scope_keys SET state = 'RETIRED', superseded_at = now()
    WHERE domain = 'personal' AND owner_user_id = '${A}' AND key_epoch = 2`, 'retire epoch 2');
  mustSql(`
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
    VALUES ('personal', '${A}', '${A}', 3, 'ACTIVE')`, 'activate epoch 3');

  const retiredStillReadable = mustAsUser(A, `
    SELECT key_epoch FROM public.daily_records WHERE id = '${privateId}'`, 'retired epoch read');
  check(retiredStillReadable === '2', 'a row under a now-RETIRED epoch is still readable');

  checkRefused(
    asUser(A, privateEncrypted({ keyEpoch: '2', envelope: envelope(DOMAIN_WIRE.personal, 2) })),
    'E2EE_STALE_EPOCH',
    'reject: new write under the just-RETIRED epoch (no resurrection)',
  );

  const newEpochWrite = asUser(A, privateEncrypted({ keyEpoch: '3', envelope: envelope(DOMAIN_WIRE.personal, 3) }));
  check(newEpochWrite.ok, 'a new write under the newly ACTIVE epoch succeeds');
  if (!newEpochWrite.ok) console.error(`    ${newEpochWrite.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  // =========================================================================
  // Scenario 7 — revision CAS and envelope immutability
  // =========================================================================
  console.log('› Scenario 7: revision CAS');

  checkRefused(
    asUser(A, `
      UPDATE public.daily_records
      SET content_envelope = ${envelope(DOMAIN_WIRE.couple, 1, { plaintextBytes: 80 })}
      WHERE id = '${sharedId}'`),
    'E2EE_ENVELOPE_IMMUTABLE|E2EE_REVISION_CAS',
    'reject: rewriting the envelope without advancing content_revision',
  );

  checkRefused(
    asUser(A, `
      UPDATE public.daily_records
      SET content_envelope = ${envelope(DOMAIN_WIRE.couple, 1, { plaintextBytes: 80 })},
          content_revision = content_revision + 5
      WHERE id = '${sharedId}'`),
    'E2EE_REVISION_CAS',
    'reject: revision jumping by more than one',
  );

  const edited = asUser(A, `
    UPDATE public.daily_records
    SET content_envelope = ${envelope(DOMAIN_WIRE.couple, 1, { plaintextBytes: 80 })},
        content_revision = content_revision + 1
    WHERE id = '${sharedId}'`);
  check(edited.ok, 'an honest edit advances the revision by exactly one');
  if (!edited.ok) console.error(`    ${edited.stderr.trim().split('\n').slice(-2).join('\n    ')}`);

  // =========================================================================
  // Scenario 8 — who can read and write what
  // =========================================================================
  console.log('› Scenario 8: authorization for the encrypted rows');

  const bSharedRead = mustAsUser(B, `
    SELECT count(*) FROM public.daily_records
    WHERE id = '${sharedId}' AND content_envelope IS NOT NULL`, 'B reads shared');
  check(bSharedRead === '1', 'the ACTIVE partner receives the shared encrypted record and its envelope');

  const bEnvelopeBytes = mustAsUser(B, `
    SELECT octet_length(content_envelope) FROM public.daily_records WHERE id = '${sharedId}'`,
    'B envelope length');
  check(Number(bEnvelopeBytes) >= 108, `B receives the full envelope bytes (${bEnvelopeBytes})`);

  const bPrivateRead = mustAsUser(B, `
    SELECT count(*) FROM public.daily_records WHERE id = '${privateId}'`, 'B reads private');
  check(bPrivateRead === '0', "the partner cannot see A's PRIVATE record at all");

  const cRead = mustAsUser(C, `
    SELECT count(*) FROM public.daily_records WHERE couple_id = '${COUPLE_AB}'`, 'C reads');
  check(cRead === '0', "an unrelated user reads none of the couple's records");

  const dRead = mustAsUser(D, `
    SELECT count(*) FROM public.daily_records WHERE couple_id = '${COUPLE_AB}'`, 'D reads');
  check(dRead === '0', "a FORMER partner reads none of A's records");

  checkRefused(asAnon('SELECT count(*) FROM public.daily_records'), 'permission denied',
    'reject: anon SELECT on daily_records');

  // The partner's UPDATE. The author policy's USING clause hides the row from B
  // for write purposes, so this is a zero-row no-op rather than an error; assert
  // the EFFECT, because "no error" would otherwise read as success.
  asUser(B, `UPDATE public.daily_records SET content_revision = content_revision + 1 WHERE id = '${sharedId}'`);
  const revisionAfterB = mustSql(`
    SELECT content_revision FROM public.daily_records WHERE id = '${sharedId}'`, 'revision after B');
  check(revisionAfterB === '2', `the partner's UPDATE changed nothing (revision still ${revisionAfterB})`);

  checkRefused(
    asUser(C, sharedEncrypted({ userId: C, coupleId: COUPLE_AB })),
    'violates row-level security|E2EE',
    "reject: unrelated user writes into the couple's space",
  );

  // The former partner: `get_my_active_couple_id()` is NULL for D, so the author
  // policy's WITH CHECK cannot be satisfied for any couple at all.
  const dActiveCouple = mustAsUser(D, "SELECT COALESCE(public.get_my_active_couple_id()::text, 'NULL')",
    'D active couple');
  check(dActiveCouple === 'NULL', 'a disconnected member has no active couple');

  checkRefused(
    asUser(D, sharedEncrypted({ userId: D, coupleId: COUPLE_AD })),
    'violates row-level security|E2EE',
    'reject: disconnected partner writes a new record',
  );

  checkRefused(asAnon(sharedEncrypted()), 'permission denied', 'reject: anon INSERT on daily_records');

  // =========================================================================
  // Scenario 9 — delete semantics
  // =========================================================================
  console.log('› Scenario 9: delete semantics');

  const deletable = nextId();
  mustAsUser(A, sharedEncrypted({ id: deletable }), 'A writes a deletable record');

  asUser(B, `DELETE FROM public.daily_records WHERE id = '${deletable}'`);
  check(
    mustSql(`SELECT count(*) FROM public.daily_records WHERE id = '${deletable}'`, 'after B delete') === '1',
    "the partner cannot DELETE the author's record",
  );

  asUser(C, `DELETE FROM public.daily_records WHERE id = '${deletable}'`);
  check(
    mustSql(`SELECT count(*) FROM public.daily_records WHERE id = '${deletable}'`, 'after C delete') === '1',
    'an unrelated user cannot DELETE the record',
  );

  const aDelete = asUser(A, `DELETE FROM public.daily_records WHERE id = '${deletable}'`);
  check(aDelete.ok, 'the author deletes their own encrypted record');
  check(
    mustSql(`SELECT count(*) FROM public.daily_records WHERE id = '${deletable}'`, 'after A delete') === '0',
    'the deleted row and its envelope are gone',
  );

  // =========================================================================
  // Scenario 10 — the membership branch, where RLS cannot mask it
  // =========================================================================
  // For an authenticated client the author policy already requires an active
  // couple, so 039's membership check would never run and asserting it through
  // `authenticated` would be vacuous. Drive it as the writer RLS does not
  // constrain: service_role.
  console.log('› Scenario 10: couple-domain membership check (service_role path)');

  mustSql(`
    INSERT INTO public.couples (id) VALUES ('${COUPLE_ORPHAN}');
    INSERT INTO public.scope_keys (domain, scope_id, owner_couple_id, key_epoch, state)
    VALUES ('couple', '${COUPLE_ORPHAN}', '${COUPLE_ORPHAN}', 1, 'ACTIVE');
    INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at)
    VALUES ('couple', '${COUPLE_ORPHAN}', 1, now());
  `, 'seed a couple with no active membership');

  checkRefused(
    sql(insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_ORPHAN, isPrivate: false,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'couple'", keyEpoch: '1',
      envelope: envelope(DOMAIN_WIRE.couple, 1),
    })),
    'E2EE_COUPLE_MEMBERSHIP_REQUIRED',
    'reject: couple-domain content for a couple with no active membership (service_role)',
  );

  // =========================================================================
  // Scenario 11 — MUTATION TESTING
  // =========================================================================
  // Every control asserted above is now removed one at a time. If the matching
  // attack is STILL refused with the control gone, the assertion was never
  // testing that control and the proof was vacuous.
  console.log('› Scenario 11: mutation testing the security controls');

  let mutationDb = 0;

  function mutationSurvives(spec) {
    const { label, file, find, replace, probe, expectCode, setup, actor = A } = spec;
    const name = `p5_mut_${(mutationDb += 1)}`;
    let applied = false;
    buildDatabase(name, {
      mutate: (candidate, text) => {
        if (candidate !== file) return text;
        if (!text.includes(find)) throw new Error(`mutation "${label}": pattern not found in ${file}`);
        applied = true;
        return text.split(find).join(replace);
      },
    });
    if (!applied) {
      failures.push(`mutation "${label}": never applied`);
      return;
    }
    seed(name);
    activateFloors(name);
    if (setup) setup(name);

    // The unmutated database must refuse this probe, with the expected cause.
    const control = asUser(actor, probe, DB);
    if (control.ok) {
      failures.push(`mutation "${label}": the probe is ACCEPTED unmutated — it is not testing this control`);
      return;
    }
    if (expectCode && !new RegExp(expectCode).test(control.stderr)) {
      failures.push(`mutation "${label}": unmutated refusal was not ${expectCode}:\n    `
        + control.stderr.trim().split('\n').pop());
      return;
    }

    const mutated = asUser(actor, probe, name);
    check(mutated.ok, `mutation "${label}": removing the check lets the attack through`);
    if (!mutated.ok) {
      failures.push(`  ↳ still refused: ${mutated.stderr.trim().split('\n').pop()} — something ELSE denies it`);
    }
  }

  mutationSurvives({
    label: 'envelope domain header agreement',
    file: '039_daily_records_content_envelope.sql',
    find: 'IF v_header_domain <> v_expected_domain THEN',
    replace: 'IF false THEN',
    probe: sharedEncrypted({ envelope: envelope(DOMAIN_WIRE.personal, 1) }),
    expectCode: 'E2EE_ENVELOPE_DOMAIN_MISMATCH',
  });

  mutationSurvives({
    label: 'envelope epoch header agreement',
    file: '039_daily_records_content_envelope.sql',
    find: 'IF v_header_epoch <> NEW.key_epoch THEN',
    replace: 'IF false THEN',
    probe: sharedEncrypted({ envelope: envelope(DOMAIN_WIRE.couple, 2) }),
    expectCode: 'E2EE_ENVELOPE_EPOCH_MISMATCH',
  });

  mutationSurvives({
    label: 'envelope required for encrypted rows',
    file: '039_daily_records_content_envelope.sql',
    find: 'IF NEW.content_envelope IS NULL THEN',
    replace: 'IF false THEN',
    probe: sharedEncrypted({ envelope: 'NULL' }),
    expectCode: 'E2EE_ENVELOPE_REQUIRED',
  });

  mutationSurvives({
    label: 'no envelope on a plaintext row',
    file: '039_daily_records_content_envelope.sql',
    find: 'IF NEW.content_envelope IS NOT NULL THEN',
    replace: 'IF false THEN',
    // Driven as C, in C's own couple, which has NO write floor. As A the floor
    // rule R1 would refuse this plaintext row first and the probe would be
    // testing the floor rather than the envelope rule.
    actor: C,
    probe: insertRecord({
      id: nextId(), userId: C, coupleId: COUPLE_C, isPrivate: true,
      logText: "'평문'", envelope: envelope(DOMAIN_WIRE.couple, 1),
    }),
    expectCode: 'E2EE_ENVELOPE_ON_PLAINTEXT',
  });

  mutationSurvives({
    label: 'private record must not use the couple key',
    file: '032_e2ee_write_floor.sql',
    find: "IF NEW.is_private AND NEW.key_domain <> 'personal' THEN",
    replace: 'IF false THEN',
    probe: insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: true,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'couple'", keyEpoch: '1',
      envelope: envelope(DOMAIN_WIRE.couple, 1),
    }),
    expectCode: 'E2EE_DOMAIN_BINDING',
  });

  mutationSurvives({
    label: 'shared record must not use the personal key',
    file: '032_e2ee_write_floor.sql',
    find: "IF NOT NEW.is_private AND NEW.key_domain <> 'couple' THEN",
    replace: 'IF false THEN',
    probe: insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: false,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'personal'", keyEpoch: '2',
      envelope: envelope(DOMAIN_WIRE.personal, 2),
    }),
    expectCode: 'E2EE_DOMAIN_BINDING',
  });

  mutationSurvives({
    label: 'only an ACTIVE epoch accepts writes',
    file: '032_e2ee_write_floor.sql',
    find: "WHERE sk.state = 'ACTIVE'",
    replace: "WHERE sk.state IN ('ACTIVE', 'RETIRED')",
    probe: insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: true,
      cipherFormat: '1', contentRevision: '1', keyDomain: "'personal'", keyEpoch: '1',
      envelope: envelope(DOMAIN_WIRE.personal, 1),
    }),
    expectCode: 'E2EE_STALE_EPOCH',
  });

  mutationSurvives({
    label: 'plaintext residue in log_text',
    file: '032_e2ee_write_floor.sql',
    find: "IF NEW.log_text IS NOT NULL AND NEW.log_text <> '' THEN",
    replace: 'IF false THEN',
    probe: sharedEncrypted({ logText: "'남은 평문'" }),
    expectCode: 'E2EE_PLAINTEXT_RESIDUE: log_text',
  });

  mutationSurvives({
    label: 'plaintext residue in attachments',
    file: '032_e2ee_write_floor.sql',
    find: "IF NEW.attachments IS NOT NULL AND NEW.attachments <> '[]'::jsonb THEN",
    replace: 'IF false THEN',
    probe: sharedEncrypted({ attachments: '\'[{"type":"photo","name":"a.jpg","path":"p"}]\'::jsonb' }),
    expectCode: 'E2EE_PLAINTEXT_RESIDUE: attachments',
  });

  mutationSurvives({
    label: 'the write floor blocks new plaintext',
    file: '032_e2ee_write_floor.sql',
    find: 'IF TG_OP = \'INSERT\' AND NEW.cipher_format < v_floor THEN',
    replace: 'IF false THEN',
    probe: insertRecord({
      id: nextId(), userId: A, coupleId: COUPLE_AB, isPrivate: false, logText: "'평문 침입'",
    }),
    expectCode: 'E2EE_WRITE_FLOOR',
  });

  // The downgrade rule needs an existing encrypted row, and it deliberately
  // OVERLAPS the floor rule. Both facts are asserted: with R3 alone removed the
  // floor still refuses but with a DIFFERENT code, and with both removed the
  // downgrade goes through — which is what shows neither is decorative.
  {
    const downgradeSql = (rowId) => `
      UPDATE public.daily_records
      SET cipher_format = 0, content_envelope = NULL, content_revision = content_revision + 1
      WHERE id = '${rowId}'`;

    const r3Only = `p5_mut_${(mutationDb += 1)}`;
    buildDatabase(r3Only, {
      mutate: (candidate, text) => (candidate === '032_e2ee_write_floor.sql'
        ? text.split("IF TG_OP = 'UPDATE' AND OLD.cipher_format >= 1 AND NEW.cipher_format < OLD.cipher_format THEN")
          .join('IF false THEN')
        : text),
    });
    seed(r3Only);
    activateFloors(r3Only);
    const r3RowId = nextId();
    mustAsUser(A, sharedEncrypted({ id: r3RowId }), 'seed encrypted row (R3 removed)', r3Only);
    const r3Result = asUser(A, downgradeSql(r3RowId), r3Only);
    check(
      !r3Result.ok && /E2EE_WRITE_FLOOR/.test(r3Result.stderr)
        && !/E2EE_DOWNGRADE_FORBIDDEN/.test(r3Result.stderr),
      'mutation "downgrade rule": with R3 gone the floor rule R2 still refuses, under its own code',
    );

    const bothGone = `p5_mut_${(mutationDb += 1)}`;
    buildDatabase(bothGone, {
      mutate: (candidate, text) => {
        if (candidate !== '032_e2ee_write_floor.sql') return text;
        return text
          .split("IF TG_OP = 'UPDATE' AND OLD.cipher_format >= 1 AND NEW.cipher_format < OLD.cipher_format THEN")
          .join('IF false THEN')
          .split("IF TG_OP = 'UPDATE' AND NEW.cipher_format < v_floor THEN")
          .join('IF false THEN');
      },
    });
    seed(bothGone);
    activateFloors(bothGone);
    const bothRowId = nextId();
    mustAsUser(A, sharedEncrypted({ id: bothRowId }), 'seed encrypted row (both gone)', bothGone);
    const bothResult = asUser(A, downgradeSql(bothRowId), bothGone);
    check(
      bothResult.ok,
      'mutation "downgrade + floor": removing both lets the plaintext downgrade through',
    );
    if (!bothResult.ok) {
      failures.push(`  ↳ still refused: ${bothResult.stderr.trim().split('\n').pop()}`);
    }
  }

  // The partner SELECT policy. Removing the `is_private = false` conjunct must
  // expose A's private record to B — otherwise scenario 8's privacy assertion
  // was passing for some unrelated reason.
  {
    const name = `p5_mut_${(mutationDb += 1)}`;
    const baselineText = readFileSync(BASELINE, 'utf8');
    const find = 'AND is_private = false';
    if (!baselineText.includes(find)) throw new Error('mutation "partner visibility": pattern not found');
    const mutatedBaseline = join(dir, `${name}-baseline.sql`);
    writeFileSync(mutatedBaseline, baselineText.split(find).join(''));
    buildDatabase(name, { baselineFile: mutatedBaseline });
    seed(name);
    const privId = nextId();
    mustAsUser(A, insertRecord({
      id: privId, userId: A, coupleId: COUPLE_AB, isPrivate: true, logText: "'비공개'",
    }), 'seed private plaintext row', name);
    const exposed = mustAsUser(B, `
      SELECT count(*) FROM public.daily_records WHERE id = '${privId}'`, 'B reads private', name);
    check(
      exposed === '1',
      'mutation "partner visibility": removing `is_private = false` exposes the private row',
    );
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------

console.log('');
for (const pass of passes) console.log(`  ✓ ${pass}`);

if (failures.length > 0) {
  console.error('\nP5 HARNESS: FAIL');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} passed, ${failures.length} failed`);
  process.exit(1);
}

console.log(`\nP5 HARNESS: PASS (${passes.length} assertions)`);
