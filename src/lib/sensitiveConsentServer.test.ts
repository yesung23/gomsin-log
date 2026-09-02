import { beforeEach, describe, expect, it, vi } from 'vitest';

const consentBackend = vi.hoisted(() => ({
  deletionPending: false,
  row: null as null | {
    version: string;
    granted_at: string;
    revoked_at: string | null;
    revision: number;
  },
  rpcResult: {
    applied: true,
    granted: true,
    revision: 1,
  } as null | { applied: boolean; granted: boolean; revision: number },
  error: null as null | { code: string; message: string },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tableWrites: 0,
}));

vi.mock('@/lib/accountDeletion', () => ({
  serverCallBlockedByPendingDeletion: async () => consentBackend.deletionPending,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => {
      const read = {
        eq: () => read,
        maybeSingle: async () => ({ data: consentBackend.row, error: consentBackend.error }),
      };
      return {
        select: () => read,
        upsert: async () => {
          consentBackend.tableWrites += 1;
          return { error: consentBackend.error };
        },
        update: () => {
          consentBackend.tableWrites += 1;
          throw new Error('direct consent-table update is forbidden');
        },
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      consentBackend.rpcCalls.push({ name, args });
      return {
        single: async () => ({ data: consentBackend.rpcResult, error: consentBackend.error }),
      };
    },
  },
}));

const {
  CYCLE_CONSENT_VERSION,
  grantCycleConsentInDB,
  grantCycleSensitiveConsent,
  hasCycleSensitiveConsent,
  revokeCycleConsentInDB,
  syncCycleConsentWithDB,
} = await import('@/lib/sensitiveConsent');

describe('server consent helpers leave local authority commits to their caller', () => {
  beforeEach(() => {
    window.localStorage.clear();
    consentBackend.error = null;
    consentBackend.deletionPending = false;
    consentBackend.row = null;
    consentBackend.rpcResult = { applied: true, granted: true, revision: 1 };
    consentBackend.rpcCalls = [];
    consentBackend.tableWrites = 0;
  });

  it('does not unlock the local cache when a server read reports granted', async () => {
    consentBackend.row = {
      version: CYCLE_CONSENT_VERSION,
      granted_at: '2026-08-09T00:00:00.000Z',
      revoked_at: null,
      revision: 7,
    };

    await expect(syncCycleConsentWithDB('user-a')).resolves.toEqual({
      ok: true,
      granted: true,
      revision: 7,
    });
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
  });

  it('returns revision zero for a never-created consent row', async () => {
    await expect(syncCycleConsentWithDB('user-a')).resolves.toEqual({
      ok: true,
      granted: false,
      revision: 0,
    });
  });

  it('does not clear the local cache when a stale server read reports revoked', async () => {
    grantCycleSensitiveConsent('user-a');
    consentBackend.row = {
      version: CYCLE_CONSENT_VERSION,
      granted_at: '2026-08-09T00:00:00.000Z',
      revoked_at: '2026-08-10T00:00:00.000Z',
      revision: 8,
    };

    await expect(syncCycleConsentWithDB('user-a')).resolves.toEqual({
      ok: true,
      granted: false,
      revision: 8,
    });
    expect(hasCycleSensitiveConsent('user-a')).toBe(true);
  });

  it('grants only through the revision-checked RPC and pins the initiating identity', async () => {
    consentBackend.rpcResult = { applied: true, granted: true, revision: 8 };

    await expect(grantCycleConsentInDB('user-a', 7)).resolves.toEqual({
      ok: true,
      applied: true,
      granted: true,
      revision: 8,
    });
    expect(consentBackend.rpcCalls).toEqual([{
      name: 'grant_cycle_sensitive_consent',
      args: {
        p_expected_user_id: 'user-a',
        p_expected_revision: 7,
        p_version: CYCLE_CONSENT_VERSION,
      },
    }]);
    expect(consentBackend.tableWrites).toBe(0);
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
  });

  it('revokes only through the privacy-wins RPC and pins the initiating identity', async () => {
    grantCycleSensitiveConsent('user-a');
    consentBackend.rpcResult = { applied: true, granted: false, revision: 9 };

    await expect(revokeCycleConsentInDB('user-a')).resolves.toEqual({
      ok: true,
      applied: true,
      granted: false,
      revision: 9,
    });
    expect(consentBackend.rpcCalls).toEqual([{
      name: 'revoke_cycle_sensitive_consent',
      args: { p_expected_user_id: 'user-a' },
    }]);
    expect(consentBackend.tableWrites).toBe(0);
    expect(hasCycleSensitiveConsent('user-a')).toBe(true);
  });

  it('returns a stale grant as not applied instead of reopening revoked consent', async () => {
    consentBackend.rpcResult = { applied: false, granted: false, revision: 9 };

    await expect(grantCycleConsentInDB('user-a', 7)).resolves.toEqual({
      ok: true,
      applied: false,
      granted: false,
      revision: 9,
    });
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
  });

  it('blocks a grant but still sends a privacy-preserving revoke during account deletion', async () => {
    consentBackend.deletionPending = true;
    consentBackend.rpcResult = { applied: true, granted: false, revision: 9 };

    await expect(grantCycleConsentInDB('user-a', 8)).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
    });
    await expect(revokeCycleConsentInDB('user-a')).resolves.toEqual({
      ok: true,
      applied: true,
      granted: false,
      revision: 9,
    });
    expect(consentBackend.rpcCalls).toEqual([{
      name: 'revoke_cycle_sensitive_consent',
      args: { p_expected_user_id: 'user-a' },
    }]);
  });
});
