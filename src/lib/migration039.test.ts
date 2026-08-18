import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static contract test for migration 039.
 *
 * This does NOT establish that the enforcement works — that is
 * `scripts/e2ee/p5-harness.mjs`, which runs the migration on a real PostgreSQL 17
 * cluster as real RLS actors and mutation-tests each control. What this file
 * pins is the set of properties a careless later edit would silently break and a
 * reviewer would have to check by eye.
 */
const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');
const envelope = readFileSync(resolve(MIGRATIONS, '039_daily_records_content_envelope.sql'), 'utf8');
const writeFloor = readFileSync(resolve(MIGRATIONS, '032_e2ee_write_floor.sql'), 'utf8');

/** The migration with comment lines stripped: what PostgreSQL actually runs. */
const executable = envelope
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('039 structure', () => {
  it('is one explicit transaction', () => {
    expect(executable.match(/^BEGIN;/gm)?.length).toBe(1);
    expect(executable.match(/^COMMIT;/gm)?.length).toBe(1);
  });

  it('reloads the PostgREST schema cache', () => {
    // 039 adds a column clients select and write; without this they get a stale
    // schema until someone reloads by hand.
    expect(executable).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('carries a rollback block that states the data-loss risk', () => {
    expect(envelope).toContain('-- ROLLBACK');
    // Dropping the column destroys the only copy of every encrypted record.
    expect(envelope).toMatch(/DESTROYS/);
    expect(envelope).toContain('WHERE cipher_format >= 1');
  });

  it('is additive: nothing is dropped, renamed or retyped', () => {
    expect(executable).not.toMatch(/DROP COLUMN|ALTER COLUMN[^;]*TYPE|DROP TABLE/);
  });

  it('backfills nothing and activates no floor', () => {
    // Existing rows must be untouched, and no account may be silently moved past
    // its write floor by a migration.
    expect(executable).not.toMatch(/UPDATE public\.daily_records SET/);
    expect(executable).not.toMatch(/INSERT INTO public\.crypto_write_floor/);
  });
});

describe('039 stores the envelope', () => {
  it('adds content_envelope as bytea, not text', () => {
    expect(executable).toMatch(/ADD COLUMN IF NOT EXISTS content_envelope BYTEA/);
    // Base64 in a text column would add a third to every row and invite the
    // "does this look like base64?" inference invariant 12 forbids.
    expect(executable).not.toMatch(/content_envelope TEXT/);
  });

  it('refuses a value too short to be a GLE1 envelope', () => {
    // 92-byte header + 16-byte tag.
    expect(executable).toContain('octet_length(content_envelope) >= 108');
    expect(executable).toContain('E2EE_ENVELOPE_TRUNCATED');
  });

  it('makes envelope presence an exact biconditional with cipher_format', () => {
    expect(executable).toContain('E2EE_ENVELOPE_REQUIRED');
    expect(executable).toContain('E2EE_ENVELOPE_ON_PLAINTEXT');
  });
});

describe('039 does not trust the client routing columns alone', () => {
  it('verifies the GLE1 magic and format version from the envelope itself', () => {
    expect(executable).toContain('E2EE_ENVELOPE_MAGIC');
    expect(executable).toContain('E2EE_ENVELOPE_FORMAT');
    expect(executable).toContain("'\\x474c4531'::BYTEA");
  });

  it('compares the envelope header domain against key_domain', () => {
    // The routing columns come from the same client as the envelope, so on their
    // own they prove only self-consistency.
    expect(executable).toContain('E2EE_ENVELOPE_DOMAIN_MISMATCH');
    expect(executable).toMatch(/get_byte\(NEW\.content_envelope, 7\)/);
  });

  it('compares the envelope header epoch against key_epoch', () => {
    expect(executable).toContain('E2EE_ENVELOPE_EPOCH_MISMATCH');
    expect(executable).toMatch(/get_byte\(NEW\.content_envelope, 12\)/);
  });

  it('reads the epoch as NUMERIC so a u64 cannot overflow mid-expression', () => {
    expect(executable).toMatch(/get_byte\(NEW\.content_envelope, 12\)::NUMERIC/);
  });

  it('refuses the health domain on daily_records outright', () => {
    // HRK must never stand in for PMK or CSK; making the value unacceptable here
    // means the substitution is inexpressible rather than merely unlikely.
    expect(executable).toContain('E2EE_DOMAIN_UNSUPPORTED');
    expect(executable).toMatch(/WHEN 'personal' THEN 1 WHEN 'couple' THEN 3 ELSE NULL/);
  });

  it('requires an active membership for couple-domain content', () => {
    expect(executable).toContain('E2EE_COUPLE_MEMBERSHIP_REQUIRED');
    expect(executable).toMatch(/cm\.status = 'active'/);
  });

  it('pins the envelope to its content_revision', () => {
    expect(executable).toContain('E2EE_ENVELOPE_IMMUTABLE');
  });
});

describe('039 fixes the 032 privilege defect without forking its body', () => {
  it('makes the write-floor trigger SECURITY DEFINER', () => {
    // Without this, `enforce_e2ee_write_floor` runs as the caller and its first
    // statement calls `e2ee_floor_for`, whose EXECUTE is revoked from
    // `authenticated` — so applying 032 alone makes daily_records completely
    // unwritable for every real user. Proven by the P5 harness.
    expect(executable).toContain('ALTER FUNCTION public.enforce_e2ee_write_floor() SECURITY DEFINER');
  });

  it('does not redefine the trigger body, which would fork it from 032', () => {
    // Re-declaring the function here would leave two copies of the enforcement
    // rules, with live behaviour decided by whichever migration ran last.
    expect(executable).not.toContain('CREATE OR REPLACE FUNCTION public.enforce_e2ee_write_floor()');
    expect(writeFloor).toContain('CREATE OR REPLACE FUNCTION public.enforce_e2ee_write_floor()');
  });

  it('keeps the trigger function unreachable by any client role', () => {
    expect(executable).toContain(
      'REVOKE ALL ON FUNCTION public.enforce_e2ee_write_floor() FROM PUBLIC, anon, authenticated',
    );
    expect(executable).toContain(
      'REVOKE ALL ON FUNCTION public.enforce_daily_record_envelope() FROM PUBLIC, anon, authenticated',
    );
  });

  it('pins search_path on the SECURITY DEFINER function it defines', () => {
    const definition = executable.slice(
      executable.indexOf('CREATE OR REPLACE FUNCTION public.enforce_daily_record_envelope()'),
    );
    expect(definition.slice(0, 200)).toContain('SET search_path = public, pg_temp');
    expect(definition.slice(0, 200)).toContain('SECURITY DEFINER');
  });

  it('orders its trigger after the write-floor trigger', () => {
    // Same-timing row triggers fire in name order, and the floor's own refusals
    // must be the reported cause when both apply.
    expect(executable).toContain('trg_daily_records_write_floor_z_envelope');
    expect('trg_daily_records_write_floor_z_envelope' > 'trg_daily_records_write_floor').toBe(true);
  });

  it('leaves anon with nothing and grants the new columns only to authenticated', () => {
    expect(executable).toContain('REVOKE ALL ON TABLE public.daily_records FROM anon');
    expect(executable).toMatch(/GRANT INSERT \(content_envelope[^)]*\)/);
    expect(executable).toMatch(/TO authenticated/);
  });
});

describe('the protected content set has not silently changed', () => {
  it('039 adds no new plaintext content column', () => {
    // The only column added is the envelope. Anything else would be a new
    // plaintext surface, which the roadmap's P1–P4 constraint 1 forbids.
    const added = [...executable.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(added).toEqual(['content_envelope']);
  });

  it('032 still protects all five fields the envelope now carries', () => {
    for (const column of ['log_text', 'reaction', 'attachments', 'emotion_flow', 'record_time']) {
      expect(writeFloor).toContain(`E2EE_PLAINTEXT_RESIDUE: ${column}`);
    }
  });
});
