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
 * Logging rule: ids and error codes only. No key material, no recovery code, no
 * user content, ever.
 */

import {
  type VerifyResult,
  decodeBase64,
  decodeDbBytes,
  equalBytes,
  fail,
  parseCertificate,
  uuidToBytes,
  verifyCertificateLink,
} from '../_shared/e2eeVerify.ts';

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
  granted_domains: number;
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

/** Everything the handler needs from the database, injected for testability. */
export type ApproveDeviceDeps = {
  now: () => number;
  getServerOriginId: () => Promise<Uint8Array | null>;
  getEnrollmentByNonce: (nonceB64: string) => Promise<EnrollmentRow | null>;
  getDevice: (id: string) => Promise<DeviceRow | null>;
  getRecoveryAnchor: (userId: string) => Promise<RecoveryAnchorRow | null>;
  getCertificateGrants: (deviceId: string) => Promise<number | null>;
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
  }) => Promise<{ ok: true } | { ok: false; code: string }>;
  logEvent: (event: string, detail: Record<string, string | number>) => void;
};

export type ApproveDeviceRequest = {
  enrollNonce?: unknown;
  certificate?: unknown;
  transcriptHash?: unknown;
  approvalSignature?: unknown;
  envelopeCount?: unknown;
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

  if (typeof request.enrollNonce !== 'string') return reject(400, 'E_BAD_REQUEST');
  const certificate = typeof request.certificate === 'string' ? decodeBase64(request.certificate) : null;
  const transcriptHash = typeof request.transcriptHash === 'string' ? decodeBase64(request.transcriptHash) : null;
  const approvalSignature = typeof request.approvalSignature === 'string'
    ? decodeBase64(request.approvalSignature) : null;
  if (!certificate || !transcriptHash || !approvalSignature) return reject(400, 'E_BAD_REQUEST');
  if (transcriptHash.length !== 32) return reject(400, 'E_BAD_TRANSCRIPT');

  const enrollment = await deps.getEnrollmentByNonce(request.enrollNonce);
  if (!enrollment) return reject(403, 'E_UNKNOWN_NONCE');

  // Single use. The unique index is the real guard against a race; this is the
  // readable rejection for the ordinary replay.
  if (enrollment.consumed_at) return reject(409, 'E_NONCE_ALREADY_USED');
  if (Date.parse(enrollment.expires_at) <= deps.now()) return reject(410, 'E_NONCE_EXPIRED');
  if (enrollment.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');

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
  const rootSpki = decodeDbBytes(anchor.rec_sig_spki);
  const rootFp = decodeDbBytes(anchor.recovery_bundle_fp);
  const subjectSigSpki = decodeDbBytes(newDevice.sig_spki);
  if (!userIdBytes || !recoveryIdBytes || !rootSpki || !rootFp || !subjectSigSpki) {
    return reject(400, 'E_MALFORMED_STATE');
  }

  // The root fingerprint in a certificate is SHA-256 over the recovery signing
  // SPKI, which is what the client pins; recompute rather than trust a column.
  const rootRecSigPubFp = new Uint8Array(await crypto.subtle.digest('SHA-256', rootSpki as BufferSource));

  const parsed = parseCertificate(certificate);
  if (!parsed.ok) return reject(400, parsed.code);

  // The certificate must be for this device and this ceremony. Binding the
  // transcript hash is what ties the signed approval to the SAS the humans
  // actually compared.
  const newDeviceIdBytes = uuidToBytes(enrollment.new_device_id);
  if (!newDeviceIdBytes) return reject(400, 'E_MALFORMED_STATE');
  if (!equalBytes(parsed.value.subjectDeviceId, newDeviceIdBytes)) return reject(403, 'E_CERT_WRONG_SUBJECT');
  if (!equalBytes(parsed.value.ceremonyTranscriptHash, transcriptHash)) return reject(403, 'E_CERT_WRONG_TRANSCRIPT');

  // Grants may not exceed what the enrollment asked for, nor what the approving
  // device itself holds.
  if ((parsed.value.grantedDomains & ~enrollment.granted_domains) !== 0) {
    return reject(403, 'E_GRANT_EXCEEDS_ENROLLMENT');
  }

  let issuerSigSpki: Uint8Array | undefined;
  let issuerGrants: number | undefined;
  if (parsed.value.issuerKind === 2) {
    if (!enrollment.approver_device_id) return reject(403, 'E_NO_APPROVER');
    const approver = await deps.getDevice(enrollment.approver_device_id);
    if (!approver) return reject(403, 'E_UNKNOWN_APPROVER');
    if (approver.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');
    if (approver.status === 'REVOKED') return reject(403, 'E_APPROVER_REVOKED');
    const spki = decodeDbBytes(approver.sig_spki);
    if (!spki) return reject(400, 'E_MALFORMED_STATE');
    issuerSigSpki = spki;
    issuerGrants = (await deps.getCertificateGrants(approver.id)) ?? undefined;
    if (issuerGrants === undefined) return reject(403, 'E_APPROVER_UNCERTIFIED');
  }

  const link: VerifyResult<unknown> = await verifyCertificateLink(certificate, {
    userId: userIdBytes,
    serverOriginId,
    recoveryIdentityId: recoveryIdBytes,
    recoveryVersion: anchor.recovery_version,
    rootRecSigPubFp,
    rootRecSigSpki: rootSpki,
    subjectSigSpki,
    issuerSigSpki,
    issuerGrantedDomains: issuerGrants,
  });
  if (!link.ok) return reject(403, link.code);

  const certificateFp = new Uint8Array(await crypto.subtle.digest('SHA-256', certificate as BufferSource));

  const subjectKemSpki = decodeDbBytes(newDevice.kem_spki);
  if (!subjectKemSpki) return reject(400, 'E_MALFORMED_STATE');

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
  });
  if (!committed.ok) return reject(409, committed.code);

  deps.logEvent('approve_device_ok', { deviceId: enrollment.new_device_id, caller: callerUserId });
  return { status: 200, body: { activated: true, deviceId: enrollment.new_device_id } };
}

export { fail };
