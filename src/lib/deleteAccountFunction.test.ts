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
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const EXISTING_APP_METADATA = {
  provider: 'apple',
  providers: ['apple'],
  some_other_flag: 'keep-me',
};

type AdminOptions = {
  flagError?: unknown;
  deleteUserError?: unknown;
  prepareError?: unknown;
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
      if (name === 'prepare_account_deletion') {
        return options.prepareError
          ? { data: null, error: options.prepareError }
          : { data: { ok: true }, error: null };
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

  it('PRESERVATION: the deletion sequence once entered is unchanged, step for step', async () => {
    const admin = makeAdmin();
    await post(admin);
    expect(admin.calls).toEqual([
      'auth.getUser',
      'auth.admin.updateUserById',
      'from:daily_records.select',
      'rpc:begin_account_deletion',
      'rpc:prepare_account_deletion',
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
