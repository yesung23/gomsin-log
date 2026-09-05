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
  flagReject?: unknown;
  reassertFlagError?: unknown;
  reassertFlagReject?: unknown;
  clearFlagError?: unknown;
  clearFlagReject?: unknown;
  restoreFlagError?: unknown;
  restoreFlagReject?: unknown;
  deleteUserError?: unknown;
  beginError?: unknown;
  beginData?: unknown;
  cancelError?: unknown;
  cancelReject?: unknown;
  cancelData?: unknown;
  inspectError?: unknown;
  inspectReject?: unknown;
  inspectRejectOnCall?: number;
  inspectData?: unknown;
  interleave?: 'new_attempt_before_cancel' | 'new_attempt_before_clear' | 'new_attempt_after_clear';
  newAttemptPhase?: string;
  e2eePrepareError?: unknown;
  e2eePrepareData?: unknown;
  prepareError?: unknown;
  prepareData?: unknown;
  closeRelationshipsError?: unknown;
  closeRelationshipsData?: unknown;
  cleanupCouplesError?: unknown;
  cleanupCouplesData?: unknown;
  iapPrepareError?: unknown;
  iapPrepareData?: unknown;
  recordRows?: Array<{ id: string; couple_id: string }>;
  storageObjectPaths?: string[];
};

function makeAdmin(options: AdminOptions = {}) {
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const metadataWrites: unknown[] = [];
  const storageObjects = new Set(options.storageObjectPaths ?? []);
  const runtime = {
    appMetadata: { ...EXISTING_APP_METADATA } as Record<string, unknown>,
    fence: null as null | { attemptId: string; phase: string },
  };
  const admin = {
    calls,
    rpcCalls,
    metadataWrites,
    runtime,
    storageObjects,
    auth: {
      getUser: vi.fn(async () => {
        calls.push('auth.getUser');
        return {
          data: { user: { id: 'user-a', app_metadata: { ...runtime.appMetadata } } },
          error: null,
        };
      }),
      admin: {
        updateUserById: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
          calls.push('auth.admin.updateUserById');
          metadataWrites.push(payload.app_metadata);
          const metadata = payload.app_metadata as Record<string, unknown>;
          const isPendingWrite = metadata?.account_deletion_pending === true;
          const pendingWriteCount = metadataWrites.filter((write) => (
            (write as Record<string, unknown>)?.account_deletion_pending === true
          )).length;
          const isInitialFlagWrite = isPendingWrite && pendingWriteCount === 1;
          const isPostClearRestoration = isPendingWrite && pendingWriteCount >= 3;
          const rejection = isInitialFlagWrite
            ? options.flagReject
            : isPostClearRestoration
              ? options.restoreFlagReject
            : isPendingWrite
              ? options.reassertFlagReject
              : options.clearFlagReject;
          if (rejection) throw rejection;
          const error = isInitialFlagWrite
            ? options.flagError
            : isPostClearRestoration
              ? options.restoreFlagError
            : isPendingWrite
              ? options.reassertFlagError
              : options.clearFlagError;
          if (error) return { data: null, error };
          runtime.appMetadata = { ...metadata };
          if (!isPendingWrite && options.interleave === 'new_attempt_after_clear') {
            runtime.fence = {
              attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              phase: options.newAttemptPhase ?? 'media_cleanup',
            };
          }
          return { data: {}, error: null };
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
          return {
            data: table === 'daily_records' ? (options.recordRows ?? []) : [],
            error: null,
          };
        },
      }),
    }),
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      calls.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      if (name === 'record_media_cleanup_contract_version') {
        return { data: 3, error: null };
      }
      if (name === 'begin_account_deletion_v2') {
        if (options.beginError) return { data: null, error: options.beginError };
        const data = Object.hasOwn(options, 'beginData')
          ? options.beginData
          : {
            ok: true,
            attempt_id: args?.p_attempt_id,
            phase: 'media_cleanup',
          };
        if (
          data && typeof data === 'object'
          && (data as Record<string, unknown>).ok === true
          && typeof (data as Record<string, unknown>).attempt_id === 'string'
          && typeof (data as Record<string, unknown>).phase === 'string'
        ) {
          runtime.fence = {
            attemptId: (data as Record<string, unknown>).attempt_id as string,
            phase: (data as Record<string, unknown>).phase as string,
          };
        }
        return { data, error: null };
      }
      if (name === 'cancel_account_deletion_v2') {
        if (options.cancelReject) throw options.cancelReject;
        if (options.cancelError) return { data: null, error: options.cancelError };
        if (options.interleave === 'new_attempt_before_cancel') {
          runtime.fence = {
            attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            phase: options.newAttemptPhase ?? 'media_cleanup',
          };
          runtime.appMetadata = {
            ...runtime.appMetadata,
            account_deletion_pending: true,
            account_deletion_attempt_id: runtime.fence.attemptId,
          };
        }
        const data = Object.hasOwn(options, 'cancelData')
          ? options.cancelData
          : runtime.fence?.attemptId === args?.p_attempt_id
            && runtime.fence.phase === 'media_cleanup';
        if (data === true) {
          runtime.fence = null;
          if (options.interleave === 'new_attempt_before_clear') {
            runtime.fence = {
              attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              phase: options.newAttemptPhase ?? 'media_cleanup',
            };
            runtime.appMetadata = {
              ...runtime.appMetadata,
              account_deletion_pending: true,
              account_deletion_attempt_id: runtime.fence.attemptId,
            };
          }
        }
        return { data, error: null };
      }
      if (name === 'inspect_account_deletion_fence_v2') {
        const inspectCall = rpcCalls.filter((call) => (
          call.name === 'inspect_account_deletion_fence_v2'
        )).length;
        if (
          options.inspectReject
          && (options.inspectRejectOnCall ?? 1) === inspectCall
        ) throw options.inspectReject;
        if (options.inspectError) return { data: null, error: options.inspectError };
        const data = Object.hasOwn(options, 'inspectData')
          ? options.inspectData
          : runtime.fence
            ? {
              ok: true,
              pending: true,
              attempt_id: runtime.fence.attemptId,
              phase: runtime.fence.phase,
            }
            : { ok: true, pending: false };
        return { data, error: null };
      }
      // E2EE key-material cleanup runs before the relational preparation and
      // can legitimately refuse, so a failure here must abort the deletion.
      if (
        name === 'e2ee_prepare_account_deletion'
        || name === 'e2ee_prepare_account_deletion_v2'
      ) {
        return options.e2eePrepareError
          ? { data: null, error: options.e2eePrepareError }
          : {
            data: Object.hasOwn(options, 'e2eePrepareData')
              ? options.e2eePrepareData
              : name.endsWith('_v2')
                ? {
                  ok: true,
                  phase: 'e2ee_prepared',
                  preparation: { partner_remains: false, deleted_devices: 1 },
                }
                : { partner_remains: false, deleted_devices: 1 },
            error: null,
          };
      }
      if (name === 'prepare_account_deletion' || name === 'prepare_account_deletion_v2') {
        return options.prepareError
          ? { data: null, error: options.prepareError }
          : {
            data: Object.hasOwn(options, 'prepareData')
              ? options.prepareData
              : name.endsWith('_v2')
                ? { ok: true, phase: 'relational_prepared', preparation: { ok: true } }
                : { ok: true },
            error: null,
          };
      }
      if (
        name === 'close_account_relationship_generations'
        || name === 'close_account_relationship_generations_v2'
      ) {
        if (options.closeRelationshipsError) {
          return { data: null, error: options.closeRelationshipsError };
        }
        return {
          data: Object.hasOwn(options, 'closeRelationshipsData')
            ? options.closeRelationshipsData
            : {
              ok: true,
              closed_count: 1,
              ...(name.endsWith('_v2') ? { phase: 'relationships_closed' } : {}),
            },
          error: null,
        };
      }
      if (
        name === 'cleanup_account_solo_couples'
        || name === 'cleanup_account_solo_couples_v2'
      ) {
        return options.cleanupCouplesError
          ? { data: null, error: options.cleanupCouplesError }
          : {
            data: Object.hasOwn(options, 'cleanupCouplesData')
              ? options.cleanupCouplesData
              : name.endsWith('_v2')
                ? { ok: true, phase: 'solo_cleanup_complete', deleted_count: 1 }
                : 1,
            error: null,
          };
      }
      if (name === 'iap_prepare_account_deletion_v2') {
        return options.iapPrepareError
          ? { data: null, error: options.iapPrepareError }
          : {
            data: options.iapPrepareData ?? [{
              prepared: true,
              entitlements_revoked: 1,
              reservations_released: 0,
              transactions_retained: 2,
              notifications_retained: 1,
              credit_entries_retained: 0,
            }],
            error: null,
          };
      }
      return { data: null, error: null };
    }),
    storage: {
      from: () => ({
        list: async (folder: string) => {
          calls.push(`storage.list:${folder}`);
          const prefix = `${folder}/`;
          const data = [...storageObjects]
            .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .map((path) => ({ name: path.slice(prefix.length), id: `object:${path}` }));
          return { data, error: null };
        },
        remove: async (paths: string[]) => {
          calls.push('storage.remove');
          for (const path of paths) storageObjects.delete(path);
          return { error: null };
        },
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

  it('writes app_metadata.account_deletion_pending BEFORE the preflight and before fenced begin', async () => {
    const admin = makeAdmin();
    await post(admin);
    const flagAt = admin.calls.indexOf('auth.admin.updateUserById');
    expect(flagAt).toBeGreaterThanOrEqual(0);
    expect(flagAt).toBeLessThan(admin.calls.indexOf('from:daily_records.select'));
    expect(flagAt).toBeLessThan(admin.calls.indexOf('rpc:begin_account_deletion_v2'));
    expect(admin.metadataWrites[0]).toMatchObject({
      account_deletion_pending: true,
      account_deletion_attempt_id: expect.any(String),
    });
  });

  it('spreads the existing app_metadata first, so the rendered sign-in provider is unchanged', async () => {
    const admin = makeAdmin();
    await post(admin);
    expect(admin.metadataWrites[0]).toEqual({
      ...EXISTING_APP_METADATA,
      account_deletion_pending: true,
      account_deletion_attempt_id: expect.any(String),
    });
  });

  it('reasserts the pending metadata after begin and inspects the exact fence before E2EE', async () => {
    const admin = makeAdmin();

    expect((await post(admin)).status).toBe(200);

    const beginAt = admin.calls.indexOf('rpc:begin_account_deletion_v2');
    const pendingWrites = admin.metadataWrites.filter((write) => (
      (write as Record<string, unknown>).account_deletion_pending === true
    )) as Array<Record<string, unknown>>;
    const secondPendingAt = admin.calls.indexOf('auth.admin.updateUserById', beginAt + 1);
    const inspectAt = admin.calls.indexOf('rpc:inspect_account_deletion_fence_v2');
    const e2eeAt = admin.calls.indexOf('rpc:e2ee_prepare_account_deletion_v2');

    expect(pendingWrites).toHaveLength(2);
    expect(pendingWrites[1].account_deletion_attempt_id)
      .toBe(pendingWrites[0].account_deletion_attempt_id);
    expect(secondPendingAt).toBeGreaterThan(beginAt);
    expect(inspectAt).toBeGreaterThan(secondPendingAt);
    expect(e2eeAt).toBeGreaterThan(inspectAt);
  });

  it('starts no irreversible phase when the post-begin Auth reassertion fails', async () => {
    const admin = makeAdmin({ reassertFlagError: { message: 'metadata unavailable' } });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.calls).toContain('rpc:begin_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('starts no irreversible phase when the post-begin Auth reassertion rejects', async () => {
    const admin = makeAdmin({ reassertFlagReject: new Error('metadata transport rejected') });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: false, recoveryRequired: true });
    expect(admin.calls).toContain('rpc:begin_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('starts no irreversible phase when the post-begin fence inspection is unavailable', async () => {
    const admin = makeAdmin({ inspectError: { message: 'inspection unavailable' } });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: false, recoveryRequired: true });
    expect(admin.calls).toContain('rpc:inspect_account_deletion_fence_v2');
    expect(admin.calls).not.toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('uses a newer post-begin inspected phase when reporting possible data removal', async () => {
    const admin = makeAdmin({
      inspectData: {
        ok: true,
        pending: true,
        attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        phase: 'e2ee_prepared',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: true,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.calls).not.toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('storage.remove');
  });

  /** Deletion-Recovery Suite - test 7. */
  it('7 - a pending-flag write failure blocks ALL application-data deletion', async () => {
    const admin = makeAdmin({ flagError: { message: 'metadata write failed' } });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: false, warnings: [] });
    // The account is fully intact: not one destructive or preparatory step ran.
    expect(admin.calls).toEqual([
      'auth.getUser',
      'rpc:record_media_cleanup_contract_version',
      'auth.admin.updateUserById',
    ]);
    expect(admin.calls).not.toContain('from:daily_records.select');
    expect(admin.calls).not.toContain('rpc:begin_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
    // And the flag-write failure is NOT reported through the cancel path.
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
  });

  it('fenced-cancels only a structured exact orphan refusal confirmed by the DB wrapper', async () => {
    const admin = makeAdmin({
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      deletionCancelled: true,
      recoveryRequired: false,
    });
    expect(admin.calls).toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
    expect(admin.calls).toContain('rpc:cancel_account_deletion_v2');

    const begin = admin.rpcCalls.find((call) => call.name === 'begin_account_deletion_v2');
    const cancel = admin.rpcCalls.find((call) => call.name === 'cancel_account_deletion_v2');
    expect(cancel?.args?.p_attempt_id).toBe(begin?.args?.p_attempt_id);
  });

  it('clears only the pending Auth flag after the exact refusal is safely cancelled', async () => {
    const admin = makeAdmin({
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(admin.metadataWrites).toHaveLength(3);
    const [initialPending, postBeginPending, cleared] = admin.metadataWrites as Array<Record<string, unknown>>;
    expect(initialPending).toMatchObject({
      ...EXISTING_APP_METADATA,
      account_deletion_pending: true,
      account_deletion_attempt_id: expect.any(String),
    });
    expect(postBeginPending).toEqual(initialPending);
    expect(cleared).toEqual(EXISTING_APP_METADATA);
    const cancelAt = admin.calls.indexOf('rpc:cancel_account_deletion_v2');
    const clearAt = admin.calls.lastIndexOf('auth.admin.updateUserById');
    expect(cancelAt).toBeGreaterThanOrEqual(0);
    expect(clearAt).toBeGreaterThan(cancelAt);
  });

  it('requires recovery without claiming data loss when clearing the Auth flag fails', async () => {
    const admin = makeAdmin({
      clearFlagError: { message: 'metadata clear timeout' },
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.calls).toContain('rpc:cancel_account_deletion_v2');
    expect(admin.calls).not.toContain('storage.remove');
  });

  it('requires recovery when clearing the Auth flag rejects instead of returning an error', async () => {
    const admin = makeAdmin({
      clearFlagReject: new Error('metadata transport rejected'),
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('requires recovery when the exact fenced cancellation RPC rejects', async () => {
    const admin = makeAdmin({
      cancelReject: new Error('cancel transport rejected'),
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('does not clear metadata owned by a newer attempt that begins before cancellation cleanup', async () => {
    const admin = makeAdmin({
      interleave: 'new_attempt_before_clear',
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.runtime.appMetadata).toMatchObject({
      account_deletion_pending: true,
      account_deletion_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(admin.metadataWrites.at(-1)).toMatchObject({ account_deletion_pending: true });
  });

  it('reasserts a newer fence found after clearing the cancelled attempt metadata', async () => {
    const admin = makeAdmin({
      interleave: 'new_attempt_after_clear',
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.calls).toContain('rpc:inspect_account_deletion_fence_v2');
    expect(admin.runtime.appMetadata).toMatchObject({
      account_deletion_pending: true,
      account_deletion_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
  });

  it.each([
    'e2ee_prepared',
    'relational_prepared',
    'relationships_closed',
    'solo_cleanup_complete',
  ])('reports dataRemoved for a newer inspected attempt in phase %s', async (newAttemptPhase) => {
    const admin = makeAdmin({
      interleave: 'new_attempt_after_clear',
      newAttemptPhase,
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: true,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.runtime.appMetadata).toMatchObject({
      account_deletion_pending: true,
      account_deletion_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
  });

  it.each(['error', 'reject'] as const)(
    'explicitly keeps DB-backed recovery when newer pending metadata restoration returns %s',
    async (failure) => {
      const admin = makeAdmin({
        interleave: 'new_attempt_after_clear',
        ...(failure === 'error'
          ? { restoreFlagError: { message: 'metadata restore unavailable' } }
          : { restoreFlagReject: new Error('metadata restore unavailable') }),
        e2eePrepareData: {
          ok: false,
          rollback_confirmed: true,
          refusal_code: 'e2ee_would_orphan_partner',
          phase: 'media_cleanup',
        },
      });

      const response = await post(admin);

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        dataRemoved: false,
        recoveryRequired: true,
        deletionCancelled: false,
      });
      expect(admin.runtime.fence).toEqual({
        attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        phase: 'media_cleanup',
      });
      expect(admin.runtime.appMetadata.account_deletion_pending).not.toBe(true);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('restore pending deletion metadata'),
      );
    },
  );

  it('never clears Auth metadata after a newer attempt supersedes the exact DB fence', async () => {
    const admin = makeAdmin({
      interleave: 'new_attempt_before_cancel',
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.runtime.appMetadata).toMatchObject({
      account_deletion_pending: true,
      account_deletion_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(admin.metadataWrites.every((write) => (
      (write as Record<string, unknown>).account_deletion_pending === true
    ))).toBe(true);
  });

  it('restores pending metadata and requires recovery when post-cancel inspection rejects', async () => {
    const admin = makeAdmin({
      inspectReject: new Error('inspection transport rejected'),
      inspectRejectOnCall: 2,
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.runtime.appMetadata.account_deletion_pending).toBe(true);
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('preserves every media object when E2EE refuses deletion before irreversible cleanup', async () => {
    const mediaPath = 'couple-a/record-a/photo.jpg';
    const admin = makeAdmin({
      recordRows: [{ id: 'record-a', couple_id: 'couple-a' }],
      storageObjectPaths: [mediaPath],
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: false });
    expect([...admin.storageObjects]).toEqual([mediaPath]);
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).toContain('rpc:cancel_account_deletion_v2');
  });

  it('enqueues media cleanup during relational preparation without deleting Storage directly', async () => {
    const mediaPath = 'couple-a/record-a/photo.jpg';
    const admin = makeAdmin({
      recordRows: [{ id: 'record-a', couple_id: 'couple-a' }],
      storageObjectPaths: [mediaPath],
    });

    expect((await post(admin)).status).toBe(200);

    const e2eeAt = admin.calls.indexOf('rpc:e2ee_prepare_account_deletion_v2');
    const relationalAt = admin.calls.indexOf('rpc:prepare_account_deletion_v2');
    const relationshipCloseAt = admin.calls.indexOf('rpc:close_account_relationship_generations_v2');
    expect(e2eeAt).toBeGreaterThanOrEqual(0);
    expect(e2eeAt).toBeLessThan(relationalAt);
    expect(relationalAt).toBeLessThan(relationshipCloseAt);
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls.every((call) => !call.startsWith('storage.list:'))).toBe(true);
    expect([...admin.storageObjects]).toEqual([mediaPath]);
  });

  it('keeps Auth and the deletion barrier when pending media cleanup blocks relationship closure', async () => {
    const admin = makeAdmin({
      recordRows: [{ id: 'record-a', couple_id: 'couple-a' }],
      storageObjectPaths: ['couple-a/record-a/photo.jpg'],
      closeRelationshipsError: {
        code: 'P0001',
        message: 'record_media_cleanup_pending',
      },
    });

    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).toContain('rpc:prepare_account_deletion_v2');
    expect(admin.calls).toContain('rpc:close_account_relationship_generations_v2');
    expect(admin.calls).not.toContain('storage.remove');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('does not treat a zero-row fenced cancel as success', async () => {
    const admin = makeAdmin({
      e2eePrepareData: {
        ok: false,
        rollback_confirmed: true,
        refusal_code: 'e2ee_would_orphan_partner',
        phase: 'media_cleanup',
      },
      cancelData: false,
    });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      dataRemoved: false,
      recoveryRequired: true,
      deletionCancelled: false,
    });
    expect(admin.calls).toContain('rpc:cancel_account_deletion_v2');
    expect(admin.metadataWrites).toHaveLength(2);
    expect(admin.metadataWrites.every((write) => (
      (write as Record<string, unknown>).account_deletion_pending === true
    ))).toBe(true);
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it.each([
    ['08007', 'transaction resolution unknown'],
    ['40003', 'statement completion unknown'],
    ['08006', 'connection failure'],
    ['P0001', 'unrelated application error'],
    ['bad', 'malformed SQLSTATE'],
  ])('keeps the marker for E2EE error %s even when the transport labels it as SQL', async (code, message) => {
    const admin = makeAdmin({ e2eePrepareError: { code, message } });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion');
  });

  it.each([
    null,
    {},
    { ok: false, rollback_confirmed: true, refusal_code: 'other', phase: 'media_cleanup' },
    { ok: false, rollback_confirmed: false, refusal_code: 'e2ee_would_orphan_partner', phase: 'media_cleanup' },
    { ok: false, rollback_confirmed: true, refusal_code: 'e2ee_would_orphan_partner', phase: 'e2ee_prepared' },
  ])('keeps the marker for malformed or unknown E2EE result %#', async (e2eePrepareData) => {
    const admin = makeAdmin({ e2eePrepareData });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion');
  });

  it('keeps the durable deletion barrier once E2EE preparation has committed', async () => {
    const admin = makeAdmin({ prepareError: { message: 'relational preparation failed' } });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).toContain('rpc:prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('treats an invalid E2EE success response as possibly committed and keeps the barrier', async () => {
    const admin = makeAdmin({ e2eePrepareData: null });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).toContain('rpc:e2ee_prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
  });

  it('keeps the barrier when an E2EE transport failure cannot prove rollback', async () => {
    const admin = makeAdmin({
      e2eePrepareError: { status: 504, message: 'gateway response lost' },
    });
    const response = await post(admin);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).not.toContain('rpc:prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
  });

  it('runs E2EE preparation BEFORE the relational preparation', async () => {
    const admin = makeAdmin({});
    await post(admin);
    const e2eeAt = admin.calls.indexOf('rpc:e2ee_prepare_account_deletion_v2');
    const relationalAt = admin.calls.indexOf('rpc:prepare_account_deletion_v2');
    const authAt = admin.calls.indexOf('auth.admin.deleteUser');
    expect(e2eeAt).toBeGreaterThanOrEqual(0);
    expect(e2eeAt).toBeLessThan(relationalAt);
    // Auth deletion stays last.
    expect(relationalAt).toBeLessThan(authAt);
  });

  it('closes every relationship generation after relational preparation and before cleanup or Auth deletion', async () => {
    const admin = makeAdmin();
    await post(admin);
    const preparationAt = admin.calls.indexOf('rpc:prepare_account_deletion_v2');
    const closeAt = admin.calls.indexOf('rpc:close_account_relationship_generations_v2');
    const cleanupAt = admin.calls.indexOf('rpc:cleanup_account_solo_couples_v2');
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
    expect(admin.calls).toContain('rpc:close_account_relationship_generations_v2');
    expect(admin.calls).not.toContain('rpc:cleanup_account_solo_couples_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
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
      expect(admin.calls).not.toContain('rpc:cleanup_account_solo_couples_v2');
      expect(admin.calls).not.toContain('auth.admin.deleteUser');
      expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
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
    // The pending flag is written before and after fenced begin, and never
    // cleared: recovery must stay active for an account whose data is gone.
    expect(admin.metadataWrites).toHaveLength(2);
    expect(admin.metadataWrites[0]).toMatchObject({ account_deletion_pending: true });
    // The database marker is now the durable server-side barrier that prevents
    // this still-live Auth account from creating or joining a new generation.
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
  });

  it('does not clear the flag on the success path; Auth deletion removes it implicitly', async () => {
    const admin = makeAdmin();
    const response = await post(admin);
    expect(response.status).toBe(200);
    expect(admin.metadataWrites).toHaveLength(2);
    // Neither write sets it back to false, which would open a window in which
    // the flag is false while the user still exists.
    expect(admin.metadataWrites.every((write) => (
      (write as Record<string, unknown>).account_deletion_pending === true
    ))).toBe(true);
  });

  it('pins the deletion sequence, including sole-couple cleanup before Auth deletion', async () => {
    const admin = makeAdmin();
    await post(admin);
    expect(admin.calls).toEqual([
      'auth.getUser',
      'rpc:record_media_cleanup_contract_version',
      'auth.admin.updateUserById',
      'from:daily_records.select',
      'rpc:begin_account_deletion_v2',
      'auth.getUser',
      'auth.admin.updateUserById',
      'rpc:inspect_account_deletion_fence_v2',
      'rpc:e2ee_prepare_account_deletion_v2',
      'rpc:prepare_account_deletion_v2',
      'rpc:close_account_relationship_generations_v2',
      'rpc:cleanup_account_solo_couples_v2',
      'rpc:iap_prepare_account_deletion_v2',
      'auth.admin.deleteUser',
    ]);
  });

  it('uses one fresh cryptographic attempt UUID for every destructive v2 RPC in an invocation', async () => {
    const firstAdmin = makeAdmin();
    const secondAdmin = makeAdmin();

    expect((await post(firstAdmin)).status).toBe(200);
    expect((await post(secondAdmin)).status).toBe(200);

    const destructiveV2Names = [
      'begin_account_deletion_v2',
      'e2ee_prepare_account_deletion_v2',
      'prepare_account_deletion_v2',
      'close_account_relationship_generations_v2',
      'cleanup_account_solo_couples_v2',
      'iap_prepare_account_deletion_v2',
    ];
    const firstAttempts = firstAdmin.rpcCalls
      .filter((call) => destructiveV2Names.includes(call.name))
      .map((call) => call.args?.p_attempt_id);
    const secondAttempts = secondAdmin.rpcCalls
      .filter((call) => destructiveV2Names.includes(call.name))
      .map((call) => call.args?.p_attempt_id);

    expect(firstAttempts).toHaveLength(destructiveV2Names.length);
    expect(new Set(firstAttempts).size).toBe(1);
    expect(
      firstAdmin.rpcCalls.find((call) => call.name === 'iap_prepare_account_deletion_v2')
        ?.args?.p_attempt_id,
    ).toBe(firstAttempts[0]);
    expect(firstAttempts[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(secondAttempts).toHaveLength(destructiveV2Names.length);
    expect(new Set(secondAttempts).size).toBe(1);
    expect(secondAttempts[0]).not.toBe(firstAttempts[0]);
    expect(firstAdmin.rpcCalls.some((call) => (
      /account_deletion|account_relationship|account_solo/.test(call.name)
      && !call.name.endsWith('_v2')
    ))).toBe(false);
  });

  it('does not reopen writes when relational preparation fails after E2EE cleanup committed', async () => {
    const admin = makeAdmin({ prepareError: { message: 'rpc failed' } });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect((await response.json()).dataRemoved).toBe(true);
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('fails closed after DB preparation when sole-couple cleanup cannot be confirmed', async () => {
    const admin = makeAdmin({ cleanupCouplesError: { message: 'cleanup failed' } });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).toContain('rpc:cleanup_account_solo_couples_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
    expect(admin.calls).not.toContain('rpc:cancel_account_deletion_v2');
  });

  it('does not delete Auth when IAP tombstoning cannot be confirmed', async () => {
    const admin = makeAdmin({ iapPrepareError: { message: 'iap cleanup failed' } });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).toContain('rpc:iap_prepare_account_deletion_v2');
    expect(admin.calls).not.toContain('auth.admin.deleteUser');
  });

  it('does not delete Auth when IAP tombstoning returns a malformed success shape', async () => {
    const admin = makeAdmin({ iapPrepareData: [] });
    const response = await post(admin);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ dataRemoved: true });
    expect(admin.calls).toContain('rpc:iap_prepare_account_deletion_v2');
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
