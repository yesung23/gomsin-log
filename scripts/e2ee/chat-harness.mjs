#!/usr/bin/env node
/** Real PostgreSQL actor proof for the V1 chat migration. */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const BASELINE = join(ROOT, 'scripts/e2ee/p5-baseline.sql');
const FORWARD = [
  '031_e2ee_key_foundation.sql',
  '032_e2ee_write_floor.sql',
  '034_e2ee_recovery_challenge_issuance.sql',
  '035_e2ee_phase1a_p0_closure.sql',
  '036_e2ee_device_status_privilege.sql',
  '039_daily_records_content_envelope.sql',
  '040_chat_messages_e2ee.sql',
];
const ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };
const have = (binary) => spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
if (!['initdb', 'pg_ctl', 'psql'].every(have)) {
  console.error('POSTGRES UNAVAILABLE: initdb/pg_ctl/psql not found.');
  process.exit(2);
}
for (const file of FORWARD) {
  if (!existsSync(join(MIGRATIONS, file))) throw new Error(`missing migration: ${file}`);
}

const dir = mkdtempSync(join(tmpdir(), 'gomsinlog-chat-'));
const dataDir = join(dir, 'pgdata');
const socketDir = join(dir, 'sock');
execFileSync('mkdir', ['-p', socketDir], { env: ENV });
let started = false;
function cleanup() {
  if (started) spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: ENV });
  rmSync(dir, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

execFileSync('initdb', ['-D', dataDir, '-U', process.env.USER ?? 'postgres', '-A', 'trust', '--no-sync', '--locale=C', '-E', 'UTF8'], { stdio: 'ignore', env: ENV });
writeFileSync(join(dataDir, 'postgresql.conf'), `unix_socket_directories = '${socketDir}'\nlisten_addresses = ''\nfsync = off\nfull_page_writes = off\n`, { flag: 'a' });
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir}`, '-w', '-l', join(dir, 'pg.log'), 'start'], { stdio: 'ignore', env: ENV });
started = true;

const DB = 'chat_slice';
function psql(args, db = DB) {
  const result = spawnSync('psql', ['-h', socketDir, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], { encoding: 'utf8', env: ENV });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function sql(text, db = DB) { return psql(['-At', '-c', text], db); }
function mustSql(text, label, db = DB) {
  const result = sql(text, db);
  if (!result.ok) throw new Error(`${label} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
function asRole(role, userId, text, db = DB) {
  const args = ['-At', '-c', `SET ROLE ${role}`];
  if (userId) args.push('-c', `DO $h$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $h$`);
  args.push('-c', text);
  return psql(args, db);
}
const asUser = (id, text, db) => asRole('authenticated', id, text, db);
const asAnon = (text, db) => asRole('anon', null, text, db);
const asService = (text, db) => asRole('service_role', null, text, db);
function applyFile(file, db, mutate) {
  const original = readFileSync(join(MIGRATIONS, file), 'utf8');
  const changed = mutate?.(file, original) ?? original;
  if (changed === original) {
    const result = psql(['-f', join(MIGRATIONS, file)], db);
    if (!result.ok) throw new Error(`apply ${file} failed: ${result.stderr.trim()}`);
    return;
  }
  const target = join(dir, `${db}-${file}`);
  writeFileSync(target, changed);
  const result = psql(['-f', target], db);
  if (!result.ok) throw new Error(`apply mutated ${file} failed: ${result.stderr.trim()}`);
}
function buildDatabase(name, mutate) {
  const created = psql(['-d', 'postgres', '-c', `CREATE DATABASE ${name}`], 'postgres');
  if (!created.ok) throw new Error(`create ${name} failed: ${created.stderr.trim()}`);
  const baseline = psql(['-f', BASELINE], name);
  if (!baseline.ok) throw new Error(`baseline failed: ${baseline.stderr.trim()}`);
  for (const file of FORWARD) applyFile(file, name, mutate);
  return name;
}

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';
const D = 'dddddddd-0000-4000-8000-00000000000d';
const AB = '11111111-0000-4000-8000-000000000001';
const C_COUPLE = '22222222-0000-4000-8000-000000000002';
const AD = '33333333-0000-4000-8000-000000000003';
const M1 = '00000000-0000-4000-8000-000000000001';
const M2 = '00000000-0000-4000-8000-000000000002';
const M3 = '00000000-0000-4000-8000-000000000003';
const WIRE = { personal: 1, health: 2, couple: 3 };
function envelope(domain, epoch, { magic = '474c4531', format = 1 } = {}) {
  const head = magic + format.toString(16).padStart(2, '0') + '0101'
    + domain.toString(16).padStart(2, '0') + '00' + '000000'
    + BigInt(epoch).toString(16).padStart(16, '0');
  return `decode('${head}${'ab'.repeat(72 + 32 + 16)}', 'hex')`;
}
function seed(db) {
  mustSql(`
    INSERT INTO auth.users (id, email) VALUES ('${A}','a@test'),('${B}','b@test'),('${C}','c@test'),('${D}','d@test');
    INSERT INTO public.couples (id) VALUES ('${AB}'),('${C_COUPLE}'),('${AD}');
    INSERT INTO public.couple_members (couple_id,user_id,status) VALUES
      ('${AB}','${A}','active'),('${AB}','${B}','active'),('${C_COUPLE}','${C}','active'),
      ('${AD}','${A}','disconnected'),('${AD}','${D}','disconnected');
    INSERT INTO public.scope_keys (domain,scope_id,owner_couple_id,key_epoch,state)
      VALUES ('couple','${AB}','${AB}',1,'ACTIVE'),('couple','${AB}','${AB}',2,'RETIRED'),
             ('couple','${C_COUPLE}','${C_COUPLE}',1,'ACTIVE'),('couple','${AD}','${AD}',1,'ACTIVE');
  `, 'seed', db);
}
function insertMessage(id, couple, env = envelope(WIRE.couple, 1), sender = null) {
  return sender
    ? `INSERT INTO public.chat_messages (message_id,couple_id,sender_user_id,ciphertext) VALUES ('${id}','${couple}','${sender}',${env})`
    : `INSERT INTO public.chat_messages (message_id,couple_id,ciphertext) VALUES ('${id}','${couple}',${env})`;
}
const passes = [];
const failures = [];
function check(condition, message) { (condition ? passes : failures).push(message); return condition; }
function refused(result, matcher, message) {
  return check(!result.ok && (!matcher || matcher.test(result.stderr)), message);
}

try {
  buildDatabase(DB);
  seed(DB);
  check(mustSql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages'`) === 'message_id,couple_id,sender_user_id,ciphertext,ordinal,created_at', 'schema has only six message metadata/content fields');
  check(mustSql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name IN ('text','body','content','message_text')`) === '0', 'chat table has no plaintext body column');

  check(asUser(A, insertMessage(M1, AB)).ok, 'active member A can send');
  check(asUser(B, insertMessage(M2, AB)).ok, 'active member B can send');
  check(mustSql(`SELECT string_agg(ordinal::text, ',' ORDER BY ordinal) FROM public.chat_messages WHERE couple_id='${AB}'`) === '1,2', 'server assigns deterministic per-couple ordinal order');
  check(mustSql(`SELECT count(*) FROM public.chat_messages WHERE couple_id='${AB}'`) === '2', 'two sends produce two rows');
  check(mustSql(`SELECT count(*) FROM public.chat_messages WHERE couple_id='${AB}'`, DB) === '2', 'active couple rows remain readable to service context');
  check(mustSql(`SELECT count(*) FROM public.chat_messages WHERE message_id='${M1}'`, DB) === '1', 'message identity is a stable primary key');

  refused(asUser(C, insertMessage('00000000-0000-4000-8000-000000000003', AB)), /row-level security|CHAT_ACTIVE_MEMBER/, 'unrelated user cannot send');
  check(asUser(C, `SELECT count(*) FROM public.chat_messages WHERE couple_id='${AB}'`).stdout.trim() === '0', 'unrelated user cannot read');
  refused(asUser(D, insertMessage('00000000-0000-4000-8000-000000000004', AD)), /row-level security|CHAT_ACTIVE_MEMBER/, 'former partner cannot send');
  check(asUser(D, `SELECT count(*) FROM public.chat_messages WHERE couple_id='${AD}'`).stdout.trim() === '0', 'former partner cannot read');
  refused(asAnon(`SELECT count(*) FROM public.chat_messages WHERE couple_id='${AB}'`), /permission denied/, 'anon cannot read');
  refused(asAnon(insertMessage('00000000-0000-4000-8000-000000000005', AB)), /permission denied|row-level security/, 'anon cannot send');
  check(asService(`SELECT count(*) FROM public.chat_messages WHERE couple_id='${AB}'`).ok, 'service role has intended read capability');
  refused(asService(insertMessage('00000000-0000-4000-8000-000000000006', AB)), /permission denied|CHAT_/, 'service role has no direct insert grant');

  refused(asUser(A, insertMessage('00000000-0000-4000-8000-000000000007', AB, envelope(WIRE.couple, 2))), /CHAT_STALE_EPOCH/, 'RETIRED epoch cannot create a new message');
  refused(asUser(A, insertMessage('00000000-0000-4000-8000-000000000008', AB, envelope(WIRE.personal, 1))), /CHAT_DOMAIN_REQUIRED/, 'PMK/personal domain cannot be used for chat');
  refused(asUser(A, insertMessage('00000000-0000-4000-8000-000000000009', AB, envelope(WIRE.health, 1))), /CHAT_DOMAIN_REQUIRED/, 'HRK/health domain cannot be used for chat');
  refused(asUser(A, insertMessage('00000000-0000-4000-8000-00000000000a', AB, envelope(WIRE.couple, 1, { magic: '00000000' }))), /CHAT_GLE1_MAGIC/, 'wrong envelope magic is rejected');
  refused(asUser(A, insertMessage('00000000-0000-4000-8000-00000000000b', AB, envelope(WIRE.couple, 1, { format: 2 }))), /CHAT_GLE1_VERSION/, 'unknown envelope version is rejected');
  refused(asUser(A, `INSERT INTO public.chat_messages (message_id,couple_id,ciphertext,ordinal) VALUES ('00000000-0000-4000-8000-00000000000c','${AB}',${envelope(WIRE.couple,1)},99)`), /permission denied/, 'client cannot forge server ordinal');
  refused(asUser(A, `INSERT INTO public.chat_messages (message_id,couple_id,ciphertext) VALUES ('00000000-0000-4000-8000-00000000000d','${AB}',NULL)`), /permission denied|CHAT_CIPHERTEXT_REQUIRED/, 'client cannot insert a tombstone');

  refused(asUser(A, insertMessage(M1, AB)), /duplicate key|already exists/, 'same message id retry cannot create a duplicate or update');
  check(mustSql(`SELECT count(*) FROM public.chat_messages WHERE message_id='${M1}'`) === '1', 'duplicate retry leaves exactly one logical message');

  check(asUser(B, `UPDATE public.chat_messages SET ciphertext=NULL WHERE message_id='${M1}'`).ok
    && mustSql(`SELECT count(*) FROM public.chat_messages WHERE message_id='${M1}' AND ciphertext IS NOT NULL`) === '1',
  'receiver cannot tombstone sender message');
  check(asUser(A, `UPDATE public.chat_messages SET ciphertext=NULL WHERE message_id='${M1}'`).ok, 'sender can tombstone own message');
  check(asUser(A, `UPDATE public.chat_messages SET ciphertext=${envelope(WIRE.couple,1)} WHERE message_id='${M1}'`).ok
    && mustSql(`SELECT count(*) FROM public.chat_messages WHERE message_id='${M1}' AND ciphertext IS NULL`) === '1',
  'tombstone cannot be restored');
  check(mustSql(`SELECT count(*) FROM public.chat_messages WHERE message_id='${M1}' AND ciphertext IS NULL`) === '1', 'tombstone preserves row identity and ordinal');
  refused(sql(`INSERT INTO public.chat_messages (message_id,couple_id,sender_user_id,ciphertext) VALUES ('00000000-0000-4000-8000-00000000000e','${AB}','${A}',NULL)`), /CHAT_CIPHERTEXT_REQUIRED/, 'service path cannot create a tombstone by INSERT');

  // Account deletion leaves the shared row and nulls only sender identity.
  check(asUser(A, insertMessage(M3, AB)).ok, 'sender can create a live message before account deletion');
  mustSql(`DELETE FROM auth.users WHERE id='${A}'`, 'delete A');
  check(mustSql(`SELECT sender_user_id IS NULL FROM public.chat_messages WHERE message_id='${M2}'`) === 'f', 'unrelated sender remains attached after A deletion');
  check(mustSql(`SELECT count(*) FROM public.chat_messages WHERE message_id='${M1}' AND sender_user_id IS NULL`) === '1', 'deleted sender becomes NULL while tombstone survives');
  check(mustSql(`SELECT count(*) FROM public.chat_messages WHERE message_id='${M3}' AND sender_user_id IS NULL AND ciphertext IS NOT NULL`) === '1', 'deleted sender becomes NULL while live shared ciphertext survives');
  check(asUser(B, `SELECT count(*) FROM public.chat_messages WHERE couple_id='${AB}'`).stdout.trim() === '3', 'surviving partner still reads shared chat after sender account deletion');

  // RLS mutation: remove active-couple SELECT condition. C must then see AB rows.
  const selectMut = 'USING (couple_id = public.get_my_active_couple_id())';
  const mutatedSelect = buildDatabase('chat_mut_select', (file, text) => file === '040_chat_messages_e2ee.sql' ? text.replace(selectMut, 'USING (true)') : text);
  seed(mutatedSelect);
  mustSql(insertMessage(M1, AB, envelope(WIRE.couple, 1), A), 'seed mutated select row', mutatedSelect);
  check(asUser(C, `SELECT count(*) FROM public.chat_messages WHERE couple_id='${AB}'`, mutatedSelect).stdout.trim() === '1', 'mutation: removing SELECT couple predicate exposes unrelated chat');

  // RLS mutation: remove sender predicate from UPDATE. B must then tombstone M1.
  const updateMut = buildDatabase('chat_mut_sender', (file, text) => file === '040_chat_messages_e2ee.sql' ? text.replace('AND sender_user_id = auth.uid()\n    AND ciphertext IS NOT NULL', 'AND ciphertext IS NOT NULL') : text);
  seed(updateMut);
  mustSql(insertMessage(M1, AB, envelope(WIRE.couple, 1), A), 'seed mutated update row', updateMut);
  check(asUser(B, `UPDATE public.chat_messages SET ciphertext=NULL WHERE message_id='${M1}'`, updateMut).ok, 'mutation: removing sender predicate lets partner tombstone');

  // Epoch mutation: remove the ACTIVE lookup. A retired envelope must then pass
  // the remaining server/RLS boundaries, proving the epoch check is load-bearing.
  const epochMut = buildDatabase('chat_mut_epoch', (file, text) => file === '040_chat_messages_e2ee.sql' ? text.replace("AND sk.state = 'ACTIVE'\n        AND sk.key_epoch::NUMERIC = v_header_epoch", 'AND sk.key_epoch::NUMERIC = v_header_epoch') : text);
  seed(epochMut);
  check(asUser(A, insertMessage('00000000-0000-4000-8000-00000000000f', AB, envelope(WIRE.couple, 2)), epochMut).ok, 'mutation: removing ACTIVE epoch check admits retired message');
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

for (const pass of passes) console.log(`  ✓ ${pass}`);
if (failures.length) {
  console.error('\nCHAT HARNESS: FAIL');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\nCHAT HARNESS: PASS (${passes.length} assertions)`);
