/**
 * E2EE application flows, end to end.
 *
 * These are account-level scenarios, not helper tests. Every one of them runs
 * real WebCrypto — real ECDSA, real ECDH, real AES-GCM — against an in-memory
 * server that enforces migration 031's constraints, so a flow that would be
 * refused by the database is refused here too.
 *
 * The scenarios exist because an earlier phase reported these flows complete on
 * the strength of functions that computed values. A function that computes a
 * value is not a flow that creates an account, and the difference shows up as
 * data loss months later.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { bytesToUuid, hex, uuidToBytes } from '@/crypto/bytes';
import { generateEphemeralAgreement, publicKeyFingerprint, randomBytes } from '@/crypto/suite';
import { KEY_DOMAIN, RECIPIENT_KIND } from '@/crypto/domains';
import { sealScopeKeyForRecipient } from '@/crypto/keyring/scopeKeys';
import { verifyCertificateChain } from '@/crypto/deviceCertificate';
import { decodeHeader, splitEnvelope } from '@/crypto/glk2';
import { buildPairingSide, proposePairing } from '@/crypto/protocol/pairing';
import {
  encodePairingTranscript,
  pairingConfirmMessage,
  partnerAssistConfirmMessage,
} from '@/crypto/transcripts';
import { revocationLogGenesis } from '@/crypto/revocation';
import { createVerifiedRecordCryptoEnvironment } from './runtime';
import { clearE2eeRuntime } from './runtimeLifecycle';
import { installE2eeRuntimeForSession } from './runtimeSession';
import {
  acceptEnrollmentSas,
  approveSecondDeviceEnrollment,
  beginSecondDeviceEnrollment,
  bootstrapFirstDevice,
  completeCouplePairing,
  completeSecondDeviceProvisioning,
  confirmRecoveryKit,
  confirmSecondDeviceEnrollment,
  eligibleRecipients,
  partnerAssistCeremony,
  partnerAssistRecoverCouple,
  recoverWithKit,
  revokeDeviceAndRotate,
  selfNotarizeOwnEnvelopes,
  markCoupleAuthorityUnlinked,
} from './useCases';
import {
  activeScope,
  createDeviceEnvironment,
  createMemoryAccount,
  createMemoryServer,
  envelopeRecipients,
  linkCouple,
  type DeviceEnvironment,
  type MemoryAccount,
  type MemoryServer,
} from './testing/memoryEnvironment';

let server: MemoryServer;
let alice: MemoryAccount;

beforeEach(() => {
  server = createMemoryServer();
  alice = createMemoryAccount(server, '10000000-0000-4000-8000-000000000001');
});

/** Bootstrap one account to COMPLETE and return its first device. */
async function bootstrapAccount(account: MemoryAccount) {
  const device = account.devices[0];
  const result = await bootstrapFirstDevice(device.deps, { userId: account.userId, platform: 'ios' });
  await confirmRecoveryKit(device.deps, {
    userId: account.userId,
    recoveryCode: result.recoveryCode,
    kitAnchor: result.kitAnchor,
  });
  return { device, result };
}

// ---------------------------------------------------------------------------
// Scenario A — first setup
// ---------------------------------------------------------------------------

describe('Scenario A — first device setup', () => {
  it('creates the account, persists everything recovery needs, and completes only on kit confirmation', async () => {
    const device = alice.devices[0];
    const result = await bootstrapFirstDevice(device.deps, { userId: alice.userId, platform: 'ios' });

    expect(result.state).toBe('RECOVERY_KIT_PENDING_VERIFICATION');
    expect(alice.localState.bootstraps.get(alice.userId)!.state)
      .toBe('RECOVERY_KIT_PENDING_VERIFICATION');

    // Both AES-GCM nonces survived the round trip, and they are distinct.
    const identity = server.recoveryIdentities[0];
    expect(identity.recSigNonce).toHaveLength(12);
    expect(identity.recKemNonce).toHaveLength(12);
    expect(hex(identity.recSigNonce)).not.toBe(hex(identity.recKemNonce));

    // The bundle signature is persisted AND verifies against the stored key.
    expect(identity.bundleSig).toHaveLength(64);
    const { ecdsaVerify } = await import('@/crypto/suite');
    const { recoveryBundleSignedMessage } = await import('@/crypto/transcripts');
    expect(await ecdsaVerify(
      identity.recSigSpki,
      recoveryBundleSignedMessage(identity.recoveryBundleFp),
      identity.bundleSig,
    )).toBe(true);

    // PMK and HRK exist and are ACTIVE, each reached through READY.
    const personal = activeScope(server, 'personal', alice.userId);
    const health = activeScope(server, 'health', alice.userId);
    expect(personal).toBeDefined();
    expect(health).toBeDefined();

    // Device AND recovery envelopes for both.
    for (const scope of [personal!, health!]) {
      const kinds = server.envelopes
        .filter((e) => e.scopeKeyId === scope.id)
        .map((e) => e.recipientKind)
        .sort();
      expect(kinds).toEqual(['device', 'recovery_identity']);
      for (const envelope of server.envelopes.filter((e) => e.scopeKeyId === scope.id)) {
        expect(envelope.senderCertificateId).toBeTruthy();
        expect(envelope.envelope).toHaveLength(360);
      }
    }

    // The device stays PENDING until the kit is confirmed.
    expect(server.devices[0].status).toBe('PENDING');

    const wrongKit = await bootstrapFirstDevice(
      createDeviceEnvironment({
        server, userId: crypto.randomUUID(), localState: alice.localState,
      }).deps,
      { userId: crypto.randomUUID(), platform: 'ios' },
    ).catch(() => null);
    expect(wrongKit).toBeNull();

    await confirmRecoveryKit(device.deps, {
      userId: alice.userId, recoveryCode: result.recoveryCode, kitAnchor: result.kitAnchor,
    });
    expect(alice.localState.bootstraps.get(alice.userId)!.state).toBe('COMPLETE');
    expect(alice.localState.bootstraps.get(alice.userId)!.recoverySecret).toBeNull();
    expect(alice.localState.bootstraps.get(alice.userId)!.recoveryCode).toBeNull();
    expect(server.devices[0].status).toBe('ACTIVE');
  });

  it('resumes an interrupted bootstrap without creating a second root', async () => {
    const device = alice.devices[0];
    await bootstrapFirstDevice(device.deps, { userId: alice.userId, platform: 'ios' });

    const identityId = server.recoveryIdentities[0].id;
    const certificateCount = server.certificates.length;
    const personalEpochs = server.scopeKeys.filter((k) => k.domain === 'personal').length;

    // Run it again, exactly as a crashed client would on relaunch.
    const again = await bootstrapFirstDevice(device.deps, { userId: alice.userId, platform: 'ios' });
    expect(again.resumed).toBe(true);

    expect(server.recoveryIdentities).toHaveLength(1);
    expect(server.recoveryIdentities[0].id).toBe(identityId);
    expect(server.certificates).toHaveLength(certificateCount);
    expect(server.devices).toHaveLength(1);
    expect(server.scopeKeys.filter((k) => k.domain === 'personal')).toHaveLength(personalEpochs);
    expect(server.scopeKeys.filter((k) => k.domain === 'health')).toHaveLength(1);
    // And the kit still opens the account after a resume.
    await confirmRecoveryKit(device.deps, {
      userId: alice.userId, recoveryCode: again.recoveryCode, kitAnchor: again.kitAnchor,
    });
  });

  it('confirms only against reloaded persisted state, and a wrong kit changes nothing', async () => {
    const device = alice.devices[0];
    const result = await bootstrapFirstDevice(device.deps, { userId: alice.userId, platform: 'ios' });

    const other = createMemoryServer();
    const otherAccount = createMemoryAccount(other);
    const otherKit = await bootstrapFirstDevice(
      otherAccount.devices[0].deps, { userId: otherAccount.userId, platform: 'ios' },
    );

    await expect(confirmRecoveryKit(device.deps, {
      userId: alice.userId, recoveryCode: otherKit.recoveryCode, kitAnchor: result.kitAnchor,
    })).rejects.toThrow(/E_KIT_MISMATCH/);
    expect(alice.localState.bootstraps.get(alice.userId)!.state)
      .toBe('RECOVERY_KIT_PENDING_VERIFICATION');
    expect(server.devices[0].status).toBe('PENDING');

    // A kit naming another account's recovery identity is refused before the AEAD
    // is even reached — and there is no way to omit the anchor to get past this.
    await expect(confirmRecoveryKit(device.deps, {
      userId: alice.userId,
      recoveryCode: result.recoveryCode,
      kitAnchor: { ...result.kitAnchor, recoveryIdentityId: otherKit.kitAnchor.recoveryIdentityId },
    })).rejects.toThrow(/E_KIT_IDENTITY_MISMATCH/);

    const first = await confirmRecoveryKit(device.deps, {
      userId: alice.userId, recoveryCode: result.recoveryCode, kitAnchor: result.kitAnchor,
    });
    expect(first.alreadyComplete).toBe(false);
    // Idempotent.
    const second = await confirmRecoveryKit(device.deps, {
      userId: alice.userId, recoveryCode: result.recoveryCode, kitAnchor: result.kitAnchor,
    });
    expect(second.alreadyComplete).toBe(true);
    expect(server.devices[0].status).toBe('ACTIVE');
  });

  it('refuses to run at all while the feature flag is off', async () => {
    const disabled = createDeviceEnvironment({
      server, userId: alice.userId, localState: alice.localState, enabled: false,
    });
    await expect(bootstrapFirstDevice(disabled.deps, { userId: alice.userId, platform: 'ios' }))
      .rejects.toThrow(/E_E2EE_DISABLED/);
    expect(server.devices).toHaveLength(0);
  });

  it('refuses Web as a first or only bootstrap device', async () => {
    const web = createMemoryAccount(server);
    await expect(bootstrapFirstDevice(web.devices[0].deps, { userId: web.userId, platform: 'web' }))
      .rejects.toThrow('E_WEB_BOOTSTRAP_RESTRICTED');
    expect(server.scopeKeys.filter((k) => k.scopeId === web.userId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario B — add a second device
// ---------------------------------------------------------------------------

describe('Scenario B — second device enrollment', () => {
  let first: DeviceEnvironment;
  let second: DeviceEnvironment;
  let firstDeviceId: string;

  beforeEach(async () => {
    const bootstrapped = await bootstrapAccount(alice);
    first = bootstrapped.device;
    firstDeviceId = bootstrapped.result.deviceId;
    second = alice.addDevice();
  });

  it('reaches ACTIVE only after approval and provisioning, and never before', async () => {
    const begun = await beginSecondDeviceEnrollment(second.deps, {
      userId: alice.userId, platform: 'ios', approverDeviceId: firstDeviceId,
    });
    expect(begun.state).toBe('AWAITING_APPROVAL');

    // No certificate and no envelope yet: the device can decrypt nothing.
    expect(server.certificates.filter((c) => c.subjectDeviceId === begun.deviceId)).toHaveLength(0);
    expect(server.envelopes.filter((e) => e.recipientId === begun.deviceId)).toHaveLength(0);
    expect(await eligibleRecipients(first.deps, { userId: alice.userId, domain: 'personal' }))
      .toHaveLength(1);

    // Both sides derive the ceremony independently and must agree.
    const onNew = await confirmSecondDeviceEnrollment(second.deps, {
      userId: alice.userId, enrollNonce: begun.enrollNonce, approverDeviceId: firstDeviceId,
    });
    expect(onNew.sas).toMatch(/^\d{3}(-\d{3}){5}$/);
    expect(onNew.qrPayload).toHaveLength(32);

    await acceptEnrollmentSas(second.deps, {
      userId: alice.userId,
      enrollNonce: begun.enrollNonce,
      approverDeviceId: firstDeviceId,
      humanConfirmedSas: true,
    });

    // No auto-accept anywhere.
    await expect(approveSecondDeviceEnrollment(first.deps, {
      userId: alice.userId,
      enrollNonce: begun.enrollNonce,
      approverDeviceId: firstDeviceId,
      subjectPop: onNew.subjectPop,
      humanConfirmedSas: false,
    })).rejects.toThrow(/E_SAS_NOT_CONFIRMED/);

    // A forged proof of possession is refused.
    await expect(approveSecondDeviceEnrollment(first.deps, {
      userId: alice.userId,
      enrollNonce: begun.enrollNonce,
      approverDeviceId: firstDeviceId,
      subjectPop: randomBytes(64),
      humanConfirmedSas: true,
    })).rejects.toThrow(/E_BAD_POP/);

    const approved = await approveSecondDeviceEnrollment(first.deps, {
      userId: alice.userId,
      enrollNonce: begun.enrollNonce,
      approverDeviceId: firstDeviceId,
      subjectPop: onNew.subjectPop,
      humanConfirmedSas: true,
    });
    expect(approved.deviceId).toBe(begun.deviceId);

    // A valid certificate now exists and chains to the pinned root.
    const certificate = server.certificates.find((c) => c.subjectDeviceId === begun.deviceId)!;
    expect(certificate).toBeDefined();
    const identity = server.recoveryIdentities[0];
    const rootCertificate = server.certificates.find((c) => c.subjectDeviceId === firstDeviceId)!;
    const verified = await verifyCertificateChain({
      chain: [
        {
          certificate: certificate.certificate,
          subjectSigSpki: certificate.subjectSigSpki,
          subjectKemSpki: certificate.subjectKemSpki,
        },
        {
          certificate: rootCertificate.certificate,
          subjectSigSpki: rootCertificate.subjectSigSpki,
          subjectKemSpki: rootCertificate.subjectKemSpki,
        },
      ],
      anchor: {
        rootRecSigPubFp: await publicKeyFingerprint(identity.recSigSpki),
        rootRecSigSpki: identity.recSigSpki,
        recoveryIdentityId: uuidToBytes(identity.id),
        recoveryVersion: identity.recoveryVersion,
        userId: uuidToBytes(alice.userId),
        serverOriginId: server.serverOriginId,
      },
      atMs: BigInt(server.now()),
    });
    expect(bytesToUuid(verified.deviceId)).toBe(begun.deviceId);

    // Certified is not provisioned: still no scope envelope.
    expect(server.envelopes.filter((e) => e.recipientId === begun.deviceId)).toHaveLength(0);

    const provisioned = await completeSecondDeviceProvisioning(first.deps, {
      userId: alice.userId, newDeviceId: begun.deviceId, provisioningDeviceId: firstDeviceId,
    });
    expect(provisioned.state).toBe('PROVISIONED');
    expect(provisioned.provisioned.map((p) => p.domain).sort()).toEqual(['health', 'personal']);
    expect(server.envelopes.filter((e) => e.recipientId === begun.deviceId)).toHaveLength(2);

    const notarized = await selfNotarizeOwnEnvelopes(second.deps, {
      userId: alice.userId, deviceId: begun.deviceId,
    });
    expect(notarized.notarized).toBe(2);
    for (const envelope of server.envelopes.filter((e) => e.recipientId === begun.deviceId)) {
      expect(envelope.selfNotarized).toBe(true);
      expect(envelope.senderDeviceId).toBe(begun.deviceId);
    }

    // Replaying the spent nonce cannot enroll anything a second time.
    await expect(approveSecondDeviceEnrollment(first.deps, {
      userId: alice.userId,
      enrollNonce: begun.enrollNonce,
      approverDeviceId: firstDeviceId,
      subjectPop: onNew.subjectPop,
      humanConfirmedSas: true,
    })).rejects.toThrow(/E_NONCE_ALREADY_USED/);

    // Provisioning twice is a no-op rather than a duplicate envelope.
    const again = await completeSecondDeviceProvisioning(first.deps, {
      userId: alice.userId, newDeviceId: begun.deviceId, provisioningDeviceId: firstDeviceId,
    });
    expect(again.provisioned).toHaveLength(2);
    expect(server.envelopes.filter((e) => e.recipientId === begun.deviceId)).toHaveLength(2);
  });

  it('a server-created ACTIVE device row has no trust effect', async () => {
    // Exactly what a malicious service_role can produce: real public keys, any
    // status it likes, and nothing signed.
    const attackerId = crypto.randomUUID();
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const kem = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    server.devices.push({
      id: attackerId,
      userId: alice.userId,
      sigSpki: new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey)),
      kemSpki: new Uint8Array(await crypto.subtle.exportKey('spki', kem.publicKey)),
      platform: 'ios',
      assurance: 'secure_enclave',
      status: 'ACTIVE',
    });

    const recipients = await eligibleRecipients(first.deps, { userId: alice.userId, domain: 'personal' });
    expect(recipients.map((r) => r.deviceId)).toEqual([firstDeviceId]);
    expect(recipients.map((r) => r.deviceId)).not.toContain(attackerId);
  });
});

// ---------------------------------------------------------------------------
// Scenario C — pair two users
// ---------------------------------------------------------------------------

/** Run a full pairing ceremony between two bootstrapped accounts. */
async function pairAccounts(
  a: MemoryAccount,
  b: MemoryAccount,
  aDeviceId: string,
  bDeviceId: string,
  coupleId: string,
) {
  const identityA = server.recoveryIdentities.find((r) => r.userId === a.userId)!;
  const identityB = server.recoveryIdentities.find((r) => r.userId === b.userId)!;
  const certA = server.certificates.find((c) => c.subjectDeviceId === aDeviceId)!;
  const certB = server.certificates.find((c) => c.subjectDeviceId === bDeviceId)!;

  const sideFor = async (
    account: MemoryAccount,
    identity: typeof identityA,
    certificates: typeof certA,
    deviceId: string,
  ) => {
    const anchor = {
      rootRecSigPubFp: await publicKeyFingerprint(identity.recSigSpki),
      rootRecSigSpki: identity.recSigSpki,
      recoveryIdentityId: uuidToBytes(identity.id),
      recoveryVersion: identity.recoveryVersion,
      userId: uuidToBytes(account.userId),
      serverOriginId: server.serverOriginId,
    };
    const verified = await verifyCertificateChain({
      chain: [{
        certificate: certificates.certificate,
        subjectSigSpki: certificates.subjectSigSpki,
        subjectKemSpki: certificates.subjectKemSpki,
      }],
      anchor,
      atMs: BigInt(server.now()),
    });
    return buildPairingSide({
      userId: uuidToBytes(account.userId),
      verifiedDevices: [verified],
      certificateFingerprints: new Map([[hex(uuidToBytes(deviceId)), certificates.certificateFp]]),
      recoveryIdentityId: uuidToBytes(identity.id),
      recoveryVersion: identity.recoveryVersion,
      rootRecSigPubFp: anchor.rootRecSigPubFp,
      recoveryBundleFp: identity.recoveryBundleFp,
      revocationLogHead: await revocationLogGenesis(
        uuidToBytes(account.userId), uuidToBytes(identity.id),
      ),
    });
  };

  const sideA = await sideFor(a, identityA, certA, aDeviceId);
  const sideB = await sideFor(b, identityB, certB, bDeviceId);
  const proposed = await proposePairing({
    coupleId: uuidToBytes(coupleId),
    serverOriginId: server.serverOriginId,
    sideA,
    sideB,
    pairingNonce: randomBytes(32),
    createdAtMs: BigInt(server.now()),
    expiresAtMs: BigInt(server.now() + 600_000),
  });

  const aDevice = a.devices[0];
  const bDevice = b.devices[0];
  const signatureA = await aDevice.deviceKeys.sign(
    `dev_sig:${aDeviceId}`, pairingConfirmMessage(proposed.transcriptHash, uuidToBytes(aDeviceId)),
  );
  const signatureB = await bDevice.deviceKeys.sign(
    `dev_sig:${bDeviceId}`, pairingConfirmMessage(proposed.transcriptHash, uuidToBytes(bDeviceId)),
  );

  const pairingId = await aDevice.deps.repository.startPairing({
    coupleId,
    pairingNonce: proposed.transcript.pairingNonce,
    transcript: encodePairingTranscript(proposed.transcript),
    transcriptHash: proposed.transcriptHash,
    createdAt: new Date(Number(proposed.transcript.createdAtMs)).toISOString(),
    expiresAt: new Date(Number(proposed.transcript.expiresAtMs)).toISOString(),
  });
  await aDevice.deps.repository.confirmPairing({ pairingId, deviceId: aDeviceId, signature: signatureA });
  await bDevice.deps.repository.confirmPairing({ pairingId, deviceId: bDeviceId, signature: signatureB });

  return {
    proposed,
    sideA,
    sideB,
    confirmationA: { deviceId: aDeviceId, signature: signatureA },
    confirmationB: { deviceId: bDeviceId, signature: signatureB },
  };
}

describe('Scenario C — couple pairing', () => {
  let bob: MemoryAccount;
  let coupleId: string;
  let aliceDeviceId: string;
  let bobDeviceId: string;

  beforeEach(async () => {
    bob = createMemoryAccount(server, 'f0000000-0000-4000-8000-000000000002');
    aliceDeviceId = (await bootstrapAccount(alice)).result.deviceId;
    bobDeviceId = (await bootstrapAccount(bob)).result.deviceId;
    coupleId = linkCouple(server, alice.userId, bob.userId);
  });

  it('creates a CSK reaching every device AND both recovery identities', async () => {
    const ceremony = await pairAccounts(alice, bob, aliceDeviceId, bobDeviceId, coupleId);

    const created = await completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: ceremony.sideB,
      ownConfirmation: ceremony.confirmationA,
      partnerConfirmation: ceremony.confirmationB,
      senderDeviceId: aliceDeviceId,
      expiresAtMs: BigInt(server.now() + 600_000),
    });

    expect(created.recipients.devices).toBe(2);
    expect(created.recipients.recoveryIdentities).toBe(2);

    const identityA = server.recoveryIdentities.find((r) => r.userId === alice.userId)!;
    const identityB = server.recoveryIdentities.find((r) => r.userId === bob.userId)!;
    const recipients = envelopeRecipients(server, created.scopeKeyId);

    expect(recipients).toContain(aliceDeviceId);
    expect(recipients).toContain(bobDeviceId);
    // The recovery recipients are the whole point: without them the first
    // partner to lose every device loses the shared history permanently.
    expect(recipients).toContain(identityA.id);
    expect(recipients).toContain(identityB.id);
    expect(recipients).toHaveLength(4);

    const scope = server.scopeKeys.find((k) => k.id === created.scopeKeyId)!;
    expect(scope.state).toBe('ACTIVE');
    expect(scope.ownerCoupleId).toBe(coupleId);
    expect(scope.ownerUserId).toBeNull();
    expect(server.pairings[0].state).toBe('CRYPTO_ACTIVE');
    const canonicalOwner = [alice.userId, bob.userId].sort()[0];
    const authority = await alice.localState.loadCoupleAuthority(coupleId);
    expect(authority?.state).toBe('CRYPTO_ACTIVE');
    expect(authority?.lowUserId).toBe(canonicalOwner);
    expect(authority?.highUserId).toBe([alice.userId, bob.userId].sort()[1]);
    await expect(alice.localState.pinCoupleAuthority({
      ...authority!,
      highUserId: crypto.randomUUID(),
    })).rejects.toThrow(/E_COUPLE_AUTHORITY_PINNED/);
    for (const envelope of server.envelopes.filter((entry) => entry.scopeKeyId === scope.id)) {
      expect(bytesToUuid(decodeHeader(splitEnvelope(envelope.envelope).header).ownerUserId)).toBe(canonicalOwner);
    }
    await markCoupleAuthorityUnlinked(alice.devices[0].deps, coupleId);
    expect((await alice.localState.loadCoupleAuthority(coupleId))?.state).toBe('UNLINKED');
    await expect(alice.localState.pinCoupleAuthority({ ...authority!, state: 'CRYPTO_ACTIVE' }))
      .rejects.toThrow(/E_COUPLE_AUTHORITY_STATE/);
  });

  it('does not mark local authority active when the confirmed server pairing disappears', async () => {
    const ceremony = await pairAccounts(alice, bob, aliceDeviceId, bobDeviceId, coupleId);
    server.pairings.length = 0;

    await expect(completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: ceremony.sideB,
      ownConfirmation: ceremony.confirmationA,
      partnerConfirmation: ceremony.confirmationB,
      senderDeviceId: aliceDeviceId,
      expiresAtMs: BigInt(server.now() + 600_000),
    })).rejects.toThrow(/E_PAIRING_NOT_FOUND/);

    expect((await alice.localState.loadCoupleAuthority(coupleId))?.state).not.toBe('CRYPTO_ACTIVE');
  });

  it('activates the couple write floor from the session once a real CSK exists', async () => {
    const ceremony = await pairAccounts(alice, bob, aliceDeviceId, bobDeviceId, coupleId);
    await completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: ceremony.sideB,
      ownConfirmation: ceremony.confirmationA,
      partnerConfirmation: ceremony.confirmationB,
      senderDeviceId: aliceDeviceId,
      expiresAtMs: BigInt(server.now() + 600_000),
    });

    const keyPort = {
      load: async () => null,
      loadOrCreate: async (binding: {
        installationId: string; userId: string; deviceId: string; purpose: string; version: number;
      }) => ({
        binding,
        has: async () => true,
        seal: async () => ({ nonce: new Uint8Array(12), ciphertext: new Uint8Array() }),
        open: async () => new Uint8Array(),
        delete: async () => {},
      }),
    };

    // This is the defect QUEUE 1B closes: before this, a real paired couple could
    // keep writing shared records below their floor because nothing in the
    // product flow ever activated it.
    const installed = await installE2eeRuntimeForSession({
      userId: alice.userId,
      repository: alice.devices[0].deps.repository,
      localState: alice.localState,
      deviceKeys: alice.devices[0].deviceKeys,
      localKeys: keyPort,
      installationId: 'flows-session',
      activeCoupleId: coupleId,
    });

    expect(installed).toMatchObject({ status: 'installed', coupleProtection: 'activated' });
    expect(server.writeFloors.get(`couple:${coupleId}`)).toBe(1);
    clearE2eeRuntime();
  });

  it('creates no CSK at all without both confirmations', async () => {
    const ceremony = await pairAccounts(alice, bob, aliceDeviceId, bobDeviceId, coupleId);
    const before = server.scopeKeys.filter((k) => k.domain === 'couple').length;

    await expect(completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: ceremony.sideB,
      ownConfirmation: ceremony.confirmationA,
      // The partner's "confirmation" is 64 bytes of noise.
      partnerConfirmation: { deviceId: bobDeviceId, signature: randomBytes(64) },
      senderDeviceId: aliceDeviceId,
      expiresAtMs: BigInt(server.now() + 600_000),
    })).rejects.toThrow(/E_PAIRING_NOT_CONFIRMED/);

    expect(server.scopeKeys.filter((k) => k.domain === 'couple')).toHaveLength(before);
  });

  it('refuses a partner anchor the confirmed transcript did not name', async () => {
    const ceremony = await pairAccounts(alice, bob, aliceDeviceId, bobDeviceId, coupleId);
    const forged = { ...ceremony.sideB, rootRecSigPubFp: new Uint8Array(32).fill(9) };

    await expect(completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: forged,
      ownConfirmation: ceremony.confirmationA,
      partnerConfirmation: ceremony.confirmationB,
      senderDeviceId: aliceDeviceId,
      expiresAtMs: BigInt(server.now() + 600_000),
    })).rejects.toThrow(/E_PARTNER_ANCHOR_MISMATCH/);
  });

  it('rejects a server-added third member before and after lifecycle tampering', async () => {
    const ceremony = await pairAccounts(alice, bob, aliceDeviceId, bobDeviceId, coupleId);
    await completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: ceremony.sideB,
      ownConfirmation: ceremony.confirmationA,
      partnerConfirmation: ceremony.confirmationB,
      senderDeviceId: aliceDeviceId,
      expiresAtMs: BigInt(server.now() + 600_000),
    });
    const charlie = createMemoryAccount(server);
    const charlieBoot = await bootstrapAccount(charlie);
    await alice.localState.pinTrustAnchor(charlie.userId, (await charlie.localState.loadTrustAnchor(charlie.userId))!);
    const scope = activeScope(server, 'couple', coupleId)!;
    const charlieDevice = server.devices.find((device) => device.id === charlieBoot.result.deviceId)!;
    const aliceDevice = server.devices.find((device) => device.id === aliceDeviceId)!;
    const charlieCertificate = server.certificates.find((certificate) => certificate.subjectDeviceId === charlieBoot.result.deviceId)!;
    const forged = await sealScopeKeyForRecipient({
      scopeKey: randomBytes(32),
      recipientKemSpki: aliceDevice.kemSpki,
      recipientId: uuidToBytes(aliceDeviceId),
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: uuidToBytes(charlieBoot.result.deviceId),
      senderSigSpki: charlieDevice.sigSpki,
      sign: (message) => charlie.devices[0].deviceKeys.sign(`dev_sig:${charlieBoot.result.deviceId}`, message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: {
        domain: KEY_DOMAIN.couple,
        scopeKeyId: uuidToBytes(scope.id),
        ownerUserId: uuidToBytes([alice.userId, bob.userId].sort()[0]),
        scopeId: uuidToBytes(coupleId),
        epoch: scope.epoch,
      },
      nowMs: BigInt(server.now()),
    });
    server.envelopes = server.envelopes.filter(
      (envelope) => !(envelope.scopeKeyId === scope.id && envelope.recipientId === aliceDeviceId),
    );
    server.envelopes.push({
      scopeKeyId: scope.id,
      recipientKind: 'device',
      recipientId: aliceDeviceId,
      senderDeviceId: charlieBoot.result.deviceId,
      senderCertificateId: charlieCertificate.id,
      envelope: forged,
      selfNotarized: false,
    });
    const environment = await createVerifiedRecordCryptoEnvironment({
      userId: alice.userId,
      deviceId: aliceDeviceId,
      repository: alice.devices[0].deps.repository,
      localState: alice.localState,
      deviceKeys: alice.devices[0].deviceKeys,
      now: () => server.now(),
    });
    server.activeMembers.set(coupleId, [alice.userId, bob.userId, charlie.userId]);
    await expect(environment.scopeKeyFor('couple', coupleId, scope.epoch))
      .rejects.toMatchObject({ code: 'E_COUPLE_LIFECYCLE_INVALID' });
    server.activeMembers.set(coupleId, [alice.userId, bob.userId]);
    await expect(environment.scopeKeyFor('couple', coupleId, scope.epoch))
      .rejects.toMatchObject({ code: 'E_SCOPE_SENDER_UNAUTHORIZED' });
  });
});

// ---------------------------------------------------------------------------
// Scenario D — revoke and rotate
// ---------------------------------------------------------------------------

describe('Scenario D — revocation executes rotation', () => {
  let bob: MemoryAccount;
  let coupleId: string;
  /** The account's root device: its certificate is issued by the recovery key. */
  let rootDevice: string;
  /** A device the root device enrolled, so its chain runs through the root. */
  let enrolledDevice: string;
  let bobDeviceId: string;
  let enrolledEnv: DeviceEnvironment;

  beforeEach(async () => {
    bob = createMemoryAccount(server, 'f0000000-0000-4000-8000-000000000002');
    rootDevice = (await bootstrapAccount(alice)).result.deviceId;
    bobDeviceId = (await bootstrapAccount(bob)).result.deviceId;
    coupleId = linkCouple(server, alice.userId, bob.userId);

    enrolledEnv = alice.addDevice();
    const begun = await beginSecondDeviceEnrollment(enrolledEnv.deps, {
      userId: alice.userId, platform: 'ios', approverDeviceId: rootDevice,
    });
    enrolledDevice = begun.deviceId;
    const onNew = await confirmSecondDeviceEnrollment(enrolledEnv.deps, {
      userId: alice.userId, enrollNonce: begun.enrollNonce, approverDeviceId: rootDevice,
    });
    await approveSecondDeviceEnrollment(alice.devices[0].deps, {
      userId: alice.userId,
      enrollNonce: begun.enrollNonce,
      approverDeviceId: rootDevice,
      subjectPop: onNew.subjectPop,
      humanConfirmedSas: true,
    });
    await completeSecondDeviceProvisioning(alice.devices[0].deps, {
      userId: alice.userId, newDeviceId: enrolledDevice, provisioningDeviceId: rootDevice,
    });

    const ceremony = await pairAccounts(alice, bob, rootDevice, bobDeviceId, coupleId);
    await completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: ceremony.sideB,
      ownConfirmation: ceremony.confirmationA,
      partnerConfirmation: ceremony.confirmationB,
      senderDeviceId: rootDevice,
      expiresAtMs: BigInt(server.now() + 600_000),
    });
  });

  it('revokes a device and actually rotates PMK, HRK and the CSK', async () => {
    const beforePersonal = activeScope(server, 'personal', alice.userId)!;
    const beforeHealth = activeScope(server, 'health', alice.userId)!;
    const beforeCouple = activeScope(server, 'couple', coupleId)!;
    // The revoked device really did hold all three.
    expect(envelopeRecipients(server, beforePersonal.id)).toContain(enrolledDevice);
    expect(envelopeRecipients(server, beforeCouple.id)).toContain(enrolledDevice);

    const outcome = await revokeDeviceAndRotate(alice.devices[0].deps, {
      userId: alice.userId,
      revokedDeviceId: enrolledDevice,
      revokerDeviceId: rootDevice,
      // A plain "I lost it": the default must be the safe one.
      userConfirmedSecureErase: false,
      coupleId,
    });

    expect(outcome.reason).toBe('potentiallyCompromised');
    expect(outcome.rotated.map((r) => r.domain).sort()).toEqual(['couple', 'health', 'personal']);

    // New epochs, and the old ones RETIRED rather than deleted.
    const afterPersonal = activeScope(server, 'personal', alice.userId)!;
    const afterHealth = activeScope(server, 'health', alice.userId)!;
    const afterCouple = activeScope(server, 'couple', coupleId)!;
    expect(afterPersonal.id).not.toBe(beforePersonal.id);
    expect(afterPersonal.epoch).toBe(beforePersonal.epoch + 1n);
    expect(afterHealth.epoch).toBe(beforeHealth.epoch + 1n);
    expect(afterCouple.epoch).toBe(beforeCouple.epoch + 1n);
    expect(server.scopeKeys.find((k) => k.id === beforePersonal.id)!.state).toBe('RETIRED');
    expect(server.scopeKeys.find((k) => k.id === beforeHealth.id)!.state).toBe('RETIRED');
    expect(server.scopeKeys.find((k) => k.id === beforeCouple.id)!.state).toBe('RETIRED');

    // The revoked device receives nothing in any new epoch.
    for (const scope of [afterPersonal, afterHealth, afterCouple]) {
      expect(envelopeRecipients(server, scope.id)).not.toContain(enrolledDevice);
    }
    // The surviving device, the partner's device and BOTH recovery identities do.
    const identityA = server.recoveryIdentities.find((r) => r.userId === alice.userId)!;
    const identityB = server.recoveryIdentities.find((r) => r.userId === bob.userId)!;
    expect(envelopeRecipients(server, afterPersonal.id)).toEqual([rootDevice, identityA.id].sort());
    const coupleRecipients = envelopeRecipients(server, afterCouple.id);
    expect(coupleRecipients).toContain(rootDevice);
    expect(coupleRecipients).toContain(bobDeviceId);
    expect(coupleRecipients).toContain(identityA.id);
    expect(coupleRecipients).toContain(identityB.id);
    expect(coupleRecipients).not.toContain(enrolledDevice);

    // The statement is persisted and signed.
    expect(server.revocations).toHaveLength(1);
    expect(server.revocations[0].revokedDeviceId).toBe(enrolledDevice);
    expect(server.revocations[0].signature).toHaveLength(64);
    expect(server.revocations[0].statement).toHaveLength(203);
    expect(server.devices.find((d) => d.id === enrolledDevice)!.status).toBe('REVOKED');
  });

  it('a persisted revocation excludes a still-certified device from recipient selection', async () => {
    const before = await eligibleRecipients(alice.devices[0].deps, {
      userId: alice.userId, domain: 'personal',
    });
    expect(before.map((r) => r.deviceId).sort()).toEqual([rootDevice, enrolledDevice].sort());

    await revokeDeviceAndRotate(alice.devices[0].deps, {
      userId: alice.userId,
      revokedDeviceId: enrolledDevice,
      revokerDeviceId: rootDevice,
      userConfirmedSecureErase: false,
      coupleId,
    });

    // Same certificate, same chain, same pinned root — nothing about the
    // certificate changed. The persisted signed revocation, loaded and verified
    // inside the use case, is the only thing removing it.
    const after = await eligibleRecipients(alice.devices[0].deps, {
      userId: alice.userId, domain: 'personal',
    });
    expect(after.map((r) => r.deviceId)).toEqual([rootDevice]);
    expect(server.certificates.some((c) => c.subjectDeviceId === enrolledDevice)).toBe(true);
  });

  it('an affirmed secure erase on hardware-backed storage skips rotation', async () => {
    const before = activeScope(server, 'personal', alice.userId)!;
    const outcome = await revokeDeviceAndRotate(alice.devices[0].deps, {
      userId: alice.userId,
      revokedDeviceId: enrolledDevice,
      revokerDeviceId: rootDevice,
      userConfirmedSecureErase: true,
      coupleId,
    });
    expect(outcome.reason).toBe('lostSecured');
    expect(outcome.rotated).toEqual([]);
    expect(activeScope(server, 'personal', alice.userId)!.id).toBe(before.id);
  });

  it('refuses, before writing anything, a revocation that would strand the account', async () => {
    // Revoking the ISSUING device also distrusts what it certified, because a
    // chain containing a revoked link does not verify. Rotating in that state
    // would build an epoch only the kit could open.
    await expect(revokeDeviceAndRotate(enrolledEnv.deps, {
      userId: alice.userId,
      revokedDeviceId: rootDevice,
      revokerDeviceId: enrolledDevice,
      userConfirmedSecureErase: false,
      coupleId,
    })).rejects.toThrow(/E_REVOCATION_WOULD_STRAND_ACCOUNT/);

    // Nothing persisted, nothing rotated, nothing retired.
    expect(server.revocations).toHaveLength(0);
    expect(server.devices.find((d) => d.id === rootDevice)!.status).toBe('ACTIVE');
    expect(server.scopeKeys.filter((k) => k.domain === 'personal' && k.scopeId === alice.userId))
      .toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario E — recovery with the kit
// ---------------------------------------------------------------------------

describe('Scenario E — kit recovery onto a new device', () => {
  it('reaches ACTIVE only at the end, with a new certificate and completed rotations', async () => {
    const bootstrapped = await bootstrapAccount(alice);
    const beforePersonal = activeScope(server, 'personal', alice.userId)!;
    const beforeHealth = activeScope(server, 'health', alice.userId)!;

    // A brand-new physical device: fresh key store, no local state of its own
    // beyond the account's.
    const a3 = createDeviceEnvironment({
      server, userId: alice.userId, localState: alice.localState,
    });

    const recovered = await recoverWithKit(a3.deps, {
      userId: alice.userId,
      platform: 'ios',
      recoveryCode: bootstrapped.result.recoveryCode,
      kitAnchor: bootstrapped.result.kitAnchor,
    });

    expect(recovered.state).toBe('ACTIVE');
    expect(server.devices.find((d) => d.id === recovered.deviceId)!.status).toBe('ACTIVE');
    // A recovered device must remain installable after the recovery function
    // returns. Runtime discovery uses protected local bootstrap state rather
    // than a server-status shortcut.
    expect(alice.localState.bootstraps.get(alice.userId)).toMatchObject({
      state: 'COMPLETE',
      deviceId: recovered.deviceId,
      recoverySecret: null,
      recoveryCode: null,
    });

    // A new certificate, rooted at the recovery identity.
    const certificate = server.certificates.find((c) => c.subjectDeviceId === recovered.deviceId)!;
    expect(certificate).toBeDefined();
    expect(certificate.recoveryPublicAnchorId).not.toBeNull();
    expect(certificate.issuerCertificateId).toBeNull();

    // It recovered both scopes through the recovery envelopes...
    expect(recovered.recoveredScopes.map((s) => s.domain).sort()).toEqual(['health', 'personal']);
    // ...superseded the old device...
    expect(recovered.supersededDevices).toEqual([bootstrapped.result.deviceId]);
    expect(server.devices.find((d) => d.id === bootstrapped.result.deviceId)!.status).toBe('REVOKED');
    // ...and rotated everything, for real.
    expect(recovered.rotatedScopes.map((s) => s.domain).sort()).toEqual(['health', 'personal']);

    const afterPersonal = activeScope(server, 'personal', alice.userId)!;
    const afterHealth = activeScope(server, 'health', alice.userId)!;
    expect(afterPersonal.epoch).toBe(beforePersonal.epoch + 1n);
    expect(afterHealth.epoch).toBe(beforeHealth.epoch + 1n);
    expect(server.scopeKeys.find((k) => k.id === beforePersonal.id)!.state).toBe('RETIRED');

    // The new epochs reach the recovered device and the recovery identity, and
    // never the superseded one.
    const identity = server.recoveryIdentities[0];
    expect(envelopeRecipients(server, afterPersonal.id))
      .toEqual([recovered.deviceId, identity.id].sort());
    expect(envelopeRecipients(server, afterPersonal.id))
      .not.toContain(bootstrapped.result.deviceId);
  });

  it('a wrong kit recovers nothing and leaves the device non-ACTIVE', async () => {
    const aliceKit = await bootstrapAccount(alice);
    const other = createMemoryAccount(createMemoryServer());
    const otherServer = createMemoryServer();
    const otherAccount = createMemoryAccount(otherServer);
    const foreignKit = await bootstrapFirstDevice(
      otherAccount.devices[0].deps, { userId: otherAccount.userId, platform: 'ios' },
    );
    expect(other).toBeDefined();

    const a3 = createDeviceEnvironment({
      server, userId: alice.userId, localState: alice.localState,
    });
    await expect(recoverWithKit(a3.deps, {
      userId: alice.userId,
      platform: 'ios',
      recoveryCode: foreignKit.recoveryCode,
      // Alice's own anchor, deliberately: the anchor gate therefore passes and
      // the AEAD is what rejects the foreign secret. Reaching the AEAD at all is
      // the point — a foreign SECRET must fail even when the anchor is right.
      kitAnchor: aliceKit.result.kitAnchor,
    })).rejects.toThrow(/E_KIT_MISMATCH/);

    // Nothing was created and nothing was rotated: an authenticated session plus
    // a full database dump is still not enough without the kit.
    expect(server.devices).toHaveLength(1);
    expect(server.devices.every((d) => d.status !== 'PROVISIONING')).toBe(true);
    expect(server.scopeKeys.filter((k) => k.domain === 'personal')).toHaveLength(1);
    expect(server.challenges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario F — partner-assisted recovery
// ---------------------------------------------------------------------------

describe('Scenario F — partner assist is CSK-only', () => {
  let bob: MemoryAccount;
  let coupleId: string;
  let aliceDeviceId: string;
  let bobDeviceId: string;

  beforeEach(async () => {
    bob = createMemoryAccount(server, 'f0000000-0000-4000-8000-000000000002');
    aliceDeviceId = (await bootstrapAccount(alice)).result.deviceId;
    bobDeviceId = (await bootstrapAccount(bob)).result.deviceId;
    coupleId = linkCouple(server, alice.userId, bob.userId);

    const ceremony = await pairAccounts(alice, bob, aliceDeviceId, bobDeviceId, coupleId);
    await completeCouplePairing(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      transcriptHash: ceremony.proposed.transcriptHash,
      ownSide: ceremony.sideA,
      partnerSide: ceremony.sideB,
      ownConfirmation: ceremony.confirmationA,
      partnerConfirmation: ceremony.confirmationB,
      senderDeviceId: aliceDeviceId,
      expiresAtMs: BigInt(server.now() + 600_000),
    });
    // Bob's device pins Alice's anchor too, which the confirmed SAS authorizes.
    await bob.localState.pinTrustAnchor(alice.userId, {
      ...(await alice.localState.loadTrustAnchor(alice.userId))!,
    });
    await alice.localState.pinTrustAnchor(bob.userId, {
      ...(await alice.localState.loadTrustAnchor(bob.userId))!,
    });
  });

  it('hands the couple key to the partner replacement device after a fresh SAS', async () => {
    // Bob loses his device and recovers with his own kit, producing a fresh
    // certified device that holds no couple envelope.
    const bobKit = server.recoveryIdentities.find((r) => r.userId === bob.userId)!;
    expect(bobKit).toBeDefined();

    const replacement = bob.addDevice();
    const begun = await beginSecondDeviceEnrollment(replacement.deps, {
      userId: bob.userId, platform: 'ios', approverDeviceId: bobDeviceId,
    });
    const onNew = await confirmSecondDeviceEnrollment(replacement.deps, {
      userId: bob.userId, enrollNonce: begun.enrollNonce, approverDeviceId: bobDeviceId,
    });
    await approveSecondDeviceEnrollment(bob.devices[0].deps, {
      userId: bob.userId,
      enrollNonce: begun.enrollNonce,
      approverDeviceId: bobDeviceId,
      subjectPop: onNew.subjectPop,
      humanConfirmedSas: true,
    });

    const couple = activeScope(server, 'couple', coupleId)!;
    expect(envelopeRecipients(server, couple.id)).not.toContain(begun.deviceId);

    const assistNonce = randomBytes(32);
    const issuedAtMs = BigInt(server.now());
    const expiresAtMs = issuedAtMs + 300_000n;

    const ceremony = await partnerAssistCeremony(alice.devices[0].deps, {
      coupleId,
      assistingUserId: alice.userId,
      assistingDeviceId: aliceDeviceId,
      targetUserId: bob.userId,
      targetDeviceId: begun.deviceId,
      assistNonce,
      issuedAtMs,
      expiresAtMs,
    });
    expect(ceremony.sas).toMatch(/^\d{3}(-\d{3}){5}$/);

    const confirmation = await replacement.deviceKeys.sign(
      `dev_sig:${begun.deviceId}`,
      partnerAssistConfirmMessage(ceremony.transcriptHash, uuidToBytes(begun.deviceId)),
    );

    // A stale confirmation over a different nonce does not authorize anything.
    await expect(partnerAssistRecoverCouple(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      targetDeviceId: begun.deviceId,
      assistingDeviceId: aliceDeviceId,
      assistNonce: randomBytes(32),
      issuedAtMs,
      expiresAtMs,
      targetSasConfirmation: confirmation,
      humanConfirmedSas: true,
    })).rejects.toThrow(/E_BAD_ASSIST_CONFIRMATION/);

    // Nor does skipping the human comparison.
    await expect(partnerAssistRecoverCouple(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      targetDeviceId: begun.deviceId,
      assistingDeviceId: aliceDeviceId,
      assistNonce,
      issuedAtMs,
      expiresAtMs,
      targetSasConfirmation: confirmation,
      humanConfirmedSas: false,
    })).rejects.toThrow(/E_SAS_NOT_CONFIRMED/);

    const assisted = await partnerAssistRecoverCouple(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      targetDeviceId: begun.deviceId,
      assistingDeviceId: aliceDeviceId,
      assistNonce,
      issuedAtMs,
      expiresAtMs,
      targetSasConfirmation: confirmation,
      humanConfirmedSas: true,
    });
    expect(assisted.scopeKeyId).toBe(couple.id);
    expect(envelopeRecipients(server, couple.id)).toContain(begun.deviceId);

    // And ONLY the couple key moved. No personal or health envelope was written
    // for the partner's device by any path.
    const personalScopes = server.scopeKeys.filter(
      (k) => k.domain === 'personal' || k.domain === 'health',
    );
    for (const scope of personalScopes) {
      expect(envelopeRecipients(server, scope.id)).not.toContain(begun.deviceId);
    }
  });

  it('exposes no domain parameter, so PMK and HRK are unreachable by construction', () => {
    const source = partnerAssistRecoverCouple.toString();
    // There is no `recover(domain)` and no domain input anywhere in the flow.
    expect(source).not.toMatch(/input\.domain/);
    expect(source).not.toMatch(/domain:\s*input\./);
    expect(source).toMatch(/listScopeKeys\(["']couple["']/);
    // Personal and health are named nowhere in this use case, so there is no
    // expression the caller could steer toward them.
    expect(source).not.toMatch(/["']personal["']/);
    expect(source).not.toMatch(/["']health["']/);
  });

  it('refuses an expired partner-assist window', async () => {
    const stale = BigInt(server.now() - 1_000_000);
    await expect(partnerAssistRecoverCouple(alice.devices[0].deps, {
      coupleId,
      ownUserId: alice.userId,
      partnerUserId: bob.userId,
      targetDeviceId: bobDeviceId,
      assistingDeviceId: aliceDeviceId,
      assistNonce: randomBytes(32),
      issuedAtMs: stale - 300_000n,
      expiresAtMs: stale,
      targetSasConfirmation: randomBytes(64),
      humanConfirmedSas: true,
    })).rejects.toThrow(/E_ASSIST_EXPIRED/);
  });
});
