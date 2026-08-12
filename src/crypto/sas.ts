/**
 * Short Authentication String. Architecture V2.1 section 8.
 *
 * Six zero-padded 3-digit groups — `123-004-998-231-042-551`. The comparison
 * space is 10^18, which is **59.79 bits**, and the probability that a
 * substituted transcript happens to display the same value is 10^-18 per
 * attempt. Stated exactly rather than rounded up to "60+ bits".
 *
 * The security argument is not brute force. An active attacker must produce a
 * second transcript whose SAS collides with the honest one, and gets one
 * attempt per ceremony, observed once by a human. This is the only control that
 * stops a malicious server from substituting a public key during enrollment or
 * pairing, which is why nothing in this module offers an auto-accept path: it
 * computes a value, and a human decides.
 */

import { concat, utf8 } from './bytes';
import { sha256 } from './suite';

export const SAS_GROUPS = 6;
export const SAS_DIGITS_PER_GROUP = 3;
/** 10^18 */
export const SAS_SPACE = 1_000_000_000_000_000_000n;
/** log2(10^18) = 59.79 bits. Do not describe this as 60+ bits. */
export const SAS_ENTROPY_BITS = 59.79;

/**
 * Largest multiple of 10^18 below 2^64, used for rejection sampling.
 *
 * 2^64 = 18446744073709551616, so 18 x 10^18 is the cutoff. Taking a plain
 * modulo would bias the low-order groups; rejecting above the cutoff removes
 * that at a cost of roughly 2.42% of draws.
 */
export const SAS_REJECTION_CEILING = 18_000_000_000_000_000_000n;

const LABEL = utf8('gomsinlog/sas/v1');

export type SasContext = 'enroll' | 'pair' | 'partner-assist';

export class SasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SasError';
  }
}

/**
 * Derive the SAS for a transcript hash.
 *
 * Counter-based rejection sampling: each attempt hashes a distinct input, so
 * rejecting one draw does not correlate with the next.
 */
export async function deriveSas(context: SasContext, transcriptHash: Uint8Array): Promise<string> {
  if (transcriptHash.length !== 32) throw new SasError('transcript hash must be 32 bytes');

  for (let counter = 0; counter < 256; counter += 1) {
    const digest = await sha256(concat(LABEL, utf8(context), new Uint8Array([counter]), transcriptHash));
    let value = 0n;
    for (let i = 0; i < 8; i += 1) value = (value << 8n) | BigInt(digest[i]);
    if (value >= SAS_REJECTION_CEILING) continue;

    const reduced = value % SAS_SPACE;
    const groups: string[] = [];
    let remaining = reduced;
    for (let i = 0; i < SAS_GROUPS; i += 1) {
      groups.push(String(remaining % 1000n).padStart(SAS_DIGITS_PER_GROUP, '0'));
      remaining /= 1000n;
    }
    // Displayed most-significant group first.
    return groups.reverse().join('-');
  }
  // 256 consecutive rejections has probability ~0.0242^256. Reaching here means
  // the digest is not behaving like a hash, which is not something to paper over.
  throw new SasError('rejection sampling failed to terminate');
}

const SAS_PATTERN = /^\d{3}(-\d{3}){5}$/;

export function isWellFormedSas(value: string): boolean {
  return SAS_PATTERN.test(value);
}

/**
 * Compare two SAS values.
 *
 * Both sides must be well-formed; a malformed input is a mismatch, never a
 * lenient match. Comparison is over the full six groups — there is no partial
 * or prefix acceptance.
 */
export function sasMatches(a: string, b: string): boolean {
  if (!isWellFormedSas(a) || !isWellFormedSas(b)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The QR payload for a ceremony.
 *
 * Carries the FULL 32-byte transcript hash, not the truncated SAS: scanning
 * authenticates the whole transcript, and the six digits exist only for the
 * case where a camera is not usable.
 */
export function buildQrPayload(
  context: SasContext,
  transcriptHash: Uint8Array,
  subjectId: Uint8Array,
): Uint8Array {
  if (transcriptHash.length !== 32) throw new SasError('transcript hash must be 32 bytes');
  if (subjectId.length !== 16) throw new SasError('subject id must be 16 bytes');
  return concat(utf8('GLSAS2'), utf8(context), new Uint8Array([0]), transcriptHash, subjectId);
}

export function parseQrPayload(payload: Uint8Array): {
  context: SasContext;
  transcriptHash: Uint8Array;
  subjectId: Uint8Array;
} {
  const prefix = utf8('GLSAS2');
  if (payload.length < prefix.length + 1 + 32 + 16) throw new SasError('QR payload is too short');
  for (let i = 0; i < prefix.length; i += 1) {
    if (payload[i] !== prefix[i]) throw new SasError('not a GomsinLog SAS payload');
  }
  const separator = payload.indexOf(0, prefix.length);
  if (separator < 0) throw new SasError('malformed QR payload');
  const context = new TextDecoder().decode(payload.subarray(prefix.length, separator));
  if (context !== 'enroll' && context !== 'pair' && context !== 'partner-assist') {
    throw new SasError(`unknown SAS context: ${context}`);
  }
  const transcriptHash = payload.slice(separator + 1, separator + 33);
  const subjectId = payload.slice(separator + 33, separator + 49);
  if (transcriptHash.length !== 32 || subjectId.length !== 16) throw new SasError('malformed QR payload');
  return { context, transcriptHash, subjectId };
}
