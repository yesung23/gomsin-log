import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideRecordWrite } from '@/app/records/contentCrypto';
import { getRecordCryptoEnvironment } from '@/lib/records';
import {
  clearE2eeRuntime,
  markE2eeCoupleAuthorityUnlinked,
  registerE2eeCoupleAuthorityUnlink,
} from './runtimeLifecycle';
import { installE2eeRuntimeForSession } from './runtimeSession';
import { bootstrapFirstDevice, confirmRecoveryKit } from './useCases';
import { createMemoryAccount, createMemoryServer } from './testing/memoryEnvironment';

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
    expect(result).toEqual({ status: 'installed', deviceId: bootstrapped.deviceId });
    await expect(decideRecordWrite(getRecordCryptoEnvironment()!, {
      isPrivate: true,
      ownerUserId: account.userId,
      coupleId: crypto.randomUUID(),
    })).resolves.toMatchObject({ mode: 'gle1', keyEpoch: 1n });
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
