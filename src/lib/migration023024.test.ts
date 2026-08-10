import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Migrations 023 and 024: the two holes that 022 left open.
 *
 * Both were found by probing the live project right after 022 was applied, not
 * by reading the SQL. They are asserted here so the same holes cannot reopen.
 *
 * 023 — 022 creates `legacy_cycle_entries_backup` with `CREATE TABLE AS SELECT`,
 * which inherits neither RLS nor grants. The live project answered an anon
 * `select=*` on that table with 200 and another user's period rows.
 *
 * 024 — the same `CREATE TABLE AS SELECT` also means the backup has no foreign
 * key to `auth.users`, so Auth deletion never removes it. Account deletion left
 * cycle history behind.
 */
const read = (file: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8');

const lock = read('023_lock_legacy_cycle_backup.sql');
const deletion = read('024_cycle_v3_account_deletion.sql');

describe('023 locks the legacy cycle backup table', () => {
  it('enables RLS on the backup table', () => {
    expect(lock).toContain('ALTER TABLE public.legacy_cycle_entries_backup ENABLE ROW LEVEL SECURITY');
  });

  it('revokes anon and PUBLIC, the exact grant that leaked', () => {
    expect(lock).toContain('REVOKE ALL ON TABLE public.legacy_cycle_entries_backup FROM anon');
    expect(lock).toContain('REVOKE ALL ON TABLE public.legacy_cycle_entries_backup FROM PUBLIC');
  });

  it('scopes reads to the owner', () => {
    expect(lock).toContain('USING (user_id = auth.uid())');
  });

  it('grants the owner SELECT only, never write access to a backup', () => {
    expect(lock).toContain('GRANT SELECT ON TABLE public.legacy_cycle_entries_backup TO authenticated');
    expect(lock).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*legacy_cycle_entries_backup/);
  });

  it('never drops or truncates the backup: zero data loss is the point of it', () => {
    expect(lock).not.toMatch(/DROP TABLE[\s\S]*legacy_cycle_entries_backup/);
    expect(lock).not.toMatch(/TRUNCATE[\s\S]*legacy_cycle_entries_backup/);
  });

  it('is a no-op where 022 has not run, so it can be applied in any order', () => {
    expect(lock).toContain("table_name = 'legacy_cycle_entries_backup'");
  });

  it('reloads the schema cache', () => {
    expect(lock).toContain("NOTIFY pgrst, 'reload schema'");
  });
});

describe('024 extends account deletion to cycle data', () => {
  /*
   * NOTE: 024 is superseded by 027. These assertions describe what 024 said, and
   * one of them is why its bug shipped: asserting that the text contains
   * `WHERE user_id = p_user_id` checked for the wrong column for
   * `cycle_support_signals`, whose owner column is `owner_id`, as confidently as
   * it would have checked for the right one. plpgsql does not validate a
   * function body at CREATE time, so nothing failed until the first real call.
   *
   * The column names are now checked against the schema in
   * `src/lib/migration027.test.ts`, which is the suite that must be trusted for
   * the deletion function's current behaviour.
   */
  it.each([
    'cycle_periods',
    'cycle_daily_logs',
    'cycle_sharing_preferences',
    'user_sensitive_consents',
    'cycle_entries',
    'cycle_settings',
  ])('deletes %s for the departing user', (table) => {
    expect(deletion).toContain(`DELETE FROM public.${table} WHERE user_id = p_user_id`);
  });

  it('is superseded by 027 for cycle_support_signals, which it deleted by the wrong column', () => {
    // Kept as a record of the defect rather than deleted, so the reason 027
    // exists stays attached to the file that caused it.
    expect(deletion).toContain('DELETE FROM public.cycle_support_signals WHERE user_id = p_user_id');
  });

  it('deletes the legacy backup, which no cascade would ever reach', () => {
    expect(deletion).toContain(
      'DELETE FROM public.legacy_cycle_entries_backup WHERE user_id = p_user_id',
    );
  });

  it('scopes every cycle delete to one user, never a bare table wipe', () => {
    const deletes = deletion.match(/DELETE FROM public\.[a-z_]+[^;]*/g) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const statement of deletes) {
      expect(statement).toMatch(/WHERE/);
    }
  });

  it('keeps every reporting key 015 already returned', () => {
    for (const key of [
      'private_events_deleted',
      'shared_events_transferred',
      'shared_events_deleted',
      'trips_transferred',
      'trips_deleted',
      'records_deleted',
    ]) {
      expect(deletion).toContain(`'${key}'`);
    }
  });

  it('reports what it removed instead of deleting silently', () => {
    for (const key of [
      'cycle_periods_deleted',
      'cycle_daily_logs_deleted',
      'legacy_cycle_backup_deleted',
      'sensitive_consents_deleted',
    ]) {
      expect(deletion).toContain(`'${key}'`);
    }
  });

  it('stays service-role only, and keeps the hardened search_path', () => {
    expect(deletion).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(deletion).toContain('SET search_path = public, pg_temp');
    expect(deletion).toContain(
      'REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM authenticated',
    );
    expect(deletion).toContain(
      'GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) TO service_role',
    );
  });

  it('keeps the media preflight check, so deletion still fails closed', () => {
    expect(deletion).toContain('Account records changed during media cleanup');
    expect(deletion).toContain('Account deletion was not prepared for media cleanup');
  });

  it('loads on a database where 022 has not been applied', () => {
    // Every cycle delete sits behind an information_schema existence check, so
    // CREATE OR REPLACE cannot fail on a project that predates 022.
    const cycleTables = [
      'cycle_periods',
      'cycle_daily_logs',
      'cycle_sharing_preferences',
      'user_sensitive_consents',
      'legacy_cycle_entries_backup',
    ];
    for (const table of cycleTables) {
      expect(deletion).toContain(`table_name = '${table}'`);
    }
  });
});
