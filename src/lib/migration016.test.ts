import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static contract test for migration 016.
 *
 * There is no database in CI or in the sandbox, so this asserts the properties
 * that a reviewer would otherwise have to check by eye, and that a careless edit
 * would silently break:
 *
 *  - the DROP-before-CREATE rule that the remote 013 failure taught us;
 *  - that `anon`/PUBLIC receive nothing;
 *  - that no invitation code or hash can leave the function;
 *  - that the file is transactional and re-runnable.
 */
const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/016_couple_state_visibility.sql'),
  'utf8',
);

/** The migration with every comment line stripped, i.e. what Postgres will run. */
const executableSql = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

/** Every function this migration defines, with its exact signature. */
const DEFINED_FUNCTIONS = ['public.get_my_couple_state()'] as const;

describe('migration 016 structure', () => {
  it('is wrapped in a single explicit transaction', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    // Exactly one committed transaction; the ROLLBACK block is commented out.
    expect(executableSql.match(/^BEGIN;/gm)?.length).toBe(1);
    expect(executableSql.match(/^COMMIT;/gm)?.length).toBe(1);
  });

  it('drops every function by EXACT signature before creating it', () => {
    // This is the precise failure class that broke migration 013 remotely:
    // `cannot change return type of existing function redeem_invitation(text)`.
    // CREATE OR REPLACE cannot change a return type, so a DROP must precede it.
    for (const signature of DEFINED_FUNCTIONS) {
      const dropIndex = migration.indexOf(`DROP FUNCTION IF EXISTS ${signature};`);
      const createIndex = migration.indexOf(`CREATE FUNCTION ${signature}`);
      expect(dropIndex, `missing DROP for ${signature}`).toBeGreaterThanOrEqual(0);
      expect(createIndex, `missing CREATE for ${signature}`).toBeGreaterThanOrEqual(0);
      expect(dropIndex).toBeLessThan(createIndex);
    }
  });

  it('never uses CREATE OR REPLACE FUNCTION, which cannot change a return type', () => {
    // Checked against executable SQL only: the header explains the rule in prose
    // and must be allowed to name the construct it forbids.
    expect(executableSql).not.toContain('CREATE OR REPLACE FUNCTION');
  });

  it('carries a commented rollback block', () => {
    expect(migration).toContain('-- ROLLBACK');
    expect(migration).toContain('--   DROP FUNCTION IF EXISTS public.get_my_couple_state();');
  });

  it('does not modify any object owned by migrations 001-015', () => {
    // Additive only: no ALTER/DROP of tables, policies, publications or grants
    // that already exist remotely.
    expect(migration).not.toMatch(/ALTER TABLE/i);
    expect(migration).not.toMatch(/DROP TABLE/i);
    expect(migration).not.toMatch(/DROP POLICY/i);
    expect(migration).not.toMatch(/CREATE POLICY/i);
    expect(migration).not.toMatch(/ALTER PUBLICATION/i);
    expect(migration).not.toMatch(/DROP INDEX/i);
  });
});

describe('migration 016 security contracts', () => {
  it('grants EXECUTE to authenticated only', () => {
    for (const signature of DEFINED_FUNCTIONS) {
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
    }
    const grants = migration.match(/^GRANT [^\n]+$/gm) || [];
    expect(grants.length).toBe(DEFINED_FUNCTIONS.length);
    for (const grant of grants) {
      expect(grant).toContain('TO authenticated;');
    }
  });

  it('grants nothing to anon or PUBLIC', () => {
    expect(migration).not.toMatch(/GRANT[^\n]*TO anon/i);
    expect(migration).not.toMatch(/GRANT[^\n]*TO PUBLIC/i);
  });

  it('revokes from PUBLIC, anon and authenticated before granting', () => {
    for (const signature of DEFINED_FUNCTIONS) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`);
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated;`);
      const revokeIndex = migration.indexOf(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated;`);
      const grantIndex = migration.indexOf(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
      expect(revokeIndex).toBeLessThan(grantIndex);
    }
  });

  it('pins search_path and SECURITY DEFINER on every function', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    // Read-only, so it must be declared STABLE rather than VOLATILE.
    expect(migration).toContain('STABLE');
  });

  it('refuses an unauthenticated caller', () => {
    expect(migration).toContain('IF v_uid IS NULL THEN');
    expect(migration).toContain("RAISE EXCEPTION 'Not authenticated'");
  });

  it('takes no parameter, so another user\'s state cannot be requested', () => {
    // The signature is nullary. An argument would be an authorization hole no
    // amount of internal filtering could close.
    expect(migration).toContain('CREATE FUNCTION public.get_my_couple_state()');
    expect(migration).not.toMatch(/CREATE FUNCTION public\.get_my_couple_state\(\s*p_/);
  });

  it('scopes every read to auth.uid()', () => {
    expect(migration).toContain('v_uid UUID := auth.uid()');
    expect(migration).toMatch(/FROM public\.couple_members\s+WHERE user_id = v_uid/);
  });

  it('never selects or returns an invitation code or hash', () => {
    // Returning either would restore exactly the hash-probing capability that
    // migration 013 removed by revoking SELECT on invitation_codes.
    const body = migration.slice(
      migration.indexOf('CREATE FUNCTION public.get_my_couple_state()'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.get_my_couple_state() FROM PUBLIC;'),
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('code_hash');
    expect(body).not.toMatch(/'code'/);
    expect(body).not.toMatch(/jsonb_build_object[^;]*code_hash/);
    // Only the expiry timestamp is read out of invitation_codes.
    expect(body).toMatch(/SELECT expires_at\s+INTO v_invitation_expires_at/);
  });

  it('reports an outstanding invitation only when unused and unexpired', () => {
    expect(migration).toContain('AND used = false');
    expect(migration).toContain('AND expires_at > now()');
  });

  it('requires a second ACTIVE member to report the partner as present', () => {
    // Counting any member would report a disconnected partner as still present.
    expect(migration).toMatch(/user_id <> v_uid\s+AND status = 'active'/);
  });

  it('returns an explicit null-couple payload rather than an empty result', () => {
    expect(migration).toMatch(/'couple_id', NULL/);
    expect(migration).toMatch(/'partner_present', false/);
    expect(migration).toMatch(/'invitation_active', false/);
  });
});
