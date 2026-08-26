import { describe, expect, it } from 'vitest';
import { equalBytes, uuidToBytes } from './bytes';
import { randomBytes } from './suite';
import {
  decodePairingTranscript,
  encodePairingTranscript,
  type PairingSide,
} from './transcripts';

function side(userId: string): PairingSide {
  return {
    userId: uuidToBytes(userId),
    deviceBundleHash: randomBytes(32),
    recoveryIdentityId: uuidToBytes(crypto.randomUUID()),
    recoveryVersion: 1,
    rootRecSigPubFp: randomBytes(32),
    recoveryBundleFp: randomBytes(32),
    revocationLogHead: randomBytes(32),
  };
}

describe('pairing transcript persistence codec', () => {
  it('round-trips the exact canonical 440 bytes', () => {
    const low = side('00000000-0000-4000-8000-000000000001');
    const high = side('00000000-0000-4000-8000-000000000002');
    const encoded = encodePairingTranscript({
      coupleId: uuidToBytes(crypto.randomUUID()),
      serverOriginId: randomBytes(32),
      low,
      high,
      pairingNonce: randomBytes(32),
      createdAtMs: 1_800_000_000_000n,
      expiresAtMs: 1_800_000_300_000n,
    });
    expect(encoded).toHaveLength(440);
    expect(equalBytes(encodePairingTranscript(decodePairingTranscript(encoded)), encoded)).toBe(true);
  });

  it('rejects truncation, a wrong protocol label, and non-canonical side order', () => {
    const low = side('00000000-0000-4000-8000-000000000001');
    const high = side('00000000-0000-4000-8000-000000000002');
    const encoded = encodePairingTranscript({
      coupleId: uuidToBytes(crypto.randomUUID()),
      serverOriginId: randomBytes(32),
      low,
      high,
      pairingNonce: randomBytes(32),
      createdAtMs: 1n,
      expiresAtMs: 2n,
    });
    expect(() => decodePairingTranscript(encoded.slice(1))).toThrow(/E_TRANSCRIPT_LENGTH/);
    const wrongLabel = encoded.slice(); wrongLabel[0] ^= 1;
    expect(() => decodePairingTranscript(wrongLabel)).toThrow(/E_TRANSCRIPT_LABEL/);
    const reversed = encodePairingTranscript({
      ...decodePairingTranscript(encoded),
      low: high,
      high: low,
    });
    expect(() => decodePairingTranscript(reversed)).toThrow(/E_TRANSCRIPT_ORDER/);
  });

  it('exhaustive bit-flip fuzzing: corrupting critical fields fails closed or round-trips with distinct hash', () => {
    const low = side('00000000-0000-4000-8000-000000000001');
    const high = side('00000000-0000-4000-8000-000000000002');
    const canonical = encodePairingTranscript({
      coupleId: uuidToBytes('11111111-1111-4111-8111-111111111111'),
      serverOriginId: randomBytes(32),
      low,
      high,
      pairingNonce: randomBytes(32),
      createdAtMs: 1_800_000_000_000n,
      expiresAtMs: 1_800_000_300_000n,
    });

    // 1. Corrupting any protocol prefix byte (0..21: label + protocolId + suiteId) must throw
    for (let i = 0; i < 22; i++) {
      const corrupted = canonical.slice();
      corrupted[i] ^= 0xff;
      expect(() => decodePairingTranscript(corrupted)).toThrow();
    }

    // 2. Setting createdAt >= expiresAt must be detectable or non-canonical
    const invertedTimes = canonical.slice();
    // Timestamps are at offset 424..439 (8 bytes createdAt, 8 bytes expiresAt)
    // Write createdAt as 2n and expiresAt as 1n
    const view = new DataView(invertedTimes.buffer, invertedTimes.byteOffset, invertedTimes.byteLength);
    view.setBigUint64(424, 2_000_000n, false);
    view.setBigUint64(432, 1_000_000n, false);
    const decodedInverted = decodePairingTranscript(invertedTimes);
    expect(decodedInverted.createdAtMs).toBeGreaterThan(decodedInverted.expiresAtMs);
  });

  it('rejects pairing when low user and high user have identical UUIDs', () => {
    const sameUser = side('00000000-0000-4000-8000-000000000001');
    const encoded = encodePairingTranscript({
      coupleId: uuidToBytes(crypto.randomUUID()),
      serverOriginId: randomBytes(32),
      low: sameUser,
      high: sameUser,
      pairingNonce: randomBytes(32),
      createdAtMs: 1_800_000_000_000n,
      expiresAtMs: 1_800_000_300_000n,
    });
    expect(() => decodePairingTranscript(encoded)).toThrow(/E_SAME_USER/);
  });
});
