import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/086_reconcile_record_media_cleanup.sql',
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'),
  );
  return match?.[1] ?? '';
}

describe('migration 086 cleanup reconciliation contract', () => {
  it('exists as one forward-only migration and never deletes Storage metadata', () => {
    expect(migration, 'migration 086 must exist').not.toBe('');
    expect(migration).toMatch(/^BEGIN;/m);
    expect(migration).toMatch(/COMMIT;/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
    expect(migration).not.toMatch(/TRUNCATE\s+(?:TABLE\s+)?storage\.objects/i);
  });

  it('fails closed on schema drift, owner semantics, or an active cleanup lease', () => {
    expect(migration).toMatch(/pg_get_functiondef/i);
    expect(migration).toMatch(/pg_trigger/i);
    expect(migration).toMatch(/storage\.objects[\s\S]*attname\s*=\s*'owner'/i);
    expect(migration).toMatch(/atttypid\s*(?:=|IS DISTINCT FROM)\s*'uuid'::regtype/i);
    expect(migration).toMatch(/storage\.objects[\s\S]*attname\s*=\s*'owner_id'/i);
    expect(migration).toMatch(/atttypid\s*(?:=|IS DISTINCT FROM)\s*'text'::regtype/i);
    expect(migration).toMatch(/record_media_cleanup_jobs[\s\S]*state\s*=\s*'leased'[\s\S]*lease_expires_at\s*>\s*statement_timestamp\(\)/i);
    expect(migration).toMatch(/record_media_objects[\s\S]*state\s*=\s*'leased'[\s\S]*lease_expires_at\s*>\s*statement_timestamp\(\)/i);
    expect(migration).toMatch(/LOCK TABLE[\s\S]*storage\.objects[\s\S]*NOWAIT/i);
  });

  it('requires the exact v2 predecessor instead of accepting v20 or v21', () => {
    expect(migration).toContain("'RETURN[[:space:]]+2[[:space:]]*;'");
  });

  it('preflights every ledger-bound Storage UUID against bucket, path, and current owner_id', () => {
    expect(migration).toMatch(
      /record_media_objects AS media[\s\S]*JOIN storage\.objects AS object[\s\S]*object\.id = media\.storage_object_id[\s\S]*object\.bucket_id IS DISTINCT FROM 'couple-media'[\s\S]*storage\.foldername\(object\.name\)[\s\S]*media\.couple_id[\s\S]*media\.record_id[\s\S]*object\.owner_id[\s\S]*media\.owner_user_id/i,
    );
  });

  it('queues only unambiguous jobless ledger namespaces and retires their historical work', () => {
    expect(migration).toMatch(/record_media_mutations[\s\S]*record_media_objects[\s\S]*count\s*\(\s*DISTINCT/i);
    expect(migration).toMatch(/record_media_cleanup_identity_ambiguous/i);
    expect(migration).toMatch(/INSERT INTO public\.record_media_cleanup_jobs/i);
    expect(migration).toMatch(/SET state = 'abandoned'/i);
    expect(migration).toMatch(/SET state = 'superseded'/i);
  });

  it('turns attributable canonical and non-UUID v0 objects into exact Storage-UUID cleanup work', () => {
    expect(migration).toMatch(/media_contract_version\s*=\s*0/i);
    expect(migration).toMatch(/media_contract_version\s*=\s*1[\s\S]*record_media_cleanup_identity_ambiguous/i);
    expect(migration).toMatch(/object\.owner_id IS NULL/i);
    expect(migration).toMatch(/storage\.filename\(object\.name\)/i);
    expect(migration).toMatch(/record_media_uuid_from_name/i);
    expect(migration).toMatch(/INSERT INTO public\.record_media_objects/i);
    expect(migration).toMatch(/storage_object_id[\s\S]*object\.id/i);
    expect(migration).toMatch(
      /coalesce\([\s\S]*record_media_uuid_from_name\(storage\.filename\(object\.name\)\)[\s\S]*gen_random_uuid\(\)[\s\S]*\)/i,
    );
    expect(migration).toMatch(/'cleanup_pending'/i);
    expect(migration).not.toMatch(/owner[\s\S]{0,300}INSERT INTO public\.record_media_cleanup_jobs/i);
  });

  it('abandons stale recordless mutations without hiding later live stale work', () => {
    const expire = functionBody('expire_stale_record_media_mutation');
    expect(expire).toMatch(
      /UPDATE public\.record_media_mutations AS mutation[\s\S]*SET state = 'abandoned'[\s\S]*NOT EXISTS[\s\S]*public\.daily_records/i,
    );
    expect(expire).toMatch(/owner_user_id/i);
    expect(expire).toMatch(/record_media_cleanup_identity_ambiguous/i);
  });

  it('revalidates exact and prefix deletes against current Storage owner and ledger path', () => {
    const resolveExact = functionBody('resolve_record_media_object_cleanup_path');
    expect(resolveExact).toMatch(/storage\.foldername\(object\.name\)/i);
    expect(resolveExact).toMatch(/object\.owner_id[\s\S]*media\.owner_user_id/i);
    expect(resolveExact).toMatch(/record_media_cleanup_identity_ambiguous/i);

    const storageDelete = functionBody('enforce_record_media_cleanup_storage_row');
    expect(storageDelete).toMatch(/media\.storage_object_id = OLD\.id/i);
    expect(storageDelete).toMatch(/OLD\.owner_id[\s\S]*media\.owner_user_id/i);
    expect(storageDelete).toMatch(/job\.owner_user_id/i);
    expect(storageDelete).toMatch(/record_media_cleanup_identity_ambiguous/i);
  });

  it('reopens contaminated completed jobs and completion replay rechecks ledger and exact Storage prefix', () => {
    expect(migration).toMatch(/state = 'completed'[\s\S]*state = 'pending'/i);
    const complete = functionBody('complete_record_media_cleanup_job');
    expect(complete).toMatch(/FOR UPDATE/i);
    expect(complete).toMatch(/ORDER BY media\.media_object_id[\s\S]*FOR UPDATE/i);
    expect(complete).toMatch(/storage\.foldername\(object\.name\)/i);
    expect(complete).toMatch(/v_state = 'completed'[\s\S]*v_lease_id = p_lease_id/i);
    expect(complete).toMatch(/media\.state <> 'deleted'/i);
    expect(complete).toMatch(/SET state = 'pending'/i);
    expect(complete).toMatch(/RETURN false/i);
  });

  it('extends the generic account fence to owner-attributable unledgered Storage objects', () => {
    const fence = functionBody('assert_account_record_media_cleanup_complete');
    expect(fence).toMatch(/storage\.objects AS object/i);
    expect(fence).toMatch(/object\.bucket_id = 'couple-media'/i);
    expect(fence).toMatch(/object\.owner_id = p_user_id::TEXT/i);
    expect(fence).toMatch(/NOT EXISTS[\s\S]*record_media_objects[\s\S]*storage_object_id = object\.id/i);
    expect(fence).toMatch(/record_media_cleanup_pending/i);
    expect(fence).not.toMatch(/RAISE EXCEPTION\s+[^;]*(?:object\.name|object\.id|owner_user_id)/i);
  });

  it('publishes exact service-only contract 3 with fixed definer search paths', () => {
    expect(functionBody('record_media_cleanup_contract_version')).toMatch(/RETURN 3/i);
    for (const { declaration, signature } of [
      {
        declaration: 'complete_record_media_cleanup_job\\([^)]*UUID[^)]*UUID[^)]*\\)',
        signature: 'complete_record_media_cleanup_job\\(UUID, UUID\\)',
      },
      {
        declaration: 'assert_account_record_media_cleanup_complete\\([^)]*UUID[^)]*UUID[^)]*\\)',
        signature: 'assert_account_record_media_cleanup_complete\\(UUID, UUID\\)',
      },
      {
        declaration: 'record_media_cleanup_contract_version\\(\\)',
        signature: 'record_media_cleanup_contract_version\\(\\)',
      },
    ]) {
      expect(migration).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${declaration}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public, pg_temp`, 'i'),
      );
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role`, 'i'),
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO service_role`, 'i'),
      );
    }
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';/i);
  });
});
