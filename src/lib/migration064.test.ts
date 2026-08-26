import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  executableStatements,
  parseNotifies,
  stripSqlComments,
} from '@/test/sqlModel';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/064_lock_crypto_pairings_table_privileges.sql'),
  'utf8',
);

describe('migration 064 lock crypto_pairings table privileges', () => {
  it('is wrapped in a single transaction with BEGIN and COMMIT', () => {
    const statements = executableStatements(sql);
    expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1);
  });

  it('revokes all privileges on public.crypto_pairings from PUBLIC, anon, and authenticated', () => {
    const executable = stripSqlComments(sql);
    expect(executable).toMatch(
      /REVOKE\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+TABLE\s+public\.crypto_pairings\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
  });

  it('grants only SELECT on public.crypto_pairings to authenticated', () => {
    const executable = stripSqlComments(sql);
    expect(executable).toMatch(
      /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.crypto_pairings\s+TO\s+authenticated/i,
    );
    // Ensure no other GRANT exists on table or function in this migration
    const grants = executableStatements(sql).filter((stmt) => /^GRANT\b/i.test(stmt));
    expect(grants).toEqual([
      'GRANT SELECT ON TABLE public.crypto_pairings TO authenticated',
    ]);
  });

  it('notifies PostgREST to reload the schema cache', () => {
    expect(parseNotifies(sql)).toEqual([
      { channel: 'pgrst', payload: 'reload schema' },
    ]);
  });

  it('contains no DDL or DML statements other than table privilege REVOKE and GRANT', () => {
    const executable = stripSqlComments(sql);
    expect(executable).not.toMatch(/\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it('documents safe forward rollback without restoring broad privileges', () => {
    expect(sql).toMatch(/ROLLBACK:/i);
    expect(sql).toContain('Do not restore broad table privileges');
    expect(sql).toMatch(/REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.crypto_pairings\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.crypto_pairings\s+TO\s+authenticated/i);
  });
});
