/**
 * SPIKE ONLY — experimental GLK2 key-envelope codec (Architecture V2.1 §7).
 *
 * Written to produce cross-platform interoperability evidence for Phase 1A-3.
 * It is NOT production code, is not wired to any application data, and must be
 * rewritten from the specification rather than copied.
 *
 * Layout (Architecture V2.1 §7): header 171 || ephemeral_pub 65 || nonce 12 ||
 * wrapped_key 48 || signature 64 = 360 bytes, fixed.
 */

import { ascii, concat, leftPad, readU64be, u64be } from './bytes.ts';

export const HEADER_LENGTH = 171;
export const ENVELOPE_LENGTH = 360;

const EPHEMERAL_PUB_LENGTH = 65;
const NONCE_LENGTH = 12;
const WRAPPED_KEY_LENGTH = 48;
const SIGNATURE_LENGTH = 64;

export const OFFSETS = {
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

const MAGIC = ascii('GLK2');
const LABEL_SALT = ascii('gomsinlog/glk2/salt/v1');
const LABEL_KEK = ascii('gomsinlog/glk2/kek/v1');
const LABEL_AAD = ascii('gomsinlog/glk2/aad/v1');
const LABEL_SIG = ascii('gomsinlog/glk2/sig/v1');

export type Glk2Header = {
  domain: number;
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

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (value.length !== width) fail('E_FIELD_WIDTH', `${name} must be ${width} bytes, saw ${value.length}`);
  return value;
}

export function encodeHeader(h: Glk2Header): Uint8Array {
  const out = new Uint8Array(HEADER_LENGTH);
  out.set(MAGIC, OFFSETS.magic);
  out[OFFSETS.envelopeVersion] = 2;
  out[OFFSETS.protocolId] = 1;
  out[OFFSETS.suiteId] = 1;
  out[OFFSETS.domain] = h.domain;
  out[OFFSETS.recipientKind] = h.recipientKind;
  // reserved u16 stays zero
  out.set(fixed('scopeKeyId', h.scopeKeyId, 16), OFFSETS.scopeKeyId);
  out.set(fixed('ownerUserId', h.ownerUserId, 16), OFFSETS.ownerUserId);
  out.set(fixed('scopeId', h.scopeId, 16), OFFSETS.scopeId);
  out.set(u64be(h.epoch), OFFSETS.epoch);
  out.set(fixed('senderDeviceId', h.senderDeviceId, 16), OFFSETS.senderDeviceId);
  out.set(fixed('senderSigPubFp', h.senderSigPubFp, 32), OFFSETS.senderSigPubFp);
  out.set(fixed('recipientId', h.recipientId, 16), OFFSETS.recipientId);
  out.set(fixed('recipientKemPubFp', h.recipientKemPubFp, 32), OFFSETS.recipientKemPubFp);
  out.set(u64be(h.createdAtMs), OFFSETS.createdAtMs);
  return out;
}

export function decodeHeader(header: Uint8Array): Glk2Header {
  if (header.length !== HEADER_LENGTH) fail('E_HEADER_LENGTH', `header must be ${HEADER_LENGTH} bytes`);
  for (let i = 0; i < 4; i += 1) {
    if (header[OFFSETS.magic + i] !== MAGIC[i]) fail('E_BAD_MAGIC', 'magic is not GLK2');
  }
  if (header[OFFSETS.envelopeVersion] !== 2) fail('E_BAD_VERSION', 'envelope_version must be 2');
  if (header[OFFSETS.protocolId] !== 1) fail('E_BAD_PROTOCOL', 'protocol_id must be 1');
  if (header[OFFSETS.suiteId] !== 1) fail('E_BAD_SUITE', 'suite_id must be 1');
  if (header[OFFSETS.reserved] !== 0 || header[OFFSETS.reserved + 1] !== 0) {
    fail('E_RESERVED_NONZERO', 'reserved bytes must be zero');
  }
  return {
    domain: header[OFFSETS.domain],
    recipientKind: header[OFFSETS.recipientKind],
    scopeKeyId: header.slice(OFFSETS.scopeKeyId, OFFSETS.scopeKeyId + 16),
    ownerUserId: header.slice(OFFSETS.ownerUserId, OFFSETS.ownerUserId + 16),
    scopeId: header.slice(OFFSETS.scopeId, OFFSETS.scopeId + 16),
    epoch: readU64be(header, OFFSETS.epoch),
    senderDeviceId: header.slice(OFFSETS.senderDeviceId, OFFSETS.senderDeviceId + 16),
    senderSigPubFp: header.slice(OFFSETS.senderSigPubFp, OFFSETS.senderSigPubFp + 32),
    recipientId: header.slice(OFFSETS.recipientId, OFFSETS.recipientId + 16),
    recipientKemPubFp: header.slice(OFFSETS.recipientKemPubFp, OFFSETS.recipientKemPubFp + 32),
    createdAtMs: readU64be(header, OFFSETS.createdAtMs),
  };
}

export function splitEnvelope(envelope: Uint8Array) {
  if (envelope.length !== ENVELOPE_LENGTH) {
    fail('E_ENVELOPE_LENGTH', `envelope must be ${ENVELOPE_LENGTH} bytes, saw ${envelope.length}`);
  }
  let at = HEADER_LENGTH;
  const header = envelope.slice(0, HEADER_LENGTH);
  const ephemeralPub = envelope.slice(at, (at += EPHEMERAL_PUB_LENGTH));
  const nonce = envelope.slice(at, (at += NONCE_LENGTH));
  const wrappedKey = envelope.slice(at, (at += WRAPPED_KEY_LENGTH));
  const signature = envelope.slice(at, at + SIGNATURE_LENGTH);
  if (ephemeralPub[0] !== 0x04) fail('E_BAD_POINT_FORMAT', 'ephemeral_pub must be SEC1 uncompressed (0x04)');
  return { header, ephemeralPub, nonce, wrappedKey, signature };
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export function kekSaltInput(ephemeralPub: Uint8Array, recipientKemSpki: Uint8Array): Uint8Array {
  return concat(LABEL_SALT, ephemeralPub, recipientKemSpki);
}

export function kekInfo(header: Uint8Array): Uint8Array {
  return concat(LABEL_KEK, header);
}

export function aad(header: Uint8Array, ephemeralPub: Uint8Array): Uint8Array {
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

/**
 * The shared-secret rule the native plugin must honour.
 *
 * WebCrypto `deriveBits` returns the field-width X coordinate. Native key
 * agreement APIs have historically returned a minimal-length integer with
 * leading zeros stripped, so anything shorter is left-zero-padded here and
 * anything longer is a hard error rather than a silent truncation.
 */
export function normalizeSharedSecret(raw: Uint8Array): Uint8Array {
  if (raw.length > 32) fail('E_SHARED_SECRET_WIDTH', `shared secret ${raw.length} bytes, expected <= 32`);
  return leftPad(raw, 32);
}

export async function deriveKek(
  sharedSecret: Uint8Array,
  ephemeralPub: Uint8Array,
  recipientKemSpki: Uint8Array,
  header: Uint8Array,
): Promise<CryptoKey> {
  const z = normalizeSharedSecret(sharedSecret);
  const salt = await sha256(kekSaltInput(ephemeralPub, recipientKemSpki));
  const ikm = await crypto.subtle.importKey('raw', z as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: kekInfo(header) as BufferSource },
    ikm,
    256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
