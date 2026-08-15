#!/usr/bin/env node
/**
 * Real PostgreSQL proof for migration 040.
 *
 * Every assertion is driven as a real authenticated/anon actor. The mutation
 * probes remove the exact-scope branch from the forward migration and must then
 * make a previously-allowed cross-scope write fail.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  '040_e2ee_write_floor_scope_semantics.sql',
];
const PG_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };
const keep = process.argv.includes('--keep');
const have = (binary) => spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;

if (!['initdb', 'pg_ctl', 'psql'].every(have)) {
  console.error('POSTGRES UNAVAILABLE: initdb/pg_ctl/psql not found on PATH.');
  console.error('This is a MISSING VERIFICATION, not a pass.');
  process.exit(2);
}
for (const file of FORWARD) {
  if (!existsSync(join(MIGRATIONS, file))) throw new Error(`missing migration ${file}`);
}

const dir = mkdtempSync(join(tmpdir(), 'gomsinlog-floor-'));
const dataDir = join(dir, 'pgdata');
const socketDir = join(dir, 'sock');
execFileSync('mkdir', ['-p', socketDir], { env: PG_ENV });
let started = false;
function shutdown() {
  if (started) spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: PG_ENV });
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

const DB = 'floor_scope';
function psql(args, db = DB) {
  const result = spawnSync('psql', ['-h', socketDir, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8', env: PG_ENV,
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function sql(text, db = DB) { return psql(['-At', '-c', text], db); }
function mustSql(text, label, db = DB) {
  const result = sql(text, db);
  if (!result.ok) throw new Error(`${label} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}
function asRole(role, userId, text, db = DB) {
  const args = ['-At', '-c', `SET ROLE ${role}`];
  if (userId) args.push('-c', `DO $h$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $h$`);
  args.push('-c', text);
  return psql(args, db);
}
const asUser = (userId, text, db) => asRole('authenticated', userId, text, db);
const asAnon = (text, db) => asRole('anon', null, text, db);
const failures = [];
const passes = [];
function check(condition, message) {
  (condition ? passes : failures).push(message);
  return condition;
}
function refused(result, code, message) {
  if (!result.ok) return check(!code || new RegExp(code).test(result.stderr), message);
  failures.push(`${message} — operation succeeded`);
  return false;
}

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';
const D = 'dddddddd-0000-4000-8000-00000000000d';
const AB = '11111111-0000-4000-8000-000000000001';
const AC = '22222222-0000-4000-8000-000000000002';
const AD = '33333333-0000-4000-8000-000000000003';
const DEVICE_A = 'aaaaaaaa-1111-4000-8000-00000000000a';
const DEVICE_B = 'bbbbbbbb-1111-4000-8000-00000000000b';
const DEVICE_C = 'cccccccc-1111-4000-8000-00000000000c';
const DEVICE_D = 'dddddddd-1111-4000-8000-00000000000d';
let id = 0;
const nextId = () => `00000000-0400-4000-8000-${(++id).toString(16).padStart(12, '0')}`;
const bytes = (n, hex) => `decode(repeat('${hex}', ${n}), 'hex')`;
const envelope = (wire, epoch = 1) => {
  const head = `474c45310101010300${BigInt(epoch).toString(16).padStart(16, '0')}`;
  return `decode('${head}${'ab'.repeat(72 + 64 + 16)}', 'hex')`;
};
function record({ privateRow, encrypted = false, user = A, couple = AB, epoch = 1 }) {
  const idValue = nextId();
  const domain = privateRow ? 'personal' : 'couple';
  const wire = privateRow ? 1 : 3;
  return {
    id: idValue,
    sql: `INSERT INTO public.daily_records
      (id,user_id,couple_id,record_date,record_time,log_text,reaction,attachments,emotion_flow,is_private,cipher_format,content_revision,key_domain,key_epoch,content_envelope)
      VALUES ('${idValue}','${user}','${couple}','2026-08-15',NULL,${encrypted ? "''" : "'plaintext'"},NULL,'[]'::jsonb,'[]'::jsonb,${privateRow},${encrypted ? 1 : 0},1,${encrypted ? `'${domain}'` : 'NULL'},${encrypted ? epoch : 'NULL'},${encrypted ? envelope(wire, epoch) : 'NULL'})`,
  };
}

console.log('› initialising throwaway PostgreSQL cluster');
execFileSync('initdb', ['-D', dataDir, '-U', process.env.USER ?? 'postgres', '-A', 'trust', '--no-sync', '--locale=C', '-E', 'UTF8'], { stdio: 'ignore', env: PG_ENV });
writeFileSync(join(dataDir, 'postgresql.conf'), [`unix_socket_directories = '${socketDir}'`, "listen_addresses = ''", 'fsync = off', 'full_page_writes = off'].join('\n') + '\n', { flag: 'a' });
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir}`, '-w', '-l', join(dir, 'pg.log'), 'start'], { stdio: 'ignore', env: PG_ENV });
started = true;
function createDatabase(name) {
  const create = spawnSync('psql', ['-h', socketDir, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-c', `CREATE DATABASE ${name}`], { encoding: 'utf8', env: PG_ENV });
  if (create.status !== 0) throw new Error(`create database ${name} failed:\n${create.stderr}`);
}
function apply(name, mutate) {
  mustPsql(BASELINE, `baseline ${name}`, name);
  for (const file of FORWARD) {
    const original = readFileSync(join(MIGRATIONS, file), 'utf8');
    const changed = mutate?.(file, original) ?? original;
    if (changed === original) mustPsql(join(MIGRATIONS, file), `apply ${file}`, name);
    else {
      const patched = join(dir, `${name}-${file}`);
      writeFileSync(patched, changed);
      mustPsql(patched, `apply mutated ${file}`, name);
    }
  }
}
function mustPsql(file, label, db = DB) {
  const result = spawnSync('psql', ['-h', socketDir, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', file], { encoding: 'utf8', env: PG_ENV });
  if (result.status !== 0) throw new Error(`${label} failed:\n${(result.stderr ?? '').trim()}`);
}
function seed(name = DB) {
  mustSql(`
    INSERT INTO auth.users (id,email) VALUES ('${A}','a@test'),('${B}','b@test'),('${C}','c@test'),('${D}','d@test');
    INSERT INTO public.couples (id) VALUES ('${AB}'),('${AC}'),('${AD}');
    INSERT INTO public.couple_members (couple_id,user_id,status) VALUES
      ('${AB}','${A}','active'),('${AB}','${B}','active'),('${AC}','${C}','active'),
      ('${AD}','${A}','disconnected'),('${AD}','${D}','disconnected');
    INSERT INTO public.devices (id,user_id,sig_spki,kem_spki,platform,assurance,status)
      VALUES ('${DEVICE_A}','${A}',${bytes(91,'11')},${bytes(91,'12')},'ios','software_keystore','ACTIVE'),
             ('${DEVICE_B}','${B}',${bytes(91,'21')},${bytes(91,'22')},'android','software_keystore','ACTIVE'),
             ('${DEVICE_C}','${C}',${bytes(91,'31')},${bytes(91,'32')},'ios','software_keystore','ACTIVE'),
             ('${DEVICE_D}','${D}',${bytes(91,'41')},${bytes(91,'42')},'ios','software_keystore','ACTIVE');
  `, 'seed actors', name);
  mustSql(`
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;
    GRANT SELECT ON public.couple_members, public.couples, public.devices, public.scope_keys TO authenticated;
    GRANT INSERT,UPDATE,SELECT,DELETE ON public.daily_records TO authenticated;
  `, 'harness grants', name);
}
function epoch(domain, scopeId, ownerUser, ownerCouple, state = 'ACTIVE', e = 1, name = DB) {
  mustSql(`INSERT INTO public.scope_keys (domain,scope_id,owner_user_id,owner_couple_id,key_epoch,state)
    VALUES ('${domain}','${scopeId}',${ownerUser ? `'${ownerUser}'` : 'NULL'},${ownerCouple ? `'${ownerCouple}'` : 'NULL'},${e},'${state}')`, 'seed epoch', name);
}
function floor(kind, scopeId, name = DB) {
  mustSql(`INSERT INTO public.crypto_write_floor (scope_kind,scope_id,min_cipher_format,activated_at) VALUES ('${kind}','${scopeId}',1,now())`, 'seed floor', name);
}
function activate(kind, scopeId, deviceId, userId = A, name = DB) {
  return asUser(userId, `SELECT public.activate_e2ee_write_floor('${kind}','${scopeId}','${deviceId}')`, name);
}
function prepare(name, mutate) {
  createDatabase(name);
  apply(name, mutate);
  seed(name);
}

try {
  // Exact applicability: only one floor can govern each branch.
  const userDb = 'floor_user';
  prepare(userDb);
  epoch('personal', A, A, null, 'ACTIVE', 1, userDb); epoch('couple', AB, null, AB, 'ACTIVE', 1, userDb);
  floor('user', A, userDb);
  refused(asUser(A, record({ privateRow: true }).sql, userDb), 'E2EE_WRITE_FLOOR', 'only user floor: private plaintext denied');
  check(asUser(A, record({ privateRow: false }).sql, userDb).ok, 'only user floor: shared plaintext allowed');
  refused(asUser(A, record({ privateRow: false, encrypted: true }).sql, userDb), 'E2EE_FLOOR_NOT_ACTIVE', 'personal floor only + shared ciphertext: exact scope refuses');

  const coupleDb = 'floor_couple';
  prepare(coupleDb);
  epoch('personal', A, A, null, 'ACTIVE', 1, coupleDb); epoch('couple', AB, null, AB, 'ACTIVE', 1, coupleDb);
  floor('couple', AB, coupleDb);
  refused(asUser(A, record({ privateRow: false }).sql, coupleDb), 'E2EE_WRITE_FLOOR', 'only couple floor: shared plaintext denied');
  check(asUser(A, record({ privateRow: true }).sql, coupleDb).ok, 'only couple floor: private plaintext allowed');
  refused(asUser(A, record({ privateRow: true, encrypted: true }).sql, coupleDb), 'E2EE_FLOOR_NOT_ACTIVE', 'couple floor only + private ciphertext: exact scope refuses');

  // Personal activation is PMK-only and identity-bound.
  const activationDb = 'floor_activation';
  prepare(activationDb);
  epoch('personal', A, A, null, 'ACTIVE', 1, activationDb);
  const success = activate('user', A, DEVICE_A, A, activationDb);
  check(success.ok, 'personal activation: ACTIVE PMK succeeds');
  createDatabase('floor_personal_cases'); apply('floor_personal_cases'); seed('floor_personal_cases');
  const cases = 'floor_personal_cases';
  epoch('personal', A, A, null, 'RETIRED', 1, cases);
  refused(activate('user', A, DEVICE_A, A, cases), 'E2EE_FLOOR_NO_ACTIVE_PERSONAL_EPOCH', 'personal activation: RETIRED-only denied');
  epoch('health', A, A, null, 'ACTIVE', 1, cases);
  refused(activate('user', A, DEVICE_A, A, cases), 'E2EE_FLOOR_NO_ACTIVE_PERSONAL_EPOCH', 'personal activation: HRK-only denied');
  refused(activate('user', A, DEVICE_B, B, cases), 'E2EE_FLOOR_SCOPE_FORBIDDEN|E2EE_DEVICE_SCOPE_FORBIDDEN', 'personal activation: wrong user denied');
  refused(asAnon(`SELECT public.activate_e2ee_write_floor('user','${A}','${DEVICE_A}')`, cases), 'Not authenticated|permission denied', 'personal activation: anon denied');

  // Couple activation requires an active member and matching owner_couple_id.
  epoch('couple', AB, null, AB, 'ACTIVE', 1, activationDb);
  const coupleSuccess = activate('couple', AB, DEVICE_A, A, activationDb);
  check(coupleSuccess.ok, 'couple activation: active member succeeds');
  refused(activate('couple', AB, DEVICE_C, C, activationDb), 'E2EE_FLOOR_SCOPE_FORBIDDEN', 'couple activation: unrelated user denied');
  refused(activate('couple', AD, DEVICE_D, D, activationDb), 'E2EE_FLOOR_SCOPE_FORBIDDEN', 'couple activation: former partner denied');
  refused(activate('couple', AC, DEVICE_A, A, activationDb), 'E2EE_FLOOR_SCOPE_FORBIDDEN|E2EE_FLOOR_NO_ACTIVE_COUPLE_EPOCH', 'couple activation: wrong couple denied');

  // Mutation proof: forcing the shared branch through the user scope makes an
  // allowed shared plaintext write fail under a user-only floor.
  const mutationName = 'floor_scope_mutation';
  const mutated = join(MIGRATIONS, '040_e2ee_write_floor_scope_semantics.sql');
  const text = readFileSync(mutated, 'utf8');
  const find = "  ELSE\n    v_scope_kind := 'couple';\n    v_scope_id := NEW.couple_id;\n  END IF;";
  if (!text.includes(find)) throw new Error('mutation pattern missing');
  const changed = text.replace(find, "  ELSE\n    v_scope_kind := 'user';\n    v_scope_id := NEW.user_id;\n  END IF;");
  const patchFile = join(dir, '040-mutated.sql'); writeFileSync(patchFile, changed);
  createDatabase(mutationName);
  mustPsql(BASELINE, 'mutation baseline', mutationName);
  for (const file of FORWARD) mustPsql(file === '040_e2ee_write_floor_scope_semantics.sql' ? patchFile : join(MIGRATIONS, file), `mutation ${file}`, mutationName);
  seed(mutationName); epoch('personal', A, A, null, 'ACTIVE', 1, mutationName); floor('user', A, mutationName);
  refused(asUser(A, record({ privateRow: false }).sql, mutationName), 'E2EE_WRITE_FLOOR', 'mutation: removing couple branch makes the shared write fail');

  const overload = mustSql("SELECT count(*) FROM pg_proc WHERE proname='e2ee_floor_for' AND pg_get_function_identity_arguments(oid)='uuid, uuid'", 'obsolete overload check', activationDb);
  check(overload === '0', 'obsolete UUID,UUID helper overload is absent');
  const triggerSecurity = mustSql("SELECT prosecdef::int FROM pg_proc WHERE oid='public.enforce_e2ee_write_floor()'::regprocedure", 'trigger security check', activationDb);
  check(triggerSecurity === '1', 'write-floor trigger remains SECURITY DEFINER');
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

console.log('');
for (const pass of passes) console.log(`  ✓ ${pass}`);
if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`\nWRITE-FLOOR SCOPE HARNESS: PASS (${passes.length} assertions)`);
}
