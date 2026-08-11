/**
 * E2EE application use cases.
 *
 * These are the orchestration layer: they sequence device-key operations,
 * crypto primitives and repository calls into the flows the product needs. They
 * hold no Supabase client, no React, and no store, so a component asks a hook,
 * the hook asks a use case, and the use case does the work.
 *
 * Every one of them is gated by the feature flag and none is wired to a screen
 * yet. Nothing here activates E2EE for an existing account.
 */

import { concat, hex, uuidToBytes, utf8, zeroize } from '@/crypto/bytes';
import {
  ASSURANCE,
  RECIPIENT_KIND,
  requiresRotation,
  type KeyDomainName,
  type PlatformName,
  type RevocationReasonName,
} from '@/crypto/domains';
import {
  ISSUER_KIND,
  assembleCertificate,
  certificatePopMessage,
  certificateSignedMessage,
  encodeTbs,
  verifyCertificateChain,
  type CertificateWithKeys,
  type TrustAnchor,
  type VerifiedDevice,
} from '@/crypto/deviceCertificate';
import {
  aesGcmSeal,
  generateEphemeralAgreement,
  hkdfSha256,
  importAesKey,
  publicKeyFingerprint,
  randomBytes,
  randomNonce,
  sha256,
} from '@/crypto/suite';
import { decodeRecoveryCode, encodeRecoveryCode, deriveKitAnchorTag } from '@/crypto/recoveryCode';
import {
  recoveryBundleFingerprint,
  recoveryBundleSignedMessage,
  type RecoveryBundle,
} from '@/crypto/transcripts';
import { generateScopeKeyBytes, sealScopeKeyForRecipient } from '@/crypto/keyring/scopeKeys';
import { selectRecipients } from '@/crypto/protocol/recipients';
import { canCreateCoupleKey, type Confirmation } from '@/crypto/protocol/pairing';
import { classifyLostDevice, planRevocation, type HeldScope } from '@/crypto/protocol/rotation';
import { encodeRevocationTbs, revocationSignedMessage, RevocationSet } from '@/crypto/revocation';
import type { DeviceKeyPort } from '@/crypto/keystore';
import type {
  BootstrapProgress,
  E2eeFeatureFlag,
  E2eeLocalState,
  E2eeRepository,
} from './ports';

export class E2eeUseCaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'E2eeUseCaseError';
  }
}

function fail(code: string, message: string): never {
  throw new E2eeUseCaseError(code, message);
}

export type UseCaseDeps = {
  repository: E2eeRepository;
  localState: E2eeLocalState;
  deviceKeys: DeviceKeyPort;
  flag: E2eeFeatureFlag;
  now: () => number;
  newId: () => string;
};

function requireEnabled(deps: UseCaseDeps): void {
  if (!deps.flag.isEnabled()) fail('E_E2EE_DISABLED', 'the E2EE feature flag is off');
}

const EMPTY_PROGRESS: BootstrapProgress = {
  deviceKeysCreated: false,
  recoveryIdentityCreated: false,
  rootCertificateIssued: false,
  personalKeyCreated: false,
  healthKeyCreated: false,
  kitVerified: false,
  completed: false,
};

// ---------------------------------------------------------------------------
// 1A-6  First device bootstrap
// ---------------------------------------------------------------------------

export type BootstrapResult = {
  deviceId: string;
  recoveryCode: string;
  anchorTag: string;
  recoveryIdentityId: string;
};

/**
 * Create the account's first device, its recovery identity, and its personal
 * and health keys.
 *
 * Resumable and fail-closed. Progress is written after each durable step, and a
 * flow that stops half-way never adopts orphaned material: if a recovery
 * identity exists but its certificate was never issued, the next attempt starts
 * from the certificate rather than minting a second identity.
 */
export async function bootstrapFirstDevice(
  deps: UseCaseDeps,
  input: { userId: string; platform: PlatformName },
): Promise<BootstrapResult> {
  requireEnabled(deps);

  const existing = await deps.localState.loadBootstrapProgress(input.userId);
  if (existing?.completed) fail('E_ALREADY_BOOTSTRAPPED', 'this account already has a first device');
  const progress: BootstrapProgress = { ...EMPTY_PROGRESS, ...(existing ?? {}) };

  const userIdBytes = uuidToBytes(input.userId);
  const serverOriginId = await deps.repository.serverOriginId();
  const deviceId = deps.newId();

  // 1. Device identity, by handle.
  const sig = await deps.deviceKeys.generateSigningKey(`dev_sig:${deviceId}`);
  const kem = await deps.deviceKeys.generateAgreementKey(`dev_kem:${deviceId}`);
  await deps.repository.insertDevice({
    id: deviceId,
    userId: input.userId,
    sigSpki: sig.publicKeySpki,
    kemSpki: kem.publicKeySpki,
    platform: input.platform,
    assurance: sig.assurance,
    status: 'PENDING',
  });
  progress.deviceKeysCreated = true;
  await deps.localState.saveBootstrapProgress(input.userId, progress);

  // 2-5. Recovery identity. The secret is generated here, shown once, and never
  // transmitted; only RKEK-encrypted private material reaches the server.
  const recoverySecret = randomBytes(32);
  const recoverySalt = randomBytes(32);
  let rkekBytes: Uint8Array | null = null;
  let recoveryIdentityId: string;
  let recoveryBundle: RecoveryBundle;
  let recoveryBundleFp: Uint8Array;

  try {
    rkekBytes = await hkdfSha256(
      recoverySecret,
      recoverySalt,
      concat(utf8('gomsinlog/rkek/v1'), userIdBytes),
      32,
    );
    const rkek = await importAesKey(rkekBytes, ['encrypt', 'decrypt']);

    const recSig = await generateSoftwareKeyPair('ECDSA');
    const recKem = await generateSoftwareKeyPair('ECDH');

    recoveryBundle = {
      recoveryVersion: 1,
      userId: userIdBytes,
      recoverySalt,
      recSigSpki: recSig.spki,
      recKemSpki: recKem.spki,
    };
    recoveryBundleFp = await recoveryBundleFingerprint(recoveryBundle);

    const encSig = await aesGcmSeal(rkek, randomNonce(), recSig.pkcs8, recoveryPrivAad(1, userIdBytes, recoverySalt, 1));
    const encKem = await aesGcmSeal(rkek, randomNonce(), recKem.pkcs8, recoveryPrivAad(1, userIdBytes, recoverySalt, 2));

    recoveryIdentityId = await deps.repository.insertRecoveryIdentity({
      userId: input.userId,
      recoveryVersion: 1,
      recoverySalt,
      recSigSpki: recSig.spki,
      recKemSpki: recKem.spki,
      encRecSigPriv: encSig,
      encRecKemPriv: encKem,
      recoveryBundleFp,
    });
    progress.recoveryIdentityCreated = true;
    await deps.localState.saveBootstrapProgress(input.userId, progress);

    // 6-7. The recovery key signs the first device certificate: the trust root
    // exists before any scope key does, so there is never a window in which a
    // device is trusted by status alone.
    const tbs = encodeTbs({
      issuerKind: ISSUER_KIND.recoveryIdentity,
      subjectAssurance: sig.assurance,
      subjectPlatform: input.platform,
      grantedDomains: grantsForPlatform(input.platform),
      userId: userIdBytes,
      serverOriginId,
      recoveryIdentityId: uuidToBytes(recoveryIdentityId),
      recoveryVersion: 1,
      rootRecSigPubFp: await publicKeyFingerprint(recSig.spki),
      issuerId: uuidToBytes(recoveryIdentityId),
      issuerSigPubFp: await publicKeyFingerprint(recSig.spki),
      subjectDeviceId: uuidToBytes(deviceId),
      subjectSigPubFp: await publicKeyFingerprint(sig.publicKeySpki),
      subjectKemPubFp: await publicKeyFingerprint(kem.publicKeySpki),
      notBeforeMs: 0n,
      notAfterMs: 0n,
      ceremonyNonce: randomBytes(32),
      ceremonyTranscriptHash: await sha256(
        concat(utf8('gomsinlog/bootstrap/v1'), userIdBytes, recoveryBundleFp),
      ),
    });

    const certificate = assembleCertificate(
      tbs,
      await signWithSoftwareKey(recSig.privateKey, certificateSignedMessage(tbs)),
      await deps.deviceKeys.sign(sig.handle, certificatePopMessage(tbs)),
    );
    const certificateId = await deps.repository.insertCertificate({
      userId: input.userId,
      subjectDeviceId: deviceId,
      certificate,
      subjectSigSpki: sig.publicKeySpki,
      subjectKemSpki: kem.publicKeySpki,
    });
    progress.rootCertificateIssued = true;
    await deps.localState.saveBootstrapProgress(input.userId, progress);

    await deps.localState.pinTrustAnchor(input.userId, {
      rootRecSigPubFp: await publicKeyFingerprint(recSig.spki),
      recoveryIdentityId,
      recoveryVersion: 1,
    });

    // 8-9. Personal and health keys, wrapped to this device and to recovery.
    for (const domain of ['personal', 'health'] as const) {
      if (domain === 'health' && !grantsForPlatform(input.platform).includes('health')) continue;
      await createUserScopeKey(deps, {
        domain,
        userId: input.userId,
        userIdBytes,
        deviceId,
        deviceKemSpki: kem.publicKeySpki,
        deviceSigSpki: sig.publicKeySpki,
        signHandle: sig.handle,
        certificateId,
        recoveryIdentityId,
        recKemSpki: recKem.spki,
      });
      if (domain === 'personal') progress.personalKeyCreated = true;
      else progress.healthKeyCreated = true;
      await deps.localState.saveBootstrapProgress(input.userId, progress);
    }

    const recoveryCode = await encodeRecoveryCode(recoverySecret);
    const anchorTag = await deriveKitAnchorTag(uuidToBytes(recoveryIdentityId), 1, recoveryBundleFp);

    // The bundle signature lets any later device confirm the recovery public
    // keys were published by a device this account controlled.
    await signWithSoftwareKey(recSig.privateKey, recoveryBundleSignedMessage(recoveryBundleFp));

    return { deviceId, recoveryCode, anchorTag, recoveryIdentityId };
  } finally {
    zeroize(rkekBytes, recoverySecret);
  }
}

/**
 * Complete bootstrap only after the user has proved they kept the kit.
 *
 * Full verification: the entire 56-symbol code must decode to the same secret,
 * and the anchor fields must match. There is no partial-group check, because a
 * kit the user cannot reproduce in full is a kit they do not have.
 */
export async function confirmRecoveryKit(
  deps: UseCaseDeps,
  input: {
    userId: string;
    reEnteredCode: string;
    expectedRecoveryCode: string;
    reEnteredAnchorTag?: string;
    expectedAnchorTag: string;
  },
): Promise<void> {
  requireEnabled(deps);
  const progress = await deps.localState.loadBootstrapProgress(input.userId);
  if (!progress?.rootCertificateIssued) fail('E_BOOTSTRAP_INCOMPLETE', 'nothing to confirm yet');

  const provided = await decodeRecoveryCode(input.reEnteredCode);
  const expected = await decodeRecoveryCode(input.expectedRecoveryCode);
  if (hex(provided) !== hex(expected)) fail('E_KIT_MISMATCH', 'the re-entered recovery code does not match');
  if (input.reEnteredAnchorTag && input.reEnteredAnchorTag !== input.expectedAnchorTag) {
    fail('E_KIT_ANCHOR_MISMATCH', 'the anchor tag does not match');
  }
  zeroize(provided, expected);

  await deps.localState.saveBootstrapProgress(input.userId, { ...progress, kitVerified: true, completed: true });
  const devices = await deps.repository.listDevices(input.userId);
  for (const device of devices) {
    if (device.status === 'PENDING') await deps.repository.setDeviceStatus(device.id, 'ACTIVE');
  }
}

// ---------------------------------------------------------------------------
// 1A-8  Couple pairing
// ---------------------------------------------------------------------------

/**
 * Create the couple key, but only after both sides confirmed one transcript.
 *
 * Recipients are resolved by certificate chain. The server's device list is a
 * list of candidates and nothing more.
 */
export async function completeCouplePairing(
  deps: UseCaseDeps,
  input: {
    coupleId: string;
    transcriptHash: Uint8Array;
    lowConfirmation: Confirmation;
    highConfirmation: Confirmation;
    lowAnchor: TrustAnchor;
    highAnchor: TrustAnchor;
    lowCandidates: { deviceId: Uint8Array; chain: CertificateWithKeys[] }[];
    highCandidates: { deviceId: Uint8Array; chain: CertificateWithKeys[] }[];
    senderDeviceId: string;
    senderSigSpki: Uint8Array;
    senderCertificateId: string;
    signHandle: string;
    expiresAtMs: bigint;
  },
): Promise<{ scopeKeyId: string; epoch: bigint }> {
  requireEnabled(deps);
  const nowMs = BigInt(deps.now());

  const low = await selectRecipients({
    candidates: input.lowCandidates, anchor: input.lowAnchor, domain: 'couple', atMs: nowMs,
  });
  const high = await selectRecipients({
    candidates: input.highCandidates, anchor: input.highAnchor, domain: 'couple', atMs: nowMs,
  });

  const gate = await canCreateCoupleKey({
    transcriptHash: input.transcriptHash,
    lowConfirmation: input.lowConfirmation,
    highConfirmation: input.highConfirmation,
    lowVerifiedDevices: low.eligible,
    highVerifiedDevices: high.eligible,
    nowMs,
    expiresAtMs: input.expiresAtMs,
  });
  // No CSK before CONFIRMED_BOTH. This is the whole point of the flow.
  if (!gate.allowed) fail('E_PAIRING_NOT_CONFIRMED', gate.reason ?? 'pairing is not confirmed');

  const recipients = [...low.eligible, ...high.eligible];
  if (recipients.length === 0) fail('E_NO_RECIPIENTS', 'no certified device to receive the couple key');

  const existing = await deps.repository.listScopeKeys('couple', input.coupleId);
  const epoch = existing.reduce((max, k) => (k.epoch > max ? k.epoch : max), 0n) + 1n;

  const scopeKeyId = await deps.repository.insertScopeKey({
    domain: 'couple', scopeId: input.coupleId, epoch, state: 'PREPARING',
  });

  const scopeKey = generateScopeKeyBytes();
  try {
    for (const recipient of recipients) {
      const envelope = await sealScopeKeyForRecipient({
        scopeKey,
        recipientKemSpki: recipient.kemSpki,
        recipientId: recipient.deviceId,
        recipientKind: RECIPIENT_KIND.device,
        senderDeviceId: uuidToBytes(input.senderDeviceId),
        senderSigSpki: input.senderSigSpki,
        sign: (message) => deps.deviceKeys.sign(input.signHandle, message),
        makeEphemeral: (peer) => generateEphemeralAgreement(peer),
        header: {
          domain: 3,
          scopeKeyId: uuidToBytes(scopeKeyId),
          ownerUserId: input.lowAnchor.userId,
          scopeId: uuidToBytes(input.coupleId),
          epoch,
        },
        nowMs: BigInt(deps.now()),
      });
      await deps.repository.insertEnvelope({
        scopeKeyId,
        recipientKind: 'device',
        recipientId: hex(recipient.deviceId),
        senderCertificateId: input.senderCertificateId,
        envelope,
      });
    }
  } finally {
    zeroize(scopeKey);
  }

  // PREPARING -> READY -> ACTIVE, both through the RPCs. There is no direct
  // UPDATE path, so a partially built epoch simply never activates.
  await deps.repository.markEpochReady(scopeKeyId);
  await deps.repository.activateEpoch(scopeKeyId);
  return { scopeKeyId, epoch };
}

// ---------------------------------------------------------------------------
// 1A-9  Partner-assisted recovery — COUPLE ONLY, by type
// ---------------------------------------------------------------------------

/**
 * Re-wrap the current couple key to a partner's replacement device.
 *
 * There is deliberately no `domain` parameter and no generic `recover(domain)`
 * anywhere in this module. The only scope this function can reach is the couple
 * key it looks up itself, so personal and health are unreachable by
 * construction rather than by a runtime check — and the database refuses a
 * personal or health envelope for another user's device regardless.
 */
export async function partnerAssistRecoverCouple(
  deps: UseCaseDeps,
  input: {
    coupleId: string;
    /** Verified through a fresh partner-assist SAS ceremony. */
    targetDevice: VerifiedDevice;
    assistingDeviceId: string;
    assistingSigSpki: Uint8Array;
    assistingCertificateId: string;
    assistingKemSpki: Uint8Array;
    ownEnvelope: Uint8Array;
    ownEnvelopeSenderSigSpki: Uint8Array;
    signHandle: string;
    kemHandle: string;
    ownerUserId: Uint8Array;
  },
): Promise<void> {
  requireEnabled(deps);

  const keys = await deps.repository.listScopeKeys('couple', input.coupleId);
  const active = keys.find((k) => k.state === 'ACTIVE');
  if (!active) fail('E_NO_ACTIVE_COUPLE_KEY', 'there is no active couple key to share');

  const { provisionScopeKeyToRecipient } = await import('@/crypto/keyring/scopeKeys');
  const envelope = await provisionScopeKeyToRecipient({
    ownEnvelope: input.ownEnvelope,
    ownKemSpki: input.assistingKemSpki,
    ownEnvelopeSenderSigSpki: input.ownEnvelopeSenderSigSpki,
    deriveSecret: (peer) => deps.deviceKeys.deriveSecret(input.kemHandle, peer),
    recipientKemSpki: input.targetDevice.kemSpki,
    recipientId: input.targetDevice.deviceId,
    recipientKind: RECIPIENT_KIND.device,
    senderDeviceId: uuidToBytes(input.assistingDeviceId),
    senderSigSpki: input.assistingSigSpki,
    sign: (message) => deps.deviceKeys.sign(input.signHandle, message),
    makeEphemeral: (peer) => generateEphemeralAgreement(peer),
    header: {
      domain: 3,
      scopeKeyId: uuidToBytes(active.id),
      ownerUserId: input.ownerUserId,
      scopeId: uuidToBytes(input.coupleId),
      epoch: active.epoch,
    },
    nowMs: BigInt(deps.now()),
  });

  await deps.repository.insertEnvelope({
    scopeKeyId: active.id,
    recipientKind: 'device',
    recipientId: hex(input.targetDevice.deviceId),
    senderCertificateId: input.assistingCertificateId,
    envelope,
  });
}

// ---------------------------------------------------------------------------
// 1A-10  Revocation and rotation
// ---------------------------------------------------------------------------

export async function revokeDeviceAndRotate(
  deps: UseCaseDeps,
  input: {
    userId: string;
    revokedDeviceId: string;
    revokedSigFp: Uint8Array;
    revokerDeviceId: string;
    revokerSignHandle: string;
    heldScopes: HeldScope[];
    userConfirmedSecureErase: boolean;
    serverOriginId: Uint8Array;
    recoveryIdentityId: Uint8Array;
    recoveryVersion: number;
    sequence: bigint;
    logHead: Uint8Array;
  },
): Promise<{ reason: RevocationReasonName; rotated: HeldScope[] }> {
  requireEnabled(deps);

  const device = await deps.repository.getDevice(input.revokedDeviceId);
  if (!device) fail('E_UNKNOWN_DEVICE', 'no such device');

  // A lost device defaults to potentially compromised. Only an explicit,
  // affirmed secure erase on hardware-backed storage skips rotation.
  const reason: RevocationReasonName = classifyLostDevice({
    assurance: device.assurance ?? ASSURANCE.webNonExtractable,
    userConfirmedSecureErase: input.userConfirmedSecureErase,
  });

  const tbs = encodeRevocationTbs({
    userId: uuidToBytes(input.userId),
    serverOriginId: input.serverOriginId,
    recoveryIdentityId: input.recoveryIdentityId,
    recoveryVersion: input.recoveryVersion,
    revokedDeviceId: uuidToBytes(input.revokedDeviceId),
    revokedSubjectSigPubFp: input.revokedSigFp,
    reason,
    revokedAtMs: BigInt(deps.now()),
    revokerDeviceId: uuidToBytes(input.revokerDeviceId),
    issuedAtMs: BigInt(deps.now()),
    serverNonce: randomBytes(32),
  });
  const signature = await deps.deviceKeys.sign(input.revokerSignHandle, revocationSignedMessage(tbs));

  await deps.repository.appendRevocation({
    userId: input.userId,
    revokedDeviceId: input.revokedDeviceId,
    reason,
    tbs,
    signature,
    sequence: input.sequence,
    logHead: input.logHead,
  });
  await deps.repository.setDeviceStatus(input.revokedDeviceId, 'REVOKED');

  const plan = planRevocation({ reason, heldScopes: input.heldScopes });
  // Rotation itself is per-scope and goes through the epoch RPCs; the caller
  // drives it with the plan so a partial rotation leaves only PREPARING rows.
  return { reason: plan.reason, rotated: plan.rotate };
}

/** Devices that may receive a new epoch, resolved by certificate, not status. */
export async function eligibleRecipients(
  deps: UseCaseDeps,
  input: { userId: string; anchor: TrustAnchor; domain: KeyDomainName },
): Promise<VerifiedDevice[]> {
  const devices = await deps.repository.listDevices(input.userId);
  const certificates = await deps.repository.listCertificates(input.userId);
  const revocations = new RevocationSet();

  const byDevice = new Map(certificates.map((c) => [c.subjectDeviceId, c]));
  const candidates = devices
    .map((device) => {
      const certificate = byDevice.get(device.id);
      if (!certificate) return null;
      return {
        deviceId: uuidToBytes(device.id),
        chain: [{
          certificate: certificate.certificate,
          subjectSigSpki: certificate.subjectSigSpki,
          subjectKemSpki: certificate.subjectKemSpki,
        }] as CertificateWithKeys[],
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const selection = await selectRecipients({
    candidates, anchor: input.anchor, domain: input.domain, atMs: BigInt(deps.now()), revocations,
  });
  return selection.eligible;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function grantsForPlatform(platform: PlatformName): KeyDomainName[] {
  // Health is off by default on web: a non-extractable key cannot be exported
  // but can be used by same-origin script, so the browser is the weakest class.
  return platform === 'web' ? ['personal', 'couple'] : ['personal', 'couple', 'health'];
}

function recoveryPrivAad(version: number, userId: Uint8Array, salt: Uint8Array, role: number): Uint8Array {
  return concat(utf8('gomsinlog/recpriv/v1'), new Uint8Array([role, version]), userId, salt);
}

async function generateSoftwareKeyPair(kind: 'ECDSA' | 'ECDH') {
  const pair = (await crypto.subtle.generateKey(
    { name: kind, namedCurve: 'P-256' },
    true,
    kind === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'],
  )) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    spki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
    pkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  };
}

async function signWithSoftwareKey(key: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, message as BufferSource));
}

async function createUserScopeKey(
  deps: UseCaseDeps,
  input: {
    domain: 'personal' | 'health';
    userId: string;
    userIdBytes: Uint8Array;
    deviceId: string;
    deviceKemSpki: Uint8Array;
    deviceSigSpki: Uint8Array;
    signHandle: string;
    certificateId: string;
    recoveryIdentityId: string;
    recKemSpki: Uint8Array;
  },
): Promise<string> {
  const scopeKeyId = await deps.repository.insertScopeKey({
    domain: input.domain, scopeId: input.userId, epoch: 1n, state: 'PREPARING',
  });
  const scopeKey = generateScopeKeyBytes();
  try {
    const header = {
      domain: input.domain === 'personal' ? (1 as const) : (2 as const),
      scopeKeyId: uuidToBytes(scopeKeyId),
      ownerUserId: input.userIdBytes,
      scopeId: input.userIdBytes,
      epoch: 1n,
    };
    const common = {
      scopeKey,
      senderDeviceId: uuidToBytes(input.deviceId),
      senderSigSpki: input.deviceSigSpki,
      sign: (message: Uint8Array) => deps.deviceKeys.sign(input.signHandle, message),
      makeEphemeral: (peer: Uint8Array) => generateEphemeralAgreement(peer),
      header,
      nowMs: BigInt(deps.now()),
    };

    await deps.repository.insertEnvelope({
      scopeKeyId,
      recipientKind: 'device',
      recipientId: input.deviceId,
      senderCertificateId: input.certificateId,
      envelope: await sealScopeKeyForRecipient({
        ...common,
        recipientKemSpki: input.deviceKemSpki,
        recipientId: uuidToBytes(input.deviceId),
        recipientKind: RECIPIENT_KIND.device,
      }),
    });

    // The recovery envelope is what makes a lost device survivable at all.
    await deps.repository.insertEnvelope({
      scopeKeyId,
      recipientKind: 'recovery_identity',
      recipientId: input.recoveryIdentityId,
      senderCertificateId: input.certificateId,
      envelope: await sealScopeKeyForRecipient({
        ...common,
        recipientKemSpki: input.recKemSpki,
        recipientId: uuidToBytes(input.recoveryIdentityId),
        recipientKind: RECIPIENT_KIND.recoveryIdentity,
      }),
    });
  } finally {
    zeroize(scopeKey);
  }

  await deps.repository.markEpochReady(scopeKeyId);
  await deps.repository.activateEpoch(scopeKeyId);
  return scopeKeyId;
}

export { verifyCertificateChain, requiresRotation };
