import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/058_couple_highlights.sql'), 'utf8');

describe('migration 058 couple highlights', () => {
  it('keeps highlights couple-scoped and shared-record-only', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.couple_highlights');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.couple_highlight_items');
    expect(migration).toContain('r.is_private = false');
    expect(migration).toContain("slice IN ('events', 'cycle_support', 'talk_about', 'highlights', 'profile')");
    expect(migration).toContain('prune_highlight_items_on_record');
  });

  it('derives the active couple from the session and exposes only the RPC write path', () => {
    expect(migration).toContain('public.get_my_active_couple_id()');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('public.save_couple_highlight(uuid, text, uuid[], integer)');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.save_couple_highlight(uuid, text, uuid[], integer) TO authenticated');
    expect(migration).not.toContain('p_cover_record_id');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
