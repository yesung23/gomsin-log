import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/018_shared_tasks_and_trip_places.sql'),
  'utf8',
);

describe('migration 018 shared planning', () => {
  it('is transactional and re-runnable', () => {
    expect(sql.trimStart()).toMatch(/^BEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.couple_tasks');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS address');
  });

  it('keeps tasks inside the active couple and private tasks owner-only', () => {
    expect(sql).toContain('couple_id = public.get_my_active_couple_id()');
    expect(sql).toContain('created_by = auth.uid()');
    expect(sql).toContain('NOT is_private');
    expect(sql).toContain('Task assignee is not an active couple member');
  });

  it('enables realtime and grants no anonymous access', () => {
    expect(sql).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_tasks');
    expect(sql).toContain('REVOKE ALL ON TABLE public.couple_tasks FROM PUBLIC, anon');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.couple_tasks TO authenticated');
  });

  it('validates place metadata instead of accepting arbitrary values', () => {
    expect(sql).toContain('trip_items_coordinates_check');
    expect(sql).toContain("source IN ('manual', 'screenshot', 'kakao')");
    expect(sql).toContain('char_length(business_hours) <= 500');
  });
});
