import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/080_revoke_private_record_trigger_execute.sql'),
  'utf8',
);

describe('migration 080 - the private-record trigger is not a callable RPC', () => {
  it('revokes the exposed trigger function from every API-facing role', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.clear_talk_about_marks_when_record_private\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/i,
    );
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(migration).toContain(`has_function_privilege('${role}'`);
    }
  });

  it('does not change database-wide defaults while remote ownership remains unverified', () => {
    const executableSql = migration.replace(/^\s*--.*$/gm, '');
    expect(executableSql).not.toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES/i);
    expect(executableSql).not.toMatch(/_migration_080_default_acl_probe/i);
  });

  it('does not replace, drop, or disable the working privacy trigger', () => {
    const executableSql = migration.replace(/^\s*--.*$/gm, '');
    expect(executableSql).not.toMatch(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.clear_talk_about_marks_when_record_private/i,
    );
    expect(executableSql).not.toMatch(
      /DROP\s+(?:FUNCTION|TRIGGER)\s+(?:public\.)?clear_talk_about_marks_when_record_private/i,
    );
    expect(executableSql).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(executableSql).not.toMatch(/\bGRANT\b/i);
  });
});
