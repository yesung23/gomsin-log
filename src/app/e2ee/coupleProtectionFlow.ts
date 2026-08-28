import { bytesToUuid, equalBytes, hex, uuidToBytes } from '@/crypto/bytes';
import { canonicalCoupleOwnerUserId } from '@/crypto/canonicalOwner';
import {
  buildPairingSide,
  canCreateCoupleKey,
  proposePairing,
  verifyConfirmation,
} from '@/crypto/protocol/pairing';
import { revocationLogGenesis } from '@/crypto/revocation';
import { deriveSas } from '@/crypto/sas';
import { publicKeyFingerprint, randomBytes } from '@/crypto/suite';
import {
  decodePairingTranscript,
  encodePairingTranscript,
  pairingConfirmMessage,
  type PairingSide,
  type PairingTranscript,
} from '@/crypto/transcripts';
import { completeCouplePairing, type UseCaseDeps } from './useCases';
import { anchorFromPin, loadRevocationSet, resolveTrustedDevices } from './trust';
import type { PairingRecord, PinnedTrustAnchor } from './ports';

const PAIRING_TTL_MS = 5 * 60 * 1000;

export type CoupleProtectionCeremony = {
  pairingId: string;
  coupleId: string;
  ownUserId: string;
  partnerUserId: string;
  ownDeviceId: string;
  transcript: PairingTranscript;
  transcriptHash: Uint8Array;
  ownSide: PairingSide;
  partnerSide: PairingSide;
  sas: string;
  expiresAtMs: number;
  ownConfirmed: boolean;
  partnerConfirmed: boolean;
  cryptoActive: boolean;
  canonicalOwner: boolean;
};

type VerifiedSide = {
  side: PairingSide;
  pin: PinnedTrustAnchor;
  resolved: Awaited<ReturnType<typeof resolveTrustedDevices>>;
  revocations: Awaited<ReturnType<typeof loadRevocationSet>>;
};

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

async function verifiedSide(input: {
  deps: UseCaseDeps;
  userId: string;
  partner: boolean;
}): Promise<VerifiedSide> {
  const serverOriginId = await input.deps.repository.serverOriginId();
  let pin: PinnedTrustAnchor;

  if (input.partner) {
    const anchor = await input.deps.repository.getPartnerRecoveryAnchor();
    if (!anchor) fail('E_PARTNER_PROTECTION_REQUIRED', 'the partner has not finished record protection setup');
    pin = {
      subjectUserId: input.userId,
      serverOriginId,
      rootRecSigPubFp: await publicKeyFingerprint(anchor.recSigSpki),
      rootRecSigSpki: anchor.recSigSpki,
      recoveryIdentityId: anchor.recoveryIdentityId,
      recoveryVersion: anchor.recoveryVersion,
      recoveryBundleFp: anchor.recoveryBundleFp,
      pinSource: 'pairing',
    };
  } else {
    const ownPin = await input.deps.localState.loadTrustAnchor(input.userId);
    if (!ownPin) fail('E_OWN_PROTECTION_REQUIRED', 'record protection setup is not complete on this device');
    if (!equalBytes(ownPin.serverOriginId, serverOriginId)) {
      fail('E_PINNED_ANCHOR_CONTEXT_MISMATCH', 'the local protection anchor belongs to another server');
    }
    pin = ownPin;
  }

  const anchor = await anchorFromPin({
    userId: input.userId,
    serverOriginId,
    rootRecSigSpki: pin.rootRecSigSpki,
    recoveryIdentityId: pin.recoveryIdentityId,
    recoveryVersion: pin.recoveryVersion,
  });
  const atMs = BigInt(input.deps.now());
  const [revocationRows, revocations] = await Promise.all([
    input.deps.repository.listRevocations(input.userId),
    loadRevocationSet(input.deps.repository, input.userId, anchor, atMs),
  ]);
  const resolved = await resolveTrustedDevices(input.deps.repository, {
    userId: input.userId,
    anchor,
    domain: 'couple',
    atMs,
    revocations,
  });
  if (resolved.length === 0) fail('E_NO_COUPLE_DEVICE', 'no certified device can receive the couple key');
  const logHead = revocationRows.length > 0
    ? revocationRows[revocationRows.length - 1].logHead
    : await revocationLogGenesis(uuidToBytes(input.userId), uuidToBytes(pin.recoveryIdentityId));
  const side = await buildPairingSide({
    userId: uuidToBytes(input.userId),
    verifiedDevices: resolved.map((entry) => entry.verified),
    certificateFingerprints: new Map(
      resolved.map((entry) => [hex(entry.verified.deviceId), entry.certificate.certificateFp]),
    ),
    recoveryIdentityId: uuidToBytes(pin.recoveryIdentityId),
    recoveryVersion: pin.recoveryVersion,
    rootRecSigPubFp: pin.rootRecSigPubFp,
    recoveryBundleFp: pin.recoveryBundleFp,
    revocationLogHead: logHead,
  });
  return { side, pin, resolved, revocations };
}

async function currentSides(deps: UseCaseDeps, coupleId: string, ownUserId: string) {
  const snapshot = await deps.repository.getCoupleAuthorizationSnapshot(coupleId);
  const active = [...snapshot.activeUserIds].sort();
  if (snapshot.currentUserActiveCoupleId !== coupleId || active.length !== 2 || !active.includes(ownUserId)) {
    fail('E_COUPLE_LIFECYCLE_INVALID', 'pairing requires the current exact two-person active couple');
  }
  const partnerUserId = active.find((userId) => userId !== ownUserId);
  if (!partnerUserId) fail('E_COUPLE_LIFECYCLE_INVALID', 'the partner account is missing');
  const [own, partner] = await Promise.all([
    verifiedSide({ deps, userId: ownUserId, partner: false }),
    verifiedSide({ deps, userId: partnerUserId, partner: true }),
  ]);
  return { own, partner, partnerUserId };
}

function confirmationFor(row: PairingRecord, low: boolean) {
  return low
    ? { deviceId: row.confirmedLowDeviceId, signature: row.confirmedLowSignature }
    : { deviceId: row.confirmedHighDeviceId, signature: row.confirmedHighSignature };
}

async function pinVerifiedPairingAuthority(input: {
  deps: UseCaseDeps;
  row: PairingRecord;
  coupleId: string;
  ownUserId: string;
  partnerUserId: string;
  transcript: PairingTranscript;
  transcriptHash: Uint8Array;
  own: VerifiedSide;
  partner: VerifiedSide;
}) {
  const ownIsLow = canonicalCoupleOwnerUserId(input.ownUserId, input.partnerUserId) === input.ownUserId;
  const ownConfirmation = confirmationFor(input.row, ownIsLow);
  const partnerConfirmation = confirmationFor(input.row, !ownIsLow);
  if (!ownConfirmation.deviceId || !ownConfirmation.signature
      || !partnerConfirmation.deviceId || !partnerConfirmation.signature) {
    fail('E_PAIRING_CONFIRMATION_MISSING', 'both confirmations are required');
  }
  const ownResolved = input.own.resolved.find(
    (entry) => bytesToUuid(entry.verified.deviceId) === ownConfirmation.deviceId,
  );
  const partnerResolved = input.partner.resolved.find(
    (entry) => bytesToUuid(entry.verified.deviceId) === partnerConfirmation.deviceId,
  );
  if (!ownResolved || !partnerResolved) fail('E_CONFIRMING_DEVICE_UNTRUSTED', 'a confirming device is not certified');
  if (input.own.revocations.lookup(ownResolved.verified.deviceId)
      || input.partner.revocations.lookup(partnerResolved.verified.deviceId)) {
    fail('E_CONFIRMING_DEVICE_REVOKED', 'a confirming device was revoked');
  }
  const lowConfirmation = ownIsLow
    ? { device: ownResolved.verified, signature: ownConfirmation.signature }
    : { device: partnerResolved.verified, signature: partnerConfirmation.signature };
  const highConfirmation = ownIsLow
    ? { device: partnerResolved.verified, signature: partnerConfirmation.signature }
    : { device: ownResolved.verified, signature: ownConfirmation.signature };
  const gate = input.row.state === 'CRYPTO_ACTIVE'
    ? {
        allowed: (await Promise.all([
          verifyConfirmation(input.transcriptHash, lowConfirmation),
          verifyConfirmation(input.transcriptHash, highConfirmation),
        ])).every(Boolean),
        reason: 'E_BAD_CONFIRMATION_SIGNATURE',
      }
    : await canCreateCoupleKey({
    transcriptHash: input.transcriptHash,
    lowConfirmation,
    highConfirmation,
    lowVerifiedDevices: (ownIsLow ? input.own : input.partner).resolved.map((entry) => entry.verified),
    highVerifiedDevices: (ownIsLow ? input.partner : input.own).resolved.map((entry) => entry.verified),
    nowMs: BigInt(input.deps.now()),
    expiresAtMs: input.transcript.expiresAtMs,
  });
  if (!gate.allowed) fail('E_PAIRING_NOT_CONFIRMED', gate.reason ?? 'the pairing confirmations are invalid');

  const lowUserId = ownIsLow ? input.ownUserId : input.partnerUserId;
  const highUserId = ownIsLow ? input.partnerUserId : input.ownUserId;
  await input.deps.localState.pinCoupleAuthority({
    serverOriginId: await input.deps.repository.serverOriginId(),
    coupleId: input.coupleId,
    transcriptHash: input.transcriptHash,
    lowUserId,
    highUserId,
    lowAnchor: ownIsLow ? input.own.pin : input.partner.pin,
    highAnchor: ownIsLow ? input.partner.pin : input.own.pin,
    state: input.row.state === 'CRYPTO_ACTIVE' ? 'CRYPTO_ACTIVE' : 'CONFIRMED',
  });
  await input.deps.localState.pinTrustAnchor(input.partnerUserId, input.partner.pin);
  if (input.row.state === 'CRYPTO_ACTIVE') {
    await input.deps.localState.markCoupleAuthorityCryptoActive(input.coupleId);
  }
  return { ownIsLow, ownConfirmation, partnerConfirmation };
}

async function verifiedCeremony(
  deps: UseCaseDeps,
  input: { coupleId: string; ownUserId: string; row: PairingRecord },
): Promise<CoupleProtectionCeremony & { own: VerifiedSide; partner: VerifiedSide }> {
  const { own, partner, partnerUserId } = await currentSides(deps, input.coupleId, input.ownUserId);
  const row = input.row;
  if (!row.transcript || !row.transcriptHash || !row.pairingNonce || !row.expiresAt) {
    fail('E_PAIRING_EVIDENCE_MISSING', 'the pairing row is incomplete');
  }
  const transcript = decodePairingTranscript(row.transcript);
  const createdAtMs = Date.parse(row.createdAt);
  const expiresAtMs = Date.parse(row.expiresAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)
      || BigInt(createdAtMs) !== transcript.createdAtMs
      || BigInt(expiresAtMs) !== transcript.expiresAtMs) {
    fail('E_PAIRING_TIME_MISMATCH', 'the pairing row timestamps differ from the signed transcript');
  }
  const proposed = await proposePairing({
    coupleId: uuidToBytes(input.coupleId),
    serverOriginId: await deps.repository.serverOriginId(),
    sideA: own.side,
    sideB: partner.side,
    pairingNonce: row.pairingNonce,
    createdAtMs: transcript.createdAtMs,
    expiresAtMs: transcript.expiresAtMs,
  });
  if (!equalBytes(proposed.transcriptHash, row.transcriptHash)
      || !equalBytes(encodePairingTranscript(proposed.transcript), row.transcript)) {
    fail('E_PAIRING_TRANSCRIPT_MISMATCH', 'the two devices did not independently reconstruct the same pairing');
  }
  // The TTL limits human confirmation and CSK creation. Once the actor-bound
  // server gate has made the ceremony CRYPTO_ACTIVE, the signed transcript is
  // durable authority evidence and must remain verifiable after five minutes.
  if (row.state !== 'CRYPTO_ACTIVE' && deps.now() >= expiresAtMs) {
    fail('E_TRANSCRIPT_EXPIRED', 'the comparison code has expired');
  }

  const bootstrap = await deps.localState.loadBootstrap(input.ownUserId);
  if (!bootstrap || bootstrap.state !== 'COMPLETE') {
    fail('E_OWN_PROTECTION_REQUIRED', 'record protection setup is not complete on this device');
  }
  const ownIsLow = canonicalCoupleOwnerUserId(input.ownUserId, partnerUserId) === input.ownUserId;
  const ownConfirmation = confirmationFor(row, ownIsLow);
  const partnerConfirmation = confirmationFor(row, !ownIsLow);
  const result = {
    pairingId: row.id,
    coupleId: input.coupleId,
    ownUserId: input.ownUserId,
    partnerUserId,
    ownDeviceId: bootstrap.deviceId,
    transcript: proposed.transcript,
    transcriptHash: proposed.transcriptHash,
    ownSide: own.side,
    partnerSide: partner.side,
    sas: await deriveSas('pair', proposed.transcriptHash),
    expiresAtMs,
    ownConfirmed: !!ownConfirmation.deviceId && !!ownConfirmation.signature,
    partnerConfirmed: !!partnerConfirmation.deviceId && !!partnerConfirmation.signature,
    cryptoActive: row.state === 'CRYPTO_ACTIVE',
    canonicalOwner: ownIsLow,
    own,
    partner,
  };
  if (result.cryptoActive) {
    await pinVerifiedPairingAuthority({
      deps,
      row,
      coupleId: input.coupleId,
      ownUserId: input.ownUserId,
      partnerUserId,
      transcript: proposed.transcript,
      transcriptHash: proposed.transcriptHash,
      own,
      partner,
    });
  }
  return result;
}

export async function prepareCoupleProtectionCeremony(
  deps: UseCaseDeps,
  input: { coupleId: string; ownUserId: string; startIfMissing?: boolean },
): Promise<CoupleProtectionCeremony> {
  let row = await deps.repository.getPairing(input.coupleId);
  const reusable = row && !['TRANSCRIPT_EXPIRED', 'TRANSCRIPT_REJECTED', 'UNLINKED'].includes(row.state)
    && row.transcript && row.transcriptHash && row.pairingNonce && row.expiresAt;
  if (!reusable) {
    if (!input.startIfMissing) fail('E_PAIRING_NOT_STARTED', 'the couple comparison has not started');
    const { own, partner } = await currentSides(deps, input.coupleId, input.ownUserId);
    const createdAtMs = deps.now();
    const proposed = await proposePairing({
      coupleId: uuidToBytes(input.coupleId),
      serverOriginId: await deps.repository.serverOriginId(),
      sideA: own.side,
      sideB: partner.side,
      pairingNonce: randomBytes(32),
      createdAtMs: BigInt(createdAtMs),
      expiresAtMs: BigInt(createdAtMs + PAIRING_TTL_MS),
    });
    await deps.repository.startPairing({
      coupleId: input.coupleId,
      pairingNonce: proposed.transcript.pairingNonce,
      transcript: encodePairingTranscript(proposed.transcript),
      transcriptHash: proposed.transcriptHash,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + PAIRING_TTL_MS).toISOString(),
    });
    row = await deps.repository.getPairing(input.coupleId);
  }
  if (!row) fail('E_PAIRING_NOT_FOUND', 'the pairing proposal was not persisted');
  const ceremony = await verifiedCeremony(deps, { ...input, row });
  const { own: _own, partner: _partner, ...publicCeremony } = ceremony;
  return publicCeremony;
}

/**
 * Confirm one screen's independently reconstructed SAS. The canonical low user
 * creates the one CSK after both signatures exist; the partner accepts that same
 * evidence on their next refresh and never creates a second epoch.
 */
export async function confirmCoupleProtectionCeremony(
  deps: UseCaseDeps,
  input: { coupleId: string; ownUserId: string },
): Promise<CoupleProtectionCeremony> {
  const row = await deps.repository.getPairing(input.coupleId);
  if (!row) fail('E_PAIRING_NOT_STARTED', 'the couple comparison has not started');
  let ceremony = await verifiedCeremony(deps, { ...input, row });
  let confirmedRow = row;
  if (!ceremony.ownConfirmed) {
    const signature = await deps.deviceKeys.sign(
      `dev_sig:${ceremony.ownDeviceId}`,
      pairingConfirmMessage(ceremony.transcriptHash, uuidToBytes(ceremony.ownDeviceId)),
    );
    await deps.repository.confirmPairing({
      pairingId: ceremony.pairingId,
      deviceId: ceremony.ownDeviceId,
      signature,
    });
    const reloaded = await deps.repository.getPairing(input.coupleId);
    if (!reloaded) fail('E_PAIRING_NOT_FOUND', 'the confirmed pairing disappeared');
    confirmedRow = reloaded;
    ceremony = await verifiedCeremony(deps, { ...input, row: confirmedRow });
  }

  if (ceremony.ownConfirmed && ceremony.partnerConfirmed) {
    const evidence = await pinVerifiedPairingAuthority({
      deps,
      row: confirmedRow,
      coupleId: ceremony.coupleId,
      ownUserId: ceremony.ownUserId,
      partnerUserId: ceremony.partnerUserId,
      transcript: ceremony.transcript,
      transcriptHash: ceremony.transcriptHash,
      own: ceremony.own,
      partner: ceremony.partner,
    });

    if (ceremony.canonicalOwner && confirmedRow.state !== 'CRYPTO_ACTIVE') {
      await completeCouplePairing(deps, {
        coupleId: ceremony.coupleId,
        ownUserId: ceremony.ownUserId,
        partnerUserId: ceremony.partnerUserId,
        transcriptHash: ceremony.transcriptHash,
        ownSide: ceremony.ownSide,
        partnerSide: ceremony.partnerSide,
        ownConfirmation: {
          deviceId: evidence.ownConfirmation.deviceId!,
          signature: evidence.ownConfirmation.signature!,
        },
        partnerConfirmation: {
          deviceId: evidence.partnerConfirmation.deviceId!,
          signature: evidence.partnerConfirmation.signature!,
        },
        senderDeviceId: ceremony.ownDeviceId,
        expiresAtMs: ceremony.transcript.expiresAtMs,
      });
    }
  }

  const latest = await deps.repository.getPairing(input.coupleId);
  if (!latest) fail('E_PAIRING_NOT_FOUND', 'the pairing disappeared after confirmation');
  const refreshed = await verifiedCeremony(deps, { ...input, row: latest });
  const { own: _own, partner: _partner, ...publicCeremony } = refreshed;
  return publicCeremony;
}
