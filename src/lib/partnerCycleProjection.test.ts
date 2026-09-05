import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/071_disable_automatic_cycle_projection.sql'),
  'utf8',
);
const executable = migration.replace(/^\s*--.*$/gm, '');
const functionStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.get_partner_cycle_projection',
);
const functionEnd = migration.indexOf(
  'COMMENT ON FUNCTION public.get_partner_cycle_projection',
);
const projection = migration.slice(functionStart, functionEnd);
const signature = projection.slice(0, projection.indexOf('LANGUAGE sql'));

describe('071 closes automatic cycle sharing without breaking installed clients', () => {
  it('preserves the exact eight-column booleans-and-dates response shape', () => {
    const columns = signature
      .slice(signature.indexOf('RETURNS TABLE ('))
      .match(/^\s+(\w+)\s+(BOOLEAN|DATE)/gm) ?? [];
    expect(columns).toHaveLength(8);
    expect(signature).toContain('has_current_period_status BOOLEAN');
    expect(signature).toContain('has_prediction_window BOOLEAN');
    expect(signature).toContain('has_fertility_window BOOLEAN');
  });

  it('returns only false and null compatibility values', () => {
    expect(projection).toContain(`SELECT
    false,
    false,
    false,
    NULL::DATE,
    NULL::DATE,
    false,
    NULL::DATE,
    NULL::DATE`);
    expect(projection).not.toMatch(/FROM\s+public\.(cycle_|user_sensitive)/i);
    expect(projection).not.toContain('v_partner_id');
  });

  it('uses invoker rights, stable behavior and a pinned path', () => {
    expect(projection).toMatch(/^SECURITY INVOKER$/m);
    expect(projection).toMatch(/^SET search_path = public, pg_temp$/m);
    expect(projection).toMatch(/^STABLE$/m);
    expect(projection).not.toContain('SECURITY DEFINER');
  });

  it('keeps execution authenticated-only for legacy clients', () => {
    expect(projection).not.toContain('auth.uid()');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM PUBLIC',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM anon',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_partner_cycle_projection() TO authenticated',
    );
  });
});

describe('071 makes all-false a database invariant', () => {
  const constraint = 'cycle_sharing_preferences_automatic_projection_disabled';

  it('adds NOT VALID, backfills, then validates in that order', () => {
    const add = migration.indexOf(`ADD CONSTRAINT ${constraint}`);
    const backfill = migration.indexOf('UPDATE public.cycle_sharing_preferences');
    const validate = migration.indexOf(`VALIDATE CONSTRAINT ${constraint}`);
    expect(add).toBeGreaterThanOrEqual(0);
    expect(migration.slice(add, backfill)).toContain('NOT VALID');
    expect(backfill).toBeGreaterThan(add);
    expect(validate).toBeGreaterThan(backfill);
  });

  it('backfills all three legacy flags and no raw health table', () => {
    for (const assignment of [
      'share_current_period = false',
      'share_prediction_window = false',
      'share_fertility_window = false',
    ]) expect(migration).toContain(assignment);

    for (const rawTable of ['cycle_periods', 'cycle_daily_logs', 'cycle_settings', 'cycle_entries']) {
      expect(executable, rawTable).not.toMatch(
        new RegExp(`\\b(UPDATE|DELETE FROM|INSERT INTO)\\s+public\\.${rawTable}\\b`, 'i'),
      );
    }
  });

  it('requires all-false on both insert and update, including old-client writes', () => {
    expect(executable).toContain('CREATE POLICY "Automatic cycle projection remains disabled on insert"');
    expect(executable).toContain('CREATE POLICY "Automatic cycle projection remains disabled on update"');
    const invariant = /NOT share_current_period\s+AND NOT share_prediction_window\s+AND NOT share_fertility_window/g;
    expect(executable.match(invariant)?.length).toBeGreaterThanOrEqual(3);
  });

  it('removes the arbitrary-owner prediction helper after revoking every client role', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM ${role}`,
      );
    }
    expect(migration).toContain('DROP FUNCTION public.cycle_prediction_window(UUID)');
  });

  it('reloads the PostgREST schema cache after commit', () => {
    expect(migration.indexOf('COMMIT;')).toBeLessThan(
      migration.indexOf("NOTIFY pgrst, 'reload schema'"),
    );
  });
});
