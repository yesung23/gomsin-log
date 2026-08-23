import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/059_partner_managed_username.sql'), 'utf8');

describe('migration 059 partner-managed username', () => {
  it('blocks owner-side username mutation and validates non-null partner input', () => {
    expect(migration).toContain('enforce_partner_managed_username');
    expect(migration).toContain('auth.uid() = OLD.id');
    expect(migration).toContain("auth.uid() IS NULL AND NEW.username IS DISTINCT FROM OLD.username");
    expect(migration).toContain('IF p_username IS NULL THEN');
    expect(migration).toContain("v_username !~ '^[a-z][a-z0-9_]{2,19}$'");
  });

  it('serializes against disconnect and keeps the RPC authenticated-only', () => {
    expect(migration).toContain('FROM public.couples WHERE id = v_couple_id FOR UPDATE');
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain('public.set_partner_username(text)');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.set_partner_username(text) TO authenticated');
    expect(migration).toContain("VALUES (v_couple_id, 'profile'");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
