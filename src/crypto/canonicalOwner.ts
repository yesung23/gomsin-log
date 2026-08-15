import { equalBytes, uuidToBytes } from './bytes';

/** RFC 4122 UUID bytes compared as unsigned big-endian values. */
export function compareUuidBytes(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== 16 || b.length !== 16) throw new RangeError('UUID bytes must be 16 bytes');
  for (let i = 0; i < 16; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** The one canonical couple GLK2 owner helper. */
export function canonicalCoupleOwnerUserId(lowUserId: string, highUserId: string): string {
  const low = uuidToBytes(lowUserId);
  const high = uuidToBytes(highUserId);
  if (compareUuidBytes(low, high) === 0) throw new RangeError('pairing sides must be different users');
  return compareUuidBytes(low, high) < 0 ? lowUserId : highUserId;
}

export function isCanonicalCoupleOwner(owner: Uint8Array, lowUserId: string, highUserId: string): boolean {
  return equalBytes(owner, uuidToBytes(canonicalCoupleOwnerUserId(lowUserId, highUserId)));
}
