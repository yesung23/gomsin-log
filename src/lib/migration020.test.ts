import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/020_fix_uuid_active_couple_lookup.sql'),
  'utf8',
);
const executableSql = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('migration 020 active-couple UUID lookup repair', () => {
  it('redefines the exact helper contract used by RLS', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_my_active_couple_id()');
    expect(migration).toContain('RETURNS UUID');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
  });

  it('never calls the unsupported min(uuid) aggregate', () => {
    expect(executableSql).not.toMatch(/\bmin\s*\(/i);
    expect(migration).toContain('SELECT count(*)');
    expect(migration).toContain('SELECT member.couple_id');
  });

  it('keeps the duplicate active-membership fail-closed guard', () => {
    expect(migration).toContain('IF v_count > 1 THEN');
    expect(migration).toContain("RAISE EXCEPTION 'Multiple active couples found for user'");
  });

  it('keeps the function private to authenticated callers and reloads PostgREST', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_my_active_couple_id() FROM PUBLIC;',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_my_active_couple_id() FROM anon;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;',
    );
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
