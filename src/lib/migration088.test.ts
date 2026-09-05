import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/088_block_live_record_prefix_cleanup.sql',
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(
      `CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      'i',
    ),
  );
  return match?.[1] ?? '';
}

describe('migration 088 live-record cleanup fence', () => {
  it('is a forward-only migration that never deletes Storage metadata', () => {
    expect(migration, 'migration 088 must exist').not.toBe('');
    expect(migration).toMatch(/^BEGIN;/m);
    expect(migration).toMatch(/COMMIT;/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
    expect(migration).not.toMatch(/TRUNCATE\s+(?:TABLE\s+)?storage\.objects/i);
  });

  it('requires exact cleanup contract 3 and fails closed when any live record already has a prefix job', () => {
    expect(migration).toContain("'RETURN[[:space:]]+3[[:space:]]*;'");
    expect(migration).toMatch(/LOCK TABLE public\.daily_records[\s\S]*NOWAIT/i);
    expect(migration).toMatch(/LOCK TABLE public\.record_media_cleanup_jobs[\s\S]*NOWAIT/i);
    expect(migration).toMatch(
      /FROM public\.daily_records AS record[\s\S]*JOIN public\.record_media_cleanup_jobs AS job[\s\S]*job\.record_id = record\.id/i,
    );
    expect(migration).toMatch(/migration_088_live_record_cleanup_conflict/i);
  });

  it('skips pending and expired leased prefix jobs while their record is live', () => {
    const claim = functionBody('claim_record_media_cleanup_job');
    expect(claim).toMatch(/state = 'pending'/i);
    expect(claim).toMatch(/state = 'leased'[\s\S]*lease_expires_at <= clock_timestamp\(\)/i);
    expect(claim).toMatch(
      /NOT EXISTS\s*\([\s\S]*FROM public\.daily_records AS record[\s\S]*record\.id = job\.record_id[\s\S]*\)/i,
    );
    expect(claim).toMatch(/FOR UPDATE SKIP LOCKED/i);
  });

  it('blocks prefix deletion for a live record but preserves active exact-object cleanup', () => {
    const guard = functionBody('guard_live_record_prefix_cleanup');
    const exactLease = guard.search(/record_media_objects[\s\S]*storage_object_id = OLD\.id[\s\S]*state = 'leased'/i);
    const liveFence = guard.search(/daily_records[\s\S]*record\.id = v_record_id/i);
    expect(exactLease).toBeGreaterThanOrEqual(0);
    expect(liveFence).toBeGreaterThan(exactLease);
    expect(guard).toMatch(/record_media_cleanup_jobs[\s\S]*job\.state = 'leased'/i);
    expect(guard).toMatch(/record_media_cleanup_live_record_conflict/i);
    expect(guard).not.toMatch(/RAISE EXCEPTION[^;]*(?:OLD\.name|OLD\.id|v_record_id|v_couple_id)/i);
  });

  it('rejects completion and completed replay before mutating any live-record job state', () => {
    const complete = functionBody('complete_record_media_cleanup_job');
    const liveFence = complete.search(/FROM public\.daily_records AS record[\s\S]*record\.id = p_record_id/i);
    const delegation = complete.search(/complete_record_media_cleanup_job_internal_088/i);
    expect(liveFence).toBeGreaterThanOrEqual(0);
    expect(delegation).toBeGreaterThan(liveFence);
    expect(complete).not.toMatch(/UPDATE public\.record_media_/i);
    expect(complete).toMatch(/record_media_cleanup_live_record_conflict/i);
    expect(complete).not.toMatch(/RAISE EXCEPTION[^;]*(?:p_record_id|v_couple_id|v_owner_user_id)/i);
  });

  it('publishes service-only cleanup contract 4 and reloads the schema cache', () => {
    expect(functionBody('record_media_cleanup_contract_version')).toMatch(/RETURN 4/i);
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.record_media_cleanup_contract_version\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_media_cleanup_contract_version\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_media_cleanup_contract_version\(\)[\s\S]*TO service_role/i,
    );
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';/i);
  });
});
