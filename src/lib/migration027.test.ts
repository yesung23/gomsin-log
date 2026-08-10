import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Migration 027, and the class of bug that made it necessary.
 *
 * 024 deleted `cycle_support_signals` by `user_id`. That table keys its owner as
 * `owner_id`. plpgsql does not validate a function body at CREATE time, so 024
 * applied cleanly, passed its own tests, and then failed on the first real call
 * with `42703: column "user_id" does not exist` — taking the entire account
 * deletion transaction down with it. For the window 024 was deployed, nobody
 * could delete their account.
 *
 * 024's test asserted that the SQL text contained
 * `DELETE FROM public.<table> WHERE user_id = p_user_id`. That is exactly the
 * assertion that let the bug through: it checked for the wrong column as
 * confidently as it would have checked for the right one.
 *
 * So this suite checks the delete predicates against the SCHEMA, by reading the
 * CREATE TABLE that owns each column. That is the closest available substitute
 * for running Postgres, which remains a staging gate.
 */
const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');

const files = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const allSql = files
  .map((file) => readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'))
  .join('\n');

/** The definition that WINS: the last file to define the function. */
const deletionFunction = (() => {
  let winner = '';
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.prepare_account_deletion');
    if (start === -1) continue;
    const end = sql.indexOf('\n$$;', start);
    winner = sql.slice(start, end === -1 ? undefined : end);
  }
  return winner;
})();

/**
 * Every column the migration tree ever declares for a table, gathered from its
 * CREATE TABLE bodies and later ALTER TABLE ... ADD COLUMN statements.
 */
function declaredColumns(table: string): Set<string> {
  const columns = new Set<string>();

  const createPattern = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    'g',
  );
  for (const match of allSql.matchAll(createPattern)) {
    for (const line of match[1].split('\n')) {
      const column = line.trim().match(/^([a-z_]+)\s+[A-Z]/);
      if (column) columns.add(column[1]);
    }
  }

  const alterPattern = new RegExp(
    `ALTER TABLE (?:IF EXISTS )?public\\.${table}\\s+ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)`,
    'g',
  );
  for (const match of allSql.matchAll(alterPattern)) columns.add(match[1]);

  return columns;
}

describe('the winning deletion function is the fixed one', () => {
  it('deletes cycle_support_signals by owner_id, the column that exists', () => {
    expect(deletionFunction).toContain(
      'DELETE FROM public.cycle_support_signals WHERE owner_id = p_user_id',
    );
  });

  it('no longer deletes cycle_support_signals by user_id', () => {
    expect(deletionFunction).not.toContain(
      'DELETE FROM public.cycle_support_signals WHERE user_id = p_user_id',
    );
  });
});

describe('every delete predicate names a column that exists', () => {
  /*
   * The generalised form of the 024 bug. Each `DELETE FROM public.x WHERE col =`
   * in the winning function is checked against the columns the migration tree
   * declares for that table, so the next mismatched column fails here instead of
   * on a user's deletion request.
   */
  const deletes = [...deletionFunction.matchAll(
    /DELETE FROM public\.([a-z_]+)\s+WHERE ([a-z_]+) =/g,
  )].map((match) => ({ table: match[1], column: match[2] }));

  it('finds the delete statements to check', () => {
    // A refactor that stops matching must fail loudly, not silently check zero.
    expect(deletes.length).toBeGreaterThanOrEqual(8);
  });

  it.each(deletes)('public.$table has a $column column', ({ table, column }) => {
    const columns = declaredColumns(table);
    // `legacy_cycle_entries_backup` is created by CREATE TABLE AS SELECT, so it
    // has no column list to read. Its shape is cycle_entries', by construction.
    const effective = table === 'legacy_cycle_entries_backup'
      ? declaredColumns('cycle_entries')
      : columns;
    expect(effective.size).toBeGreaterThan(0);
    expect([...effective]).toContain(column);
  });
});

describe('the fix preserves everything 024 and 015 promised', () => {
  it('still reports every count, including support signals', () => {
    for (const key of [
      'private_events_deleted',
      'shared_events_transferred',
      'shared_events_deleted',
      'trips_transferred',
      'trips_deleted',
      'records_deleted',
      'cycle_periods_deleted',
      'cycle_daily_logs_deleted',
      'cycle_entries_deleted',
      'cycle_settings_deleted',
      'cycle_sharing_preferences_deleted',
      'cycle_support_signals_deleted',
      'sensitive_consents_deleted',
      'legacy_cycle_backup_deleted',
    ]) {
      expect(deletionFunction).toContain(`'${key}'`);
    }
  });

  it('still refuses any caller that is not service_role', () => {
    expect(deletionFunction).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
  });

  it('still fails closed when records changed during media cleanup', () => {
    expect(deletionFunction).toContain('Account records changed during media cleanup');
    expect(deletionFunction).toContain('Account deletion was not prepared for media cleanup');
  });

  it('still re-arms the ownership-transfer trigger before the plain deletes', () => {
    const armed = deletionFunction.indexOf("set_config('app.plan_ownership_transfer', 'on'");
    const disarmed = deletionFunction.indexOf("set_config('app.plan_ownership_transfer', 'off'");
    const firstPlainDelete = deletionFunction.indexOf('DELETE FROM public.invitation_codes');
    expect(armed).toBeGreaterThan(-1);
    expect(disarmed).toBeGreaterThan(armed);
    expect(firstPlainDelete).toBeGreaterThan(disarmed);
  });

  it('keeps every cycle delete behind an existence check, so it loads pre-022', () => {
    for (const table of [
      'cycle_periods',
      'cycle_daily_logs',
      'cycle_sharing_preferences',
      'user_sensitive_consents',
      'cycle_support_signals',
      'legacy_cycle_entries_backup',
    ]) {
      expect(deletionFunction).toContain(`table_name = '${table}'`);
    }
  });

  it('scopes every delete to one user, never a bare table wipe', () => {
    for (const statement of deletionFunction.match(/DELETE FROM public\.[a-z_]+[^;]*/g) ?? []) {
      expect(statement).toMatch(/WHERE/);
    }
  });
});
