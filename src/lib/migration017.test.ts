import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canExecute,
  executableStatements,
  executePrivileges,
  parseFunctionDefinitions,
  parseNotifies,
  stripSqlComments,
} from '@/test/sqlModel';

/**
 * Structural contract test for migration 017.
 *
 * 017 exists because migrations 001-016 are already applied remotely and are
 * therefore immutable, and two things still had to change:
 *
 *  - `get_partner_profile()` was the one SECURITY DEFINER function whose
 *    `search_path` did not pin `pg_temp` (created at `001:278-282`, never
 *    redefined);
 *  - no migration ever executed `NOTIFY pgrst, 'reload schema'`, so every
 *    signature 013-016 created or changed depended on an operator remembering to
 *    reload the PostgREST cache by hand. Until they did, PostgREST answered
 *    PGRST202 -- on the redemption path, the only API a joining partner has.
 *
 * Asserted against a PARSED model of the DDL rather than substrings, so a
 * reformat cannot break it and a semantically broken edit cannot pass it. What it
 * genuinely cannot do is prove the applied database state: that stays a staging
 * gate.
 */

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

const migration = read('supabase/migrations/017_partner_profile_hardening_and_schema_reload.sql');
const initial = read('supabase/migrations/001_initial_schema.sql');

const definitions = parseFunctionDefinitions(migration);
const statements = executableStatements(migration);
const SIGNATURE = 'public.get_partner_profile()';

describe('migration 017 defines exactly one hardened function', () => {
  it('defines only get_partner_profile, with the signature 001 published', () => {
    expect(definitions.map((definition) => definition.signature)).toEqual([SIGNATURE]);
    expect(definitions[0].args).toEqual([]);
    expect(definitions[0].language).toBe('plpgsql');
  });

  it('pins search_path to public, pg_temp under SECURITY DEFINER', () => {
    const [definition] = definitions;
    expect(definition.security).toBe('DEFINER');
    // The whole point of the migration: `pg_temp` last, so a caller-created
    // temporary object cannot shadow a name the DEFINER body resolves.
    expect(definition.searchPath).toEqual(['public', 'pg_temp']);
  });

  it('changes nothing about the client contract', () => {
    const before = parseFunctionDefinitions(initial)
      .find((definition) => definition.signature === SIGNATURE);
    expect(before, '001 must still define get_partner_profile').toBeDefined();
    const [after] = definitions;

    // Same columns, same order, same types: four client call sites read
    // `[0].display_name` and must keep working across the apply.
    expect(after.returns).toBe(before!.returns);
    expect(after.returnColumns).toEqual(['display_name', 'role', 'avatar_path']);
    // Same behaviour, modulo whitespace. A body change here would be a silent
    // behavioural edit smuggled in under a security fix.
    const normalise = (body: string) => body.replace(/\s+/g, ' ').trim();
    expect(normalise(after.body)).toBe(normalise(before!.body));
  });

  it('leaves migration 001 itself untouched, because it is already applied', () => {
    const before = parseFunctionDefinitions(initial)
      .find((definition) => definition.signature === SIGNATURE);
    // If someone "fixes" 001 in place instead, remote and repo diverge silently.
    expect(before!.searchPath).toEqual(['public']);
  });
});

describe('migration 017 is re-runnable and transactional', () => {
  it('drops by EXACT signature before creating', () => {
    const dropAt = statements.findIndex((statement) =>
      statement === `DROP FUNCTION IF EXISTS ${SIGNATURE}`);
    const createAt = statements.findIndex((statement) =>
      statement.startsWith(`CREATE OR REPLACE FUNCTION ${SIGNATURE}`));
    // The failure class this rule exists for: applying 013 remotely died with
    // `cannot change return type of existing function redeem_invitation(text)`.
    expect(dropAt, 'missing DROP FUNCTION IF EXISTS with the exact signature')
      .toBeGreaterThanOrEqual(0);
    expect(createAt).toBeGreaterThanOrEqual(0);
    expect(dropAt).toBeLessThan(createAt);
  });

  it('never drops anything without IF EXISTS', () => {
    for (const statement of statements) {
      if (statement.startsWith('DROP ')) expect(statement).toContain('IF EXISTS');
    }
  });

  it('is one explicit transaction, with the commented rollback outside it', () => {
    expect(statements.filter((statement) => statement === 'BEGIN').length).toBe(1);
    expect(statements.filter((statement) => statement === 'COMMIT').length).toBe(1);
    // The rollback block is prose; it must not be executable.
    expect(stripSqlComments(migration)).not.toContain('SET search_path = public\n');
    expect(migration).toContain('-- ROLLBACK');
    expect(migration).toContain('--   DROP FUNCTION IF EXISTS public.get_partner_profile();');
  });

  it('touches no object owned by migrations 001-016 other than that function', () => {
    const executable = stripSqlComments(migration);
    expect(executable).not.toMatch(/ALTER TABLE/i);
    expect(executable).not.toMatch(/DROP TABLE/i);
    expect(executable).not.toMatch(/(CREATE|DROP)\s+POLICY/i);
    expect(executable).not.toMatch(/ALTER PUBLICATION/i);
    expect(executable).not.toMatch(/(CREATE|DROP)\s+INDEX/i);
    expect(executable).not.toMatch(/DROP FUNCTION IF EXISTS(?! public\.get_partner_profile\(\))/);
  });
});

describe('migration 017 performs the PostgREST schema reload', () => {
  it('notifies pgrst to reload the schema', () => {
    const notifies = parseNotifies(migration);
    expect(notifies).toEqual([{ channel: 'pgrst', payload: 'reload schema' }]);
  });

  it('does it INSIDE the transaction, so a rolled-back apply cannot reload', () => {
    const beginAt = statements.indexOf('BEGIN');
    const commitAt = statements.indexOf('COMMIT');
    const notifyAt = statements.findIndex((statement) => statement.startsWith('NOTIFY pgrst'));
    expect(beginAt).toBeGreaterThanOrEqual(0);
    expect(notifyAt).toBeGreaterThan(beginAt);
    expect(notifyAt).toBeLessThan(commitAt);
  });
});

describe('migration 017 privileges', () => {
  it('leaves EXECUTE with authenticated only', () => {
    // Replayed from Postgres's real default (EXECUTE to PUBLIC on creation), so
    // a missing REVOKE cannot read as safe.
    const privileges = executePrivileges(migration, SIGNATURE);
    expect(canExecute(privileges, 'authenticated')).toBe(true);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(privileges.publicHolds).toBe(false);
    expect(canExecute(privileges, 'service_role')).toBe(false);
  });

  it('revokes before it grants', () => {
    const revokeAt = statements.findIndex((statement) =>
      statement === `REVOKE ALL ON FUNCTION ${SIGNATURE} FROM authenticated`);
    const grantAt = statements.findIndex((statement) =>
      statement === `GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO authenticated`);
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeGreaterThan(revokeAt);
  });

  it('grants nothing to anon or PUBLIC anywhere in the file', () => {
    for (const statement of statements) {
      if (!statement.startsWith('GRANT')) continue;
      expect(statement).not.toMatch(/TO\s+(anon|PUBLIC)/i);
    }
  });
});

describe('the SQL model itself is trustworthy', () => {
  it('ignores DDL that only appears inside comments', () => {
    // The commented rollback block contains a full CREATE OR REPLACE FUNCTION
    // with the OLD search_path. If the parser saw comments, every assertion above
    // would be meaningless.
    expect(migration).toContain('--   SET search_path = public');
    expect(definitions.length).toBe(1);
    expect(definitions[0].searchPath).toEqual(['public', 'pg_temp']);
  });

  it('models the creation default rather than assuming an empty grant state', () => {
    // Postgres grants EXECUTE to PUBLIC when a function is created. A model that
    // started from "nobody" would call this unsafe fixture safe.
    const unsafe = `
      CREATE FUNCTION public.f() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN END; $$;
      GRANT EXECUTE ON FUNCTION public.f() TO authenticated;
    `;
    expect(canExecute(executePrivileges(unsafe, 'public.f()'), 'anon')).toBe(true);

    const safe = `${unsafe}
      REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;
    `;
    expect(canExecute(executePrivileges(safe, 'public.f()'), 'anon')).toBe(false);
    expect(canExecute(executePrivileges(safe, 'public.f()'), 'authenticated')).toBe(true);
  });
});
