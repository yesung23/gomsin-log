import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/084_record_media_object_lifecycle.sql',
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const recordsSource = readFileSync(resolve(process.cwd(), 'src/lib/records.ts'), 'utf8');
const storeSource = readFileSync(resolve(process.cwd(), 'src/lib/store.tsx'), 'utf8');

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
  );
  return match?.[1] ?? '';
}

describe('migration 084 record media object lifecycle contract', () => {
  it('is forward-only and adds the non-downgradable record media contract columns', () => {
    expect(migration, 'migration 084 must exist').not.toBe('');
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS media_contract_version/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS media_manifest_revision/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS last_media_operation_id/i);

    const commit = functionBody('commit_record_media_mutation');
    expect(commit).toMatch(/OLD\.media_contract_version[\s\S]*NEW\.media_contract_version/i);
    expect(commit).toMatch(/media_contract_downgrade/i);
    expect(commit).toMatch(/base_content_revision[\s\S]*OLD\.content_revision/i);
    expect(commit).toMatch(/target_content_revision[\s\S]*NEW\.content_revision/i);
  });

  it('keeps all lifecycle ledgers private, content-free, and without user/couple/record foreign keys', () => {
    for (const tableName of [
      'record_media_mutations',
      'record_media_mutation_items',
      'record_media_objects',
    ]) {
      const table = migration.match(
        new RegExp(`CREATE TABLE public\\.${tableName} \\(([\\s\\S]*?)\\n\\);`, 'i'),
      )?.[1] ?? '';
      expect(table, `${tableName} must exist`).not.toBe('');
      expect(table).not.toMatch(/filename|signed_url|content_envelope|display_order|media_type|log_text/i);
      expect(table).not.toMatch(/REFERENCES\s+(?:auth\.users|public\.couples|public\.daily_records)/i);
      expect(migration).toMatch(
        new RegExp(`ALTER TABLE public\\.${tableName} ENABLE ROW LEVEL SECURITY`, 'i'),
      );
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON TABLE public\\.${tableName}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role`, 'i'),
      );
    }
  });

  it('exposes only begin, status, and abandon to authenticated callers and collapses inaccessible records', () => {
    for (const signature of [
      'begin_record_media_mutation\\(UUID, UUID, UUID, UUID, BIGINT, BIGINT, TEXT\\[\\], UUID\\[\\]\\)',
      'record_media_mutation_status\\(UUID, UUID, UUID, UUID\\)',
      'abandon_record_media_mutation\\(UUID, UUID, UUID, UUID\\)',
    ]) {
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role`, 'i'),
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO authenticated`, 'i'),
      );
    }

    const begin = functionBody('begin_record_media_mutation');
    expect(begin).toMatch(/v_uid UUID := auth\.uid\(\)/i);
    expect(begin).toMatch(/assert_account_write_open/i);
    expect(begin).toMatch(/relationship\.closed_at IS NULL/i);
    expect(begin).toMatch(/FOR UPDATE OF relationship/i);
    expect(begin).toMatch(/FOR UPDATE(?:;|\s)/i);
    expect(begin).toMatch(/media_mutation_unavailable/i);
    expect(begin).toMatch(/record_media_objects[\s\S]*ORDER BY[\s\S]*media_object_id[\s\S]*FOR UPDATE/i);
    expect(begin).toMatch(/pg_advisory_xact_lock\([\s\S]*record-media-record:/i);
    expect(begin.indexOf('FOR UPDATE;')).toBeLessThan(
      begin.indexOf("hashtextextended('record-media-record:"),
    );
    expect(begin.indexOf("hashtextextended('record-media-record:")).toBeLessThan(
      begin.indexOf('FROM storage.objects AS object'),
    );
  });

  it('permits only one pending operation per record while preserving same-operation replay', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX record_media_mutations_one_pending_record_idx[\s\S]*ON public\.record_media_mutations \(record_id\)[\s\S]*WHERE state = 'pending'/i,
    );
    const begin = functionBody('begin_record_media_mutation');
    expect(begin).toMatch(
      /mutation\.record_id = p_record_id[\s\S]*mutation\.state = 'pending'[\s\S]*media_mutation_busy[\s\S]*ERRCODE = '40001'/i,
    );
    expect(begin).toMatch(/IF FOUND[\s\S]*v_existing\.operation_id/i);
  });

  it('commits the exact operation after E2EE revision validation and retires removed objects atomically', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER zzz_084_commit_record_media_mutation\s+BEFORE UPDATE ON public\.daily_records/i,
    );
    const commit = functionBody('commit_record_media_mutation');
    expect(commit).not.toMatch(/content_envelope\s*(?:->|#>|::json|::text)/i);
    expect(commit).toMatch(/ORDER BY[\s\S]*media_object_id[\s\S]*FOR UPDATE/i);
    expect(commit).toMatch(/state = 'active'/i);
    expect(commit).toMatch(/state = 'cleanup_pending'/i);
    expect(commit).toMatch(/state = 'committed'/i);
    expect(commit).toMatch(/NEW\.media_contract_version := 1/i);
    expect(commit).toMatch(/NEW\.last_media_operation_id/i);
  });

  it('drains pre-trigger uploads before begin, commit, abandon, or expiry can classify reservations', () => {
    for (const name of [
      'begin_record_media_mutation',
      'commit_record_media_mutation',
      'abandon_record_media_mutation',
      'expire_stale_record_media_mutation',
    ]) {
      const body = functionBody(name);
      const objectLock = body.search(
        /record_media_objects[\s\S]*?ORDER BY[\s\S]*?media_object_id[\s\S]*?FOR UPDATE;/i,
      );
      const storageFence = body.indexOf("hashtextextended('record-media-record:");
      const storageScan = body.indexOf('FROM storage.objects AS object');
      expect(objectLock, `${name} must lock object rows`).toBeGreaterThanOrEqual(0);
      expect(storageFence, `${name} must take the record-scoped writer fence`).toBeGreaterThan(objectLock);
      expect(storageScan, `${name} must scan only after the fence`).toBeGreaterThan(storageFence);
      expect(body, `${name} must not serialize unrelated Storage writes`).not.toMatch(
        /LOCK TABLE storage\.objects IN SHARE MODE/i,
      );
    }
    expect(migration.match(/LOCK TABLE storage\.objects IN SHARE MODE/gi)).toHaveLength(1);
  });

  it('uses foldername only for the two directory segments and filename for object identity', () => {
    expect(migration).not.toMatch(/array_length\(storage\.foldername\([^)]*\),\s*1\)\s*(?:=|IS DISTINCT FROM)\s*3/i);
    expect(migration).not.toMatch(/storage\.foldername\([^)]*\)\)\[3\]/i);
    expect(migration).toMatch(/storage\.filename\(v_path\)/i);
    expect(migration).toMatch(/storage\.filename\(object\.name\)/i);
    expect(migration).toMatch(/storage\.filename\(NEW\.name\)/i);
  });

  it('keeps legacy v0 reads while v1 reads require the exact active ledger object', () => {
    const readGate = functionBody('can_read_record_media_object');
    expect(readGate).toMatch(/media_contract_version = 0/i);
    expect(readGate).toMatch(/record_media_objects/i);
    expect(readGate).toMatch(/storage_object_id = p_storage_object_id/i);
    expect(readGate).toMatch(
      /record_media_uuid_from_name\(\s*storage\.filename\(p_object_name\)\s*\)/i,
    );
    expect(readGate).toMatch(/IF FOUND[\s\S]*state IS NOT DISTINCT FROM 'active'/i);
    expect(readGate).toMatch(/v_media_contract_version = 0/i);
    expect(migration).toMatch(/CREATE POLICY "Active members can read couple-media"/i);
    expect(migration).toMatch(/public\.can_read_record_media_object\(\s*id,\s*name/i);
  });

  it('preserves the full-prefix lease while requiring an exact object lease for object cleanup', () => {
    const storageGate = functionBody('enforce_record_media_cleanup_storage_row');
    expect(storageGate).toMatch(/pg_advisory_xact_lock\([\s\S]*record-media-record:/i);
    const insertGate = storageGate.slice(storageGate.indexOf("IF TG_OP = 'INSERT'"));
    expect(insertGate.indexOf("hashtextextended('record-media-record:")).toBeLessThan(
      insertGate.indexOf('record_media_cleanup_jobs'),
    );
    expect(storageGate).toMatch(/record_media_cleanup_jobs[\s\S]*lease_expires_at > statement_timestamp\(\)/i);
    expect(storageGate).toMatch(/record_media_objects[\s\S]*storage_object_id = OLD\.id/i);
    expect(storageGate).toMatch(/lease_expires_at > statement_timestamp\(\)/i);
    expect(storageGate.indexOf("IF TG_OP = 'DELETE' AND OLD.bucket_id = 'couple-media'")).toBeLessThan(
      storageGate.indexOf('IF public.has_account_write_capability()'),
    );
    expect(storageGate).toMatch(/record_media_delete_requires_worker/i);
    expect(storageGate).toMatch(/record_id_retired_for_media_cleanup/i);
    expect(storageGate).toMatch(/media_upload_reservation_required/i);
    expect(storageGate).toMatch(
      /v_media_object_id IS NOT NULL[\s\S]*record_media_objects AS known_media[\s\S]*known_media\.media_object_id = v_media_object_id/i,
    );
  });

  it('provides leased object settlement, account barriers, and an exact service-only contract version', () => {
    expect(functionBody('claim_record_media_object_cleanup_job')).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(functionBody('settle_record_media_object_cleanup_job')).toMatch(
      /storage\.objects[\s\S]*storage_object_id/i,
    );
    expect(functionBody('fail_record_media_object_cleanup_job')).toMatch(
      /failure_count[\s\S]*blocked/i,
    );

    const enqueue = functionBody('enqueue_record_media_cleanup');
    expect(enqueue).toMatch(/record_media_mutations[\s\S]*FOR UPDATE/i);
    expect(enqueue).toMatch(/record_media_objects[\s\S]*ORDER BY[\s\S]*media_object_id[\s\S]*FOR UPDATE/i);
    expect(enqueue).toMatch(/record_media_object_cleanup_leased/i);
    expect(enqueue.indexOf('record_media_objects')).toBeLessThan(
      enqueue.indexOf("hashtextextended('record-media-record:"),
    );
    expect(enqueue).not.toMatch(/LOCK TABLE storage\.objects IN SHARE MODE/i);

    expect(functionBody('assert_account_record_media_cleanup_complete')).toMatch(
      /record_media_objects[\s\S]*cleanup_pending[\s\S]*leased[\s\S]*blocked/i,
    );
    expect(functionBody('record_media_cleanup_contract_version')).toMatch(/RETURN 2/i);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_media_cleanup_contract_version\(\)\s+TO service_role/i,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_media_cleanup_contract_version\(\)\s+TO (?:anon|authenticated)/i,
    );
  });

  it('has no callable authenticated Storage DELETE path in active record client code', () => {
    expect(recordsSource).not.toMatch(/export\s+(?:async\s+)?function\s+removeRecordMedia/i);
    expect(recordsSource).not.toMatch(/storage\.from\(MEDIA_BUCKET\)\.remove\s*\(/i);
    expect(storeSource).not.toMatch(/removeRecordMedia|\.storage\.from\([^)]*\)\.remove\s*\(/i);
  });
});
