#!/usr/bin/env node
/** Disposable socket-only PostgreSQL proof for the unchanged 001..091 chain. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((file) => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 91)
  .sort((left, right) => left.localeCompare(right, 'en'));
if (files.at(-1) !== '091_apple_auth_credentials.sql') throw new Error('canonical migration chain does not end at 091');
for (const binary of ['initdb', 'pg_ctl', 'createdb', 'psql']) {
  if (spawnSync(binary, ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error(`POSTGRES UNAVAILABLE: ${binary} is required; assertions were not run.`);
    process.exit(2);
  }
}

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const scratch = mkdtempSync(join(tmpdir(), 'gsl-apple-auth-'));
const dataDir = join(scratch, 'data');
const socketDir = join(scratch, 'socket');
mkdirSync(socketDir);
const pgEnv = { ...cleanEnv, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C', PGHOST: socketDir, PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'apple_auth_harness' };
let started = false;
const children = new Set();
process.on('exit', () => {
  for (const child of children) child.kill('SIGKILL');
  if (started) spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { env: pgEnv, stdio: 'ignore' });
  if (scratch.includes('gsl-apple-auth-')) rmSync(scratch, { recursive: true, force: true });
});
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const psqlArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse'];
let checks = 0;
function query(sql) { return spawnSync('psql', psqlArgs, { env: pgEnv, input: sql, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }); }
function run(sql, label) { const result = query(sql); if (result.status !== 0) throw new Error(`${label}: ${result.stderr || result.error?.message}`); return result.stdout.trim(); }
function check(condition, label) { checks += 1; if (!condition) throw new Error(label); }
function denied(sql, pattern, label) { const result = query(sql); check(result.status !== 0 && pattern.test(`${result.stderr}\n${result.stdout}`), `${label}: expected denial, got ${result.stderr || result.stdout}`); }
function literal(value) { return value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`; }
function actor(role, userId, sql) { return `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.role',${literal(role)},true); SELECT set_config('request.jwt.claim.sub',${literal(userId ?? '')},true); ${sql} COMMIT;`; }
function json(text, label) { for (const line of text.trim().split('\n').reverse()) { try { return JSON.parse(line); } catch { /* setup output */ } } throw new Error(`${label}: invalid JSON ${text}`); }
function asyncQuery(sql, applicationName) {
  const child = spawn('psql', psqlArgs, { env: { ...pgEnv, PGAPPNAME: applicationName } }); children.add(child);
  let stdout = '', stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolveDone) => child.on('close', (status) => { children.delete(child); resolveDone({ status, stdout, stderr }); })); child.stdin.end(sql); return done;
}
async function waitForLock(name) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (Number(run(`SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${literal(name)} AND l.locktype='advisory' AND l.granted;`, 'inspect lock')) > 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`timed out waiting for ${name}`);
}

execFileSync('initdb', ['-D', dataDir, '-U', 'postgres', '--no-sync', '-A', 'trust'], { env: pgEnv, stdio: 'ignore' });
execFileSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h ''`, '-w', 'start'], { env: pgEnv, stdio: 'ignore' }); started = true;
execFileSync('createdb', [pgEnv.PGDATABASE], { env: pgEnv, stdio: 'ignore' });
run(`CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),email TEXT,raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::UUID $$;
  CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role',true),'') $$;
  GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
  CREATE SCHEMA storage; CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT NOT NULL,public BOOLEAN NOT NULL DEFAULT false);
  CREATE TABLE storage.objects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id TEXT REFERENCES storage.buckets(id),name TEXT NOT NULL UNIQUE,owner UUID,owner_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated,service_role; GRANT SELECT ON storage.buckets TO anon,authenticated,service_role;
  CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN array_length(string_to_array(name,'/'),1)<=1 THEN ARRAY[]::TEXT[] ELSE (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] END $$;
  CREATE FUNCTION storage.filename(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $$;
  CREATE PUBLICATION supabase_realtime;`, 'create Supabase catalog fixture');
for (const file of files) {
  if (file === '002_fix_rls_recursion.sql') run(`DROP POLICY IF EXISTS "Users can create couples" ON public.couples; DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members; DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members; DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;`, 'prepare 002');
  run(readFileSync(join(MIGRATIONS, file), 'utf8'), `apply ${file}`);
}

const ids = Object.fromEntries([
  'owner', 'partner', 'other', 'raceRegister', 'raceDelete', 'keyLoss', 'leaseRace', 'evidence',
  'lifecycleReplay', 'lifecycleFresh', 'callerNoToken',
].map((name, index) => [name, `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const couple = '91000000-0000-4000-8000-000000000100';
run(`INSERT INTO auth.users(id,email) VALUES('${ids.owner}','owner@example.test'),('${ids.partner}','partner@example.test'),('${ids.other}','other@example.test'),('${ids.raceRegister}','rr@example.test'),('${ids.raceDelete}','rd@example.test'),('${ids.keyLoss}','key@example.test'),('${ids.leaseRace}','lease@example.test'),('${ids.evidence}','evidence@example.test'),('${ids.lifecycleReplay}','lifecycle-replay@example.test'),('${ids.lifecycleFresh}','lifecycle-fresh@example.test'),('${ids.callerNoToken}','caller-no-token@example.test');
  INSERT INTO public.profiles(id,display_name,role) VALUES('${ids.owner}','Owner','gomsin'),('${ids.partner}','Partner','soldier'),('${ids.other}','Other','gomsin'),('${ids.raceRegister}','RR','gomsin'),('${ids.raceDelete}','RD','gomsin'),('${ids.keyLoss}','Key','gomsin'),('${ids.leaseRace}','Lease','gomsin'),('${ids.evidence}','Evidence','gomsin'),('${ids.lifecycleReplay}','Lifecycle Replay','gomsin'),('${ids.lifecycleFresh}','Lifecycle Fresh','gomsin'),('${ids.callerNoToken}','Caller No Token','gomsin');
  INSERT INTO public.couples(id) VALUES('${couple}'); INSERT INTO public.couple_members(couple_id,user_id,role,status) VALUES('${couple}','${ids.owner}','gomsin','active'),('${couple}','${ids.partner}','soldier','active');`, 'seed actors');

const subject = 'apple-sub-owner', ciphertext = 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFh', nonce = 'YWFhYWFhYWFhYWFh';
const attempts = ['92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000003'];
const digests = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const begin = (user, sub, attempt, digest) => `SELECT public.apple_auth_begin_registration('${user}','${sub}','${attempt}','${digest}');`;
const nullCalls = [
  'SELECT public.apple_auth_begin_registration(NULL,NULL,NULL,NULL);',
  'SELECT public.apple_auth_capture_registration(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);',
  'SELECT public.apple_auth_prepare_registration_promotion(NULL,NULL,NULL,NULL,NULL);',
  'SELECT public.apple_auth_promote_registration(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);',
  'SELECT public.apple_auth_fail_registration(NULL,NULL,NULL,NULL,NULL,NULL);',
  'SELECT public.apple_auth_claim_deletion_revocation(NULL,NULL);',
  'SELECT public.apple_auth_complete_deletion_revocation(NULL,NULL,NULL,NULL,NULL,NULL,NULL);',
  'SELECT public.apple_auth_finalize_deletion_no_token(NULL,NULL,NULL,NULL,NULL);',
  'SELECT public.apple_auth_operator_resolve_deletion(NULL,NULL,NULL,NULL,NULL,NULL,NULL);',
];
for (const sql of nullCalls) {
  denied(sql, /Service role required/i, 'NULL actor cannot invoke Apple RPC');
  for (const [role, user] of [['anon', null], ['authenticated', ids.owner], ['authenticated', ids.partner]]) {
    denied(actor(role, user, sql), /permission denied|Service role required/i, `${role} cannot invoke Apple RPC`);
  }
  denied(actor('service_role', null, sql), /Invalid Apple/i, 'service RPC rejects NULL payload');
}
denied(
  actor('service_role', null, `SELECT public.apple_auth_complete_deletion_revocation('${ids.owner}','${attempts[0]}','not-a-uuid','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','revoked',NULL);`),
  /invalid input syntax for type uuid/i,
  'token completion rejects a malformed lifecycle fence',
);
denied(
  actor('service_role', null, `SELECT public.apple_auth_finalize_deletion_no_token('${ids.owner}','${attempts[0]}','not-a-uuid','not_required','VERIFIED_NO_APPLE_PROVIDER');`),
  /invalid input syntax for type uuid/i,
  'no-token finalizer rejects a malformed lifecycle fence',
);
const privateAppleTables = run(`SELECT string_agg(c.relname,',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='apple_auth_private' AND c.relkind IN('r','p');`, 'discover private Apple tables').split(',').filter(Boolean);
check(privateAppleTables.length > 0, 'private Apple table catalog is nonempty');
for (const table of privateAppleTables) {
  const tableIdentifier = `"${table.replaceAll('"', '""')}"`;
  for (const [role, user] of [['anon', null], ['authenticated', ids.owner], ['authenticated', ids.partner], ['service_role', null]]) {
    denied(actor(role, user, `SELECT count(*) FROM apple_auth_private.${tableIdentifier};`), /permission denied/i, `${role} cannot read ${table}`);
  }
}

// Mutant: removing the private ACL makes the authenticated negative probe flip.
run('GRANT USAGE ON SCHEMA apple_auth_private TO authenticated; GRANT SELECT ON apple_auth_private.credential_tokens TO authenticated;', 'install ACL mutant');
check(query(actor('authenticated', ids.owner, 'SELECT count(*) FROM apple_auth_private.credential_tokens;')).status === 0, 'ACL mutant flips direct-read denial');
run('REVOKE ALL ON apple_auth_private.credential_tokens FROM authenticated; REVOKE ALL ON SCHEMA apple_auth_private FROM authenticated;', 'restore ACL');

function service(sql, label) { return json(run(actor('service_role', null, sql), label), label); }
function capture(user, attempt, claim, token) { return `SELECT public.apple_auth_capture_registration('${user}','${attempt}','${claim}','${token}','${ciphertext}','${nonce}','key-old',1::SMALLINT);`; }
function prepare(user, attempt, claim, token, sub) { return `SELECT public.apple_auth_prepare_registration_promotion('${user}','${attempt}','${claim}','${token}','${sub}');`; }
function promote(user, attempt, claim, token, sub, generation) { return `SELECT public.apple_auth_promote_registration('${user}','${attempt}','${claim}','${token}','${sub}',${generation},'${ciphertext}','${nonce}','key-old',1::SMALLINT);`; }

const publicAppleFunctions = run(`SELECT string_agg(p.proname,',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'apple_auth_%';`, 'discover Apple RPC catalog');
check(publicAppleFunctions === [
  'apple_auth_begin_registration',
  'apple_auth_capture_registration',
  'apple_auth_claim_deletion_revocation',
  'apple_auth_complete_deletion_revocation',
  'apple_auth_fail_registration',
  'apple_auth_finalize_deletion_no_token',
  'apple_auth_operator_resolve_deletion',
  'apple_auth_prepare_registration_promotion',
  'apple_auth_promote_registration',
].join(','), `Apple RPC catalog inventory changed: ${publicAppleFunctions}`);

const first = service(begin(ids.owner, subject, attempts[0], digests[0]), 'begin first');
check(first.state === 'ready', 'first registration reserves before exchange');
check(service(capture(ids.owner, attempts[0], first.claim_token, first.token_id), 'capture first').state === 'captured', 'quarantine captured before verification');
check(service(capture(ids.owner, attempts[0], first.claim_token, first.token_id), 'lost capture response').state === 'captured', 'capture is idempotent');
const prepared1 = service(prepare(ids.owner, attempts[0], first.claim_token, first.token_id, subject), 'prepare first');
check(prepared1.state === 'prepared' && prepared1.generation === 1, 'verified promotion reserves generation');
check(service(promote(ids.owner, attempts[0], first.claim_token, first.token_id, subject, 1), 'promote first').state === 'registered', 'first token promoted');
check(service(promote(ids.owner, attempts[0], first.claim_token, first.token_id, subject, 1), 'lost promote response').state === 'completed', 'promotion is idempotent');
check(service(begin(ids.owner, subject, attempts[1], digests[1]), 'covered begin').state === 'covered', 'covered identity performs no new exchange reservation');

// A second verified generation remains a separate token, never overwriting the first.
run(`UPDATE apple_auth_private.credential_tokens SET state='revoke_retryable' WHERE token_id='${first.token_id}'; UPDATE apple_auth_private.registration_attempts SET created_at=clock_timestamp()-INTERVAL '3 seconds' WHERE attempt_id='${attempts[0]}';`, 'make next generation eligible');
const second = service(begin(ids.owner, subject, attempts[1], digests[1]), 'begin second');
service(capture(ids.owner, attempts[1], second.claim_token, second.token_id), 'capture second');
const prepared2 = service(prepare(ids.owner, attempts[1], second.claim_token, second.token_id, subject), 'prepare second');
service(promote(ids.owner, attempts[1], second.claim_token, second.token_id, subject, prepared2.generation), 'promote second');
check(Number(run(`SELECT count(*) FROM apple_auth_private.credential_tokens WHERE request_uid='${ids.owner}' AND aad_kind='verified';`, 'count generations')) === 2, 'two verified generations are retained');

// Verification failure retains captured quarantine and sticky uncertainty survives pruning/new success.
run(`UPDATE apple_auth_private.credential_tokens SET state='revoke_retryable' WHERE token_id='${second.token_id}'; UPDATE apple_auth_private.registration_attempts SET created_at=clock_timestamp()-INTERVAL '3 seconds' WHERE attempt_id='${attempts[1]}';`, 'make quarantine eligible');
const third = service(begin(ids.owner, subject, attempts[2], digests[2]), 'begin quarantine');
service(capture(ids.owner, attempts[2], third.claim_token, third.token_id), 'capture quarantine');
check(run(actor('service_role', null, `SELECT public.apple_auth_fail_registration('${ids.owner}','${attempts[2]}','${third.claim_token}','uncertain','CAPTURE_AND_REVOKE_UNPROVEN','retryable');`), 'mark uncertainty').split('\n').includes('t'), 'uncertainty recorded');
run(`UPDATE apple_auth_private.registration_attempts SET updated_at=clock_timestamp()-INTERVAL '11 minutes' WHERE attempt_id='${attempts[2]}';`, 'age uncertain journal');
run(`UPDATE apple_auth_private.credential_tokens SET state='active' WHERE token_id='${second.token_id}';`, 'restore verified coverage');
const coveredAfterUncertainty = service(begin(ids.owner, subject, '92000000-0000-4000-8000-000000000004', 'd'.repeat(64)), 'covered after prune');
check(coveredAfterUncertainty.unresolved_exchange === true, `new verified coverage does not clear old uncertainty: ${JSON.stringify(coveredAfterUncertainty)}`);
check(run(`SELECT exchange_uncertain::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.owner}';`, 'sticky uncertainty') === 'true', 'journal cleanup cannot clear account uncertainty');

// Another UID can take custody in quarantine but cannot establish this subject binding.
const otherAttempt = '93000000-0000-4000-8000-000000000001';
const other = service(begin(ids.other, subject, otherAttempt, 'e'.repeat(64)), 'other begin');
service(capture(ids.other, otherAttempt, other.claim_token, other.token_id), 'other capture');
check(service(prepare(ids.other, otherAttempt, other.claim_token, other.token_id, subject), 'other prepare').state === 'identity_conflict', 'different UID cannot bind existing subject');
check(run(`SELECT verified_subject IS NULL FROM apple_auth_private.credential_tokens WHERE token_id='${other.token_id}';`, 'quarantine has no identity') === 't', 'quarantine never establishes subject');

// Capacity includes ciphertext-bearing quarantine plus reservations.
run(`UPDATE apple_auth_private.registration_attempts SET status='rejected',failure_code='TEST',lease_expires_at=NULL WHERE attempt_id='${otherAttempt}'; DELETE FROM apple_auth_private.credential_tokens WHERE token_id='${other.token_id}';
  ${Array.from({ length: 8 }, (_, index) => `INSERT INTO apple_auth_private.registration_attempts(attempt_id,request_uid,code_digest,claim_token,token_id,status,exchange_captured,has_usable_credential,failure_code) VALUES('94000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}','${ids.other}','${String(index + 1).repeat(64).slice(0, 64)}','95000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}','96000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}','rejected',true,false,'VERIFY_FAILED'); INSERT INTO apple_auth_private.credential_tokens(token_id,registration_attempt_id,request_uid,aad_kind,state,ciphertext_b64,nonce_b64,key_id,crypto_version) VALUES('96000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}','94000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}','${ids.other}','quarantine','revoke_retryable','${ciphertext}','${nonce}','key-old',1);`).join('\n')}`, 'seed capacity');
run(`UPDATE apple_auth_private.registration_attempts SET created_at=clock_timestamp()-INTERVAL '6 minutes' WHERE request_uid='${ids.other}';`, 'age capacity attempts outside rate window');
check(service(begin(ids.other, 'other-sub', '97000000-0000-4000-8000-000000000001', 'f'.repeat(64)), 'capacity begin').state === 'capacity_limited', 'unresolved ciphertext cap prevents exchange');

// Concurrent registrations serialize; only one receives an exchange reservation.
const raceA = '98000000-0000-4000-8000-000000000001', raceB = '98000000-0000-4000-8000-000000000002';
const holder = asyncQuery(actor('service_role', null, `${begin(ids.raceRegister, 'race-sub', raceA, '9'.repeat(64))} SELECT pg_sleep(0.6);`), 'apple-register-holder');
await waitForLock('apple-register-holder');
const waiter = asyncQuery(actor('service_role', null, begin(ids.raceRegister, 'race-sub', raceB, '0'.repeat(64))), 'apple-register-waiter');
const [held, waited] = await Promise.all([holder, waiter]);
check(held.status === 0 && waited.status === 0 && json(waited.stdout, 'registration waiter').state === 'busy', `concurrent registration admits one exchange: ${JSON.stringify({ held, waited })}`);

// If registration reserves first and deletion starts while Apple is in flight,
// capture keeps custody but promotion cannot resurrect an active credential.
const raceDeleteRegistration = '98000000-0000-4000-8000-000000000003';
const raceDeleteAttempt = '98000000-0000-4000-8000-000000000004';
const registerBeforeDelete = asyncQuery(actor('service_role', null,
  `${begin(ids.partner, 'partner-sub', raceDeleteRegistration, 'ab'.repeat(32))} SELECT pg_sleep(0.6);`), 'apple-register-delete-holder');
await waitForLock('apple-register-delete-holder');
const deleteWaiter = asyncQuery(actor('service_role', null,
  `SELECT public.begin_account_deletion_v2('${ids.partner}',ARRAY[]::UUID[],'${raceDeleteAttempt}');`), 'apple-delete-waiter');
const [registeredBeforeDelete, deletedAfterRegister] = await Promise.all([registerBeforeDelete, deleteWaiter]);
check(registeredBeforeDelete.status === 0 && deletedAfterRegister.status === 0, 'register/delete lock order completes without deadlock');
const raceLease = json(registeredBeforeDelete.stdout, 'register before delete');
check(service(capture(ids.partner, raceDeleteRegistration, raceLease.claim_token, raceLease.token_id), 'capture after delete').state === 'captured', 'post-exchange token is durably quarantined after deletion begins');
check(service(prepare(ids.partner, raceDeleteRegistration, raceLease.claim_token, raceLease.token_id, 'partner-sub'), 'promotion after delete').state === 'deletion_pending', 'registration cannot resurrect credential after deletion fence');
const raceClaim = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.partner}','${raceDeleteAttempt}');`, 'claim raced quarantine');
check(raceClaim.state === 'claimed' && raceClaim.aad_kind === 'quarantine', 'deletion claims raced quarantine token');
service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.partner}','${raceDeleteAttempt}','${raceClaim.deletion_lifecycle_id}','${raceClaim.token_id}','${raceClaim.lease_token}','revoked',NULL);`, 'settle raced quarantine');

// Superseding deletion cannot terminally settle while an older provider lease is live.
const leaseRegistration = '98000000-0000-4000-8000-000000000005';
const leaseDeleteA = '98000000-0000-4000-8000-000000000006';
const leaseDeleteB = '98000000-0000-4000-8000-000000000007';
const leaseReady = service(begin(ids.leaseRace, 'lease-sub', leaseRegistration, 'ac'.repeat(32)), 'begin lease race token');
service(capture(ids.leaseRace, leaseRegistration, leaseReady.claim_token, leaseReady.token_id), 'capture lease race token');
const leasePrepared = service(prepare(ids.leaseRace, leaseRegistration, leaseReady.claim_token, leaseReady.token_id, 'lease-sub'), 'prepare lease race token');
service(promote(ids.leaseRace, leaseRegistration, leaseReady.claim_token, leaseReady.token_id, 'lease-sub', leasePrepared.generation), 'promote lease race token');
service(`SELECT public.begin_account_deletion_v2('${ids.leaseRace}',ARRAY[]::UUID[],'${leaseDeleteA}');`, 'begin deletion A');
const leaseClaimA = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.leaseRace}','${leaseDeleteA}');`, 'claim deletion A token');
check(leaseClaimA.state === 'claimed', 'deletion A owns the provider lease');
service(`SELECT public.begin_account_deletion_v2('${ids.leaseRace}',ARRAY[]::UUID[],'${leaseDeleteB}');`, 'begin superseding deletion B');
const liveLeaseB = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.leaseRace}','${leaseDeleteB}');`, 'deletion B sees live A lease');
check(liveLeaseB.state === 'busy' && liveLeaseB.deletion_lifecycle_id === leaseClaimA.deletion_lifecycle_id, `live provider lease must block terminal B inside the same lifecycle: ${JSON.stringify(liveLeaseB)}`);
check(run(`SELECT deletion_outcome IS NULL FROM apple_auth_private.account_state WHERE user_id='${ids.leaseRace}';`, 'no premature terminal') === 't', 'live lease cannot persist terminal outcome');
const staleA = query(actor('service_role', null, `SELECT public.apple_auth_complete_deletion_revocation('${ids.leaseRace}','${leaseDeleteA}','${leaseClaimA.deletion_lifecycle_id}','${leaseClaimA.token_id}','${leaseClaimA.lease_token}','revoked',NULL);`));
check(staleA.status !== 0 && /stale|attempt/i.test(`${staleA.stderr}\n${staleA.stdout}`), 'superseded deletion A completion is rejected');
run(`UPDATE apple_auth_private.credential_tokens SET revoke_lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE token_id='${leaseClaimA.token_id}';`, 'expire deletion A provider lease');
const leaseClaimB = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.leaseRace}','${leaseDeleteB}');`, 'deletion B reclaims expired lease');
check(leaseClaimB.state === 'claimed' && leaseClaimB.token_id === leaseClaimA.token_id && leaseClaimB.lease_token !== leaseClaimA.lease_token, 'B reclaims same token under a fresh lease');
const beforeWrongToken = run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.leaseRace}' AND t.token_id='${leaseClaimB.token_id}';`, 'snapshot before wrong-token completion');
check(service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.leaseRace}','${leaseDeleteB}','${leaseClaimB.deletion_lifecycle_id}','${first.token_id}','${leaseClaimB.lease_token}','revoked',NULL);`, 'reject completion for another user token').state === 'stale', 'completion remains bound to the claimed user and token');
check(run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.leaseRace}' AND t.token_id='${leaseClaimB.token_id}';`, 'snapshot after wrong-token completion') === beforeWrongToken, 'wrong-token completion changes no account or claimed token state');
const leaseCompleteB = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.leaseRace}','${leaseDeleteB}','${leaseClaimB.deletion_lifecycle_id}','${leaseClaimB.token_id}','${leaseClaimB.lease_token}','revoked',NULL);`, 'complete exact deletion B lease');
check(leaseCompleteB.all_settled === true && leaseCompleteB.terminal_state === 'revoked', 'exact B completion is the only revoked terminal');
const leaseBTerminal = run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.leaseRace}' AND t.token_id='${leaseClaimB.token_id}';`, 'snapshot exact lease B terminal');
const oldLeaseAfterTerminal = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.leaseRace}','${leaseDeleteB}','${leaseClaimB.deletion_lifecycle_id}','${leaseClaimB.token_id}','${leaseClaimA.lease_token}','revoked',NULL);`, 'reject superseded same-lifecycle lease after terminal');
check(oldLeaseAfterTerminal.state === 'stale', 'terminal duplicate requires the exact completing lease within one lifecycle');
check(run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.leaseRace}' AND t.token_id='${leaseClaimB.token_id}';`, 'snapshot after superseded terminal lease') === leaseBTerminal, 'superseded terminal lease changes no proof or token state');
check(service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.leaseRace}','${leaseDeleteB}','${leaseClaimB.deletion_lifecycle_id}','${leaseClaimB.token_id}','${leaseClaimB.lease_token}','revoked',NULL);`, 'replay exact terminal lease').duplicate === true, 'exact terminal lease remains idempotent');

// A no-token caller cannot classify a replacement lifecycle that reused its attempt UUID.
const callerNoTokenAttempt = '98000000-0000-4000-8000-000000000008';
service(`SELECT public.begin_account_deletion_v2('${ids.callerNoToken}',ARRAY[]::UUID[],'${callerNoTokenAttempt}');`, 'begin no-token lifecycle A');
const callerNoTokenClaimA = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.callerNoToken}','${callerNoTokenAttempt}');`, 'claim no-token lifecycle A');
check(callerNoTokenClaimA.state === 'none', 'no-token lifecycle A reaches provider classification');
const callerNoTokenLifecycleA = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.callerNoToken}';`, 'read no-token lifecycle A');
check(callerNoTokenClaimA.deletion_lifecycle_id === callerNoTokenLifecycleA, 'no-token claim returns its original lifecycle fence');
check(run(actor('service_role', null, `SELECT public.cancel_account_deletion_v2('${ids.callerNoToken}','${callerNoTokenAttempt}');`), 'cancel no-token lifecycle A').split('\n').includes('t'), 'no-token lifecycle A is cancelled');
service(`SELECT public.begin_account_deletion_v2('${ids.callerNoToken}',ARRAY[]::UUID[],'${callerNoTokenAttempt}');`, 'begin no-token lifecycle B with reused attempt');
const callerNoTokenLifecycleB = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.callerNoToken}';`, 'read no-token lifecycle B');
check(callerNoTokenLifecycleB !== callerNoTokenLifecycleA, 'no-token replacement receives a fresh lifecycle');
const beforeLateNoToken = run(`SELECT to_jsonb(s)::TEXT FROM apple_auth_private.account_state s WHERE s.user_id='${ids.callerNoToken}';`, 'snapshot before late no-token finalizer');
const lateNoTokenA = service(`SELECT public.apple_auth_finalize_deletion_no_token('${ids.callerNoToken}','${callerNoTokenAttempt}','${callerNoTokenClaimA.deletion_lifecycle_id}','not_required','VERIFIED_NO_APPLE_PROVIDER');`, 'reject late no-token lifecycle A finalizer');
check(lateNoTokenA.state === 'stale', 'late no-token lifecycle A cannot finalize replacement lifecycle B');
check(run(`SELECT to_jsonb(s)::TEXT FROM apple_auth_private.account_state s WHERE s.user_id='${ids.callerNoToken}';`, 'snapshot after late no-token finalizer') === beforeLateNoToken, 'late no-token finalizer changes no aggregate state');
const callerNoTokenClaimB = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.callerNoToken}','${callerNoTokenAttempt}');`, 'claim no-token lifecycle B');
check(callerNoTokenClaimB.state === 'none' && callerNoTokenClaimB.deletion_lifecycle_id === callerNoTokenLifecycleB, 'replacement no-token claim carries lifecycle B');
const callerNoTokenCompleteB = service(`SELECT public.apple_auth_finalize_deletion_no_token('${ids.callerNoToken}','${callerNoTokenAttempt}','${callerNoTokenClaimB.deletion_lifecycle_id}','not_required','VERIFIED_NO_APPLE_PROVIDER');`, 'finalize exact no-token lifecycle B');
check(callerNoTokenCompleteB.state === 'not_required', 'exact no-token lifecycle B can finalize');
const callerNoTokenTerminalB = run(`SELECT to_jsonb(s)::TEXT FROM apple_auth_private.account_state s WHERE s.user_id='${ids.callerNoToken}';`, 'snapshot exact no-token lifecycle B terminal');
check(service(`SELECT public.apple_auth_finalize_deletion_no_token('${ids.callerNoToken}','${callerNoTokenAttempt}','${callerNoTokenClaimB.deletion_lifecycle_id}','not_required','VERIFIED_NO_APPLE_PROVIDER');`, 'replay exact no-token lifecycle B').state === 'not_required', 'same-lifecycle no-token duplicate remains valid');
check(run(`SELECT to_jsonb(s)::TEXT FROM apple_auth_private.account_state s WHERE s.user_id='${ids.callerNoToken}';`, 'snapshot no-token lifecycle B duplicate') === callerNoTokenTerminalB, 'same-lifecycle no-token duplicate preserves original proof and evidence times');

// One deletion row keeps one lifecycle while attempts rotate. Its original
// terminal decision remains exact and is replayable after the phase advances.
const lifecycleReplayRegistration = '98100000-0000-4000-8000-000000000001';
const lifecycleReplayDelete = '98100000-0000-4000-8000-000000000002';
const lifecycleReplayNewAttempt = '98100000-0000-4000-8000-000000000003';
const lifecycleReplayReady = service(begin(ids.lifecycleReplay, 'lifecycle-replay-sub', lifecycleReplayRegistration, 'de'.repeat(32)), 'begin lifecycle replay token');
service(capture(ids.lifecycleReplay, lifecycleReplayRegistration, lifecycleReplayReady.claim_token, lifecycleReplayReady.token_id), 'capture lifecycle replay token');
const lifecycleReplayPrepared = service(prepare(ids.lifecycleReplay, lifecycleReplayRegistration, lifecycleReplayReady.claim_token, lifecycleReplayReady.token_id, 'lifecycle-replay-sub'), 'prepare lifecycle replay token');
service(promote(ids.lifecycleReplay, lifecycleReplayRegistration, lifecycleReplayReady.claim_token, lifecycleReplayReady.token_id, 'lifecycle-replay-sub', lifecycleReplayPrepared.generation), 'promote lifecycle replay token');
service(`SELECT public.begin_account_deletion_v2('${ids.lifecycleReplay}',ARRAY[]::UUID[],'${lifecycleReplayDelete}');`, 'begin lifecycle replay deletion');
const lifecycleReplayId = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.lifecycleReplay}';`, 'read lifecycle replay id');
check(lifecycleReplayId.length > 0, 'deletion row receives a stable lifecycle id');
const lifecycleReplayClaim = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleReplay}','${lifecycleReplayDelete}');`, 'claim lifecycle replay token');
const lifecycleReplayComplete = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleReplay}','${lifecycleReplayDelete}','${lifecycleReplayClaim.deletion_lifecycle_id}','${lifecycleReplayClaim.token_id}','${lifecycleReplayClaim.lease_token}','revoked',NULL);`, 'complete lifecycle replay token');
check(lifecycleReplayComplete.all_settled === true && lifecycleReplayComplete.terminal_state === 'revoked', 'current lifecycle exact completion reaches revoked');
const lifecycleOriginalProof = run(`SELECT jsonb_build_object('lifecycle',deletion_lifecycle_id,'outcome',deletion_outcome,'reason',deletion_reason,'provenance',deletion_provenance,'origin',deletion_origin_attempt_id,'resolved_at',deletion_resolved_at,'evidence_reference',deletion_evidence_reference,'evidence_at',deletion_evidence_at)::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.lifecycleReplay}';`, 'read lifecycle original proof');
const sameAttemptReplay = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleReplay}','${lifecycleReplayDelete}');`, 'same-attempt lifecycle replay');
check(sameAttemptReplay.state === 'revoked' && sameAttemptReplay.origin_attempt_id === lifecycleReplayDelete && sameAttemptReplay.deletion_lifecycle_id === lifecycleReplayId, 'same attempt replays the current lifecycle terminal');
check(run(`SELECT jsonb_build_object('lifecycle',deletion_lifecycle_id,'outcome',deletion_outcome,'reason',deletion_reason,'provenance',deletion_provenance,'origin',deletion_origin_attempt_id,'resolved_at',deletion_resolved_at,'evidence_reference',deletion_evidence_reference,'evidence_at',deletion_evidence_at)::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.lifecycleReplay}';`, 'read same-attempt proof') === lifecycleOriginalProof, 'same-attempt replay preserves original terminal proof');
run(`UPDATE public.account_deletion_requests SET attempt_id='${lifecycleReplayNewAttempt}',phase='e2ee_prepared',cancellation_allowed=false WHERE user_id='${ids.lifecycleReplay}';`, 'advance same deletion lifecycle under a new attempt');
check(run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.lifecycleReplay}';`, 'read advanced lifecycle id') === lifecycleReplayId, 'attempt rotation preserves deletion lifecycle id');
const advancedLifecycleReplay = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleReplay}','${lifecycleReplayNewAttempt}');`, 'advanced same-lifecycle replay');
check(advancedLifecycleReplay.state === 'revoked' && advancedLifecycleReplay.origin_attempt_id === lifecycleReplayDelete && advancedLifecycleReplay.deletion_lifecycle_id === lifecycleReplayId, 'advanced new attempt replays only the same lifecycle terminal');
check(run(`SELECT jsonb_build_object('lifecycle',deletion_lifecycle_id,'outcome',deletion_outcome,'reason',deletion_reason,'provenance',deletion_provenance,'origin',deletion_origin_attempt_id,'resolved_at',deletion_resolved_at,'evidence_reference',deletion_evidence_reference,'evidence_at',deletion_evidence_at)::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.lifecycleReplay}';`, 'read advanced proof') === lifecycleOriginalProof, 'advanced replay preserves original decision and evidence');
check(run(`SELECT deletion_replay_attempt_id::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.lifecycleReplay}';`, 'read advanced replay attempt') === lifecycleReplayNewAttempt, 'advanced replay records only the latest replay attempt');

// Cancellation destroys only the deletion row. Reusing its attempt UUID must
// still create a fresh lifecycle that rejects the old lease and terminal proof.
const lifecycleFreshRegistration = '98200000-0000-4000-8000-000000000001';
const lifecycleFreshDelete = '98200000-0000-4000-8000-000000000002';
const lifecycleFreshReady = service(begin(ids.lifecycleFresh, 'lifecycle-fresh-sub', lifecycleFreshRegistration, 'df'.repeat(32)), 'begin lifecycle freshness token');
service(capture(ids.lifecycleFresh, lifecycleFreshRegistration, lifecycleFreshReady.claim_token, lifecycleFreshReady.token_id), 'capture lifecycle freshness token');
const lifecycleFreshPrepared = service(prepare(ids.lifecycleFresh, lifecycleFreshRegistration, lifecycleFreshReady.claim_token, lifecycleFreshReady.token_id, 'lifecycle-fresh-sub'), 'prepare lifecycle freshness token');
service(promote(ids.lifecycleFresh, lifecycleFreshRegistration, lifecycleFreshReady.claim_token, lifecycleFreshReady.token_id, 'lifecycle-fresh-sub', lifecycleFreshPrepared.generation), 'promote lifecycle freshness token');
service(`SELECT public.begin_account_deletion_v2('${ids.lifecycleFresh}',ARRAY[]::UUID[],'${lifecycleFreshDelete}');`, 'begin first freshness lifecycle');
const lifecycleA = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.lifecycleFresh}';`, 'read lifecycle A');
const lifecycleClaimA = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`, 'claim lifecycle A token');
check(run(actor('service_role', null, `SELECT public.cancel_account_deletion_v2('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`), 'cancel lifecycle A').split('\n').includes('t'), 'cancellable lifecycle A row is removed');
service(`SELECT public.begin_account_deletion_v2('${ids.lifecycleFresh}',ARRAY[]::UUID[],'${lifecycleFreshDelete}');`, 'begin lifecycle B with reused attempt');
const lifecycleB = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.lifecycleFresh}';`, 'read lifecycle B');
check(lifecycleB !== lifecycleA, 'same attempt UUID receives a fresh lifecycle after cancellation');
const beforeLateCompletion = run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimA.token_id}';`, 'snapshot before late lifecycle A completion');
const lateLifecycleA = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${lifecycleClaimA.deletion_lifecycle_id}','${lifecycleClaimA.token_id}','${lifecycleClaimA.lease_token}','revoked',NULL);`, 'reject late lifecycle A completion');
check(lateLifecycleA.state === 'stale', 'late pre-cancellation completion is stale despite reused attempt id');
check(run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimA.token_id}';`, 'snapshot after late lifecycle A completion') === beforeLateCompletion, 'late old completion changes no account or token state');
const lifecycleClaimB = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`, 'claim lifecycle B token');
check(lifecycleClaimB.state === 'claimed' && lifecycleClaimB.token_id === lifecycleClaimA.token_id && lifecycleClaimB.lease_token !== lifecycleClaimA.lease_token, 'fresh lifecycle reclaims the old lifecycle lease');
check(run(`SELECT revoke_lifecycle_id::TEXT FROM apple_auth_private.credential_tokens WHERE token_id='${lifecycleClaimB.token_id}';`, 'read lifecycle B token binding') === lifecycleB, 'provider lease is bound to lifecycle B');
const lifecycleCompleteB = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${lifecycleClaimB.deletion_lifecycle_id}','${lifecycleClaimB.token_id}','${lifecycleClaimB.lease_token}','revoked',NULL);`, 'complete lifecycle B token');
check(lifecycleCompleteB.all_settled === true && lifecycleCompleteB.terminal_state === 'revoked', 'exact lifecycle B completion reaches revoked');
const lifecycleBTerminal = run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimB.token_id}';`, 'snapshot lifecycle B terminal');
const lateLifecycleAAfterBTerminal = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${lifecycleClaimA.deletion_lifecycle_id}','${lifecycleClaimA.token_id}','${lifecycleClaimA.lease_token}','revoked',NULL);`, 'reject late lifecycle A completion after lifecycle B terminal');
check(lateLifecycleAAfterBTerminal.state === 'stale', 'late lifecycle A completion stays stale after lifecycle B reaches terminal');
check(run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimB.token_id}';`, 'snapshot after late lifecycle A terminal completion') === lifecycleBTerminal, 'late lifecycle A completion after B terminal changes no account or token state');
const lifecycleBDuplicate = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${lifecycleClaimB.deletion_lifecycle_id}','${lifecycleClaimB.token_id}','${lifecycleClaimB.lease_token}','revoked',NULL);`, 'duplicate lifecycle B completion');
check(lifecycleBDuplicate.state === 'revoked' && lifecycleBDuplicate.duplicate === true, 'exact duplicate completion replays the current lifecycle terminal');
check(run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimB.token_id}';`, 'snapshot duplicate lifecycle B terminal') === lifecycleBTerminal, 'same-lifecycle duplicate completion is read-only');

check(run(actor('service_role', null, `SELECT public.cancel_account_deletion_v2('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`), 'cancel lifecycle B').split('\n').includes('t'), 'cancellable lifecycle B row is removed');
service(`SELECT public.begin_account_deletion_v2('${ids.lifecycleFresh}',ARRAY[]::UUID[],'${lifecycleFreshDelete}');`, 'begin lifecycle C with reused attempt');
const lifecycleC = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.lifecycleFresh}';`, 'read lifecycle C');
check(lifecycleC !== lifecycleB, 'second cancellation creates another fresh lifecycle');
const beforeOldDuplicate = run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimB.token_id}';`, 'snapshot before old duplicate');
const oldLifecycleDuplicate = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${lifecycleClaimB.deletion_lifecycle_id}','${lifecycleClaimB.token_id}','${lifecycleClaimB.lease_token}','revoked',NULL);`, 'reject lifecycle B duplicate in lifecycle C');
check(oldLifecycleDuplicate.state === 'stale', 'duplicate completion cannot cross a cancellation boundary');
check(run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimB.token_id}';`, 'snapshot after old duplicate') === beforeOldDuplicate, 'cross-lifecycle duplicate changes no account or token state');
const oldHistoryClaim = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`, 'classify old revoked history in lifecycle C');
check(oldHistoryClaim.state === 'none', `old revoked history is not current lifecycle proof: ${JSON.stringify(oldHistoryClaim)}`);
check(run(`SELECT verified_subject::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.lifecycleFresh}';`, 'read current Apple identity') === 'lifecycle-fresh-sub', 'verified Apple identity survives old token settlement');
const beforeAdvancedMismatch = run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimB.token_id}';`, 'snapshot before advanced lifecycle mismatch');
run(`UPDATE public.account_deletion_requests SET phase='e2ee_prepared',cancellation_allowed=false WHERE user_id='${ids.lifecycleFresh}';`, 'advance lifecycle C with only lifecycle B proof');
check(service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${lifecycleClaimB.deletion_lifecycle_id}','${lifecycleClaimB.token_id}','${lifecycleClaimB.lease_token}','revoked',NULL);`, 'reject advanced late lifecycle B completion').state === 'stale', 'late pre-cancellation completion stays stale after the new lifecycle advances');
check(service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`, 'reject advanced lifecycle mismatch').state === 'operator_review_required', 'advanced phase cannot replay a prior lifecycle terminal');
check(run(`SELECT jsonb_build_object('account',to_jsonb(s),'token',to_jsonb(t))::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.lifecycleFresh}' AND t.token_id='${lifecycleClaimB.token_id}';`, 'snapshot after advanced lifecycle mismatch') === beforeAdvancedMismatch, 'advanced lifecycle mismatch changes no proof or token state');
run(`UPDATE public.account_deletion_requests SET phase='media_cleanup',cancellation_allowed=true WHERE user_id='${ids.lifecycleFresh}';`, 'restore disposable lifecycle C cancellation phase');
const lifecycleCManual = service(`SELECT public.apple_auth_finalize_deletion_no_token('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${oldHistoryClaim.deletion_lifecycle_id}','manual_required','APPLE_PROVIDER_WITHOUT_TOKEN');`, 'finalize lifecycle C without a fresh token');
check(lifecycleCManual.state === 'manual_required' && lifecycleCManual.reason === 'APPLE_PROVIDER_WITHOUT_TOKEN', 'current Apple identity without a fresh credential is manual, not revoked');
check(run(`SELECT deletion_lifecycle_id::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.lifecycleFresh}';`, 'read lifecycle C terminal binding') === lifecycleC, 'manual terminal proof binds to lifecycle C');

check(run(actor('service_role', null, `SELECT public.cancel_account_deletion_v2('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`), 'cancel lifecycle C').split('\n').includes('t'), 'cancellable lifecycle C row is removed');
run(`UPDATE apple_auth_private.registration_attempts SET created_at=clock_timestamp()-INTERVAL '3 seconds' WHERE request_uid='${ids.lifecycleFresh}';`, 'age first lifecycle registration');
const lifecycleFreshRegistration2 = '98200000-0000-4000-8000-000000000003';
const lifecycleFreshReady2 = service(begin(ids.lifecycleFresh, 'lifecycle-fresh-sub', lifecycleFreshRegistration2, 'e0'.repeat(32)), 'begin fresh post-cancellation token');
service(capture(ids.lifecycleFresh, lifecycleFreshRegistration2, lifecycleFreshReady2.claim_token, lifecycleFreshReady2.token_id), 'capture fresh post-cancellation token');
const lifecycleFreshPrepared2 = service(prepare(ids.lifecycleFresh, lifecycleFreshRegistration2, lifecycleFreshReady2.claim_token, lifecycleFreshReady2.token_id, 'lifecycle-fresh-sub'), 'prepare fresh post-cancellation token');
service(promote(ids.lifecycleFresh, lifecycleFreshRegistration2, lifecycleFreshReady2.claim_token, lifecycleFreshReady2.token_id, 'lifecycle-fresh-sub', lifecycleFreshPrepared2.generation), 'promote fresh post-cancellation token');
service(`SELECT public.begin_account_deletion_v2('${ids.lifecycleFresh}',ARRAY[]::UUID[],'${lifecycleFreshDelete}');`, 'begin lifecycle D with reused attempt');
const lifecycleD = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.lifecycleFresh}';`, 'read lifecycle D');
const lifecycleClaimD = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}');`, 'claim exact lifecycle D token');
check(lifecycleClaimD.state === 'claimed' && lifecycleClaimD.token_id === lifecycleFreshReady2.token_id, 'only the fresh registered token is claimed in lifecycle D');
check(run(`SELECT state||'|'||(ciphertext_b64 IS NULL)::TEXT FROM apple_auth_private.credential_tokens WHERE token_id='${lifecycleFreshReady.token_id}';`, 'read retained old revoked token') === 'revoked|true', 'old revoked token id remains with ciphertext cleared');
const lifecycleCompleteD = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.lifecycleFresh}','${lifecycleFreshDelete}','${lifecycleClaimD.deletion_lifecycle_id}','${lifecycleClaimD.token_id}','${lifecycleClaimD.lease_token}','revoked',NULL);`, 'complete exact lifecycle D token');
check(lifecycleCompleteD.all_settled === true && lifecycleCompleteD.terminal_state === 'revoked', 'exact fresh token completion declares lifecycle D revoked');
check(run(`SELECT deletion_lifecycle_id::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.lifecycleFresh}';`, 'read lifecycle D terminal binding') === lifecycleD, 'revoked account proof binds to lifecycle D');
check(run(`SELECT revoke_lifecycle_id::TEXT FROM apple_auth_private.credential_tokens WHERE token_id='${lifecycleClaimD.token_id}';`, 'read lifecycle D token proof') === lifecycleD, 'fresh token proof binds to lifecycle D');
check(run(`SELECT count(*)=2 AND bool_and(state='revoked' AND ciphertext_b64 IS NULL) FROM apple_auth_private.credential_tokens WHERE request_uid='${ids.lifecycleFresh}';`, 'read retained lifecycle token history') === 't', 'old and fresh revoked token ids remain with no recoverable ciphertext');
check(run(`SELECT count(*)=count(DISTINCT deletion_lifecycle_id) AND bool_and(deletion_lifecycle_id IS NOT NULL) FROM public.account_deletion_requests;`, 'verify lifecycle uniqueness') === 't', 'all live deletion rows have unique lifecycle ids');

// Disposable defensive mutant: a malformed in-flight row with NULL lease fails closed.
const leaseConstraint = run(`SELECT c.conname FROM pg_constraint c WHERE c.conrelid='apple_auth_private.credential_tokens'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) LIKE '%revoke_lease_token%revoke_lease_expires_at%' LIMIT 1;`, 'find lease consistency constraint');
check(leaseConstraint.length > 0, 'lease consistency constraint is discoverable');
const leaseCompletionHash = run(`SELECT revoke_completion_lease_hash FROM apple_auth_private.credential_tokens WHERE token_id='${leaseClaimB.token_id}';`, 'preserve terminal lease proof around mutant');
check(/^[0-9a-f]{64}$/.test(leaseCompletionHash) && leaseCompletionHash !== leaseClaimB.lease_token, 'terminal replay retains only a lease digest, never the raw lease');
run(`ALTER TABLE apple_auth_private.credential_tokens DROP CONSTRAINT "${leaseConstraint}";
  UPDATE apple_auth_private.credential_tokens SET state='revoke_in_flight',ciphertext_b64='${ciphertext}',nonce_b64='${nonce}',key_id='key-old',crypto_version=1,revoked_at=NULL,revoke_attempt_id='${leaseDeleteB}',revoke_lease_token=NULL,revoke_lease_expires_at=NULL,revoke_completion_lease_hash=NULL WHERE token_id='${leaseClaimB.token_id}';`, 'install NULL-lease mutant');
check(service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.leaseRace}','${leaseDeleteB}');`, 'classify NULL-lease mutant').state === 'operator_review_required', 'malformed NULL lease fails closed to operator review');
run(`UPDATE apple_auth_private.credential_tokens SET state='revoked',ciphertext_b64=NULL,nonce_b64=NULL,key_id=NULL,crypto_version=NULL,revoked_at=clock_timestamp(),revoke_lease_token=NULL,revoke_lease_expires_at=NULL,revoke_completion_lease_hash='${leaseCompletionHash}' WHERE token_id='${leaseClaimB.token_id}';
  ALTER TABLE apple_auth_private.credential_tokens ADD CONSTRAINT "${leaseConstraint}" CHECK ((state='revoke_in_flight' AND revoke_attempt_id IS NOT NULL AND revoke_lifecycle_id IS NOT NULL AND revoke_lease_token IS NOT NULL AND revoke_lease_expires_at IS NOT NULL) OR (state<>'revoke_in_flight' AND revoke_lease_token IS NULL AND revoke_lease_expires_at IS NULL));`, 'restore lease invariant after mutant');

const leaseRaceLifecycle = run(`SELECT deletion_lifecycle_id::TEXT FROM public.account_deletion_requests WHERE user_id='${ids.leaseRace}';`, 'read lease-race lifecycle');
for (const [role, user] of [['anon', null], ['authenticated', ids.owner], ['authenticated', ids.partner], ['service_role', null]]) {
  denied(actor(role, user, `SELECT apple_auth_private.classify_deletion_settlement('${ids.leaseRace}','${leaseRaceLifecycle}');`), /permission denied/i, `${role} cannot execute private settlement classifier`);
}

// Deletion settles exactly three known tokens, then replays durable manual outcome at advanced phase.
const deleteAttempt = '99000000-0000-4000-8000-000000000001';
service(`SELECT public.begin_account_deletion_v2('${ids.owner}',ARRAY[]::UUID[],'${deleteAttempt}');`, 'begin owner deletion');
let finalSettle;
for (let index = 0; index < 3; index += 1) {
  const claim = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.owner}','${deleteAttempt}');`, `claim token ${index}`);
  check(claim.state === 'claimed' && typeof claim.token_id === 'string', `deletion claims exact token ${index}`);
  finalSettle = service(`SELECT public.apple_auth_complete_deletion_revocation('${ids.owner}','${deleteAttempt}','${claim.deletion_lifecycle_id}','${claim.token_id}','${claim.lease_token}','revoked',NULL);`, `revoke token ${index}`);
}
check(finalSettle.all_settled === true && finalSettle.terminal_state === 'manual_required', 'all tokens settle but sticky uncertainty remains manual');
check(Number(run(`SELECT count(*) FROM apple_auth_private.credential_tokens WHERE request_uid='${ids.owner}' AND ciphertext_b64 IS NOT NULL;`, 'ciphertext cleared')) === 0, 'HTTP200 completion clears all three ciphertexts');
run(`UPDATE public.account_deletion_requests SET phase='e2ee_prepared',cancellation_allowed=false,attempt_id='99000000-0000-4000-8000-000000000002' WHERE user_id='${ids.owner}';`, 'advance and supersede deletion attempt');
const replay = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.owner}','99000000-0000-4000-8000-000000000002');`, 'advanced replay');
check(replay.state === 'manual_required' && replay.origin_attempt_id === deleteAttempt, 'advanced phase replays durable terminal provenance without provider work');

// Advanced pre-091 rows require operator evidence; no migration-existence inference.
const legacyAttempt = '99000000-0000-4000-8000-000000000003';
service(`SELECT public.begin_account_deletion_v2('${ids.raceDelete}',ARRAY[]::UUID[],'${legacyAttempt}');`, 'begin legacy deletion');
run(`UPDATE public.account_deletion_requests SET phase='e2ee_prepared',cancellation_allowed=false WHERE user_id='${ids.raceDelete}';`, 'advance legacy row');
check(service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.raceDelete}','${legacyAttempt}');`, 'legacy claim').state === 'operator_review_required', 'advanced missing proof requires operator review');
run(`UPDATE apple_auth_private.account_state SET deletion_lifecycle_id=(SELECT deletion_lifecycle_id FROM public.account_deletion_requests WHERE user_id='${ids.raceDelete}'),deletion_outcome='revoked',deletion_reason='ALL_KNOWN_TOKENS_REVOKED',deletion_provenance='provider_http_200',deletion_origin_attempt_id='${legacyAttempt}',deletion_replay_attempt_id='${legacyAttempt}',deletion_resolved_at=clock_timestamp() WHERE user_id='${ids.raceDelete}';`, 'install bogus advanced terminal');
check(service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.raceDelete}','${legacyAttempt}');`, 'reject bogus advanced terminal').state === 'operator_review_required', 'advanced replay rejects terminal without token proof');
run(`UPDATE apple_auth_private.account_state SET deletion_lifecycle_id=NULL,deletion_outcome=NULL,deletion_reason=NULL,deletion_provenance=NULL,deletion_origin_attempt_id=NULL,deletion_replay_attempt_id=NULL,deletion_resolved_at=NULL WHERE user_id='${ids.raceDelete}';`, 'remove bogus advanced terminal');
check(service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.raceDelete}','${legacyAttempt}',NULL,NULL,'PRE091_NO_APPLE_PROVIDER','ticket/verified-no-provider','2026-09-05T09:00:00Z'::TIMESTAMPTZ);`, 'operator no-provider').state === 'not_required', 'verified operator evidence resolves pre091 no-provider');
check(service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.raceDelete}','${legacyAttempt}');`, 'operator replay').state === 'not_required', 'operator terminal result replays');
const directEvidence = run(`SELECT deletion_evidence_reference='ticket/verified-no-provider' AND deletion_evidence_at='2026-09-05T09:00:00Z'::TIMESTAMPTZ AND deletion_resolved_at IS DISTINCT FROM deletion_evidence_at FROM apple_auth_private.account_state WHERE user_id='${ids.raceDelete}';`, 'direct account evidence readback');
check(directEvidence === 't', `direct account evidence is retained separately from DB resolution time: ${directEvidence}`);

// Each manual key-loss decision retains its own immutable evidence before aggregate settlement.
const evidenceRegistrations = ['99000000-0000-4000-8000-000000000006', '99000000-0000-4000-8000-000000000007'];
const evidenceTokens = [];
for (let index = 0; index < evidenceRegistrations.length; index += 1) {
  const attempt = evidenceRegistrations[index];
  const ready = service(begin(ids.evidence, 'evidence-sub', attempt, `a${index + 7}`.repeat(32)), `begin evidence token ${index}`);
  service(capture(ids.evidence, attempt, ready.claim_token, ready.token_id), `capture evidence token ${index}`);
  const prepared = service(prepare(ids.evidence, attempt, ready.claim_token, ready.token_id, 'evidence-sub'), `prepare evidence token ${index}`);
  service(promote(ids.evidence, attempt, ready.claim_token, ready.token_id, 'evidence-sub', prepared.generation), `promote evidence token ${index}`);
  evidenceTokens.push(ready.token_id);
  if (index === 0) run(`UPDATE apple_auth_private.credential_tokens SET state='revoke_retryable' WHERE token_id='${ready.token_id}'; UPDATE apple_auth_private.registration_attempts SET created_at=clock_timestamp()-INTERVAL '3 seconds' WHERE attempt_id='${attempt}';`, 'make second evidence generation eligible');
}
const evidenceDelete = '99000000-0000-4000-8000-000000000008';
service(`SELECT public.begin_account_deletion_v2('${ids.evidence}',ARRAY[]::UUID[],'${evidenceDelete}');`, 'begin evidence deletion');
const evidenceClaimA = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.evidence}','${evidenceDelete}');`, 'claim evidence token A');
check(evidenceClaimA.token_id === evidenceTokens[0], 'evidence token A claimed first');
check(service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.evidence}','${evidenceDelete}');`, 'live evidence lease blocks token B').state === 'busy', 'one live provider lease blocks claiming another token');
const evidenceTimeA = '2026-09-05T10:00:00Z';
const evidenceA = service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.evidence}','${evidenceDelete}','${evidenceTokens[0]}','key-old','KEY_IRRECOVERABLY_LOST','ticket/key-A','${evidenceTimeA}'::TIMESTAMPTZ);`, 'resolve evidence token A');
check(evidenceA.state === 'retry_required', 'token A evidence commits while token B still requires work');
const evidenceAUpdatedAt = run(`SELECT updated_at::TEXT FROM apple_auth_private.credential_tokens WHERE token_id='${evidenceTokens[0]}';`, 'read token A update time');
const evidenceAReplay = service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.evidence}','${evidenceDelete}','${evidenceTokens[0]}','key-old','KEY_IRRECOVERABLY_LOST','ticket/key-A','${evidenceTimeA}'::TIMESTAMPTZ);`, 'replay exact token A evidence');
check(evidenceAReplay.state === 'retry_required', 'same exact token A evidence is idempotent');
check(run(`SELECT updated_at::TEXT FROM apple_auth_private.credential_tokens WHERE token_id='${evidenceTokens[0]}';`, 'read replay update time') === evidenceAUpdatedAt, 'idempotent evidence replay does not change updated_at');
check(service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.evidence}','${evidenceDelete}','${evidenceTokens[0]}','key-old','KEY_IRRECOVERABLY_LOST','ticket/conflict','${evidenceTimeA}'::TIMESTAMPTZ);`, 'reject conflicting token A evidence').state === 'stale', 'conflicting evidence retry is stale');
check(run(`SELECT operator_evidence_reference FROM apple_auth_private.credential_tokens WHERE token_id='${evidenceTokens[0]}';`, 'token A evidence unchanged') === 'ticket/key-A', 'conflicting retry cannot overwrite token A evidence');
check(run(`SELECT updated_at::TEXT FROM apple_auth_private.credential_tokens WHERE token_id='${evidenceTokens[0]}';`, 'token A timestamp after conflict') === evidenceAUpdatedAt, 'conflicting retry cannot change token A updated_at');
const evidenceClaimB = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.evidence}','${evidenceDelete}');`, 'claim evidence token B');
check(evidenceClaimB.token_id === evidenceTokens[1], 'manual token A does not hide claimable token B');
const evidenceTimeB = '2026-09-05T11:00:00Z';
const evidenceB = service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.evidence}','${evidenceDelete}','${evidenceTokens[1]}','key-old','KEY_IRRECOVERABLY_LOST','ticket/key-B','${evidenceTimeB}'::TIMESTAMPTZ);`, 'resolve evidence token B');
check(evidenceB.state === 'manual_required', 'aggregate becomes manual only after token B settles');
const finalEvidenceTimes = run(`SELECT s.updated_at::TEXT||'|'||t.updated_at::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.evidence}' AND t.token_id='${evidenceTokens[1]}';`, 'read final evidence timestamps');
check(service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.evidence}','${evidenceDelete}','${evidenceTokens[1]}','key-old','KEY_IRRECOVERABLY_LOST','ticket/key-B','${evidenceTimeB}'::TIMESTAMPTZ);`, 'replay exact final token B evidence').state === 'manual_required', 'same exact final evidence is idempotent');
check(run(`SELECT s.updated_at::TEXT||'|'||t.updated_at::TEXT FROM apple_auth_private.account_state s JOIN apple_auth_private.credential_tokens t ON t.request_uid=s.user_id WHERE s.user_id='${ids.evidence}' AND t.token_id='${evidenceTokens[1]}';`, 'read replayed final evidence timestamps') === finalEvidenceTimes, 'exact final evidence replay is read-only');
check(run(`SELECT count(*)=2 AND bool_or(operator_evidence_reference='ticket/key-A' AND operator_evidence_at='2026-09-05T10:00:00Z'::TIMESTAMPTZ) AND bool_or(operator_evidence_reference='ticket/key-B' AND operator_evidence_at='2026-09-05T11:00:00Z'::TIMESTAMPTZ) FROM apple_auth_private.credential_tokens WHERE request_uid='${ids.evidence}';`, 'read distinct token evidence') === 't', 'token A and B retain distinct references and times');
check(run(`SELECT count(*)=2 AND bool_and(revoke_attempt_id='${evidenceDelete}' AND last_error_code='KEY_IRRECOVERABLY_LOST') FROM apple_auth_private.credential_tokens WHERE request_uid='${ids.evidence}';`, 'read token evidence decision identity') === 't', 'each token retains its original decision attempt and reason');
check(run(`SELECT deletion_provenance||'|'||(deletion_evidence_reference IS NULL)::TEXT||'|'||(deletion_evidence_at IS NULL)::TEXT FROM apple_auth_private.account_state WHERE user_id='${ids.evidence}';`, 'aggregate token provenance') === 'operator_token_evidence|true|true', 'token evidence provenance is distinct and not copied to account evidence');
const evidenceDeleteNew = '99000000-0000-4000-8000-000000000009';
run(`UPDATE public.account_deletion_requests SET attempt_id='${evidenceDeleteNew}',phase='e2ee_prepared',cancellation_allowed=false WHERE user_id='${ids.evidence}';`, 'supersede evidence deletion attempt');
check(service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.evidence}','${evidenceDeleteNew}','${evidenceTokens[0]}','key-old','KEY_IRRECOVERABLY_LOST','ticket/new-attempt','2026-09-05T12:00:00Z'::TIMESTAMPTZ);`, 'new attempt cannot overwrite old token evidence').state === 'stale', 'new attempt cannot overwrite original token evidence');
check(run(`SELECT operator_evidence_reference FROM apple_auth_private.credential_tokens WHERE token_id='${evidenceTokens[0]}';`, 'old evidence after new attempt') === 'ticket/key-A', 'old token evidence survives a new attempt');

// Permanent key-loss resolution is exact-token/key bound and cannot forge revoked.
const keyDelete = '99000000-0000-4000-8000-000000000004';
const keyRegistration = '99000000-0000-4000-8000-000000000005';
const keyLease = service(begin(ids.keyLoss, 'key-sub', keyRegistration, 'cd'.repeat(32)), 'begin key token');
service(capture(ids.keyLoss, keyRegistration, keyLease.claim_token, keyLease.token_id), 'capture key token');
const keyPrepared = service(prepare(ids.keyLoss, keyRegistration, keyLease.claim_token, keyLease.token_id, 'key-sub'), 'prepare key promotion');
service(`SELECT public.begin_account_deletion_v2('${ids.keyLoss}',ARRAY[]::UUID[],'${keyDelete}');`, 'begin key deletion');
check(service(promote(ids.keyLoss, keyRegistration, keyLease.claim_token, keyLease.token_id, 'key-sub', keyPrepared.generation), 'promote during deletion').state === 'deletion_pending', 'late promotion stores retryable verified token without active resurrection');
const keyClaim = service(`SELECT public.apple_auth_claim_deletion_revocation('${ids.keyLoss}','${keyDelete}');`, 'claim key token');
check(service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.keyLoss}','${keyDelete}','${keyClaim.token_id}','wrong-key','KEY_IRRECOVERABLY_LOST','ticket/key-review',clock_timestamp());`, 'wrong key resolution').state === 'stale', 'operator cannot resolve a different key');
check(service(`SELECT public.apple_auth_operator_resolve_deletion('${ids.keyLoss}','${keyDelete}','${keyClaim.token_id}','key-old','KEY_IRRECOVERABLY_LOST','ticket/key-review',clock_timestamp());`, 'exact key resolution').state === 'manual_required', 'reviewed permanent key loss resolves manual only');
check(run(`SELECT deletion_outcome FROM apple_auth_private.account_state WHERE user_id='${ids.keyLoss}';`, 'operator outcome') === 'manual_required', 'operator cannot forge provider revocation');

check(files.at(-1) === '091_apple_auth_credentials.sql', 'full migration chain reached 091');
console.log(`PASS: Apple auth credential PostgreSQL harness (${checks} assertions, migrations 001..091).`);
