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
  resolve(process.cwd(), 'supabase/migrations/065_harden_e2ee_pairing_rpc.sql'),
  'utf8',
);

const signatures = [
  'public.e2ee_start_couple_pairing(uuid, bytea, bytea, bytea, timestamptz, timestamptz)',
  'public.e2ee_confirm_couple_pairing(uuid, uuid, bytea)',
  'public.e2ee_mark_couple_pairing_active(uuid, uuid)',
];

describe('migration 065 hardened actor-bound pairing ceremony RPCs', () => {
  it('exposes only fixed-search-path SECURITY DEFINER RPCs', () => {
    const functions = parseFunctionDefinitions(sql);
    expect(functions).toHaveLength(3);
    for (const fn of functions) {
      expect(fn.security).toBe('DEFINER');
      expect(fn.searchPath).toEqual(['public', 'pg_temp']);
      expect(fn.body).toContain('v_uid UUID := auth.uid();');
      expect(fn.body).toContain("IF v_uid IS NULL THEN");
      expect(fn.body).toContain("ERRCODE = '42501'");
    }
  });

  it('explicitly rejects NULL pairing evidence and signatures before checking length', () => {
    expect(sql).toContain('p_pairing_nonce IS NULL');
    expect(sql).toContain('p_transcript IS NULL');
    expect(sql).toContain('p_transcript_hash IS NULL');
    expect(sql).toContain('p_signature IS NULL');
    expect(sql).toContain('IF p_pairing_nonce IS NULL');
    expect(sql).toContain('octet_length(p_pairing_nonce) <> 32');
    expect(sql).toContain('octet_length(p_transcript_hash) <> 32');
    expect(sql).toContain('octet_length(p_transcript) <> 440');
    expect(sql).toContain('IF p_signature IS NULL OR octet_length(p_signature) <> 64 THEN');
  });

  it('persists expiration on confirm and returns TEXT without rolling back via exception', () => {
    expect(sql).toContain("UPDATE public.crypto_pairings\nSET state = 'TRANSCRIPT_EXPIRED'");
    expect(sql).toContain("state NOT IN ('TRANSCRIPT_EXPIRED', 'TRANSCRIPT_REJECTED', 'UNLINKED')");
    expect(sql).toContain('invalid_persisted_pairing_evidence');
    expect(sql).toContain("IF v_pairing.state = 'TRANSCRIPT_EXPIRED' THEN");
    expect(sql).toContain("RETURN 'TRANSCRIPT_EXPIRED';");
    expect(sql).toContain("IF (v_pairing.expires_at IS NULL OR v_pairing.expires_at <= clock_timestamp())");
    expect(sql).toContain("v_pairing.state <> 'CRYPTO_ACTIVE'");
    expect(sql).toContain("SET state = 'TRANSCRIPT_EXPIRED'");
    expect(sql).not.toContain("RAISE EXCEPTION 'pairing_expired'");
  });

  it('maintains table privilege lockdown from 064 and grants only SELECT to authenticated', () => {
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.crypto_pairings FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT SELECT ON TABLE public.crypto_pairings TO authenticated;');
    for (const signature of signatures) {
      const privileges = executePrivileges(sql, signature);
      expect(canExecute(privileges, 'authenticated')).toBe(true);
      expect(canExecute(privileges, 'anon')).toBe(false);
      expect(privileges.publicHolds).toBe(false);
    }
  });

  it('is transactional and reloads PostgREST schema cache', () => {
    const statements = executableStatements(sql);
    expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA)\b/i);
    expect(parseNotifies(sql)).toEqual([{ channel: 'pgrst', payload: 'reload schema' }]);
  });
});
