/**
 * Wire codec for the E2EE tables.
 *
 * Two representations cross this boundary and both have a history of silent
 * corruption, so both are converted explicitly and neither is ever guessed at:
 *
 *   bytea   PostgREST renders it as Postgres hex output — a literal backslash,
 *           an `x`, then lowercase hex. It accepts the same form on the way in.
 *           A value that does not look like that is refused rather than coerced,
 *           because "coerced key material" is indistinguishable from corrupted
 *           key material until an AEAD fails months later.
 *
 *   bigint  Selected as text (`column::text`) and parsed to `bigint`. Phase
 *           1A-1 measured `9223372036854775807` arriving from `JSON.parse` as
 *           `9223372036854776000` with no error, which is why nothing here
 *           accepts a raw JSON number for an epoch or a sequence unless it is
 *           provably inside the safe-integer range.
 */

import { hex, parseProtocolU64, unhex } from '@/crypto/bytes';

export class E2eeCodecError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'E2eeCodecError';
  }
}

function fail(code: string, message: string): never {
  throw new E2eeCodecError(code, message);
}

/** `Uint8Array` → the `\x…` literal PostgREST accepts for a `bytea` column. */
export function encodeBytea(bytes: Uint8Array): string {
  return `\\x${hex(bytes)}`;
}

/**
 * A `bytea` value as it arrives, back to bytes.
 *
 * Accepts the `\x…` hex form and a byte array, which is what a driver that
 * decodes binary itself hands back. Everything else — including a bare hex
 * string, which is ambiguous with a text column — is an error.
 */
export function decodeBytea(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return Uint8Array.from(value as number[]);
  }
  if (typeof value !== 'string') fail('E_BYTEA_TYPE', `${field}: expected a bytea value, saw ${typeof value}`);
  if (!value.startsWith('\\x')) {
    fail('E_BYTEA_FORMAT', `${field}: expected Postgres hex output beginning with \\x`);
  }
  const body = value.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(body) || body.length % 2 !== 0) {
    fail('E_BYTEA_FORMAT', `${field}: bytea payload is not even-length hex`);
  }
  return unhex(body);
}

export function decodeByteaOrNull(value: unknown, field: string): Uint8Array | null {
  if (value === null || value === undefined) return null;
  return decodeBytea(value, field);
}

/** Postgres accepts a decimal string for `bigint`; a JSON number is never sent. */
export function encodeBigint(value: bigint): string {
  if (typeof value !== 'bigint') fail('E_BIGINT_TYPE', '64-bit columns must be written as bigint');
  if (value < 0n) fail('E_BIGINT_RANGE', 'protocol counters are non-negative');
  return value.toString(10);
}

export function decodeBigint(value: unknown, field: string): bigint {
  if (value === null || value === undefined) fail('E_BIGINT_NULL', `${field}: expected a 64-bit value, saw null`);
  return parseProtocolU64(value, field);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('E_FIELD_TYPE', `${field}: expected a non-empty string`);
  }
  return value;
}

export function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, field);
}

/**
 * A SMALLINT column, which PostgREST renders as a JSON number.
 *
 * Range-checked rather than trusted: `recovery_version` and `granted_domains`
 * are both bound into signed transcripts, so a value outside the byte range is a
 * malformed row and not something to round into shape.
 */
export function decodeSmallint(value: unknown, field: string, max = 32767): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail('E_FIELD_TYPE', `${field}: expected an integer`);
  }
  if (value < 0 || value > max) fail('E_FIELD_RANGE', `${field}: ${value} is outside 0..${max}`);
  return value;
}

export function decodeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail('E_FIELD_TYPE', `${field}: expected a boolean`);
  return value;
}

/** One of a fixed set. Anything else is a schema the client does not know. */
export function decodeEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const text = requireString(value, field);
  if (!(allowed as readonly string[]).includes(text)) {
    fail('E_FIELD_ENUM', `${field}: ${text} is not one of ${allowed.join(', ')}`);
  }
  return text as T;
}

export function timestampMs(value: unknown, field: string): bigint {
  const text = requireString(value, field);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) fail('E_FIELD_TYPE', `${field}: not a timestamp`);
  return BigInt(parsed);
}
