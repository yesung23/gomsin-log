import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Phase 1A rollback contract.
 *
 * Two layers, because either alone is insufficient.
 *
 * The STATIC checks pin intent that is easy to lose in an edit: that the
 * refusal conditions are still there, that nothing reaches for CASCADE, that
 * the drop order still puts `e2ee_can_manage_scope_key` before the table whose
 * row type it is declared on.
 *
 * The EXECUTED check is the one that actually proves anything. It starts a
 * throwaway PostgreSQL cluster, applies 031/032/034, runs the rollback, and
 * diffs the resulting schema inventory against the pre-031 baseline — then
 * repeats with activation evidence present and requires the refusal. Reading
 * SQL cannot establish that: an earlier revision of this rollback dropped
 * `scope_keys` before the function typed on it, which reads perfectly and fails
 * on a real database.
 */

const ROOT = process.cwd();
const ROLLBACK = readFileSync(
  resolve(ROOT, 'supabase/migrations/033_rollback_e2ee_key_foundation.sql.disabled'),
  'utf8',
);
const FORWARD_031 = readFileSync(resolve(ROOT, 'supabase/migrations/031_e2ee_key_foundation.sql'), 'utf8');
const FORWARD_032 = readFileSync(resolve(ROOT, 'supabase/migrations/032_e2ee_write_floor.sql'), 'utf8');
const FORWARD_034 = readFileSync(
  resolve(ROOT, 'supabase/migrations/034_e2ee_recovery_challenge_issuance.sql'),
  'utf8',
);

/**
 * The SQL with `--` comments stripped.
 *
 * Needed because this file's own prose explains why it does NOT use CASCADE,
 * and a naive scan would fail on the explanation rather than on a violation.
 */
const ROLLBACK_CODE = ROLLBACK.replace(/^\s*--.*$/gm, '');

const postgresAvailable = ['initdb', 'pg_ctl', 'psql']
  .every((binary) => spawnSync('which', [binary], { encoding: 'utf8' }).status === 0);

describe('rollback refusal conditions', () => {
  it('is one transaction, so a refusal cannot half-apply', () => {
    expect(ROLLBACK.trimStart().startsWith('-- =')).toBe(true);
    expect(ROLLBACK).toMatch(/\nBEGIN;/);
    expect(ROLLBACK.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('refuses on ciphertext, on key routing, on an active floor and on a ledger entry', () => {
    expect(ROLLBACK).toMatch(/cipher_format >= 1/);
    expect(ROLLBACK).toMatch(/key_domain IS NOT NULL OR key_epoch IS NOT NULL/);
    expect(ROLLBACK).toMatch(/min_cipher_format >= 1 OR activated_at IS NOT NULL/);
    expect(ROLLBACK).toMatch(/FROM public\.migration_ledger/);
    expect(ROLLBACK).toMatch(/E2EE_ROLLBACK_REFUSED/);
  });

  it('offers no path that decrypts or downgrades content', () => {
    // The only honest response to "roll back after activation" is a forward
    // migration that decrypts under user control. Not this file.
    expect(ROLLBACK_CODE).not.toMatch(/UPDATE\s+public\.daily_records\s+SET/i);
    expect(ROLLBACK_CODE).not.toMatch(/DELETE\s+FROM\s+public\.daily_records/i);
    expect(ROLLBACK_CODE).not.toMatch(/cipher_format\s*=\s*0/);
  });

  it('never uses CASCADE, so an unlisted dependency fails loudly', () => {
    expect(/\bCASCADE\b/.test(ROLLBACK_CODE)).toBe(false);
  });

  it('drops the function typed on scope_keys BEFORE the table itself', () => {
    // Postgres refuses to drop a table whose composite row type a function still
    // references. Getting this order wrong is invisible in review.
    const functionAt = ROLLBACK.indexOf('e2ee_can_manage_scope_key');
    const tableAt = ROLLBACK.indexOf('DROP TABLE IF EXISTS public.scope_keys');
    expect(functionAt).toBeGreaterThan(-1);
    expect(tableAt).toBeGreaterThan(-1);
    expect(functionAt).toBeLessThan(tableAt);
  });

  it('drops certificates before the anchors they root at', () => {
    const certificates = ROLLBACK.indexOf('DROP TABLE IF EXISTS public.device_certificates');
    const anchors = ROLLBACK.indexOf('DROP TABLE IF EXISTS public.recovery_public_anchors');
    expect(certificates).toBeLessThan(anchors);
  });

  it('restores record_time to NOT NULL rather than leaving 032 half-undone', () => {
    expect(ROLLBACK).toMatch(/ALTER COLUMN record_time SET NOT NULL/);
  });

  it('drops both signatures of the recovery-authentication commit', () => {
    // 031 created the two-argument form; 034 replaced it. A rollback that knew
    // only the current shape would strand the old one.
    expect(ROLLBACK).toMatch(/e2ee_commit_recovery_authentication\(UUID, UUID\)/);
    expect(ROLLBACK).toMatch(/e2ee_commit_recovery_authentication\(UUID, UUID, UUID, SMALLINT\)/);
  });
});

describe('the rollback covers every forward object', () => {
  /** Table names created by the forward migrations. */
  const createdTables = [...`${FORWARD_031}${FORWARD_032}${FORWARD_034}`
    .matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z_]+)/g)].map((m) => m[1]);

  /** Function names created by the forward migrations. */
  const createdFunctions = [...`${FORWARD_031}${FORWARD_032}${FORWARD_034}`
    .matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map((m) => m[1]);

  it('found the forward inventory it is checking against', () => {
    expect(createdTables.length).toBeGreaterThan(10);
    expect(createdFunctions.length).toBeGreaterThan(10);
  });

  it('drops every table the forward migrations create', () => {
    for (const table of new Set(createdTables)) {
      expect(ROLLBACK, `033 does not drop public.${table}`)
        .toMatch(new RegExp(`DROP TABLE IF EXISTS public\\.${table}\\b`));
    }
  });

  it('drops every function the forward migrations create', () => {
    for (const fn of new Set(createdFunctions)) {
      expect(ROLLBACK, `033 does not drop public.${fn}`)
        .toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\b`));
    }
  });

  it('removes the column 031 added to a pre-existing table', () => {
    expect(FORWARD_031).toMatch(/ADD COLUMN IF NOT EXISTS membership_revision/);
    expect(ROLLBACK).toMatch(/ALTER TABLE public\.couples DROP COLUMN IF EXISTS membership_revision/);
  });

  it('removes every column 032 added to daily_records', () => {
    for (const column of ['cipher_format', 'content_revision', 'key_domain', 'key_epoch']) {
      expect(FORWARD_032).toContain(column);
      expect(ROLLBACK).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${column}`));
    }
  });

  it('detaches every trigger the forward migrations put on a surviving table', () => {
    expect(ROLLBACK).toMatch(/DROP TRIGGER IF EXISTS trg_daily_records_write_floor ON public\.daily_records/);
    expect(ROLLBACK).toMatch(/DROP TRIGGER IF EXISTS trg_membership_revision ON public\.couple_members/);
  });

  it('reloads the PostgREST schema cache, like every migration that changes signatures', () => {
    expect(ROLLBACK).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});

/**
 * The executed harness.
 *
 * Skipped, loudly, where PostgreSQL is unavailable — a skip here is a MISSING
 * VERIFICATION and must not be read as a pass.
 */
describe.skipIf(!postgresAvailable)('executed against a throwaway PostgreSQL cluster', () => {
  it('restores the pre-031 schema exactly, and refuses once E2EE is activated', () => {
    const result = spawnSync('node', [resolve(ROOT, 'scripts/e2ee/rollback-harness.mjs')], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output, output).toContain('ROLLBACK HARNESS: PASS');
    expect(result.status, output).toBe(0);
    expect(output).toContain('restores the pre-031 inventory exactly');
    expect(output).toContain('rollback refuses and leaves the schema untouched');
    expect(output).toContain('a migration acknowledgement alone also refuses');
  }, 180_000);
});

describe('harness availability is reported honestly', () => {
  it('says so when PostgreSQL is missing rather than passing quietly', () => {
    // The assertion is on the harness script itself: run without psql, it exits
    // non-zero with an explicit "MISSING VERIFICATION" rather than success.
    const script = readFileSync(resolve(ROOT, 'scripts/e2ee/rollback-harness.mjs'), 'utf8');
    expect(script).toMatch(/POSTGRES UNAVAILABLE/);
    expect(script).toMatch(/MISSING VERIFICATION, not a pass/);
    expect(script).toMatch(/process\.exit\(2\)/);
  });
});
