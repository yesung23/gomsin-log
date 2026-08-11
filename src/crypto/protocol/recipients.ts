/**
 * Recipient selection — the single chokepoint that decides who may receive a
 * scope key.
 *
 * This module exists because of one specific attack. A malicious `service_role`
 * inserts a device row it controls, sets `status = 'ACTIVE'`, and waits for an
 * honest client to enumerate devices and wrap the couple key to everything it
 * finds. Architecture V2 was vulnerable to exactly that.
 *
 * The fix is structural rather than a check bolted on: candidates come from the
 * server, membership in the recipient set does not. Every candidate must
 * present a certificate chain that verifies to a recovery root the caller has
 * already pinned — locally at provisioning for its own account, or through a
 * SAS-confirmed pairing transcript for the partner. `status` is never read.
 */

import { hex } from '../bytes';
import type { KeyDomainName } from '../domains';
import {
  isDeviceTrusted,
  type CertificateWithKeys,
  type TrustAnchor,
  type VerifiedDevice,
} from '../deviceCertificate';
import type { RevocationSet } from '../revocation';

export type CandidateDevice = {
  deviceId: Uint8Array;
  /** Leaf first, root last. Supplied by the server; verified here. */
  chain: CertificateWithKeys[];
  /** Operational only. Recorded for diagnostics; never consulted for trust. */
  serverReportedStatus?: string;
};

export type RecipientSelection = {
  eligible: VerifiedDevice[];
  /** Rejected candidates, with the reason, so the UI can explain a gap. */
  rejected: { deviceId: string; reason: 'untrusted' | 'domain_not_granted' | 'revoked' }[];
};

export type SelectRecipientsInput = {
  candidates: CandidateDevice[];
  anchor: TrustAnchor;
  domain: KeyDomainName;
  atMs: bigint;
  revocations?: RevocationSet;
};

/**
 * Filter candidates to those genuinely authorized for the domain.
 *
 * Non-throwing by design: an untrusted or revoked candidate is dropped so a
 * legitimate rotation still completes for the remaining devices, rather than
 * one bad row aborting the whole operation and stranding the user.
 */
export async function selectRecipients(input: SelectRecipientsInput): Promise<RecipientSelection> {
  const eligible: VerifiedDevice[] = [];
  const rejected: RecipientSelection['rejected'] = [];

  for (const candidate of input.candidates) {
    const verified = await isDeviceTrusted({
      chain: candidate.chain,
      anchor: input.anchor,
      atMs: input.atMs,
      requiredDomain: input.domain,
      isRevoked: input.revocations?.asLookup(),
    });

    if (verified) {
      eligible.push(verified);
      continue;
    }

    // Distinguish the reasons only for the user-facing explanation. All three
    // are equally excluded.
    const withoutDomain = await isDeviceTrusted({
      chain: candidate.chain,
      anchor: input.anchor,
      atMs: input.atMs,
      isRevoked: input.revocations?.asLookup(),
    });
    const revoked = input.revocations?.lookup(candidate.deviceId);
    rejected.push({
      deviceId: hex(candidate.deviceId),
      reason: revoked ? 'revoked' : withoutDomain ? 'domain_not_granted' : 'untrusted',
    });
  }

  return { eligible, rejected };
}

/**
 * Health recipients, restricted to one account.
 *
 * Belt and braces on top of `requiredDomain`: even a caller that somehow
 * assembled a partner's certificate chain into the candidate list cannot get a
 * health envelope addressed, because the owner check happens here too and the
 * database refuses the row independently.
 */
export async function selectHealthRecipients(
  input: Omit<SelectRecipientsInput, 'domain'> & { ownerUserId: Uint8Array },
): Promise<RecipientSelection> {
  if (hex(input.anchor.userId) !== hex(input.ownerUserId)) {
    // The anchor belongs to somebody else, so nothing here is a health
    // recipient. Returning empty rather than throwing keeps the caller simple.
    return { eligible: [], rejected: [] };
  }
  return selectRecipients({ ...input, domain: 'health' });
}
