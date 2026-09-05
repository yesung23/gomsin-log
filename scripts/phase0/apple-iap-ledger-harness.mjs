#!/usr/bin/env node
/**
 * Focused PostgreSQL actor proof for migrations 077, 079, 081, and 082.
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
const REFUND_MIGRATION = join(ROOT, 'supabase/migrations/079_apple_iap_refund_consumption.sql');
const CONTRACT_MIGRATION = join(ROOT, 'supabase/migrations/081_retire_apple_iap_v1_entrypoints.sql');
const FORWARD_FIX_MIGRATION = join(ROOT, 'supabase/migrations/082_apple_iap_refund_reconciliation_forward_fix.sql');
const keep = process.argv.includes('--keep');
const env = { ...process.env, LC_ALL: 'C', LANG: 'C', LC_MESSAGES: 'C' };
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const E = '00000000-0000-4000-8000-00000000000e';
const F = '00000000-0000-4000-8000-00000000000f';
const TOKEN_A = '10000000-0000-4000-8000-00000000000a';
const TOKEN_B = '10000000-0000-4000-8000-00000000000b';
const TOKEN_D = '10000000-0000-4000-8000-00000000000d';
const TOKEN_E = '10000000-0000-4000-8000-00000000000e';
const TOKEN_F = '10000000-0000-4000-8000-00000000000f';
const ATTEMPT_A = '30000000-0000-4000-8000-00000000000a';
const ATTEMPT_B = '30000000-0000-4000-8000-00000000000b';
const ATTEMPT_C = '30000000-0000-4000-8000-00000000000c';
const ATTEMPT_D = '30000000-0000-4000-8000-00000000000d';
const ATTEMPT_F = '30000000-0000-4000-8000-00000000000f';
const OPERATOR_ACTOR = '60000000-0000-4000-8000-000000000001';
const REVIEW_OPERATION = '70000000-0000-4000-8000-000000000001';
let boundToken = TOKEN_A;
let checks = 0;

function have(binary) {
  return spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;
}

if (!existsSync(MIGRATION)) {
  console.error('BLOCKED — migration 077 is not present.');
  process.exit(2);
}
if (!existsSync(REFUND_MIGRATION)) {
  console.error('BLOCKED — migration 079 is not present.');
  process.exit(2);
}
if (!existsSync(CONTRACT_MIGRATION)) {
  console.error('BLOCKED — migration 081 is not present.');
  process.exit(2);
}
if (!existsSync(FORWARD_FIX_MIGRATION)) {
  console.error('BLOCKED — migration 082 is not present.');
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

  // The ledger is an accounting evidence table, so every row family must be
  // structurally unambiguous even for owner-level inserts. These probes use
  // unique identities so a failure cannot be accidentally supplied by an
  // unrelated uniqueness collision.
  const ledgerProbeReservationA = '90000000-0000-4000-8000-000000000001';
  const ledgerProbeReservationB = '90000000-0000-4000-8000-000000000002';
  let ledgerProbeTransaction = 990000;
  const ledgerInsert = ({
    entryKind,
    amount,
    transactionId = null,
    eventMillis = null,
    reservationId = null,
  }) => admin(`
    INSERT INTO iap_private.export_credit_ledger (
      billing_account_id, environment, transaction_id, event_signed_at,
      reservation_id, entry_kind, amount
    ) VALUES (
      ${q(billingAccountId)}::uuid,
      'Production',
      ${transactionId === null ? 'NULL' : `${q(transactionId)}::text`},
      ${eventMillis === null ? 'NULL' : `to_timestamp(${eventMillis} / 1000.0)`},
      ${reservationId === null ? 'NULL' : `${q(reservationId)}::uuid`},
      ${q(entryKind)},
      ${amount}::bigint
    )
  `);
  const nextLedgerTransaction = () => String(ledgerProbeTransaction++);
  const malformedLedgerRows = [
    ['purchase_grant rejects missing transaction and event', { entryKind: 'purchase_grant', amount: 1 }],
    ['purchase_grant rejects missing event', { entryKind: 'purchase_grant', amount: 1, transactionId: nextLedgerTransaction() }],
    ['purchase_grant rejects missing transaction', { entryKind: 'purchase_grant', amount: 1, eventMillis: 1000 }],
    ['purchase_grant rejects reservation identity', { entryKind: 'purchase_grant', amount: 1, transactionId: nextLedgerTransaction(), eventMillis: 1000, reservationId: ledgerProbeReservationA }],
    ['purchase_grant rejects zero amount', { entryKind: 'purchase_grant', amount: 0, transactionId: nextLedgerTransaction(), eventMillis: 1000 }],
    ['purchase_grant rejects negative amount', { entryKind: 'purchase_grant', amount: -1, transactionId: nextLedgerTransaction(), eventMillis: 1000 }],

    ['refund_reclaim rejects missing transaction and event', { entryKind: 'refund_reclaim', amount: -1 }],
    ['refund_reclaim rejects missing event', { entryKind: 'refund_reclaim', amount: -1, transactionId: nextLedgerTransaction() }],
    ['refund_reclaim rejects missing transaction', { entryKind: 'refund_reclaim', amount: -1, eventMillis: 2000 }],
    ['refund_reclaim rejects reservation identity', { entryKind: 'refund_reclaim', amount: -1, transactionId: nextLedgerTransaction(), eventMillis: 2000, reservationId: ledgerProbeReservationA }],
    ['refund_reclaim rejects zero amount', { entryKind: 'refund_reclaim', amount: 0, transactionId: nextLedgerTransaction(), eventMillis: 2000 }],
    ['refund_reclaim rejects positive amount', { entryKind: 'refund_reclaim', amount: 1, transactionId: nextLedgerTransaction(), eventMillis: 2000 }],

    ['refund_reversed_grant rejects missing transaction and event', { entryKind: 'refund_reversed_grant', amount: 1 }],
    ['refund_reversed_grant rejects missing event', { entryKind: 'refund_reversed_grant', amount: 1, transactionId: nextLedgerTransaction() }],
    ['refund_reversed_grant rejects missing transaction', { entryKind: 'refund_reversed_grant', amount: 1, eventMillis: 3000 }],
    ['refund_reversed_grant rejects reservation identity', { entryKind: 'refund_reversed_grant', amount: 1, transactionId: nextLedgerTransaction(), eventMillis: 3000, reservationId: ledgerProbeReservationA }],
    ['refund_reversed_grant rejects zero amount', { entryKind: 'refund_reversed_grant', amount: 0, transactionId: nextLedgerTransaction(), eventMillis: 3000 }],
    ['refund_reversed_grant rejects negative amount', { entryKind: 'refund_reversed_grant', amount: -1, transactionId: nextLedgerTransaction(), eventMillis: 3000 }],

    ['reserve rejects missing reservation', { entryKind: 'reserve', amount: -1 }],
    ['reserve rejects transaction identity', { entryKind: 'reserve', amount: -1, transactionId: nextLedgerTransaction(), eventMillis: 4000, reservationId: ledgerProbeReservationA }],
    ['reserve rejects zero amount', { entryKind: 'reserve', amount: 0, reservationId: ledgerProbeReservationA }],
    ['reserve rejects positive amount', { entryKind: 'reserve', amount: 1, reservationId: ledgerProbeReservationA }],

    ['commit rejects missing reservation', { entryKind: 'commit', amount: 0 }],
    ['commit rejects transaction identity', { entryKind: 'commit', amount: 0, transactionId: nextLedgerTransaction(), eventMillis: 5000, reservationId: ledgerProbeReservationA }],
    ['commit rejects positive amount', { entryKind: 'commit', amount: 1, reservationId: ledgerProbeReservationA }],
    ['commit rejects negative amount', { entryKind: 'commit', amount: -1, reservationId: ledgerProbeReservationA }],

    ['release rejects missing reservation', { entryKind: 'release', amount: 1 }],
    ['release rejects transaction identity', { entryKind: 'release', amount: 1, transactionId: nextLedgerTransaction(), eventMillis: 6000, reservationId: ledgerProbeReservationA }],
    ['release rejects zero amount', { entryKind: 'release', amount: 0, reservationId: ledgerProbeReservationA }],
    ['release rejects negative amount', { entryKind: 'release', amount: -1, reservationId: ledgerProbeReservationA }],

    ['account_deletion rejects missing reservation', { entryKind: 'account_deletion', amount: 1 }],
    ['account_deletion rejects transaction identity', { entryKind: 'account_deletion', amount: 1, transactionId: nextLedgerTransaction(), eventMillis: 7000, reservationId: ledgerProbeReservationA }],
    ['account_deletion rejects zero amount', { entryKind: 'account_deletion', amount: 0, reservationId: ledgerProbeReservationA }],
    ['account_deletion rejects negative amount', { entryKind: 'account_deletion', amount: -1, reservationId: ledgerProbeReservationA }],

    ['refund_forced_release rejects missing transaction and event', { entryKind: 'refund_forced_release', amount: 1, reservationId: ledgerProbeReservationA }],
    ['refund_forced_release rejects missing event', { entryKind: 'refund_forced_release', amount: 1, transactionId: nextLedgerTransaction(), reservationId: ledgerProbeReservationA }],
    ['refund_forced_release rejects missing transaction', { entryKind: 'refund_forced_release', amount: 1, eventMillis: 8000, reservationId: ledgerProbeReservationA }],
    ['refund_forced_release rejects missing reservation', { entryKind: 'refund_forced_release', amount: 1, transactionId: nextLedgerTransaction(), eventMillis: 8000 }],
    ['refund_forced_release rejects zero amount', { entryKind: 'refund_forced_release', amount: 0, transactionId: nextLedgerTransaction(), eventMillis: 8000, reservationId: ledgerProbeReservationA }],
    ['refund_forced_release rejects negative amount', { entryKind: 'refund_forced_release', amount: -1, transactionId: nextLedgerTransaction(), eventMillis: 8000, reservationId: ledgerProbeReservationA }],

    ['revoke_forced_release rejects missing transaction and event', { entryKind: 'revoke_forced_release', amount: 1, reservationId: ledgerProbeReservationA }],
    ['revoke_forced_release rejects missing event', { entryKind: 'revoke_forced_release', amount: 1, transactionId: nextLedgerTransaction(), reservationId: ledgerProbeReservationA }],
    ['revoke_forced_release rejects missing transaction', { entryKind: 'revoke_forced_release', amount: 1, eventMillis: 9000, reservationId: ledgerProbeReservationA }],
    ['revoke_forced_release rejects missing reservation', { entryKind: 'revoke_forced_release', amount: 1, transactionId: nextLedgerTransaction(), eventMillis: 9000 }],
    ['revoke_forced_release rejects zero amount', { entryKind: 'revoke_forced_release', amount: 0, transactionId: nextLedgerTransaction(), eventMillis: 9000, reservationId: ledgerProbeReservationA }],
    ['revoke_forced_release rejects negative amount', { entryKind: 'revoke_forced_release', amount: -1, transactionId: nextLedgerTransaction(), eventMillis: 9000, reservationId: ledgerProbeReservationA }],
  ];
  for (const [label, row] of malformedLedgerRows) {
    expectFail(ledgerInsert(row), label);
  }

  const normalUniquenessTransaction = nextLedgerTransaction();
  expectOk(ledgerInsert({
    entryKind: 'purchase_grant',
    amount: 1,
    transactionId: normalUniquenessTransaction,
    eventMillis: 10000,
  }), 'normal transaction-event uniqueness fixture');
  expectFail(ledgerInsert({
    entryKind: 'purchase_grant',
    amount: 1,
    transactionId: normalUniquenessTransaction,
    eventMillis: 10000,
  }), 'normal transaction-event exact duplicate');
  expectFail(ledgerInsert({
    entryKind: 'purchase_grant',
    amount: 1,
    transactionId: normalUniquenessTransaction,
    eventMillis: 10000,
    reservationId: ledgerProbeReservationA,
  }), 'normal transaction-event duplicate with changed reservation');
  expectOk(admin(`DELETE FROM iap_private.export_credit_ledger
    WHERE environment = 'Production' AND transaction_id = ${q(normalUniquenessTransaction)}`), 'normal uniqueness probe cleanup');

  const forcedUniquenessTransaction = nextLedgerTransaction();
  expectOk(admin(`
    INSERT INTO iap_private.export_credit_ledger (
      billing_account_id, environment, transaction_id, event_signed_at,
      reservation_id, entry_kind, amount
    ) VALUES
      (${q(billingAccountId)}::uuid, 'Production', ${q(forcedUniquenessTransaction)}, to_timestamp(11), ${q(ledgerProbeReservationA)}::uuid, 'refund_forced_release', 1),
      (${q(billingAccountId)}::uuid, 'Production', ${q(forcedUniquenessTransaction)}, to_timestamp(11), ${q(ledgerProbeReservationB)}::uuid, 'refund_forced_release', 2)
  `), 'distinct forced releases for one transaction event');
  expectFail(ledgerInsert({
    entryKind: 'refund_forced_release',
    amount: 1,
    transactionId: forcedUniquenessTransaction,
    eventMillis: 11000,
    reservationId: ledgerProbeReservationA,
  }), 'duplicate forced release for the same reservation and kind');
  expectOk(admin(`DELETE FROM iap_private.export_credit_ledger
    WHERE environment = 'Production' AND transaction_id = ${q(forcedUniquenessTransaction)}`), 'forced uniqueness probe cleanup');

  expectOk(asActor('authenticated', A, `SELECT * FROM public.iap_get_state('Production')`), 'authenticated state RPC');

  // Regression: a refund must reclaim a credit currently held by an open
  // reservation. Otherwise a later ordinary release resurrects refunded value.
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2010', product: 'app.gomsinlog.book.export.credit.1', hash: sha('purchase-2010'), purchase: 1000, signed: 1000, event: 'purchase' }), 'reservation refund regression grant');
  const refundHeldReservation = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 1, '20000000-0000-4000-8000-000000000010'::uuid) AS x`, 'reservation refund regression reserve'), 'reservation refund regression reserve');
  const refund2010NotificationId = '00000000-0000-4000-8000-000000000010';
  const refund2010NotificationHash = sha('notification-refund-2010');
  const processRefund2010 = (notificationHash = refund2010NotificationHash) => asActor('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    ${q(refund2010NotificationId)}::uuid, 'Production', 'REFUND', NULL, '2010', '2010', 2000, ${q(notificationHash)},
    '2010', '2010', 'app.gomsinlog.book.export.credit.1', 'Consumable', 'app.gomsinlog', ${q(tokenHash(otherAccountToken))}, 1000, 2000, NULL, 2000, 'refund', ${q(sha('refund-2010'))}) AS x`);
  const refund2010 = jsonResult(expectOk(processRefund2010(), 'reservation refund notification reclaim'), 'reservation refund notification reclaim');
  if (refund2010.transaction_applied !== true) throw new Error('reservation refund notification did not apply its transaction');
  if (scalar(`SELECT status || '|' || amount::text FROM iap_private.export_credit_reservations WHERE reservation_id = ${q(refundHeldReservation.reservation_id)}::uuid`, 'forced refund reservation state') !== 'released|1') {
    throw new Error('refund did not whole-release the open reservation');
  }
  if (scalar(`SELECT entry_kind || '|' || amount::text || '|' || (transaction_id = '2010')::text || '|' || (event_signed_at = to_timestamp(2))::text FROM iap_private.export_credit_ledger WHERE reservation_id = ${q(refundHeldReservation.reservation_id)}::uuid AND entry_kind = 'refund_forced_release'`, 'forced refund ledger evidence') !== 'refund_forced_release|1|true|true') {
    throw new Error('refund forced release is missing transaction/reservation/event evidence');
  }
  expectFail(asActor('authenticated', B, `SELECT * FROM public.iap_export_credit_commit(${q(refundHeldReservation.reservation_id)}::uuid)`), 'commit after forced refund release');
  const ordinaryReleaseAfterRefund = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_export_credit_release(${q(refundHeldReservation.reservation_id)}::uuid) AS x`, 'ordinary release after forced refund release'), 'ordinary release after forced refund release');
  if (ordinaryReleaseAfterRefund.duplicate !== true || ordinaryReleaseAfterRefund.export_credits !== 0) {
    throw new Error('ordinary release resurrected a credit after its transaction was refunded');
  }

  const refund2010Replay = jsonResult(expectOk(processRefund2010(), 'forced refund notification replay'), 'forced refund notification replay');
  if (refund2010Replay.duplicate !== true) throw new Error('forced refund replay was not idempotent');
  const stale2010 = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification(
    '00000000-0000-4000-8000-000000000011', 'Production', 'REFUND', NULL, '2010', '2010', 1500, ${q(sha('notification-stale-2010'))}) AS x`, 'forced refund stale notification'), 'forced refund stale notification');
  if (stale2010.stale !== true) throw new Error('forced refund stale event was not rejected as stale');
  expectFail(processRefund2010(sha('notification-conflict-2010')), 'forced refund notification conflict');
  if (scalar("SELECT count(*)::text FROM iap_private.export_credit_ledger WHERE environment = 'Production' AND transaction_id = '2010' AND entry_kind IN ('refund_forced_release', 'refund_reclaim')", 'forced refund idempotent ledger count') !== '2') {
    throw new Error('duplicate, stale, or conflicting refund changed the ledger');
  }

  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2010', product: 'app.gomsinlog.book.export.credit.1', hash: sha('reverse-2010'), purchase: 1000, signed: 3000, event: 'refund_reversed' }), 'forced refund reversal');
  if (actorScalar('authenticated', B, `SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1`, 'forced refund reversal balance') !== '1') {
    throw new Error('refund reversal did not restore exactly the reclaimed amount');
  }
  if (scalar(`SELECT status FROM iap_private.export_credit_reservations WHERE reservation_id = ${q(refundHeldReservation.reservation_id)}::uuid`, 'forced refund reversal reservation state') !== 'released') {
    throw new Error('refund reversal reopened a forced-released reservation');
  }
  if (scalar("SELECT amount::text FROM iap_private.export_credit_ledger WHERE environment = 'Production' AND transaction_id = '2010' AND entry_kind = 'refund_reversed_grant'", 'forced refund reversal evidence') !== '1') {
    throw new Error('refund reversal restored more or less than the amount reclaimed');
  }
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2010', product: 'app.gomsinlog.book.export.credit.1', hash: sha('refund-again-2010'), purchase: 1000, signed: 4000, revoke: 4000, event: 'refund' }), 'later legitimate refund after reversal');
  if (scalar("SELECT count(*)::text || '|' || count(DISTINCT event_signed_at)::text FROM iap_private.export_credit_ledger WHERE environment = 'Production' AND transaction_id = '2010' AND entry_kind = 'refund_reclaim'", 'repeated refund event-time uniqueness') !== '2|2') {
    throw new Error('signed event time did not preserve the later legitimate refund');
  }
  if (actorScalar('authenticated', B, `SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1`, 'later refund balance') !== '0') {
    throw new Error('later legitimate refund did not reclaim its transaction credit');
  }

  // A refund with sufficient immediately available value must not disturb an
  // unrelated reservation. A later deficit releases only whole reservations,
  // newest first, and may overshoot without partially shrinking one.
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2011', product: 'export.3', hash: sha('purchase-2011'), purchase: 5000, signed: 5000, event: 'purchase' }), 'sufficient-balance grant one');
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2012', product: 'export.3', hash: sha('purchase-2012'), purchase: 5100, signed: 5100, event: 'purchase' }), 'sufficient-balance grant two');
  const unrelatedReservation = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 1, '20000000-0000-4000-8000-000000000011'::uuid) AS x`, 'unrelated open reservation'), 'unrelated open reservation');
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2011', product: 'export.3', hash: sha('refund-2011'), purchase: 5000, signed: 6000, revoke: 6000, event: 'refund' }), 'sufficient-balance refund');
  if (scalar(`SELECT status FROM iap_private.export_credit_reservations WHERE reservation_id = ${q(unrelatedReservation.reservation_id)}::uuid`, 'unrelated reservation after sufficient refund') !== 'reserved') {
    throw new Error('sufficient balance refund touched an unrelated reservation');
  }

  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2013', product: 'export.3', hash: sha('purchase-2013'), purchase: 6100, signed: 6100, event: 'purchase' }), 'oversized-reservation grant');
  const olderRefundReservation = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 3, '20000000-0000-4000-8000-000000000012'::uuid) AS x`, 'older refund reservation'), 'older refund reservation');
  const newestRefundReservation = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Production', 2, '20000000-0000-4000-8000-000000000015'::uuid) AS x`, 'newest refund reservation'), 'newest refund reservation');
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2013', product: 'export.3', hash: sha('refund-2013'), purchase: 6100, signed: 7000, revoke: 7000, event: 'refund' }), 'oversized-reservation refund');
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_reservations WHERE reservation_id IN (${q(olderRefundReservation.reservation_id)}::uuid, ${q(newestRefundReservation.reservation_id)}::uuid) AND status = 'released'`, 'multiple whole reservation releases') !== '2') {
    throw new Error('refund did not whole-release each required reservation');
  }
  if (scalar("SELECT count(*)::text || '|' || sum(amount)::text FROM iap_private.export_credit_ledger WHERE environment = 'Production' AND transaction_id = '2013' AND entry_kind = 'refund_forced_release'", 'multiple forced-release evidence') !== '2|5') {
    throw new Error('refund did not retain evidence for every whole reservation release');
  }
  if (scalar(`SELECT status FROM iap_private.export_credit_reservations WHERE reservation_id = ${q(unrelatedReservation.reservation_id)}::uuid`, 'older reservation stop boundary') !== 'reserved') {
    throw new Error('refund released reservations after enough units were available');
  }

  // Same-account rows in another environment and another user's rows must not
  // be candidates for a Production refund/revoke release.
  expectOk(callApply({ user: B, environment: 'Sandbox', token: otherAccountToken, tx: '2014', product: 'app.gomsinlog.book.export.credit.1', hash: sha('purchase-2014-sandbox'), purchase: 7100, signed: 7100, event: 'purchase' }), 'environment-isolation grant');
  const sandboxReservation = jsonResult(actorScalar('authenticated', B, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Sandbox', 1, '20000000-0000-4000-8000-000000000013'::uuid) AS x`, 'environment-isolation reservation'), 'environment-isolation reservation');
  expectOk(callApply({ environment: 'Xcode', tx: '9010', product: 'app.gomsinlog.book.export.credit.1', hash: sha('purchase-9010'), purchase: 7100, signed: 7100, event: 'purchase' }), 'user-isolation grant');
  const otherUserReservation = jsonResult(actorScalar('authenticated', A, `SELECT row_to_json(x) FROM public.iap_export_credit_reserve('Xcode', 1, '20000000-0000-4000-8000-000000000014'::uuid) AS x`, 'user-isolation reservation'), 'user-isolation reservation');
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2012', product: 'export.3', hash: sha('revoke-2012'), purchase: 5100, signed: 8000, revoke: 8000, event: 'revoke' }), 'forced revoke release');
  if (scalar(`SELECT entry_kind FROM iap_private.export_credit_ledger WHERE transaction_id = '2012' AND reservation_id = ${q(unrelatedReservation.reservation_id)}::uuid`, 'forced revoke evidence') !== 'revoke_forced_release') {
    throw new Error('forced release did not distinguish revoke from refund');
  }
  if (scalar(`SELECT status FROM iap_private.export_credit_reservations WHERE reservation_id IN (${q(sandboxReservation.reservation_id)}::uuid, ${q(otherUserReservation.reservation_id)}::uuid) ORDER BY reservation_id LIMIT 1`, 'isolated reservation first state') !== 'reserved'
      || scalar(`SELECT count(*)::text FROM iap_private.export_credit_reservations WHERE reservation_id IN (${q(sandboxReservation.reservation_id)}::uuid, ${q(otherUserReservation.reservation_id)}::uuid) AND status = 'reserved'`, 'isolated reservation count') !== '2') {
    throw new Error('forced release crossed user or environment boundaries');
  }
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2012', product: 'export.3', hash: sha('refund-after-revoke-2012'), purchase: 5100, signed: 9000, revoke: 9000, event: 'refund' }), 'refund after revoke without active reclaim');
  expectOk(callApply({ user: B, token: otherAccountToken, tx: '2012', product: 'export.3', hash: sha('reverse-zero-refund-2012'), purchase: 5100, signed: 10000, event: 'refund_reversed' }), 'zero-reclaim refund reversal');
  if (actorScalar('authenticated', B, `SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1`, 'zero-reclaim refund reversal balance') !== '0') {
    throw new Error('refund reversal restored value reclaimed by an earlier revoke');
  }
  expectOk(callApply({ environment: 'Xcode', tx: '9010', product: 'app.gomsinlog.book.export.credit.1', hash: sha('refund-9010'), purchase: 7100, signed: 8100, revoke: 8100, event: 'refund' }), 'account-deletion forced-release fixture');
  if (scalar(`SELECT status FROM iap_private.export_credit_reservations WHERE reservation_id = ${q(otherUserReservation.reservation_id)}::uuid`, 'account-deletion forced-release fixture state') !== 'released') {
    throw new Error('account-deletion fixture was not force-released by its refund');
  }

  expectOk(admin(`
    DELETE FROM iap_private.export_credit_ledger
    WHERE billing_account_id = (SELECT billing_account_id FROM iap_private.apple_account_bindings WHERE user_id = ${q(B)}::uuid);
    DELETE FROM iap_private.export_credit_reservations
    WHERE billing_account_id = (SELECT billing_account_id FROM iap_private.apple_account_bindings WHERE user_id = ${q(B)}::uuid);
    DELETE FROM iap_private.apple_transactions
    WHERE billing_account_id = (SELECT billing_account_id FROM iap_private.apple_account_bindings WHERE user_id = ${q(B)}::uuid);
  `), 'reservation refund regression cleanup');

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
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_ledger WHERE reservation_id = ${q(otherUserReservation.reservation_id)}::uuid AND entry_kind = 'account_deletion'`, 'forced release account deletion evidence') !== '0') throw new Error('account deletion double-released a refund-forced reservation');
  if (scalar(`SELECT (user_id IS NULL)::text || '|' || (app_account_token IS NULL)::text || '|' || length(app_account_token_hash)::text FROM iap_private.apple_account_bindings WHERE billing_account_id = ${q(billingAccountId)}::uuid`, 'raw token/user tombstone') !== 'true|true|64') throw new Error('account deletion prep did not tombstone the user/raw token while preserving the hash');
  expectOk(admin(`DELETE FROM auth.users WHERE id = ${q(A)}::uuid`), 'auth delete after billing tombstone');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_transactions WHERE billing_account_id = ${q(billingAccountId)}::uuid`, 'retained ledger after auth delete') !== String(beforeTransactions)) throw new Error('auth user deletion removed billing-account transaction evidence');
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

  // Migration 079 is an upgrade proof, not a greenfield schema test. All 077
  // rows above deliberately exist before the additive migration is applied.
  expectOk(psql(['-f', REFUND_MIGRATION]), 'apply migration 079');
  const expandV1Privileges = scalar(`SELECT
    has_function_privilege(
      'service_role',
      'public.iap_apply_verified_transaction(uuid,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,uuid,uuid)',
      'EXECUTE'
    )::text || '|' || has_function_privilege(
      'service_role',
      'public.iap_process_verified_notification(uuid,text,text,text,text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text)',
      'EXECUTE'
    )::text`, 'migration 079 expand V1 service-role compatibility');
  if (expandV1Privileges !== 'true|true') {
    throw new Error(`migration 079 retired V1 before Edge deploy/canary (${expandV1Privileges})`);
  }
  if (scalar(`SELECT count(*)::text FROM pg_attribute AS attribute
      WHERE attribute.attrelid = 'iap_private.apple_consumption_requests'::regclass
        AND attribute.attname = 'consumption_request_reason'
        AND NOT attribute.attisdropped`, '079 consumption reason evidence') !== '1') {
    throw new Error('migration 079 history was rewritten instead of preserved');
  }
  expectOk(admin(`
    INSERT INTO auth.users (id) VALUES (${q(E)}::uuid), (${q(F)}::uuid);
    INSERT INTO iap_private.apple_account_bindings
      (user_id, app_account_token, app_account_token_hash)
    VALUES
      (${q(E)}::uuid, ${q(TOKEN_E)}::uuid, ${q(tokenHash(TOKEN_E))}),
      (${q(F)}::uuid, ${q(TOKEN_F)}::uuid, ${q(tokenHash(TOKEN_F))});
  `), 'migration 079 exact-ledger account fixture');
  const billingAccountE = scalar(`SELECT billing_account_id::text
    FROM iap_private.apple_account_bindings WHERE user_id = ${q(E)}::uuid`, 'migration 079 billing account');
  const callApplyV2 = ({
    user = E,
    token = TOKEN_E,
    tx,
    original = tx,
    product = 'app.gomsinlog.book.export.credit.1',
    type = appleType(product),
    environment = 'Production',
    purchase = 10_000,
    signed = purchase,
    expires = null,
    revoke = null,
    event = 'purchase',
    hash = sha(`${event}-${tx}-${signed}`),
    quantity = 1,
    revocationType = null,
    revocationPercentage = null,
  }) => asActor('service_role', null, `SELECT row_to_json(x) FROM public.iap_apply_verified_transaction_v2(
    ${q(user)}::uuid, ${q(environment)}, ${q(tx)}, ${q(original)}, ${q(product)}, ${q(type)},
    'app.gomsinlog', ${q(tokenHash(token))}, ${purchase}::bigint, ${signed}::bigint,
    ${expires === null ? 'NULL' : `${expires}::bigint`}, ${revoke === null ? 'NULL' : `${revoke}::bigint`},
    ${q(event)}, ${q(hash)}, ${quantity}::integer,
    ${revocationType === null ? 'NULL' : q(revocationType)},
    ${revocationPercentage === null ? 'NULL' : `${revocationPercentage}::integer`}
  ) AS x`);
  const processConsumption = ({
    notificationId,
    notificationHash,
    token = TOKEN_E,
    tx = '8101',
    original = tx,
    product = 'app.gomsinlog.book.export.credit.1',
    type = appleType(product),
    bundle = 'app.gomsinlog',
    purchase = 10_000,
    signed = 20_000,
    reason = 'FULFILLMENT_ISSUE',
    environment = 'Production',
    receivedAtSql = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint',
  }) => asActor('service_role', null, `SELECT row_to_json(x) FROM public.iap_process_verified_notification_v2(
    ${q(notificationId)}::uuid, ${q(environment)}, 'CONSUMPTION_REQUEST', NULL,
    ${q(tx)}, ${q(original)}, ${signed}::bigint, ${q(notificationHash)}, ${receivedAtSql}, ${q(reason)},
    ${q(tx)}, ${q(original)}, ${q(product)}, ${q(type)},
    ${q(bundle)}, ${q(tokenHash(token))}, ${purchase}::bigint, ${signed}::bigint,
    NULL, NULL, NULL, ${q(sha(`consumption-transaction-${tx}-${signed}`))},
    1::integer, NULL, NULL
  ) AS x`);
  const processVerifiedNotification = ({
    notificationId,
    notificationType,
    tx,
    original = tx,
    product = 'paper.paid',
    type = appleType(product),
    bundle = 'app.gomsinlog',
    purchase,
    signed,
    event,
    revoke = signed,
    revocationType,
    revocationPercentage = 100_000,
    token = null,
  }) => asActor('service_role', null, `SELECT row_to_json(x)
    FROM public.iap_process_verified_notification_v2(
      ${q(notificationId)}::uuid, 'Production', ${q(notificationType)}, NULL,
      ${q(tx)}, ${q(original)}, ${signed}::bigint,
      ${q(sha(`tokenless-notification-${notificationId}`))},
      floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint, NULL,
      ${q(tx)}, ${q(original)}, ${q(product)}, ${q(type)}, ${q(bundle)},
      ${token === null ? 'NULL' : q(tokenHash(token))},
      ${purchase}::bigint, ${signed}::bigint, NULL, ${revoke}::bigint,
      ${q(event)}, ${q(sha(`tokenless-transaction-${notificationId}`))},
      1::integer, ${revocationType === null ? 'NULL' : q(revocationType)},
      ${revocationPercentage === null ? 'NULL' : `${revocationPercentage}::integer`}
    ) AS x`);
  const recordDelivery = ({
    tx,
    eventKind = 'delivery_confirmed',
    units = 0,
    status = 'DELIVERED',
    sample = false,
    entity = `fulfilled-${tx}`,
    idempotency = `fulfilled-${tx}`,
    environment = 'Production',
  }) => asActor('service_role', null, `SELECT row_to_json(x)
    FROM public.iap_record_fulfillment_usage_evidence(
      ${q(environment)}, ${q(tx)}, ${q(eventKind)}, ${units}::bigint, ${q(status)},
      ${sample ? 'TRUE' : 'FALSE'}, ${q(sha(entity))}, ${q(sha(idempotency))}
    ) AS x`);
  const authorizeConsumption = (claim) => actorScalar('service_role', null, `SELECT row_to_json(x)
    FROM public.iap_authorize_consumption_send(
      ${q(claim.request_id)}::uuid, ${q(claim.lease_token)}::uuid
    ) AS x`, 'authorize Apple consumption send');
  const completeConsumption = (claim, authorization, outcome = 'accepted', errorCode = null) => actorScalar(
    'service_role',
    null,
    `SELECT row_to_json(x) FROM public.iap_complete_consumption_request(
      ${q(claim.request_id)}::uuid, ${q(claim.lease_token)}::uuid,
      ${authorization?.send_authorization_token ? `${q(authorization.send_authorization_token)}::uuid` : 'NULL'},
      ${authorization?.attempt_no ?? claim.attempt_no}::integer,
      ${authorization?.request_body_hash ? q(authorization.request_body_hash) : 'NULL'},
      ${q(outcome)}, ${errorCode === null ? 'NULL' : q(errorCode)}, NULL
    ) AS x`,
    'complete Apple consumption send',
  );
  const completeLateConsumption = ({
    requestId,
    leaseToken,
    sendAuthorizationToken,
    attemptNo,
    requestBodyHash,
    outcome = 'accepted',
    errorCode = null,
  }) => actorScalar(
    'service_role',
    null,
    `SELECT row_to_json(x) FROM public.iap_complete_consumption_request(
      ${q(requestId)}::uuid, ${q(leaseToken)}::uuid,
      ${q(sendAuthorizationToken)}::uuid, ${attemptNo}::integer,
      ${q(requestBodyHash)}, ${q(outcome)},
      ${errorCode === null ? 'NULL' : q(errorCode)}, NULL
    ) AS x`,
    'complete quarantined Apple consumption send',
  );
  const commitAfterFulfillment = ({ reservationId, entity, idempotency, sample = false }) => asActor(
    'service_role',
    null,
    `SELECT row_to_json(x) FROM public.iap_export_credit_commit_after_fulfillment(
      ${q(reservationId)}::uuid, ${q(sha(entity))}, ${q(sha(idempotency))},
      ${sample ? 'TRUE' : 'FALSE'}
    ) AS x`,
  );

  // Exercise the mixed-version window before the contract migration retires
  // service-role access to V1. This also proves the forward fix never needs to
  // rewrite 079 to preserve its compatibility behavior.
  const legacyConsumable = jsonResult(expectOk(callApply({
    user: F,
    token: TOKEN_F,
    tx: '8791',
    product: 'app.gomsinlog.book.export.credit.1',
    purchase: 8_791,
    signed: 8_791,
    event: 'purchase',
    hash: sha('legacy-v1-consumable-8791'),
  }), 'mixed-version V1 consumable ingest'), 'mixed-version V1 consumable ingest');
  if (legacyConsumable.accepted !== true) {
    throw new Error('migration 079 did not preserve the V1 service compatibility call');
  }
  if (scalar(`SELECT contract_version::text || '|' || resolution_status || '|' || credit_granted::text
      FROM iap_private.apple_transactions
      WHERE environment = 'Production' AND transaction_id = '8791'`,
  'legacy V1 consumable quarantine state') !== '1|legacy_manual_review|0') {
    throw new Error('legacy V1 consumable was not quarantined without a pooled grant');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_ledger
      WHERE environment = 'Production' AND transaction_id = '8791' AND entry_kind = 'purchase_grant'`,
  'legacy V1 consumable pooled ledger') !== '0') {
    throw new Error('legacy V1 consumable created a pooled purchase grant');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_lots
      WHERE environment = 'Production' AND source_transaction_id = '8791'`,
  'legacy V1 consumable exact lot') !== '0') {
    throw new Error('legacy V1 consumable was guessed into an exact credit lot');
  }

  // Seed a real pre-082 manual-review event so the upgrade path proves that
  // historical uncertainty becomes an explicit, non-destructive review fact.
  expectOk(callApplyV2({
    tx: '8788',
    purchase: 8_788,
    signed: 8_789,
    event: 'refund',
    revoke: 8_789,
    revocationType: 'REFUND_FULL',
    revocationPercentage: 100_000,
    hash: sha('pre-082-manual-review-8788'),
  }), 'pre-082 manual-review event fixture');
  const legacyReasonNotificationId = '79000000-0000-4000-8000-000000000091';
  expectOk(processConsumption({
    notificationId: legacyReasonNotificationId,
    notificationHash: sha('pre-082-consumption-reason'),
    tx: '8789',
    purchase: 8_789,
    signed: 8_790,
    reason: 'FULFILLMENT_ISSUE',
  }), 'pre-082 consumption-reason fixture');
  if (scalar(`SELECT consumption_request_reason
      FROM iap_private.apple_consumption_requests
      WHERE notification_uuid = ${q(legacyReasonNotificationId)}::uuid`,
  'pre-082 consumption reason value') !== 'FULFILLMENT_ISSUE') {
    throw new Error('migration 079 did not preserve its verified reason evidence');
  }

  // Fresh and upgrade chains use the real numeric order. 081 retires the V1
  // external contract; 082 then hardens the surviving V2 contract.
  expectOk(psql(['-f', CONTRACT_MIGRATION]), 'apply migration 081 contract');
  expectOk(psql(['-f', FORWARD_FIX_MIGRATION]), 'apply migration 082 forward fix');
  if (scalar(`SELECT count(*)::text FROM pg_attribute AS attribute
      WHERE attribute.attrelid = 'iap_private.apple_consumption_requests'::regclass
        AND attribute.attname = 'consumption_request_reason'
        AND NOT attribute.attisdropped`, '082 retained consumption reason evidence') !== '1') {
    throw new Error('migration 082 destructively removed verified notification evidence');
  }
  if (scalar(`SELECT attnotnull::text FROM pg_attribute AS attribute
      WHERE attribute.attrelid = 'iap_private.apple_consumption_requests'::regclass
        AND attribute.attname = 'consumption_request_reason'
        AND NOT attribute.attisdropped`, '082 optional consumption reason') !== 'false') {
    throw new Error('migration 082 did not minimize new refund-reason collection');
  }
  if (scalar(`SELECT consumption_request_reason
      FROM iap_private.apple_consumption_requests
      WHERE notification_uuid = ${q(legacyReasonNotificationId)}::uuid`,
  '082 preserved historical consumption reason') !== 'FULFILLMENT_ISSUE') {
    throw new Error('migration 082 changed historical consumption reason evidence');
  }
  if (scalar(`SELECT review_reason_code FROM iap_private.apple_transaction_events
      WHERE environment = 'Production' AND transaction_id = '8788'`,
  '082 legacy review classification') !== 'LEGACY_REVIEW_UNSPECIFIED') {
    throw new Error('migration 082 guessed or discarded a historical manual-review reason');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_transaction_review_facts AS review
      JOIN iap_private.apple_transaction_events AS event ON event.event_id = review.event_id
      WHERE event.environment = 'Production' AND event.transaction_id = '8788'
        AND review.reason_code = 'LEGACY_REVIEW_UNSPECIFIED'`,
  '082 legacy review fact backfill') !== '1') {
    throw new Error('migration 082 did not preserve the legacy event as one auditable review fact');
  }

  const deletedConsumptionId = '79000000-0000-4000-8000-000000000090';
  const deletedConsumption = jsonResult(expectOk(processConsumption({
    notificationId: deletedConsumptionId,
    notificationHash: sha('deleted-account-consumption-request'),
    token: TOKEN_D,
    tx: '8190',
    original: '8190',
    product: 'paper.paid',
    purchase: 9_000,
    signed: 9_100,
  }), 'deleted-account consumption request'), 'deleted-account consumption request');
  if (deletedConsumption.consumption_status !== 'skipped_account_deleted') {
    throw new Error('deleted-account consumption request was not retained as a terminal no-send decision');
  }
  if (scalar(`SELECT (consumption_request_reason IS NULL)::text
      FROM iap_private.apple_consumption_requests
      WHERE notification_uuid = ${q(deletedConsumptionId)}::uuid`,
  'post-082 consumption reason minimization') !== 'true') {
    throw new Error('a post-082 consumption request persisted an unnecessary refund reason');
  }
  if (actorScalar('service_role', null,
    'SELECT count(*)::text FROM public.iap_claim_consumption_request()',
    'deleted-account consumption remains unclaimable') !== '0') {
    throw new Error('deleted-account consumption request became sendable');
  }

  const legacyCommittedReservationId = scalar(`INSERT INTO iap_private.export_credit_reservations (
      billing_account_id, environment, idempotency_key, amount, status
    ) VALUES (
      ${q(billingAccountE)}::uuid, 'Production',
      '79000000-0000-4000-8000-000000000100'::uuid, 1, 'committed'
    ) RETURNING reservation_id::text`, 'legacy committed reservation fixture');
  expectFail(commitAfterFulfillment({
    reservationId: legacyCommittedReservationId,
    entity: 'legacy-commit-must-not-be-delivery',
    idempotency: 'legacy-commit-must-not-be-delivery',
  }), 'legacy committed reservation without exact evidence is not fulfillment');

  if (scalar("SELECT count(*)::text FROM iap_private.apple_product_catalog WHERE sale_enabled", 'migration 079 sale gate') !== '0') {
    throw new Error('migration 079 did not force every sale gate OFF');
  }
  expectFail(admin(`UPDATE iap_private.apple_product_catalog
    SET sale_enabled = TRUE
    WHERE environment = 'Production' AND product_id = 'paper.paid'`),
  'migration 079 database sale hold');
  if (scalar("SELECT count(*)::text FROM iap_private.apple_product_catalog WHERE sale_enabled", 'sale hold remains closed') !== '0') {
    throw new Error('a catalog edit bypassed the migration 079 database sale hold');
  }
  if (Number(scalar("SELECT count(*)::text FROM iap_private.export_credit_lots WHERE attribution_status = 'legacy_manual_review'", 'legacy ambiguity count')) < 1) {
    throw new Error('migration 079 guessed exact source attribution for legacy pooled credits');
  }
  expectFail(asActor('anon', null, 'SELECT count(*) FROM iap_private.export_credit_lots'), 'anon exact-lot table access');
  expectFail(asActor('authenticated', E, 'SELECT count(*) FROM iap_private.refund_data_consent_events'), 'authenticated consent-ledger table access');
  expectFail(asActor('service_role', null, 'SELECT count(*) FROM iap_private.apple_consumption_requests'), 'service direct consumption queue access');

  const processWithoutTransaction = ({
    notificationId,
    notificationType,
    subtype = null,
    reason = null,
  }) => asActor(
    'service_role',
    null,
    `SELECT row_to_json(x) FROM public.iap_process_verified_notification_v2(
      ${q(notificationId)}::uuid, 'Production', ${q(notificationType)},
      ${subtype === null ? 'NULL' : q(subtype)}, NULL, NULL, 20000::bigint,
      ${q(sha(`transactionless-${notificationType}-${notificationId}`))},
      floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
      ${reason === null ? 'NULL' : q(reason)}
    ) AS x`,
  );
  for (const [notificationId, notificationType] of [
    ['79000000-0000-4000-8000-000000000031', 'REFUND'],
    ['79000000-0000-4000-8000-000000000032', 'REVOKE'],
    ['79000000-0000-4000-8000-000000000033', 'REFUND_REVERSED'],
    ['79000000-0000-4000-8000-000000000034', 'CONSUMPTION_REQUEST'],
  ]) {
    expectFail(
      processWithoutTransaction({
        notificationId,
        notificationType,
        reason: notificationType === 'CONSUMPTION_REQUEST' ? 'FULFILLMENT_ISSUE' : null,
      }),
      `${notificationType} requires a verified nested transaction`,
    );
    if (scalar(`SELECT count(*)::text FROM iap_private.apple_notifications
        WHERE notification_uuid = ${q(notificationId)}::uuid`, `${notificationType} no success acknowledgement`) !== '0') {
      throw new Error(`${notificationType} without a transaction was persisted as processed`);
    }
  }
  for (const [notificationId, notificationType, subtype] of [
    ['79000000-0000-4000-8000-000000000035', 'TEST', null],
    ['79000000-0000-4000-8000-000000000036', 'RENEWAL_EXTENSION', 'SUMMARY'],
  ]) {
    expectOk(
      processWithoutTransaction({ notificationId, notificationType, subtype }),
      `${notificationType} transactionless informational notification`,
    );
    if (scalar(`SELECT status FROM iap_private.apple_notifications
        WHERE notification_uuid = ${q(notificationId)}::uuid`, `${notificationType} informational status`) !== 'processed') {
      throw new Error(`${notificationType} informational notification was not processed safely`);
    }
  }

  expectOk(callApplyV2({ tx: '8101', signed: 10_000 }), 'exact purchase A');
  expectOk(callApplyV2({ tx: '8102', purchase: 10_001, signed: 10_001 }), 'exact purchase B');
  expectOk(callApplyV2({
    tx: '8110', product: 'paper.paid', purchase: 11_000, signed: 11_000,
  }), 'tokenless exact-refund source');
  const tokenlessRefund = jsonResult(expectOk(processVerifiedNotification({
    notificationId: '79000000-0000-4000-8000-000000000041',
    notificationType: 'REFUND',
    tx: '8110',
    purchase: 11_000,
    signed: 12_000,
    event: 'refund',
    revocationType: 'REFUND_FULL',
  }), 'tokenless exact refund'), 'tokenless exact refund');
  if (tokenlessRefund.transaction_applied !== true
      || scalar("SELECT status FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '8110'", 'tokenless exact refund state') !== 'refunded') {
    throw new Error('tokenless exact refund did not converge through server-owned identity');
  }

  expectOk(callApplyV2({
    tx: '8111', product: 'paper.paid', purchase: 11_100, signed: 11_100,
  }), 'tokenless exact-revoke source');
  const tokenlessRevoke = jsonResult(expectOk(processVerifiedNotification({
    notificationId: '79000000-0000-4000-8000-000000000042',
    notificationType: 'REVOKE',
    tx: '8111',
    purchase: 11_100,
    signed: 12_100,
    event: 'revoke',
    revocationType: 'FAMILY_REVOKE',
  }), 'tokenless exact revoke'), 'tokenless exact revoke');
  if (tokenlessRevoke.transaction_applied !== true
      || scalar("SELECT status FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '8111'", 'tokenless exact revoke state') !== 'revoked') {
    throw new Error('tokenless exact revoke did not converge through server-owned identity');
  }

  expectOk(callApplyV2({
    user: F, token: TOKEN_F, tx: '8112', purchase: 11_200, signed: 11_200,
  }),
    'incomplete-revocation source purchase');
  expectOk(processVerifiedNotification({
    notificationId: '79000000-0000-4000-8000-000000000044',
    notificationType: 'REFUND',
    tx: '8112',
    product: 'app.gomsinlog.book.export.credit.1',
    purchase: 11_200,
    signed: 12_200,
    event: 'refund',
    revocationType: null,
    revocationPercentage: null,
    token: TOKEN_F,
  }), 'verified refund with incomplete revocation metadata');
  expectOk(callApplyV2({
    user: F, token: TOKEN_F, tx: '8113', purchase: 11_300,
    signed: 12_300, revoke: 12_300, event: 'refund',
    revocationType: 'REFUND_FULL', revocationPercentage: 100_000,
  }), 'refund before purchase history arrives');
  expectOk(callApplyV2({
    user: F, token: TOKEN_F, tx: '8113', purchase: 11_300,
    signed: 13_300, event: 'purchase',
  }), 'late purchase after refund-first history');
  expectOk(processVerifiedNotification({
    notificationId: '79000000-0000-4000-8000-000000000045',
    notificationType: 'REFUND',
    tx: '8114',
    purchase: 11_400,
    signed: 12_400,
    event: 'refund',
    revocationType: 'REFUND_FULL',
    token: '10000000-0000-4000-8000-000000000099',
  }), 'verified refund with unknown token binding');
  const nonAutomaticReviewFacts = scalar(`SELECT count(*)::text || '|' ||
      count(DISTINCT reason_code)::text || '|' || count(event_id)::text
    FROM iap_private.apple_transaction_review_facts
    WHERE transaction_id IN ('8112', '8113', '8114')`,
  'all non-automatic verified reversal paths create unique review facts');
  if (nonAutomaticReviewFacts !== '4|4|3') {
    throw new Error(`non-automatic verified reversal review facts were incomplete: ${nonAutomaticReviewFacts}`);
  }
  const nonAutomaticAlertFacts = actorScalar('service_role', null, `SELECT count(*)::text
    FROM public.iap_list_operational_alerts()
    WHERE source = 'transaction_review'
      AND error_code IN (
        'REVOCATION_METADATA_INCOMPLETE', 'REFUND_BEFORE_PURCHASE',
        'EXACT_LOT_UNAVAILABLE', 'TOKEN_BINDING_UNKNOWN'
      )`, 'all non-automatic verified reversal facts appear as alerts');
  if (nonAutomaticAlertFacts !== '4') {
    throw new Error('non-automatic verified reversal facts were absent from operational alerts');
  }

  const unresolvedTokenless = jsonResult(expectOk(processVerifiedNotification({
    notificationId: '79000000-0000-4000-8000-000000000043',
    notificationType: 'REFUND',
    tx: '8119',
    purchase: 11_900,
    signed: 12_900,
    event: 'refund',
    revocationType: 'REFUND_FULL',
  }), 'unresolved tokenless refund'), 'unresolved tokenless refund');
  if (unresolvedTokenless.transaction_applied !== false
      || scalar("SELECT count(*)::text FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '8119'", 'unresolved tokenless grants nothing') !== '0'
      || scalar(`SELECT reason_code FROM iap_private.apple_transaction_review_facts
          WHERE notification_uuid = '79000000-0000-4000-8000-000000000043'::uuid`, 'unresolved tokenless durable review') !== 'IDENTITY_UNRESOLVED') {
    throw new Error('unresolved tokenless refund was not held as a durable no-grant review fact');
  }
  const unresolvedReviewId = scalar(`SELECT review_id::text
    FROM iap_private.apple_transaction_review_facts
    WHERE notification_uuid = '79000000-0000-4000-8000-000000000043'::uuid`,
  'unresolved review id');
  expectFail(asActor('authenticated', E,
    'SELECT * FROM public.iap_list_operational_alerts()'),
  'authenticated operational alerts');
  const reviewAlert = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(alert)
    FROM public.iap_list_operational_alerts() AS alert
    WHERE alert.alert_id = ${q(unresolvedReviewId)}::uuid`,
  'bounded transaction-review alert'), 'bounded transaction-review alert');
  if (JSON.stringify(reviewAlert) !== JSON.stringify({
    alert_id: unresolvedReviewId,
    source: 'transaction_review',
    environment: 'Production',
    status: 'manual_review',
    deadline_bucket: 'not_applicable',
    attempt_no: 0,
    error_code: 'IDENTITY_UNRESOLVED',
  })) {
    throw new Error('manual-review alert exposed an unbounded or identifying payload');
  }
  const acknowledgedReview = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(result)
    FROM public.iap_acknowledge_transaction_review(
      ${q(unresolvedReviewId)}::uuid, 'APPLE_RECONCILIATION_REQUIRED',
      ${q(OPERATOR_ACTOR)}::uuid, ${q(REVIEW_OPERATION)}::uuid
    ) AS result`, 'acknowledge transaction review'), 'acknowledge transaction review');
  if (acknowledgedReview.status !== 'acknowledged'
      || acknowledgedReview.resolution_code !== 'APPLE_RECONCILIATION_REQUIRED'
      || acknowledgedReview.operator_actor_id !== OPERATOR_ACTOR
      || acknowledgedReview.operation_id !== REVIEW_OPERATION
      || acknowledgedReview.duplicate !== false) {
    throw new Error('manual-review acknowledgement did not persist its bounded resolution');
  }
  const acknowledgedReplay = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(result)
    FROM public.iap_acknowledge_transaction_review(
      ${q(unresolvedReviewId)}::uuid, 'APPLE_RECONCILIATION_REQUIRED',
      ${q(OPERATOR_ACTOR)}::uuid, ${q(REVIEW_OPERATION)}::uuid
    ) AS result`, 'acknowledge transaction review replay'), 'acknowledge transaction review replay');
  if (acknowledgedReplay.duplicate !== true) {
    throw new Error('manual-review acknowledgement replay was not idempotent');
  }
  expectFail(asActor('service_role', null, `SELECT *
    FROM public.iap_acknowledge_transaction_review(
      ${q(unresolvedReviewId)}::uuid, 'NO_AUTOMATIC_ACTION',
      ${q(OPERATOR_ACTOR)}::uuid, ${q(REVIEW_OPERATION)}::uuid
    )`), 'manual-review acknowledgement collision');
  expectFail(asActor('service_role', null, `SELECT *
    FROM public.iap_acknowledge_transaction_review(
      ${q(unresolvedReviewId)}::uuid, 'APPLE_RECONCILIATION_REQUIRED',
      '60000000-0000-4000-8000-000000000002'::uuid,
      ${q(REVIEW_OPERATION)}::uuid
    )`), 'manual-review actor collision');
  if (scalar(`SELECT reviewed_by_actor_id::text || '|' || review_operation_id::text
      FROM iap_private.apple_transaction_review_facts
      WHERE review_id = ${q(unresolvedReviewId)}::uuid`,
  'manual-review audit identity') !== `${OPERATOR_ACTOR}|${REVIEW_OPERATION}`) {
    throw new Error('manual-review acknowledgement did not retain actor and operation identity');
  }
  if (scalar("SELECT count(*)::text FROM iap_private.apple_transactions WHERE environment = 'Production' AND transaction_id = '8119'", 'manual review acknowledgement grants nothing') !== '0') {
    throw new Error('manual-review acknowledgement created a transaction or grant');
  }
  const noConsentId = '79000000-0000-4000-8000-000000000001';
  const noConsent = jsonResult(expectOk(processConsumption({
    notificationId: noConsentId,
    notificationHash: sha('consumption-no-consent'),
  }), 'consumption request without consent'), 'consumption request without consent');
  if (noConsent.consumption_status !== 'skipped_no_consent') throw new Error('consumption request inferred consent');
  if (scalar(`SELECT status FROM iap_private.apple_consumption_requests WHERE notification_uuid = ${q(noConsentId)}::uuid`, 'no-consent queue evidence') !== 'skipped_no_consent') {
    throw new Error('no-consent request was not retained as a skipped decision');
  }

  // A consumption request is an independent 12-hour Apple response obligation.
  // A newer notification of another type for the same transaction must not
  // make the consumption request stale or suppress its retained decision.
  expectOk(asActor('service_role', null, `SELECT * FROM public.iap_process_verified_notification_v2(
    '79000000-0000-4000-8000-000000000010'::uuid, 'Production', 'DID_RENEW', NULL,
    '8102', '8102', 90000::bigint, ${q(sha('later-non-consumption-8102'))},
    floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint, NULL
  )`), 'later different notification fixture');
  const delayedConsumptionId = '79000000-0000-4000-8000-000000000011';
  const delayedConsumption = jsonResult(expectOk(processConsumption({
    notificationId: delayedConsumptionId,
    notificationHash: sha('delayed-consumption-8102'),
    tx: '8102',
    purchase: 10_001,
    signed: 80_000,
  }), 'delayed consumption request after newer notification'), 'delayed consumption request');
  if (delayedConsumption.stale !== false
      || delayedConsumption.consumption_status !== 'skipped_no_consent') {
    throw new Error('a delayed consumption request was discarded by another notification clock');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_consumption_requests
      WHERE notification_uuid = ${q(delayedConsumptionId)}::uuid`, 'delayed consumption retained') !== '1') {
    throw new Error('the delayed consumption request obligation was not retained');
  }

  const noticeVersion = 'refund-data-2026-09-v1';
  const noticeHash = sha('reviewed refund data notice v1');
  const grantKey = '79000000-0000-4000-8000-000000000101';
  expectFail(asActor('authenticated', E, `SELECT * FROM public.iap_set_refund_data_consent(
    'granted', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(grantKey)}::uuid)`), 'consent grant without reviewed notice');
  expectOk(admin(`INSERT INTO iap_private.refund_data_consent_notices
    (notice_version, notice_sha256, active) VALUES (${q(noticeVersion)}, ${q(noticeHash)}, TRUE)`), 'reviewed consent notice fixture');
  const consentStateBeforeGrant = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_get_refund_data_consent_state(
      ${q(noticeVersion)}, ${q(noticeHash)}
    ) AS x`, 'exact refund-data notice state'), 'exact refund-data notice state');
  if (consentStateBeforeGrant.notice_matches !== true
      || consentStateBeforeGrant.decision !== null) {
    throw new Error('exact active notice did not return a closed pre-consent state');
  }
  const mismatchedConsentState = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_get_refund_data_consent_state(
      ${q(noticeVersion)}, ${q(sha('unreviewed notice bytes'))}
    ) AS x`, 'mismatched refund-data notice state'), 'mismatched refund-data notice state');
  if (mismatchedConsentState.notice_matches !== false
      || mismatchedConsentState.decision !== null) {
    throw new Error('app/DB notice mismatch did not fail closed');
  }
  const granted = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_set_refund_data_consent('granted', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(grantKey)}::uuid) AS x`, 'grant refund-data consent'), 'grant refund-data consent');
  if (granted.decision !== 'granted' || granted.notice_version !== noticeVersion || granted.notice_sha256 !== noticeHash || granted.duplicate !== false) {
    throw new Error('consent grant did not retain the exact reviewed notice identity');
  }
  const consentStateAfterGrant = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_get_refund_data_consent_state(
      ${q(noticeVersion)}, ${q(noticeHash)}
    ) AS x`, 'granted refund-data notice state'), 'granted refund-data notice state');
  if (consentStateAfterGrant.notice_matches !== true
      || consentStateAfterGrant.decision !== 'granted') {
    throw new Error('consent state did not reflect the exact reviewed grant');
  }
  const grantedReplay = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_set_refund_data_consent('granted', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(grantKey)}::uuid) AS x`, 'consent grant replay'), 'consent grant replay');
  if (grantedReplay.duplicate !== true) throw new Error('consent grant idempotency failed');
  expectFail(asActor('authenticated', E, `SELECT * FROM public.iap_set_refund_data_consent(
    'withdrawn', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(grantKey)}::uuid)`), 'consent idempotency collision');

  expectOk(callApplyV2({
    tx: '8140', environment: 'Sandbox', product: 'paper.paid',
    purchase: 24_000, signed: 24_000,
  }), 'sandbox response-window transaction');
  expectOk(recordDelivery({
    tx: '8140', environment: 'Sandbox', entity: 'paper-8140-delivery',
    idempotency: 'paper-8140-delivery',
  }), 'sandbox response-window fulfillment');
  const sandboxRequestId = '79000000-0000-4000-8000-000000000019';
  const sandboxConsumption = jsonResult(expectOk(processConsumption({
    notificationId: sandboxRequestId,
    notificationHash: sha('sandbox-five-minute-response-window'),
    tx: '8140',
    product: 'paper.paid',
    purchase: 24_000,
    signed: 24_500,
    environment: 'Sandbox',
    receivedAtSql: 'floor(extract(epoch FROM clock_timestamp() - interval \'2 minutes\') * 1000)::bigint',
  }), 'sandbox five-minute consumption request'), 'sandbox five-minute consumption request');
  if (sandboxConsumption.consumption_status !== 'queued') {
    throw new Error('valid Sandbox consumption request did not queue');
  }
  if (scalar(`SELECT floor(extract(epoch FROM (deadline_at - received_at)) * 1000)::text
      FROM iap_private.apple_consumption_requests
      WHERE notification_uuid = ${q(sandboxRequestId)}::uuid`, 'sandbox response deadline') !== '300000') {
    throw new Error('Sandbox consumption request did not preserve Apple’s five-minute test window');
  }
  expectOk(admin(`UPDATE iap_private.apple_consumption_requests
    SET status = 'accepted', next_attempt_at = NULL, updated_at = clock_timestamp()
    WHERE notification_uuid = ${q(sandboxRequestId)}::uuid`), 'cleanup sandbox response-window fixture');

  // The nested JWS proves the Apple transaction identity, not that GomsinLog
  // already synchronized or fulfilled it. Preserve the response obligation as
  // pending and promote it only after both authoritative local facts exist.
  const pendingBeforeSyncId = '79000000-0000-4000-8000-000000000020';
  const pendingBeforeSync = jsonResult(expectOk(processConsumption({
    notificationId: pendingBeforeSyncId,
    notificationHash: sha('consumption-before-purchase-sync'),
    tx: '8150',
    product: 'paper.paid',
    purchase: 25_000,
    signed: 25_500,
  }), 'consumption request before purchase sync'), 'consumption before purchase sync');
  if (pendingBeforeSync.consumption_status !== 'pending_evidence') {
    throw new Error('pre-sync consumption request became terminal instead of pending');
  }
  if (actorScalar('service_role', null, 'SELECT count(*)::text FROM public.iap_claim_consumption_request()', 'pre-sync request is not claimable') !== '0') {
    throw new Error('consumption request was claimable before authoritative purchase sync');
  }
  expectOk(callApplyV2({
    tx: '8150', product: 'paper.paid', purchase: 25_000, signed: 25_100,
  }), 'authoritative purchase arrives after consumption request');
  if (actorScalar('service_role', null, 'SELECT count(*)::text FROM public.iap_claim_consumption_request()', 'purchase alone is not fulfillment') !== '0') {
    throw new Error('transaction registration was incorrectly treated as real fulfillment');
  }
  expectOk(recordDelivery({ tx: '8150', entity: 'paper-8150-delivery', idempotency: 'paper-8150-delivery' }), 'record real fulfillment after sync');
  const promotedClaim = jsonResult(actorScalar('service_role', null,
    'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x',
    'promote pending request after real fulfillment'), 'promoted consumption request');
  if (scalar(`SELECT transaction_id FROM iap_private.apple_consumption_requests
      WHERE request_id = ${q(promotedClaim.request_id)}::uuid`, 'promoted request transaction identity') !== '8150') {
    throw new Error('pending response was not promoted after purchase and fulfillment evidence arrived');
  }
  expectOk(admin(`UPDATE iap_private.apple_consumption_requests
    SET status = 'accepted', lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL, send_authorization_expires_at = NULL,
        sent_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE request_id = ${q(promotedClaim.request_id)}::uuid`), 'cleanup promoted-request fixture');

  // Concurrent replay of the same server fulfillment must converge to one row
  // rather than surfacing a unique violation to one legitimate worker.
  const concurrentEvidence = await Promise.all(Array.from({ length: 4 }, () => asActorAsync(
    'service_role',
    null,
    `SELECT row_to_json(x) FROM public.iap_record_fulfillment_usage_evidence(
      'Production', '8101', 'delivery_confirmed', 0, 'DELIVERED', FALSE,
      ${q(sha('concurrent-delivery-8101'))}, ${q(sha('concurrent-delivery-8101'))}
    ) AS x`,
  )));
  if (concurrentEvidence.some((result) => result.status !== 0)) {
    throw new Error('concurrent fulfillment idempotency replay raised a unique violation');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.fulfillment_usage_evidence
      WHERE billing_account_id = ${q(billingAccountE)}::uuid
        AND idempotency_hash = ${q(sha('concurrent-delivery-8101'))}`, 'one concurrent evidence row') !== '1') {
    throw new Error('concurrent fulfillment replay did not converge to one immutable row');
  }
  expectFail(recordDelivery({
    tx: '8101',
    eventKind: 'export_committed',
    units: 1_000,
    entity: 'generic-rpc-must-not-commit-export',
    idempotency: 'generic-rpc-must-not-commit-export',
  }), 'generic evidence RPC cannot fabricate an export commit');
  expectFail(asActor('service_role', null, `SELECT *
    FROM public.iap_record_fulfillment_usage_evidence(
      'Production', '8101', 'delivery_confirmed', 0, NULL, FALSE,
      ${q(sha('delivery-without-status'))}, ${q(sha('delivery-without-status'))}
    )`), 'delivery evidence requires an explicit outcome');

  const queuedId = '79000000-0000-4000-8000-000000000002';
  const queuedHash = sha('consumption-queued');
  const queued = jsonResult(expectOk(processConsumption({
    notificationId: queuedId,
    notificationHash: queuedHash,
    signed: 21_000,
  }), 'consumption request with consent'), 'consumption request with consent');
  if (queued.consumption_status !== 'queued') throw new Error('valid consent did not queue a consumption response');
  const queuedReplay = jsonResult(expectOk(processConsumption({
    notificationId: queuedId,
    notificationHash: queuedHash,
    signed: 21_000,
  }), 'consumption request replay'), 'consumption request replay');
  if (queuedReplay.duplicate !== true || queuedReplay.consumption_status !== 'queued') throw new Error('consumption request replay was not idempotent');
  expectFail(processConsumption({
    notificationId: queuedId,
    notificationHash: queuedHash,
    tx: '8102',
    original: '8102',
    signed: 21_000,
  }), 'consumption notification UUID transaction identity collision');
  expectFail(processConsumption({
    notificationId: queuedId,
    notificationHash: sha('consumption-queued-collision'),
    signed: 21_000,
  }), 'consumption notification UUID/hash collision');

  const imminentPendingId = '79000000-0000-4000-8000-000000000022';
  const imminentPending = jsonResult(expectOk(processConsumption({
    notificationId: imminentPendingId,
    notificationHash: sha('imminent-pending-evidence'),
    tx: '8151',
    purchase: 25_100,
    signed: 25_600,
  }), 'imminent pending-evidence fixture'), 'imminent pending-evidence fixture');
  if (imminentPending.consumption_status !== 'pending_evidence') {
    throw new Error('imminent pending-evidence fixture did not remain pending');
  }
  expectOk(admin(`UPDATE iap_private.apple_consumption_requests AS request
    SET received_at = boundary.received_at,
        deadline_at = boundary.received_at + interval '12 hours',
        updated_at = clock_timestamp()
    FROM (SELECT clock_timestamp() - interval '10 hours 1 minute' AS received_at) AS boundary
    WHERE notification_uuid IN (
      ${q(queuedId)}::uuid, ${q(imminentPendingId)}::uuid
    )`), 'move pending and queued requests to the 10-hour alert boundary');
  const queuedRequestId = scalar(`SELECT request_id::text
    FROM iap_private.apple_consumption_requests
    WHERE notification_uuid = ${q(queuedId)}::uuid`, 'imminent queued request id');
  const imminentPendingRequestId = scalar(`SELECT request_id::text
    FROM iap_private.apple_consumption_requests
    WHERE notification_uuid = ${q(imminentPendingId)}::uuid`, 'imminent pending request id');
  const imminentPreSendAlerts = actorScalar('service_role', null, `SELECT string_agg(
      alert.status || '|' || alert.deadline_bucket || '|' || alert.error_code,
      ',' ORDER BY alert.status
    )
    FROM public.iap_list_operational_alerts() AS alert
    WHERE alert.alert_id IN (
      ${q(queuedRequestId)}::uuid,
      ${q(imminentPendingRequestId)}::uuid
    )`, 'imminent pending and queued alerts');
  if (imminentPreSendAlerts !==
      'pending_evidence|lt_2h|APPLE_DEADLINE_IMMINENT,queued|lt_2h|APPLE_DEADLINE_IMMINENT') {
    throw new Error(`10-hour pending/queued obligations were absent from opaque alerts: ${imminentPreSendAlerts}`);
  }

  const preauthorizationLease = jsonResult(actorScalar('service_role', null,
    'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x',
    'claim request for pre-authorization retry'), 'pre-authorization retry claim');
  const preauthorizationRetry = jsonResult(completeConsumption(
    preauthorizationLease,
    null,
    'retryable_failed',
    'APPLE_SEND_WINDOW_EXHAUSTED',
  ), 'complete pre-authorization retry');
  if (preauthorizationRetry.status !== 'retryable_failed') {
    throw new Error('a pre-authorization lease exhaustion became terminal before the 12-hour deadline');
  }
  if (actorScalar('service_role', null, `SELECT status || '|' || deadline_bucket || '|' || error_code
      FROM public.iap_list_operational_alerts()
      WHERE alert_id = ${q(preauthorizationLease.request_id)}::uuid`,
  'imminent retryable-failed alert') !==
      'retryable_failed|lt_2h|APPLE_SEND_WINDOW_EXHAUSTED') {
    throw new Error('10-hour retryable failure was absent from opaque alerts');
  }

  const withdrawKey = '79000000-0000-4000-8000-000000000102';
  const withdrawn = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_set_refund_data_consent('withdrawn', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(withdrawKey)}::uuid) AS x`, 'withdraw refund-data consent'), 'withdraw refund-data consent');
  if (withdrawn.decision !== 'withdrawn') throw new Error('consent withdrawal was not appended');
  if (actorScalar('service_role', null, 'SELECT count(*)::text FROM public.iap_claim_consumption_request()', 'withdrawal-before-send claim') !== '0') {
    throw new Error('withdrawn consent still allowed an Apple send claim');
  }
  if (scalar(`SELECT status FROM iap_private.apple_consumption_requests WHERE notification_uuid = ${q(queuedId)}::uuid`, 'withdrawal-before-send status') !== 'skipped_withdrawn') {
    throw new Error('withdrawal before send was not persisted');
  }

  const regrantKey = '79000000-0000-4000-8000-000000000103';
  expectOk(asActor('authenticated', E, `SELECT * FROM public.iap_set_refund_data_consent(
    'granted', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(regrantKey)}::uuid)`), 'regrant refund-data consent');
  const sendId = '79000000-0000-4000-8000-000000000003';
  expectOk(processConsumption({ notificationId: sendId, notificationHash: sha('consumption-send'), signed: 22_000 }), 'queue sendable consumption request');
  const claimed = jsonResult(actorScalar('service_role', null, 'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x', 'claim sendable consumption request'), 'claim sendable consumption request');
  if (claimed.deadline_at_ms - claimed.received_at_ms !== 43_200_000
      || ['environment', 'transaction_id', 'product_type', 'delivery_status',
        'sample_content_provided', 'consumption_percentage', 'request_body_hash']
        .some((field) => Object.hasOwn(claimed, field))) {
    throw new Error('claim leaked a stale Apple request-body snapshot');
  }
  const withdrawAfterClaimKey = '79000000-0000-4000-8000-000000000104';
  const withdrawalWinsRace = asActorAsync('authenticated', E, `
    BEGIN;
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${q(E)}::text, 15013)
    );
    SELECT pg_sleep(0.3);
    SELECT * FROM public.iap_set_refund_data_consent(
      'withdrawn', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(withdrawAfterClaimKey)}::uuid
    );
    COMMIT;
  `);
  await waitForGrantedAdvisoryLock('withdrawal/send-authorization race lock');
  const authorizationLosesRace = asActorAsync('service_role', null, `SELECT row_to_json(x)
    FROM public.iap_authorize_consumption_send(
      ${q(claimed.request_id)}::uuid, ${q(claimed.lease_token)}::uuid
    ) AS x`);
  const [withdrawalRaceResult, authorizationRaceResult] = await Promise.all([
    withdrawalWinsRace,
    authorizationLosesRace,
  ]);
  expectOk(withdrawalRaceResult, 'withdrawal wins concurrent send-authorization race');
  if (expectOk(authorizationRaceResult, 'authorization waits for concurrent withdrawal') !== '') {
    throw new Error('a withdrawn in-flight request received send authorization');
  }
  if (scalar(`SELECT status || '|' || (lease_token IS NULL)::text
      FROM iap_private.apple_consumption_requests
      WHERE request_id = ${q(claimed.request_id)}::uuid`, 'withdrawal cancels claimed request') !== 'skipped_withdrawn|true') {
    throw new Error('withdrawal did not atomically cancel the pre-send claim');
  }

  const regrantBeforeNoticeReplacementKey = '79000000-0000-4000-8000-000000000105';
  expectOk(asActor('authenticated', E, `SELECT * FROM public.iap_set_refund_data_consent(
    'granted', ${q(noticeVersion)}, ${q(noticeHash)}, ${q(regrantBeforeNoticeReplacementKey)}::uuid)`), 'regrant before notice replacement');
  const noticeAuthId = '79000000-0000-4000-8000-000000000004';
  const noticeClaimId = '79000000-0000-4000-8000-000000000005';
  expectOk(processConsumption({ notificationId: noticeAuthId, notificationHash: sha('notice-auth-race'), signed: 23_000 }), 'queue notice auth race');
  expectOk(processConsumption({ notificationId: noticeClaimId, notificationHash: sha('notice-claim-race'), signed: 23_001 }), 'queue notice claim race');
  const noticeClaim = jsonResult(actorScalar('service_role', null,
    'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x',
    'claim before notice replacement'), 'claim before notice replacement');
  const noticeVersion2 = 'refund-data-2026-09-v2';
  const noticeHash2 = sha('reviewed refund data notice v2');
  expectOk(admin(`UPDATE iap_private.refund_data_consent_notices
      SET active = FALSE WHERE notice_version = ${q(noticeVersion)};
    INSERT INTO iap_private.refund_data_consent_notices
      (notice_version, notice_sha256, active)
    VALUES (${q(noticeVersion2)}, ${q(noticeHash2)}, TRUE)`), 'replace active refund-data notice');
  if (authorizeConsumption(noticeClaim) !== '') {
    throw new Error('an obsolete consent notice received send authorization');
  }
  if (actorScalar('service_role', null, 'SELECT count(*)::text FROM public.iap_claim_consumption_request()', 'obsolete notice denied at claim') !== '0') {
    throw new Error('claim did not reject a request bound to an inactive notice');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_consumption_requests
      WHERE notification_uuid IN (${q(noticeAuthId)}::uuid, ${q(noticeClaimId)}::uuid)
        AND status = 'skipped_withdrawn'`, 'obsolete notice requests cancelled') !== '2') {
    throw new Error('notice replacement left a pre-authorization request sendable');
  }

  const grantV2Key = '79000000-0000-4000-8000-000000000106';
  expectOk(asActor('authenticated', E, `SELECT * FROM public.iap_set_refund_data_consent(
    'granted', ${q(noticeVersion2)}, ${q(noticeHash2)}, ${q(grantV2Key)}::uuid)`), 'grant replacement refund-data notice');
  const authorizedId = '79000000-0000-4000-8000-000000000006';
  expectOk(processConsumption({ notificationId: authorizedId, notificationHash: sha('authorized-send-start'), signed: 24_000 }), 'queue authorization ordering fixture');
  const authorizedClaim = jsonResult(actorScalar('service_role', null,
    'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x',
    'claim authorization ordering fixture'), 'claim authorization ordering fixture');
  expectOk(recordDelivery({
    tx: '8101', sample: true,
    entity: 'delivery-arrived-after-claim',
    idempotency: 'delivery-arrived-after-claim',
  }), 'record newer fulfillment after claim and before authorization');
  const authorization = jsonResult(authorizeConsumption(authorizedClaim), 'authorize consumption send');
  if (!/^[0-9a-f-]{36}$/.test(authorization.send_authorization_token)
      || authorization.transaction_id !== '8101'
      || authorization.product_type !== 'consumable'
      || authorization.sample_content_provided !== true
      || !/^[0-9a-f]{64}$/.test(authorization.request_body_hash)) {
    throw new Error('just-in-time authorization did not recompute and freeze the latest server evidence');
  }
  const knownHttpRetry = jsonResult(completeConsumption(
    authorizedClaim,
    authorization,
    'retryable_failed',
    'APPLE_HTTP_503',
  ), 'known HTTP failure remains retryable');
  if (knownHttpRetry.status !== 'retryable_failed') {
    throw new Error('known Apple HTTP failure was not retained for bounded retry');
  }
  expectOk(recordDelivery({
    tx: '8101', sample: false,
    entity: 'delivery-changed-after-first-send',
    idempotency: 'delivery-changed-after-first-send',
  }), 'record evidence changed after the first known send result');
  expectOk(admin(`UPDATE iap_private.apple_consumption_requests
    SET next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE request_id = ${q(authorizedClaim.request_id)}::uuid`), 'activate known HTTP retry fixture');
  const retryClaim = jsonResult(actorScalar('service_role', null,
    'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x',
    'claim known HTTP retry'), 'known HTTP retry claim');
  const retryAuthorization = jsonResult(authorizeConsumption(retryClaim), 'authorize known HTTP retry');
  if (retryAuthorization.sample_content_provided !== true
      || retryAuthorization.request_body_hash !== authorization.request_body_hash) {
    throw new Error('known HTTP retry changed the body frozen at the first send boundary');
  }

  const unknownId = '79000000-0000-4000-8000-000000000021';
  expectOk(processConsumption({
    notificationId: unknownId,
    notificationHash: sha('send-result-unknown'),
    signed: 24_100,
  }), 'queue send-result-unknown fixture');
  const unknownClaim = jsonResult(actorScalar('service_role', null,
    'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x',
    'claim send-result-unknown fixture'), 'send-result-unknown claim');
  const unknownAuthorization = jsonResult(
    authorizeConsumption(unknownClaim),
    'authorize send-result-unknown fixture',
  );
  expectOk(admin(`UPDATE iap_private.apple_consumption_requests
    SET lease_expires_at = clock_timestamp() - interval '1 second',
        send_authorization_expires_at = clock_timestamp() - interval '1 second',
        updated_at = clock_timestamp()
    WHERE request_id = ${q(unknownClaim.request_id)}::uuid`), 'expire send-start lease');
  if (actorScalar('service_role', null,
      'SELECT count(*)::text FROM public.iap_claim_consumption_request()',
      'send-start lease expiry is not claimable') !== '0') {
    throw new Error('send-start lease expiry was blindly retried after an unknown transport result');
  }
  if (scalar(`SELECT status || '|' || (next_attempt_at IS NULL)::text || '|'
      || (lease_token IS NULL)::text || '|' || (send_authorization_token IS NULL)::text
      FROM iap_private.apple_consumption_requests
      WHERE request_id = ${q(unknownClaim.request_id)}::uuid`, 'send-result-unknown quarantine')
      !== 'send_result_unknown|true|true|true') {
    throw new Error('send-start lease expiry was not quarantined for manual reconciliation');
  }
  if (!unknownAuthorization.send_authorization_token) {
    throw new Error('send-result-unknown fixture never crossed the send-start boundary');
  }
  const unknownAlert = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(alert)
    FROM public.iap_list_operational_alerts() AS alert
    WHERE alert.alert_id = ${q(unknownClaim.request_id)}::uuid`,
  'bounded send-result-unknown alert'), 'bounded send-result-unknown alert');
  if (JSON.stringify(unknownAlert) !== JSON.stringify({
    alert_id: unknownClaim.request_id,
    source: 'consumption',
    environment: 'Production',
    status: 'send_result_unknown',
    deadline_bucket: 'gte_6h',
    attempt_no: 1,
    error_code: 'SEND_RESULT_UNKNOWN',
  })) {
    throw new Error('send-result-unknown alert exposed a purchase identity or unbounded payload');
  }
  const unknownAttemptNo = Number(scalar(`SELECT attempts::text
    FROM iap_private.apple_consumption_requests
    WHERE request_id = ${q(unknownClaim.request_id)}::uuid`, 'quarantined first attempt number'));
  const firstLateCompletion = jsonResult(completeLateConsumption({
    requestId: unknownClaim.request_id,
    leaseToken: unknownClaim.lease_token,
    sendAuthorizationToken: unknownAuthorization.send_authorization_token,
    attemptNo: unknownAttemptNo,
    requestBodyHash: unknownAuthorization.request_body_hash,
  }), 'first-attempt late accepted completion');
  if (firstLateCompletion.status !== 'accepted' || firstLateCompletion.duplicate !== false) {
    throw new Error('first-attempt late accepted result did not converge from quarantine');
  }
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_complete_consumption_request(
    ${q(unknownClaim.request_id)}::uuid, ${q(unknownClaim.lease_token)}::uuid,
    ${q(unknownAuthorization.send_authorization_token)}::uuid,
    ${unknownAttemptNo + 1}::integer, ${q(unknownAuthorization.request_body_hash)},
    'accepted', NULL, NULL
  )`), 'wrong late-completion attempt number');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_complete_consumption_request(
    ${q(unknownClaim.request_id)}::uuid,
    '40000000-0000-4000-8000-000000000099'::uuid,
    ${q(unknownAuthorization.send_authorization_token)}::uuid,
    ${unknownAttemptNo}::integer, ${q(unknownAuthorization.request_body_hash)},
    'accepted', NULL, NULL
  )`), 'wrong late-completion lease');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_complete_consumption_request(
    ${q(unknownClaim.request_id)}::uuid, ${q(unknownClaim.lease_token)}::uuid,
    '50000000-0000-4000-8000-000000000099'::uuid,
    ${unknownAttemptNo}::integer, ${q(unknownAuthorization.request_body_hash)},
    'accepted', NULL, NULL
  )`), 'wrong late-completion authorization');
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_complete_consumption_request(
    ${q(unknownClaim.request_id)}::uuid, ${q(unknownClaim.lease_token)}::uuid,
    ${q(unknownAuthorization.send_authorization_token)}::uuid,
    ${unknownAttemptNo}::integer, ${q('f'.repeat(64))}, 'accepted', NULL, NULL
  )`), 'wrong late-completion body hash');

  const withdrawAfterAuthorizationKey = '79000000-0000-4000-8000-000000000107';
  expectOk(asActor('authenticated', E, `SELECT * FROM public.iap_set_refund_data_consent(
    'withdrawn', ${q(noticeVersion2)}, ${q(noticeHash2)}, ${q(withdrawAfterAuthorizationKey)}::uuid)`), 'withdraw after send-start authorization');
  if (scalar(`SELECT status FROM iap_private.apple_consumption_requests
      WHERE request_id = ${q(authorizedClaim.request_id)}::uuid`, 'authorization linearization state') !== 'send_started') {
    throw new Error('a later withdrawal rewrote an already-authorized send-start snapshot');
  }
  expectOk(admin(`UPDATE iap_private.apple_consumption_requests
    SET lease_expires_at = clock_timestamp() - interval '1 second',
        send_authorization_expires_at = clock_timestamp() - interval '1 second',
        updated_at = clock_timestamp()
    WHERE request_id = ${q(retryClaim.request_id)}::uuid`), 'expire second send-start lease');
  if (actorScalar('service_role', null,
      'SELECT count(*)::text FROM public.iap_claim_consumption_request()',
      'second send-start lease expiry is not claimable') !== '0') {
    throw new Error('second send-start lease expiry was blindly retried');
  }
  const retryAttemptNo = Number(scalar(`SELECT attempts::text
    FROM iap_private.apple_consumption_requests
    WHERE request_id = ${q(retryClaim.request_id)}::uuid`, 'quarantined second attempt number'));
  expectFail(asActor('service_role', null, `SELECT * FROM public.iap_complete_consumption_request(
    ${q(retryClaim.request_id)}::uuid, ${q(authorizedClaim.lease_token)}::uuid,
    ${q(authorization.send_authorization_token)}::uuid,
    ${retryAttemptNo - 1}::integer, ${q(authorization.request_body_hash)},
    'accepted', NULL, NULL
  )`), 'attempt one cannot complete quarantined attempt two');
  const completed = jsonResult(completeLateConsumption({
    requestId: retryClaim.request_id,
    leaseToken: retryClaim.lease_token,
    sendAuthorizationToken: retryAuthorization.send_authorization_token,
    attemptNo: retryAttemptNo,
    requestBodyHash: retryAuthorization.request_body_hash,
  }), 'complete quarantined second Apple consumption send');
  if (completed.status !== 'accepted' || completed.duplicate !== false) throw new Error('Apple send completion was not persisted');
  const completeReplay = jsonResult(completeLateConsumption({
    requestId: retryClaim.request_id,
    leaseToken: retryClaim.lease_token,
    sendAuthorizationToken: retryAuthorization.send_authorization_token,
    attemptNo: retryAttemptNo,
    requestBodyHash: retryAuthorization.request_body_hash,
  }), 'complete Apple consumption send replay');
  if (completeReplay.duplicate !== true) throw new Error('Apple send completion replay was not idempotent');
  if (scalar(`SELECT (lease_token IS NULL)::text || '|' || (lease_expires_at IS NULL)::text
      || '|' || (send_authorization_token IS NULL)::text || '|'
      || (send_authorization_expires_at IS NULL)::text
      FROM iap_private.apple_consumption_requests
      WHERE request_id = ${q(retryClaim.request_id)}::uuid`, 'terminal token hygiene') !== 'true|true|true|true') {
    throw new Error('terminal consumption state retained lease or authorization tokens');
  }

  // Account deletion shares the canonical per-user lock. If deletion wins
  // before send authorization, it cancels both waiting and claimed work.
  expectOk(callApplyV2({
    user: F, token: TOKEN_F, tx: '8160', product: 'paper.paid', purchase: 26_000, signed: 26_000,
  }), 'account-deletion consumption purchase');
  expectOk(recordDelivery({ tx: '8160', entity: 'paper-8160-delivery', idempotency: 'paper-8160-delivery' }), 'account-deletion consumption fulfillment');
  const grantFKey = '79000000-0000-4000-8000-000000000108';
  expectOk(asActor('authenticated', F, `SELECT * FROM public.iap_set_refund_data_consent(
    'granted', ${q(noticeVersion2)}, ${q(noticeHash2)}, ${q(grantFKey)}::uuid)`), 'grant refund-data consent for deletion race');
  const deletionConsumptionId = '79000000-0000-4000-8000-000000000007';
  expectOk(processConsumption({
    notificationId: deletionConsumptionId,
    notificationHash: sha('deletion-before-authorization'),
    token: TOKEN_F,
    tx: '8160',
    product: 'paper.paid',
    purchase: 26_000,
    signed: 26_500,
  }), 'queue account-deletion consumption request');
  const deletionClaim = jsonResult(actorScalar('service_role', null,
    'SELECT row_to_json(x) FROM public.iap_claim_consumption_request() AS x',
    'claim before account deletion'), 'claim before account deletion');
  expectOk(admin(`INSERT INTO public.account_deletion_requests (user_id, attempt_id, phase)
    VALUES (${q(F)}::uuid, ${q(ATTEMPT_F)}::uuid, 'solo_cleanup_complete')`), 'account deletion cancellation marker');
  expectOk(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(
    ${q(F)}::uuid, ${q(ATTEMPT_F)}::uuid)`), 'account deletion cancels Apple send');
  if (scalar(`SELECT status || '|' || (lease_token IS NULL)::text || '|'
      || (send_authorization_token IS NULL)::text
      FROM iap_private.apple_consumption_requests
      WHERE request_id = ${q(deletionClaim.request_id)}::uuid`, 'account deletion cancellation state') !== 'cancelled|true|true') {
    throw new Error('account deletion did not cancel an unauthorized in-flight send');
  }
  if (authorizeConsumption(deletionClaim) !== '') {
    throw new Error('account deletion left a send authorization usable');
  }
  for (const [notificationId, notificationType, event, signed, revocationType] of [
    ['79000000-0000-4000-8000-000000000071', 'REFUND', 'refund', 26_700, 'REFUND_FULL'],
    ['79000000-0000-4000-8000-000000000072', 'REVOKE', 'revoke', 26_800, 'FAMILY_REVOKE'],
    ['79000000-0000-4000-8000-000000000073', 'REFUND_REVERSED', 'refund_reversed', 26_900, 'REFUND_FULL'],
  ]) {
    const result = jsonResult(expectOk(processVerifiedNotification({
      notificationId,
      notificationType,
      tx: '8160',
      product: 'paper.paid',
      purchase: 26_000,
      signed,
      event,
      revocationType,
    }), `deleted-account tokenless ${notificationType}`),
    `deleted-account tokenless ${notificationType}`);
    if (result.transaction_applied !== false) {
      throw new Error(`${notificationType} restored state for a deleted account`);
    }
  }
  if (scalar(`SELECT count(*)::text
      FROM iap_private.apple_transaction_review_facts
      WHERE notification_uuid IN (
        '79000000-0000-4000-8000-000000000071'::uuid,
        '79000000-0000-4000-8000-000000000072'::uuid,
        '79000000-0000-4000-8000-000000000073'::uuid
      ) AND reason_code = 'ACCOUNT_DELETED'`,
  'deleted-account bounded refund evidence') !== '3') {
    throw new Error('deleted-account refund/revoke evidence was not durably bounded');
  }
  if (scalar(`SELECT signed_at = to_timestamp(26000 / 1000.0)
        AND last_event_kind = 'purchase'
      FROM iap_private.apple_transactions
      WHERE environment = 'Production' AND transaction_id = '8160'`,
  'deleted-account transaction remains unchanged') !== 't') {
    throw new Error('a deleted-account notification mutated or re-granted its transaction');
  }
  for (const [notificationId, notificationType, event, signed, revocationType] of [
    ['79000000-0000-4000-8000-000000000074', 'REFUND', 'refund', 27_000, 'REFUND_FULL'],
    ['79000000-0000-4000-8000-000000000075', 'REVOKE', 'revoke', 27_100, 'FAMILY_REVOKE'],
    ['79000000-0000-4000-8000-000000000076', 'REFUND_REVERSED', 'refund_reversed', 27_200, 'REFUND_FULL'],
  ]) {
    const result = jsonResult(expectOk(processVerifiedNotification({
      notificationId,
      notificationType,
      tx: '8160',
      product: 'paper.paid',
      purchase: 26_000,
      signed,
      event,
      revocationType,
      token: TOKEN_F,
    }), `deleted-account token-bound ${notificationType}`),
    `deleted-account token-bound ${notificationType}`);
    if (result.transaction_applied !== false) {
      throw new Error(`${notificationType} restored state for a deleted token-bound account`);
    }
  }
  if (scalar(`SELECT count(*)::text
      FROM iap_private.apple_transaction_review_facts
      WHERE notification_uuid IN (
        '79000000-0000-4000-8000-000000000074'::uuid,
        '79000000-0000-4000-8000-000000000075'::uuid,
        '79000000-0000-4000-8000-000000000076'::uuid
      ) AND reason_code = 'ACCOUNT_DELETED'`,
  'deleted-account token-bound refund evidence') !== '3') {
    throw new Error('deleted token-bound account refund/revoke evidence was not durably bounded');
  }

  // Verified transaction ingestion grants an entitlement/accounting lot only.
  // Delivery evidence appears solely after a service-owned fulfillment success.
  expectOk(callApplyV2({
    tx: '8170', product: 'paper.paid', purchase: 27_000, signed: 27_000,
  }), 'non-consumable registration is not delivery');
  if (scalar(`SELECT count(*)::text FROM iap_private.fulfillment_usage_evidence
      WHERE environment = 'Production' AND source_transaction_id = '8170'
        AND delivery_status = 'DELIVERED'`, 'no automatic non-consumable delivery') !== '0') {
    throw new Error('transaction ingest fabricated non-consumable delivery evidence');
  }
  expectOk(recordDelivery({ tx: '8170', entity: 'paper-8170-delivery', idempotency: 'paper-8170-delivery' }), 'service confirms non-consumable delivery');

  expectOk(callApplyV2({
    tx: '8171', environment: 'Xcode', purchase: 27_100, signed: 27_100,
  }), 'export credit registration is not delivery');
  if (scalar(`SELECT count(*)::text FROM iap_private.fulfillment_usage_evidence
      WHERE environment = 'Xcode' AND source_transaction_id = '8171'
        AND delivery_status = 'DELIVERED'`, 'no automatic consumable delivery') !== '0') {
    throw new Error('transaction ingest fabricated consumable delivery evidence');
  }
  const fulfilledExportReservation = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_export_credit_reserve(
      'Xcode', 1, '79000000-0000-4000-8000-000000000109'::uuid
    ) AS x`, 'reserve export awaiting server fulfillment'), 'reserve export awaiting fulfillment');
  expectFail(asActor('authenticated', E, `SELECT * FROM public.iap_export_credit_commit(
    ${q(fulfilledExportReservation.reservation_id)}::uuid)`), 'authenticated client cannot commit export delivery');
  expectFail(asActor('authenticated', E, `SELECT * FROM public.iap_export_credit_commit_after_fulfillment(
    ${q(fulfilledExportReservation.reservation_id)}::uuid,
    ${q(sha('book-8171-pdf'))}, ${q(sha('book-8171-export'))}, FALSE
  )`), 'authenticated client cannot invoke server fulfillment commit');
  expectOk(commitAfterFulfillment({
    reservationId: fulfilledExportReservation.reservation_id,
    entity: 'book-8171-pdf',
    idempotency: 'book-8171-export',
  }), 'service commits export after PDF fulfillment');
  if (scalar(`SELECT count(*)::text FROM iap_private.fulfillment_usage_evidence
      WHERE environment = 'Xcode' AND event_kind = 'export_committed'
        AND delivery_status = 'DELIVERED'
        AND entity_hash = ${q(sha('book-8171-pdf'))}`, 'server export delivery evidence') !== '1') {
    throw new Error('server fulfillment commit did not retain exact delivery evidence');
  }

  const reserveA = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_export_credit_reserve('Production', 1, '79000000-0000-4000-8000-000000000201'::uuid) AS x`, 'reserve exact purchase A'), 'reserve exact purchase A');
  expectFail(asActor('authenticated', E, `SELECT *
    FROM public.iap_export_credit_reserve(
      'Production', 2, '79000000-0000-4000-8000-000000000201'::uuid
    )`), 'reservation idempotency key rejects a different amount');
  if (scalar(`SELECT source_transaction_id FROM iap_private.export_credit_allocations
    WHERE reservation_id = ${q(reserveA.reservation_id)}::uuid`, 'reserved source transaction A') !== '8101') {
    throw new Error('FIFO reservation did not pin purchase A');
  }
  expectOk(commitAfterFulfillment({
    reservationId: reserveA.reservation_id,
    entity: 'book-reserve-a-pdf',
    idempotency: 'book-reserve-a-export',
  }), 'commit exact purchase A after server fulfillment');
  expectOk(callApplyV2({
    tx: '8101', signed: 30_000, revoke: 30_000, event: 'refund',
    revocationType: 'REFUND_FULL', revocationPercentage: 100_000,
  }), 'refund used purchase A');
  if (actorScalar('authenticated', E, "SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1", 'purchase B survives A refund') !== '1') {
    throw new Error('refunding purchase A consumed or reclaimed purchase B');
  }
  if (scalar("SELECT reclaimed_milliunits::text FROM iap_private.export_credit_lots WHERE environment = 'Production' AND source_transaction_id = '8102'", 'purchase B reclaim isolation') !== '0') {
    throw new Error('purchase B was mutated by purchase A refund');
  }
  expectOk(callApplyV2({ tx: '8101', signed: 31_000, event: 'refund_reversed' }), 'reverse used purchase A refund');
  if (actorScalar('authenticated', E, "SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1", 'used refund reversal balance') !== '1') {
    throw new Error('refund reversal restored units that the refund never removed');
  }

  expectOk(callApplyV2({ tx: '8201', purchase: 40_000, signed: 40_000, quantity: 3 }), 'quantity-three consumable purchase');
  expectOk(callApplyV2({
    tx: '8201', purchase: 40_000, signed: 41_000, revoke: 41_000, event: 'refund', quantity: 3,
    revocationType: 'REFUND_PRORATED', revocationPercentage: 33_333,
  }), 'partial consumable refund');
  if (scalar("SELECT refund_target_milliunits::text || '|' || reclaimed_milliunits::text FROM iap_private.export_credit_lots WHERE environment = 'Production' AND source_transaction_id = '8201'", 'partial refund milliunit state') !== '99999|99999') {
    throw new Error('partial refund did not use deterministic integer milliunits');
  }
  if (actorScalar('authenticated', E, "SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1", 'partial refund whole-credit projection') !== '3') {
    throw new Error('partial refund whole-credit projection is inconsistent');
  }

  expectOk(callApplyV2({ tx: '8202', purchase: 42_000, signed: 42_000 }), 'full-refund fixture purchase');
  const beforeFullRefund = Number(actorScalar('authenticated', E, "SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1", 'balance before full refund'));
  expectOk(callApplyV2({
    tx: '8202', purchase: 42_000, signed: 43_000, revoke: 43_000, event: 'refund',
    revocationType: 'REFUND_FULL', revocationPercentage: 100_000,
  }), 'full consumable refund');
  if (Number(actorScalar('authenticated', E, "SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1", 'balance after full refund')) !== beforeFullRefund - 1) {
    throw new Error('full refund did not reclaim its exact unused lot');
  }
  expectOk(callApplyV2({ tx: '8202', purchase: 42_000, signed: 44_000, event: 'refund_reversed' }), 'full refund reversal');
  if (Number(actorScalar('authenticated', E, "SELECT export_credits::text FROM public.iap_get_state('Production') LIMIT 1", 'balance after full reversal')) !== beforeFullRefund) {
    throw new Error('full refund reversal did not restore exactly the prior removal');
  }
  const reversalReplay = jsonResult(expectOk(callApplyV2({
    tx: '8202', purchase: 42_000, signed: 44_000, event: 'refund_reversed',
  }), 'refund reversal replay'), 'refund reversal replay');
  if (reversalReplay.duplicate !== true) throw new Error('transaction event replay was not idempotent');
  expectFail(callApplyV2({
    tx: '8202', purchase: 42_000, signed: 44_000, event: 'refund_reversed', hash: sha('event-time-collision'),
  }), 'transaction signedDate/hash collision');

  const refundFirst = jsonResult(expectOk(callApplyV2({
    tx: '8301', purchase: 50_000, signed: 51_000, revoke: 51_000, event: 'refund',
    revocationType: 'REFUND_FULL', revocationPercentage: 100_000,
  }), 'refund-first unknown source'), 'refund-first unknown source');
  const reversalFirst = jsonResult(expectOk(callApplyV2({
    tx: '8302', purchase: 52_000, signed: 53_000, event: 'refund_reversed',
  }), 'reversal-first unknown source'), 'reversal-first unknown source');
  if (refundFirst.resolution_status !== 'manual_review' || reversalFirst.resolution_status !== 'manual_review') {
    throw new Error('unknown out-of-order source was guessed instead of held for manual review');
  }

  const exactReservation = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_export_credit_reserve('Production', 2, '79000000-0000-4000-8000-000000000202'::uuid) AS x`, 'multi-lot exact reservation'), 'multi-lot exact reservation');
  if (scalar(`SELECT sum(milliunits)::text FROM iap_private.export_credit_allocations
    WHERE reservation_id = ${q(exactReservation.reservation_id)}::uuid`, 'exact reservation allocation sum') !== '200000') {
    throw new Error('reservation did not allocate its exact milliunits');
  }
  expectOk(asActor('authenticated', E, `SELECT * FROM public.iap_export_credit_release(${q(exactReservation.reservation_id)}::uuid)`), 'release exact allocations');
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_allocations
    WHERE reservation_id = ${q(exactReservation.reservation_id)}::uuid AND status = 'released'`, 'released exact allocation states') === '0') {
    throw new Error('release did not update the pinned allocations');
  }
  const commitReservation = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_export_credit_reserve('Production', 2, '79000000-0000-4000-8000-000000000203'::uuid) AS x`, 'commit exact allocations'), 'commit exact allocations');
  expectOk(commitAfterFulfillment({
    reservationId: commitReservation.reservation_id,
    entity: 'book-multi-lot-pdf',
    idempotency: 'book-multi-lot-export',
  }), 'commit pinned allocations after server fulfillment');
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_allocations
    WHERE reservation_id = ${q(commitReservation.reservation_id)}::uuid AND status <> 'committed'`, 'committed exact allocation states') !== '0') {
    throw new Error('commit did not update only its pinned allocations');
  }

  expectOk(callApplyV2({ tx: '8401', environment: 'Xcode', purchase: 60_000, signed: 60_000 }), 'concurrent reservation fixture');
  const concurrentReservations = await Promise.all([
    asActorAsync('authenticated', E, "SELECT * FROM public.iap_export_credit_reserve('Xcode', 1, '79000000-0000-4000-8000-000000000204'::uuid)"),
    asActorAsync('authenticated', E, "SELECT * FROM public.iap_export_credit_reserve('Xcode', 1, '79000000-0000-4000-8000-000000000205'::uuid)"),
  ]);
  if (concurrentReservations.filter((result) => result.status === 0).length !== 1) {
    throw new Error('concurrent exact reservations overspent one transaction lot');
  }
  checks += 1;

  expectOk(callApplyV2({
    user: B,
    token: otherAccountToken,
    tx: '8980',
    product: 'paper.paid',
    purchase: 60_500,
    signed: 60_500,
  }), 'reconciliation conflicting-owner fixture');

  expectFail(asActor('anon', null,
    'SELECT * FROM public.iap_claim_reconciliation_targets(1)'),
  'anon reconciliation claim');
  expectFail(asActor('authenticated', E,
    'SELECT * FROM public.iap_claim_reconciliation_targets(1)'),
  'authenticated reconciliation claim');
  expectFail(asActor('service_role', null,
    'SELECT * FROM public.iap_claim_reconciliation_targets(3)'),
  'oversized reconciliation claim');
  const reconciliationAnchorCount = scalar(`SELECT count(*)::text FROM (
      SELECT DISTINCT transaction.environment, transaction.original_transaction_id
      FROM iap_private.apple_transactions AS transaction
      WHERE transaction.environment IN ('Sandbox', 'Production')
    ) AS anchor`, 'Apple reconciliation anchor chains');
  if (scalar(`SELECT count(*)::text
      FROM iap_private.apple_reconciliation_checkpoints`,
  'trigger-seeded reconciliation checkpoints') !== reconciliationAnchorCount) {
    throw new Error('reconciliation checkpoints were not seeded once per original transaction chain');
  }
  if (scalar(`SELECT count(*)::text FROM (
      SELECT transaction.billing_account_id, transaction.environment
      FROM iap_private.apple_transactions AS transaction
      WHERE transaction.environment IN ('Sandbox', 'Production')
      GROUP BY transaction.billing_account_id, transaction.environment
      HAVING count(DISTINCT transaction.original_transaction_id) > 1
    ) AS multi_chain`, 'multi-chain Apple customer fixture') === '0') {
    throw new Error('reconciliation test lacks a customer with multiple transaction chains');
  }
  const claimableReconciliationCount = Number(scalar(`SELECT count(*)::text
      FROM iap_private.apple_reconciliation_checkpoints AS checkpoint
      WHERE checkpoint.next_attempt_at <= clock_timestamp()`,
  'claimable reconciliation checkpoint count'));
  const completedReconciliation = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(target)
    FROM public.iap_claim_reconciliation_targets(1) AS target`,
  'first single reconciliation claim'), 'first single reconciliation claim');
  const failedReconciliation = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(target)
    FROM public.iap_claim_reconciliation_targets(1) AS target`,
  'second single reconciliation claim'), 'second single reconciliation claim');
  const emptyReconciliation = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(target)
    FROM public.iap_claim_reconciliation_targets(1) AS target`,
  'third single reconciliation claim'), 'third single reconciliation claim');
  if (claimableReconciliationCount < 3
      || completedReconciliation.checkpoint_id === failedReconciliation.checkpoint_id
      || completedReconciliation.checkpoint_id === emptyReconciliation.checkpoint_id
      || failedReconciliation.checkpoint_id === emptyReconciliation.checkpoint_id
      || 'user_id' in completedReconciliation
      || 'app_account_token_hash' in completedReconciliation) {
    throw new Error('single-anchor claims leaked app-account identity or reused an active lease');
  }
  expectFail(asActor('service_role', null, `SELECT public.iap_fail_reconciliation_target(
      ${q(completedReconciliation.checkpoint_id)}::uuid,
      '20000000-0000-4000-8000-000000000099'::uuid,
      'RECONCILIATION_TARGET_FAILED'
    )`), 'wrong reconciliation lease completion');
  if (scalar(`SELECT count(*)::text
      FROM iap_private.apple_account_bindings AS binding
      WHERE binding.app_account_token_hash IN (${q(tokenHash(otherAccountToken))}, ${q(tokenHash(TOKEN_E))})
        AND binding.deleted_at IS NULL`, 'active mixed-account reconciliation bindings') !== '2') {
    throw new Error('reconciliation fixture lacks two distinct active app-account tokens');
  }
  if (scalar(`SELECT count(*)::text
      FROM iap_private.apple_account_bindings AS binding
      WHERE binding.app_account_token_hash = ${q(tokenHash(TOKEN_F))}
        AND binding.deleted_at IS NOT NULL`, 'deleted reconciliation binding') !== '1') {
    throw new Error('reconciliation fixture lacks a durable deleted-token binding');
  }
  const reconciliationPage = [
    {
      transactionId: '8997', originalTransactionId: '8997',
      productId: 'paper.paid', productType: 'Non-Consumable',
      bundleId: 'app.gomsinlog', appAccountTokenHash: tokenHash(TOKEN_E),
      purchaseDateMs: 61_000, signedDateMs: 61_000,
      expiresDateMs: null, revocationDateMs: null, eventKind: 'purchase',
      jwsSha256: sha('reconciliation-active-8997'), quantity: 1,
      revocationType: null, revocationPercentage: null,
    },
    {
      transactionId: '8994', originalTransactionId: '8994',
      productId: 'paper.paid', productType: 'Non-Consumable',
      bundleId: 'app.gomsinlog', appAccountTokenHash: tokenHash(otherAccountToken),
      purchaseDateMs: 61_500, signedDateMs: 61_500,
      expiresDateMs: null, revocationDateMs: null, eventKind: 'purchase',
      jwsSha256: sha('reconciliation-second-active-8994'), quantity: 1,
      revocationType: null, revocationPercentage: null,
    },
    {
      transactionId: '8993', originalTransactionId: '8993',
      productId: 'paper.paid', productType: 'Non-Consumable',
      bundleId: 'app.gomsinlog', appAccountTokenHash: tokenHash(TOKEN_F),
      purchaseDateMs: 61_750, signedDateMs: 61_750,
      expiresDateMs: null, revocationDateMs: null, eventKind: 'purchase',
      jwsSha256: sha('reconciliation-deleted-8993'), quantity: 1,
      revocationType: null, revocationPercentage: null,
    },
    {
      transactionId: '8992', originalTransactionId: '8980',
      productId: 'export.3', productType: 'Consumable',
      bundleId: 'app.gomsinlog', appAccountTokenHash: tokenHash(TOKEN_E),
      purchaseDateMs: 64_000, signedDateMs: 64_000,
      expiresDateMs: null, revocationDateMs: null, eventKind: 'purchase',
      jwsSha256: sha('reconciliation-owner-conflict-8992'), quantity: 1,
      revocationType: null, revocationPercentage: null,
    },
    {
      transactionId: '8998', originalTransactionId: '8998',
      productId: 'paper.paid', productType: 'Non-Consumable',
      bundleId: 'app.gomsinlog', appAccountTokenHash: sha('unknown-account-token'),
      purchaseDateMs: 62_000, signedDateMs: 62_000,
      expiresDateMs: null, revocationDateMs: null, eventKind: 'purchase',
      jwsSha256: sha('reconciliation-unknown-8998'), quantity: 1,
      revocationType: null, revocationPercentage: null,
    },
    {
      transactionId: '8999', originalTransactionId: '8999',
      productId: 'paper.paid', productType: 'Non-Consumable',
      bundleId: 'app.gomsinlog', appAccountTokenHash: null,
      purchaseDateMs: 63_000, signedDateMs: 63_000,
      expiresDateMs: null, revocationDateMs: null, eventKind: 'purchase',
      jwsSha256: sha('reconciliation-tokenless-8999'), quantity: 1,
      revocationType: null, revocationPercentage: null,
    },
  ];
  expectFail(asActor('authenticated', E, `SELECT *
    FROM public.iap_settle_reconciliation_page(
      ${q(completedReconciliation.checkpoint_id)}::uuid,
      ${q(completedReconciliation.lease_token)}::uuid,
      ${q(completedReconciliation.environment)}, NULL,
      'revision-page-1', TRUE, ${q(JSON.stringify(reconciliationPage))}::jsonb
    )`), 'authenticated reconciliation page settlement');
  expectFail(asActor('service_role', null, `SELECT *
    FROM public.iap_settle_reconciliation_page(
      ${q(completedReconciliation.checkpoint_id)}::uuid,
      '20000000-0000-4000-8000-000000000099'::uuid,
      ${q(completedReconciliation.environment)}, NULL,
      'revision-page-1', TRUE, ${q(JSON.stringify(reconciliationPage))}::jsonb
    )`), 'wrong-lease reconciliation page settlement');
  const reconciliationSettlement = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(result)
    FROM public.iap_settle_reconciliation_page(
      ${q(completedReconciliation.checkpoint_id)}::uuid,
      ${q(completedReconciliation.lease_token)}::uuid,
      ${q(completedReconciliation.environment)}, NULL,
      'revision-page-1', TRUE, ${q(JSON.stringify(reconciliationPage))}::jsonb
    ) AS result`, 'atomic reconciliation page settlement'), 'atomic reconciliation page settlement');
  if (reconciliationSettlement.applied_count !== 2
      || reconciliationSettlement.reviewed_count !== 4) {
    throw new Error(`reconciliation page was not fully applied or durably reviewed (${JSON.stringify(reconciliationSettlement)})`);
  }
  const reconciledOwners = scalar(`SELECT string_agg(
        transaction.transaction_id || ':' || binding.app_account_token_hash,
        ',' ORDER BY transaction.transaction_id)
      FROM iap_private.apple_transactions AS transaction
      JOIN iap_private.apple_account_bindings AS binding
        ON binding.billing_account_id = transaction.billing_account_id
      WHERE transaction.environment = ${q(completedReconciliation.environment)}
        AND transaction.transaction_id IN ('8994', '8997')`,
  'mixed-account reconciled transaction owners');
  if (reconciledOwners !== `8994:${tokenHash(otherAccountToken)},8997:${tokenHash(TOKEN_E)}`) {
    throw new Error('reconciliation attributed mixed Apple history to the anchor instead of each token owner');
  }
  if (scalar(`SELECT count(*)::text
      FROM iap_private.apple_transaction_review_facts AS review
      WHERE review.reconciliation_checkpoint_id = ${q(completedReconciliation.checkpoint_id)}::uuid
        AND review.transaction_id IN ('8992', '8993', '8998', '8999')
        AND review.purchase_date_ms IS NOT NULL
        AND review.quantity = 1`, 'complete reconciliation review evidence') !== '4') {
    throw new Error('reconciliation review facts omitted deterministic recovery metadata');
  }
  if (scalar(`SELECT string_agg(review.transaction_id || ':' || review.reason_code, ','
        ORDER BY review.transaction_id)
      FROM iap_private.apple_transaction_review_facts AS review
      WHERE review.reconciliation_checkpoint_id = ${q(completedReconciliation.checkpoint_id)}::uuid
        AND review.transaction_id IN ('8992', '8993', '8998', '8999')`,
  'reconciliation review reason isolation') !==
      '8992:IDENTITY_AMBIGUOUS,8993:ACCOUNT_DELETED,8998:TOKEN_BINDING_UNKNOWN,8999:TOKEN_BINDING_MISSING') {
    throw new Error('reconciliation did not isolate conflicting, deleted, unknown, and missing tokens distinctly');
  }
  const settledTransactionCount = scalar(`SELECT count(*)::text
      FROM iap_private.apple_transactions
      WHERE environment = ${q(completedReconciliation.environment)}
        AND transaction_id IN ('8994', '8997')`,
  'settled transaction count before response-loss replay');
  const settledReviewCount = scalar(`SELECT count(*)::text
      FROM iap_private.apple_transaction_review_facts
      WHERE reconciliation_checkpoint_id = ${q(completedReconciliation.checkpoint_id)}::uuid
        AND transaction_id IN ('8992', '8993', '8998', '8999')`,
  'settled review count before response-loss replay');
  const responseLossReplay = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(result)
    FROM public.iap_settle_reconciliation_page(
      ${q(completedReconciliation.checkpoint_id)}::uuid,
      ${q(completedReconciliation.lease_token)}::uuid,
      ${q(completedReconciliation.environment)}, NULL,
      'revision-page-1', TRUE, ${q(JSON.stringify(reconciliationPage))}::jsonb
    ) AS result`, 'settlement response-loss replay'), 'settlement response-loss replay');
  if (responseLossReplay.applied_count !== 2 || responseLossReplay.reviewed_count !== 4
      || scalar(`SELECT count(*)::text FROM iap_private.apple_transactions
          WHERE environment = ${q(completedReconciliation.environment)}
            AND transaction_id IN ('8994', '8997')`,
      'settled transaction count after response-loss replay') !== settledTransactionCount
      || scalar(`SELECT count(*)::text FROM iap_private.apple_transaction_review_facts
          WHERE reconciliation_checkpoint_id = ${q(completedReconciliation.checkpoint_id)}::uuid
            AND transaction_id IN ('8992', '8993', '8998', '8999')`,
      'settled review count after response-loss replay') !== settledReviewCount) {
    throw new Error('reconciliation response-loss replay duplicated or lost page effects');
  }
  expectOk(admin(`UPDATE iap_private.apple_reconciliation_checkpoints
      SET next_revision = 'revision-prior'
      WHERE checkpoint_id = ${q(failedReconciliation.checkpoint_id)}::uuid`),
  'seed prior reconciliation cursor');
  expectFail(asActor('service_role', null, `SELECT *
    FROM public.iap_settle_reconciliation_page(
      ${q(failedReconciliation.checkpoint_id)}::uuid,
      ${q(failedReconciliation.lease_token)}::uuid,
      ${q(failedReconciliation.environment)}, 'revision-stale',
      'revision-never-committed', FALSE, '[]'::jsonb
    )`), 'stale expected reconciliation revision');
  const invalidReconciliationPage = [
    {
      ...reconciliationPage[0],
      transactionId: '8996', originalTransactionId: '8996',
      jwsSha256: sha('reconciliation-rollback-8996'),
    },
    {
      ...reconciliationPage[0],
      transactionId: '8995', originalTransactionId: '8995',
      productId: 'not.in.reviewed.catalog',
      jwsSha256: sha('reconciliation-invalid-8995'),
    },
  ];
  expectFail(asActor('service_role', null, `SELECT *
    FROM public.iap_settle_reconciliation_page(
      ${q(failedReconciliation.checkpoint_id)}::uuid,
      ${q(failedReconciliation.lease_token)}::uuid,
      ${q(failedReconciliation.environment)}, 'revision-prior',
      'revision-never-committed', FALSE,
      ${q(JSON.stringify(invalidReconciliationPage))}::jsonb
    )`), 'atomic reconciliation page rollback');
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_transactions
      WHERE environment = ${q(failedReconciliation.environment)}
        AND transaction_id = '8996'`, 'rolled-back reconciliation transaction') !== '0') {
    throw new Error('a partial reconciliation page escaped its failed transaction');
  }
  expectOk(asActor('service_role', null, `SELECT public.iap_fail_reconciliation_target(
      ${q(failedReconciliation.checkpoint_id)}::uuid,
      ${q(failedReconciliation.lease_token)}::uuid,
      'RECONCILIATION_TARGET_FAILED'
    )`), 'failed reconciliation completion');
  const emptyExpectedRevision = emptyReconciliation.next_revision === null
    ? 'NULL'
    : q(emptyReconciliation.next_revision);
  const emptySettlement = jsonResult(actorScalar('service_role', null, `SELECT row_to_json(result)
    FROM public.iap_settle_reconciliation_page(
      ${q(emptyReconciliation.checkpoint_id)}::uuid,
      ${q(emptyReconciliation.lease_token)}::uuid,
      ${q(emptyReconciliation.environment)}, ${emptyExpectedRevision},
      'revision-empty-page', FALSE, '[]'::jsonb
    ) AS result`, 'empty reconciliation page settlement'), 'empty reconciliation page settlement');
  if (emptySettlement.applied_count !== 0 || emptySettlement.reviewed_count !== 0) {
    throw new Error('empty reconciliation page did not settle atomically');
  }
  if (scalar(`SELECT count(*)::text FROM iap_private.apple_reconciliation_checkpoints
      WHERE checkpoint_id IN (
        ${q(completedReconciliation.checkpoint_id)}::uuid,
        ${q(failedReconciliation.checkpoint_id)}::uuid,
        ${q(emptyReconciliation.checkpoint_id)}::uuid
      ) AND lease_token IS NULL AND lease_expires_at IS NULL`,
  'completed reconciliation leases cleared') !== '3') {
    throw new Error('reconciliation completion left a live lease');
  }
  if (scalar(`SELECT last_error_code FROM iap_private.apple_reconciliation_checkpoints
      WHERE checkpoint_id = ${q(failedReconciliation.checkpoint_id)}::uuid`,
  'failed reconciliation reason') !== 'RECONCILIATION_TARGET_FAILED') {
    throw new Error('reconciliation failure did not retain its bounded reason');
  }
  if (scalar(`SELECT next_revision FROM iap_private.apple_reconciliation_checkpoints
      WHERE checkpoint_id = ${q(completedReconciliation.checkpoint_id)}::uuid`,
  'successful reconciliation cursor') !== 'revision-page-1') {
    throw new Error('successful reconciliation did not durably advance its revision cursor');
  }
  if (scalar(`SELECT next_revision FROM iap_private.apple_reconciliation_checkpoints
      WHERE checkpoint_id = ${q(failedReconciliation.checkpoint_id)}::uuid`,
  'failed reconciliation cursor preservation') !== 'revision-prior') {
    throw new Error('failed reconciliation advanced or erased its prior revision cursor');
  }
  if (scalar(`SELECT next_revision FROM iap_private.apple_reconciliation_checkpoints
      WHERE checkpoint_id = ${q(emptyReconciliation.checkpoint_id)}::uuid`,
  'empty reconciliation cursor') !== 'revision-empty-page') {
    throw new Error('empty reconciliation page did not advance its cursor atomically');
  }

  const deleteReservation = jsonResult(actorScalar('authenticated', E, `SELECT row_to_json(x)
    FROM public.iap_export_credit_reserve('Production', 1, '79000000-0000-4000-8000-000000000206'::uuid) AS x`, 'reserve before account deletion'), 'reserve before account deletion');
  const attemptE = '79000000-0000-4000-8000-000000000301';
  expectOk(admin(`INSERT INTO public.account_deletion_requests (user_id, attempt_id, phase)
    VALUES (${q(E)}::uuid, ${q(attemptE)}::uuid, 'solo_cleanup_complete')`), 'migration 079 account deletion marker');
  expectOk(asActor('service_role', null, `SELECT * FROM public.iap_prepare_account_deletion_v2(${q(E)}::uuid, ${q(attemptE)}::uuid)`), 'migration 079 account deletion prep');
  if (scalar(`SELECT count(*)::text FROM iap_private.export_credit_allocations
    WHERE reservation_id = ${q(deleteReservation.reservation_id)}::uuid AND status = 'released'`, 'deletion allocation release') === '0') {
    throw new Error('account deletion left exact allocations reserved');
  }
  if (scalar(`SELECT count(*)::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'iap_private'
        AND c.relname IN (
          'refund_data_consent_events','fulfillment_usage_evidence',
          'apple_consumption_requests','apple_reconciliation_checkpoints'
        )
        AND a.attname IN ('user_id','raw_jws','payload') AND NOT a.attisdropped`, 'minimal refund evidence columns') !== '0') {
    throw new Error('refund evidence schema retained user content, raw JWS, or direct user identity');
  }
  if (scalar(`SELECT count(*)::text FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'iap_private')
        AND p.proname IN (
          'iap_refresh_consumption_request', 'iap_claim_consumption_request',
          'iap_authorize_consumption_send', 'iap_complete_consumption_request',
          'iap_export_credit_commit_after_fulfillment',
          'iap_claim_reconciliation_targets', 'iap_fail_reconciliation_target',
          'iap_record_reconciliation_review', 'iap_settle_reconciliation_page'
        )
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=public, pg_temp']`, 'new IAP definer search paths') !== '9') {
    throw new Error('new IAP SECURITY DEFINER functions lack a fixed search_path');
  }
  if (scalar(`SELECT
      has_function_privilege('anon', 'public.iap_authorize_consumption_send(uuid,uuid)', 'EXECUTE')::text
      || '|' || has_function_privilege('authenticated', 'public.iap_authorize_consumption_send(uuid,uuid)', 'EXECUTE')::text
      || '|' || has_function_privilege('service_role', 'public.iap_authorize_consumption_send(uuid,uuid)', 'EXECUTE')::text
      || '|' || has_function_privilege('authenticated', 'public.iap_export_credit_commit(uuid)', 'EXECUTE')::text
      || '|' || has_function_privilege('service_role', 'public.iap_export_credit_commit_after_fulfillment(uuid,text,text,boolean)', 'EXECUTE')::text
      || '|' || has_function_privilege('authenticated', 'public.iap_claim_reconciliation_targets(integer)', 'EXECUTE')::text
      || '|' || has_function_privilege('service_role', 'public.iap_claim_reconciliation_targets(integer)', 'EXECUTE')::text
      || '|' || has_function_privilege('service_role', 'public.iap_fail_reconciliation_target(uuid,uuid,text)', 'EXECUTE')::text
      || '|' || has_function_privilege('authenticated', 'public.iap_settle_reconciliation_page(uuid,uuid,text,text,text,boolean,jsonb)', 'EXECUTE')::text
      || '|' || has_function_privilege('service_role', 'public.iap_settle_reconciliation_page(uuid,uuid,text,text,text,boolean,jsonb)', 'EXECUTE')::text
      || '|' || has_function_privilege('authenticated', 'public.iap_record_reconciliation_review(uuid,uuid,text,text,text,text,text,text,text,bigint,text,text,bigint,bigint,bigint,integer,text,integer,text)', 'EXECUTE')::text
      || '|' || has_function_privilege('service_role', 'public.iap_record_reconciliation_review(uuid,uuid,text,text,text,text,text,text,text,bigint,text,text,bigint,bigint,bigint,integer,text,integer,text)', 'EXECUTE')::text`, 'IAP function privilege matrix') !== 'false|false|true|false|true|false|true|true|false|true|false|true') {
    throw new Error('IAP send authorization or fulfillment commit grants are unsafe');
  }

  // Re-check the contract after every V2 assertion. 081 and 082 were applied
  // above in numeric order; no test gets to hide an accidental V1 re-grant.
  const contractPrivileges = scalar(`SELECT
    has_function_privilege(
      'service_role',
      'public.iap_apply_verified_transaction(uuid,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,uuid,uuid)',
      'EXECUTE'
    )::text || '|' || has_function_privilege(
      'service_role',
      'public.iap_process_verified_notification(uuid,text,text,text,text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text)',
      'EXECUTE'
    )::text`, 'migration 081 V1 service-role contract');
  if (contractPrivileges !== 'false|false') {
    throw new Error(`migration 081 did not retire exactly the V1 service paths (${contractPrivileges})`);
  }
  const contractV2Privileges = scalar(`SELECT
    has_function_privilege(
      'service_role',
      'public.iap_apply_verified_transaction_v2(uuid,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,integer,text,integer,uuid)',
      'EXECUTE'
    )::text || '|' || has_function_privilege(
      'service_role',
      'public.iap_process_verified_notification_v2(uuid,text,text,text,text,text,bigint,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,integer,text,integer)',
      'EXECUTE'
    )::text`, 'migration 081 V2 service-role continuity');
  if (contractV2Privileges !== 'true|true') {
    throw new Error(`migration 081 damaged V2 service paths (${contractV2Privileges})`);
  }
  if (scalar(`SELECT count(*)::text FROM pg_proc AS function
      JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
      WHERE namespace.nspname = 'public'
        AND function.proname IN ('iap_apply_verified_transaction', 'iap_process_verified_notification')`,
  'migration 081 keeps V1 owner helpers') !== '2') {
    throw new Error('migration 081 dropped a V1 function still needed by internal V2 projection');
  }
  expectFail(admin(`UPDATE iap_private.apple_product_catalog SET sale_enabled = TRUE
    WHERE environment = 'Production' AND product_id = 'paper.paid'`),
  'migration 081 preserves database sale hold');

  // Forward-only emergency rollback simulation: a future migration may restore
  // only these grants, while the 079 hold and V1-consumable quarantine survive.
  expectOk(admin(`
    GRANT EXECUTE ON FUNCTION public.iap_apply_verified_transaction(
      UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
      BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, UUID, UUID
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.iap_process_verified_notification(
      UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT,
      TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT,
      BIGINT, BIGINT, TEXT, TEXT
    ) TO service_role;
  `), 'simulate forward V1 grant restoration');
  const rollbackLegacy = jsonResult(expectOk(callApply({
    user: B,
    token: otherAccountToken,
    tx: '8792',
    product: 'app.gomsinlog.book.export.credit.1',
    purchase: 8_792,
    signed: 8_792,
    event: 'purchase',
    hash: sha('rollback-v1-consumable-8792'),
  }), 'forward rollback V1 consumable ingest'), 'forward rollback V1 consumable ingest');
  if (rollbackLegacy.accepted !== true
      || scalar(`SELECT credit_granted::text || '|' || resolution_status
          FROM iap_private.apple_transactions
          WHERE environment = 'Production' AND transaction_id = '8792'`,
      'forward rollback quarantine state') !== '0|legacy_manual_review') {
    throw new Error('forward V1 grant restoration bypassed legacy-consumable quarantine');
  }
  expectFail(admin(`UPDATE iap_private.apple_product_catalog SET sale_enabled = TRUE
    WHERE environment = 'Production' AND product_id = 'paper.paid'`),
  'forward rollback preserves database sale hold');
  expectOk(admin(`
    REVOKE EXECUTE ON FUNCTION public.iap_apply_verified_transaction(
      UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
      BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, UUID, UUID
    ) FROM service_role;
    REVOKE EXECUTE ON FUNCTION public.iap_process_verified_notification(
      UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT,
      TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT,
      BIGINT, BIGINT, TEXT, TEXT
    ) FROM service_role;
  `), 'restore migration 081 contract after rollback simulation');

  console.log(`PASS — Apple IAP ledger PostgreSQL actor harness: ${checks} assertions`);
  console.log('UNVERIFIED — remote Supabase catalog/migration state, Edge deployment, Apple verification keys, Sandbox/Production servers, and device/App Store behavior.');
} catch (error) {
  console.error(`FAIL — Apple IAP ledger harness after ${checks} assertions: ${error.message}`);
  process.exitCode = 1;
}
