/**
 * Strict ECDSA P-256 signature format conversion.
 *
 * The protocol representation is P-1363 (`r || s`, exactly 64 bytes) because
 * that is what WebCrypto produces and consumes. Apple's Security.framework and
 * the Java `Signature` API both emit X9.62 DER instead — Phase 1A-1 measured
 * this on both, and measured that WebCrypto silently *rejects* an unconverted
 * DER signature rather than erroring, which is exactly the kind of failure that
 * reads as "signature invalid" and sends you hunting in the wrong place.
 *
 * The decoder is strict on purpose. A permissive DER parser accepts several
 * byte strings for one signature; nothing in this protocol depends on signature
 * uniqueness, but a parser that tolerates non-minimal integers is one step from
 * a parser that tolerates something worse.
 */

export const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const COORD_BYTES = 32;
const MAX_INT_BYTES = COORD_BYTES + 1;

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
  if (v !== 0n) fail('E_OVERFLOW', 'integer is wider than the target width');
  return out;
}

function checkScalar(name: string, value: bigint): void {
  if (value === 0n) fail('E_ZERO_SCALAR', `${name} is zero`);
  if (value >= P256_ORDER) fail('E_SCALAR_GE_ORDER', `${name} is at or above the curve order`);
}

function readDerInteger(der: Uint8Array, offset: number): { value: bigint; next: number } {
  if (offset + 2 > der.length) fail('E_TRUNCATED', 'truncated INTEGER header');
  if (der[offset] !== 0x02) fail('E_BAD_INT_TAG', `expected INTEGER tag 0x02, saw 0x${der[offset].toString(16)}`);

  const lengthByte = der[offset + 1];
  // For a P-256 signature every integer fits in 33 bytes, so the short form
  // always suffices and the long form is a non-minimal encoding.
  if (lengthByte & 0x80) fail('E_LONG_FORM_LENGTH', 'long-form length is not permitted');
  if (lengthByte === 0) fail('E_EMPTY_INT', 'zero-length INTEGER');
  if (lengthByte > MAX_INT_BYTES) fail('E_INT_TOO_LONG', `INTEGER length ${lengthByte} exceeds ${MAX_INT_BYTES}`);

  const start = offset + 2;
  const end = start + lengthByte;
  if (end > der.length) fail('E_TRUNCATED', 'truncated INTEGER body');

  const body = der.subarray(start, end);
  if (body[0] & 0x80) fail('E_NEGATIVE_INT', 'negative INTEGER (high bit set with no 0x00 prefix)');
  if (body.length > 1 && body[0] === 0x00 && (body[1] & 0x80) === 0) {
    fail('E_REDUNDANT_LEADING_ZERO', 'non-minimal INTEGER encoding');
  }
  if (body.length > 2 && body[0] === 0x00 && body[1] === 0x00) {
    fail('E_MULTIPLE_LEADING_ZEROS', 'more than one leading zero byte');
  }
  return { value: bytesToBigInt(body), next: end };
}

/** X9.62 DER `SEQUENCE { INTEGER r, INTEGER s }` to P-1363 `r || s`. */
export function derToP1363(der: Uint8Array): Uint8Array {
  if (der.length < 8) fail('E_TRUNCATED', 'too short to be an ECDSA signature');
  if (der[0] !== 0x30) fail('E_BAD_SEQ_TAG', `expected SEQUENCE tag 0x30, saw 0x${der[0].toString(16)}`);

  const seqLength = der[1];
  if (seqLength & 0x80) fail('E_LONG_FORM_LENGTH', 'long-form SEQUENCE length is not permitted');
  if (2 + seqLength !== der.length) {
    fail('E_TRAILING_BYTES', `SEQUENCE length ${seqLength} does not match buffer length ${der.length}`);
  }

  const r = readDerInteger(der, 2);
  const s = readDerInteger(der, r.next);
  if (s.next !== der.length) fail('E_TRAILING_BYTES', 'bytes remain after the second INTEGER');

  checkScalar('r', r.value);
  checkScalar('s', s.value);

  const out = new Uint8Array(P1363_LENGTH);
  out.set(bigIntToBytes(r.value, COORD_BYTES), 0);
  out.set(bigIntToBytes(s.value, COORD_BYTES), COORD_BYTES);
  return out;
}

export const P1363_LENGTH = 64;

/** Strict P-1363 decode. Exported so callers can reject before verifying. */
export function decodeP1363(signature: Uint8Array): { r: bigint; s: bigint } {
  if (signature.length !== P1363_LENGTH) {
    fail('E_BAD_P1363_LENGTH', `expected ${P1363_LENGTH} bytes, saw ${signature.length}`);
  }
  const r = bytesToBigInt(signature.subarray(0, COORD_BYTES));
  const s = bytesToBigInt(signature.subarray(COORD_BYTES));
  checkScalar('r', r);
  checkScalar('s', s);
  return { r, s };
}

function derInteger(value: bigint): Uint8Array {
  let body: Uint8Array = bigIntToBytes(value, COORD_BYTES);
  let start = 0;
  while (start < body.length - 1 && body[start] === 0x00) start += 1;
  body = body.subarray(start);
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

/** P-1363 `r || s` to X9.62 DER, for platforms that consume DER. */
export function p1363ToDer(signature: Uint8Array): Uint8Array {
  const { r, s } = decodeP1363(signature);
  const rDer = derInteger(r);
  const sDer = derInteger(s);
  const bodyLength = rDer.length + sDer.length;
  if (bodyLength > 0x7f) fail('E_OVERFLOW', 'SEQUENCE body too long for a short-form length');
  const out = new Uint8Array(2 + bodyLength);
  out[0] = 0x30;
  out[1] = bodyLength;
  out.set(rDer, 2);
  out.set(sDer, 2 + rDer.length);
  return out;
}

export type SignatureEncoding = 'p1363' | 'der';

/**
 * Normalize a signature whose encoding the caller knows.
 *
 * Prefer this wherever the producer declares its format — the native bridge
 * does — because guessing from the bytes is not reliably possible.
 */
export function normalizeSignature(signature: Uint8Array, encoding: SignatureEncoding): Uint8Array {
  if (encoding === 'p1363') {
    decodeP1363(signature);
    return signature;
  }
  return derToP1363(signature);
}

/**
 * Accept either representation and return P-1363, for callers that genuinely
 * do not know which they were handed.
 *
 * Length is the discriminator, and it has to be: an earlier version of this
 * function also required `signature[0] !== 0x30` before treating a 64-byte
 * value as P-1363, which misrouted roughly one signature in 256 — every valid
 * P-1363 signature whose `r` happens to begin `0x30` — into the DER parser.
 * That is exactly the kind of intermittent, unreproducible failure this
 * codebase must not ship.
 *
 * The residual ambiguity is stated rather than hidden: a DER signature is
 * 64 bytes only when both scalars lose several leading bytes at once, which is
 * vanishingly rare but not impossible. Callers that know their encoding should
 * use `normalizeSignature` instead.
 */
export function toP1363(signature: Uint8Array): Uint8Array {
  if (signature.length === P1363_LENGTH) {
    decodeP1363(signature);
    return signature;
  }
  return derToP1363(signature);
}
