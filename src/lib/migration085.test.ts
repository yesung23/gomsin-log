import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/085_harden_record_media_cleanup.sql',
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
  );
  return match?.[1] ?? '';
}

describe('migration 085 record media cleanup hardening contract', () => {
  it('makes daily record id, owner, and couple identity immutable before the media commit trigger', () => {
    expect(migration, 'migration 085 must exist').not.toBe('');
    const identity = functionBody('enforce_daily_record_identity_immutable');
    expect(identity).toMatch(/OLD\.id IS DISTINCT FROM NEW\.id/i);
    expect(identity).toMatch(/OLD\.user_id IS DISTINCT FROM NEW\.user_id/i);
    expect(identity).toMatch(/OLD\.couple_id IS DISTINCT FROM NEW\.couple_id/i);
    expect(identity).toMatch(/daily_record_identity_immutable/i);
    expect(migration).toMatch(
      /CREATE TRIGGER aab_085_daily_record_identity_immutable\s+BEFORE UPDATE ON public\.daily_records/i,
    );
    expect(migration.indexOf('aab_085_daily_record_identity_immutable')).toBeLessThan(
      migration.indexOf('zzz_084_commit_record_media_mutation'),
    );
  });

  it('blocks every non-deleted object in a namespace attributable to the deleting owner', () => {
    const fence = functionBody('assert_account_record_media_cleanup_complete');
    expect(fence).toMatch(/media\.state <> 'deleted'/i);
    expect(fence).toMatch(/daily_records[\s\S]*user_id = p_user_id/i);
    expect(fence).toMatch(/record_media_cleanup_jobs[\s\S]*owner_user_id = p_user_id/i);
    expect(fence).toMatch(/record_media_mutations[\s\S]*owner_user_id = p_user_id/i);
    expect(fence).toMatch(/owned_media[\s\S]*owner_user_id = p_user_id/i);
    expect(fence).toMatch(/record_media_cleanup_pending/i);
    expect(fence).not.toMatch(
      /RAISE EXCEPTION\s+[^;]*(?:media_object_id|owner_user_id|record_id)/i,
    );

    const complete = functionBody('complete_record_media_cleanup_job');
    expect(complete).toMatch(/media\.record_id = p_record_id/i);
    expect(complete).toMatch(/media\.couple_id = v_couple_id/i);
    expect(complete).toMatch(/media\.state <> 'deleted'/i);
    expect(complete).toMatch(/SET state = 'deleted'/i);
    expect(complete).toMatch(/deleted_at = coalesce\(deleted_at, clock_timestamp\(\)\)/i);
  });

  it('keeps security-definer search paths and API privileges closed, then reloads PostgREST', () => {
    expect(migration).toMatch(
      /CREATE FUNCTION public\.enforce_daily_record_identity_immutable\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enforce_daily_record_identity_immutable\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.assert_account_record_media_cleanup_complete\(UUID, UUID\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.assert_account_record_media_cleanup_complete\(UUID, UUID\)\s+TO (?:anon|authenticated)/i,
    );
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';/i);
  });
});
