/**
 * Shared cryptographic verification for the E2EE Edge Functions.
 *
 * Deliberately free of any `Deno` reference at module scope so it can be
 * imported and exhaustively tested under vitest/Node, matching the convention
 * `_shared/cors.ts` already established.
 *
 * What these functions are and are not: server-side verification is DEFENCE IN
 * DEPTH. A malicious `service_role` can mutate any row this code reads, so a
 * client must independently verify the same evidence before trusting anything.
 * What the server adds is single-use nonce enforcement, expiry, and refusing to
 * record a transcript that does not match the state it holds — checks a client
 * cannot perform on its own.
 */

const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

export const CERTIFICATE_LENGTH = 445;
export const TBS_LENGTH = 317;
export const ENVELOPE_LENGTH = 360;
export const SIGNATURE_LENGTH = 64;

export type VerifyFailure = { ok: false; code: string };
export type VerifySuccess<T> = { ok: true; value: T };
export type VerifyResult<T> = VerifySuccess<T> | VerifyFailure;

export function fail(code: string): VerifyFailure {
  return { ok: false, code };
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// THE BYTE BOUNDARY
// ---------------------------------------------------------------------------
//
// Three representations exist in this system and they are NOT interchangeable.
// Every binary value crossing a boundary must state which one it is, and every
// conversion must go through this section — nothing in an Edge Function may
// reach for `atob`/`btoa` directly.
//
//   bytea            What PostgREST returns for a `bytea` column and accepts
//                    for a `bytea` RPC parameter: PostgreSQL hex output,
//                    `\x0123abcd`. Never base64.
//
//   base64 transport What an HTTP request/response body carries, because JSON
//                    has no binary type.
//
//   raw JSON text    Everything else: uuids, timestamps, enums. Not binary at
//                    all, and never fed to either decoder.
//
// An earlier revision had ONE decoder that tried hex and silently fell back to
// base64. That ambiguity is the bug it looks like: `\x4142` and `Q0Q=` are both
// "valid" to such a function, so a column read with the wrong expectation
// produced plausible garbage which then failed a signature check for a reason
// nobody could trace. The two decoders below are strict and separate, and the
// caller has to know what it is holding.

/**
 * A `bytea` column or RPC value. STRICT: `\x…` hex only.
 *
 * Returns null rather than throwing, so a malformed row is a rejected request
 * with a code rather than a 500.
 */
export function decodePgBytea(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') return null;
  if (!(value.startsWith('\\x') || value.startsWith('\\\\x'))) return null;
  const hex = value.replace(/^\\+x/, '');
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Encode for a `bytea` column or RPC parameter. PostgREST accepts the literal. */
export function encodePgBytea(bytes: Uint8Array): string {
  let out = '\\x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** A binary value from an HTTP body. STRICT: base64 only, never hex. */
export function decodeBase64(text: unknown): Uint8Array | null {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A binary value for an HTTP response body. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Decode a `bytea` value that must be an exact width, or fail. */
export function decodePgByteaExact(value: unknown, width: number): Uint8Array | null {
  const bytes = decodePgBytea(value);
  if (!bytes || bytes.length !== width) return null;
  return bytes;
}

export function assertSpki(spki: Uint8Array): boolean {
  if (spki.length !== 91) return false;
  for (let i = 0; i < P256_SPKI_PREFIX.length; i += 1) {
    if (spki[i] !== P256_SPKI_PREFIX[i]) return false;
  }
  return spki[P256_SPKI_PREFIX.length] === 0x04;
}

/** Strict P-1363 validation: 64 bytes, both scalars non-zero and below n. */
export function validP1363(signature: Uint8Array): boolean {
  if (signature.length !== SIGNATURE_LENGTH) return false;
  const toBigInt = (bytes: Uint8Array) => {
    let value = 0n;
    for (const b of bytes) value = (value << 8n) | BigInt(b);
    return value;
  };
  const r = toBigInt(signature.subarray(0, 32));
  const s = toBigInt(signature.subarray(32));
  return r !== 0n && s !== 0n && r < P256_ORDER && s < P256_ORDER;
}

export async function verifySignature(
  spki: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (!assertSpki(spki) || !validP1363(signature)) return false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      spki as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature as BufferSource,
      message as BufferSource,
    );
  } catch {
    return false;
  }
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function uuidToBytes(uuid: string): Uint8Array | null {
  const clean = String(uuid).trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) return null;
  const hex = clean.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// Certificate inspection
// ---------------------------------------------------------------------------

export const CERT_FIELD = {
  certVersion: 4,
  issuerKind: 7,
  grantedDomains: 10,
  reserved: 11,
  userId: 12,
  serverOriginId: 28,
  recoveryIdentityId: 60,
  recoveryVersion: 76,
  rootRecSigPubFp: 77,
  issuerId: 109,
  issuerSigPubFp: 125,
  subjectDeviceId: 157,
  subjectSigPubFp: 173,
  subjectKemPubFp: 205,
  ceremonyNonce: 253,
  ceremonyTranscriptHash: 285,
} as const;

export type CertificateView = {
  tbs: Uint8Array;
  issuerSignature: Uint8Array;
  subjectPop: Uint8Array;
  issuerKind: number;
  grantedDomains: number;
  userId: Uint8Array;
  serverOriginId: Uint8Array;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  rootRecSigPubFp: Uint8Array;
  issuerId: Uint8Array;
  issuerSigPubFp: Uint8Array;
  subjectDeviceId: Uint8Array;
  subjectSigPubFp: Uint8Array;
  subjectKemPubFp: Uint8Array;
  ceremonyNonce: Uint8Array;
  ceremonyTranscriptHash: Uint8Array;
};

export function parseCertificate(certificate: Uint8Array): VerifyResult<CertificateView> {
  if (certificate.length !== CERTIFICATE_LENGTH) return fail('E_CERT_LENGTH');
  const magic = [0x47, 0x4c, 0x44, 0x43];
  for (let i = 0; i < 4; i += 1) if (certificate[i] !== magic[i]) return fail('E_CERT_MAGIC');
  if (certificate[CERT_FIELD.certVersion] !== 1) return fail('E_CERT_VERSION');
  if (certificate[CERT_FIELD.reserved] !== 0) return fail('E_CERT_RESERVED');
  const issuerKind = certificate[CERT_FIELD.issuerKind];
  if (issuerKind !== 1 && issuerKind !== 2) return fail('E_CERT_ISSUER_KIND');
  const grantedDomains = certificate[CERT_FIELD.grantedDomains];
  if (grantedDomains > 0b111) return fail('E_CERT_GRANT_MASK');

  const slice = (offset: number, length: number) => certificate.slice(offset, offset + length);
  return {
    ok: true,
    value: {
      tbs: certificate.slice(0, TBS_LENGTH),
      issuerSignature: certificate.slice(TBS_LENGTH, TBS_LENGTH + SIGNATURE_LENGTH),
      subjectPop: certificate.slice(TBS_LENGTH + SIGNATURE_LENGTH),
      issuerKind,
      grantedDomains,
      userId: slice(CERT_FIELD.userId, 16),
      serverOriginId: slice(CERT_FIELD.serverOriginId, 32),
      recoveryIdentityId: slice(CERT_FIELD.recoveryIdentityId, 16),
      recoveryVersion: certificate[CERT_FIELD.recoveryVersion],
      rootRecSigPubFp: slice(CERT_FIELD.rootRecSigPubFp, 32),
      issuerId: slice(CERT_FIELD.issuerId, 16),
      issuerSigPubFp: slice(CERT_FIELD.issuerSigPubFp, 32),
      subjectDeviceId: slice(CERT_FIELD.subjectDeviceId, 16),
      subjectSigPubFp: slice(CERT_FIELD.subjectSigPubFp, 32),
      subjectKemPubFp: slice(CERT_FIELD.subjectKemPubFp, 32),
      ceremonyNonce: slice(CERT_FIELD.ceremonyNonce, 32),
      ceremonyTranscriptHash: slice(CERT_FIELD.ceremonyTranscriptHash, 32),
    },
  };
}

export type CertificateContext = {
  /** The account the certificate must belong to. */
  userId: Uint8Array;
  serverOriginId: Uint8Array;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  rootRecSigPubFp: Uint8Array;
  rootRecSigSpki: Uint8Array;
  /**
   * The subject's signing key, from the device registry.
   *
   * The certificate commits only to a fingerprint, so the key has to come from
   * outside; checking the fingerprint against it is what stops a caller from
   * verifying one certificate and then using a different key.
   */
  subjectSigSpki: Uint8Array;
  /** Public key of the issuing device, when the issuer is a device. */
  issuerSigSpki?: Uint8Array;
  issuerGrantedDomains?: number;
};

/**
 * Verify one certificate against the account's recovery anchor.
 *
 * This checks a single link, not a whole chain: the Edge Function only ever
 * needs to confirm that the certificate being registered is well formed, signed
 * by whoever it claims, and does not escalate a domain grant. Full chain
 * resolution belongs on the client, which holds the pinned root.
 */
export async function verifyCertificateLink(
  certificate: Uint8Array,
  context: CertificateContext,
): Promise<VerifyResult<CertificateView>> {
  const parsed = parseCertificate(certificate);
  if (!parsed.ok) return parsed;
  const view = parsed.value;

  if (!equalBytes(view.userId, context.userId)) return fail('E_CERT_USER_MISMATCH');
  if (!equalBytes(view.serverOriginId, context.serverOriginId)) return fail('E_CERT_ORIGIN_MISMATCH');
  if (!equalBytes(view.recoveryIdentityId, context.recoveryIdentityId)) return fail('E_CERT_RECOVERY_MISMATCH');
  if (view.recoveryVersion !== context.recoveryVersion) return fail('E_CERT_RECOVERY_VERSION');
  if (!equalBytes(view.rootRecSigPubFp, context.rootRecSigPubFp)) return fail('E_CERT_ROOT_MISMATCH');

  // The supplied subject key must be the one the certificate commits to.
  const subjectFp = await sha256(context.subjectSigSpki);
  if (!equalBytes(subjectFp, view.subjectSigPubFp)) return fail('E_CERT_SUBJECT_FP_MISMATCH');

  // Proof of possession: the subject controls the matching private key.
  const popOk = await verifySignature(
    context.subjectSigSpki,
    concat(utf8('gomsinlog/devcert-pop/v1'), view.tbs),
    view.subjectPop,
  );
  if (!popOk) return fail('E_CERT_BAD_POP');

  if (view.issuerKind === 1) {
    if (!equalBytes(view.issuerSigPubFp, context.rootRecSigPubFp)) return fail('E_CERT_ROOT_ISSUER');
    if (!equalBytes(view.issuerId, context.recoveryIdentityId)) return fail('E_CERT_ROOT_ISSUER_ID');
    const ok = await verifySignature(
      context.rootRecSigSpki,
      concat(utf8('gomsinlog/devcert/v1'), view.tbs),
      view.issuerSignature,
    );
    if (!ok) return fail('E_CERT_BAD_ISSUER_SIGNATURE');
  } else {
    if (!context.issuerSigSpki) return fail('E_CERT_ISSUER_UNKNOWN');
    const issuerFp = await sha256(context.issuerSigSpki);
    if (!equalBytes(issuerFp, view.issuerSigPubFp)) return fail('E_CERT_ISSUER_FP_MISMATCH');
    // No escalation: an issuer cannot grant what it does not hold.
    if (context.issuerGrantedDomains !== undefined
      && (view.grantedDomains & ~context.issuerGrantedDomains) !== 0) {
      return fail('E_CERT_GRANT_ESCALATION');
    }
    const ok = await verifySignature(
      context.issuerSigSpki,
      concat(utf8('gomsinlog/devcert/v1'), view.tbs),
      view.issuerSignature,
    );
    if (!ok) return fail('E_CERT_BAD_ISSUER_SIGNATURE');
  }

  return { ok: true, value: view };
}
