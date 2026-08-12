/**
 * Trust resolution for the E2EE use cases.
 *
 * Everything in this module exists to enforce one rule that the rest of the
 * layer then gets to assume:
 *
 *   A `VerifiedDevice` is produced HERE, from a certificate chain this process
 *   verified against a pinned root, and nowhere else.
 *
 * No use case accepts a `VerifiedDevice` as a parameter. TypeScript's structural
 * typing means `{ deviceId, sigSpki, kemSpki, assurance, platform,
 * grantedDomains }` is a `VerifiedDevice` as far as the compiler is concerned,
 * so a UI, a caller, a Supabase row or a JSON payload can produce one for free.
 * A type is not a security boundary; a signature check is. Public use cases take
 * raw ids and raw evidence, and the evidence is verified inside the trusted
 * operation every time — never once, cached, and trusted later.
 *
 * The same rule covers revocations. A caller may not hand in a `RevocationSet`,
 * because an empty one is trivially forgeable and would silently re-admit a
 * revoked device to the next epoch. The set is rebuilt here from persisted,
 * signed statements whose signatures are checked against the revoker's own
 * certified key.
 */

import { hex, uuidToBytes } from '@/crypto/bytes';
import type { KeyDomainName } from '@/crypto/domains';
import {
  MAX_CHAIN_DEPTH,
  isDeviceTrusted,
  type CertificateWithKeys,
  type TrustAnchor,
  type VerifiedDevice,
} from '@/crypto/deviceCertificate';
import { RevocationSet, verifyRevocationStatement } from '@/crypto/revocation';
import { publicKeyFingerprint } from '@/crypto/suite';
import type { CertificateRecord, E2eeRepository } from './ports';

export class E2eeTrustError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'E2eeTrustError';
  }
}

function fail(code: string, message: string): never {
  throw new E2eeTrustError(code, message);
}

/**
 * Reassemble a leaf-first chain by following `issuer_certificate_id` upward.
 *
 * The links are real foreign keys in migration 031, so this is reading a graph
 * the database already refuses to break — but a cycle or a dangling issuer would
 * still be a malformed answer from a server, and both are refused rather than
 * looped on.
 */
export function buildChain(
  leaf: CertificateRecord,
  byId: ReadonlyMap<string, CertificateRecord>,
): CertificateWithKeys[] {
  const chain: CertificateWithKeys[] = [];
  const seen = new Set<string>();
  let current: CertificateRecord | undefined = leaf;

  while (current) {
    if (seen.has(current.id)) fail('E_CERT_CYCLE', 'certificate chain contains a cycle');
    seen.add(current.id);
    chain.push({
      certificate: current.certificate,
      subjectSigSpki: current.subjectSigSpki,
      subjectKemSpki: current.subjectKemSpki,
    });
    if (chain.length > MAX_CHAIN_DEPTH) fail('E_CHAIN_TOO_DEEP', 'certificate chain is too deep');
    if (!current.issuerCertificateId) break;
    const parent: CertificateRecord | undefined = byId.get(current.issuerCertificateId);
    if (!parent) fail('E_CHAIN_INCOMPLETE', 'an issuer certificate is missing');
    current = parent;
  }
  return chain;
}

/**
 * Does this certificate's path to the root pass through a given device?
 *
 * Needed because revocation is chain-wide: `verifyCertificateChain` refuses any
 * chain containing a revoked link, so revoking a device that issued others
 * distrusts those others too. That is the conservative and correct reading — a
 * compromised device's issuances are suspect — but it means a revocation can
 * strand an account, and a caller has to be able to see that coming.
 */
export function chainPassesThroughDevice(
  leaf: CertificateRecord,
  byId: ReadonlyMap<string, CertificateRecord>,
  deviceId: string,
): boolean {
  const seen = new Set<string>();
  let current: CertificateRecord | undefined = leaf;
  while (current) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    if (current.subjectDeviceId === deviceId) return true;
    if (!current.issuerCertificateId) return false;
    current = byId.get(current.issuerCertificateId);
  }
  return false;
}

export function certificatesById(
  certificates: readonly CertificateRecord[],
): Map<string, CertificateRecord> {
  return new Map(certificates.map((certificate) => [certificate.id, certificate]));
}

/**
 * Rebuild an account's revocation view from persisted, signed evidence.
 *
 * Never trusts `devices.status`, never trusts a caller-supplied set, and never
 * trusts the `revoked_device_id` column on its own: the device that is revoked
 * is whichever one the SIGNED statement names, and the signature is checked
 * against the revoker's certified key, resolved from its immutable certificate.
 *
 * A statement whose signature does not verify is dropped rather than fatal — a
 * server can add rows, and one bad row must not stop a legitimate rotation for
 * every other device.
 */
export async function loadRevocationSet(
  repository: E2eeRepository,
  userId: string,
  anchor: TrustAnchor,
  atMs: bigint,
): Promise<RevocationSet> {
  const [statements, certificates] = await Promise.all([
    repository.listRevocations(userId),
    repository.listCertificates(userId),
  ]);
  const byId = certificatesById(certificates);
  const set = new RevocationSet();

  for (const record of statements) {
    if (!record.revokerDeviceId) continue;
    const candidates = certificates.filter((c) => c.subjectDeviceId === record.revokerDeviceId);
    for (const candidate of candidates) {
      // The revoker's own chain is checked WITHOUT a revocation lookup: a
      // statement signed by a device that was trusted when it signed stays
      // valid, and consulting the set we are still building would be circular.
      const verified = await isDeviceTrusted({
        chain: buildChain(candidate, byId),
        anchor,
        atMs,
      });
      if (!verified) continue;
      try {
        set.add(await verifyRevocationStatement(record.statement, record.signature, verified.sigSpki));
        break;
      } catch {
        // Forged or malformed. Ignore this statement and keep going.
      }
    }
  }
  return set;
}

export type ResolvedDevice = {
  verified: VerifiedDevice;
  certificate: CertificateRecord;
};

/**
 * Every device of an account that is genuinely certified for a domain.
 *
 * Candidates come from the CERTIFICATE table, not the device table, so a device
 * row a malicious `service_role` invented — with any status it likes, including
 * ACTIVE — is not a candidate at all. It has no certificate, so there is nothing
 * to verify and nothing to select.
 */
export async function resolveTrustedDevices(
  repository: E2eeRepository,
  input: {
    userId: string;
    anchor: TrustAnchor;
    domain: KeyDomainName;
    atMs: bigint;
    revocations: RevocationSet;
  },
): Promise<ResolvedDevice[]> {
  const certificates = await repository.listCertificates(input.userId);
  const byId = certificatesById(certificates);
  const resolved = new Map<string, ResolvedDevice>();

  for (const certificate of certificates) {
    let chain: CertificateWithKeys[];
    try {
      chain = buildChain(certificate, byId);
    } catch {
      continue;
    }
    const verified = await isDeviceTrusted({
      chain,
      anchor: input.anchor,
      atMs: input.atMs,
      requiredDomain: input.domain,
      isRevoked: input.revocations.asLookup(),
    });
    if (!verified) continue;
    // A device may hold more than one certificate over its life. One that
    // verifies is enough, and the first is as good as any: the certified keys
    // must agree with the certificate, so they cannot differ meaningfully.
    const key = hex(verified.deviceId);
    if (!resolved.has(key)) resolved.set(key, { verified, certificate });
  }
  return [...resolved.values()];
}

/**
 * Verify ONE device from raw ids, inside the operation that needs it.
 *
 * This is the function a use case calls when a caller names a device. The caller
 * supplies a string; what comes back is a `VerifiedDevice` that this process
 * derived from a signature chain, plus the certificate it came from.
 */
export async function verifyDeviceById(
  repository: E2eeRepository,
  input: {
    userId: string;
    deviceId: string;
    anchor: TrustAnchor;
    domain?: KeyDomainName;
    atMs: bigint;
    revocations: RevocationSet;
  },
): Promise<ResolvedDevice> {
  const certificates = await repository.listCertificates(input.userId);
  const byId = certificatesById(certificates);
  const wanted = hex(uuidToBytes(input.deviceId));

  for (const certificate of certificates) {
    if (certificate.subjectDeviceId !== input.deviceId) continue;
    let chain: CertificateWithKeys[];
    try {
      chain = buildChain(certificate, byId);
    } catch {
      continue;
    }
    const verified = await isDeviceTrusted({
      chain,
      anchor: input.anchor,
      atMs: input.atMs,
      requiredDomain: input.domain,
      isRevoked: input.revocations.asLookup(),
    });
    if (verified && hex(verified.deviceId) === wanted) return { verified, certificate };
  }
  fail('E_DEVICE_NOT_TRUSTED', `device ${input.deviceId} has no certificate chain to the pinned root`);
}

/** The anchor for an account, assembled from the locally pinned root. */
export async function anchorFromPin(input: {
  userId: string;
  serverOriginId: Uint8Array;
  rootRecSigSpki: Uint8Array;
  recoveryIdentityId: string;
  recoveryVersion: number;
}): Promise<TrustAnchor> {
  return {
    rootRecSigPubFp: await publicKeyFingerprint(input.rootRecSigSpki),
    rootRecSigSpki: input.rootRecSigSpki,
    recoveryIdentityId: uuidToBytes(input.recoveryIdentityId),
    recoveryVersion: input.recoveryVersion,
    userId: uuidToBytes(input.userId),
    serverOriginId: input.serverOriginId,
  };
}
