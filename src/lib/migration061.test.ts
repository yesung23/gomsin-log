import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canExecute,
  executableStatements,
  executePrivileges,
  parseFunctionDefinitions,
  parseNotifies,
  stripSqlComments,
} from '@/test/sqlModel';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const migration060 = read('supabase/migrations/060_partner_username_projection.sql');
const migration061 = read('supabase/migrations/061_reject_null_partner_profile_actor.sql');
const signature = 'public.get_partner_profile_with_username()';
const [before] = parseFunctionDefinitions(migration060);
const [after] = parseFunctionDefinitions(migration061);

describe('migration 061 partner projection hardening', () => {
  it('keeps the 060 RPC shape and pins its definer search path', () => {
    expect(after.signature).toBe(signature);
    expect(after.args).toEqual(before.args);
    expect(after.returns).toBe(before.returns);
    expect(after.returnColumns).toEqual(before.returnColumns);
    expect(after.security).toBe('DEFINER');
    expect(after.searchPath).toEqual(['public', 'pg_temp']);
  });

  it('wires the explicit NULL-actor guard into the executable body', () => {
    expect(after.body).toContain('v_uid UUID := auth.uid();');
    expect(after.body).toMatch(/IF v_uid IS NULL THEN[\s\S]*ERRCODE = '42501'/);
    expect(after.body).toContain("partner_cm.status = 'active'");
    expect(after.body).toContain("caller_cm.status = 'active'");
    expect(after.body).toContain('p.id <> v_uid');
  });

  it('leaves EXECUTE with authenticated only', () => {
    const privileges = executePrivileges(migration061, signature);
    expect(canExecute(privileges, 'authenticated')).toBe(true);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(canExecute(privileges, 'service_role')).toBe(false);
    expect(privileges.publicHolds).toBe(false);
  });

  it('is a transactional forward definition with a PostgREST reload', () => {
    const statements = executableStatements(migration061);
    expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1);
    expect(stripSqlComments(migration061)).not.toMatch(/\bDROP\s+/i);
    expect(parseNotifies(migration061)).toEqual([
      { channel: 'pgrst', payload: 'reload schema' },
    ]);
  });
});
