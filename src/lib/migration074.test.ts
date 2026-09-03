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

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/074_immutable_relationship_generation.sql',
);

let migration = '';
try {
  migration = readFileSync(migrationPath, 'utf8');
} catch {
  // A missing migration is the expected RED state for this contract suite.
}

const signatures = {
  closedAtGuard: 'public.enforce_relationship_generation_terminal()' as const,
  membershipGuard: 'public.enforce_open_relationship_membership()' as const,
  invitationGuard: 'public.enforce_open_relationship_invitation()' as const,
  closeInternal: 'public.close_relationship_generation_internal(uuid)' as const,
  closeForDeletion: 'public.close_account_relationship_generations(uuid)' as const,
  create: 'public.create_couple_and_invitation(text, text)' as const,
  redeem: 'public.redeem_invitation(text)' as const,
  regenerate: 'public.regenerate_invitation(text)' as const,
  disconnect: 'public.disconnect_couple()' as const,
};

function definition(signature: string) {
  const found = parseFunctionDefinitions(migration)
    .find((candidate) => candidate.signature.toLowerCase() === signature.toLowerCase());
  expect(found, `${signature} must be defined by migration 074`).toBeDefined();
  return found!;
}

describe('migration 074 immutable relationship generations', () => {
  it('adds one nullable terminal marker and backfills only generations with no open membership', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.couples\s+ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ/i,
    );
    expect(migration).toMatch(
      /UPDATE public\.couples AS relationship[\s\S]*SET closed_at = CURRENT_TIMESTAMP[\s\S]*NOT EXISTS[\s\S]*member\.status IN \('active', 'pending'\)/i,
    );
    expect(migration).toContain('relationship_generation_mixed_legacy_state');
    expect(migration).toMatch(
      /EXISTS[\s\S]*status = 'disconnected'[\s\S]*EXISTS[\s\S]*status IN \('active', 'pending'\)/i,
    );
  });

  it('makes closed_at terminal and allows first closure only through the internal capability', () => {
    const guard = definition(signatures.closedAtGuard);
    expect(guard.returns).toBe('TRIGGER');
    expect(guard.security).toBe('DEFINER');
    expect(guard.searchPath).toEqual(['public', 'pg_temp']);
    expect(guard.body).toMatch(
      /OLD\.closed_at IS NOT NULL[\s\S]*NEW\.closed_at IS DISTINCT FROM OLD\.closed_at/i,
    );
    expect(guard.body).toContain("current_setting('gomsinlog.relationship_terminal_close', true)");
    expect(guard.body).toMatch(/ERRCODE = '42501'/i);
    expect(migration).toMatch(
      /CREATE TRIGGER trg_relationship_generation_terminal[\s\S]*BEFORE UPDATE OF closed_at ON public\.couples/i,
    );
  });

  it('serializes membership writes on the parent and rejects active or pending rows in closed or historical generations', () => {
    const guard = definition(signatures.membershipGuard);
    expect(guard.returns).toBe('TRIGGER');
    expect(guard.security).toBe('DEFINER');
    expect(guard.searchPath).toEqual(['public', 'pg_temp']);
    expect(guard.body).toMatch(/NEW\.status IN \('active', 'pending'\)/i);
    expect(guard.body).toMatch(/FROM public\.couples[\s\S]*FOR UPDATE/i);
    expect(guard.body).toMatch(/v_closed_at IS NOT NULL/i);
    expect(guard.body).toMatch(
      /FROM public\.couple_members[\s\S]*status = 'disconnected'/i,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER trg_open_relationship_membership[\s\S]*BEFORE INSERT OR UPDATE OF couple_id, status ON public\.couple_members/i,
    );
  });

  it('serializes unused invitation writes on the parent so a legacy caller cannot outrun closure', () => {
    const guard = definition(signatures.invitationGuard);
    expect(guard.returns).toBe('TRIGGER');
    expect(guard.security).toBe('DEFINER');
    expect(guard.searchPath).toEqual(['public', 'pg_temp']);
    expect(guard.body).toMatch(/NEW\.used = false/i);
    expect(guard.body).toMatch(/FROM public\.couples[\s\S]*FOR UPDATE/i);
    expect(guard.body).toMatch(/v_closed_at IS NOT NULL/i);
    expect(guard.body).toMatch(
      /FROM public\.couple_members[\s\S]*status = 'disconnected'/i,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER trg_open_relationship_invitation[\s\S]*BEFORE INSERT OR UPDATE OF couple_id, used ON public\.invitation_codes/i,
    );
  });

  it('closes pairing, delivery, membership, invitations, and couple state under one parent lock', () => {
    const close = definition(signatures.closeInternal);
    expect(close.security).toBe('DEFINER');
    expect(close.searchPath).toEqual(['public', 'pg_temp']);
    expect(close.body).toMatch(/FROM public\.couples[\s\S]*FOR UPDATE/i);
    expect(close.body).toContain("to_regclass('public.crypto_pairings')");
    expect(close.body).toContain("state = 'UNLINKED'");
    expect(close.body).toContain("to_regclass('public.device_push_tokens')");
    expect(close.body).toContain("to_regclass('public.push_delivery_state')");
    expect(close.body).toMatch(
      /UPDATE public\.couple_members[\s\S]*status = 'disconnected'[\s\S]*status IN \('active', 'pending'\)/i,
    );
    expect(close.body).toMatch(
      /UPDATE public\.invitation_codes[\s\S]*used = true[\s\S]*couple_id = p_couple_id[\s\S]*used = false/i,
    );
    expect(close.body).toMatch(
      /UPDATE public\.couples[\s\S]*closed_at = CURRENT_TIMESTAMP/i,
    );
  });

  it('exposes an idempotent, UUID-ordered account-deletion close only to service_role', () => {
    const close = definition(signatures.closeForDeletion);
    expect(close.returns).toBe('JSONB');
    expect(close.security).toBe('DEFINER');
    expect(close.searchPath).toEqual(['public', 'pg_temp']);
    expect(close.body).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(close.body).toMatch(/WHERE member\.user_id = p_user_id[\s\S]*ORDER BY relationship\.id/i);
    expect(close.body).toContain('public.close_relationship_generation_internal');
    expect(close.body).toMatch(/'ok'\s*,\s*true/i);
    expect(close.body).toMatch(/'closed_count'/i);

    const privileges = executePrivileges(migration, signatures.closeForDeletion);
    expect(canExecute(privileges, 'service_role')).toBe(true);
    expect(canExecute(privileges, 'authenticated')).toBe(false);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(privileges.publicHolds).toBe(false);

    const internalPrivileges = executePrivileges(migration, signatures.closeInternal);
    expect(canExecute(internalPrivileges, 'service_role')).toBe(false);
    expect(canExecute(internalPrivileges, 'authenticated')).toBe(false);
    expect(canExecute(internalPrivileges, 'anon')).toBe(false);
    expect(internalPrivileges.publicHolds).toBe(false);
  });

  it('always creates a new row and refuses every active or pending relationship and deletion race', () => {
    const create = definition(signatures.create);
    expect(create.body).toContain('pg_advisory_xact_lock');
    expect(create.body).toMatch(/status IN \('active', 'pending'\)/i);
    expect(create.body).toContain('public.account_deletion_requests');
    expect(create.body).toMatch(/INSERT INTO public\.couples DEFAULT VALUES/i);
    expect(create.body).not.toMatch(/UPDATE public\.couple_members[\s\S]*status = 'active'/i);
    expect(create.body).not.toMatch(/ON CONFLICT[\s\S]*couple_members/i);
  });

  it('forward-replaces redemption without weakening throttle, self-invite, lock, or exact topology checks', () => {
    const redeem = definition(signatures.redeem);
    expect(redeem.returns).toBe('JSONB');
    expect(redeem.security).toBe('DEFINER');
    expect(redeem.searchPath).toEqual(['public', 'pg_temp']);
    expect(redeem.body).toContain('pg_advisory_xact_lock');
    expect(redeem.body).toMatch(/v_recent_failures >= 5 OR v_daily_failures >= 20/i);
    expect(redeem.body).toContain("v_error_code := 'self_invitation'");
    expect(redeem.body).toMatch(/FROM public\.couples[\s\S]*FOR UPDATE/i);
    expect(redeem.body).toMatch(/relationship\.closed_at IS NOT NULL/i);
    expect(redeem.body).toMatch(/v_member_count <> 1/i);
    expect(redeem.body).toMatch(/v_active_count <> 1/i);
    expect(redeem.body).toMatch(/v_inviter_user_id IS DISTINCT FROM v_invite\.created_by/i);
    expect(redeem.body).toMatch(/INSERT INTO public\.couple_members/i);
    expect(redeem.body).not.toMatch(/ON CONFLICT[\s\S]*DO UPDATE SET status = 'active'/i);
    expect(redeem.body).toMatch(/INSERT INTO public\.invitation_attempts \(user_id, succeeded\)/i);
  });

  it('forward-replaces regeneration and disconnect under the same closed-generation lock', () => {
    const regenerate = definition(signatures.regenerate);
    expect(regenerate.body).toMatch(/FROM public\.couples[\s\S]*FOR UPDATE/i);
    expect(regenerate.body).toMatch(/relationship\.closed_at IS NOT NULL/i);
    expect(regenerate.body).toMatch(/v_member_count <> 1/i);
    expect(regenerate.body).toMatch(/v_active_count <> 1/i);

    const disconnect = definition(signatures.disconnect);
    expect(disconnect.body).toMatch(/FROM public\.couples[\s\S]*FOR UPDATE/i);
    expect(disconnect.body).toMatch(/relationship\.closed_at IS NULL/i);
    expect(disconnect.body).toContain('public.close_relationship_generation_internal');
    expect(disconnect.body).toMatch(
      /set_config\(\s*'gomsinlog\.relationship_terminal_close'\s*,\s*'on'\s*,\s*true\s*\)/i,
    );
  });

  it('keeps client RPCs authenticated-only and every new definer on a fixed search_path', () => {
    for (const signature of [
      signatures.create,
      signatures.redeem,
      signatures.regenerate,
      signatures.disconnect,
    ]) {
      const privileges = executePrivileges(migration, signature);
      expect(canExecute(privileges, 'authenticated'), signature).toBe(true);
      expect(canExecute(privileges, 'anon'), signature).toBe(false);
      expect(privileges.publicHolds, signature).toBe(false);
    }

    for (const fn of parseFunctionDefinitions(migration)) {
      if (fn.security === 'DEFINER') {
        expect(fn.searchPath, fn.signature).toEqual(['public', 'pg_temp']);
      }
    }
  });

  it('is transactional, forward-only, and reloads PostgREST', () => {
    const statements = executableStatements(migration);
    expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1);
    expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1);
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)\b/i);
    expect(parseNotifies(migration)).toEqual([{ channel: 'pgrst', payload: 'reload schema' }]);
  });
});
