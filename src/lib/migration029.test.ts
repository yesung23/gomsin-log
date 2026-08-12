import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canExecute, executePrivileges } from '@/test/sqlModel';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/029_cleanup_solo_couples_on_account_deletion.sql'),
  'utf8',
);

describe('029 sole-member couple cleanup', () => {
  it('is service_role only with a fixed search_path', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");

    const privileges = executePrivileges(
      migration,
      'public.cleanup_account_solo_couples(uuid)',
    );
    expect(canExecute(privileges, 'service_role')).toBe(true);
    expect(canExecute(privileges, 'authenticated')).toBe(false);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(privileges.publicHolds).toBe(false);
  });

  it('deletes only a couple linked to the deleting account', () => {
    expect(migration).toContain('mine.couple_id = couple.id');
    expect(migration).toContain('mine.user_id = p_user_id');
  });

  it('preserves active, pending and former partners by checking any other member', () => {
    expect(migration).toContain('NOT EXISTS');
    expect(migration).toContain('other.couple_id = couple.id');
    expect(migration).toContain('other.user_id <> p_user_id');
    expect(migration).not.toMatch(/other\.status\s*=/);
  });

  it('never performs a broad or unrelated delete', () => {
    const deletes = migration.match(/DELETE FROM public\.[a-z_]+[\s\S]*?;/g) ?? [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('WHERE mine.couple_id = couple.id');
    expect(deletes[0]).toContain('mine.user_id = p_user_id');
  });
});
