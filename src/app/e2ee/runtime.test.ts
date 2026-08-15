import { afterEach, describe, expect, it } from 'vitest';
import {
  aesGcmOpen,
  aesGcmSeal,
  generateEphemeralAgreement,
  importAesKey,
  randomBytes,
  randomNonce,
} from '@/crypto/suite';
import { uuidToBytes } from '@/crypto/bytes';
import { KEY_DOMAIN, RECIPIENT_KIND } from '@/crypto/domains';
import { sealScopeKeyForRecipient } from '@/crypto/keyring/scopeKeys';
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
    expect(await environment.scopeKeyFor('health', account.userId, 1n)).not.toBeNull();
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

  it('does not activate a floor after the authenticated session changes mid-check', async () => {
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
    let current = true;
    const originalGetWriteFloor = device.deps.repository.getWriteFloor.bind(device.deps.repository);
    device.deps.repository.getWriteFloor = async (...args) => {
      const floor = await originalGetWriteFloor(...args);
      current = false;
      return floor;
    };

    await expect(activatePersonalProtection({
      userId: account.userId,
      deviceId: bootstrapped.deviceId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      environment,
      isCurrentSession: () => current,
    })).rejects.toThrow('E_RUNTIME_SESSION_STALE');
    expect(await originalGetWriteFloor('personal', account.userId)).toBe(0);
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

  it('rejects the Kiro cross-account personal-scope attack before key import', async () => {
    const server = createMemoryServer();
    const alice = createMemoryAccount(server);
    const bob = createMemoryAccount(server);
    const aliceBoot = await bootstrapFirstDevice(alice.devices[0].deps, { userId: alice.userId, platform: 'ios' });
    await confirmRecoveryKit(alice.devices[0].deps, {
      userId: alice.userId, recoveryCode: aliceBoot.recoveryCode, kitAnchor: aliceBoot.kitAnchor,
    });
    const bobBoot = await bootstrapFirstDevice(bob.devices[0].deps, { userId: bob.userId, platform: 'ios' });
    await confirmRecoveryKit(bob.devices[0].deps, {
      userId: bob.userId, recoveryCode: bobBoot.recoveryCode, kitAnchor: bobBoot.kitAnchor,
    });

    // B's legitimate anchor is pinned as partner material, but that fact must
    // not grant B authority over A's personal scope.
    await alice.localState.pinTrustAnchor(bob.userId, (await bob.localState.loadTrustAnchor(bob.userId))!);
    const personal = server.scopeKeys.find((scope) => scope.domain === 'personal' && scope.scopeId === alice.userId)!;
    const bobDevice = server.devices.find((device) => device.id === bobBoot.deviceId)!;
    const aliceDevice = server.devices.find((device) => device.id === aliceBoot.deviceId)!;
    const bobCertificate = server.certificates.find((certificate) => certificate.subjectDeviceId === bobBoot.deviceId)!;
    const attackerEnvelope = await sealScopeKeyForRecipient({
      scopeKey: randomBytes(32),
      recipientKemSpki: aliceDevice.kemSpki,
      recipientId: uuidToBytes(aliceBoot.deviceId),
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: uuidToBytes(bobBoot.deviceId),
      senderSigSpki: bobDevice.sigSpki,
      sign: (message) => bob.devices[0].deviceKeys.sign(`dev_sig:${bobBoot.deviceId}`, message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: {
        domain: KEY_DOMAIN.personal,
        scopeKeyId: uuidToBytes(personal.id),
        ownerUserId: uuidToBytes(alice.userId),
        scopeId: uuidToBytes(alice.userId),
        epoch: personal.epoch,
      },
      nowMs: BigInt(server.now()),
    });
    server.envelopes = server.envelopes.filter(
      (envelope) => !(envelope.scopeKeyId === personal.id && envelope.recipientId === aliceBoot.deviceId),
    );
    server.envelopes.push({
      scopeKeyId: personal.id,
      recipientKind: 'device',
      recipientId: aliceBoot.deviceId,
      senderDeviceId: bobBoot.deviceId,
      senderCertificateId: bobCertificate.id,
      envelope: attackerEnvelope,
      selfNotarized: false,
    });

    const environment = await createVerifiedRecordCryptoEnvironment({
      userId: alice.userId,
      deviceId: aliceBoot.deviceId,
      repository: alice.devices[0].deps.repository,
      localState: alice.localState,
      deviceKeys: alice.devices[0].deviceKeys,
      now: () => server.now(),
    });
    await expect(environment.scopeKeyFor('personal', alice.userId, personal.epoch))
      .rejects.toMatchObject({ code: 'E_SCOPE_SENDER_UNAUTHORIZED' });

    const health = server.scopeKeys.find((scope) => scope.domain === 'health' && scope.scopeId === alice.userId)!;
    const healthAttack = await sealScopeKeyForRecipient({
      scopeKey: randomBytes(32),
      recipientKemSpki: aliceDevice.kemSpki,
      recipientId: uuidToBytes(aliceBoot.deviceId),
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: uuidToBytes(bobBoot.deviceId),
      senderSigSpki: bobDevice.sigSpki,
      sign: (message) => bob.devices[0].deviceKeys.sign(`dev_sig:${bobBoot.deviceId}`, message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: {
        domain: KEY_DOMAIN.health,
        scopeKeyId: uuidToBytes(health.id),
        ownerUserId: uuidToBytes(alice.userId),
        scopeId: uuidToBytes(alice.userId),
        epoch: health.epoch,
      },
      nowMs: BigInt(server.now()),
    });
    server.envelopes = server.envelopes.filter(
      (envelope) => !(envelope.scopeKeyId === health.id && envelope.recipientId === aliceBoot.deviceId),
    );
    server.envelopes.push({
      scopeKeyId: health.id,
      recipientKind: 'device',
      recipientId: aliceBoot.deviceId,
      senderDeviceId: bobBoot.deviceId,
      senderCertificateId: bobCertificate.id,
      envelope: healthAttack,
      selfNotarized: false,
    });
    await expect(environment.scopeKeyFor('health', alice.userId, health.epoch))
      .rejects.toMatchObject({ code: 'E_SCOPE_SENDER_UNAUTHORIZED' });
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
        load: async () => null,
        loadOrCreate: async (binding) => {
          const key = await importAesKey(randomBytes(32), ['encrypt', 'decrypt']);
          return {
            binding,
            has: async () => true,
            seal: async ({ plaintext, aad }) => {
              const nonce = randomNonce();
              return { nonce, ciphertext: await aesGcmSeal(key, nonce, plaintext, aad) };
            },
            open: async ({ sealed, aad }) => aesGcmOpen(key, sealed.nonce, sealed.ciphertext, aad),
            delete: async () => {},
          };
        },
      },
      installationId: 'installation-test',
      now: () => server.now(),
    });
    expect(getRecordCryptoEnvironment()).toBe(installed.environment);
    expect(getOutboxLocalCacheKey()).not.toBeNull();
    installed.close();
    expect(getRecordCryptoEnvironment()).toBeNull();
    expect(getOutboxLocalCacheKey()).toBeNull();
  });

  it('does not replace a missing LCK when sealed ciphertext is present', async () => {
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
    await expect(installE2eeRuntime({
      userId: account.userId,
      repository: device.deps.repository,
      localState: device.deps.localState,
      deviceKeys: device.deviceKeys,
      installationId: 'installation-loss-test',
      localKeys: { load: async () => null, loadOrCreate: async () => null },
      hasSealedOutbox: async () => true,
    })).rejects.toThrow('E_LCK_MISSING_WITH_CIPHERTEXT');
    expect(getRecordCryptoEnvironment()).toBeNull();
    expect(getOutboxLocalCacheKey()).toBeNull();
  });
});
