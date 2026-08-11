/**
 * Byte and 64-bit helpers for the E2EE protocol.
 *
 * Pure. Imports nothing from React, Supabase, the store, or any repository, and
 * must stay that way: `src/crypto/**` is the layer an independent reviewer reads
 * on its own.
 *
 * The 64-bit helpers exist because `key_epoch`, `content_revision` and
 * `membership_revision` are specified as 64-bit and a JavaScript `Number`
 * silently rewrites anything above 2^53. Phase 1A-1 measured that directly:
 * `9223372036854775807` came back from `JSON.parse` as `9223372036854776000`
 * with no error. Every protocol integer here is a `bigint`.
 */

export function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function unhex(text: string): Uint8Array {
  const clean = text.trim();
  if (clean.length % 2 !== 0) throw new RangeError('hex string has odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isInteger(byte)) throw new RangeError('hex string has a non-hex character');
    out[i] = byte;
  }
  return out;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without depending on `Buffer`, so this runs unchanged in the browser. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64_ALPHABET[c & 63];
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new RangeError('not base64');
  const body = clean.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const ch of body) {
    const value = B64_ALPHABET.indexOf(ch);
    if (value < 0) throw new RangeError('not base64');
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }
  return out.subarray(0, at);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const encoder = new TextEncoder();

/** UTF-8 encode. Protocol labels are ASCII, but callers are not trusted to be. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/**
 * Constant-time equality.
 *
 * Used for fingerprint and tag comparisons where a length-or-prefix leak would
 * hand an attacker a search oracle.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Left-zero-pad to an exact width; reject anything already wider. */
export function leftPad(bytes: Uint8Array, width: number): Uint8Array {
  if (bytes.length > width) throw new RangeError(`value is ${bytes.length} bytes, wider than ${width}`);
  if (bytes.length === width) return bytes;
  const out = new Uint8Array(width);
  out.set(bytes, width - bytes.length);
  return out;
}

export const U64_MAX = 0xffff_ffff_ffff_ffffn;
/** Postgres `bigint` is signed, so protocol counters stop here. */
export const I64_MAX = 0x7fff_ffff_ffff_ffffn;

export function u64be(value: bigint): Uint8Array {
  if (typeof value !== 'bigint') throw new TypeError('64-bit protocol fields must be bigint, never number');
  if (value < 0n || value > U64_MAX) throw new RangeError(`u64 out of range: ${value}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
}

export function readU64be(bytes: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError('u64 read out of bounds');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, false);
}

/**
 * Parse a 64-bit value that arrived from the database.
 *
 * A JSON number is refused above the safe-integer range rather than rounded,
 * because rounding is exactly the silent corruption Phase 1A-1 measured. The
 * repository layer selects these columns as text; this is the guard for
 * anything that slips through.
 */
export function parseProtocolU64(value: unknown, field: string): bigint {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) throw new RangeError(`${field}: not a base-10 64-bit value`);
    parsed = BigInt(value);
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${field}: arrived as an unsafe JSON number; select it as text`);
    }
    parsed = BigInt(value);
  } else {
    throw new TypeError(`${field}: unsupported 64-bit representation`);
  }
  if (parsed < 0n || parsed > I64_MAX) throw new RangeError(`${field}: outside the signed 64-bit range`);
  return parsed;
}

/** UUID text to its 16 canonical bytes. Rejects anything that is not a UUID. */
export function uuidToBytes(uuid: string): Uint8Array {
  const clean = uuid.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) {
    throw new RangeError(`not a UUID: ${uuid}`);
  }
  return unhex(clean.replace(/-/g, ''));
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RangeError('UUID must be 16 bytes');
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Best-effort erasure of key material.
 *
 * Stated honestly because the architecture depends on the distinction: this
 * overwrites the bytes of THIS buffer. JavaScript offers no guarantee that the
 * garbage collector has not already copied them elsewhere, and there is no way
 * to reach such a copy. Treat it as defence in depth, never as a guarantee, and
 * never place key material in a `string`, which cannot be overwritten at all.
 */
export function zeroize(...buffers: (Uint8Array | undefined | null)[]): void {
  for (const buffer of buffers) if (buffer) buffer.fill(0);
}
