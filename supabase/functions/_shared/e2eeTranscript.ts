/**
 * Canonical ceremony transcripts, reconstructed SERVER-SIDE.
 *
 * This module exists because of one rule, and everything in it follows from
 * that rule:
 *
 *   THE SERVER NEVER VERIFIES A TRANSCRIPT THE CALLER SUPPLIED.
 *
 * Accepting caller bytes and checking that a signature covers them proves only
 * that the caller signed something it chose. It says nothing about whether the
 * thing signed describes the enrollment the server is about to commit. The
 * handlers therefore rebuild the exact byte string from authoritative server
 * state — rows, certificates, the deployment identity — hash it, and require
 * the client's evidence to match that. A client which fetched different facts
 * produces a different hash and is refused; that is the same mechanism the SAS
 * gives the two humans, applied at the server.
 *
 * The layouts here are byte-identical to `src/crypto/transcripts.ts`. They are
 * duplicated rather than imported because Edge Functions run under Deno with a
 * separate module graph, and `src/**` is a browser bundle. The duplication is
 * pinned by tests that build one side with the client encoder and verify it with
 * this one; a drift between them fails immediately rather than at recovery time.
 *
 * Free of any `Deno` reference at module scope, so vitest can exercise every
 * branch — the convention `_shared/cors.ts` established.
 */

import { concat, sha256, utf8 } from './e2eeVerify.ts';

/** Bound into every transcript. See `src/crypto/versions.ts`. */
export const PROTOCOL_ID = 1;
export const SUITE_ID = 1;

export class TranscriptFieldError extends Error {
  readonly field: string;
  constructor(field: string, expected: number, actual: number) {
    super(`E_TRANSCRIPT_FIELD_WIDTH: ${field} must be ${expected} bytes, saw ${actual}`);
    this.field = field;
    this.name = 'TranscriptFieldError';
  }
}

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== width) {
    throw new TranscriptFieldError(name, width, value?.length ?? -1);
  }
  return value;
}

function byteValue(name: string, value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new TranscriptFieldError(name, 1, -1);
  }
  return new Uint8Array([value]);
}

function u64be(value: bigint): Uint8Array {
  if (typeof value !== 'bigint' || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new TranscriptFieldError('u64', 8, -1);
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
}

// ---------------------------------------------------------------------------
// Device enrollment — T_e
// ---------------------------------------------------------------------------

/**
 * Every field a second-device enrollment commits to.
 *
 * Each one blocks something specific. `serverOriginId` blocks cross-deployment
 * replay; `recoveryIdentityId` + `recoveryVersion` + `rootRecSigPubFp` +
 * `recoveryBundleFp` block a substituted trust root; `revocationLogHead` blocks
 * an enrollment performed against a stale view of who is still trusted;
 * `issuerCertFp` binds the ceremony to the exact approving certificate rather
 * than to a device id that could later hold a different one; `enrollNonce`
 * makes it single-use; the two timestamps make it expire.
 */
export type EnrollmentTranscriptFields = {
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

export function encodeEnrollmentTranscript(t: EnrollmentTranscriptFields): Uint8Array {
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
    byteValue('recoveryVersion', t.recoveryVersion),
    fixed('rootRecSigPubFp', t.rootRecSigPubFp, 32),
    fixed('recoveryBundleFp', t.recoveryBundleFp, 32),
    fixed('revocationLogHead', t.revocationLogHead, 32),
    fixed('issuerCertFp', t.issuerCertFp, 32),
    byteValue('grantedDomainsMask', t.grantedDomainsMask),
    fixed('enrollNonce', t.enrollNonce, 32),
    u64be(t.issuedAtMs),
    u64be(t.expiresAtMs),
  );
}

export async function enrollmentTranscriptHash(t: EnrollmentTranscriptFields): Promise<Uint8Array> {
  return sha256(encodeEnrollmentTranscript(t));
}

/** What an approving device signs once the two humans agree the SAS matches. */
export function approvalSignedMessage(transcriptHash: Uint8Array): Uint8Array {
  return concat(utf8('gomsinlog/enroll-approve/v1'), fixed('transcriptHash', transcriptHash, 32));
}

// ---------------------------------------------------------------------------
// Recovery authentication
// ---------------------------------------------------------------------------

export type RecoveryTranscriptFields = {
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
 * Rebuild the challenge transcript from server state.
 *
 * `challengeId` and `challengeNonce` are separate fields on purpose: the row is
 * addressed by an opaque uuid, and the secret bytes are a separate column bound
 * into the signature. Using the nonce as the row key would make an attacker's
 * guessed nonce a database lookup, and would force a `bytea` comparison against
 * caller-supplied text on every request.
 */
export function encodeRecoveryChallengeTranscript(t: RecoveryTranscriptFields): Uint8Array {
  return concat(
    utf8('gomsinlog/recovery-auth/v1'),
    new Uint8Array([PROTOCOL_ID, SUITE_ID]),
    fixed('serverOriginId', t.serverOriginId, 32),
    fixed('userId', t.userId, 16),
    fixed('challengeId', t.challengeId, 16),
    fixed('challengeNonce', t.challengeNonce, 32),
    u64be(t.issuedAtMs),
    u64be(t.expiresAtMs),
    byteValue('recoveryVersion', t.recoveryVersion),
    fixed('recSigPubFp', t.recSigPubFp, 32),
    fixed('newDeviceId', t.newDeviceId, 16),
    fixed('newSigFp', t.newSigFp, 32),
    fixed('newKemFp', t.newKemFp, 32),
  );
}

// ---------------------------------------------------------------------------
// Revocation log head
// ---------------------------------------------------------------------------

/**
 * The genesis head of an account's revocation log.
 *
 * Needed here because the enrollment transcript binds the head, and an account
 * with no revocations still has one. Computing it identically on both sides is
 * what makes "no revocations yet" agree rather than accidentally differ.
 */
export async function revocationLogGenesis(
  userId: Uint8Array,
  recoveryIdentityId: Uint8Array,
): Promise<Uint8Array> {
  return sha256(concat(
    utf8('gomsinlog/revlog/v1'),
    fixed('userId', userId, 16),
    fixed('recoveryIdentityId', recoveryIdentityId, 16),
  ));
}
