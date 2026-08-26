/**
 * Ceremony transcripts: enrollment, pairing, and recovery authentication.
 *
 * A transcript is the exact byte string both sides independently reconstruct
 * from state they fetched separately. That is the whole mechanism: if a server
 * shows two parties different facts, their transcripts differ, their SAS values
 * differ, and the human comparison fails. Every field is fixed-width; there is
 * no JSON and no canonicalization step to disagree about.
 */

import { concat, equalBytes, readU64be, u64be, utf8 } from './bytes';
import { sha256 } from './suite';
import { PROTOCOL_ID, SUITE_ID } from './versions';

export class TranscriptError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'TranscriptError';
  }
}

function fail(code: string, message: string): never {
  throw new TranscriptError(code, message);
}

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (value.length !== width) fail('E_FIELD_WIDTH', `${name} must be ${width} bytes, saw ${value.length}`);
  return value;
}

function versionByte(value: number, name: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 255) fail('E_FIELD_WIDTH', `${name} must fit in one byte`);
  return new Uint8Array([value]);
}

// --- device enrollment ------------------------------------------------------

export type EnrollmentTranscript = {
  userId: Uint8Array;
  serverOriginId: Uint8Array;
  oldDeviceId: Uint8Array;
  oldSigFp: Uint8Array;
  oldKemFp: Uint8Array;
  newDeviceId: Uint8Array;
  newSigFp: Uint8Array;
  newKemFp: Uint8Array;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  rootRecSigPubFp: Uint8Array;
  recoveryBundleFp: Uint8Array;
  revocationLogHead: Uint8Array;
  issuerCertFp: Uint8Array;
  grantedDomainsMask: number;
  enrollNonce: Uint8Array;
  issuedAtMs: bigint;
  expiresAtMs: bigint;
};

export function encodeEnrollmentTranscript(t: EnrollmentTranscript): Uint8Array {
  return concat(
    utf8('gomsinlog/enroll/v1'),
    new Uint8Array([PROTOCOL_ID, SUITE_ID]),
    fixed('userId', t.userId, 16),
    fixed('serverOriginId', t.serverOriginId, 32),
    fixed('oldDeviceId', t.oldDeviceId, 16),
    fixed('oldSigFp', t.oldSigFp, 32),
    fixed('oldKemFp', t.oldKemFp, 32),
    fixed('newDeviceId', t.newDeviceId, 16),
    fixed('newSigFp', t.newSigFp, 32),
    fixed('newKemFp', t.newKemFp, 32),
    fixed('recoveryIdentityId', t.recoveryIdentityId, 16),
    versionByte(t.recoveryVersion, 'recoveryVersion'),
    fixed('rootRecSigPubFp', t.rootRecSigPubFp, 32),
    fixed('recoveryBundleFp', t.recoveryBundleFp, 32),
    fixed('revocationLogHead', t.revocationLogHead, 32),
    fixed('issuerCertFp', t.issuerCertFp, 32),
    versionByte(t.grantedDomainsMask, 'grantedDomainsMask'),
    fixed('enrollNonce', t.enrollNonce, 32),
    u64be(t.issuedAtMs),
    u64be(t.expiresAtMs),
  );
}

export async function enrollmentTranscriptHash(t: EnrollmentTranscript): Promise<Uint8Array> {
  return sha256(encodeEnrollmentTranscript(t));
}

// --- couple pairing ---------------------------------------------------------

/**
 * One side of a pairing transcript.
 *
 * `deviceBundleHash` covers only devices whose certificate chain the local
 * device verified. Hashing the server's raw answer instead is precisely the bug
 * that let a malicious server show both partners the same poisoned device set.
 */
export type PairingSide = {
  userId: Uint8Array;
  deviceBundleHash: Uint8Array;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  rootRecSigPubFp: Uint8Array;
  recoveryBundleFp: Uint8Array;
  revocationLogHead: Uint8Array;
};

export type PairingTranscript = {
  coupleId: Uint8Array;
  serverOriginId: Uint8Array;
  /** Ordered by unsigned big-endian user id so both sides agree. */
  low: PairingSide;
  high: PairingSide;
  pairingNonce: Uint8Array;
  createdAtMs: bigint;
  expiresAtMs: bigint;
};

function encodeSide(side: PairingSide, name: string): Uint8Array {
  return concat(
    fixed(`${name}.userId`, side.userId, 16),
    fixed(`${name}.deviceBundleHash`, side.deviceBundleHash, 32),
    fixed(`${name}.recoveryIdentityId`, side.recoveryIdentityId, 16),
    versionByte(side.recoveryVersion, `${name}.recoveryVersion`),
    fixed(`${name}.rootRecSigPubFp`, side.rootRecSigPubFp, 32),
    fixed(`${name}.recoveryBundleFp`, side.recoveryBundleFp, 32),
    fixed(`${name}.revocationLogHead`, side.revocationLogHead, 32),
  );
}

/** Deterministic ordering so both devices build identical bytes. */
export function orderPairingSides(a: PairingSide, b: PairingSide): { low: PairingSide; high: PairingSide } {
  for (let i = 0; i < 16; i += 1) {
    if (a.userId[i] !== b.userId[i]) return a.userId[i] < b.userId[i] ? { low: a, high: b } : { low: b, high: a };
  }
  fail('E_SAME_USER', 'both pairing sides have the same user id');
}

export function encodePairingTranscript(t: PairingTranscript): Uint8Array {
  return concat(
    utf8('gomsinlog/pairing/v1'),
    new Uint8Array([PROTOCOL_ID, SUITE_ID]),
    fixed('coupleId', t.coupleId, 16),
    fixed('serverOriginId', t.serverOriginId, 32),
    encodeSide(t.low, 'low'),
    encodeSide(t.high, 'high'),
    fixed('pairingNonce', t.pairingNonce, 32),
    u64be(t.createdAtMs),
    u64be(t.expiresAtMs),
  );
}

/**
 * Decode the one fixed-width pairing transcript format we persist.
 *
 * The database stores the canonical bytes, not JSON. Both devices decode these
 * bytes and independently rebuild the same transcript from verified devices
 * before a confirmation is ever signed.
 */
export function decodePairingTranscript(bytes: Uint8Array): PairingTranscript {
  const label = utf8('gomsinlog/pairing/v1');
  const expectedLength = label.length + 2 + 16 + 32 + (161 * 2) + 32 + 8 + 8;
  if (bytes.length !== expectedLength) fail('E_TRANSCRIPT_LENGTH', 'pairing transcript has the wrong length');
  let at = 0;
  const take = (width: number): Uint8Array => {
    const end = at + width;
    if (end > bytes.length) fail('E_TRANSCRIPT_LENGTH', 'pairing transcript ended early');
    const value = bytes.slice(at, end);
    at = end;
    return value;
  };
  if (!equalBytes(take(label.length), label)) fail('E_TRANSCRIPT_LABEL', 'pairing transcript label is invalid');
  const protocolId = take(1)[0];
  const suiteId = take(1)[0];
  if (protocolId !== PROTOCOL_ID || suiteId !== SUITE_ID) {
    fail('E_TRANSCRIPT_VERSION', 'pairing transcript version is unsupported');
  }
  const decodeSide = (): PairingSide => ({
    userId: take(16),
    deviceBundleHash: take(32),
    recoveryIdentityId: take(16),
    recoveryVersion: take(1)[0],
    rootRecSigPubFp: take(32),
    recoveryBundleFp: take(32),
    revocationLogHead: take(32),
  });
  const coupleId = take(16);
  const serverOriginId = take(32);
  const low = decodeSide();
  const high = decodeSide();
  const pairingNonce = take(32);
  const createdAtMs = readU64be(bytes, at); at += 8;
  const expiresAtMs = readU64be(bytes, at); at += 8;
  if (at !== bytes.length) fail('E_TRANSCRIPT_LENGTH', 'pairing transcript has trailing bytes');
  const ordered = orderPairingSides(low, high);
  if (!equalBytes(ordered.low.userId, low.userId)) {
    fail('E_TRANSCRIPT_ORDER', 'pairing transcript sides are not canonical');
  }
  return { coupleId, serverOriginId, low, high, pairingNonce, createdAtMs, expiresAtMs };
}

export async function pairingTranscriptHash(t: PairingTranscript): Promise<Uint8Array> {
  return sha256(encodePairingTranscript(t));
}

export function pairingConfirmMessage(transcriptHash: Uint8Array, confirmingDeviceId: Uint8Array): Uint8Array {
  return concat(
    utf8('gomsinlog/pair-confirm/v1'),
    fixed('transcriptHash', transcriptHash, 32),
    fixed('confirmingDeviceId', confirmingDeviceId, 16),
  );
}

/**
 * Hash a set of certified devices into a bundle hash.
 *
 * Sorted by device id so ordering cannot change the result, and built only from
 * devices the caller has already verified.
 */
export async function deviceBundleHash(
  devices: { deviceId: Uint8Array; sigFp: Uint8Array; kemFp: Uint8Array; certFp: Uint8Array }[],
): Promise<Uint8Array> {
  const sorted = [...devices].sort((a, b) => {
    for (let i = 0; i < 16; i += 1) {
      if (a.deviceId[i] !== b.deviceId[i]) return a.deviceId[i] - b.deviceId[i];
    }
    return 0;
  });
  const parts: Uint8Array[] = [utf8('gomsinlog/device-bundle/v1')];
  for (const device of sorted) {
    parts.push(
      fixed('deviceId', device.deviceId, 16),
      fixed('sigFp', device.sigFp, 32),
      fixed('kemFp', device.kemFp, 32),
      fixed('certFp', device.certFp, 32),
    );
  }
  return sha256(concat(...parts));
}

// --- recovery authentication ------------------------------------------------

export type RecoveryChallengeTranscript = {
  serverOriginId: Uint8Array;
  userId: Uint8Array;
  challengeId: Uint8Array;
  challengeNonce: Uint8Array;
  issuedAtMs: bigint;
  expiresAtMs: bigint;
  recoveryVersion: number;
  recSigPubFp: Uint8Array;
  newDeviceId: Uint8Array;
  newSigFp: Uint8Array;
  newKemFp: Uint8Array;
};

/**
 * Every field here blocks a specific replay.
 *
 * challengeId/nonce: replay of the same challenge. userId + serverOriginId:
 * cross-account and cross-deployment replay. newDevice*: re-use of a captured
 * response to activate a different device. expiresAtMs: staleness.
 * recoveryVersion + recSigPubFp: downgrade to a retired recovery bundle.
 */
export function encodeRecoveryChallengeTranscript(t: RecoveryChallengeTranscript): Uint8Array {
  return concat(
    utf8('gomsinlog/recovery-auth/v1'),
    new Uint8Array([PROTOCOL_ID, SUITE_ID]),
    fixed('serverOriginId', t.serverOriginId, 32),
    fixed('userId', t.userId, 16),
    fixed('challengeId', t.challengeId, 16),
    fixed('challengeNonce', t.challengeNonce, 32),
    u64be(t.issuedAtMs),
    u64be(t.expiresAtMs),
    versionByte(t.recoveryVersion, 'recoveryVersion'),
    fixed('recSigPubFp', t.recSigPubFp, 32),
    fixed('newDeviceId', t.newDeviceId, 16),
    fixed('newSigFp', t.newSigFp, 32),
    fixed('newKemFp', t.newKemFp, 32),
  );
}

export async function recoveryChallengeTranscriptHash(t: RecoveryChallengeTranscript): Promise<Uint8Array> {
  return sha256(encodeRecoveryChallengeTranscript(t));
}

// --- partner-assisted couple recovery ---------------------------------------

/**
 * The ceremony a partner performs to hand the CURRENT couple key to the other
 * member's replacement device.
 *
 * There is deliberately no domain field. This transcript names one couple scope
 * key and one epoch, so the only thing a confirmation over it can authorize is
 * that couple key — personal and health are not expressible here at all.
 *
 * Every field blocks a specific attack. `targetCertFp` binds the ceremony to the
 * exact certificate the assisting device verified, so a later certificate for
 * the same device id cannot reuse the confirmation. `scopeKeyId` + `epoch` bind
 * it to one epoch, so a captured confirmation cannot be replayed after rotation.
 * `expiresAtMs` is what "fresh" means, mechanically.
 */
export type PartnerAssistTranscript = {
  coupleId: Uint8Array;
  serverOriginId: Uint8Array;
  assistingUserId: Uint8Array;
  assistingDeviceId: Uint8Array;
  targetUserId: Uint8Array;
  targetDeviceId: Uint8Array;
  targetSigFp: Uint8Array;
  targetKemFp: Uint8Array;
  targetCertFp: Uint8Array;
  scopeKeyId: Uint8Array;
  epoch: bigint;
  assistNonce: Uint8Array;
  issuedAtMs: bigint;
  expiresAtMs: bigint;
};

export function encodePartnerAssistTranscript(t: PartnerAssistTranscript): Uint8Array {
  return concat(
    utf8('gomsinlog/partner-assist/v1'),
    new Uint8Array([PROTOCOL_ID, SUITE_ID]),
    fixed('coupleId', t.coupleId, 16),
    fixed('serverOriginId', t.serverOriginId, 32),
    fixed('assistingUserId', t.assistingUserId, 16),
    fixed('assistingDeviceId', t.assistingDeviceId, 16),
    fixed('targetUserId', t.targetUserId, 16),
    fixed('targetDeviceId', t.targetDeviceId, 16),
    fixed('targetSigFp', t.targetSigFp, 32),
    fixed('targetKemFp', t.targetKemFp, 32),
    fixed('targetCertFp', t.targetCertFp, 32),
    fixed('scopeKeyId', t.scopeKeyId, 16),
    u64be(t.epoch),
    fixed('assistNonce', t.assistNonce, 32),
    u64be(t.issuedAtMs),
    u64be(t.expiresAtMs),
  );
}

export async function partnerAssistTranscriptHash(t: PartnerAssistTranscript): Promise<Uint8Array> {
  return sha256(encodePartnerAssistTranscript(t));
}

/**
 * What the RECOVERING device signs once the two humans agree the SAS matches.
 *
 * Signed by the target's certified `dev_sig`, so the assisting device can check
 * it against a certificate chain it verified itself rather than believing a
 * boolean somebody handed it.
 */
export function partnerAssistConfirmMessage(
  transcriptHash: Uint8Array,
  confirmingDeviceId: Uint8Array,
): Uint8Array {
  return concat(
    utf8('gomsinlog/partner-assist-confirm/v1'),
    fixed('transcriptHash', transcriptHash, 32),
    fixed('confirmingDeviceId', confirmingDeviceId, 16),
  );
}

// --- recovery bundle --------------------------------------------------------

export type RecoveryBundle = {
  recoveryVersion: number;
  userId: Uint8Array;
  recoverySalt: Uint8Array;
  recSigSpki: Uint8Array;
  recKemSpki: Uint8Array;
};

export function encodeRecoveryBundle(bundle: RecoveryBundle): Uint8Array {
  return concat(
    utf8('gomsinlog/recbundle/v1'),
    versionByte(bundle.recoveryVersion, 'recoveryVersion'),
    fixed('userId', bundle.userId, 16),
    fixed('recoverySalt', bundle.recoverySalt, 32),
    fixed('recSigSpki', bundle.recSigSpki, 91),
    fixed('recKemSpki', bundle.recKemSpki, 91),
  );
}

export async function recoveryBundleFingerprint(bundle: RecoveryBundle): Promise<Uint8Array> {
  return sha256(encodeRecoveryBundle(bundle));
}

export function recoveryBundleSignedMessage(bundleFp: Uint8Array): Uint8Array {
  return concat(utf8('gomsinlog/recbundle-sig/v1'), fixed('bundleFp', bundleFp, 32));
}

/** Compare a served bundle against the fingerprint the user's kit carries. */
export function bundleMatchesKitAnchor(
  servedFp: Uint8Array,
  kitFp: Uint8Array,
  servedIdentityId: Uint8Array,
  kitIdentityId: Uint8Array,
  servedVersion: number,
  kitVersion: number,
): boolean {
  return (
    equalBytes(servedFp, kitFp)
    && equalBytes(servedIdentityId, kitIdentityId)
    && servedVersion === kitVersion
  );
}
