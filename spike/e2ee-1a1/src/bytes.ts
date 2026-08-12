/** SPIKE ONLY — byte and 64-bit helpers. Not production code. */

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function unhex(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error('odd hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('bad hex');
    out[i] = byte;
  }
  return out;
}

export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function unb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * 64-bit protocol fields, BigInt end to end.
 *
 * `Number` is never acceptable here: `epoch`, `content_revision`,
 * `membership_revision` and `*_at_ms` are all specified as 64-bit and silently
 * lose precision above 2^53 if they pass through a JS number.
 */
export function u64be(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`u64 out of range: ${value}`);
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
}

export function readU64be(bytes: Uint8Array, offset: number): bigint {
  if (offset + 8 > bytes.length) throw new RangeError('u64 read out of bounds');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, false);
}

/** Left-zero-pad to an exact width. Rejects anything already too long. */
export function leftPad(bytes: Uint8Array, width: number): Uint8Array {
  if (bytes.length > width) throw new RangeError(`value wider than ${width}: ${bytes.length}`);
  if (bytes.length === width) return bytes;
  const out = new Uint8Array(width);
  out.set(bytes, width - bytes.length);
  return out;
}

/** UUID text -> 16 bytes. */
export function uuidBytes(uuid: string): Uint8Array {
  return unhex(uuid.replace(/-/g, ''));
}
