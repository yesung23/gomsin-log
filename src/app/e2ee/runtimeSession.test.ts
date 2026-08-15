import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decideRecordWrite } from '@/app/records/contentCrypto';
import * as keystore from '@/crypto/keystore';
import { getRecordCryptoEnvironment } from '@/lib/records';
import * as protectedLocalState from './protectedLocalState';
import {
  clearE2eeRuntime,
  markE2eeCoupleAuthorityUnlinked,
  registerE2eeCoupleAuthorityUnlink,
} from './runtimeLifecycle';
import {
  installE2eeRuntimeForAuthenticatedSession,
  installE2eeRuntimeForSession,
} from './runtimeSession';
import { bootstrapFirstDevice, confirmRecoveryKit } from './useCases';
import { createMemoryAccount, createMemoryServer, linkCouple } from './testing/memoryEnvironment';

describe('authenticated E2EE runtime session', () => {
  afterEach(() => clearE2eeRuntime());

  it('installs a floor guard before runtime readiness and refuses a protected write without a key', async () => {
    const server = createMemoryServer();
    const account = createMemoryAccount(server);
    const device = account.devices[0];
    server.writeFloors.set(`personal:${account.userId}`, 1);

    await expect(installE2eeRuntimeForSession({
      userId: account.userId,
      repository: device.deps.repository,
      localState: account.localState,
      deviceKeys: null,
      localKeys: null,
      installationId: 'test-session',
    })).resolves.toEqual({ status: 'guarded', reason: 'secure_storage_unavailable' });

    const guarded = getRecordCryptoEnvironment();
    expect(guarded).not.toBeNull();
    await expect(decideRecordWrite(guarded!, {
      isPrivate: true,
      ownerUserId: account.userId,
      coupleId: crypto.randomUUID(),
    })).resolves.toEqual({ mode: 'refused', reason: 'no_active_epoch' });
  });

  it('installs the authenticated-wrapper guard while protected-state creation is still pending', async () => {
    const localKeys = {
      load: vi.fn(),
      loadOrCreate: vi.fn(),
    };
    vi.spyOn(keystore, 'getLocalKeyPort').mockReturnValue(localKeys);
    vi.spyOn(keystore, 'getDeviceKeyPort').mockReturnValue(null);
    let resolveProtectedState!: (value: null) => void;
    const pendingProtectedState = new Promise<null>((resolve) => {
      resolveProtectedState = resolve;
    });
    vi.spyOn(protectedLocalState, 'createProtectedE2eeLocalState')
      .mockReturnValue(pendingProtectedState);

    const installation = installE2eeRuntimeForAuthenticatedSession({
      userId: crypto.randomUUID(),
      supabaseClient: {} as SupabaseClient,
    });

    const guard = getRecordCryptoEnvironment();
    expect(guard).not.toBeNull();
    await expect(guard!.scopeKeyFor('personal', crypto.randomUUID(), 1n)).resolves.toBeNull();
    resolveProtectedState(null);
    await expect(installation).resolves.toEqual({
      status: 'guarded',
      reason: 'secure_storage_unavailable',
    });
  });

  it('replaces the guard with the verified runtime once the local bootstrap is complete', async () => {
    const server = createMemoryServer();
    const account = createMemoryAccount(server);
    const device = account.devices[0];
    const bootstrapped = await bootstrapFirstDevice(device.deps, {
      userId: account.userId,
      platform: 'ios',
    });
    await confirmRecoveryKit(device.deps, {
      userId: account.userId,
      recoveryCode: bootstrapped.recoveryCode,
      kitAnchor: bootstrapped.kitAnchor,
    });
    server.writeFloors.set(`personal:${account.userId}`, 1);
    // Keep the test port explicit rather than importing browser storage: the
    // runtime only needs an account/device-bound opaque AES capability here.
    const keyPort = {
      load: async () => null,
      loadOrCreate: async (binding: { installationId: string; userId: string; deviceId: string; purpose: string; version: number }) => ({
        binding,
        has: async () => true,
        seal: async () => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array() }),
        open: async () => new Uint8Array(),
        delete: async () => {},
      }),
    };

    const result = await installE2eeRuntimeForSession({
      userId: account.userId,
      repository: device.deps.repository,
      localState: account.localState,
      deviceKeys: device.deviceKeys,
      localKeys: keyPort,
      installationId: 'test-session',
    });
    // An account with no server-owned couple scope is `not_paired`, which is
    // deliberately different from a couple whose CSK could not be reached.
    expect(result).toEqual({
      status: 'installed',
      deviceId: bootstrapped.deviceId,
      coupleProtection: 'not_paired',
    });
    await expect(decideRecordWrite(getRecordCryptoEnvironment()!, {
      isPrivate: true,
      ownerUserId: account.userId,
      coupleId: crypto.randomUUID(),
    })).resolves.toMatchObject({ mode: 'gle1', keyEpoch: 1n });
  });

  it('reports couple protection as unavailable when a paired CSK cannot be reached', async () => {
    const server = createMemoryServer();
    const account = createMemoryAccount(server);
    const partner = createMemoryAccount(server);
    const device = account.devices[0];
    const bootstrapped = await bootstrapFirstDevice(device.deps, {
      userId: account.userId,
      platform: 'ios',
    });
    await confirmRecoveryKit(device.deps, {
      userId: account.userId,
      recoveryCode: bootstrapped.recoveryCode,
      kitAnchor: bootstrapped.kitAnchor,
    });
    server.writeFloors.set(`personal:${account.userId}`, 1);
    const coupleId = linkCouple(server, account.userId, partner.userId);
    const keyPort = {
      load: async () => null,
      loadOrCreate: async (binding: { installationId: string; userId: string; deviceId: string; purpose: string; version: number }) => ({
        binding,
        has: async () => true,
        seal: async () => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array() }),
        open: async () => new Uint8Array(),
        delete: async () => {},
      }),
    };

    const result = await installE2eeRuntimeForSession({
      userId: account.userId,
      repository: device.deps.repository,
      localState: account.localState,
      deviceKeys: device.deviceKeys,
      localKeys: keyPort,
      installationId: 'test-session',
      activeCoupleId: coupleId,
    });

    // The couple exists but no pairing ceremony produced a usable CSK on this
    // device, so the floor must NOT be activated and the shared write must fail
    // closed instead of downgrading to plaintext.
    expect(result).toEqual({
      status: 'installed',
      deviceId: bootstrapped.deviceId,
      coupleProtection: 'keys_pending',
    });
    expect(server.writeFloors.get(`couple:${coupleId}`)).toBeUndefined();
  });

  it('makes local couple-authority tombstoning session-bound', async () => {
    const tombstone = vi.fn().mockResolvedValue(undefined);
    registerE2eeCoupleAuthorityUnlink(tombstone);
    await markE2eeCoupleAuthorityUnlinked('11111111-1111-1111-1111-111111111111');
    expect(tombstone).toHaveBeenCalledTimes(1);
    clearE2eeRuntime();
    await markE2eeCoupleAuthorityUnlinked('11111111-1111-1111-1111-111111111111');
    expect(tombstone).toHaveBeenCalledTimes(1);
  });
});
