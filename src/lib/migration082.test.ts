import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFunctionDefinitions } from '@/test/sqlModel';

const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
const original079 = readFileSync(
  resolve(migrationsDir, '079_apple_iap_refund_consumption.sql'),
  'utf8',
);
const migration = readFileSync(
  resolve(migrationsDir, '082_apple_iap_refund_reconciliation_forward_fix.sql'),
  'utf8',
);
const executable = migration.replace(/^\s*--.*$/gm, '');

function definition(signature: string) {
  const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  const found = parseFunctionDefinitions(migration)
    .find((candidate) => normalize(candidate.signature) === normalize(signature));
  expect(found, `${signature} must be defined by migration 082`).toBeDefined();
  return found!;
}

describe('migration 082 - forward-only Apple IAP reconciliation hardening', () => {
  it('pins migration 079 to its immutable reviewed content', () => {
    expect(createHash('sha256').update(original079).digest('hex')).toBe(
      'cda1defda9d197c91a997d0ff4e6f669e5edaa65dbd0fd5737ec69505d5dc132',
    );
  });

  it('fails closed unless original 079 and contract migration 081 are present', () => {
    expect(migration).toContain('unexpected or rewritten 079 schema');
    expect(migration).toContain('requires migration 081 V1 retirement first');
    expect(migration).toContain(
      "to_regprocedure(\n       'public.iap_acknowledge_transaction_review(uuid,text)'",
    );
    expect(migration).toMatch(
      /has_function_privilege\(\s*'service_role',[\s\S]*?iap_apply_verified_transaction\(uuid,text/i,
    );
  });

  it('preserves historical evidence without collecting new reason values', () => {
    expect(executable).not.toMatch(/DROP\s+(?:TABLE|COLUMN)\b/i);
    expect(executable).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/i);
    expect(migration).toMatch(
      /ALTER COLUMN consumption_request_reason DROP NOT NULL;/i,
    );
    expect(migration).not.toMatch(
      /SET\s+consumption_request_reason\s*=/i,
    );

    const process = definition(
      'public.iap_process_verified_notification_v2(uuid,text,text,text,text,text,bigint,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,integer,text,integer)',
    );
    const insert = /INSERT INTO iap_private\.apple_consumption_requests\s*\(([\s\S]*?)\)\s*VALUES/i
      .exec(process.body);
    expect(insert).not.toBeNull();
    expect(insert![1]).not.toContain('consumption_request_reason');
  });

  it('uses an explicit non-inferential code for unresolvable legacy reviews', () => {
    expect(migration).toContain("review_reason_code = 'LEGACY_REVIEW_UNSPECIFIED'");
    expect(migration).toContain('event.payload_hash, event.review_reason_code');
    expect(migration).toContain('conflicting immutable review evidence');
    expect(migration).toContain('review-fact backfill is incomplete');
  });

  it('replaces whitelist checks without an enforcement gap', () => {
    const addReview = migration.indexOf(
      'ADD CONSTRAINT apple_transaction_review_facts_event_kind_v2_check',
    );
    const validateReview = migration.indexOf(
      'VALIDATE CONSTRAINT apple_transaction_review_facts_event_kind_v2_check',
    );
    const dropReview = migration.indexOf(
      'DROP CONSTRAINT apple_transaction_review_facts_event_kind_check',
    );
    expect(addReview).toBeGreaterThanOrEqual(0);
    expect(validateReview).toBeGreaterThan(addReview);
    expect(dropReview).toBeGreaterThan(validateReview);

    const addStatus = migration.indexOf(
      'ADD CONSTRAINT apple_consumption_requests_status_v2_check',
    );
    const validateStatus = migration.indexOf(
      'VALIDATE CONSTRAINT apple_consumption_requests_status_v2_check',
    );
    const dropStatus = migration.indexOf(
      'DROP CONSTRAINT apple_consumption_requests_status_check',
    );
    expect(addStatus).toBeGreaterThanOrEqual(0);
    expect(validateStatus).toBeGreaterThan(addStatus);
    expect(dropStatus).toBeGreaterThan(validateStatus);
  });

  it('keeps old acknowledgement non-callable and makes the audited form service-only', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.iap_acknowledge_transaction_review\(UUID, TEXT\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.iap_acknowledge_transaction_review\(\s*UUID, TEXT, UUID, UUID\s*\) TO service_role;/,
    );
    expect(migration).toContain('restored an obsolete external contract');
  });

  it('keys reconciliation by Apple anchor chain rather than app billing account', () => {
    const table = /CREATE TABLE iap_private\.apple_reconciliation_checkpoints\s*\(([\s\S]*?)\n\);/i
      .exec(migration);
    expect(table).not.toBeNull();
    expect(table![1]).not.toContain('billing_account_id');
    expect(table![1]).toContain('anchor_original_transaction_id');
    expect(table![1]).toMatch(
      /UNIQUE\s*\(environment, anchor_original_transaction_id\)/i,
    );

    const claim = definition('public.iap_claim_reconciliation_targets(integer)');
    expect(claim.body).not.toContain('binding.user_id');
    expect(claim.body).not.toContain('app_account_token_hash');
    expect(claim.body).toContain('p_limit IS DISTINCT FROM 1');
  });

  it('settles the complete page and revision in one service-only transaction', () => {
    const settle = definition(
      'public.iap_settle_reconciliation_page(uuid,uuid,text,text,text,boolean,jsonb)',
    );
    expect(settle.body).toContain(
      'v_checkpoint.next_revision IS DISTINCT FROM p_expected_revision',
    );
    expect(settle.body).toContain('jsonb_array_length(p_transactions) NOT BETWEEN 0 AND 20');
    expect(settle.body).toContain('binding.app_account_token_hash = v_token_hash');
    expect(settle.body).toContain("v_reason_code := 'IDENTITY_AMBIGUOUS'");
    expect(settle.body).toContain('p_next_revision');
    expect(settle.body).toContain('last_completion_succeeded = TRUE');
    expect(settle.body).toContain(
      'v_checkpoint.last_completion_page_hash IS NOT DISTINCT FROM v_page_hash',
    );
    expect(settle.body).toContain('last_completion_applied_count = v_applied_count');
    expect(settle.body).toContain('last_completion_reviewed_count = v_reviewed_count');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.iap_settle_reconciliation_page\([\s\S]*?\) FROM PUBLIC, anon, authenticated, service_role;[\s\S]*?GRANT EXECUTE ON FUNCTION public\.iap_settle_reconciliation_page\([\s\S]*?\) TO service_role;/,
    );
  });

  it('retains enough pseudonymous review evidence for deterministic recovery', () => {
    for (const column of [
      'observed_app_account_token_hash',
      'purchase_date_ms',
      'expires_date_ms',
      'revocation_date_ms',
      'quantity',
      'revocation_type',
      'revocation_percentage',
    ]) {
      expect(migration).toContain(`ADD COLUMN ${column}`);
    }
    expect(migration).toContain("v_reason_code := 'TOKEN_BINDING_MISSING'");
    expect(migration).toContain("v_reason_code := 'TOKEN_BINDING_UNKNOWN'");
    expect(migration).toContain("v_reason_code := 'ACCOUNT_DELETED'");
    expect(migration).toContain("v_reason_code := 'IDENTITY_AMBIGUOUS'");
  });

  it('matches the account-deletion lock order before resolving an active token', () => {
    const settle = definition(
      'public.iap_settle_reconciliation_page(uuid,uuid,text,text,text,boolean,jsonb)',
    );
    const userFence = settle.body.indexOf(
      'hashtextextended(v_binding.user_id::TEXT, 15013)',
    );
    const bindingLock = settle.body.indexOf(
      'WHERE binding.app_account_token_hash = v_token_hash\n        FOR UPDATE',
    );
    const originalFence = settle.body.indexOf(
      "p_environment || ':' || v_original_transaction_id, 0",
    );
    expect(userFence).toBeGreaterThanOrEqual(0);
    expect(bindingLock).toBeGreaterThan(userFence);
    expect(originalFence).toBeGreaterThan(bindingLock);
  });

  it('uses a failure-only lease release that cannot advance a cursor', () => {
    const fail = definition('public.iap_fail_reconciliation_target(uuid,uuid,text)');
    expect(fail.body).not.toContain('p_next_revision');
    expect(fail.body).toContain('last_completion_succeeded = FALSE');
  });

  it('uses replace semantics for existing V2 functions and reloads PostgREST', () => {
    for (const signature of [
      'public.iap_list_operational_alerts()',
      'public.iap_export_credit_reserve(text,bigint,uuid)',
      'public.iap_apply_verified_transaction_v2(uuid,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,integer,text,integer,uuid)',
      'public.iap_process_verified_notification_v2(uuid,text,text,text,text,text,bigint,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,integer,text,integer)',
    ]) {
      expect(definition(signature).orReplace).toBe(true);
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    expect(migration.indexOf("NOTIFY pgrst, 'reload schema';"))
      .toBeLessThan(migration.lastIndexOf('COMMIT;'));
  });

  it('does not activate sales or expose reconciliation tables', () => {
    expect(executable).not.toMatch(/SET\s+sale_enabled\s*=\s*TRUE/i);
    expect(migration).toMatch(
      /ALTER TABLE iap_private\.apple_reconciliation_checkpoints ENABLE ROW LEVEL SECURITY;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE iap_private\.apple_reconciliation_checkpoints\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });
});
