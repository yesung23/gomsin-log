#!/usr/bin/env node
/**
 * Executable proof that the Phase 1A rollback works — and refuses when it must.
 *
 * SQL text inspection cannot establish either claim. A drop list that looks
 * complete still fails on a real cluster when a function is typed on a table's
 * row type; a refusal clause that reads correctly still passes silently if the
 * evidence it queries lives in a column that no longer exists. So this harness
 * starts a throwaway PostgreSQL cluster and actually runs the migrations.
 *
 * Two scenarios, both required:
 *
 *   CLEAN     baseline -> 031 -> 032 -> 034 -> 033
 *             must succeed, and the resulting schema inventory must equal the
 *             baseline inventory exactly. Not "no Phase 1A tables remain" —
 *             equal, so a leftover function or a column that failed to come
 *             back is a failure too.
 *
 *   ACTIVATED baseline -> 031 -> 032 -> 034 -> activation evidence -> 033
 *             must FAIL, and every Phase 1A object must still be present
 *             afterwards. A refusal that half-applied would be worse than no
 *             refusal at all, which is why the transaction wraps everything.
 *
 * Nothing here touches any configured Supabase project. The cluster is created
 * under a temporary directory, listens on a unix socket only, and is destroyed
 * on exit.
 *
 * Usage: node scripts/e2ee/rollback-harness.mjs [--keep]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const BASELINE = join(import.meta.dirname, 'baseline.sql');

const FORWARD = [
  '031_e2ee_key_foundation.sql',
  '032_e2ee_write_floor.sql',
  '034_e2ee_recovery_challenge_issuance.sql',
  // 035 adds functions AND two triggers on `devices`. It is included here so the
  // inventory diff proves the rollback reverses it too: without this the harness
  // would keep passing while 033 silently left the P0-closure objects behind.
  '035_e2ee_phase1a_p0_closure.sql',
];
const ROLLBACK = '033_rollback_e2ee_key_foundation.sql.disabled';

const keep = process.argv.includes('--keep');

/**
 * Force the C locale for every child process.
 *
 * Two reasons, both learned from this harness failing. On macOS a postmaster
 * inheriting a UTF-8 locale can become multithreaded during startup and abort
 * outright. And server messages are localised, so a refusal assertion that
 * matches on English text would silently stop matching on a Korean-locale
 * machine — which is this one.
 */
const PG_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };

function have(binary) {
  return spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
}

if (!have('initdb') || !have('pg_ctl') || !have('psql')) {
  console.error('POSTGRES UNAVAILABLE: initdb/pg_ctl/psql not found on PATH.');
  console.error('The rollback harness cannot run here. This is a MISSING VERIFICATION, not a pass.');
  process.exit(2);
}

for (const file of [...FORWARD, ROLLBACK]) {
  if (!existsSync(join(MIGRATIONS, file))) {
    console.error(`MISSING MIGRATION: ${file}`);
    process.exit(2);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'gomsinlog-rollback-'));
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

/** Run psql against one database. Returns { ok, stdout, stderr }. */
function psql(database, args, { input } = {}) {
  const result = spawnSync(
    'psql',
    ['-h', socketDir, '-d', database, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', input, env: PG_ENV },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function mustPsql(database, args, label, options) {
  const result = psql(database, args, options);
  if (!result.ok) {
    throw new Error(`${label} failed:\n${result.stderr.trim()}`);
  }
  return result;
}

/**
 * A comparable inventory of the schema.
 *
 * Deliberately covers more than table names: a rollback that removed the tables
 * but left a function, a trigger, an index or a nullability change behind would
 * pass a table-only check and leave the database subtly different from the one
 * it claimed to restore.
 */
const INVENTORY_SQL = `
SELECT 'table:' || table_name
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
UNION ALL
SELECT 'column:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
UNION ALL
SELECT 'function:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('public', 'auth')
UNION ALL
SELECT 'trigger:' || c.relname || '.' || t.tgname
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
UNION ALL
SELECT 'index:' || indexname
  FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'policy:' || tablename || '.' || policyname
  FROM pg_policies WHERE schemaname = 'public'
ORDER BY 1;
`;

function inventory(database) {
  const result = mustPsql(database, ['-At', '-c', INVENTORY_SQL], `inventory of ${database}`);
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function applyFile(database, file, label) {
  return mustPsql(database, ['-f', join(MIGRATIONS, file)], label);
}

function createDatabase(name) {
  mustPsql('postgres', ['-c', `CREATE DATABASE ${name}`], `create ${name}`);
  mustPsql(name, ['-f', BASELINE], `baseline for ${name}`);
}

function diff(before, after) {
  const removed = before.filter((item) => !after.includes(item));
  const added = after.filter((item) => !before.includes(item));
  return { removed, added };
}

const failures = [];
function check(condition, message) {
  if (condition) return;
  failures.push(message);
}

// ---------------------------------------------------------------------------

console.log('› initialising a throwaway PostgreSQL cluster');
execFileSync(
  'initdb',
  ['-D', dataDir, '-U', process.env.USER ?? 'postgres', '-A', 'trust', '--no-sync', '--locale=C', '-E', 'UTF8'],
  { stdio: 'ignore', env: PG_ENV },
);
writeFileSync(join(dataDir, 'postgresql.conf'), [
  `unix_socket_directories = '${socketDir}'`,
  'listen_addresses = \'\'',
  'fsync = off',
  'full_page_writes = off',
].join('\n') + '\n', { flag: 'a' });

execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir}`, '-w', '-l', join(dir, 'pg.log'), 'start'], {
  stdio: 'ignore',
  env: PG_ENV,
});
started = true;

try {
  // -------------------------------------------------------------------------
  // Scenario CLEAN
  // -------------------------------------------------------------------------
  console.log('› CLEAN: baseline → 031 → 032 → 034 → 035 → 033');
  createDatabase('clean_rollback');
  const baselineInventory = inventory('clean_rollback');

  for (const file of FORWARD) applyFile('clean_rollback', file, `apply ${file}`);
  const appliedInventory = inventory('clean_rollback');

  const applied = diff(baselineInventory, appliedInventory);
  check(applied.added.length > 50, `expected the forward migrations to add many objects, saw ${applied.added.length}`);
  // Spot-check the objects the report claims exist, so a silently no-op forward
  // migration cannot make the rollback look successful.
  for (const expected of [
    'table:devices',
    'table:recovery_identities',
    'table:recovery_public_anchors',
    'table:scope_keys',
    'table:key_envelopes',
    'table:recovery_challenges',
    'table:crypto_write_floor',
    'table:migration_ledger',
    'function:e2ee_issue_recovery_challenge(p_user_id uuid, p_device_id uuid, p_challenge bytea, p_ttl_seconds integer)',
    'function:e2ee_can_manage_scope_key(p_scope_key scope_keys)',
    'function:e2ee_finalize_device_provisioning(p_device_id uuid)',
    'function:e2ee_owned_couple_scope_ids()',
    'function:e2ee_missing_device_coverage(p_device_id uuid)',
    'trigger:devices.trg_devices_status_transition',
    'index:idx_recovery_challenge_live_device',
    'trigger:daily_records.trg_daily_records_write_floor',
    'trigger:couple_members.trg_membership_revision',
  ]) {
    check(appliedInventory.includes(expected), `forward migrations did not create ${expected}`);
  }

  const rollbackResult = psql('clean_rollback', ['-f', join(MIGRATIONS, ROLLBACK)]);
  check(rollbackResult.ok, `CLEAN rollback failed:\n${rollbackResult.stderr.trim()}`);

  if (rollbackResult.ok) {
    const restored = inventory('clean_rollback');
    const delta = diff(baselineInventory, restored);
    check(
      delta.added.length === 0,
      `rollback left ${delta.added.length} object(s) behind:\n  ${delta.added.join('\n  ')}`,
    );
    check(
      delta.removed.length === 0,
      `rollback removed ${delta.removed.length} pre-existing object(s):\n  ${delta.removed.join('\n  ')}`,
    );
  }

  // -------------------------------------------------------------------------
  // Scenario ACTIVATED
  // -------------------------------------------------------------------------
  console.log('› ACTIVATED: rollback must refuse and change nothing');
  createDatabase('activated_rollback');
  for (const file of FORWARD) applyFile('activated_rollback', file, `apply ${file}`);
  const activatedBefore = inventory('activated_rollback');

  // The evidence: an activated write floor AND a content row actually written
  // as ciphertext. Inserted with the trigger disabled, because the point is to
  // simulate a database that reached this state, not to re-test 032's guards.
  mustPsql('activated_rollback', ['-c', `
    ALTER TABLE public.daily_records DISABLE TRIGGER trg_daily_records_write_floor;
    INSERT INTO auth.users (id) VALUES ('11111111-1111-4111-8111-111111111111');
    INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at)
      VALUES ('user', '11111111-1111-4111-8111-111111111111', 1, now());
    INSERT INTO public.daily_records (user_id, cipher_format, key_domain, key_epoch, record_time)
      VALUES ('11111111-1111-4111-8111-111111111111', 1, 'personal', 1, NULL);
    ALTER TABLE public.daily_records ENABLE TRIGGER trg_daily_records_write_floor;
  `], 'insert activation evidence');

  const refused = psql('activated_rollback', ['-f', join(MIGRATIONS, ROLLBACK)]);
  check(!refused.ok, 'ACTIVATED rollback SUCCEEDED; it must refuse');
  check(
    /E2EE_ROLLBACK_REFUSED/.test(refused.stderr),
    `refusal did not name E2EE_ROLLBACK_REFUSED:\n${refused.stderr.trim()}`,
  );

  // And it must have changed nothing: the whole file is one transaction.
  const activatedAfter = inventory('activated_rollback');
  const untouched = diff(activatedBefore, activatedAfter);
  check(
    untouched.added.length === 0 && untouched.removed.length === 0,
    `refused rollback still modified the schema:\n  removed ${untouched.removed.join(', ')}\n  added ${untouched.added.join(', ')}`,
  );

  // The floor row is irreversible by design; confirm the refusal left it alone.
  const floors = mustPsql(
    'activated_rollback',
    ['-At', '-c', 'SELECT count(*) FROM public.crypto_write_floor WHERE min_cipher_format >= 1'],
    'floor count',
  );
  check(floors.stdout.trim() === '1', 'the activated write floor did not survive the refusal');

  // -------------------------------------------------------------------------
  // Scenario LEDGER-ONLY — evidence without ciphertext still refuses
  // -------------------------------------------------------------------------
  console.log('› LEDGER: a migration acknowledgement alone must also refuse');
  createDatabase('ledger_rollback');
  for (const file of FORWARD) applyFile('ledger_rollback', file, `apply ${file}`);
  mustPsql('ledger_rollback', ['-c', `
    INSERT INTO auth.users (id) VALUES ('22222222-2222-4222-8222-222222222222');
    INSERT INTO public.migration_ledger
      (user_id, object_type, object_id, source_revision, ciphertext_hash, key_domain,
       key_epoch, migrating_device_id, ack_signature)
    VALUES
      ('22222222-2222-4222-8222-222222222222', 1, gen_random_uuid(), 1,
       decode(repeat('00', 32), 'hex'), 'personal', 1, gen_random_uuid(),
       decode(repeat('00', 64), 'hex'));
  `], 'insert ledger evidence');

  const ledgerRefused = psql('ledger_rollback', ['-f', join(MIGRATIONS, ROLLBACK)]);
  check(!ledgerRefused.ok, 'rollback succeeded despite a migration ledger entry');
  check(
    /E2EE_ROLLBACK_REFUSED/.test(ledgerRefused.stderr),
    'ledger refusal did not name E2EE_ROLLBACK_REFUSED',
  );
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error('\nROLLBACK HARNESS: FAIL');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\nROLLBACK HARNESS: PASS');
console.log('  ✓ CLEAN     031→032→034→035→033 restores the pre-031 inventory exactly');
console.log('  ✓ ACTIVATED rollback refuses and leaves the schema untouched');
console.log('  ✓ LEDGER    a migration acknowledgement alone also refuses');
