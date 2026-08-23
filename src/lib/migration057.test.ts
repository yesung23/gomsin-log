import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/057_profile_identity_and_caption.sql'),
  'utf8',
);

describe('migration 057 profile identity and caption', () => {
  it('adds nullable profile identity fields with database constraints', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS username TEXT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS profile_caption TEXT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS profile_date_type TEXT');
    expect(migration).toContain("username ~ '^[a-z][a-z0-9_]{2,19}$'");
    expect(migration).toContain('char_length(profile_caption) <= 80');
    expect(migration).toContain("profile_date_type IN ('together', 'meeting', 'discharge')");
  });

  it('uses a case-insensitive unique index and never adds an RPC', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique_idx');
    expect(migration).toContain('ON public.profiles (lower(username))');
    expect(migration).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION/i);
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
