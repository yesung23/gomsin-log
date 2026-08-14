import { afterEach, describe, expect, it } from 'vitest';
import { importAesKey, randomBytes } from '@/crypto/suite';
import { decideRecordWrite } from '@/app/records/contentCrypto';
import { getRecordCryptoEnvironment } from '@/lib/records';
import { getOutboxLocalCacheKey } from '@/lib/outbox';
import { bootstrapFirstDevice, confirmRecoveryKit } from './useCases';
import {
  activatePersonalProtection,
  clearE2eeRuntime,
  createVerifiedRecordCryptoEnvironment,
  installE2eeRuntime,
} from './runtime';
import { createMemoryAccount, createMemoryServer } from './testing/memoryEnvironment';

describe('verified E2EE runtime', () => {
  afterEach(() => clearE2eeRuntime());

  it('opens only the current device envelope and exposes a non-extractable record key', async () => {
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

    const environment = await createVerifiedRecordCryptoEnvironment({
      userId: account.userId,
      deviceId: bootstrapped.deviceId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      deviceKeys: device.deviceKeys,
      now: () => server.now(),
    });
    const key = await environment.scopeKeyFor('personal', account.userId, 1n);
    expect(key).not.toBeNull();
    expect(key?.extractable).toBe(false);
    await activatePersonalProtection({
      userId: account.userId,
      deviceId: bootstrapped.deviceId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      environment,
    });
    await expect(decideRecordWrite(environment, {
      isPrivate: true,
      ownerUserId: account.userId,
      coupleId: crypto.randomUUID(),
    })).resolves.toMatchObject({ mode: 'gle1', keyEpoch: 1n });
  });

  it('refuses personal floor activation until recovery confirmation, then activates with PMK only', async () => {
    const server = createMemoryServer();
    const account = createMemoryAccount(server);
    const device = account.devices[0];
    const bootstrapped = await bootstrapFirstDevice(device.deps, {
      userId: account.userId,
      platform: 'ios',
    });
    const beforeConfirmation = {
      floorFor: async () => 0,
      epochsFor: async () => [],
      scopeKeyFor: async () => null,
    };
    await expect(activatePersonalProtection({
      userId: account.userId,
      deviceId: bootstrapped.deviceId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      environment: beforeConfirmation,
    })).rejects.toThrow('E_RECOVERY_CONFIRMATION_REQUIRED');

    await confirmRecoveryKit(device.deps, {
      userId: account.userId,
      recoveryCode: bootstrapped.recoveryCode,
      kitAnchor: bootstrapped.kitAnchor,
    });
    const environment = await createVerifiedRecordCryptoEnvironment({
      userId: account.userId,
      deviceId: bootstrapped.deviceId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      deviceKeys: device.deviceKeys,
      now: () => server.now(),
    });
    await activatePersonalProtection({
      userId: account.userId,
      deviceId: bootstrapped.deviceId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      environment,
    });
    expect(await device.deps.repository.getWriteFloor('personal', account.userId)).toBe(1);
  });

  it('rejects a tampered GLK2 envelope instead of returning a replacement key', async () => {
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
    const environment = await createVerifiedRecordCryptoEnvironment({
      userId: account.userId,
      deviceId: bootstrapped.deviceId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      deviceKeys: device.deviceKeys,
      now: () => server.now(),
    });
    const envelope = server.envelopes.find((entry) => entry.recipientId === bootstrapped.deviceId)!;
    envelope.envelope = envelope.envelope.slice();
    envelope.envelope[envelope.envelope.length - 1] ^= 1;
    await expect(environment.scopeKeyFor('personal', account.userId, 1n))
      .rejects.toThrow(/E_BAD_SIGNATURE|E2EE/);
  });

  it('installs LCK and record environment together, and clears both on close', async () => {
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
    const installed = await installE2eeRuntime({
      userId: account.userId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      deviceKeys: device.deviceKeys,
      localKeys: {
        loadOrCreateLck: async () => ({
          key: await importAesKey(randomBytes(32), ['encrypt', 'decrypt']),
          userId: account.userId,
          deviceId: bootstrapped.deviceId,
        }),
      },
      now: () => server.now(),
    });
    expect(getRecordCryptoEnvironment()).toBe(installed.environment);
    expect(getOutboxLocalCacheKey()).not.toBeNull();
    installed.close();
    expect(getRecordCryptoEnvironment()).toBeNull();
    expect(getOutboxLocalCacheKey()).toBeNull();
  });
});
