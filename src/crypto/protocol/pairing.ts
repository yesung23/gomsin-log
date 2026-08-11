/**
 * Couple pairing state machine and CSK activation.
 *
 * The rule the whole design turns on: membership may be active long before
 * cryptographic pairing is. A couple can exist, and Personal content can flow,
 * while no couple key exists at all. A CSK is created only after BOTH parties
 * have independently confirmed the SAME transcript hash.
 *
 * Architecture V2 allowed a provisional CSK before verification and was broken
 * by it; that path does not exist here.
 */

import { equalBytes, hex } from '../bytes';
import { EPOCH_STATE, type EpochState } from '../domains';
import { deriveSas, sasMatches, type SasContext } from '../sas';
import {
  deviceBundleHash,
  orderPairingSides,
  pairingConfirmMessage,
  pairingTranscriptHash,
  type PairingSide,
  type PairingTranscript,
} from '../transcripts';
import { ecdsaVerify, publicKeyFingerprint } from '../suite';
import type { VerifiedDevice } from '../deviceCertificate';

export const PAIRING_STATE = {
  cryptoPending: 'CRYPTO_PENDING',
  transcriptProposed: 'TRANSCRIPT_PROPOSED',
  confirmedOne: 'CONFIRMED_ONE',
  confirmedBoth: 'CONFIRMED_BOTH',
  epochPreparing: 'EPOCH_PREPARING',
  cryptoActive: 'CRYPTO_ACTIVE',
  transcriptExpired: 'TRANSCRIPT_EXPIRED',
  transcriptRejected: 'TRANSCRIPT_REJECTED',
  unlinked: 'UNLINKED',
} as const;
export type PairingState = (typeof PAIRING_STATE)[keyof typeof PAIRING_STATE];

export class PairingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'PairingError';
  }
}

function fail(code: string, message: string): never {
  throw new PairingError(code, message);
}

/** Shared content is unavailable in every state but CRYPTO_ACTIVE. */
export function sharedContentAvailable(state: PairingState): boolean {
  return state === PAIRING_STATE.cryptoActive;
}

/** Personal content never depends on pairing. */
export function personalContentAvailable(state: PairingState): boolean {
  return state !== PAIRING_STATE.unlinked || true;
}

/**
 * Build one side of a transcript from devices whose certificates ALREADY
 * verified.
 *
 * The caller must pass verified devices, not server rows: hashing the server's
 * raw answer is precisely what let a malicious server show both partners the
 * same poisoned bundle and produce matching SAS values on both screens.
 */
export async function buildPairingSide(input: {
  userId: Uint8Array;
  verifiedDevices: VerifiedDevice[];
  certificateFingerprints: Map<string, Uint8Array>;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  rootRecSigPubFp: Uint8Array;
  recoveryBundleFp: Uint8Array;
  revocationLogHead: Uint8Array;
}): Promise<PairingSide> {
  // Fingerprints are recomputed from the verified certificate's own keys, never
  // read from a server column.
  const entries: { deviceId: Uint8Array; sigFp: Uint8Array; kemFp: Uint8Array; certFp: Uint8Array }[] = [];
  for (const device of input.verifiedDevices) {
    const certFp = input.certificateFingerprints.get(hex(device.deviceId));
    if (!certFp) fail('E_MISSING_CERT_FP', 'a verified device has no certificate fingerprint');
    entries.push({
      deviceId: device.deviceId,
      sigFp: await publicKeyFingerprint(device.sigSpki),
      kemFp: await publicKeyFingerprint(device.kemSpki),
      certFp,
    });
  }

  return {
    userId: input.userId,
    deviceBundleHash: await deviceBundleHash(entries),
    recoveryIdentityId: input.recoveryIdentityId,
    recoveryVersion: input.recoveryVersion,
    rootRecSigPubFp: input.rootRecSigPubFp,
    recoveryBundleFp: input.recoveryBundleFp,
    revocationLogHead: input.revocationLogHead,
  };
}

export type ProposedPairing = {
  transcript: PairingTranscript;
  transcriptHash: Uint8Array;
  sas: string;
};

export async function proposePairing(input: {
  coupleId: Uint8Array;
  serverOriginId: Uint8Array;
  sideA: PairingSide;
  sideB: PairingSide;
  pairingNonce: Uint8Array;
  createdAtMs: bigint;
  expiresAtMs: bigint;
}): Promise<ProposedPairing> {
  if (input.expiresAtMs <= input.createdAtMs) fail('E_BAD_EXPIRY', 'expiry must be after creation');
  const { low, high } = orderPairingSides(input.sideA, input.sideB);
  const transcript: PairingTranscript = {
    coupleId: input.coupleId,
    serverOriginId: input.serverOriginId,
    low,
    high,
    pairingNonce: input.pairingNonce,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
  };
  const transcriptHash = await pairingTranscriptHash(transcript);
  return { transcript, transcriptHash, sas: await deriveSas('pair', transcriptHash) };
}

/**
 * Compare the two sides' SAS values.
 *
 * There is no auto-accept and no partial match: a human compares six groups and
 * a mismatch is terminal. If the server forked the transcript, the two devices
 * computed different hashes and this is where it surfaces.
 */
export function confirmSasComparison(localSas: string, remoteSas: string): { ok: boolean; state: PairingState } {
  return sasMatches(localSas, remoteSas)
    ? { ok: true, state: PAIRING_STATE.confirmedOne }
    : { ok: false, state: PAIRING_STATE.transcriptRejected };
}

/**
 * A confirmation, bound to a device whose certificate chain already verified.
 *
 * There is deliberately no `sigSpki` field. An earlier revision took the device
 * id and the verifying key as separate caller-supplied values, which meant a
 * caller could present a legitimate device id alongside an attacker's public
 * key and an attacker's signature, and the check passed. The key now comes from
 * the `VerifiedDevice` and nowhere else, and a `VerifiedDevice` can only be
 * produced by `verifyCertificateChain`.
 */
export type Confirmation = {
  device: VerifiedDevice;
  signature: Uint8Array;
};

/** Verify one side's signed confirmation, using the certified key only. */
export async function verifyConfirmation(
  transcriptHash: Uint8Array,
  confirmation: Confirmation,
): Promise<boolean> {
  return ecdsaVerify(
    confirmation.device.sigSpki,
    pairingConfirmMessage(transcriptHash, confirmation.device.deviceId),
    confirmation.signature,
  );
}

/**
 * Is this the same certified device?
 *
 * Compares the device id AND the certified signing key. Matching on the id
 * alone would re-open the substitution the `Confirmation` shape closes.
 */
function isSameVerifiedDevice(a: VerifiedDevice, b: VerifiedDevice): boolean {
  return equalBytes(a.deviceId, b.deviceId) && equalBytes(a.sigSpki, b.sigSpki);
}

/**
 * Decide whether a CSK may now be created.
 *
 * Both confirmations must be present, valid, over the same transcript hash, and
 * from devices belonging to different members. One party confirming twice is
 * not two confirmations.
 */
export async function canCreateCoupleKey(input: {
  transcriptHash: Uint8Array;
  lowConfirmation?: Confirmation;
  highConfirmation?: Confirmation;
  /** Certified devices for each side, from `verifyCertificateChain`. */
  lowVerifiedDevices: VerifiedDevice[];
  highVerifiedDevices: VerifiedDevice[];
  nowMs: bigint;
  expiresAtMs: bigint;
  /** Re-checked here so a revocation seen after verification still blocks. */
  revocations?: { lookup(deviceId: Uint8Array): { revokedAtMs: bigint } | null };
}): Promise<{ allowed: boolean; state: PairingState; reason?: string }> {
  if (input.nowMs >= input.expiresAtMs) {
    return { allowed: false, state: PAIRING_STATE.transcriptExpired, reason: 'E_TRANSCRIPT_EXPIRED' };
  }
  if (!input.lowConfirmation || !input.highConfirmation) {
    return {
      allowed: false,
      state: input.lowConfirmation || input.highConfirmation
        ? PAIRING_STATE.confirmedOne
        : PAIRING_STATE.transcriptProposed,
      reason: 'E_AWAITING_BOTH_CONFIRMATIONS',
    };
  }

  // The confirming device must be one of that side's CERTIFIED devices, matched
  // on id and certified key together.
  const belongs = (device: VerifiedDevice, set: VerifiedDevice[]) =>
    set.some((candidate) => isSameVerifiedDevice(candidate, device));
  if (!belongs(input.lowConfirmation.device, input.lowVerifiedDevices)) {
    return { allowed: false, state: PAIRING_STATE.transcriptRejected, reason: 'E_CONFIRMATION_WRONG_SIDE' };
  }
  if (!belongs(input.highConfirmation.device, input.highVerifiedDevices)) {
    return { allowed: false, state: PAIRING_STATE.transcriptRejected, reason: 'E_CONFIRMATION_WRONG_SIDE' };
  }

  // Two confirmations from the same device are one confirmation.
  if (isSameVerifiedDevice(input.lowConfirmation.device, input.highConfirmation.device)) {
    return { allowed: false, state: PAIRING_STATE.transcriptRejected, reason: 'E_CONFIRMATION_WRONG_SIDE' };
  }

  for (const confirmation of [input.lowConfirmation, input.highConfirmation]) {
    if (input.revocations?.lookup(confirmation.device.deviceId)) {
      return { allowed: false, state: PAIRING_STATE.transcriptRejected, reason: 'E_CONFIRMING_DEVICE_REVOKED' };
    }
  }

  const lowOk = await verifyConfirmation(input.transcriptHash, input.lowConfirmation);
  const highOk = await verifyConfirmation(input.transcriptHash, input.highConfirmation);
  if (!lowOk || !highOk) {
    return { allowed: false, state: PAIRING_STATE.transcriptRejected, reason: 'E_BAD_CONFIRMATION_SIGNATURE' };
  }

  return { allowed: true, state: PAIRING_STATE.confirmedBoth };
}

/**
 * Whether an epoch may move to ACTIVE.
 *
 * Every required recipient must already have a validated envelope. An epoch
 * that goes ACTIVE with a missing envelope silently locks somebody out of
 * content written from that moment on.
 */
export function epochReadyToActivate(input: {
  requiredRecipients: Uint8Array[];
  envelopedRecipients: Uint8Array[];
  currentState: EpochState;
}): { ready: boolean; nextState: EpochState; missing: string[] } {
  // Only READY activates. An earlier revision returned `ready` for anything that
  // was not ABANDONED, which made RETIRED look activatable and would have let a
  // resurrected epoch through had the database not refused it. The database is
  // authoritative — `e2ee_activate_epoch()` performs the same check under a row
  // lock — and this is the client-side agreement with it.
  if (input.currentState !== EPOCH_STATE.ready) {
    return { ready: false, nextState: input.currentState, missing: [] };
  }
  if (input.requiredRecipients.length === 0) {
    // An epoch nobody can open is not ready; it is a mistake.
    return { ready: false, nextState: input.currentState, missing: [] };
  }
  const have = new Set(input.envelopedRecipients.map(hex));
  const missing = input.requiredRecipients.map(hex).filter((id) => !have.has(id));
  if (missing.length > 0) {
    return { ready: false, nextState: input.currentState, missing };
  }
  return { ready: true, nextState: EPOCH_STATE.active, missing: [] };
}

/**
 * Re-linking always creates a fresh key domain.
 *
 * Never reuse a couple_id or an epoch across relationships — including a
 * reconciliation with the same person. Old shared history reverts to owner-only
 * and is re-shared, if at all, by an explicit action.
 */
export function relinkRequiresNewDomain(previousCoupleId: Uint8Array, newCoupleId: Uint8Array): boolean {
  return !equalBytes(previousCoupleId, newCoupleId);
}

export const PAIRING_SAS_CONTEXT: SasContext = 'pair';
