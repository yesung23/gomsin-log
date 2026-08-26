import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canExecute,
  executableStatements,
  executePrivileges,
  parseFunctionDefinitions,
  parseNotifies,
} from '@/test/sqlModel';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/062_e2ee_pairing_ceremony_rpc.sql'),
  'utf8',
);

const signatures = [
  'public.e2ee_start_couple_pairing(uuid, bytea, bytea, bytea, timestamptz, timestamptz)',
  'public.e2ee_confirm_couple_pairing(uuid, uuid, bytea)',
  'public.e2ee_mark_couple_pairing_active(uuid, uuid)',
];

describe('migration 062 actor-bound pairing ceremony', () => {
  it('exposes only fixed-search-path SECURITY DEFINER RPCs', () => {
    const functions = parseFunctionDefinitions(sql);
    expect(functions).toHaveLength(3);
    for (const fn of functions) {
      expect(fn.security).toBe('DEFINER');
      expect(fn.searchPath).toEqual(['public', 'pg_temp']);
      expect(fn.body).toMatch(/v_uid UUID := auth\.uid\(\)/);
      expect(fn.body).toMatch(/IF v_uid IS NULL THEN[\s\S]*ERRCODE = '42501'/);
    }
  });

  it('requires the exact active couple and preserves two distinct confirmation slots', () => {
    expect(sql).toContain('p_couple_id IS DISTINCT FROM public.get_my_active_couple_id()');
    expect(sql.match(/IS DISTINCT FROM public\.get_my_active_couple_id\(\)/g)).toHaveLength(3);
    expect(sql).toContain("status = 'active') <> 2");
    expect(sql).toContain('confirmed_low_device_id = p_device_id');
    expect(sql).toContain('confirmed_high_device_id = p_device_id');
    expect(sql).toContain('confirming_device_not_active_owner');
    expect(sql).toContain('pairing_confirmation_already_bound');
  });

  it('allows activation only for the canonical member after both confirmations and an active couple key', () => {
    expect(sql).toContain('canonical_pairing_owner_required');
    expect(sql).toContain("v_pairing.state <> 'CONFIRMED_BOTH'");
    expect(sql).toContain("domain = 'couple'");
    expect(sql).toContain('owner_couple_id = v_pairing.couple_id');
    expect(sql).toContain("state = 'ACTIVE'");
  });

  it('removes direct pairing writes and grants only authenticated RPC execution', () => {
    expect(sql).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.crypto_pairings FROM authenticated/,
    );
    for (const signature of signatures) {
      const privileges = executePrivileges(sql, signature);
      expect(canExecute(privileges, 'authenticated')).toBe(true);
      expect(canExecute(privileges, 'anon')).toBe(false);
      expect(privileges.publicHolds).toBe(false);
    }
  });

  it('is transactional and reloads PostgREST without destructive schema operations', () => {
    const statements = executableStatements(sql);
    expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA)\b/i);
    expect(parseNotifies(sql)).toEqual([{ channel: 'pgrst', payload: 'reload schema' }]);
  });
});
