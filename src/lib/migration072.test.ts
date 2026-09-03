import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

let migration = '';
try {
  migration = readFileSync(
    'supabase/migrations/072_close_private_capable_realtime_metadata.sql',
    'utf8',
  );
} catch {
  // The RED run must fail assertions, not abort before the test can report the
  // missing migration as the feature under test.
}

describe('migration 072 realtime privacy contract', () => {
  it('uses one fixed-search-path security-definer trigger with a strict argument allowlist', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.emit_private_capable_collaboration_invalidation\(\)/i);
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/SET search_path\s*=\s*public,\s*pg_temp/i);
    expect(migration).toMatch(/TG_ARGV\[0\]\s+NOT IN\s*\('records',\s*'tasks'\)/i);
    expect(migration).toMatch(/INSERT INTO public\.collaboration_invalidations\s*\(couple_id, slice, updated_at\)/i);
    expect(migration).toMatch(/ON CONFLICT\s*\(couple_id, slice\)\s*DO UPDATE SET updated_at/i);
  });

  it('mutation-fails when private filters, transitions, or distinct couple handling are removed', () => {
    expect(migration).toMatch(/TG_OP\s*=\s*'INSERT'[\s\S]{0,500}is_private\s+IS\s+TRUE[\s\S]{0,500}RETURN NEW/i);
    expect(migration).toMatch(/OLD\.is_private\s+IS\s+TRUE\s+AND\s+NEW\.is_private\s+IS\s+TRUE[\s\S]{0,300}RETURN NEW/i);
    expect(migration).toMatch(/OLD\.couple_id\s+IS DISTINCT FROM\s+NEW\.couple_id/i);
    expect(migration).toMatch(/v_old_couple_id[\s\S]{0,500}v_new_couple_id/i);
    expect(migration).toMatch(/IF OLD\.is_private IS FALSE[\s\S]{0,500}v_old_couple_id\s*:=\s*OLD\.couple_id/i);
    expect(migration).toMatch(/IF NEW\.is_private IS FALSE[\s\S]{0,500}v_new_couple_id\s*:=\s*NEW\.couple_id/i);
  });

  it('installs both trigger replacements and the publication compatibility changes', () => {
    expect(migration).toMatch(/DROP TRIGGER IF EXISTS emit_daily_records_collaboration_invalidation ON public\.daily_records/i);
    expect(migration).toMatch(/CREATE TRIGGER emit_daily_records_collaboration_invalidation[\s\S]{0,180}AFTER INSERT OR UPDATE OR DELETE ON public\.daily_records/i);
    expect(migration).toMatch(/DROP TRIGGER IF EXISTS emit_couple_tasks_collaboration_invalidation ON public\.couple_tasks/i);
    expect(migration).toMatch(/CREATE TRIGGER emit_couple_tasks_collaboration_invalidation[\s\S]{0,180}AFTER INSERT OR UPDATE OR DELETE ON public\.couple_tasks/i);
    expect(migration).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.collaboration_invalidations/i);
    expect(migration).toMatch(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.daily_records/i);
    expect(migration).toMatch(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.couple_tasks/i);
  });

  it('mutation-fails if privilege, RLS/search-path, or destructive-operation safeguards are weakened', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.emit_private_capable_collaboration_invalidation\(\) FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/ALTER TABLE public\.collaboration_invalidations ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/fixed|fully-qualified|content-free/i);
    const withoutPublicationChanges = migration.replace(/ALTER PUBLICATION[^;]+;/gi, '');
    expect(withoutPublicationChanges).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM public\.daily_records|DELETE FROM public\.couple_tasks|REPLICA IDENTITY FULL/i);
  });

  it('writes invalidations only while the parent couple still exists', () => {
    const liveParentGuards = migration.match(/FROM public\.couples AS live_couple\s+WHERE live_couple\.id = v_(?:old|new)_couple_id/gi) ?? [];
    expect(liveParentGuards).toHaveLength(4);
  });

  it('mutation-tests each private filter, transition, publication, and privilege control', () => {
    const assertPrivateAndTransitionControls = (sql: string) => {
      expect(sql).toMatch(/IF TG_OP = 'DELETE'[\s\S]{0,180}IF OLD\.is_private IS TRUE[\s\S]{0,80}RETURN OLD/i);
      expect(sql).toMatch(/IF TG_OP = 'INSERT'[\s\S]{0,180}IF NEW\.is_private IS TRUE[\s\S]{0,80}RETURN NEW/i);
      expect(sql).toMatch(/IF OLD\.is_private IS TRUE AND NEW\.is_private IS TRUE[\s\S]{0,80}RETURN NEW/i);
      expect(sql).toMatch(/OLD\.couple_id IS DISTINCT FROM NEW\.couple_id/i);
    };
    const assertPublicationControls = (sql: string) => {
      expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.daily_records/i);
      expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.couple_tasks/i);
    };
    const assertPrivilegeControls = (sql: string) => {
      expect(sql).toMatch(/SECURITY DEFINER/i);
      expect(sql).toMatch(/SET search_path = public, pg_temp/i);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.emit_private_capable_collaboration_invalidation\(\) FROM PUBLIC, anon, authenticated, service_role/i);
    };
    const assertParentCascadeControls = (sql: string) => {
      const liveParentGuards = sql.match(/FROM public\.couples AS live_couple\s+WHERE live_couple\.id = v_(?:old|new)_couple_id/gi) ?? [];
      expect(liveParentGuards).toHaveLength(4);
    };

    expect(() => assertPrivateAndTransitionControls(
      migration.replace("IF OLD.is_private IS TRUE AND NEW.is_private IS TRUE", "IF FALSE"),
    )).toThrow();
    expect(() => assertPrivateAndTransitionControls(
      migration.replace('OLD.couple_id IS DISTINCT FROM NEW.couple_id', 'FALSE'),
    )).toThrow();
    expect(() => assertPublicationControls(
      migration.replace('ALTER PUBLICATION supabase_realtime DROP TABLE public.daily_records;', ''),
    )).toThrow();
    expect(() => assertPrivilegeControls(
      migration.replace('REVOKE ALL ON FUNCTION public.emit_private_capable_collaboration_invalidation() FROM PUBLIC, anon, authenticated, service_role;', ''),
    )).toThrow();
    expect(() => assertParentCascadeControls(
      migration.replace(/FROM public\.couples AS live_couple\s+WHERE live_couple\.id = v_old_couple_id/i, ''),
    )).toThrow();
    assertPrivateAndTransitionControls(migration);
    assertPublicationControls(migration);
    assertPrivilegeControls(migration);
    assertParentCascadeControls(migration);
  });
});
