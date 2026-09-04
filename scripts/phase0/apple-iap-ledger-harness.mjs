#!/usr/bin/env node
/**
 * Focused PostgreSQL actor proof for migration 077.
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
const MIGRATION = join(ROOT, 'supabase/migrations/077_apple_iap_server_ledger.sql');
const keep = process.argv.includes('--keep');
const env = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const TOKEN_A = '10000000-0000-4000-8000-00000000000a';
const TOKEN_B = '10000000-0000-4000-8000-00000000000b';
const TOKEN_D = '10000000-0000-4000-8000-00000000000d';
const ATTEMPT_A = '30000000-0000-4000-8000-00000000000a';
const ATTEMPT_B = '30000000-0000-4000-8000-00000000000b';
const ATTEMPT_C = '30000000-0000-4000-8000-00000000000c';
const ATTEMPT_D = '30000000-0000-4000-8000-00000000000d';
let boundToken = TOKEN_A;
let checks = 0;

function have(binary) {
  return spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
}

if (!existsSync(MIGRATION)) {
  console.error('BLOCKED — migration 077 is not present.');
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
function adminAsync(sql) {
  const args = ['-h', socketDir, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At', '-c', sql];
  return new Promise((resolvePromise) => {
    const child = spawn('psql', args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
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
async function waitForGrantedAdvisoryLock(label) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = admin("SELECT count(*)::text FROM pg_locks WHERE locktype = 'advisory' AND granted");
    if (result.status !== 0) throw new Error(`${label}: ${(result.stderr ?? '').trim()}`);
    if (Number((result.stdout ?? '').trim()) > 0) {
      checks += 1;
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`${label}: timed out waiting for the deletion lock`);
}
function appleType(product) {
  if (product === 'export.3' || product === 'app.gomsinlog.book.export.credit.1') return 'Consumable';
  if (product === 'app.gomsinlog.plus.monthly' || product === 'app.gomsinlog.plus.annual') return 'Auto-Renewable Subscription';
  return 'Non-Consumable';
}
function callApply({ user = A, environment = 'Production', tx, original = tx, product, type = appleType(product), bundle = 'app.gomsinlog', token = boundToken, hash, purchase, signed, expires = null, revoke = null, event, notification = null, claim = null }) {
  const args = [
    q(user) + '::uuid', q(environment), q(tx), q(original), q(product), q(type), q(bundle), q(tokenHash(token)),
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
    -- Supabase installs database extensions outside public. Migration 077 must
    -- therefore work when pgcrypto already exists in the standard extensions
    -- schema and CREATE EXTENSION IF NOT EXISTS leaves it there.
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.account_deletion_requests (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      attempt_id uuid NOT NULL,
      phase text NOT NULL,
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
    CREATE FUNCTION public.lock_account_deletion_attempt_v2(
      p_user_id uuid,
      p_attempt_id uuid
    ) RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $stub$
    DECLARE
      v_phase text;
    BEGIN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
      END IF;
      IF p_user_id IS NULL OR p_attempt_id IS NULL THEN
        RAISE EXCEPTION 'Invalid account deletion payload' USING ERRCODE = '22004';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 15013)
      );
      SELECT deletion.phase INTO v_phase
      FROM public.account_deletion_requests AS deletion
      WHERE deletion.user_id = p_user_id
        AND deletion.attempt_id = p_attempt_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stale_account_deletion_attempt' USING ERRCODE = '42501';
      END IF;
      RETURN v_phase;
    END;
    $stub$;
    REVOKE ALL ON FUNCTION public.lock_account_deletion_attempt_v2(uuid, uuid)
      FROM PUBLIC, anon, authenticated, service_role;
  `), 'Supabase auth stub');
  expectOk(psql(['-f', MIGRATION]), 'apply migration 077');
  if (scalar("SELECT count(*)::text FROM iap_private.apple_product_catalog WHERE sale_enabled", 'seeded sale state') !== '0') {
    throw new Error('a seeded Apple IAP product is unexpectedly sale-enabled');
  }
  if (scalar("SELECT count(*)::text FROM iap_private.apple_product_catalog", 'seeded catalog count') !== '18') {
    throw new Error('the six reviewed product identities were not seeded for all three environments');
  }

  // Fixture writes happen as the database owner, never through a client role.
  expectOk(admin(`
    INSERT INTO auth.users (id) VALUES
      (${q(A)}::uuid), (${q(B)}::uuid), (${q(C)}::uuid), (${q(D)}::uuid);
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
    VALUES
      (${q(A)}::uuid, ${q(TOKEN_A)}::uuid, ${q(tokenHash(TOKEN_A))}),
      (${q(D)}::uuid, ${q(TOKEN_D)}::uuid, ${q(tokenHash(TOKEN_D))});
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
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_apply_verified_transaction(${q(A)}::uuid, 'Production', '1001', '1001', 'paper.paid', 'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(TOKEN_A))}, 1000, 1000, NULL, NULL, 'purchase', ${q(sha('t1'))})`), 'authenticated transaction apply');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification('00000000-0000-4000-8000-000000000001', 'Production', 'DID_RENEW', NULL, NULL, NULL, 1000, ${q(sha('n1'))}, '1001', '1001', 'paper.paid', 'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(TOKEN_A))}, 1000, 1000, NULL, NULL, 'purchase', ${q(sha('t1'))})`, { setRoleClaim: false }), 'service_role missing JWT role claim');

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
  expectOk(admin(`INSERT INTO public.account_deletion_requests (user_id, attempt_id, phase)
    VALUES (${q(B)}::uuid, ${q(ATTEMPT_B)}::uuid, 'media_cleanup')`), 'other account deletion marker');
  expectFail(asActor('authenticated', B, `SELECT * FROM public.iap_prepare_purchase('paper.paid', 'Production')`), 'pending-deletion purchase prepare');
  expectOk(admin(`DELETE FROM public.account_deletion_requests WHERE user_id = ${q(B)}::uuid`), 'clear other account deletion marker');

  // A deletion transaction owns the same per-user fence before its marker is
  // visible. Purchase preparation must wait, observe the committed marker, and
  // fail without creating an account binding.
  const purchaseDeletionRace = adminAsync(`
    BEGIN;
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${q(C)}::text, 15013)
    );
    SELECT pg_sleep(0.5);
    INSERT INTO public.account_deletion_requests (user_id, attempt_id, phase)
    VALUES (${q(C)}::uuid, ${q(ATTEMPT_C)}::uuid, 'media_cleanup');
    COMMIT;
  `);
  await waitForGrantedAdvisoryLock('purchase/deletion race lock');
  const purchaseDuringDeletion = asActorAsync(
    'authenticated',
    C,
    `SELECT * FROM public.iap_prepare_purchase('paper.paid', 'Production')`,
  );
  const [purchaseDeletionResult, purchaseRaceResult] = await Promise.all([
    purchaseDeletionRace,
    purchaseDuringDeletion,
  ]);
  expectOk(purchaseDeletionResult, 'commit purchase/deletion race marker');
  expectFail(purchaseRaceResult, 'purchase waits for concurrent deletion');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_account_bindings WHERE user_id = ${q(C)}::uuid`, 'purchase/deletion race binding result') !== '0') {
    throw new Error('purchase created a binding after concurrent deletion started');
  }

  // The verified server path uses the same fence. Without it this transaction
  // would grant D before the not-yet-visible deletion marker commits.
  const applyDeletionRace = adminAsync(`
    BEGIN;
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${q(D)}::text, 15013)
    );
    SELECT pg_sleep(0.5);
    INSERT INTO public.account_deletion_requests (user_id, attempt_id, phase)
    VALUES (${q(D)}::uuid, ${q(ATTEMPT_D)}::uuid, 'media_cleanup');
    COMMIT;
  `);
  await waitForGrantedAdvisoryLock('verified-apply/deletion race lock');
  const applyDuringDeletion = asActorAsync('service_role', null, `
    SELECT * FROM public.iap_apply_verified_transaction(
      ${q(D)}::uuid, 'Production', '8001', '8001', 'paper.paid',
      'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(TOKEN_D))},
      8000, 8000, NULL, NULL, 'purchase', ${q(sha('deletion-race-8001'))}
    )
  `);
  const [applyDeletionResult, applyRaceResult] = await Promise.all([
    applyDeletionRace,
    applyDuringDeletion,
  ]);
  expectOk(applyDeletionResult, 'commit verified-apply/deletion race marker');
  expectFail(applyRaceResult, 'verified apply waits for concurrent deletion');
  if (scalar("SELECT count(*)::text FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '8001'", 'verified-apply/deletion race result') !== '0') {
    throw new Error('verified apply granted a transaction after concurrent deletion started');
  }
  const billingAccountId = scalar(`SELECT billing_account_id::text FROM iap_private.apple_account_bindings WHERE user_id = ${q(A)}::uuid`, 'billing account binding');
  if (!/^[0-9a-f-]{36}$/.test(billingAccountId)) throw new Error('billing account binding did not receive an arbitrary UUID primary key');
  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_get_state('Production')`), 'authenticated state RPC');

  expectOk(callApply({ tx: '1001', product: 'paper.paid', hash: sha('purchase-1001'), purchase: 1000, signed: 1000, event: 'purchase' }), 'non-consumable purchase');
  const notificationHash = sha('notification-refund-1001');
  const refundHash = sha('refund-1001');
  const notificationId = '00000000-0000-4000-8000-000000000002';
  const processed = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    ${q(notificationId)}::uuid, 'Production', 'REFUND', NULL, '1001', '1001', 4000, ${q(notificationHash)},
    '1001', '1001', 'paper.paid', 'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 4000, NULL, 4000, 'refund', ${q(refundHash)}) AS x`, 'atomic notification refund');
  if (jsonResult(processed, 'atomic notification refund').transaction_applied !== true) throw new Error('atomic notification did not apply transaction');
  const replay = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    ${q(notificationId)}::uuid, 'Production', 'REFUND', NULL, '1001', '1001', 4000, ${q(notificationHash)},
    '1001', '1001', 'paper.paid', 'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 4000, NULL, 4000, 'refund', ${q(refundHash)}) AS x`, 'atomic notification replay');
  if (jsonResult(replay, 'atomic notification replay').duplicate !== true) throw new Error('notification replay was not duplicate');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification(
    ${q(notificationId)}::uuid, 'Production', 'REFUND', NULL, '1001', '1001', 4000, ${q(sha('notification-conflict'))},
    '1001', '1001', 'paper.paid', 'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 4000, NULL, 4000, 'refund', ${q(refundHash)}) AS x`), 'notification UUID payload conflict');
  const staleNotification = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    '00000000-0000-4000-8000-000000000004', 'Production', 'REFUND', NULL, '1001', '1001', 3500, ${q(sha('notification-stale'))}) AS x`, 'out-of-order notification');
  if (jsonResult(staleNotification, 'out-of-order notification').stale !== true) throw new Error('out-of-order notification was not marked stale');
  expectOk(callApply({ tx: '1001', product: 'paper.paid', hash: sha('purchase-stale'), purchase: 1000, signed: 3000, event: 'purchase' }), 'out-of-order transaction input');
  if (scalar("SELECT last_event_kind FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '1001'", 'stale status') !== 'refund') throw new Error('stale transaction changed latest event');
  expectFail(callApply({ tx: '1001', product: 'paper.paid', hash: sha('refund-conflict'), purchase: 1000, signed: 4000, event: 'refund' }), 'same signedDate different payload conflict');
  expectFail(callApply({ tx: '1001', product: 'paper.paid', type: 'Consumable', hash: sha('type-conflict'), purchase: 1000, signed: 6000, event: 'purchase' }), 'verified Apple product type mismatch');
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
  expectOk(callApply({ tx: '2004', product: 'export.3', hash: sha('purchase-2004'), purchase: 1000, signed: 1000, event: 'purchase' }), 'reconciliation reversal purchase grant');
  const creditsBeforeMissedReversal = Number(actorScalar('authenticated', A, `SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1`, 'credits before missed reversal'));
  expectOk(callApply({ tx: '2004', product: 'export.3', hash: sha('refund-2004'), purchase: 1000, signed: 2000, revoke: 2000, event: 'refund' }), 'reconciliation reversal refund');
  expectOk(callApply({ tx: '2004', product: 'export.3', hash: sha('reconciled-2004'), purchase: 1000, signed: 3000, event: 'purchase' }), 'newer non-revoked reconciliation transaction');
  const implicitReversalReplay = jsonResult(expectOk(callApply({ tx: '2004', product: 'export.3', hash: sha('reconciled-2004'), purchase: 1000, signed: 3000, event: 'purchase' }), 'implicit reversal replay'), 'implicit reversal replay');
  if (implicitReversalReplay.duplicate !== true) {
    throw new Error('replaying the same non-revoked reconciliation payload was not idempotent');
  }
  if (actorScalar('authenticated', A, `SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1`, 'credits after missed reversal recovery') !== String(creditsBeforeMissedReversal)) {
    throw new Error('newer non-revoked reconciliation did not restore the credit reclaimed by the missed refund reversal');
  }
  if (scalar("SELECT last_event_kind FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '2004'", 'missed reversal normalized event') !== 'refund_reversed') {
    throw new Error('newer non-revoked reconciliation was not normalized to refund_reversed');
  }
  if (scalar("SELECT count(*)::text FROM iap_private.export_credit_ledger WHERE environment = 'Production' AND transaction_id = '2004' AND entry_kind = 'refund_reversed_grant'", 'missed reversal restoration evidence') !== '1') {
    throw new Error('missed refund reversal did not retain exact restoration evidence');
  }
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
    ${q(user)}::uuid, 'Production', ${q(tx)}, '4000', 'paper.paid', 'Non-Consumable', 'app.gomsinlog',
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
  if (actorScalar('service_role', null, `SELECT count(*)::text FROM public.iap_list_reconciliation_targets()`, 'live reconciliation targets') !== '5') throw new Error('live reconciliation targets did not include the expected Apple chains');
  if (actorScalar('service_role', null, `SELECT count(*)::text FROM public.iap_list_reconciliation_targets() WHERE environment = 'Xcode'`, 'Xcode reconciliation exclusion') !== '0') throw new Error('Xcode was exposed as an Apple Server API reconciliation target');

  const atomicRollbackId = '00000000-0000-4000-8000-000000000003';
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification(
    ${q(atomicRollbackId)}::uuid, 'Production', 'DID_RENEW', NULL, '3003', '3003', 6000, ${q(sha('n-rollback'))},
    '3003', '3003', 'not-in-catalog', 'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 6000, NULL, NULL, 'purchase', ${q(sha('t-rollback'))}) AS x`), 'atomic process invalid transaction');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_notifications WHERE notification_uuid = ${q(atomicRollbackId)}::uuid`, 'atomic rollback proof') !== '0') throw new Error('failed process partially committed notification claim');

  expectOk(callApply({ environment: 'Sandbox', token: TOKEN_A, tx: '1001', product: 'paper.paid', hash: sha('sandbox-1001'), purchase: 1000, signed: 1000, event: 'purchase' }), 'sandbox/prod identifier separation');
  if (scalar("SELECT count(*)::text FROM iap_private.apple_transactions WHERE transaction_id = '1001'", 'environment separation count') !== '2') throw new Error('sandbox and production ledgers were not separate');

  const pendingReservation = jsonResult(actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 1, '20000000-0000-4000-8000-000000000005'::uuid) AS x`, 'reserve before durable deletion flag'), 'reserve before durable deletion flag');
  const pendingReservationAmount = Number(scalar(`SELECT amount::text FROM iap_private.export_credit_reservations WHERE reservation_id = ${q(pendingReservation.reservation_id)}::uuid`, 'reserved amount before durable deletion flag'));
  expectOk(admin(`UPDATE auth.users SET raw_app_meta_data = '{"account_deletion_pending":true}'::jsonb WHERE id = ${q(A)}::uuid`), 'set durable Auth deletion flag');
  if (scalar(`SELECT count(*)::text FROM public.account_deletion_requests WHERE user_id = ${q(A)}::uuid`, 'no transient deletion marker') !== '0') throw new Error('durable deletion test unexpectedly retained a transient request row');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_prepare_purchase('paper.paid', 'Production')`), 'durable deletion flag blocks purchase prepare');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_get_state('Production')`), 'durable deletion flag blocks state');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_reserve('Production', 1, '20000000-0000-4000-8000-000000000006'::uuid)`), 'durable deletion flag blocks credit reserve');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_commit(${q(pendingReservation.reservation_id)}::uuid)`), 'durable deletion flag blocks credit commit');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_release(${q(pendingReservation.reservation_id)}::uuid)`), 'durable deletion flag blocks credit release');
  expectFail(callApply({ tx: '7001', product: 'paper.paid', hash: sha('pending-delete-7001'), purchase: 7000, signed: 7000, event: 'purchase' }), 'durable deletion flag blocks reconciliation grant');
  if (actorScalar('service_role', null, `SELECT count(*)::text FROM public.iap_list_reconciliation_targets() WHERE user_id = ${q(A)}::uuid`, 'durable deletion reconciliation exclusion') !== '0') throw new Error('durable deletion account remained a reconciliation target');
  const pendingDeletionNotificationId = '00000000-0000-4000-8000-000000000006';
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification(
    ${q(pendingDeletionNotificationId)}::uuid, 'Production', 'DID_RENEW', NULL, '7002', '7002', 7100, ${q(sha('pending-delete-notification'))},
    '7002', '7002', 'paper.paid', 'Non-Consumable', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 7000, 7100, NULL, NULL, 'purchase', ${q(sha('pending-delete-7002'))}) AS x`), 'durable deletion flag blocks notification grant');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_notifications WHERE notification_uuid = ${q(pendingDeletionNotificationId)}::uuid`, 'pending deletion notification rollback') !== '0') throw new Error('pending deletion notification partially committed');

  const before = scalar(`SELECT (SELECT count(*) FROM iap_private.apple_transactions WHERE billing_account_id = ${q(billingAccountId)}::uuid) || '|' || (SELECT count(*) FROM iap_private.apple_notifications) || '|' || (SELECT count(*) FROM iap_private.export_credit_ledger WHERE billing_account_id = ${q(billingAccountId)}::uuid)`, 'deletion evidence before');
  const creditBeforeDeletion = Number(scalar(`SELECT iap_private.credit_balance(${q(billingAccountId)}::uuid, 'Production')::text`, 'credit balance before deletion release'));
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(A)}::uuid, ${q(ATTEMPT_A)}::uuid)`), 'authenticated account deletion prep');
  expectFail(asActor('anon', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(A)}::uuid, ${q(ATTEMPT_A)}::uuid)`), 'anon account deletion prep');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(A)}::uuid, ${q(ATTEMPT_A)}::uuid)`), 'missing-marker account deletion prep');
  expectOk(admin(`INSERT INTO public.account_deletion_requests (user_id, attempt_id, phase)
    VALUES (${q(A)}::uuid, ${q(ATTEMPT_A)}::uuid, 'relationships_closed')`), 'account deletion marker');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(A)}::uuid, ${q(ATTEMPT_A)}::uuid)`), 'premature account deletion prep');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(A)}::uuid, '30000000-0000-4000-8000-000000000099'::uuid)`), 'stale-attempt account deletion prep');
  expectOk(admin(`UPDATE public.account_deletion_requests SET phase = 'solo_cleanup_complete'
    WHERE user_id = ${q(A)}::uuid AND attempt_id = ${q(ATTEMPT_A)}::uuid`), 'complete relational deletion phase');
  expectOk(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(A)}::uuid, ${q(ATTEMPT_A)}::uuid)`), 'service account deletion prep');
  expectOk(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(A)}::uuid, ${q(ATTEMPT_A)}::uuid)`), 'idempotent account deletion prep');
  const after = scalar(`SELECT (SELECT count(*) FROM iap_private.apple_transactions WHERE billing_account_id = ${q(billingAccountId)}::uuid) || '|' || (SELECT count(*) FROM iap_private.apple_notifications) || '|' || (SELECT count(*) FROM iap_private.export_credit_ledger WHERE billing_account_id = ${q(billingAccountId)}::uuid)`, 'deletion evidence after');
  const [beforeTransactions, beforeNotifications, beforeCreditEntries] = before.split('|').map(Number);
  const [afterTransactions, afterNotifications, afterCreditEntries] = after.split('|').map(Number);
  if (beforeTransactions !== afterTransactions || beforeNotifications !== afterNotifications
    || afterCreditEntries !== beforeCreditEntries + 1) {
    throw new Error(`account deletion prep damaged evidence or missed its release entry (${before} -> ${after})`);
  }
  if (Number(scalar(`SELECT iap_private.credit_balance(${q(billingAccountId)}::uuid, 'Production')::text`, 'credit balance after deletion release')) !== creditBeforeDeletion + pendingReservationAmount) {
    throw new Error('account deletion did not balance the released reservation in the audit ledger');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_ledger WHERE reservation_id = ${q(pendingReservation.reservation_id)}::uuid AND entry_kind = 'account_deletion'`, 'account deletion release evidence') !== '1') throw new Error('account deletion release was not recorded exactly once');
  if (scalar(`SELECT (user_id IS NULL)::text || '|' || (app_account_token IS NULL)::text || '|' || length(app_account_token_hash)::text FROM iap_private.apple_account_bindings WHERE billing_account_id = ${q(billingAccountId)}::uuid`, 'raw token/user tombstone') !== 'true|true|64') throw new Error('account deletion prep did not tombstone the user/raw token while preserving the hash');
  expectOk(admin(`DELETE FROM auth.users WHERE id = ${q(A)}::uuid`), 'auth delete after billing tombstone');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_transactions WHERE billing_account_id = ${q(billingAccountId)}::uuid`, 'retained ledger after auth delete') !== '8') throw new Error('auth user deletion removed billing-account transaction evidence');
  const deletedNotification = actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    '00000000-0000-4000-8000-000000000005', 'Production', 'REFUND', NULL, '2002', '2002', 7000, ${q(sha('deleted-notification'))},
    '2002', '2002', 'export.3', 'Consumable', 'app.gomsinlog', ${q(tokenHash(boundToken))}, 1000, 7000, NULL, 7000, 'refund', ${q(sha('deleted-refund'))}) AS x`, 'post-deletion notification');
  if (jsonResult(deletedNotification, 'post-deletion notification').transaction_applied !== false) throw new Error('post-deletion notification re-granted a tombstoned account');
  if (scalar("SELECT status FROM iap_private.apple_notifications WHERE notification_uuid = '00000000-0000-4000-8000-000000000005'", 'post-deletion notification status') !== 'processed') throw new Error('post-deletion notification was not retained as processed evidence');
  if (actorScalar('service_role', null, `SELECT count(*)::text FROM public.iap_list_reconciliation_targets()`, 'tombstoned reconciliation exclusion') !== '0') throw new Error('tombstoned account remained an automatic reconciliation target');
  expectFail(asActor('authenticated', A, "SELECT * FROM public.iap_get_state('Production')"), 'deleted account state access');
  expectFail(asActor('authenticated', A, `SELECT * FROM public.iap_export_credit_reserve('Production', 1, '20000000-0000-4000-8000-000000000003')`), 'deleted account credit reserve');

  if (scalar("SELECT count(*)::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'iap_private' AND a.attname ~* '(^|_)(raw|jws)(_|$)' AND NOT a.attisdropped", 'raw JWS column proof') !== '0') throw new Error('raw JWS-looking column exists');
  if (scalar("SELECT count(*)::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'iap_private' AND c.relname IN ('apple_transactions','entitlements','export_credit_ledger','export_credit_reservations') AND a.attname = 'user_id' AND NOT a.attisdropped", 'retained raw user id proof') !== '0') throw new Error('retained IAP ledger still has a raw user_id column');
  if (scalar("SELECT count(*)::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'iap_private' AND c.relname IN ('apple_transactions','entitlements','export_credit_ledger','export_credit_reservations') AND a.attname = 'billing_account_id' AND NOT a.attisdropped", 'billing account linkage proof') !== '4') throw new Error('retained IAP ledgers are not all billing-account linked');
  if (scalar("SELECT count(*)::text FROM pg_constraint WHERE conrelid = 'iap_private.apple_account_bindings'::regclass AND confrelid = 'auth.users'::regclass AND confdeltype = 'n'", 'auth user FK policy') !== '1') throw new Error('billing binding is missing ON DELETE SET NULL auth user FK');
  if (scalar("SELECT pg_get_function_result(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'iap_prepare_account_deletion_v2'", 'account deletion return contract').includes('user_id')) throw new Error('account deletion prep still returns raw user_id');
  if (scalar("SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'iap_prepare_purchase'", 'server-token RPC signature') !== 'p_product_id text, p_environment text') throw new Error('prepare RPC still accepts client token/bundle inputs');
  if (scalar("SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'iap_list_reconciliation_targets'", 'reconciliation target signature') !== '') throw new Error('reconciliation target RPC unexpectedly accepts client-selected inputs');
  if (scalar("SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('iap_prepare_purchase','iap_get_state','iap_claim_notification','iap_apply_verified_transaction','iap_process_verified_notification','iap_export_credit_reserve','iap_export_credit_commit','iap_export_credit_release','iap_prepare_account_deletion_v2','iap_list_reconciliation_targets') AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']", 'definer/search_path contract') !== '10') throw new Error('typed RPC security-definer/search_path contract incomplete');

  console.log(`PASS — Apple IAP ledger PostgreSQL actor harness: ${checks} assertions`);
  console.log('UNVERIFIED — remote Supabase catalog/migration state, Edge deployment, Apple verification keys, Sandbox/Production servers, and device/App Store behavior.');
} catch (error) {
  console.error(`FAIL — Apple IAP ledger harness after ${checks} assertions: ${error.message}`);
  process.exitCode = 1;
}
