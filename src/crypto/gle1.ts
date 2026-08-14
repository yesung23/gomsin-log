/**
 * GLE1 — the content envelope. Architecture V2.1 section 16.
 *
 * Phase 1A defines and tests the format; no application content is encrypted
 * with it yet. Phase 1B is where record text starts using it.
 *
 * Header layout, every offset stated explicitly because an earlier revision of
 * this file declared an 84-byte header while writing a 12-byte nonce at offset
 * 80 — a 92-byte layout in an 84-byte buffer. It was never caught because the
 * module had no tests at all. Every offset below is now a named constant and
 * `GLE1_HEADER_LENGTH` is derived from the last field rather than asserted.
 *
 *   off  len  field
 *     0    4  magic "GLE1"
 *     4    1  format_version
 *     5    1  protocol_id
 *     6    1  suite_id
 *     7    1  domain
 *     8    1  flags            (bit 0 reserved for streaming; MUST be 0)
 *     9    3  reserved         (MUST be zero)
 *    12    8  key_epoch        u64 big-endian
 *    20   12  dek_wrap_nonce
 *    32   48  wrapped_dek      32-byte DEK + 16-byte tag
 *    80   12  content_nonce
 *   ---------
 *          92  total
 *
 * Streaming is deliberately absent. Phase 1A-1 established that Tink Streaming
 * AEAD exists for only one of the three targets, so no chunking construction is
 * specified here rather than inventing one.
 */

import { concat, readU64be, u64be, utf8 } from './bytes';
import { KEY_DOMAIN, type KeyDomainCode } from './domains';
import {
  AES_KEY_BYTES,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  aesGcmOpen,
  aesGcmSeal,
  importAesKey,
  randomBytes,
  randomNonce,
} from './suite';
import { CIPHER_FORMAT, GLE1_FORMAT_VERSION, PROTOCOL_ID, SUITE_ID } from './versions';

export const WRAPPED_DEK_LENGTH = AES_KEY_BYTES + GCM_TAG_BYTES; // 48

/** Explicit offsets. The total is derived, never hand-written. */
export const GLE1_OFFSET = {
  magic: 0,
  formatVersion: 4,
  protocolId: 5,
  suiteId: 6,
  domain: 7,
  flags: 8,
  reserved: 9,
  keyEpoch: 12,
  dekWrapNonce: 20,
  wrappedDek: 32,
  contentNonce: 80,
} as const;

export const GLE1_HEADER_LENGTH = GLE1_OFFSET.contentNonce + GCM_NONCE_BYTES; // 92

const MAGIC = new Uint8Array([0x47, 0x4c, 0x45, 0x31]); // "GLE1"
const AAD_LABEL = utf8('gomsinlog/content/v1');

/** Object types. Wire values; never renumber. */
export const OBJECT_TYPE = {
  dailyRecord: 1,
  event: 2,
  tripItem: 3,
  cyclePeriod: 4,
  cycleDailyLog: 5,
  attachment: 6,
  cycleProjection: 7,
  /** V1 text chat message. Never reuse this value for another object class. */
  chatMessage: 8,
} as const;

/** Field ids within an object. */
export const FIELD_ID = {
  logText: 1,
  emotionFlow: 2,
  attachmentManifest: 3,
  reaction: 4,
  recordTime: 5,
  note: 6,
  title: 7,
  memo: 8,
  /** The text-only chat payload document. */
  messageText: 9,
} as const;

export class Gle1Error extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'Gle1Error';
  }
}

function fail(code: string, message: string): never {
  throw new Gle1Error(code, message);
}

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (value.length !== width) fail('E_FIELD_WIDTH', `${name} must be ${width} bytes, saw ${value.length}`);
  return value;
}

export type Gle1Aad = {
  domain: KeyDomainCode;
  keyEpoch: bigint;
  ownerUserId: Uint8Array;
  scopeId: Uint8Array;
  objectType: number;
  objectId: Uint8Array;
  fieldId: number;
  /** Server-validated monotonic counter, starting at 1. */
  contentRevision: bigint;
};

/**
 * Build the associated data. Fixed layout, never JSON.
 *
 * Bound: protocol, suite, format version, domain, epoch, owner, scope, object
 * type and id, field, revision. Together these stop a ciphertext being moved
 * between records, users, couples, domains, epochs or fields, and stop an older
 * revision of the same object being replayed.
 *
 * Deliberately NOT bound: `record_date`, `is_private`, `updated_at`. Those are
 * mutable and binding them would make an ordinary edit fail authentication.
 * `is_private` is safe to omit because visibility is enforced by the key
 * domain, not the flag — and the database now refuses a private record wrapped
 * under a couple key outright, so the two cannot drift apart.
 */
export function buildAad(aad: Gle1Aad): Uint8Array {
  if (aad.contentRevision <= 0n) fail('E_BAD_REVISION', 'content revision starts at 1');
  if (!Object.values(KEY_DOMAIN).includes(aad.domain)) fail('E_BAD_DOMAIN', 'unknown key domain');
  if (aad.objectType <= 0 || aad.objectType > 255) fail('E_BAD_OBJECT_TYPE', 'object type out of range');
  if (aad.fieldId <= 0 || aad.fieldId > 255) fail('E_BAD_FIELD_ID', 'field id out of range');
  return concat(
    AAD_LABEL,
    new Uint8Array([GLE1_FORMAT_VERSION, PROTOCOL_ID, SUITE_ID, aad.domain]),
    u64be(aad.keyEpoch),
    fixed('ownerUserId', aad.ownerUserId, 16),
    fixed('scopeId', aad.scopeId, 16),
    new Uint8Array([aad.objectType]),
    fixed('objectId', aad.objectId, 16),
    new Uint8Array([aad.fieldId]),
    u64be(aad.contentRevision),
  );
}

export type Gle1Header = {
  domain: KeyDomainCode;
  keyEpoch: bigint;
  flags: number;
  dekWrapNonce: Uint8Array;
  wrappedDek: Uint8Array;
  contentNonce: Uint8Array;
};

export function encodeHeader(header: Gle1Header): Uint8Array {
  if (header.flags !== 0) fail('E_FLAGS_RESERVED', 'no GLE1 flag is defined yet; streaming is unresolved');
  if (!Object.values(KEY_DOMAIN).includes(header.domain)) fail('E_BAD_DOMAIN', 'unknown key domain');
  const out = new Uint8Array(GLE1_HEADER_LENGTH);
  out.set(MAGIC, GLE1_OFFSET.magic);
  out[GLE1_OFFSET.formatVersion] = GLE1_FORMAT_VERSION;
  out[GLE1_OFFSET.protocolId] = PROTOCOL_ID;
  out[GLE1_OFFSET.suiteId] = SUITE_ID;
  out[GLE1_OFFSET.domain] = header.domain;
  out[GLE1_OFFSET.flags] = header.flags;
  // bytes 9..11 reserved, left zero
  out.set(u64be(header.keyEpoch), GLE1_OFFSET.keyEpoch);
  out.set(fixed('dekWrapNonce', header.dekWrapNonce, GCM_NONCE_BYTES), GLE1_OFFSET.dekWrapNonce);
  out.set(fixed('wrappedDek', header.wrappedDek, WRAPPED_DEK_LENGTH), GLE1_OFFSET.wrappedDek);
  out.set(fixed('contentNonce', header.contentNonce, GCM_NONCE_BYTES), GLE1_OFFSET.contentNonce);
  return out;
}

export function decodeHeader(bytes: Uint8Array): Gle1Header {
  if (bytes.length < GLE1_HEADER_LENGTH) {
    fail('E_HEADER_LENGTH', `GLE1 header must be at least ${GLE1_HEADER_LENGTH} bytes, saw ${bytes.length}`);
  }
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (bytes[GLE1_OFFSET.magic + i] !== MAGIC[i]) fail('E_BAD_MAGIC', 'magic is not GLE1');
  }
  if (bytes[GLE1_OFFSET.formatVersion] !== GLE1_FORMAT_VERSION) {
    fail('E_BAD_VERSION', `unsupported GLE1 version ${bytes[GLE1_OFFSET.formatVersion]}`);
  }
  if (bytes[GLE1_OFFSET.protocolId] !== PROTOCOL_ID) fail('E_BAD_PROTOCOL', 'unsupported protocol id');
  if (bytes[GLE1_OFFSET.suiteId] !== SUITE_ID) fail('E_BAD_SUITE', 'unsupported suite id');
  const domain = bytes[GLE1_OFFSET.domain];
  if (!Object.values(KEY_DOMAIN).includes(domain as KeyDomainCode)) fail('E_BAD_DOMAIN', 'unknown key domain');
  if (bytes[GLE1_OFFSET.flags] !== 0) fail('E_FLAGS_RESERVED', 'unknown GLE1 flag set');
  for (let i = 0; i < 3; i += 1) {
    if (bytes[GLE1_OFFSET.reserved + i] !== 0) fail('E_RESERVED_NONZERO', 'reserved bytes must be zero');
  }
  return {
    domain: domain as KeyDomainCode,
    keyEpoch: readU64be(bytes, GLE1_OFFSET.keyEpoch),
    flags: 0,
    dekWrapNonce: bytes.slice(GLE1_OFFSET.dekWrapNonce, GLE1_OFFSET.dekWrapNonce + GCM_NONCE_BYTES),
    wrappedDek: bytes.slice(GLE1_OFFSET.wrappedDek, GLE1_OFFSET.wrappedDek + WRAPPED_DEK_LENGTH),
    contentNonce: bytes.slice(GLE1_OFFSET.contentNonce, GLE1_OFFSET.contentNonce + GCM_NONCE_BYTES),
  };
}

/** Total encoded size for a plaintext of `n` bytes. */
export function encodedLength(plaintextLength: number): number {
  return GLE1_HEADER_LENGTH + plaintextLength + GCM_TAG_BYTES;
}

// ---------------------------------------------------------------------------
// seal / open
// ---------------------------------------------------------------------------

export type SealContentInput = {
  /** The scope key, imported non-extractable. Wraps the DEK; never the content. */
  scopeKey: CryptoKey;
  plaintext: Uint8Array;
  aad: Gle1Aad;
};

/**
 * Encrypt one field.
 *
 * A fresh random DEK per object keeps every content key to a single message,
 * which is what makes a 96-bit random nonce safe here without any counter.
 */
export async function sealContent(input: SealContentInput): Promise<Uint8Array> {
  const aadBytes = buildAad(input.aad);
  const dekBytes = randomBytes(AES_KEY_BYTES);
  try {
    const dekWrapNonce = randomNonce();
    const wrappedDek = await aesGcmSeal(input.scopeKey, dekWrapNonce, dekBytes, aadBytes);
    if (wrappedDek.length !== WRAPPED_DEK_LENGTH) fail('E_WRAPPED_DEK_WIDTH', 'unexpected wrapped DEK width');

    const contentNonce = randomNonce();
    const dek = await importAesKey(dekBytes, ['encrypt']);
    const ciphertext = await aesGcmSeal(dek, contentNonce, input.plaintext, aadBytes);

    const header = encodeHeader({
      domain: input.aad.domain,
      keyEpoch: input.aad.keyEpoch,
      flags: 0,
      dekWrapNonce,
      wrappedDek,
      contentNonce,
    });
    const envelope = concat(header, ciphertext);
    if (envelope.length !== encodedLength(input.plaintext.length)) {
      fail('E_ENVELOPE_LENGTH', 'assembled envelope has the wrong length');
    }
    return envelope;
  } finally {
    dekBytes.fill(0);
  }
}

export type OpenContentInput = {
  scopeKey: CryptoKey;
  envelope: Uint8Array;
  aad: Gle1Aad;
};

export async function openContent(input: OpenContentInput): Promise<Uint8Array> {
  if (input.envelope.length < encodedLength(0)) {
    fail('E_ENVELOPE_LENGTH', `envelope must be at least ${encodedLength(0)} bytes`);
  }
  const header = decodeHeader(input.envelope);

  // The header's routing fields must agree with the associated data the caller
  // built, or the caller is decrypting under assumptions the envelope does not
  // share.
  if (header.domain !== input.aad.domain) fail('E_DOMAIN_MISMATCH', 'envelope domain differs from the AAD');
  if (header.keyEpoch !== input.aad.keyEpoch) fail('E_EPOCH_MISMATCH', 'envelope epoch differs from the AAD');

  const aadBytes = buildAad(input.aad);
  const dekBytes = await aesGcmOpen(input.scopeKey, header.dekWrapNonce, header.wrappedDek, aadBytes);
  try {
    if (dekBytes.length !== AES_KEY_BYTES) fail('E_DEK_WIDTH', 'unwrapped DEK is not 32 bytes');
    const dek = await importAesKey(dekBytes, ['decrypt']);
    const ciphertext = input.envelope.subarray(GLE1_HEADER_LENGTH);
    return await aesGcmOpen(dek, header.contentNonce, ciphertext, aadBytes);
  } finally {
    dekBytes.fill(0);
  }
}

/**
 * Decide how to read a row.
 *
 * `cipher_format = 0` means plaintext, explicitly and by column value. Nothing
 * infers encryption from whether a value looks like base64.
 */
export function readStrategy(cipherFormat: number): 'plaintext' | 'gle1' | 'unsupported' {
  if (cipherFormat === CIPHER_FORMAT.plaintext) return 'plaintext';
  if (cipherFormat === CIPHER_FORMAT.gle1) return 'gle1';
  return 'unsupported';
}
