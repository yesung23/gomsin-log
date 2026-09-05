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
  relationshipBoundary: 'public.lock_relationship_mutation_boundary(uuid, uuid[])' as const,
  closeInternal: 'public.close_relationship_generation_internal(uuid)' as const,
  closeForDeletion: 'public.close_account_relationship_generations(uuid)' as const,
  legacyCreate: 'public.create_invitation(uuid, text)' as const,
  create: 'public.create_couple_and_invitation(text, text)' as const,
  redeem: 'public.redeem_invitation(text)' as const,
  regenerate: 'public.regenerate_invitation(text)' as const,
  disconnect: 'public.disconnect_couple()' as const,
  beginLegacy: 'public.begin_account_deletion(uuid, uuid[])' as const,
  beginV2: 'public.begin_account_deletion_v2(uuid, uuid[], uuid)' as const,
  cancelLegacy: 'public.cancel_account_deletion(uuid)' as const,
  cancelV2: 'public.cancel_account_deletion_v2(uuid, uuid)' as const,
  e2eeLegacy: 'public.e2ee_prepare_account_deletion(uuid)' as const,
  e2eeV2: 'public.e2ee_prepare_account_deletion_v2(uuid, uuid)' as const,
  prepareLegacy: 'public.prepare_account_deletion(uuid, uuid[])' as const,
  prepareV2: 'public.prepare_account_deletion_v2(uuid, uuid[], uuid)' as const,
  closeV2: 'public.close_account_relationship_generations_v2(uuid, uuid)' as const,
  cleanupV2: 'public.cleanup_account_solo_couples_v2(uuid, uuid)' as const,
  cleanupLegacy: 'public.cleanup_account_solo_couples(uuid)' as const,
  accountAttemptLock: 'public.lock_account_deletion_attempt_v2(uuid, uuid)' as const,
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
    expect(migration).toContain('relationship_generation_legacy_unused_invitation');
    expect(migration).toContain('relationship_generation_legacy_live_pairing');
    expect(migration).toContain('relationship_generation_legacy_push_token_ambiguous');
    expect(migration).toContain('relationship_generation_legacy_delivery_state_ambiguous');
    expect(migration).toMatch(
      /LOCK TABLE public\.couple_members, public\.invitation_codes[\s\S]*SHARE ROW EXCLUSIVE MODE/i,
    );
    expect(migration).toContain(
      'LOCK TABLE public.device_push_tokens IN SHARE ROW EXCLUSIVE MODE',
    );
  });

  it('adds a strict fail-closed account-deletion fencing state machine', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.account_deletion_requests[\s\S]*ADD COLUMN IF NOT EXISTS attempt_id UUID[\s\S]*ADD COLUMN IF NOT EXISTS phase TEXT[\s\S]*ADD COLUMN IF NOT EXISTS cancellation_allowed BOOLEAN[\s\S]*ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMPTZ/i,
    );
    expect(migration).toMatch(
      /UPDATE public\.account_deletion_requests[\s\S]*attempt_id = gen_random_uuid\(\)[\s\S]*phase = 'legacy_blocked'[\s\S]*cancellation_allowed = false/i,
    );
    expect(migration).toMatch(
      /CHECK \(phase IN \([\s\S]*'legacy_blocked'[\s\S]*'media_cleanup'[\s\S]*'e2ee_prepared'[\s\S]*'relational_prepared'[\s\S]*'relationships_closed'[\s\S]*'solo_cleanup_complete'[\s\S]*\)\)/i,
    );
    expect(migration).toMatch(
      /CHECK \(\(phase = 'media_cleanup' AND cancellation_allowed\)[\s\S]*OR \(phase <> 'media_cleanup' AND NOT cancellation_allowed\)\)/i,
    );
    expect(migration).toMatch(
      /ALTER COLUMN attempt_id SET NOT NULL[\s\S]*ALTER COLUMN phase SET NOT NULL[\s\S]*ALTER COLUMN cancellation_allowed SET NOT NULL[\s\S]*ALTER COLUMN phase_updated_at SET NOT NULL/i,
    );
  });

  it('fences begin, exact pre-destructive cancellation, and every destructive v2 phase', () => {
    const begin = definition(signatures.beginV2);
    expect(begin.returns).toBe('JSONB');
    expect(begin.body).toContain('p_attempt_id');
    expect(begin.body).toContain("'media_cleanup'");
    expect(begin.body).toContain('cancellation_allowed');
    expect(begin.body).toContain("phase = 'legacy_blocked'");

    const cancel = definition(signatures.cancelV2);
    expect(cancel.returns).toBe('BOOLEAN');
    expect(cancel.body).toMatch(
      /DELETE FROM public\.account_deletion_requests[\s\S]*user_id = p_user_id[\s\S]*attempt_id = p_attempt_id[\s\S]*phase = 'media_cleanup'[\s\S]*cancellation_allowed = true/i,
    );
    expect(cancel.body).toMatch(/GET DIAGNOSTICS[\s\S]*ROW_COUNT[\s\S]*RETURN v_deleted = 1/i);

    const legacyCancel = definition(signatures.cancelLegacy);
    expect(legacyCancel.body).not.toMatch(/DELETE FROM public\.account_deletion_requests/i);
    expect(legacyCancel.body).toContain('account_deletion_attempt_required');

    for (const signature of [
      signatures.beginLegacy,
      signatures.cancelLegacy,
      signatures.prepareLegacy,
      signatures.cleanupLegacy,
    ]) {
      expect(definition(signature).body, signature)
        .toContain('account_deletion_attempt_required');
      const privileges = executePrivileges(migration, signature);
      expect(canExecute(privileges, 'service_role'), signature).toBe(true);
      expect(canExecute(privileges, 'authenticated'), signature).toBe(false);
      expect(canExecute(privileges, 'anon'), signature).toBe(false);
      expect(privileges.publicHolds, signature).toBe(false);
    }

    for (const signature of [
      signatures.e2eeLegacy,
      signatures.closeForDeletion,
      signatures.accountAttemptLock,
    ]) {
      const privileges = executePrivileges(migration, signature);
      expect(canExecute(privileges, 'service_role'), signature).toBe(false);
      expect(canExecute(privileges, 'authenticated'), signature).toBe(false);
      expect(canExecute(privileges, 'anon'), signature).toBe(false);
      expect(privileges.publicHolds, signature).toBe(false);
    }

    for (const signature of [
      signatures.beginV2,
      signatures.cancelV2,
      signatures.e2eeV2,
      signatures.prepareV2,
      signatures.closeV2,
      signatures.cleanupV2,
    ]) {
      const fn = definition(signature);
      expect(fn.security, signature).toBe('DEFINER');
      expect(fn.searchPath, signature).toEqual(['public', 'pg_temp']);
      expect(fn.body, signature).toContain("auth.role() IS DISTINCT FROM 'service_role'");
      expect(fn.body, signature).toContain('p_attempt_id');
      const privileges = executePrivileges(migration, signature);
      expect(canExecute(privileges, 'service_role'), signature).toBe(true);
      expect(canExecute(privileges, 'authenticated'), signature).toBe(false);
      expect(canExecute(privileges, 'anon'), signature).toBe(false);
      expect(privileges.publicHolds, signature).toBe(false);
    }
  });

  it('turns only the exact E2EE orphan refusal into a structured rollback confirmation', () => {
    const e2ee = definition(signatures.e2eeV2);
    expect(e2ee.body).toContain('public.e2ee_prepare_account_deletion');
    expect(e2ee.body).toMatch(/BEGIN[\s\S]*EXCEPTION[\s\S]*WHEN SQLSTATE 'P0001'/i);
    expect(e2ee.body).toContain('E2EE_DELETION_WOULD_ORPHAN_PARTNER: couple epoch ');
    expect(e2ee.body).toContain('has no surviving envelope for the remaining partner');
    expect(e2ee.body).toContain("'rollback_confirmed', true");
    expect(e2ee.body).toContain("'refusal_code', 'e2ee_would_orphan_partner'");
    expect(e2ee.body).toContain("'phase', 'media_cleanup'");
    expect(e2ee.body).toMatch(/ELSE[\s\S]*RAISE;[\s\S]*END IF/i);
    expect(e2ee.body).toMatch(
      /UPDATE public\.account_deletion_requests[\s\S]*phase = 'e2ee_prepared'[\s\S]*cancellation_allowed = false/i,
    );
  });

  it('uses sorted participant locks before deletion markers and parent rows', () => {
    const boundary = definition(signatures.relationshipBoundary);
    expect(boundary.security).toBe('DEFINER');
    expect(boundary.searchPath).toEqual(['public', 'pg_temp']);
    const advisoryAt = boundary.body.indexOf('pg_advisory_xact_lock');
    const markerAt = boundary.body.indexOf('account_deletion_requests');
    const parentAt = boundary.body.indexOf('FOR UPDATE');
    expect(advisoryAt).toBeGreaterThanOrEqual(0);
    expect(advisoryAt).toBeLessThan(markerAt);
    expect(markerAt).toBeLessThan(parentAt);
    expect(boundary.body).toMatch(/ORDER BY[\s\S]*user_id/i);
    expect(boundary.body).toContain("ERRCODE = '40001'");
  });

  it('makes closed_at terminal and treats the GUC as a scoped discriminator, not a client privilege', () => {
    const guard = definition(signatures.closedAtGuard);
    expect(guard.returns).toBe('TRIGGER');
    expect(guard.security).toBe('INVOKER');
    expect(guard.searchPath).toEqual(['public', 'pg_temp']);
    expect(guard.body).toMatch(
      /OLD\.closed_at IS NOT NULL[\s\S]*NEW\.closed_at IS DISTINCT FROM OLD\.closed_at/i,
    );
    expect(guard.body).toContain('current_user');
    expect(guard.body).toContain('pg_catalog.pg_proc');
    expect(guard.body).toContain('proowner');
    expect(guard.body).toContain("current_setting('gomsinlog.relationship_terminal_close', true)");
    expect(guard.body).toMatch(/ERRCODE = '42501'/i);
    expect(migration).toMatch(
      /CREATE TRIGGER trg_relationship_generation_terminal[\s\S]*BEFORE UPDATE OF closed_at ON public\.couples/i,
    );
  });

  it('rejects open-generation deletes and identity moves before checking whether an open row may be written', () => {
    const guard = definition(signatures.membershipGuard);
    expect(guard.returns).toBe('TRIGGER');
    expect(guard.security).toBe('DEFINER');
    expect(guard.searchPath).toEqual(['public', 'pg_temp']);
    expect(guard.body).toMatch(/TG_OP = 'DELETE'[\s\S]*open_relationship_membership_delete_forbidden/i);
    expect(guard.body).toMatch(
      /NEW\.user_id IS DISTINCT FROM OLD\.user_id[\s\S]*NEW\.couple_id IS DISTINCT FROM OLD\.couple_id[\s\S]*relationship_membership_identity_immutable/i,
    );
    expect(guard.body).toMatch(/NEW\.status IN \('active', 'pending'\)/i);
    expect(guard.body).toMatch(/FROM public\.couples[\s\S]*FOR UPDATE/i);
    expect(guard.body).toMatch(/v_closed_at IS NOT NULL/i);
    expect(guard.body).toMatch(
      /FROM public\.couple_members[\s\S]*status = 'disconnected'/i,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER trg_open_relationship_membership[\s\S]*BEFORE INSERT OR DELETE OR UPDATE OF couple_id, user_id, status ON public\.couple_members/i,
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
      /CREATE TRIGGER trg_open_relationship_invitation[\s\S]*BEFORE INSERT OR UPDATE ON public\.invitation_codes/i,
    );
    expect(migration).not.toMatch(
      /CREATE TRIGGER trg_open_relationship_invitation[\s\S]*BEFORE INSERT OR UPDATE OF[\s\S]*ON public\.invitation_codes/i,
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
    expect(close.body).toMatch(
      /set_config\(\s*'gomsinlog\.relationship_terminal_close'\s*,\s*'on'\s*,\s*true\s*\)/i,
    );
    expect(close.body).toMatch(
      /set_config\(\s*'gomsinlog\.relationship_terminal_close'\s*,\s*'off'\s*,\s*true\s*\)/i,
    );
  });

  it('exposes an idempotent, UUID-ordered fenced account-deletion close only to service_role', () => {
    const close = definition(signatures.closeV2);
    expect(close.returns).toBe('JSONB');
    expect(close.security).toBe('DEFINER');
    expect(close.searchPath).toEqual(['public', 'pg_temp']);
    expect(close.body).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(close.body).toContain('public.lock_account_deletion_attempt_v2');
    expect(close.body).toContain('public.close_account_relationship_generations');
    expect(close.body).toMatch(/'ok'\s*,\s*true/i);
    expect(close.body).toMatch(/'closed_count'/i);

    const accountLock = definition(signatures.accountAttemptLock);
    expect(accountLock.body).toMatch(/ORDER BY scope\.couple_id/i);
    expect(accountLock.body).toMatch(/ORDER BY participant\.user_id/i);

    const privileges = executePrivileges(migration, signatures.closeV2);
    expect(canExecute(privileges, 'service_role')).toBe(true);
    expect(canExecute(privileges, 'authenticated')).toBe(false);
    expect(canExecute(privileges, 'anon')).toBe(false);
    expect(privileges.publicHolds).toBe(false);

    const legacyPrivileges = executePrivileges(migration, signatures.closeForDeletion);
    expect(canExecute(legacyPrivileges, 'service_role')).toBe(false);
    expect(legacyPrivileges.publicHolds).toBe(false);

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

  it('forward-replaces legacy invitation creation and applies one deletion-aware boundary everywhere', () => {
    const legacyCreate = definition(signatures.legacyCreate);
    expect(legacyCreate.returns).toBe('UUID');
    expect(legacyCreate.security).toBe('DEFINER');
    expect(legacyCreate.searchPath).toEqual(['public', 'pg_temp']);

    for (const signature of [
      signatures.legacyCreate,
      signatures.create,
      signatures.redeem,
      signatures.regenerate,
    ]) {
      expect(definition(signature).body, signature)
        .toContain('public.lock_relationship_mutation_boundary');
    }

    expect(definition(signatures.membershipGuard).body)
      .toContain('public.lock_relationship_mutation_boundary');
    expect(definition(signatures.invitationGuard).body)
      .toContain('public.lock_relationship_mutation_boundary');
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
    expect(disconnect.body).not.toContain('gomsinlog.relationship_terminal_close');
  });

  it('removes direct membership mutation grants and excludes closed_at from client column updates', () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.couple_members\s+FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /REVOKE UPDATE ON TABLE public\.couples FROM authenticated/i,
    );
    expect(migration).toMatch(
      /GRANT UPDATE \(anniversary_date, updated_at\) ON TABLE public\.couples\s+TO authenticated/i,
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
