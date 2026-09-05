import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/083_record_media_cleanup_jobs.sql',
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
  );
  return match?.[1] ?? '';
}

describe('migration 083 record/media cleanup contract', () => {
  it('exists as one forward migration and keeps the tombstone content-free', () => {
    expect(migration, 'migration 083 must exist').not.toBe('');

    const table = migration.match(
      /CREATE TABLE public\.record_media_cleanup_jobs \(([\s\S]*?)\n\);/i,
    )?.[1] ?? '';
    expect(table).toContain('record_id UUID PRIMARY KEY');
    expect(table).toContain('couple_id UUID NOT NULL');
    expect(table).toContain('owner_user_id UUID NOT NULL');
    expect(table).not.toMatch(/\bREFERENCES\b/i);
    expect(table).not.toMatch(/filename|attachment|signed_url|token|secret|content|log_text/i);
  });

  it('makes tombstone identity immutable, RLS-protected, and unavailable by direct API grants', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.record_media_cleanup_jobs ENABLE ROW LEVEL SECURITY/i,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.record_media_cleanup_jobs\s+FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(functionBody('enforce_record_media_cleanup_identity_immutable')).toMatch(
      /OLD\.record_id[\s\S]*OLD\.couple_id[\s\S]*OLD\.owner_user_id/i,
    );
  });

  it('queues every row deletion before disappearance and drains Storage under the existing lock order', () => {
    const enqueue = functionBody('enqueue_record_media_cleanup');
    expect(enqueue).toMatch(/LOCK TABLE storage\.objects IN SHARE MODE/i);
    expect(enqueue).toMatch(/INSERT INTO public\.record_media_cleanup_jobs/i);
    expect(migration).toMatch(
      /CREATE TRIGGER aab_083_enqueue_record_media_cleanup\s+BEFORE DELETE ON public\.daily_records/i,
    );

    const rpc = functionBody('delete_my_record');
    expect(rpc).toMatch(/v_uid UUID := auth\.uid\(\)/i);
    expect(rpc).toMatch(/public\.assert_account_write_open\([\s\S]*ARRAY\[v_uid\][\s\S]*true/i);
    expect(rpc.indexOf('assert_account_write_open')).toBeLessThan(rpc.indexOf('DELETE FROM public.daily_records'));
    expect(rpc).toMatch(/user_id = v_uid/i);
    expect(rpc).toMatch(/couple_id = p_expected_couple_id/i);
  });

  it('collapses inaccessible records to false and exposes the owner RPC only to authenticated', () => {
    expect(functionBody('delete_my_record')).toMatch(/RETURN false/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.delete_my_record\(UUID, UUID, UUID\)\s+FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.delete_my_record\(UUID, UUID, UUID\)\s+TO authenticated/i,
    );
  });

  it('revokes authenticated Storage DELETE while allowing only an unexpired leased prefix for service cleanup', () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Active members can delete from couple-media"/i);
    expect(migration).toMatch(/REVOKE DELETE ON storage\.objects FROM authenticated/i);

    const storageGate = functionBody('enforce_record_media_cleanup_storage_row');
    expect(storageGate).toMatch(/auth\.role\(\).*service_role/is);
    expect(storageGate).toMatch(/job\.state = 'leased'/i);
    expect(storageGate).toMatch(/job\.lease_expires_at > statement_timestamp\(\)/i);
    expect(storageGate).toMatch(/record_id::TEXT = \(storage\.foldername\(OLD\.name\)\)\[2\]/i);
    expect(storageGate).toMatch(/couple_id::TEXT = \(storage\.foldername\(OLD\.name\)\)\[1\]/i);
  });

  it('claims one job with SKIP LOCKED and makes settle/fail response-loss idempotent', () => {
    const claim = functionBody('claim_record_media_cleanup_job');
    expect(claim).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(claim).toMatch(/LIMIT 1/i);
    expect(claim).toMatch(/lease_expires_at/i);

    expect(functionBody('complete_record_media_cleanup_job')).toMatch(
      /state = 'completed'[\s\S]*lease_id = p_lease_id/i,
    );
    expect(functionBody('fail_record_media_cleanup_job')).toMatch(
      /failure_count[\s\S]*state IN \('pending', 'blocked'\)[\s\S]*lease_id = p_lease_id/i,
    );
  });

  it('blocks relationship closure until every owned job is completed', () => {
    const barrier = functionBody('assert_account_record_media_cleanup_complete');
    expect(barrier).toMatch(/owner_user_id = p_user_id/i);
    expect(barrier).toMatch(/state <> 'completed'/i);
    expect(barrier).toMatch(/record_media_cleanup_pending/i);

    const close = functionBody('close_account_relationship_generations_v2');
    expect(close).toMatch(/open_account_deletion_write_capability/i);
    expect(close.indexOf('open_account_deletion_write_capability')).toBeLessThan(
      close.indexOf('assert_account_record_media_cleanup_complete'),
    );
    expect(close.indexOf('assert_account_record_media_cleanup_complete')).toBeGreaterThanOrEqual(0);
    expect(close.indexOf('assert_account_record_media_cleanup_complete')).toBeLessThan(
      close.indexOf('close_account_relationship_generations_v2_internal_083'),
    );
    expect(close).toMatch(/close_account_write_capability/i);
  });
});
