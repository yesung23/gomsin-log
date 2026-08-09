import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/021_restore_profile_military_info.sql'),
  'utf8',
);
const syncSource = readFileSync(resolve(process.cwd(), 'src/lib/sync.ts'), 'utf8');

describe('migration 021 profile military-info repair', () => {
  it('restores and backfills the exact JSONB column used by the client', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS military_info JSONB');
    expect(migration).toContain("SET military_info = '{}'::jsonb");
    expect(migration).toContain('ALTER COLUMN military_info SET NOT NULL');
    expect(migration).toContain("ALTER COLUMN military_info SET DEFAULT '{}'::jsonb");
  });

  it('keeps authenticated profile writes and refreshes PostgREST', () => {
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;',
    );
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    expect(migration.trim()).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;$/);
  });

  it('makes account hydration assert the profile schema contract', () => {
    expect(syncSource).toContain(
      ".select('id, display_name, role, avatar_path, military_info, onboarding_completed_at')",
    );
    expect(syncSource).not.toMatch(/\.from\('profiles'\)\s*\.select\('\*'\)/);
  });
});
