/**
 * `approve-device` — activate a pending device after an existing device has
 * approved it.
 *
 * The handler is pure and takes its platform pieces as arguments, matching
 * `delete-account`, so every branch below is reachable from the test suite.
 *
 * This is DEFENCE IN DEPTH, not the trust boundary. A malicious `service_role`
 * can flip `devices.status` to ACTIVE without ever calling this function, which
 * is exactly why no honest client treats status as evidence. What the server
 * contributes is the part a client cannot do alone: burning a single-use nonce,
 * enforcing expiry, and refusing to record an approval whose transcript does
 * not match the state the server holds.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO HOLD
 *
 *  1. The approval signature verifies under the key the approver's CERTIFICATE
 *     commits to — not `devices.sig_spki`, not a caller-supplied key. (Edge
 *     attack #22. Do not weaken.)
 *
 *  2. The transcript that signature covers is RECONSTRUCTED HERE from
 *     authoritative server state. The caller supplies an enrollment id and a
 *     certificate and nothing else; it cannot hand over transcript bytes at all,
 *     so there is no version of this flow where the server checks a signature
 *     against facts the attacker chose. A client that fetched a different view
 *     of the account produces a different hash and is refused — the same
 *     mechanism the SAS gives the two humans, applied server-side.
 *
 * Logging rule: ids and error codes only. No key material, no recovery code, no
 * user content, ever.
 */

import {
  type VerifyResult,
  decodeBase64,
  decodePgBytea,
  equalBytes,
  fail,
  parseCertificate,
  sha256,
  verifyCertificateLink,
  verifySignature,
} from '../_shared/e2eeVerify.ts';
import {
  approvalSignedMessage,
  enrollmentTranscriptHash,
  revocationLogGenesis,
} from '../_shared/e2eeTranscript.ts';

export { approvalSignedMessage };

/** Depth limit, matching `MAX_CHAIN_DEPTH` in the client verifier. */
export const MAX_CHAIN_DEPTH = 8;

export type DeviceRow = {
  id: string;
  user_id: string;
  sig_spki: string;
  kem_spki: string;
  status: string;
};

export type EnrollmentRow = {
  id: string;
  user_id: string;
  new_device_id: string;
  approver_device_id: string | null;
  /** `bytea`. Bound into the transcript; never used as a row key. */
  enroll_nonce: string;
  granted_domains: number;
  /** Authoritative `issuedAtMs`. A client-derived value would not reproduce. */
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
};

export type RecoveryAnchorRow = {
  id: string;
  recovery_version: number;
  rec_sig_spki: string;
  recovery_bundle_fp: string;
};

/** One link of the approver's certificate path, leaf first. */
export type CertificateRow = {
  id: string;
  subject_device_id: string;
  issuer_certificate_id: string | null;
  certificate: string;
  subject_sig_spki: string;
  subject_kem_spki: string;
};

/** Everything the handler needs from the database, injected for testability. */
export type ApproveDeviceDeps = {
  now: () => number;
  getServerOriginId: () => Promise<Uint8Array | null>;
  /**
   * By stable uuid. NOT by nonce.
   *
   * Looking a row up by `WHERE enroll_nonce = <caller text>` compared a `bytea`
   * column against whatever encoding the caller happened to send, which made
   * the lookup itself depend on a transport detail. The nonce is still bound
   * into the transcript; it is simply no longer the address.
   */
  getEnrollment: (enrollmentId: string) => Promise<EnrollmentRow | null>;
  getDevice: (id: string) => Promise<DeviceRow | null>;
  getRecoveryAnchor: (userId: string) => Promise<RecoveryAnchorRow | null>;
  /** The approver's certificate and every issuer above it, leaf first. */
  getCertificateChain: (deviceId: string) => Promise<CertificateRow[]>;
  /** A signed revocation exists for this device. */
  isDeviceRevoked: (deviceId: string) => Promise<boolean>;
  /** `bytea` log head of the newest revocation, or null for a fresh account. */
  getRevocationLogHead: (userId: string) => Promise<string | null>;
  /**
   * Must be atomic: consume the nonce, persist the certificate, and only then
   * move the operational status — in one transaction.
   */
  commitApproval: (input: {
    enrollmentId: string;
    newDeviceId: string;
    certificate: Uint8Array;
    certificateFp: Uint8Array;
    transcriptHash: Uint8Array;
    approvalSignature: Uint8Array;
    userId: string;
    recoveryIdentityId: string;
    recoveryVersion: number;
    subjectSigSpki: Uint8Array;
    subjectKemSpki: Uint8Array;
    /**
     * The approver's certificate row this handler just verified root-first.
     *
     * Passed to the commit RPC so the new certificate records its real issuer.
     * `device_certificates_chain` requires exactly one of an issuer certificate
     * or a recovery anchor, so omitting this made every honest approval fail
     * against a real database — and the RPC re-validates it regardless, because
     * "the server already checked" is not something the next layer should assume.
     */
    issuerCertificateId: string;
  }) => Promise<{ ok: true } | { ok: false; code: string }>;
  logEvent: (event: string, detail: Record<string, string | number>) => void;
};

/**
 * The request.
 *
 * Note what is absent: `transcriptHash`. It used to be a parameter, and while
 * the certificate had to commit to it, the server never independently decided
 * what it should be. It is now derived entirely from server state.
 */
export type ApproveDeviceRequest = {
  enrollmentId?: unknown;
  certificate?: unknown;
  approvalSignature?: unknown;
};

export type ApproveDeviceOutcome =
  | { status: 200; body: { activated: true; deviceId: string } }
  | { status: 400 | 403 | 409 | 410; body: { error: string } };

export async function handleApproveDevice(
  request: ApproveDeviceRequest,
  callerUserId: string,
  deps: ApproveDeviceDeps,
): Promise<ApproveDeviceOutcome> {
  const reject = (status: 400 | 403 | 409 | 410, code: string): ApproveDeviceOutcome => {
    deps.logEvent('approve_device_rejected', { code, caller: callerUserId });
    return { status, body: { error: code } };
  };

  if (typeof callerUserId !== 'string' || callerUserId.length === 0) {
    return reject(403, 'E_UNAUTHENTICATED');
  }
  if (typeof request.enrollmentId !== 'string' || !isUuid(request.enrollmentId)) {
    return reject(400, 'E_BAD_REQUEST');
  }
  const certificate = decodeBase64(request.certificate);
  const approvalSignature = decodeBase64(request.approvalSignature);
  if (!certificate || !approvalSignature) return reject(400, 'E_BAD_REQUEST');

  const enrollment = await deps.getEnrollment(request.enrollmentId);
  if (!enrollment) return reject(403, 'E_UNKNOWN_ENROLLMENT');

  // Single use. The unique index and the commit RPC are the real guards against
  // a race; this is the readable rejection for the ordinary replay.
  if (enrollment.consumed_at) return reject(409, 'E_NONCE_ALREADY_USED');
  const issuedAtMs = Date.parse(enrollment.created_at);
  const expiresAtMs = Date.parse(enrollment.expires_at);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return reject(400, 'E_MALFORMED_STATE');
  if (expiresAtMs <= deps.now()) return reject(410, 'E_NONCE_EXPIRED');
  if (enrollment.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');

  const enrollNonce = decodePgBytea(enrollment.enroll_nonce);
  if (!enrollNonce || enrollNonce.length !== 32) return reject(400, 'E_MALFORMED_STATE');

  const newDevice = await deps.getDevice(enrollment.new_device_id);
  if (!newDevice) return reject(403, 'E_UNKNOWN_DEVICE');
  if (newDevice.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');
  if (newDevice.status !== 'PENDING') return reject(409, 'E_DEVICE_NOT_PENDING');

  const anchor = await deps.getRecoveryAnchor(callerUserId);
  if (!anchor) return reject(403, 'E_NO_RECOVERY_IDENTITY');

  const serverOriginId = await deps.getServerOriginId();
  if (!serverOriginId) return reject(403, 'E_NO_DEPLOYMENT_IDENTITY');

  const userIdBytes = uuidToBytes(callerUserId);
  const recoveryIdBytes = uuidToBytes(anchor.id);
  const newDeviceIdBytes = uuidToBytes(enrollment.new_device_id);
  const rootSpki = decodePgBytea(anchor.rec_sig_spki);
  const recoveryBundleFp = decodePgBytea(anchor.recovery_bundle_fp);
  const subjectSigSpki = decodePgBytea(newDevice.sig_spki);
  const subjectKemSpki = decodePgBytea(newDevice.kem_spki);
  if (!userIdBytes || !recoveryIdBytes || !newDeviceIdBytes || !rootSpki || !recoveryBundleFp
    || !subjectSigSpki || !subjectKemSpki) {
    return reject(400, 'E_MALFORMED_STATE');
  }
  if (recoveryBundleFp.length !== 32) return reject(400, 'E_MALFORMED_STATE');

  // The root fingerprint in a certificate is SHA-256 over the recovery signing
  // SPKI, which is what the client pins; recompute rather than trust a column.
  const rootRecSigPubFp = await sha256(rootSpki);

  // This endpoint is device-approval enrollment, so there is always an
  // approving device. A root-issued certificate comes from bootstrap or
  // recovery, neither of which routes through here.
  if (!enrollment.approver_device_id) return reject(403, 'E_NO_APPROVER');
  const approverDeviceIdBytes = uuidToBytes(enrollment.approver_device_id);
  if (!approverDeviceIdBytes) return reject(400, 'E_MALFORMED_STATE');

  const approver = await deps.getDevice(enrollment.approver_device_id);
  if (!approver) return reject(403, 'E_UNKNOWN_APPROVER');
  if (approver.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');

  // ---------------------------------------------------------------------
  // Approver trust, in the required order:
  //   raw id -> immutable certificate -> issuer chain -> recovery root
  //          -> revocation -> certified signing key -> signature
  //
  // `devices.status` and `devices.sig_spki` are consulted only as operational
  // hints below; neither is a root of trust anywhere in this sequence.
  // ---------------------------------------------------------------------
  const chain = await deps.getCertificateChain(approver.id);
  if (chain.length === 0) return reject(403, 'E_APPROVER_UNCERTIFIED');
  if (chain.length > MAX_CHAIN_DEPTH) return reject(403, 'E_APPROVER_CHAIN_TOO_DEEP');

  const verifiedChain = await verifyChain(chain, {
    userIdBytes,
    serverOriginId,
    recoveryIdBytes,
    recoveryVersion: anchor.recovery_version,
    rootRecSigPubFp,
    rootSpki,
  });
  if (!verifiedChain.ok) return reject(403, `E_APPROVER_CERT_${verifiedChain.code.replace(/^E_/, '')}`);

  const approverLeaf = verifiedChain.value;
  if (!equalBytes(approverLeaf.view.subjectDeviceId, approverDeviceIdBytes)) {
    return reject(403, 'E_APPROVER_CERT_WRONG_SUBJECT');
  }

  // Chain-wide revocation, matching the client verifier: a chain containing a
  // revoked link does not verify, so an approver whose own issuer was revoked
  // cannot approve anything either.
  for (const link of chain) {
    if (await deps.isDeviceRevoked(link.subject_device_id)) {
      return reject(403, link.subject_device_id === approver.id ? 'E_APPROVER_REVOKED' : 'E_APPROVER_ISSUER_REVOKED');
    }
  }
  // Operational status is checked IN ADDITION, never as the root of trust.
  if (approver.status === 'REVOKED') return reject(403, 'E_APPROVER_REVOKED');

  /** The approver's key, from the certificate. Not from `devices.sig_spki`. */
  const approverSigSpki = approverLeaf.subjectSigSpki;
  const approverKemSpki = approverLeaf.subjectKemSpki;
  const approverGrants = approverLeaf.view.grantedDomains;

  // ---------------------------------------------------------------------
  // Canonical transcript, rebuilt from server state alone.
  // ---------------------------------------------------------------------
  const logHeadValue = await deps.getRevocationLogHead(callerUserId);
  const revocationLogHead = logHeadValue === null
    ? await revocationLogGenesis(userIdBytes, recoveryIdBytes)
    : decodePgBytea(logHeadValue);
  if (!revocationLogHead || revocationLogHead.length !== 32) return reject(400, 'E_MALFORMED_STATE');

  // Grants are the intersection the two devices independently computed: what
  // the enrollment asked for, and what the approver's certificate actually
  // holds. Deriving it here rather than accepting the certificate's mask means
  // an escalation attempt changes the transcript hash and fails before the
  // grant check would even run.
  const grantedDomainsMask = enrollment.granted_domains & approverGrants;
  if (grantedDomainsMask === 0) return reject(403, 'E_NO_GRANTS');

  let transcriptHash: Uint8Array;
  try {
    transcriptHash = await enrollmentTranscriptHash({
      userId: userIdBytes,
      serverOriginId,
      oldDeviceId: approverDeviceIdBytes,
      oldSigFp: await sha256(approverSigSpki),
      oldKemFp: await sha256(approverKemSpki),
      newDeviceId: newDeviceIdBytes,
      newSigFp: await sha256(subjectSigSpki),
      newKemFp: await sha256(subjectKemSpki),
      recoveryIdentityId: recoveryIdBytes,
      recoveryVersion: anchor.recovery_version,
      rootRecSigPubFp,
      recoveryBundleFp,
      revocationLogHead,
      // The approver's certificate, hashed here rather than read from the
      // `certificate_fp` column: recomputing costs nothing and removes a column
      // from the trust surface entirely.
      issuerCertFp: await sha256(approverLeaf.certificate),
      grantedDomainsMask,
      enrollNonce,
      issuedAtMs: BigInt(issuedAtMs),
      expiresAtMs: BigInt(expiresAtMs),
    });
  } catch {
    // A field of the wrong width means a malformed row, not a 500.
    return reject(400, 'E_MALFORMED_STATE');
  }

  // ---------------------------------------------------------------------
  // The certificate being registered must describe THIS ceremony.
  // ---------------------------------------------------------------------
  const parsed = parseCertificate(certificate);
  if (!parsed.ok) return reject(400, parsed.code);

  if (!equalBytes(parsed.value.subjectDeviceId, newDeviceIdBytes)) return reject(403, 'E_CERT_WRONG_SUBJECT');
  // Against the SERVER's hash. A caller that changed any transcript input —
  // grants, timestamps, the approver, the revocation head — lands here.
  if (!equalBytes(parsed.value.ceremonyTranscriptHash, transcriptHash)) {
    return reject(403, 'E_CERT_WRONG_TRANSCRIPT');
  }
  // The ceremony nonce is the enrollment nonce, so a certificate minted for a
  // different enrollment cannot be presented against this one.
  if (!equalBytes(parsed.value.ceremonyNonce, enrollNonce)) return reject(403, 'E_CERT_WRONG_NONCE');
  if (parsed.value.grantedDomains !== grantedDomainsMask) return reject(403, 'E_CERT_GRANT_MISMATCH');
  if (parsed.value.issuerKind !== 2) return reject(403, 'E_CERT_NOT_DEVICE_ISSUED');
  if (!equalBytes(parsed.value.issuerId, approverDeviceIdBytes)) return reject(403, 'E_CERT_ISSUER_ID_MISMATCH');
  if (!equalBytes(parsed.value.issuerSigPubFp, await sha256(approverSigSpki))) {
    return reject(403, 'E_CERT_ISSUER_FP_MISMATCH');
  }

  // THE FIX FOR #22, unchanged in substance: the approval signature must verify
  // under the key the approver's certificate commits to, over the approval
  // message for the SERVER'S transcript hash. Before it existed, any 64 bytes
  // were accepted; before this patch, the hash it covered was the caller's.
  const approvalOk = await verifySignature(
    approverSigSpki,
    approvalSignedMessage(transcriptHash),
    approvalSignature,
  );
  if (!approvalOk) return reject(403, 'E_BAD_APPROVAL_SIGNATURE');

  const link: VerifyResult<unknown> = await verifyCertificateLink(certificate, {
    userId: userIdBytes,
    serverOriginId,
    recoveryIdentityId: recoveryIdBytes,
    recoveryVersion: anchor.recovery_version,
    rootRecSigPubFp,
    rootRecSigSpki: rootSpki,
    subjectSigSpki,
    issuerSigSpki: approverSigSpki,
    issuerGrantedDomains: approverGrants,
  });
  if (!link.ok) return reject(403, link.code);

  const certificateFp = await sha256(certificate);

  const committed = await deps.commitApproval({
    enrollmentId: enrollment.id,
    newDeviceId: enrollment.new_device_id,
    certificate,
    certificateFp,
    transcriptHash,
    approvalSignature,
    userId: callerUserId,
    recoveryIdentityId: anchor.id,
    recoveryVersion: anchor.recovery_version,
    subjectSigSpki,
    subjectKemSpki,
    // The leaf of the chain verified above, which is the approver's own
    // certificate. Not a value from the request.
    issuerCertificateId: approverLeaf.id,
  });
  if (!committed.ok) return reject(409, committed.code);

  deps.logEvent('approve_device_ok', { deviceId: enrollment.new_device_id, caller: callerUserId });
  return { status: 200, body: { activated: true, deviceId: enrollment.new_device_id } };
}

type VerifiedLink = {
  /** The `device_certificates.id` this link came from. */
  id: string;
  certificate: Uint8Array;
  subjectSigSpki: Uint8Array;
  subjectKemSpki: Uint8Array;
  view: Awaited<ReturnType<typeof parseCertificate>> extends VerifyResult<infer T> ? T : never;
};

/**
 * Verify a whole certificate path, root-last.
 *
 * Walked from the ROOT downward so each child is checked against a parent whose
 * own signature already verified. Verifying leaf-first would mean trusting a
 * parent key that had not been established yet, which is the shape of a chain
 * check that looks thorough and proves nothing.
 */
async function verifyChain(
  chain: CertificateRow[],
  context: {
    userIdBytes: Uint8Array;
    serverOriginId: Uint8Array;
    recoveryIdBytes: Uint8Array;
    recoveryVersion: number;
    rootRecSigPubFp: Uint8Array;
    rootSpki: Uint8Array;
  },
): Promise<VerifyResult<VerifiedLink>> {
  const decoded: VerifiedLink[] = [];
  for (const row of chain) {
    const certificate = decodePgBytea(row.certificate);
    const subjectSigSpki = decodePgBytea(row.subject_sig_spki);
    const subjectKemSpki = decodePgBytea(row.subject_kem_spki);
    if (!certificate || !subjectSigSpki || !subjectKemSpki) return fail('E_MALFORMED_CERT_ROW');
    const parsed = parseCertificate(certificate);
    if (!parsed.ok) return parsed;
    decoded.push({ id: row.id, certificate, subjectSigSpki, subjectKemSpki, view: parsed.value });
  }

  // Root last, and it must actually be root-issued.
  const root = decoded[decoded.length - 1];
  if (root.view.issuerKind !== 1) return fail('E_CHAIN_NO_ROOT');

  for (let i = decoded.length - 1; i >= 0; i -= 1) {
    const entry = decoded[i];
    const parent = i + 1 < decoded.length ? decoded[i + 1] : null;
    if (entry.view.issuerKind === 1 && parent) return fail('E_ROOT_NOT_LAST');
    if (entry.view.issuerKind === 2 && !parent) return fail('E_INCOMPLETE_CHAIN');
    if (parent && !equalBytes(entry.view.issuerId, parent.view.subjectDeviceId)) {
      return fail('E_ISSUER_ID_MISMATCH');
    }
    const result = await verifyCertificateLink(entry.certificate, {
      userId: context.userIdBytes,
      serverOriginId: context.serverOriginId,
      recoveryIdentityId: context.recoveryIdBytes,
      recoveryVersion: context.recoveryVersion,
      rootRecSigPubFp: context.rootRecSigPubFp,
      rootRecSigSpki: context.rootSpki,
      subjectSigSpki: entry.subjectSigSpki,
      issuerSigSpki: parent?.subjectSigSpki,
      issuerGrantedDomains: parent?.view.grantedDomains,
    });
    if (!result.ok) return result;
  }

  return { ok: true, value: decoded[0] };
}

function uuidToBytes(uuid: string): Uint8Array | null {
  const clean = String(uuid).trim().toLowerCase();
  if (!isUuid(clean)) return null;
  const hex = clean.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    .test(String(value).trim().toLowerCase());
}

export { fail };
