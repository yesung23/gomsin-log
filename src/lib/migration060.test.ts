import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/060_partner_username_projection.sql'), 'utf8');

describe('migration 060 partner username projection', () => {
  it('returns only the active partner and keeps the username read authenticated-only', () => {
    expect(migration).toContain('get_partner_profile_with_username()');
    expect(migration).toContain('p.username');
    expect(migration).toContain('cm.status = \'active\'');
    expect(migration).toContain('p.id <> auth.uid()');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_partner_profile_with_username() TO authenticated');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
