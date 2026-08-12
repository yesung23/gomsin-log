import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static contract for the E2EE key foundation migrations.
 *
 * The behavioural half runs against a real PostgreSQL cluster via
 * `spike/e2ee-1a1/tools/run-db-tests.sh` (35 assertions, including the actor
 * matrix and the three write-floor refusals). This file is what runs in CI
 * where no database exists, so it pins the properties that must never be
 * quietly edited out of the SQL.
 */

const foundation = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/031_e2ee_key_foundation.sql'),
  'utf8',
);
const writeFloor = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/032_e2ee_write_floor.sql'),
  'utf8',
);

const KEY_TABLES = [
  'crypto_deployment',
  'recovery_identities',
  'devices',
  'device_certificates',
  'device_enrollments',
  'scope_keys',
  'key_envelopes',
  'recovery_challenges',
  'revocation_statements',
  'crypto_pairings',
  'crypto_write_floor',
  'migration_ledger',
];

describe('031 key foundation', () => {
  it('enables RLS on every key table', () => {
    for (const table of KEY_TABLES) {
      expect(foundation, `RLS missing for ${table}`)
        .toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it('revokes everything from PUBLIC and anon on every key table', () => {
    for (const table of KEY_TABLES) {
      expect(foundation, `anon not revoked on ${table}`)
        .toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon`);
    }
  });

  it('grants no TRUNCATE, TRIGGER or REFERENCES to authenticated', () => {
    // The audit found broad grants of exactly this shape on the legacy tables.
    // Not repeating that here is a deliberate contract.
    for (const privilege of ['TRUNCATE', 'TRIGGER', 'REFERENCES']) {
      expect(foundation).not.toMatch(new RegExp(`GRANT[^;]*${privilege}[^;]*TO authenticated`));
    }
  });

  it('pins search_path on every SECURITY DEFINER function', () => {
    const definers = foundation.match(/SECURITY DEFINER/g) ?? [];
    const pinned = foundation.match(/SET search_path = public, pg_temp/g) ?? [];
    expect(definers.length).toBeGreaterThan(0);
    expect(pinned.length).toBeGreaterThanOrEqual(definers.length);
  });

  it('enforces the health and personal recipient rule in the database', () => {
    // Defence in depth. The cryptographic guarantee is that no health envelope
    // is ever addressed to the partner in the first place; this stops a
    // compromised client from persisting one anyway.
    expect(foundation).toContain('E2EE_DOMAIN_RECIPIENT_FORBIDDEN');
    expect(foundation).toContain("IF v_domain IN ('personal', 'health') AND v_recipient_user <> v_owner THEN");
    expect(foundation).toContain('CREATE TRIGGER trg_key_envelopes_recipient');
  });

  it('permits exactly one ACTIVE epoch per domain and scope', () => {
    expect(foundation).toContain('idx_scope_keys_single_active');
    expect(foundation).toMatch(/ON public\.scope_keys \(domain, scope_id\) WHERE state = 'ACTIVE'/);
  });

  it('keeps device certificates and revocation statements append-only', () => {
    expect(foundation).toContain('trg_device_certificates_immutable');
    expect(foundation).toContain('trg_revocation_immutable');
    expect(foundation).toContain('is append-only');
    // No DELETE or UPDATE grant for authenticated on certificates.
    expect(foundation).toContain('GRANT SELECT, INSERT ON TABLE public.device_certificates TO authenticated');
  });

  it('makes enrollment and recovery nonces single use', () => {
    expect(foundation).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_nonce');
    expect(foundation).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_challenge_nonce');
  });

  it('never stores a plaintext-derived hash in the migration ledger', () => {
    // An unkeyed digest of a low-cardinality health field is a dictionary
    // oracle for anyone holding the database, and the revision CAS makes it
    // unnecessary.
    expect(foundation).not.toContain('source_plaintext_hash');
    expect(foundation).not.toMatch(/plaintext_hash/);
    expect(foundation).toContain('ciphertext_hash');
  });

  it('never stores a private key or a recovery secret', () => {
    expect(foundation).not.toMatch(/recovery_secret\s+BYTEA/);
    expect(foundation).not.toMatch(/\brkek\b/i);
    // Only the RKEK-encrypted blobs are persisted.
    expect(foundation).toContain('enc_rec_sig_priv');
    expect(foundation).toContain('enc_rec_kem_priv');
  });

  it('aborts account deletion rather than orphan a surviving partner', () => {
    expect(foundation).toContain('E2EE_DELETION_WOULD_ORPHAN_PARTNER');
    expect(foundation).toContain('e2ee_prepare_account_deletion');
    // Recipient-scoped envelope deletion: B's rows are never in the predicate.
    expect(foundation).toMatch(/DELETE FROM public\.key_envelopes ke[\s\S]*?d\.user_id = p_user_id/);
  });

  it('keeps couple scope keys structurally out of reach of an Auth cascade', () => {
    // The reproduced data-loss defect: couple keys hung off auth.users with
    // ON DELETE CASCADE, so deleting A wiped the couple epochs and every
    // envelope B held. A couple key now has no auth.users FK at all.
    expect(foundation).toContain('owner_couple_id UUID REFERENCES public.couples(id) ON DELETE CASCADE');
    expect(foundation).toContain('CONSTRAINT scope_keys_ownership CHECK');
    expect(foundation).toContain("OR (domain = 'couple' AND owner_couple_id IS NOT NULL AND owner_user_id IS NULL)");
    expect(foundation).toContain("sk.domain IN ('personal', 'health') AND sk.owner_user_id = p_user_id");
  });

  it('makes epoch state changes possible only through the RPCs', () => {
    // No UPDATE grant, so a RETIRED epoch cannot be edited back to ACTIVE.
    expect(foundation).toContain('GRANT SELECT, INSERT ON TABLE public.scope_keys TO authenticated');
    // Inspect real statements, not prose: an earlier version of this assertion
    // matched the explanatory comment that begins "NO UPDATE GRANT".
    const grants = foundation
      .split('\n')
      .filter((line) => /^GRANT\b/.test(line.trim()) && line.includes('public.scope_keys'));
    expect(grants).toHaveLength(1);
    expect(grants[0]).not.toMatch(/\bUPDATE\b/);
    for (const fn of ['e2ee_mark_epoch_ready', 'e2ee_activate_epoch', 'e2ee_abandon_epoch']) {
      expect(foundation).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
    expect(foundation).toContain('E2EE_ILLEGAL_EPOCH_TRANSITION');
    expect(foundation).toContain('FOR UPDATE');
  });

  it('refuses a new envelope for a revoked device or a retired epoch', () => {
    expect(foundation).toContain('E2EE_RECIPIENT_REVOKED');
    expect(foundation).toContain('E2EE_EPOCH_NOT_WRITABLE');
    expect(foundation).toContain('E2EE_EPOCH_HAS_REVOKED_RECIPIENT');
  });

  it('ties certificate retention to a real foreign key, not a counter', () => {
    expect(foundation).toContain('sender_certificate_id UUID REFERENCES public.device_certificates(id) ON DELETE RESTRICT');
    expect(foundation).not.toContain('reference_count INTEGER');
  });

  it('makes duplicate recipient envelopes impossible despite NULL columns', () => {
    // A plain UNIQUE over the three columns permits unlimited duplicates,
    // because Postgres treats NULLs as distinct and one recipient column is
    // always NULL.
    expect(foundation).toContain('idx_envelope_one_per_device');
    expect(foundation).toContain('idx_envelope_one_per_recovery');
    expect(foundation).toMatch(/WHERE recipient_device_id IS NOT NULL/);
    expect(foundation).toMatch(/WHERE recipient_recovery_id IS NOT NULL/);
  });

  it('commits Edge Function state atomically', () => {
    expect(foundation).toContain('e2ee_commit_device_approval');
    expect(foundation).toContain('e2ee_commit_recovery_authentication');
    expect(foundation).toContain('E2EE_CHALLENGE_ALREADY_USED');
  });

  it('restricts the deletion RPC to service_role', () => {
    expect(foundation).toContain(
      'REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion(UUID) FROM PUBLIC, anon, authenticated',
    );
    expect(foundation).toContain(
      'GRANT EXECUTE ON FUNCTION public.e2ee_prepare_account_deletion(UUID) TO service_role',
    );
  });

  it('revokes direct execution of trigger-only functions', () => {
    for (const fn of [
      'reject_certificate_mutation',
      'reject_revocation_mutation',
      'enforce_envelope_recipient',
      'enforce_write_floor_monotonic',
      'bump_membership_revision',
    ]) {
      expect(foundation, `${fn} still directly executable`)
        .toContain(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated`);
    }
  });

  it('documents that device status is not a trust input', () => {
    expect(foundation).toContain('OPERATIONAL METADATA ONLY');
  });
});

describe('032 write floor', () => {
  it('adds only additive, defaulted content columns', () => {
    expect(writeFloor).toContain('ADD COLUMN IF NOT EXISTS cipher_format SMALLINT NOT NULL DEFAULT 0');
    expect(writeFloor).toContain('ADD COLUMN IF NOT EXISTS content_revision BIGINT NOT NULL DEFAULT 1');
    // Nothing is dropped, renamed or rewritten.
    expect(writeFloor).not.toMatch(/DROP COLUMN|ALTER COLUMN[^;]*TYPE|UPDATE public\.daily_records SET/);
  });

  it('treats cipher_format 0 as explicitly plaintext', () => {
    expect(writeFloor).toContain('0 = legacy plaintext (explicit)');
    expect(writeFloor).toContain('Never inferred from the value shape');
  });

  it('protects every E2EE-content column, not just log_text', () => {
    for (const column of ['log_text', 'reaction', 'attachments', 'emotion_flow', 'record_time']) {
      expect(writeFloor, `${column} is unprotected`).toContain(`E2EE_PLAINTEXT_RESIDUE: ${column}`);
    }
  });

  it('binds is_private to the key domain in both directions', () => {
    expect(writeFloor).toContain('E2EE_DOMAIN_BINDING');
    expect(writeFloor).toMatch(/NEW\.is_private AND NEW\.key_domain <> 'personal'/);
    expect(writeFloor).toMatch(/NOT NEW\.is_private AND NEW\.key_domain <> 'couple'/);
  });

  it('implements the three refusals the architecture requires', () => {
    expect(writeFloor).toContain('E2EE_WRITE_FLOOR');
    expect(writeFloor).toContain('E2EE_DOWNGRADE_FORBIDDEN');
    expect(writeFloor).toContain('E2EE_PLAINTEXT_RESIDUE');
    expect(writeFloor).toContain('E2EE_STALE_EPOCH');
    expect(writeFloor).toContain('E2EE_REVISION_CAS');
  });

  it('forces floor activation before the first encrypted write', () => {
    expect(writeFloor).toContain('E2EE_FLOOR_NOT_ACTIVE');
    expect(writeFloor).toMatch(/NEW\.cipher_format >= 1 AND v_floor = 0/);
  });

  it('makes the downgrade rule unconditional, floor or no floor', () => {
    const trigger = writeFloor.slice(writeFloor.indexOf('enforce_e2ee_write_floor()'));
    const downgrade = trigger.indexOf('E2EE_DOWNGRADE_FORBIDDEN');
    const floorGate = trigger.indexOf('IF v_floor >= 1 THEN');
    expect(downgrade).toBeGreaterThan(-1);
    expect(floorGate).toBeGreaterThan(-1);
    // The downgrade check must sit OUTSIDE the floor gate.
    expect(downgrade).toBeLessThan(floorGate);
  });

  it('makes the floor irreversible', () => {
    expect(writeFloor === '' ? '' : foundation).toContain('E2EE_FLOOR_IRREVERSIBLE');
    expect(foundation).toContain('the write floor cannot be lowered');
    expect(foundation).toContain('the write floor cannot be removed');
  });

  it('auto-assigns the revision for legacy rows so the existing client keeps working', () => {
    expect(writeFloor).toContain('NEW.content_revision := OLD.content_revision + 1');
  });

  it('activates nothing for existing users', () => {
    expect(writeFloor).not.toMatch(/INSERT INTO public\.crypto_write_floor/);
  });
});
