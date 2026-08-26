import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalCoupleOwnerUserId } from '@/crypto/canonicalOwner';
import {
  confirmCoupleProtectionCeremony,
  prepareCoupleProtectionCeremony,
} from './coupleProtectionFlow';
import { bootstrapFirstDevice, confirmRecoveryKit } from './useCases';
import {
  activeScope,
  createMemoryAccount,
  createMemoryServer,
  linkCouple,
  type MemoryAccount,
  type MemoryServer,
} from './testing/memoryEnvironment';

async function bootstrap(account: MemoryAccount) {
  const device = account.devices[0];
  const result = await bootstrapFirstDevice(device.deps, { userId: account.userId, platform: 'ios' });
  await confirmRecoveryKit(device.deps, {
    userId: account.userId,
    recoveryCode: result.recoveryCode,
    kitAnchor: result.kitAnchor,
  });
  return device;
}

describe('two-account record protection product flow', () => {
  let server: MemoryServer;
  let a: MemoryAccount;
  let b: MemoryAccount;
  let coupleId: string;

  beforeEach(async () => {
    server = createMemoryServer();
    a = createMemoryAccount(server, '10000000-0000-4000-8000-000000000001');
    b = createMemoryAccount(server, '20000000-0000-4000-8000-000000000002');
    await Promise.all([bootstrap(a), bootstrap(b)]);
    coupleId = linkCouple(server, a.userId, b.userId);
  });

  it('shows the same independently rebuilt SAS and creates one CSK only after both confirmations', async () => {
    const aView = await prepareCoupleProtectionCeremony(a.devices[0].deps, {
      coupleId,
      ownUserId: a.userId,
      startIfMissing: true,
    });
    const bView = await prepareCoupleProtectionCeremony(b.devices[0].deps, {
      coupleId,
      ownUserId: b.userId,
    });
    expect(aView.sas).toBe(bView.sas);

    const afterA = await confirmCoupleProtectionCeremony(a.devices[0].deps, {
      coupleId,
      ownUserId: a.userId,
    });
    expect(afterA.ownConfirmed).toBe(true);
    expect(afterA.partnerConfirmed).toBe(false);
    expect(activeScope(server, 'couple', coupleId)).toBeUndefined();

    await confirmCoupleProtectionCeremony(b.devices[0].deps, {
      coupleId,
      ownUserId: b.userId,
    });
    const owner = canonicalCoupleOwnerUserId(a.userId, b.userId) === a.userId ? a : b;
    expect(owner).toBe(a);
    if (server.pairings[0].state !== 'CRYPTO_ACTIVE') {
      await confirmCoupleProtectionCeremony(owner.devices[0].deps, {
        coupleId,
        ownUserId: owner.userId,
      });
    }

    expect(server.pairings[0].state).toBe('CRYPTO_ACTIVE');
    expect(server.scopeKeys.filter((scope) => scope.domain === 'couple' && scope.scopeId === coupleId))
      .toHaveLength(1);
    expect(activeScope(server, 'couple', coupleId)).toBeDefined();

    const acceptedA = await prepareCoupleProtectionCeremony(a.devices[0].deps, {
      coupleId,
      ownUserId: a.userId,
    });
    const acceptedB = await prepareCoupleProtectionCeremony(b.devices[0].deps, {
      coupleId,
      ownUserId: b.userId,
    });
    expect(acceptedA.cryptoActive).toBe(true);
    expect(acceptedB.cryptoActive).toBe(true);
    expect((await a.localState.loadCoupleAuthority(coupleId))?.state).toBe('CRYPTO_ACTIVE');
    expect((await b.localState.loadCoupleAuthority(coupleId))?.state).toBe('CRYPTO_ACTIVE');

    server.setNow(server.now() + 10 * 60 * 1000);
    await expect(prepareCoupleProtectionCeremony(a.devices[0].deps, {
      coupleId,
      ownUserId: a.userId,
    })).resolves.toMatchObject({ cryptoActive: true });
    await expect(prepareCoupleProtectionCeremony(b.devices[0].deps, {
      coupleId,
      ownUserId: b.userId,
    })).resolves.toMatchObject({ cryptoActive: true });
  });

  it('fails closed when persisted transcript bytes differ from independently verified devices', async () => {
    await prepareCoupleProtectionCeremony(a.devices[0].deps, {
      coupleId,
      ownUserId: a.userId,
      startIfMissing: true,
    });
    server.pairings[0].transcript![100] ^= 1;

    await expect(prepareCoupleProtectionCeremony(b.devices[0].deps, {
      coupleId,
      ownUserId: b.userId,
    })).rejects.toThrow(/E_PAIRING_TRANSCRIPT_MISMATCH/);
    expect(activeScope(server, 'couple', coupleId)).toBeUndefined();
  });

  it('keeps the memory boundary aligned with SQL for conflicting proposals and foreign devices', async () => {
    const proposal = await prepareCoupleProtectionCeremony(a.devices[0].deps, {
      coupleId,
      ownUserId: a.userId,
      startIfMissing: true,
    });
    const row = server.pairings[0];

    await expect(a.devices[0].deps.repository.startPairing({
      coupleId,
      pairingNonce: new Uint8Array(row.pairingNonce!).fill(9),
      transcript: row.transcript!,
      transcriptHash: row.transcriptHash!,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt!,
    })).rejects.toThrow(/live_pairing_already_exists/);

    await expect(a.devices[0].deps.repository.confirmPairing({
      pairingId: proposal.pairingId,
      deviceId: b.devices[0].deviceId,
      signature: new Uint8Array(64),
    })).rejects.toThrow(/confirming_device_not_active_owner/);
  });
});
