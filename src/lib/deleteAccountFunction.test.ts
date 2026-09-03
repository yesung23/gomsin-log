import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDeleteAccountRequest } from '../../supabase/functions/delete-account/handler.ts';

/**
 * Deletion-Recovery Suite - test 7, plus the server-side preservation claims.
 *
 * C1 durability counterexample (clauses 1.26, 1.27): at `7d82e3e` the function
 * began deleting application data with no prior authoritative write that
 * outlives the request, so nothing anywhere recorded an outstanding deletion.
 */

const ENV: Record<string, string | undefined> = {
  ALLOWED_ORIGINS: 'https://gomsinlog.app',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_test_admin_key' }),
};

const EXISTING_APP_METADATA = {
  provider: 'apple',
  providers: ['apple'],
  some_other_flag: 'keep-me',
};

type AdminOptions = {
  flagError?: unknown;
  deleteUserError?: unknown;
  e2eePrepareError?: unknown;
  prepareError?: unknown;
  closeRelationshipsError?: unknown;
  closeRelationshipsData?: unknown;
  cleanupCouplesError?: unknown;
};

function makeAdmin(options: AdminOptions = {}) {
  const calls: string[] = [];
  const metadataWrites: unknown[] = [];
  const admin = {
    calls,
    metadataWrites,
    auth: {
      getUser: vi.fn(async () => {
        calls.push('auth.getUser');
        return {
          data: { user: { id: 'user-a', app_metadata: { ...EXISTING_APP_METADATA } } },
          error: null,
        };
      }),
      admin: {
        updateUserById: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
          calls.push('auth.admin.updateUserById');
          metadataWrites.push(payload.app_metadata);
          return options.flagError
            ? { data: null, error: options.flagError }
            : { data: {}, error: null };
        }),
        deleteUser: vi.fn(async () => {
          calls.push('auth.admin.deleteUser');
          return options.deleteUserError ? { error: options.deleteUserError } : { error: null };
        }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: async () => {
          calls.push(`from:${table}.select`);
          return { data: [], error: null };
        },
      }),
    }),
    rpc: vi.fn(async (name: string) => {
      calls.push(`rpc:${name}`);
      // E2EE key-material cleanup runs before the relational preparation and
      // can legitimately refuse, so a failure here must abort the deletion.
      if (name === 'e2ee_prepare_account_deletion') {
        return options.e2eePrepareError
          ? { data: null, error: options.e2eePrepareError }
          : { data: { partner_remains: false, deleted_devices: 1 }, error: null };
      }
      if (name === 'prepare_account_deletion') {
        return options.prepareError
          ? { data: null, error: options.prepareError }
          : { data: { ok: true }, error: null };
      }
      if (name === 'close_account_relationship_generations') {
        if (options.closeRelationshipsError) {
          return { data: null, error: options.closeRelationshipsError };
        }
        return {
          data: Object.hasOwn(options, 'closeRelationshipsData')
            ? options.closeRelationshipsData
            : { ok: true, closed_count: 1 },
          error: null,
        };
      }
      if (name === 'cleanup_account_solo_couples') {
        return options.cleanupCouplesError
          ? { data: null, error: options.cleanupCouplesError }
          : { data: 1, error: null };
      }
      return { data: null, error: null };
    }),
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
  return admin;
}

function post(admin: unknown) {
  return handleDeleteAccountRequest(
    new Request('https://edge.example/delete-account', {
      method: 'POST',
      headers: { Origin: 'https://gomsinlog.app', Authorization: 'Bearer token' },
    }),
    { env: (key: string) => ENV[key], createAdmin: () => admin },
  );
}

describe('delete-account - the server-authoritative pending flag', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('writes app_metadata.account_deletion_pending BEFORE the preflight and before begin_account_deletion', async () => {
    const admin = makeAdmin();
    await post(admin);
    const flagAt = admin.calls.indexOf('auth.admin.updateUserById');
    expect(flagAt).toBeGreaterThanOrEqual(0);
    expect(flagAt).toBeLessThan(admin.calls.indexOf('from:daily_records.select'));
    expect(flagAt).toBeLessThan(admin.calls.indexOf('rpc:begin_account_deletion'));
    expect(admin.metadataWrites[0]).toMatchObject({ account_deletion_pending: true });
  });

  it('spreads the existing app_metadata first, so the rendered sign-in provider is unchanged', async () => {
    const admin = makeAdmin();
    await post(admin);
    expect(admin.metadataWrites[0]).toEqual({
      ...EXISTING_APP_METADATA,
      account_deletion_pending: true,
    });
  });

  /** Deletion-Recovery Suite - test 7. */
  it('7 - a pending-flag write failure blocks ALL application-data deletion', async () => {
    const admin = makeAdmin({ flagError: { message: 'metadata write failed' } });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: false, warnings: [] });
    // The account is fully intact: not one destructive or preparatory step ran.
    expect(admin.calls).toEqual(['auth.getUser', 'auth.admin.updateUserById']);
    expect(admin.calls).not.toContain('from:daily_records.select');
    expect(admin.calls).not.toContain('rpc:begin_account_deletion');
    expect(admin.calls).not.toContain('rpc:prepare_account_deletion');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
    // And the flag-write failure is NOT reported through the cancel path.
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion');
  });

  it('aborts before Auth deletion when E2EE preparation refuses', async () => {
    // e2ee_prepare_account_deletion raises when removing this account would
    // leave the surviving partner with no way to decrypt shared history.
    // Continuing past that would crypto-shred a bystander, so the whole
    // deletion stops and the Auth user is left intact.
    const admin = makeAdmin({
      e2eePrepareError: new Error('E2EE_DELETION_WOULD_ORPHAN_PARTNER: couple epoch 1'),
    });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect(admin.calls).toContain('rpc:e2ee_prepare_account_deletion');
    expect(admin.calls).not.toContain('rpc:prepare_account_deletion');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('runs E2EE preparation BEFORE the relational preparation', async () => {
    const admin = makeAdmin({});
    await post(admin);
    const e2eeAt = admin.calls.indexOf('rpc:e2ee_prepare_account_deletion');
    const relationalAt = admin.calls.indexOf('rpc:prepare_account_deletion');
    const authAt = admin.calls.indexOf('auth.admin.deleteUser');
    expect(e2eeAt).toBeGreaterThanOrEqual(0);
    expect(e2eeAt).toBeLessThan(relationalAt);
    // Auth deletion stays last.
    expect(relationalAt).toBeLessThan(authAt);
  });

  it('closes every relationship generation after relational preparation and before cleanup or Auth deletion', async () => {
    const admin = makeAdmin();
    await post(admin);
    const preparationAt = admin.calls.indexOf('rpc:prepare_account_deletion');
    const closeAt = admin.calls.indexOf('rpc:close_account_relationship_generations');
    const cleanupAt = admin.calls.indexOf('rpc:cleanup_account_solo_couples');
    const authAt = admin.calls.indexOf('auth.admin.deleteUser');

    expect(closeAt).toBeGreaterThan(preparationAt);
    expect(closeAt).toBeLessThan(cleanupAt);
    expect(cleanupAt).toBeLessThan(authAt);
  });

  it('fails closed after data preparation when relationship closure errors', async () => {
    const admin = makeAdmin({
      closeRelationshipsError: { message: 'relationship close failed' },
    });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true, warnings: [] });
    expect(admin.calls).toContain('rpc:close_account_relationship_generations');
    expect(admin.calls).not.toContain('rpc:cleanup_account_solo_couples');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('fails closed when relationship closure does not return an explicit valid confirmation', async () => {
    for (const closeRelationshipsData of [
      null,
      {},
      { ok: false, closed_count: 1 },
      { ok: true, closed_count: -1 },
      { ok: true, closed_count: 1.5 },
    ]) {
      const admin = makeAdmin({ closeRelationshipsData });
      const response = await post(admin);

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ dataRemoved: true });
      expect(admin.calls).not.toContain('rpc:cleanup_account_solo_couples');
      expect(admin.calls).not.toContain('auth.admin.deleteUser');
    }
  });

  it('leaves the flag SET when Auth deletion fails, and reports dataRemoved: true', async () => {
    const admin = makeAdmin({ deleteUserError: { message: 'auth deletion failed' } });
    const response = await post(admin);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.dataRemoved).toBe(true);
    // Three attempts, exactly as before.
    expect(admin.calls.filter((call) => call === 'auth.admin.deleteUser')).toHaveLength(3);
    // The pending flag is written once and never cleared: recovery must stay
    // active for an account whose data is already gone.
    expect(admin.metadataWrites).toHaveLength(1);
    expect(admin.metadataWrites[0]).toMatchObject({ account_deletion_pending: true });
    // The upload-blocking marker is a DIFFERENT marker with the opposite
    // lifecycle, and it is still cleared here exactly as before.
    expect(admin.calls).toContain('rpc:cancel_account_deletion');
  });

  it('does not clear the flag on the success path; Auth deletion removes it implicitly', async () => {
    const admin = makeAdmin();
    const response = await post(admin);
    expect(response.status).toBe(200);
    expect(admin.metadataWrites).toHaveLength(1);
    // No second write setting it back to false, which would open a window in
    // which the flag is false while the user still exists.
    expect(admin.metadataWrites.every((write) => (
      (write as Record<string, unknown>).account_deletion_pending === true
    ))).toBe(true);
  });

  it('pins the deletion sequence, including sole-couple cleanup before Auth deletion', async () => {
    const admin = makeAdmin();
    await post(admin);
    expect(admin.calls).toEqual([
      'auth.getUser',
      'auth.admin.updateUserById',
      'from:daily_records.select',
      'rpc:begin_account_deletion',
      'rpc:e2ee_prepare_account_deletion',
      'rpc:prepare_account_deletion',
      'rpc:close_account_relationship_generations',
      'rpc:cleanup_account_solo_couples',
      'auth.admin.deleteUser',
    ]);
  });

  it('PRESERVATION: a database preparation failure still cancels the upload marker', async () => {
    const admin = makeAdmin({ prepareError: { message: 'rpc failed' } });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect((await response.json()).dataRemoved).toBe(false);
    expect(admin.calls).toContain('rpc:cancel_account_deletion');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('fails closed after DB preparation when sole-couple cleanup cannot be confirmed', async () => {
    const admin = makeAdmin({ cleanupCouplesError: { message: 'cleanup failed' } });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).toContain('rpc:cleanup_account_solo_couples');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('uses app_metadata and never user_metadata', async () => {
    const admin = makeAdmin();
    await post(admin);
    const payloads = (admin.auth.admin.updateUserById as ReturnType<typeof vi.fn>).mock.calls
      .map(([, payload]) => payload as Record<string, unknown>);
    for (const payload of payloads) {
      expect(payload).toHaveProperty('app_metadata');
      expect(payload).not.toHaveProperty('user_metadata');
    }
  });
});

describe('delete-account - server configuration failure fails closed', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const postWithEnv = (envOverrides: Record<string, string | undefined>, admin: unknown) => {
    return handleDeleteAccountRequest(
      new Request('https://edge.example/delete-account', {
        method: 'POST',
        headers: { Origin: 'https://gomsinlog.app', Authorization: 'Bearer token' },
      }),
      {
        env: (key: string) => ({ ...ENV, ...envOverrides })[key],
        createAdmin: () => admin,
      },
    );
  };

  it('fails closed with 500 when SUPABASE_SECRET_KEYS is missing or empty', async () => {
    for (const val of [undefined, '', '   ']) {
      const admin = makeAdmin();
      const response = await postWithEnv({ SUPABASE_SECRET_KEYS: val }, admin);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Server configuration error' });
      expect(admin.calls).toEqual([]);
    }
  });

  it('fails closed with 500 on malformed JSON', async () => {
    const admin = makeAdmin();
    const response = await postWithEnv({ SUPABASE_SECRET_KEYS: '{ bad json' }, admin);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Server configuration error' });
    expect(admin.calls).toEqual([]);
  });

  it('fails closed with 500 on wrong shape (array, primitive, missing/non-string default)', async () => {
    for (const val of [
      '123',
      'true',
      '"sb_secret_str"',
      '[]',
      '["sb_secret_str"]',
      '{}',
      JSON.stringify({ default: 12345 }),
      JSON.stringify({ default: null }),
      JSON.stringify({ default: '' }),
      JSON.stringify({ default: '   ' }),
      JSON.stringify({ default: 'sb_secret_' }),
    ]) {
      const admin = makeAdmin();
      const response = await postWithEnv({ SUPABASE_SECRET_KEYS: val }, admin);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Server configuration error' });
      expect(admin.calls).toEqual([]);
    }
  });

  it('fails closed when only legacy SUPABASE_SERVICE_ROLE_KEY is in env', async () => {
    const admin = makeAdmin();
    const response = await postWithEnv({
      SUPABASE_SECRET_KEYS: undefined,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    }, admin);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Server configuration error' });
    expect(admin.calls).toEqual([]);
  });

  it('fails closed on non-secret format (legacy service_role, JWT, publishable key)', async () => {
    for (const defaultVal of [
      'service-role-key',
      'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig',
      'sb_publishable_test_key',
    ]) {
      const admin = makeAdmin();
      const response = await postWithEnv({
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: defaultVal }),
      }, admin);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Server configuration error' });
      expect(admin.calls).toEqual([]);
    }
  });

  it('proceeds to admin verification when valid SUPABASE_SECRET_KEYS JSON is provided', async () => {
    const admin = makeAdmin();
    const response = await postWithEnv({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_live_admin_key' }),
    }, admin);
    expect(response.status).toBe(200);
    expect(admin.calls).toContain('auth.getUser');
  });
});
