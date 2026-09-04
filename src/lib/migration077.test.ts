import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFunctionDefinitions } from '@/test/sqlModel';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/077_apple_iap_server_ledger.sql',
);
const obsoleteMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/073_apple_iap_server_ledger.sql',
);

let migration = '';
try {
  migration = readFileSync(migrationPath, 'utf8');
} catch {
  // A missing migration is the intended RED state for this contract test.
}

function definition(signature: string) {
  const found = parseFunctionDefinitions(migration)
    .find((candidate) => candidate.signature.toLowerCase() === signature.toLowerCase());
  expect(found, `${signature} must be defined by migration 077`).toBeDefined();
  return found!;
}

function expectDeletionLockBeforeAuthorityReads(signature: string) {
  const body = definition(signature).body;
  const lockAt = body.indexOf('pg_advisory_xact_lock');
  const pendingAt = body.indexOf('is_account_deletion_pending');
  const bindingAt = body.search(
    /(?:FROM|INTO|UPDATE)\s+iap_private\.apple_account_bindings/i,
  );

  expect(lockAt, `${signature} must take the account-deletion lock`).toBeGreaterThanOrEqual(0);
  expect(body).toMatch(/hashtextextended\([^)]*15013\)/i);
  expect(pendingAt, `${signature} must recheck deletion after locking`).toBeGreaterThan(lockAt);
  if (bindingAt >= 0) {
    expect(bindingAt, `${signature} must not inspect the binding before locking`).toBeGreaterThan(lockAt);
  }
}

describe('migration 077 Apple IAP account-deletion fencing', () => {
  it('uses one unique forward migration number after relationship and write fencing', () => {
    expect(migration).not.toBe('');
    expect(existsSync(obsoleteMigrationPath)).toBe(false);
    expect(migration).toContain('-- 077_apple_iap_server_ledger.sql');
  });

  it('serializes every authenticated account-bound authority path before deletion checks', () => {
    for (const signature of [
      'public.iap_prepare_purchase(text, text)',
      'public.iap_get_state(text)',
      'public.iap_export_credit_reserve(text, bigint, uuid)',
      'public.iap_export_credit_commit(uuid)',
      'public.iap_export_credit_release(uuid)',
    ]) {
      expectDeletionLockBeforeAuthorityReads(signature);
    }
  });

  it('serializes verified server transactions before binding or deletion authority is read', () => {
    expectDeletionLockBeforeAuthorityReads(
      'public.iap_apply_verified_transaction(uuid, text, text, text, text, text, text, text, bigint, bigint, bigint, bigint, text, text, uuid, uuid)',
    );
  });

  it('binds IAP tombstoning to the exact deletion attempt and terminal relational phase', () => {
    const prepare = definition('public.iap_prepare_account_deletion_v2(uuid, uuid)');
    expect(prepare.body).toContain('lock_account_deletion_attempt_v2');
    expect(prepare.body).toContain('p_attempt_id');
    expect(prepare.body).toMatch(/v_phase\s+IS DISTINCT FROM\s+'solo_cleanup_complete'/i);
    expect(parseFunctionDefinitions(migration).some((candidate) => (
      candidate.signature.toLowerCase() === 'public.iap_prepare_account_deletion(uuid)'
    ))).toBe(false);
  });

  it('keeps the exact-attempt tombstone RPC service-role only', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.iap_prepare_account_deletion_v2\(UUID, UUID\)\s+FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.iap_prepare_account_deletion_v2\(UUID, UUID\) TO service_role/i,
    );
  });
});
