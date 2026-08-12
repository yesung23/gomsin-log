/**
 * Cryptographic primitives. Suite 1 only.
 *
 * Everything here is WebCrypto. There is no JavaScript crypto library on this
 * path and there must not be one: `crypto.subtle` is the only implementation
 * available on all three targets that can hold a key the application cannot
 * read back, and adding a library would put raw key bytes in the JS heap for
 * the sake of algorithms we do not need.
 *
 * This module is the ONLY place that calls `crypto.getRandomValues`.
 */

import { concat, equalBytes, leftPad, utf8 } from './bytes';

export const SHARED_SECRET_BYTES = 32;
export const AES_KEY_BYTES = 32;
export const GCM_NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const SPKI_P256_BYTES = 91;
export const SEC1_POINT_BYTES = 65;
export const P1363_SIGNATURE_BYTES = 64;

/**
 * The constant 26-byte DER prefix of a P-256 SubjectPublicKeyInfo.
 *
 * Verified byte-identical on WebCrypto, Apple Security.framework and JCA during
 * Phase 1A-1, which is why native platforms can hand back a bare SEC1 point and
 * one encoder still serves every fingerprint.
 */
export const P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

export class CryptoSuiteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'CryptoSuiteError';
  }
}

function fail(code: string, message: string): never {
  throw new CryptoSuiteError(code, message);
}

const subtle = (): SubtleCrypto => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    fail('E_NO_WEBCRYPTO', 'WebCrypto is unavailable; a secure context is required');
  }
  return crypto.subtle;
};

/**
 * The per-call ceiling `crypto.getRandomValues` imposes.
 *
 * Every random value this protocol produces is a key, nonce, salt, secret or
 * fingerprint-sized challenge — 64 bytes at the very most. A request anywhere
 * near this limit means a caller is using the CSPRNG for something it was not
 * meant for, so the limit is enforced loudly rather than worked around by
 * chunking, which would hide the mistake.
 */
export const MAX_RANDOM_BYTES = 65536;

/** The only randomness source in the codebase. `Math.random` is never acceptable. */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) fail('E_BAD_LENGTH', 'random length must be a positive integer');
  if (length > MAX_RANDOM_BYTES) {
    fail('E_RANDOM_TOO_LARGE', `refusing a ${length}-byte random request; the ceiling is ${MAX_RANDOM_BYTES}`);
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomNonce(): Uint8Array {
  return randomBytes(GCM_NONCE_BYTES);
}

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', data as BufferSource));
}

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, message as BufferSource));
}

/** SHA-256 over an SPKI. The canonical public-key fingerprint everywhere. */
export async function publicKeyFingerprint(spki: Uint8Array): Promise<Uint8Array> {
  assertValidSpki(spki);
  return sha256(spki);
}

// ---------------------------------------------------------------------------
// Public key encoding and validation
// ---------------------------------------------------------------------------

export function assertValidSpki(spki: Uint8Array): void {
  if (spki.length !== SPKI_P256_BYTES) {
    fail('E_BAD_SPKI_LENGTH', `P-256 SPKI must be ${SPKI_P256_BYTES} bytes, saw ${spki.length}`);
  }
  if (!equalBytes(spki.subarray(0, P256_SPKI_PREFIX.length), P256_SPKI_PREFIX)) {
    fail('E_BAD_SPKI_PREFIX', 'not a P-256 SubjectPublicKeyInfo');
  }
  if (spki[P256_SPKI_PREFIX.length] !== 0x04) {
    fail('E_BAD_POINT_FORMAT', 'public point must be SEC1 uncompressed');
  }
}

export function spkiToSec1(spki: Uint8Array): Uint8Array {
  assertValidSpki(spki);
  return spki.subarray(P256_SPKI_PREFIX.length);
}

export function sec1ToSpki(point: Uint8Array): Uint8Array {
  if (point.length !== SEC1_POINT_BYTES) {
    fail('E_BAD_POINT_LENGTH', `SEC1 point must be ${SEC1_POINT_BYTES} bytes, saw ${point.length}`);
  }
  if (point[0] !== 0x04) fail('E_BAD_POINT_FORMAT', 'point must be uncompressed (0x04)');
  // Reject the point at infinity. P-256 has cofactor 1, so on-curve plus
  // not-infinity is the complete check; `importKey` performs the on-curve half.
  let allZero = true;
  for (let i = 1; i < point.length; i += 1) if (point[i] !== 0) { allZero = false; break; }
  if (allZero) fail('E_POINT_AT_INFINITY', 'public point is the identity element');
  return concat(P256_SPKI_PREFIX, point);
}

/**
 * Import a public key, validating the encoded point.
 *
 * `importKey` rejects a point that is not on the curve, which together with the
 * explicit infinity check above is the complete validation P-256 needs.
 */
export async function importPublicKey(
  spki: Uint8Array,
  usage: 'ECDH' | 'ECDSA',
): Promise<CryptoKey> {
  assertValidSpki(spki);
  try {
    return await subtle().importKey(
      'spki',
      spki as BufferSource,
      { name: usage, namedCurve: 'P-256' },
      false,
      usage === 'ECDSA' ? ['verify'] : [],
    );
  } catch {
    fail('E_INVALID_PUBLIC_KEY', 'public key is not a valid point on P-256');
  }
}

// ---------------------------------------------------------------------------
// ECDH
// ---------------------------------------------------------------------------

/**
 * Normalize a raw key-agreement result to exactly 32 bytes.
 *
 * WebCrypto, Apple Security.framework and SunEC were all measured in Phase
 * 1A-1 to return the full field width with a leading zero intact. Conscrypt is
 * unmeasured, and a stripped leading zero would silently derive a different KEK
 * on roughly one envelope in 256, so a short value is padded and an over-long
 * one is a hard error rather than a truncation.
 */
export function normalizeSharedSecret(raw: Uint8Array): Uint8Array {
  if (raw.length > SHARED_SECRET_BYTES) {
    fail('E_SHARED_SECRET_WIDTH', `shared secret is ${raw.length} bytes, expected at most ${SHARED_SECRET_BYTES}`);
  }
  if (raw.length === 0) fail('E_SHARED_SECRET_WIDTH', 'shared secret is empty');
  return leftPad(raw, SHARED_SECRET_BYTES);
}

export async function ecdhWithCryptoKey(privateKey: CryptoKey, peerSpki: Uint8Array): Promise<Uint8Array> {
  const peer = await importPublicKey(peerSpki, 'ECDH');
  const bits = await subtle().deriveBits({ name: 'ECDH', public: peer }, privateKey, SHARED_SECRET_BYTES * 8);
  return normalizeSharedSecret(new Uint8Array(bits));
}

// ---------------------------------------------------------------------------
// HKDF
// ---------------------------------------------------------------------------

export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

export async function importAesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (raw.length !== AES_KEY_BYTES) fail('E_BAD_KEY_LENGTH', `AES key must be ${AES_KEY_BYTES} bytes`);
  return subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, usages);
}

/** Returns `ciphertext || tag`, the protocol representation. */
export async function aesGcmSeal(
  key: CryptoKey,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (nonce.length !== GCM_NONCE_BYTES) fail('E_BAD_NONCE', `nonce must be ${GCM_NONCE_BYTES} bytes`);
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: GCM_TAG_BYTES * 8 },
    key,
    plaintext as BufferSource,
  );
  return new Uint8Array(sealed);
}

export async function aesGcmOpen(
  key: CryptoKey,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (nonce.length !== GCM_NONCE_BYTES) fail('E_BAD_NONCE', `nonce must be ${GCM_NONCE_BYTES} bytes`);
  if (sealed.length < GCM_TAG_BYTES) fail('E_TRUNCATED', 'sealed value is shorter than the tag');
  try {
    const opened = await subtle().decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: GCM_TAG_BYTES * 8 },
      key,
      sealed as BufferSource,
    );
    return new Uint8Array(opened);
  } catch {
    // Deliberately opaque: the caller learns authentication failed and nothing
    // about which byte, which is all a correct caller needs.
    fail('E_AEAD_FAILED', 'authenticated decryption failed');
  }
}

// ---------------------------------------------------------------------------
// ECDSA
// ---------------------------------------------------------------------------

/**
 * Verify a P-1363 signature.
 *
 * P-1363 is the protocol representation everywhere. Apple and JCA emit DER
 * natively, so their output is converted at the platform boundary rather than
 * here — see `ecdsaFormat.ts` and the device key port.
 */
export async function ecdsaVerify(
  spki: Uint8Array,
  message: Uint8Array,
  signatureP1363: Uint8Array,
): Promise<boolean> {
  if (signatureP1363.length !== P1363_SIGNATURE_BYTES) return false;
  const key = await importPublicKey(spki, 'ECDSA');
  return subtle().verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signatureP1363 as BufferSource,
    message as BufferSource,
  );
}

/**
 * One-shot ephemeral ECDH against a recipient's agreement key.
 *
 * The ephemeral private key never leaves this function and is discarded with
 * the `CryptoKeyPair`, which is what gives GLK2 its sender-side forward secrecy:
 * later compromise of the sending device reveals nothing about envelopes it
 * already wrote. It says nothing about the recipient's key.
 */
export async function generateEphemeralAgreement(
  recipientKemSpki: Uint8Array,
): Promise<{ publicKeySec1: Uint8Array; sharedSecret: Uint8Array }> {
  assertValidSpki(recipientKemSpki);
  const pair = (await subtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const publicKeySec1 = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const peer = await importPublicKey(recipientKemSpki, 'ECDH');
  const bits = await subtle().deriveBits({ name: 'ECDH', public: peer }, pair.privateKey, SHARED_SECRET_BYTES * 8);
  return { publicKeySec1, sharedSecret: normalizeSharedSecret(new Uint8Array(bits)) };
}

/** Domain-separated label bytes for transcripts and derivations. */
export function label(text: string): Uint8Array {
  return utf8(text);
}
