/**
 * SPIKE ONLY — strict ECDSA P-256 signature format conversion.
 *
 * WebCrypto emits and consumes P-1363 (`r || s`, fixed width). Apple Security
 * framework and the Java/Android `Signature` API emit and consume DER
 * `SEQUENCE { INTEGER r, INTEGER s }`. The protocol representation in V2.1 is
 * P-1363, so every native path needs a conversion, and a sloppy conversion is a
 * classic source of both interop failure and signature-validation bypass.
 *
 * This decoder is deliberately strict: it accepts exactly one encoding of any
 * given signature and rejects every variant, because a permissive decoder lets
 * an attacker present multiple byte strings that all verify.
 *
 * NOT PRODUCTION CODE. Phase 1A-3 must rewrite this from the specification.
 */

/** P-256 group order n. */
export const P256_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const COORD_BYTES = 32;

export class SignatureFormatError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'SignatureFormatError';
  }
}

function fail(code: string, message: string): never {
  throw new SignatureFormatError(code, message);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}

function bigIntToBytes(value: bigint, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let v = value;
  for (let i = width - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) fail('E_OVERFLOW', 'integer wider than target width');
  return out;
}

function checkScalar(name: string, value: bigint): void {
  if (value === 0n) fail('E_ZERO_SCALAR', `${name} is zero`);
  if (value >= P256_ORDER) fail('E_SCALAR_GE_ORDER', `${name} >= curve order`);
}

/**
 * Parse one DER INTEGER at `offset`. Returns the value and the next offset.
 *
 * Enforces DER (not BER): minimal-length encoding, no redundant leading zero,
 * no negative values, no long-form length where short form suffices.
 */
function readDerInteger(der: Uint8Array, offset: number): { value: bigint; next: number } {
  if (offset + 2 > der.length) fail('E_TRUNCATED', 'truncated INTEGER header');
  if (der[offset] !== 0x02) fail('E_BAD_INT_TAG', `expected INTEGER tag 0x02, saw 0x${der[offset].toString(16)}`);

  const lengthByte = der[offset + 1];
  // Long-form length is legal DER, but for a P-256 signature every integer is
  // <= 33 bytes, so the short form always suffices and the long form is a
  // non-minimal encoding of the same value.
  if (lengthByte & 0x80) fail('E_LONG_FORM_LENGTH', 'long-form length not permitted for P-256 integers');
  if (lengthByte === 0) fail('E_EMPTY_INT', 'zero-length INTEGER');
  if (lengthByte > COORD_BYTES + 1) fail('E_INT_TOO_LONG', `INTEGER length ${lengthByte} exceeds 33`);

  const start = offset + 2;
  const end = start + lengthByte;
  if (end > der.length) fail('E_TRUNCATED', 'truncated INTEGER body');

  const body = der.subarray(start, end);
  if (body[0] & 0x80) fail('E_NEGATIVE_INT', 'negative INTEGER (high bit set without 0x00 prefix)');
  if (body.length > 1 && body[0] === 0x00 && (body[1] & 0x80) === 0) {
    fail('E_REDUNDANT_LEADING_ZERO', 'non-minimal INTEGER encoding');
  }
  if (body.length > 2 && body[0] === 0x00 && body[1] === 0x00) {
    fail('E_MULTIPLE_LEADING_ZEROS', 'more than one leading zero byte');
  }

  return { value: bytesToBigInt(body), next: end };
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` -> P-1363 `r || s` (64 bytes). */
export function derToP1363(der: Uint8Array): Uint8Array {
  if (der.length < 8) fail('E_TRUNCATED', 'too short to be an ECDSA signature');
  if (der[0] !== 0x30) fail('E_BAD_SEQ_TAG', `expected SEQUENCE tag 0x30, saw 0x${der[0].toString(16)}`);

  const seqLength = der[1];
  if (seqLength & 0x80) fail('E_LONG_FORM_LENGTH', 'long-form SEQUENCE length not permitted');
  if (2 + seqLength !== der.length) {
    fail('E_TRAILING_BYTES', `SEQUENCE length ${seqLength} does not match buffer length ${der.length}`);
  }

  const r = readDerInteger(der, 2);
  const s = readDerInteger(der, r.next);
  if (s.next !== der.length) fail('E_TRAILING_BYTES', 'bytes remain after the second INTEGER');

  checkScalar('r', r.value);
  checkScalar('s', s.value);

  const out = new Uint8Array(64);
  out.set(bigIntToBytes(r.value, COORD_BYTES), 0);
  out.set(bigIntToBytes(s.value, COORD_BYTES), COORD_BYTES);
  return out;
}

/** P-1363 `r || s` (64 bytes) -> DER `SEQUENCE { INTEGER r, INTEGER s }`. */
export function p1363ToDer(p1363: Uint8Array): Uint8Array {
  const { r, s } = decodeP1363(p1363);
  const rDer = derInteger(r);
  const sDer = derInteger(s);
  const body = new Uint8Array(rDer.length + sDer.length);
  body.set(rDer, 0);
  body.set(sDer, rDer.length);
  if (body.length > 0x7f) fail('E_OVERFLOW', 'SEQUENCE body too long for short-form length');
  const out = new Uint8Array(2 + body.length);
  out[0] = 0x30;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

/** Strict P-1363 decode. Exported so tests can assert rejection directly. */
export function decodeP1363(p1363: Uint8Array): { r: bigint; s: bigint } {
  if (p1363.length !== 64) fail('E_BAD_P1363_LENGTH', `expected 64 bytes, saw ${p1363.length}`);
  const r = bytesToBigInt(p1363.subarray(0, COORD_BYTES));
  const s = bytesToBigInt(p1363.subarray(COORD_BYTES));
  checkScalar('r', r);
  checkScalar('s', s);
  return { r, s };
}

function derInteger(value: bigint): Uint8Array {
  let body = bigIntToBytes(value, COORD_BYTES);
  // Strip leading zeros down to the minimal representation...
  let start = 0;
  while (start < body.length - 1 && body[start] === 0x00) start += 1;
  body = body.subarray(start);
  // ...then re-add exactly one if the high bit would make it look negative.
  const needsPad = (body[0] & 0x80) !== 0;
  const out = new Uint8Array(2 + body.length + (needsPad ? 1 : 0));
  out[0] = 0x02;
  out[1] = body.length + (needsPad ? 1 : 0);
  if (needsPad) {
    out[2] = 0x00;
    out.set(body, 3);
  } else {
    out.set(body, 2);
  }
  return out;
}
