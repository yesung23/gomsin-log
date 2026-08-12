/**
 * GLK2 — the key envelope. Architecture V2.1 section 7.
 *
 * Fixed 360 bytes: a 171-byte canonical header, then a 189-byte body of
 * ephemeral public key, nonce, wrapped scope key and sender signature. Every
 * field is fixed-width and big-endian, and there is no JSON anywhere, because
 * an envelope whose authenticated bytes depend on a serializer's whitespace or
 * key ordering is an envelope whose signature means something slightly
 * different on every platform.
 *
 * Security properties, stated precisely:
 *
 *   - The scope key is wrapped under a KEK derived by ephemeral-static ECDH, so
 *     the sender keeps no state and each envelope has an independent KEK.
 *   - This is NOT forward secrecy for the recipient. An attacker holding an
 *     archived envelope who later compromises the recipient's `dev_kem` private
 *     key recovers the scope key. That is inherent — a device must be able to
 *     open envelopes written before it came online — and it is why revoking a
 *     compromised device requires epoch rotation rather than envelope deletion.
 *   - The header is bound twice, into the KDF `info` and the AEAD associated
 *     data, and signed. Neither layer alone is load-bearing.
 */

import { concat, equalBytes, readU64be, u64be, zeroize } from './bytes';
import { KEY_DOMAIN, RECIPIENT_KIND, type KeyDomainCode } from './domains';
import {
  AES_KEY_BYTES,
  GCM_NONCE_BYTES,
  SEC1_POINT_BYTES,
  aesGcmOpen,
  aesGcmSeal,
  ecdsaVerify,
  hkdfSha256,
  importAesKey,
  label,
  publicKeyFingerprint,
  sec1ToSpki,
  sha256,
  spkiToSec1,
} from './suite';
import { GLK2_ENVELOPE_VERSION, PROTOCOL_ID, SUITE_ID } from './versions';
import { P1363_LENGTH } from './ecdsaFormat';

export const HEADER_LENGTH = 171;
export const WRAPPED_KEY_LENGTH = AES_KEY_BYTES + 16;
export const ENVELOPE_LENGTH =
  HEADER_LENGTH + SEC1_POINT_BYTES + GCM_NONCE_BYTES + WRAPPED_KEY_LENGTH + P1363_LENGTH;

export const OFFSET = {
  magic: 0,
  envelopeVersion: 4,
  protocolId: 5,
  suiteId: 6,
  domain: 7,
  recipientKind: 8,
  reserved: 9,
  scopeKeyId: 11,
  ownerUserId: 27,
  scopeId: 43,
  epoch: 59,
  senderDeviceId: 67,
  senderSigPubFp: 83,
  recipientId: 115,
  recipientKemPubFp: 131,
  createdAtMs: 163,
} as const;

const MAGIC = new Uint8Array([0x47, 0x4c, 0x4b, 0x32]); // "GLK2"
const LABEL_SALT = label('gomsinlog/glk2/salt/v1');
const LABEL_KEK = label('gomsinlog/glk2/kek/v1');
const LABEL_AAD = label('gomsinlog/glk2/aad/v1');
const LABEL_SIG = label('gomsinlog/glk2/sig/v1');

export class Glk2Error extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'Glk2Error';
  }
}

function fail(code: string, message: string): never {
  throw new Glk2Error(code, message);
}

export type Glk2Header = {
  domain: KeyDomainCode;
  recipientKind: number;
  scopeKeyId: Uint8Array;
  ownerUserId: Uint8Array;
  scopeId: Uint8Array;
  epoch: bigint;
  senderDeviceId: Uint8Array;
  senderSigPubFp: Uint8Array;
  recipientId: Uint8Array;
  recipientKemPubFp: Uint8Array;
  createdAtMs: bigint;
};

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (value.length !== width) fail('E_FIELD_WIDTH', `${name} must be ${width} bytes, saw ${value.length}`);
  return value;
}

export function encodeHeader(header: Glk2Header): Uint8Array {
  const out = new Uint8Array(HEADER_LENGTH);
  out.set(MAGIC, OFFSET.magic);
  out[OFFSET.envelopeVersion] = GLK2_ENVELOPE_VERSION;
  out[OFFSET.protocolId] = PROTOCOL_ID;
  out[OFFSET.suiteId] = SUITE_ID;
  if (!Object.values(KEY_DOMAIN).includes(header.domain)) fail('E_BAD_DOMAIN', `unknown domain ${header.domain}`);
  out[OFFSET.domain] = header.domain;
  if (!Object.values(RECIPIENT_KIND).includes(header.recipientKind as 1 | 2)) {
    fail('E_BAD_RECIPIENT_KIND', `unknown recipient kind ${header.recipientKind}`);
  }
  out[OFFSET.recipientKind] = header.recipientKind;
  // bytes 9..10 stay zero
  out.set(fixed('scopeKeyId', header.scopeKeyId, 16), OFFSET.scopeKeyId);
  out.set(fixed('ownerUserId', header.ownerUserId, 16), OFFSET.ownerUserId);
  out.set(fixed('scopeId', header.scopeId, 16), OFFSET.scopeId);
  out.set(u64be(header.epoch), OFFSET.epoch);
  out.set(fixed('senderDeviceId', header.senderDeviceId, 16), OFFSET.senderDeviceId);
  out.set(fixed('senderSigPubFp', header.senderSigPubFp, 32), OFFSET.senderSigPubFp);
  out.set(fixed('recipientId', header.recipientId, 16), OFFSET.recipientId);
  out.set(fixed('recipientKemPubFp', header.recipientKemPubFp, 32), OFFSET.recipientKemPubFp);
  out.set(u64be(header.createdAtMs), OFFSET.createdAtMs);
  return out;
}

export function decodeHeader(header: Uint8Array): Glk2Header {
  if (header.length !== HEADER_LENGTH) fail('E_HEADER_LENGTH', `header must be ${HEADER_LENGTH} bytes`);
  if (!equalBytes(header.subarray(0, 4), MAGIC)) fail('E_BAD_MAGIC', 'magic is not GLK2');
  if (header[OFFSET.envelopeVersion] !== GLK2_ENVELOPE_VERSION) {
    fail('E_BAD_VERSION', `unsupported envelope version ${header[OFFSET.envelopeVersion]}`);
  }
  if (header[OFFSET.protocolId] !== PROTOCOL_ID) fail('E_BAD_PROTOCOL', 'unsupported protocol id');
  if (header[OFFSET.suiteId] !== SUITE_ID) fail('E_BAD_SUITE', 'unsupported suite id');
  // Reserved bytes carry no meaning yet, so a non-zero value means the sender
  // is speaking a dialect this build does not know. Fail rather than ignore.
  if (header[OFFSET.reserved] !== 0 || header[OFFSET.reserved + 1] !== 0) {
    fail('E_RESERVED_NONZERO', 'reserved bytes must be zero');
  }
  const domain = header[OFFSET.domain];
  if (!Object.values(KEY_DOMAIN).includes(domain as KeyDomainCode)) fail('E_BAD_DOMAIN', `unknown domain ${domain}`);
  const recipientKind = header[OFFSET.recipientKind];
  if (!Object.values(RECIPIENT_KIND).includes(recipientKind as 1 | 2)) {
    fail('E_BAD_RECIPIENT_KIND', `unknown recipient kind ${recipientKind}`);
  }
  return {
    domain: domain as KeyDomainCode,
    recipientKind,
    scopeKeyId: header.slice(OFFSET.scopeKeyId, OFFSET.scopeKeyId + 16),
    ownerUserId: header.slice(OFFSET.ownerUserId, OFFSET.ownerUserId + 16),
    scopeId: header.slice(OFFSET.scopeId, OFFSET.scopeId + 16),
    epoch: readU64be(header, OFFSET.epoch),
    senderDeviceId: header.slice(OFFSET.senderDeviceId, OFFSET.senderDeviceId + 16),
    senderSigPubFp: header.slice(OFFSET.senderSigPubFp, OFFSET.senderSigPubFp + 32),
    recipientId: header.slice(OFFSET.recipientId, OFFSET.recipientId + 16),
    recipientKemPubFp: header.slice(OFFSET.recipientKemPubFp, OFFSET.recipientKemPubFp + 32),
    createdAtMs: readU64be(header, OFFSET.createdAtMs),
  };
}

export type Glk2Parts = {
  header: Uint8Array;
  ephemeralPub: Uint8Array;
  nonce: Uint8Array;
  wrappedKey: Uint8Array;
  signature: Uint8Array;
};

export function splitEnvelope(envelope: Uint8Array): Glk2Parts {
  if (envelope.length !== ENVELOPE_LENGTH) {
    fail('E_ENVELOPE_LENGTH', `envelope must be ${ENVELOPE_LENGTH} bytes, saw ${envelope.length}`);
  }
  let at = HEADER_LENGTH;
  const header = envelope.slice(0, HEADER_LENGTH);
  const ephemeralPub = envelope.slice(at, (at += SEC1_POINT_BYTES));
  const nonce = envelope.slice(at, (at += GCM_NONCE_BYTES));
  const wrappedKey = envelope.slice(at, (at += WRAPPED_KEY_LENGTH));
  const signature = envelope.slice(at, at + P1363_LENGTH);
  if (ephemeralPub[0] !== 0x04) fail('E_BAD_POINT_FORMAT', 'ephemeral point must be SEC1 uncompressed');
  return { header, ephemeralPub, nonce, wrappedKey, signature };
}

// --- exact derivation inputs, byte for byte ---------------------------------

export async function kekSalt(ephemeralPub: Uint8Array, recipientKemSpki: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(LABEL_SALT, ephemeralPub, recipientKemSpki));
}

export function kekInfo(header: Uint8Array): Uint8Array {
  return concat(LABEL_KEK, header);
}

export function envelopeAad(header: Uint8Array, ephemeralPub: Uint8Array): Uint8Array {
  return concat(LABEL_AAD, header, ephemeralPub);
}

export function signedMessage(
  header: Uint8Array,
  ephemeralPub: Uint8Array,
  nonce: Uint8Array,
  wrappedKey: Uint8Array,
): Uint8Array {
  return concat(LABEL_SIG, header, ephemeralPub, nonce, wrappedKey);
}

async function deriveKek(
  sharedSecret: Uint8Array,
  ephemeralPub: Uint8Array,
  recipientKemSpki: Uint8Array,
  header: Uint8Array,
): Promise<CryptoKey> {
  const salt = await kekSalt(ephemeralPub, recipientKemSpki);
  const bits = await hkdfSha256(sharedSecret, salt, kekInfo(header), AES_KEY_BYTES);
  const key = await importAesKey(bits, ['encrypt', 'decrypt']);
  zeroize(bits);
  return key;
}

// --- seal -------------------------------------------------------------------

export type SealInput = {
  header: Omit<Glk2Header, 'senderSigPubFp' | 'recipientKemPubFp'>;
  /** Raw 32 bytes. The caller zeroizes it; this module does not own it. */
  scopeKey: Uint8Array;
  senderSigSpki: Uint8Array;
  recipientKemSpki: Uint8Array;
  /** Ephemeral ECDH: returns the shared secret and the public point. */
  ephemeral: {
    publicKeySec1: Uint8Array;
    sharedSecret: Uint8Array;
  };
  nonce: Uint8Array;
  /** Signs with the sender's `dev_sig` handle. Must return P-1363. */
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

export async function sealEnvelope(input: SealInput): Promise<Uint8Array> {
  if (input.scopeKey.length !== AES_KEY_BYTES) {
    fail('E_SCOPE_KEY_WIDTH', `scope key must be ${AES_KEY_BYTES} bytes`);
  }
  if (input.ephemeral.publicKeySec1.length !== SEC1_POINT_BYTES) {
    fail('E_BAD_POINT_LENGTH', 'ephemeral point must be 65 bytes');
  }
  if (input.nonce.length !== GCM_NONCE_BYTES) fail('E_BAD_NONCE', 'nonce must be 12 bytes');

  const senderSigPubFp = await publicKeyFingerprint(input.senderSigSpki);
  const recipientKemPubFp = await publicKeyFingerprint(input.recipientKemSpki);
  const header = encodeHeader({ ...input.header, senderSigPubFp, recipientKemPubFp });

  const kek = await deriveKek(
    input.ephemeral.sharedSecret,
    input.ephemeral.publicKeySec1,
    input.recipientKemSpki,
    header,
  );
  const wrappedKey = await aesGcmSeal(
    kek,
    input.nonce,
    input.scopeKey,
    envelopeAad(header, input.ephemeral.publicKeySec1),
  );
  if (wrappedKey.length !== WRAPPED_KEY_LENGTH) {
    fail('E_WRAPPED_LENGTH', `wrapped key must be ${WRAPPED_KEY_LENGTH} bytes`);
  }

  const signature = await input.sign(
    signedMessage(header, input.ephemeral.publicKeySec1, input.nonce, wrappedKey),
  );
  if (signature.length !== P1363_LENGTH) fail('E_BAD_SIGNATURE_LENGTH', 'signature must be 64 bytes');

  const envelope = concat(header, input.ephemeral.publicKeySec1, input.nonce, wrappedKey, signature);
  if (envelope.length !== ENVELOPE_LENGTH) fail('E_ENVELOPE_LENGTH', 'assembled envelope has the wrong length');
  return envelope;
}

// --- open -------------------------------------------------------------------

export type OpenInput = {
  envelope: Uint8Array;
  /** This device's `dev_kem` SPKI. Must match the envelope's recipient. */
  recipientKemSpki: Uint8Array;
  /** The sender's `dev_sig` SPKI, obtained from a VERIFIED certificate chain. */
  senderSigSpki: Uint8Array;
  /** ECDH against the envelope's ephemeral point, by handle. */
  deriveSecret: (peerSpki: Uint8Array) => Promise<Uint8Array>;
};

/**
 * Verify and unwrap.
 *
 * Order matters and is fail-closed throughout: structure, then the two
 * fingerprints, then the signature, then the AEAD. The caller must already have
 * established that `senderSigSpki` belongs to a device whose certificate chain
 * verifies to the pinned recovery root — this function deliberately cannot
 * check that, because trust resolution is not an envelope concern.
 */
export async function openEnvelope(input: OpenInput): Promise<{ scopeKey: Uint8Array; header: Glk2Header }> {
  const parts = splitEnvelope(input.envelope);
  const header = decodeHeader(parts.header);

  const expectedRecipientFp = await publicKeyFingerprint(input.recipientKemSpki);
  if (!equalBytes(header.recipientKemPubFp, expectedRecipientFp)) {
    fail('E_RECIPIENT_FP_MISMATCH', 'envelope is not addressed to this agreement key');
  }
  const expectedSenderFp = await publicKeyFingerprint(input.senderSigSpki);
  if (!equalBytes(header.senderSigPubFp, expectedSenderFp)) {
    fail('E_SENDER_FP_MISMATCH', 'sender fingerprint does not match the supplied signing key');
  }

  const signatureOk = await ecdsaVerify(
    input.senderSigSpki,
    signedMessage(parts.header, parts.ephemeralPub, parts.nonce, parts.wrappedKey),
    parts.signature,
  );
  if (!signatureOk) fail('E_BAD_SIGNATURE', 'sender signature did not verify');

  // Validates the point before any secret is derived from it.
  const ephemeralSpki = sec1ToSpki(parts.ephemeralPub);
  const shared = await input.deriveSecret(ephemeralSpki);
  const kek = await deriveKek(shared, parts.ephemeralPub, input.recipientKemSpki, parts.header);
  zeroize(shared);

  const scopeKey = await aesGcmOpen(
    kek,
    parts.nonce,
    parts.wrappedKey,
    envelopeAad(parts.header, parts.ephemeralPub),
  );
  if (scopeKey.length !== AES_KEY_BYTES) fail('E_SCOPE_KEY_WIDTH', 'unwrapped key is not 32 bytes');
  return { scopeKey, header };
}

/** Convenience for callers holding an SPKI rather than a raw point. */
export function ephemeralPointFromSpki(spki: Uint8Array): Uint8Array {
  return spkiToSec1(spki);
}
