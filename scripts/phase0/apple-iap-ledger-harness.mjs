#!/usr/bin/env node
/**
 * Focused PostgreSQL actor proof for migration 073.
 *
 * This is intentionally independent from the older all-chain harness: it
 * creates the Supabase auth/role contract needed by this private schema, then
 * applies the real migration to a throwaway PostgreSQL cluster. It never uses a
 * configured Supabase project and never prints user-content or credentials.
 *
 * Usage: node scripts/phase0/apple-iap-ledger-harness.mjs [--keep]
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATION = join(ROOT, 'supabase/migrations/073_apple_iap_server_ledger.sql');
const keep = process.argv.includes('--keep');
const env = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const TOKEN_A = '10000000-0000-4000-8000-00000000000a';
const TOKEN_B = '10000000-0000-4000-8000-00000000000b';
let boundToken = TOKEN_A;
let checks = 0;

function have(binary) {
  return spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
}

if (!existsSync(MIGRATION)) {
  console.error('BLOCKED — migration 073 is not present.');
  process.exit(2);
}
if (!['initdb', 'pg_ctl', 'psql'].every(have)) {
  console.error('BLOCKED — PostgreSQL actor harness requires initdb, pg_ctl, and psql on PATH.');
  console.error('UNVERIFIED — no database actor assertions were executed.');
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'gomsinlog-iap-ledger-'));
const dataDir = join(dir, 'pgdata');
const socketDir = join(dir, 'sock');
execFileSync('mkdir', ['-p', socketDir], { env });
let started = false;
function cleanup() {
  if (started) spawnSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore', env });
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

function psql(args, input) {
  return spawnSync(
    'psql', ['-h', socketDir, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', input, env },
  );
}
function admin(sql) {
  return psql(['-At', '-c', sql]);
}
function asActor(role, userId, sql, { setRoleClaim = true } = {}) {
  const args = ['-At', '-c', `SET ROLE ${role}`];
  if (userId !== null) args.push('-c', `DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $$`);
  if (setRoleClaim) args.push('-c', `DO $$ BEGIN PERFORM set_config('request.jwt.claim.role', '${role}', false); END $$`);
  args.push('-c', sql);
  return psql(args);
}
function asActorAsync(role, userId, sql) {
  const args = ['-h', socketDir, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At', '-c', `SET ROLE ${role}`];
  if (userId !== null) args.push('-c', `DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '${userId}', false); END $$`);
  args.push('-c', `DO $$ BEGIN PERFORM set_config('request.jwt.claim.role', '${role}', false); END $$`);
  args.push('-c', sql);
  return new Promise((resolvePromise) => {
    const child = spawn('psql', args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
}
function q(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}
function tokenHash(token) {
  return sha(token.toLowerCase());
}
function expectOk(result, label) {
  if (result.status !== 0) throw new Error(`${label}: ${(result.stderr ?? '').trim()}`);
  checks += 1;
  return (result.stdout ?? '').trim();
}
function expectFail(result, label) {
  if (result.status === 0) throw new Error(`${label}: expected denial, but SQL succeeded`);
  checks += 1;
}
function scalar(sql, label) {
  return expectOk(admin(sql), label).split('\n')[0] ?? '';
}
function actorScalar(role, userId, sql, label) {
  return expectOk(asActor(role, userId, sql), label).split('\n')[0] ?? '';
}
function jsonResult(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label}: invalid JSON result ${text}`); }
}
function callApply({ user = A, environment = 'Production', tx, original = tx, product, bundle = 'app.gomsinlog', token = boundToken, hash, purchase, signed, expires = null, revoke = null, event, notification = null, claim = null }) {
  const args = [
    q(user) + '::uuid', q(environment), q(tx), q(original), q(product), q(bundle), q(tokenHash(token)),
    `${purchase}::bigint`, `${signed}::bigint`, expires === null ? 'NULL' : `${expires}::bigint`,
    revoke === null ? 'NULL' : `${revoke}::bigint`, q(event), q(hash),
    notification ? `${q(notification)}::uuid` : 'NULL', claim ? `${q(claim)}::uuid` : 'NULL',
  ];
  return asActor('service_role', null, `SELECT row_to_json(x) FROM public.iap_apply_verified_transaction(${args.join(', ')}) AS x`);
}

try {
  expectOk(spawnSync('initdb', ['-D', dataDir, '--no-locale', '-A', 'trust', '-U', 'postgres'], { encoding: 'utf8', env, stdio: 'inherit' }), 'initdb');
  expectOk(spawnSync('pg_ctl', ['-D', dataDir, '-o', `-k ${socketDir} -h ''`, '-w', 'start'], { encoding: 'utf8', env, stdio: 'inherit' }), 'pg_ctl start');
  started = true;
  expectOk(admin(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.account_deletion_requests (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      expected_record_ids uuid[] NOT NULL DEFAULT '{}',
      requested_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
  `), 'Supabase auth stub');
  expectOk(psql(['-f', MIGRATION]), 'apply migration 073');
  if (scalar("SELECT count(*)::text FROM iap_private.apple_product_catalog WHERE sale_enabled", 'seeded sale state') !== '0') {
    throw new Error('a seeded Apple IAP product is unexpectedly sale-enabled');
  }
  if (scalar("SELECT count(*)::text FROM iap_private.apple_product_catalog", 'seeded catalog count') !== '18') {
    throw new Error('the six reviewed product identities were not seeded for all three environments');
  }

  // Fixture writes happen as the database owner, never through a client role.
  expectOk(admin(`
    INSERT INTO auth.users (id) VALUES (${q(A)}::uuid), (${q(B)}::uuid);
    INSERT INTO iap_private.apple_product_catalog
      (environment, product_id, product_key, product_type, bundle_id, entitlement_key, credit_amount)
    VALUES
      ('Production', 'paper.off', 'paper.off', 'non_consumable', 'app.gomsinlog', 'paper.off', 0),
      ('Production', 'paper.paid', 'paper.paid', 'non_consumable', 'app.gomsinlog', 'paper.paid', 0),
      ('Production', 'export.3', 'export.3', 'consumable', 'app.gomsinlog', NULL, 3),
      ('Sandbox', 'paper.paid', 'paper.paid', 'non_consumable', 'app.gomsinlog', 'paper.paid', 0),
      ('Xcode', 'paper.paid', 'paper.paid.xcode', 'non_consumable', 'app.gomsinlog', 'paper.paid.xcode', 0)
    ON CONFLICT (environment, product_id) DO UPDATE
    SET product_key = EXCLUDED.product_key,
        product_type = EXCLUDED.product_type,
        bundle_id = EXCLUDED.bundle_id,
        entitlement_key = EXCLUDED.entitlement_key,
        credit_amount = EXCLUDED.credit_amount;
    UPDATE iap_private.apple_product_catalog
    SET sale_enabled = TRUE
    WHERE (environment, product_id) IN
      (('Production', 'paper.paid'), ('Production', 'export.3'), ('Xcode', 'paper.paid'));
    INSERT INTO iap_private.apple_account_bindings (user_id, app_account_token, app_account_token_hash)
    VALUES (${q(A)}::uuid, ${q(TOKEN_A)}::uuid, ${q(tokenHash(TOKEN_A))});
  `), 'catalog fixture');

  const saleDefault = scalar("SELECT sale_enabled::text FROM iap_private.apple_product_catalog WHERE environment = 'Production' AND product_id = 'paper.off'", 'sale default');
  if (saleDefault !== 'false' && saleDefault !== 'f') {
    throw new Error(`sale default: catalog did not default to OFF (got ${saleDefault || '<empty>'})`);
  }
  expectFail(asActor('anon', null, "SELECT count(*) FROM iap_private.apple_product_catalog"), 'anon direct private-table access');
  expectFail(asActor('authenticated', A, "SELECT count(*) FROM iap_private.apple_product_catalog"), 'authenticated direct private-table access');
  expectFail(asActor('service_role', null, "SELECT count(*) FROM iap_private.apple_transactions"), 'service_role direct private-table access');
  expectFail(asActor('anon', null, `SELECT * FROM public.iap_get_state('Production')`), 'anon state RPC');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_claim_notification('00000000-0000-4000-8000-000000000001', 'Production', 'DID_RENEW', NULL, '1001', '1001', 1000, ${q(sha('n1'))})`), 'standalone notification claim');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_apply_verified_transaction(${q(A)}::uuid, 'Production', '1001', '1001', 'paper.paid', 'app.gomsinlog', ${q(tokenHash(TOKEN_A))}, 1000, 1000, NULL, NULL, 'purchase', ${q(sha('t1'))})`), 'authenticated transaction apply');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification('00000000-0000-4000-8000-000000000001', 'Production', 'DID_RENEW', NULL, NULL, NULL, 1000, ${q(sha('n1'))}, '1001', '1001', 'paper.paid', 'app.gomsinlog', ${q(tokenHash(TOKEN_A))}, 1000, 1000, NULL, NULL, 'purchase', ${q(sha('t1'))})`, { setRoleClaim: false }), 'service_role missing JWT role claim');

  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_prepare_purchase('paper.off', 'Production')`), 'sale-OFF prepare');
  const prepared = actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_prepare_purchase('paper.paid', 'Production') AS x`, 'prepare purchase');
  const preparedState = jsonResult(prepared, 'prepare purchase');
  if (preparedState.sale_enabled !== true || typeof preparedState.account_token !== 'string') throw new Error('prepare purchase did not return a server token for a sale-enabled catalog row');
  boundToken = preparedState.account_token;
  const preparedAgain = jsonResult(actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_prepare_purchase('paper.paid', 'Production') AS x`, 'prepare purchase replay'), 'prepare purchase replay');
  if (preparedAgain.account_token !== boundToken) throw new Error('active binding did not return the same server token');
  const emptyState = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_get_state('Production') AS x`, 'unbound account state'), 'unbound account state');
  if (emptyState.export_credits !== 0 || emptyState.entitlement_key !== null) throw new Error('an unbound account did not receive an empty IAP state');
  const otherAccountToken = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_prepare_purchase('paper.paid', 'Production') AS x`, 'other account prepare'), 'other account prepare').account_token;
  if (otherAccountToken === boundToken) throw new Error('different account received the same server token');
  expectOk(admin(`INSERT INTO public.account_deletion_requests (user_id) VALUES (${q(B)}::uuid)`), 'other account deletion marker');
  expectFail(asActor('authenticated', B, `SELECT * FROM public.iap_prepare_purchase('paper.paid', 'Production')`), 'pending-deletion purchase prepare');
  expectOk(admin(`DELETE FROM public.account_deletion_requests WHERE user_id = ${q(B)}::uuid`), 'clear other account deletion marker');
  const billingAccountId = scalar(`SELECT billing_account_id::text FROM iap_private.apple_account_bindings WHERE user_id = ${q(A)}::uuid`, 'billing account binding');
  if (!/^[0-9a-f-]{36}$/.test(billingAccountId)) throw new Error('billing account binding did not receive an arbitrary UUID primary key');
  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_get_state('Production')`), 'authenticated state RPC');

  expectOk(callApply({ tx: '1001', product: 'paper.paid', hash: sha('purchase-1001'), purchase: 1000, signed: 1000, event: 'purchase' }), 'non-consumable purchase');
  const notificationHash = sha('notification-refund-1001');
  const refundHash = sha('refund-1001');
  const notificationId = '00000000-0000-4000-8000-000000000002';
  const processed = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    ${q(notificationId)}::uuid, 'Production', 'REFUND', NULL, '1001', '1001', 4000, ${q(notificationHash)},
    '1001', '1001', 'paper.paid', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 4000, NULL, 4000, 'refund', ${q(refundHash)}) AS x`, 'atomic notification refund');
  if (jsonResult(processed, 'atomic notification refund').transaction_applied !== true) throw new Error('atomic notification did not apply transaction');
  const replay = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    ${q(notificationId)}::uuid, 'Production', 'REFUND', NULL, '1001', '1001', 4000, ${q(notificationHash)},
    '1001', '1001', 'paper.paid', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 4000, NULL, 4000, 'refund', ${q(refundHash)}) AS x`, 'atomic notification replay');
  if (jsonResult(replay, 'atomic notification replay').duplicate !== true) throw new Error('notification replay was not duplicate');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification(
    ${q(notificationId)}::uuid, 'Production', 'REFUND', NULL, '1001', '1001', 4000, ${q(sha('notification-conflict'))},
    '1001', '1001', 'paper.paid', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 4000, NULL, 4000, 'refund', ${q(refundHash)}) AS x`), 'notification UUID payload conflict');
  const staleNotification = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    '00000000-0000-4000-8000-000000000004', 'Production', 'REFUND', NULL, '1001', '1001', 3500, ${q(sha('notification-stale'))}) AS x`, 'out-of-order notification');
  if (jsonResult(staleNotification, 'out-of-order notification').stale !== true) throw new Error('out-of-order notification was not marked stale');
  expectOk(callApply({ tx: '1001', product: 'paper.paid', hash: sha('purchase-stale'), purchase: 1000, signed: 3000, event: 'purchase' }), 'out-of-order transaction input');
  if (scalar("SELECT last_event_kind FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '1001'", 'stale status') !== 'refund') throw new Error('stale transaction changed latest event');
  expectFail(callApply({ tx: '1001', product: 'paper.paid', hash: sha('refund-conflict'), purchase: 1000, signed: 4000, event: 'refund' }), 'same signedDate different payload conflict');
  expectOk(callApply({ tx: '1001', product: 'paper.paid', hash: sha('reverse-1001'), purchase: 1000, signed: 5000, event: 'refund_reversed' }), 'refund reversed entitlement');
  const restoredState = scalar(`SELECT active::text || '|' || (SELECT last_event_kind FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '1001') || '|' || COALESCE((SELECT revocation_at::text FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '1001'), 'null') FROM iap_private.entitlements WHERE billing_account_id = ${q(billingAccountId)}::uuid AND environment = 'Production' AND entitlement_key = 'paper.paid'`, 'refund reversed entitlement state');
  if (!restoredState.startsWith('true|')) throw new Error(`refund reversed did not restore entitlement (state ${restoredState || '<empty>'})`);

  expectOk(callApply({ tx: '5001', original: '5001', product: 'app.gomsinlog.plus.monthly', hash: sha('plus-5001'), purchase: 1788440000000, signed: 1788440001000, expires: 1893456000000, event: 'purchase' }), 'subscription first period');
  expectOk(callApply({ tx: '5002', original: '5001', product: 'app.gomsinlog.plus.annual', hash: sha('plus-5002'), purchase: 1788440002000, signed: 1788440002000, expires: 1924992000000, event: 'purchase' }), 'subscription renewal period');
  expectOk(callApply({ tx: '5001', original: '5001', product: 'app.gomsinlog.plus.monthly', hash: sha('plus-refund-5001'), purchase: 1788440000000, signed: 1788440003000, expires: 1893456000000, revoke: 1788440003000, event: 'refund' }), 'older subscription period refund');
  if (scalar(`SELECT active::text || '|' || source_transaction_id FROM iap_private.entitlements WHERE billing_account_id = ${q(billingAccountId)}::uuid AND environment = 'Production' AND entitlement_key = 'plus'`, 'subscription projection source') !== 'true|5002') throw new Error('an older refunded period overrode the active renewal entitlement');

  expectOk(callApply({ tx: '2002', product: 'export.3', hash: sha('purchase-2002'), purchase: 1000, signed: 1000, event: 'purchase' }), 'consumable purchase grant');
  expectOk(callApply({ tx: '2002', product: 'export.3', hash: sha('refund-2002'), purchase: 1000, signed: 2000, event: 'refund' }), 'consumable refund reclaim');
  expectOk(callApply({ tx: '2002', product: 'export.3', hash: sha('reverse-2002'), purchase: 1000, signed: 3000, event: 'refund_reversed' }), 'consumable refund reversed');
  expectOk(callApply({ environment: 'Sandbox', tx: '2003', product: 'app.gomsinlog.book.export.credit.1', hash: sha('purchase-2003'), purchase: 1000, signed: 1000, event: 'purchase' }), 'sandbox consumable purchase grant');
  const consumed = jsonResult(actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Sandbox', 1, '20000000-0000-4000-8000-000000000004'::uuid) AS x`, 'sandbox credit reserve'), 'sandbox credit reserve');
  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_commit(${q(consumed.reservation_id)}::uuid)`), 'sandbox credit commit');
  expectOk(callApply({ environment: 'Sandbox', tx: '2003', product: 'app.gomsinlog.book.export.credit.1', hash: sha('refund-2003'), purchase: 1000, signed: 2000, event: 'refund' }), 'fully consumed credit refund');
  if (actorScalar('authenticated', A, `SELECT export_credits::text FROM public.iap_get_state('Sandbox') LIMIT 1`, 'post-refund credit floor') !== '0') throw new Error('consumable refund created a negative balance');
  expectOk(callApply({ environment: 'Sandbox', tx: '2003', product: 'app.gomsinlog.book.export.credit.1', hash: sha('reverse-2003'), purchase: 1000, signed: 3000, event: 'refund_reversed' }), 'fully consumed credit refund reversal');
  if (actorScalar('authenticated', A, `SELECT export_credits::text FROM public.iap_get_state('Sandbox') LIMIT 1`, 'post-reversal exact credit') !== '0') throw new Error('refund reversal restored a credit that was never reclaimed');
  const reserveKey1 = '20000000-0000-4000-8000-000000000001';
  const reservation1 = jsonResult(actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 1, ${q(reserveKey1)}::uuid) AS x`, 'reserve credit'), 'reserve credit');
  const reservationReplay = jsonResult(actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 1, ${q(reserveKey1)}::uuid) AS x`, 'reserve credit replay'), 'reserve credit replay');
  if (reservationReplay.reservation_id !== reservation1.reservation_id || reservationReplay.duplicate !== true) throw new Error('reserve idempotency failed');
  expectFail(asActor('authenticated', B, `SELECT * FROM public.iap_export_credit_release(${q(reservation1.reservation_id)}::uuid)`), 'cross-account reservation release');
  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_release(${q(reservation1.reservation_id)}::uuid)`), 'release credit');
  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_release(${q(reservation1.reservation_id)}::uuid)`), 'release credit replay');
  const reserveKey2 = '20000000-0000-4000-8000-000000000002';
  const reservation2 = jsonResult(actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 1, ${q(reserveKey2)}::uuid) AS x`, 'reserve credit for commit'), 'reserve credit for commit');
  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_commit(${q(reservation2.reservation_id)}::uuid)`), 'commit credit');
  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_commit(${q(reservation2.reservation_id)}::uuid)`), 'commit credit replay');
  expectOk(callApply({ environment: 'Xcode', tx: '9009', product: 'paper.paid', hash: sha('xcode-9009'), purchase: 1000, signed: 1000, event: 'purchase' }), 'Xcode transaction fixture');

  const raceSql = (user, token, tx) => `SELECT * FROM public.iap_apply_verified_transaction(
    ${q(user)}::uuid, 'Production', ${q(tx)}, '4000', 'paper.paid', 'app.gomsinlog',
    ${q(tokenHash(token))}, 1000, 8000, NULL, NULL, 'purchase', ${q(sha(`race-${tx}`))})`;
  const raceResults = await Promise.all([
    asActorAsync('service_role', null, raceSql(A, boundToken, '4001')),
    asActorAsync('service_role', null, raceSql(B, otherAccountToken, '4002')),
  ]);
  if (raceResults.filter((result) => result.status === 0).length !== 1) {
    throw new Error('concurrent original-transaction ownership race did not admit exactly one account');
  }
  checks += 1;
  if (scalar("SELECT count(DISTINCT billing_account_id)::text || '|' || count(*)::text FROM iap_private.apple_transactions WHERE environment = 'Production' AND original_transaction_id = '4000'", 'original ownership race result') !== '1|1') {
    throw new Error('one original transaction chain was assigned to multiple billing accounts');
  }
  expectOk(admin("DELETE FROM iap_private.entitlements WHERE source_transaction_id IN ('4001', '4002'); DELETE FROM iap_private.apple_transactions WHERE original_transaction_id = '4000';"), 'race fixture cleanup');

  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_list_reconciliation_targets()`), 'authenticated reconciliation target RPC');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_list_reconciliation_targets()`, { setRoleClaim: false }), 'service_role reconciliation target without JWT role claim');
  if (actorScalar('service_role', null, `SELECT count(*)::text FROM public.iap_list_reconciliation_targets()`, 'live reconciliation targets') !== '4') throw new Error('live reconciliation targets did not include the expected Apple chains');
  if (actorScalar('service_role', null, `SELECT count(*)::text FROM public.iap_list_reconciliation_targets() WHERE environment = 'Xcode'`, 'Xcode reconciliation exclusion') !== '0') throw new Error('Xcode was exposed as an Apple Server API reconciliation target');

  const atomicRollbackId = '00000000-0000-4000-8000-000000000003';
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification(
    ${q(atomicRollbackId)}::uuid, 'Production', 'DID_RENEW', NULL, '3003', '3003', 6000, ${q(sha('n-rollback'))},
    '3003', '3003', 'not-in-catalog', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 6000, NULL, NULL, 'purchase', ${q(sha('t-rollback'))}) AS x`), 'atomic process invalid transaction');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_notifications WHERE notification_uuid = ${q(atomicRollbackId)}::uuid`, 'atomic rollback proof') !== '0') throw new Error('failed process partially committed notification claim');

  expectOk(callApply({ environment: 'Sandbox', token: TOKEN_A, tx: '1001', product: 'paper.paid', hash: sha('sandbox-1001'), purchase: 1000, signed: 1000, event: 'purchase' }), 'sandbox/prod identifier separation');
  if (scalar("SELECT count(*)::text FROM iap_private.apple_transactions WHERE transaction_id = '1001'", 'environment separation count') !== '2') throw new Error('sandbox and production ledgers were not separate');

  const before = scalar(`SELECT (SELECT count(*) FROM iap_private.apple_transactions WHERE billing_account_id = ${q(billingAccountId)}::uuid) || '|' || (SELECT count(*) FROM iap_private.apple_notifications) || '|' || (SELECT count(*) FROM iap_private.export_credit_ledger WHERE billing_account_id = ${q(billingAccountId)}::uuid)`, 'deletion evidence before');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_prepare_account_deletion(${q(A)}::uuid)`), 'authenticated account deletion prep');
  expectFail(asActor('anon', null, `SELECT * FROM public.iap_prepare_account_deletion(${q(A)}::uuid)`), 'anon account deletion prep');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion(${q(A)}::uuid)`), 'missing-marker account deletion prep');
  expectOk(admin(`INSERT INTO public.account_deletion_requests (user_id) VALUES (${q(A)}::uuid)`), 'account deletion marker');
  expectOk(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion(${q(A)}::uuid)`), 'service account deletion prep');
  expectOk(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion(${q(A)}::uuid)`), 'idempotent account deletion prep');
  const after = scalar(`SELECT (SELECT count(*) FROM iap_private.apple_transactions WHERE billing_account_id = ${q(billingAccountId)}::uuid) || '|' || (SELECT count(*) FROM iap_private.apple_notifications) || '|' || (SELECT count(*) FROM iap_private.export_credit_ledger WHERE billing_account_id = ${q(billingAccountId)}::uuid)`, 'deletion evidence after');
  if (before !== after) throw new Error(`account deletion prep deleted immutable evidence (${before} -> ${after})`);
  if (scalar(`SELECT (user_id IS NULL)::text || '|' || (app_account_token IS NULL)::text || '|' || length(app_account_token_hash)::text FROM iap_private.apple_account_bindings WHERE billing_account_id = ${q(billingAccountId)}::uuid`, 'raw token/user tombstone') !== 'true|true|64') throw new Error('account deletion prep did not tombstone the user/raw token while preserving the hash');
  expectOk(admin(`DELETE FROM auth.users WHERE id = ${q(A)}::uuid`), 'auth delete after billing tombstone');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_transactions WHERE billing_account_id = ${q(billingAccountId)}::uuid`, 'retained ledger after auth delete') !== '7') throw new Error('auth user deletion removed billing-account transaction evidence');
  const deletedNotification = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    '00000000-0000-4000-8000-000000000005', 'Production', 'REFUND', NULL, '2002', '2002', 7000, ${q(sha('deleted-notification'))},
    '2002', '2002', 'export.3', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 7000, NULL, 7000, 'refund', ${q(sha('deleted-refund'))}) AS x`, 'post-deletion notification');
  if (jsonResult(deletedNotification, 'post-deletion notification').transaction_applied !== false) throw new Error('post-deletion notification re-granted a tombstoned account');
  if (scalar("SELECT status FROM iap_private.apple_notifications WHERE notification_uuid = '00000000-0000-4000-8000-000000000005'", 'post-deletion notification status') !== 'processed') throw new Error('post-deletion notification was not retained as processed evidence');
  if (actorScalar('service_role', null, `SELECT count(*)::text FROM public.iap_list_reconciliation_targets()`, 'tombstoned reconciliation exclusion') !== '0') throw new Error('tombstoned account remained an automatic reconciliation target');
  expectFail(asActor('authenticated', A, "SELECT * FROM public.iap_get_state('Production')"), 'deleted account state access');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_reserve('Production', 1, '20000000-0000-4000-8000-000000000003')`), 'deleted account credit reserve');

  if (scalar("SELECT count(*)::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'iap_private' AND a.attname ~* '(^|_)(raw|jws)(_|$)' AND NOT a.attisdropped", 'raw JWS column proof') !== '0') throw new Error('raw JWS-looking column exists');
  if (scalar("SELECT count(*)::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'iap_private' AND c.relname IN ('apple_transactions','entitlements','export_credit_ledger','export_credit_reservations') AND a.attname = 'user_id' AND NOT a.attisdropped", 'retained raw user id proof') !== '0') throw new Error('retained IAP ledger still has a raw user_id column');
  if (scalar("SELECT count(*)::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'iap_private' AND c.relname IN ('apple_transactions','entitlements','export_credit_ledger','export_credit_reservations') AND a.attname = 'billing_account_id' AND NOT a.attisdropped", 'billing account linkage proof') !== '4') throw new Error('retained IAP ledgers are not all billing-account linked');
  if (scalar("SELECT count(*)::text FROM pg_constraint WHERE conrelid = 'iap_private.apple_account_bindings'::regclass AND confrelid = 'auth.users'::regclass AND confdeltype = 'n'", 'auth user FK policy') !== '1') throw new Error('billing binding is missing ON DELETE SET NULL auth user FK');
  if (scalar("SELECT pg_get_function_result(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'iap_prepare_account_deletion'", 'account deletion return contract').includes('user_id')) throw new Error('account deletion prep still returns raw user_id');
  if (scalar("SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'iap_prepare_purchase'", 'server-token RPC signature') !== 'p_product_id text, p_environment text') throw new Error('prepare RPC still accepts client token/bundle inputs');
  if (scalar("SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'iap_list_reconciliation_targets'", 'reconciliation target signature') !== '') throw new Error('reconciliation target RPC unexpectedly accepts client-selected inputs');
  if (scalar("SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('iap_prepare_purchase','iap_get_state','iap_claim_notification','iap_apply_verified_transaction','iap_process_verified_notification','iap_export_credit_reserve','iap_export_credit_commit','iap_export_credit_release','iap_prepare_account_deletion','iap_list_reconciliation_targets') AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']", 'definer/search_path contract') !== '10') throw new Error('typed RPC security-definer/search_path contract incomplete');

  console.log(`PASS — Apple IAP ledger PostgreSQL actor harness: ${checks} assertions`);
  console.log('UNVERIFIED — remote Supabase catalog/migration state, Edge deployment, Apple verification keys, Sandbox/Production servers, and device/App Store behavior.');
} catch (error) {
  console.error(`FAIL — Apple IAP ledger harness after ${checks} assertions: ${error.message}`);
  process.exitCode = 1;
}
