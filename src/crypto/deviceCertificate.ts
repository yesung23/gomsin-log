/**
 * GLDC1 — the device certificate and its chain verifier. Architecture V2.1 §3.
 *
 * This module is the answer to the attack that broke V2: a malicious server
 * inserting its own device row with `status = 'ACTIVE'` and being handed a
 * scope key by an honest client. Nothing here reads device status. Trust is a
 * signature chain terminating at the account's recovery signing key, whose
 * fingerprint the verifier already holds — pinned locally at provisioning, or
 * fixed by a SAS-confirmed pairing transcript for a partner.
 *
 * The certificate is 445 fixed bytes: a 317-byte canonical body, the issuer's
 * signature, and the subject's proof of possession. No JSON.
 */

import { concat, equalBytes, readU64be, u64be } from './bytes';
import {
  ASSURANCE_WIRE,
  PLATFORM,
  assuranceFromWire,
  isGrantSubset,
  maskGrantsDomain,
  maskToGrants,
  platformFromWire,
  type Assurance,
  type KeyDomainName,
  type PlatformName,
} from './domains';
import { ecdsaVerify, label, publicKeyFingerprint } from './suite';
import { GLDC1_CERT_VERSION, PROTOCOL_ID, SUITE_ID } from './versions';
import { P1363_LENGTH } from './ecdsaFormat';

export const TBS_LENGTH = 317;
export const CERTIFICATE_LENGTH = TBS_LENGTH + P1363_LENGTH * 2;
export const MAX_CHAIN_DEPTH = 8;

export const CERT_OFFSET = {
  magic: 0,
  certVersion: 4,
  protocolId: 5,
  suiteId: 6,
  issuerKind: 7,
  subjectAssurance: 8,
  subjectPlatform: 9,
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
  notBeforeMs: 237,
  notAfterMs: 245,
  ceremonyNonce: 253,
  ceremonyTranscriptHash: 285,
} as const;

const MAGIC = new Uint8Array([0x47, 0x4c, 0x44, 0x43]); // "GLDC"
const LABEL_CERT = label('gomsinlog/devcert/v1');
const LABEL_POP = label('gomsinlog/devcert-pop/v1');

export const ISSUER_KIND = { recoveryIdentity: 1, device: 2 } as const;
export type IssuerKind = (typeof ISSUER_KIND)[keyof typeof ISSUER_KIND];

export class CertificateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'CertificateError';
  }
}

function fail(code: string, message: string): never {
  throw new CertificateError(code, message);
}

export type CertificateBody = {
  issuerKind: IssuerKind;
  subjectAssurance: Assurance;
  subjectPlatform: PlatformName;
  grantedDomains: KeyDomainName[];
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
  notBeforeMs: bigint;
  notAfterMs: bigint;
  ceremonyNonce: Uint8Array;
  ceremonyTranscriptHash: Uint8Array;
};

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (value.length !== width) fail('E_FIELD_WIDTH', `${name} must be ${width} bytes, saw ${value.length}`);
  return value;
}

export function encodeTbs(body: CertificateBody): Uint8Array {
  const out = new Uint8Array(TBS_LENGTH);
  out.set(MAGIC, CERT_OFFSET.magic);
  out[CERT_OFFSET.certVersion] = GLDC1_CERT_VERSION;
  out[CERT_OFFSET.protocolId] = PROTOCOL_ID;
  out[CERT_OFFSET.suiteId] = SUITE_ID;
  out[CERT_OFFSET.issuerKind] = body.issuerKind;
  out[CERT_OFFSET.subjectAssurance] = ASSURANCE_WIRE[body.subjectAssurance];
  out[CERT_OFFSET.subjectPlatform] = PLATFORM[body.subjectPlatform];
  let mask = 0;
  for (const domain of body.grantedDomains) {
    mask |= domain === 'personal' ? 0b001 : domain === 'couple' ? 0b010 : 0b100;
  }
  out[CERT_OFFSET.grantedDomains] = mask;
  // byte 11 reserved, stays zero
  out.set(fixed('userId', body.userId, 16), CERT_OFFSET.userId);
  out.set(fixed('serverOriginId', body.serverOriginId, 32), CERT_OFFSET.serverOriginId);
  out.set(fixed('recoveryIdentityId', body.recoveryIdentityId, 16), CERT_OFFSET.recoveryIdentityId);
  if (body.recoveryVersion < 0 || body.recoveryVersion > 255) {
    fail('E_BAD_RECOVERY_VERSION', 'recovery version must fit in one byte');
  }
  out[CERT_OFFSET.recoveryVersion] = body.recoveryVersion;
  out.set(fixed('rootRecSigPubFp', body.rootRecSigPubFp, 32), CERT_OFFSET.rootRecSigPubFp);
  out.set(fixed('issuerId', body.issuerId, 16), CERT_OFFSET.issuerId);
  out.set(fixed('issuerSigPubFp', body.issuerSigPubFp, 32), CERT_OFFSET.issuerSigPubFp);
  out.set(fixed('subjectDeviceId', body.subjectDeviceId, 16), CERT_OFFSET.subjectDeviceId);
  out.set(fixed('subjectSigPubFp', body.subjectSigPubFp, 32), CERT_OFFSET.subjectSigPubFp);
  out.set(fixed('subjectKemPubFp', body.subjectKemPubFp, 32), CERT_OFFSET.subjectKemPubFp);
  out.set(u64be(body.notBeforeMs), CERT_OFFSET.notBeforeMs);
  out.set(u64be(body.notAfterMs), CERT_OFFSET.notAfterMs);
  out.set(fixed('ceremonyNonce', body.ceremonyNonce, 32), CERT_OFFSET.ceremonyNonce);
  out.set(fixed('ceremonyTranscriptHash', body.ceremonyTranscriptHash, 32), CERT_OFFSET.ceremonyTranscriptHash);
  return out;
}

export function decodeTbs(tbs: Uint8Array): CertificateBody {
  if (tbs.length !== TBS_LENGTH) fail('E_TBS_LENGTH', `certificate body must be ${TBS_LENGTH} bytes`);
  if (!equalBytes(tbs.subarray(0, 4), MAGIC)) fail('E_BAD_MAGIC', 'magic is not GLDC');
  if (tbs[CERT_OFFSET.certVersion] !== GLDC1_CERT_VERSION) fail('E_BAD_VERSION', 'unsupported certificate version');
  if (tbs[CERT_OFFSET.protocolId] !== PROTOCOL_ID) fail('E_BAD_PROTOCOL', 'unsupported protocol id');
  if (tbs[CERT_OFFSET.suiteId] !== SUITE_ID) fail('E_BAD_SUITE', 'unsupported suite id');
  if (tbs[CERT_OFFSET.reserved] !== 0) fail('E_RESERVED_NONZERO', 'reserved byte must be zero');
  const issuerKind = tbs[CERT_OFFSET.issuerKind];
  if (issuerKind !== ISSUER_KIND.recoveryIdentity && issuerKind !== ISSUER_KIND.device) {
    fail('E_BAD_ISSUER_KIND', `unknown issuer kind ${issuerKind}`);
  }
  return {
    issuerKind: issuerKind as IssuerKind,
    subjectAssurance: assuranceFromWire(tbs[CERT_OFFSET.subjectAssurance]),
    subjectPlatform: platformFromWire(tbs[CERT_OFFSET.subjectPlatform]),
    grantedDomains: maskToGrants(tbs[CERT_OFFSET.grantedDomains]),
    userId: tbs.slice(CERT_OFFSET.userId, CERT_OFFSET.userId + 16),
    serverOriginId: tbs.slice(CERT_OFFSET.serverOriginId, CERT_OFFSET.serverOriginId + 32),
    recoveryIdentityId: tbs.slice(CERT_OFFSET.recoveryIdentityId, CERT_OFFSET.recoveryIdentityId + 16),
    recoveryVersion: tbs[CERT_OFFSET.recoveryVersion],
    rootRecSigPubFp: tbs.slice(CERT_OFFSET.rootRecSigPubFp, CERT_OFFSET.rootRecSigPubFp + 32),
    issuerId: tbs.slice(CERT_OFFSET.issuerId, CERT_OFFSET.issuerId + 16),
    issuerSigPubFp: tbs.slice(CERT_OFFSET.issuerSigPubFp, CERT_OFFSET.issuerSigPubFp + 32),
    subjectDeviceId: tbs.slice(CERT_OFFSET.subjectDeviceId, CERT_OFFSET.subjectDeviceId + 16),
    subjectSigPubFp: tbs.slice(CERT_OFFSET.subjectSigPubFp, CERT_OFFSET.subjectSigPubFp + 32),
    subjectKemPubFp: tbs.slice(CERT_OFFSET.subjectKemPubFp, CERT_OFFSET.subjectKemPubFp + 32),
    notBeforeMs: readU64be(tbs, CERT_OFFSET.notBeforeMs),
    notAfterMs: readU64be(tbs, CERT_OFFSET.notAfterMs),
    ceremonyNonce: tbs.slice(CERT_OFFSET.ceremonyNonce, CERT_OFFSET.ceremonyNonce + 32),
    ceremonyTranscriptHash: tbs.slice(
      CERT_OFFSET.ceremonyTranscriptHash,
      CERT_OFFSET.ceremonyTranscriptHash + 32,
    ),
  };
}

export function certificateSignedMessage(tbs: Uint8Array): Uint8Array {
  return concat(LABEL_CERT, tbs);
}

export function certificatePopMessage(tbs: Uint8Array): Uint8Array {
  return concat(LABEL_POP, tbs);
}

export function assembleCertificate(
  tbs: Uint8Array,
  issuerSignature: Uint8Array,
  subjectPop: Uint8Array,
): Uint8Array {
  if (tbs.length !== TBS_LENGTH) fail('E_TBS_LENGTH', 'bad certificate body length');
  if (issuerSignature.length !== P1363_LENGTH) fail('E_BAD_SIGNATURE_LENGTH', 'issuer signature must be 64 bytes');
  if (subjectPop.length !== P1363_LENGTH) fail('E_BAD_SIGNATURE_LENGTH', 'subject PoP must be 64 bytes');
  return concat(tbs, issuerSignature, subjectPop);
}

export function splitCertificate(certificate: Uint8Array): {
  tbs: Uint8Array;
  issuerSignature: Uint8Array;
  subjectPop: Uint8Array;
} {
  if (certificate.length !== CERTIFICATE_LENGTH) {
    fail('E_CERT_LENGTH', `certificate must be ${CERTIFICATE_LENGTH} bytes, saw ${certificate.length}`);
  }
  return {
    tbs: certificate.slice(0, TBS_LENGTH),
    issuerSignature: certificate.slice(TBS_LENGTH, TBS_LENGTH + P1363_LENGTH),
    subjectPop: certificate.slice(TBS_LENGTH + P1363_LENGTH),
  };
}

// --- chain verification -----------------------------------------------------

export type CertificateWithKeys = {
  /** The 445-byte certificate. */
  certificate: Uint8Array;
  /** SPKI of the subject's `dev_sig` key, used to check PoP and to sign children. */
  subjectSigSpki: Uint8Array;
  /** SPKI of the subject's `dev_kem` key. */
  subjectKemSpki: Uint8Array;
};

export type TrustAnchor = {
  /** The pinned fingerprint of the account's recovery signing key. */
  rootRecSigPubFp: Uint8Array;
  /** SPKI of that key, needed to verify the root certificate's signature. */
  rootRecSigSpki: Uint8Array;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  userId: Uint8Array;
  serverOriginId: Uint8Array;
};

export type RevocationLookup = (subjectDeviceId: Uint8Array) => { revokedAtMs: bigint } | null;

export type VerifyChainInput = {
  /** Leaf first, root last. */
  chain: CertificateWithKeys[];
  anchor: TrustAnchor;
  /**
   * The instant trust is being judged at.
   *
   * `Date.now()` for an eligibility decision; the envelope's `created_at_ms`
   * when validating a historical signature, so a later revocation does not
   * retroactively invalidate an envelope that was legitimate when written.
   */
  atMs: bigint;
  /** Required domain, when the decision is about one. */
  requiredDomain?: KeyDomainName;
  isRevoked?: RevocationLookup;
};

export type VerifiedDevice = {
  deviceId: Uint8Array;
  sigSpki: Uint8Array;
  kemSpki: Uint8Array;
  assurance: Assurance;
  platform: PlatformName;
  grantedDomains: KeyDomainName[];
};

/**
 * Verify a certificate chain from a leaf device to the account's recovery root.
 *
 * Every check is mandatory and the function throws on the first failure; there
 * is no partial success and no "trusted but expired" state. Notably absent from
 * every branch: any reference to a device's operational status.
 */
export async function verifyCertificateChain(input: VerifyChainInput): Promise<VerifiedDevice> {
  const { chain, anchor, atMs } = input;
  if (chain.length === 0) fail('E_EMPTY_CHAIN', 'no certificates supplied');
  if (chain.length > MAX_CHAIN_DEPTH) fail('E_CHAIN_TOO_DEEP', `chain exceeds depth ${MAX_CHAIN_DEPTH}`);

  const bodies: CertificateBody[] = [];

  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i];
    const { tbs, issuerSignature, subjectPop } = splitCertificate(entry.certificate);
    const body = decodeTbs(tbs);
    bodies.push(body);

    // The supplied public keys must be the ones the certificate commits to,
    // otherwise a caller could verify one certificate and use another key.
    const sigFp = await publicKeyFingerprint(entry.subjectSigSpki);
    if (!equalBytes(sigFp, body.subjectSigPubFp)) {
      fail('E_SUBJECT_SIG_FP_MISMATCH', 'subject signing key does not match the certificate');
    }
    const kemFp = await publicKeyFingerprint(entry.subjectKemSpki);
    if (!equalBytes(kemFp, body.subjectKemPubFp)) {
      fail('E_SUBJECT_KEM_FP_MISMATCH', 'subject agreement key does not match the certificate');
    }

    // Consistency across the whole chain: one account, one deployment, one
    // recovery identity, one recovery generation, one root.
    if (!equalBytes(body.userId, anchor.userId)) fail('E_USER_MISMATCH', 'certificate is for a different user');
    if (!equalBytes(body.serverOriginId, anchor.serverOriginId)) {
      fail('E_ORIGIN_MISMATCH', 'certificate is for a different deployment');
    }
    if (!equalBytes(body.recoveryIdentityId, anchor.recoveryIdentityId)) {
      fail('E_RECOVERY_IDENTITY_MISMATCH', 'certificate chains to a different recovery identity');
    }
    if (body.recoveryVersion !== anchor.recoveryVersion) {
      fail('E_RECOVERY_VERSION_MISMATCH', 'certificate chains to a superseded recovery generation');
    }
    if (!equalBytes(body.rootRecSigPubFp, anchor.rootRecSigPubFp)) {
      fail('E_ROOT_MISMATCH', 'certificate does not chain to the pinned recovery root');
    }

    if (atMs < body.notBeforeMs) fail('E_NOT_YET_VALID', 'certificate is not yet valid');
    if (body.notAfterMs !== 0n && atMs >= body.notAfterMs) fail('E_EXPIRED', 'certificate has expired');

    if (input.isRevoked) {
      const revocation = input.isRevoked(body.subjectDeviceId);
      if (revocation && revocation.revokedAtMs <= atMs) {
        fail('E_REVOKED', 'a certificate in the chain is revoked');
      }
    }

    // Proof of possession: the subject controls the private half. Without this
    // an issuer could certify a public key the subject never held.
    const popOk = await ecdsaVerify(entry.subjectSigSpki, certificatePopMessage(tbs), subjectPop);
    if (!popOk) fail('E_BAD_POP', 'subject proof of possession did not verify');

    // Issuer signature: the root is signed by rec_sig, everything else by its
    // parent certificate's subject key.
    if (body.issuerKind === ISSUER_KIND.recoveryIdentity) {
      if (i !== chain.length - 1) fail('E_ROOT_NOT_LAST', 'a root certificate appears mid-chain');
      if (!equalBytes(body.issuerSigPubFp, anchor.rootRecSigPubFp)) {
        fail('E_ROOT_ISSUER_MISMATCH', 'root certificate issuer is not the pinned recovery key');
      }
      if (!equalBytes(body.issuerId, anchor.recoveryIdentityId)) {
        fail('E_ROOT_ISSUER_ID_MISMATCH', 'root issuer id is not the recovery identity');
      }
      const ok = await ecdsaVerify(anchor.rootRecSigSpki, certificateSignedMessage(tbs), issuerSignature);
      if (!ok) fail('E_BAD_ISSUER_SIGNATURE', 'root certificate signature did not verify');
    } else {
      const parent = chain[i + 1];
      if (!parent) fail('E_INCOMPLETE_CHAIN', 'chain ends without reaching the recovery root');
      const parentBody = decodeTbs(splitCertificate(parent.certificate).tbs);
      if (!equalBytes(body.issuerSigPubFp, parentBody.subjectSigPubFp)) {
        fail('E_ISSUER_LINK_MISMATCH', 'issuer fingerprint does not match the next certificate');
      }
      if (!equalBytes(body.issuerId, parentBody.subjectDeviceId)) {
        fail('E_ISSUER_ID_MISMATCH', 'issuer id does not match the next certificate subject');
      }
      // No escalation: a device cannot grant a domain it was not granted.
      const parentMask = parentBody.grantedDomains.reduce(
        (m, d) => m | (d === 'personal' ? 0b001 : d === 'couple' ? 0b010 : 0b100),
        0,
      );
      const childMask = body.grantedDomains.reduce(
        (m, d) => m | (d === 'personal' ? 0b001 : d === 'couple' ? 0b010 : 0b100),
        0,
      );
      if (!isGrantSubset(childMask, parentMask)) {
        fail('E_GRANT_ESCALATION', 'certificate grants a domain the issuer does not hold');
      }
      const ok = await ecdsaVerify(parent.subjectSigSpki, certificateSignedMessage(tbs), issuerSignature);
      if (!ok) fail('E_BAD_ISSUER_SIGNATURE', 'certificate signature did not verify against its issuer');
    }
  }

  const leaf = bodies[0];
  if (bodies[bodies.length - 1].issuerKind !== ISSUER_KIND.recoveryIdentity) {
    fail('E_NO_ROOT', 'chain does not terminate at the recovery root');
  }

  if (input.requiredDomain) {
    const mask = leaf.grantedDomains.reduce(
      (m, d) => m | (d === 'personal' ? 0b001 : d === 'couple' ? 0b010 : 0b100),
      0,
    );
    if (!maskGrantsDomain(mask, input.requiredDomain)) {
      fail('E_DOMAIN_NOT_GRANTED', `device is not granted the ${input.requiredDomain} domain`);
    }
  }

  return {
    deviceId: leaf.subjectDeviceId,
    sigSpki: chain[0].subjectSigSpki,
    kemSpki: chain[0].subjectKemSpki,
    assurance: leaf.subjectAssurance,
    platform: leaf.subjectPlatform,
    grantedDomains: leaf.grantedDomains,
  };
}

/**
 * Non-throwing wrapper for enumerating a candidate device set.
 *
 * Recipient selection filters with this, so an untrusted or revoked device is
 * silently excluded rather than aborting a legitimate rotation.
 */
export async function isDeviceTrusted(input: VerifyChainInput): Promise<VerifiedDevice | null> {
  try {
    return await verifyCertificateChain(input);
  } catch (error) {
    if (error instanceof CertificateError) return null;
    throw error;
  }
}
