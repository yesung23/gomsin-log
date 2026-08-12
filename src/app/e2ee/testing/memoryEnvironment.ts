/**
 * TEST SUPPORT — an in-memory server that enforces migration 031's rules.
 *
 * This is not a stub. Every constraint the flows depend on for their security
 * argument is reproduced here, because a flow test against a permissive fake
 * proves nothing:
 *
 *   - an epoch may only be born PREPARING, and state moves only through the
 *     three RPCs, with the same legal edges;
 *   - `e2ee_mark_epoch_ready` refuses an epoch with no recipients;
 *   - `e2ee_activate_epoch` refuses one with a revoked recipient, and retires
 *     the outgoing ACTIVE epoch in the same step;
 *   - a personal or health envelope may only target the scope owner;
 *   - a revoked device may not receive a new envelope at all;
 *   - one envelope per recipient per epoch;
 *   - revocations are append-only with a unique sequence;
 *   - `approve-device` verifies the approval signature under the approver's
 *     CERTIFIED key, and burns the nonce in the same commit;
 *   - `verify-recovery` reconstructs the challenge transcript from server state
 *     and verifies it under the recovery signing key, then burns the challenge.
 *
 * The concrete Supabase adapter's own row and RPC mappings are pinned separately
 * in `src/data/e2ee/supabaseE2eeRepository.test.ts` against a transport shaped
 * like the real client, so "the flows work" and "the adapter speaks PostgREST"
 * are two independent claims with two independent proofs.
 */

import { equalBytes, hex, toBase64, unhex } from '@/crypto/bytes';
import { ASSURANCE, type Assurance, type PlatformName } from '@/crypto/domains';
import { toP1363 } from '@/crypto/ecdsaFormat';
import { randomBytes } from '@/crypto/suite';
import { decodeTbs } from '@/crypto/deviceCertificate';
import { grantsToMask, type KeyDomainName } from '@/crypto/domains';
import type { DeviceKeyPort } from '@/crypto/keystore';
import {
  handleApproveDevice,
  type CertificateRow as EdgeCertificateRow,
} from '../../../../supabase/functions/approve-device/handler';
import { handleVerifyRecovery } from '../../../../supabase/functions/verify-recovery/handler';
import { handleIssueRecoveryChallenge } from '../../../../supabase/functions/issue-recovery-challenge/handler';
import type {
  CertificateRecord,
  DeviceRecord,
  E2eeLocalState,
  E2eeRepository,
  EnrollmentRecord,
  EnvelopeRecord,
  NewCertificate,
  NewEnrollment,
  NewEnvelope,
  NewRecoveryAnchor,
  NewRecoveryIdentity,
  NewScopeKey,
  PairingRecord,
  PartnerRecoveryAnchorRecord,
  PendingBootstrap,
  PinnedTrustAnchor,
  RecoveryAnchorRecord,
  RecoveryChallengeRecord,
  RecoveryIdentityRecord,
  RevocationRecord,
  ScopeKeyRecord,
} from '../ports';
import type { UseCaseDeps } from '../useCases';

export class FakeServerError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'FakeServerError';
  }
}

function reject(code: string): never {
  throw new FakeServerError(code);
}

type ChallengeRow = {
  id: string;
  userId: string;
  recoveryIdentityId: string;
  challengeNonce: Uint8Array;
  recoveryVersion: number;
  newDeviceId: string;
  issuedAtMs: bigint;
  expiresAtMs: bigint;
  consumedAt: number | null;
};

export type MemoryServer = {
  serverOriginId: Uint8Array;
  devices: DeviceRecord[];
  certificates: CertificateRecord[];
  recoveryIdentities: RecoveryIdentityRecord[];
  recoveryAnchors: RecoveryAnchorRecord[];
  scopeKeys: ScopeKeyRecord[];
  envelopes: EnvelopeRecord[];
  enrollments: EnrollmentRecord[];
  pairings: PairingRecord[];
  revocations: RevocationRecord[];
  challenges: ChallengeRow[];
  /** couple id → the two member user ids. */
  couples: Map<string, [string, string]>;
  now: () => number;
  setNow: (value: number) => void;
};

export function createMemoryServer(startMs = 1_800_000_000_000): MemoryServer {
  let clock = startMs;
  return {
    serverOriginId: new Uint8Array(32).fill(3),
    devices: [],
    certificates: [],
    recoveryIdentities: [],
    recoveryAnchors: [],
    scopeKeys: [],
    envelopes: [],
    enrollments: [],
    pairings: [],
    revocations: [],
    challenges: [],
    couples: new Map(),
    now: () => clock,
    setNow: (value: number) => { clock = value; },
  };
}

function partnerOf(server: MemoryServer, userId: string): string | null {
  for (const [, members] of server.couples) {
    if (members[0] === userId) return members[1];
    if (members[1] === userId) return members[0];
  }
  return null;
}

/**
 * The users whose material a scope must reach.
 *
 * Mirrors the `scope_users` CTE in `e2ee_required_epoch_recipients`: the owner
 * for personal/health, both active members for a couple scope.
 */
function scopeUsers(server: MemoryServer, scope: ScopeKeyRecord): string[] {
  if (scope.domain !== 'couple') return scope.ownerUserId ? [scope.ownerUserId] : [];
  const members = server.couples.get(scope.scopeId);
  return members ? [members[0], members[1]] : [];
}

const DOMAIN_BIT: Record<KeyDomainName, number> = { personal: 1, couple: 2, health: 4 };

/**
 * `e2ee_required_epoch_recipients`, in memory.
 *
 * Certificate-driven and status-blind, exactly as the SQL is: a device mid
 * provisioning still needs the key, and `devices.status` has no cryptographic
 * authority anywhere (V2.1 section 3).
 */
export function requiredRecipients(
  server: MemoryServer,
  scope: ScopeKeyRecord,
): { kind: 'device' | 'recovery_identity'; id: string }[] {
  const users = scopeUsers(server, scope);
  const bit = DOMAIN_BIT[scope.domain];
  const revoked = new Set(server.revocations.map((r) => r.revokedDeviceId));

  const devices = new Set<string>();
  for (const certificate of server.certificates) {
    if (!users.includes(certificate.userId)) continue;
    if (revoked.has(certificate.subjectDeviceId)) continue;
    const device = server.devices.find((d) => d.id === certificate.subjectDeviceId);
    if (!device || device.status === 'REVOKED' || device.status === 'PROVISIONING_FAILED') continue;
    const mask = grantsToMask(decodeTbs(certificate.certificate.subarray(0, 317)).grantedDomains);
    if ((mask & bit) === 0) continue;
    devices.add(certificate.subjectDeviceId);
  }

  const recovery = server.recoveryIdentities
    .filter((r) => users.includes(r.userId) && r.supersededAt === null)
    .map((r) => ({ kind: 'recovery_identity' as const, id: r.id }));

  return [...[...devices].map((id) => ({ kind: 'device' as const, id })), ...recovery];
}

/** `e2ee_can_manage_scope_key`, including its NULL-safe reading. */
function canManageScope(server: MemoryServer, scope: ScopeKeyRecord, userId: string): boolean {
  if (scope.domain !== 'couple') return scope.ownerUserId === userId;
  return scopeUsers(server, scope).includes(userId);
}

/** The "Recipient reads own envelopes" policy. */
function envelopeVisibleTo(server: MemoryServer, envelope: EnvelopeRecord, userId: string): boolean {
  if (envelope.recipientKind === 'device') {
    return server.devices.some((d) => d.id === envelope.recipientId && d.userId === userId);
  }
  return server.recoveryIdentities.some(
    (r) => r.id === envelope.recipientId && r.userId === userId,
  );
}

/**
 * The repository as one authenticated account sees it.
 *
 * Scoped per user on purpose: `get_partner_recovery_anchor()` is defined in
 * terms of `auth.uid()`, and an adapter that ignored who is asking would let a
 * pairing test pass for reasons the real database would never allow.
 */
export function createMemoryRepository(server: MemoryServer, userId: string): E2eeRepository {
  const newId = () => crypto.randomUUID();

  const requireScope = (scopeKeyId: string) => {
    const scope = server.scopeKeys.find((k) => k.id === scopeKeyId);
    if (!scope) reject('E2EE_UNKNOWN_EPOCH');
    return scope;
  };

  /**
   * Shared by the coverage query and the finalization gate, so the two cannot
   * disagree about what "covered" means — the same reason the SQL factors this
   * into `e2ee_missing_device_coverage`.
   */
  const missingCoverage = (deviceId: string): { domain: KeyDomainName; scopeId: string }[] => {
    const device = server.devices.find((d) => d.id === deviceId);
    if (!device) reject('E2EE_UNKNOWN_DEVICE');
    const certificate = [...server.certificates].reverse()
      .find((c) => c.subjectDeviceId === deviceId);
    if (!certificate) reject('E2EE_DEVICE_UNCERTIFIED');

    const mask = grantsToMask(decodeTbs(certificate.certificate.subarray(0, 317)).grantedDomains);
    const coupleId = [...server.couples.entries()]
      .find(([, members]) => members.includes(device.userId))?.[0] ?? null;

    const required: { domain: KeyDomainName; scopeId: string }[] = [];
    if ((mask & DOMAIN_BIT.personal) !== 0) {
      required.push({ domain: 'personal', scopeId: device.userId });
    }
    if ((mask & DOMAIN_BIT.health) !== 0) {
      required.push({ domain: 'health', scopeId: device.userId });
    }
    if ((mask & DOMAIN_BIT.couple) !== 0 && coupleId) {
      const hasActive = server.scopeKeys.some(
        (k) => k.domain === 'couple' && k.scopeId === coupleId && k.state === 'ACTIVE',
      );
      if (hasActive) required.push({ domain: 'couple', scopeId: coupleId });
    }

    return required.filter((entry) => !server.scopeKeys.some(
      (scope) => scope.domain === entry.domain
        && scope.scopeId === entry.scopeId
        && scope.state === 'ACTIVE'
        && server.envelopes.some(
          (e) => e.scopeKeyId === scope.id
            && e.recipientKind === 'device'
            && e.recipientId === deviceId
            && e.selfNotarized === true,
        ),
    ));
  };

  return {
    serverOriginId: async () => server.serverOriginId,

    getDevice: async (id) => server.devices.find((d) => d.id === id) ?? null,
    listDevices: async (owner) => server.devices.filter((d) => d.userId === owner),
    insertDevice: async (record) => {
      if (server.devices.some((d) => d.id === record.id)) reject('23505');
      server.devices.push({ ...record });
    },
    // Only the two narrowing transitions, matching the real repository.
    //
    // This used to move a device to any status by assignment, which is what let
    // the earlier provisioning bug look correct here while PostgreSQL refused
    // it. Since 036 an authenticated session has no UPDATE privilege on
    // devices.status at all, and promotions happen only inside the provisioning
    // RPCs — so a fake that still accepted 'ACTIVE' would be modelling a
    // capability the client does not have.
    setDeviceStatus: async (id, status) => {
      const device = server.devices.find((d) => d.id === id);
      if (!device) reject('E2EE_UNKNOWN_DEVICE');
      if (status !== 'REVOKED' && status !== 'PROVISIONING_FAILED') {
        reject('E_DEVICE_STATUS_NOT_CLIENT_SETTABLE');
      }
      device.status = status;
    },

    listCertificates: async (owner) => server.certificates.filter((c) => c.userId === owner),
    getCertificate: async (id) => server.certificates.find((c) => c.id === id) ?? null,
    insertCertificate: async (record: NewCertificate) => {
      const hasIssuer = record.issuerCertificateId !== null;
      const hasAnchor = record.recoveryPublicAnchorId !== null;
      // device_certificates_chain CHECK: exactly one path upward.
      if (hasIssuer === hasAnchor) reject('device_certificates_chain');
      const id = newId();
      server.certificates.push({ ...record, id });
      return id;
    },

    getRecoveryIdentity: async (owner) =>
      server.recoveryIdentities.find((r) => r.userId === owner && r.supersededAt === null) ?? null,
    insertRecoveryIdentity: async (record: NewRecoveryIdentity) => {
      // idx_recovery_identity_live: one live identity per user.
      if (server.recoveryIdentities.some((r) => r.userId === record.userId && r.supersededAt === null)) {
        reject('idx_recovery_identity_live');
      }
      if (record.recSigNonce.length !== 12 || record.recKemNonce.length !== 12) reject('E_BAD_NONCE');
      if (record.bundleSig.length !== 64) reject('bundle_sig_length');
      const id = newId();
      server.recoveryIdentities.push({ ...record, id, supersededAt: null });
      return id;
    },
    getRecoveryAnchorFor: async (recoveryIdentityId) =>
      server.recoveryAnchors.find((a) => a.recoveryIdentityId === recoveryIdentityId) ?? null,
    insertRecoveryAnchor: async (record: NewRecoveryAnchor) => {
      const id = newId();
      server.recoveryAnchors.push({ ...record, id });
      return id;
    },
    getPartnerRecoveryAnchor: async (): Promise<PartnerRecoveryAnchorRecord | null> => {
      const partner = partnerOf(server, userId);
      if (!partner) return null;
      const identity = server.recoveryIdentities.find(
        (r) => r.userId === partner && r.supersededAt === null,
      );
      if (!identity) return null;
      return {
        recoveryIdentityId: identity.id,
        recoveryVersion: identity.recoveryVersion,
        recSigSpki: identity.recSigSpki,
        recKemSpki: identity.recKemSpki,
        recoveryBundleFp: identity.recoveryBundleFp,
      };
    },

    listScopeKeys: async (domain, scopeId) =>
      server.scopeKeys
        .filter((k) => k.domain === domain && k.scopeId === scopeId)
        .sort((a, b) => (a.epoch < b.epoch ? -1 : a.epoch > b.epoch ? 1 : 0)),
    getScopeKey: async (id) => server.scopeKeys.find((k) => k.id === id) ?? null,
    insertScopeKey: async (record: NewScopeKey) => {
      // trg_scope_keys_insert: PREPARING only, and ownership must agree.
      if (record.state !== 'PREPARING') reject('E2EE_EPOCH_MUST_START_PREPARING');
      if (record.domain === 'personal' || record.domain === 'health') {
        if (record.ownerUserId !== userId) reject('E2EE_SCOPE_OWNER_MISMATCH');
        if (record.scopeId !== userId) reject('E2EE_SCOPE_ID_MISMATCH');
      } else {
        if (record.ownerCoupleId !== record.scopeId) reject('E2EE_SCOPE_ID_MISMATCH');
        const members = server.couples.get(record.scopeId);
        if (!members || !members.includes(userId)) reject('E2EE_SCOPE_OWNER_MISMATCH');
      }
      if (server.scopeKeys.some(
        (k) => k.domain === record.domain && k.scopeId === record.scopeId && k.epoch === record.epoch,
      )) {
        reject('scope_keys_domain_scope_epoch_key');
      }
      const id = newId();
      server.scopeKeys.push({ ...record, id });
      return id;
    },
    markEpochReady: async (id) => {
      const scope = requireScope(id);
      // `e2ee_mark_epoch_ready`. The old fake accepted "at least one envelope
      // exists"; the real function verifies FULL recipient coverage internally,
      // which is the only way the check can be correct while RLS hides partner
      // rows from the client.
      if (!canManageScope(server, scope, userId)) reject('E2EE_EPOCH_FORBIDDEN');
      if (scope.state !== 'PREPARING') reject('E2EE_ILLEGAL_EPOCH_TRANSITION');

      const missing = requiredRecipients(server, scope).filter((req) => !server.envelopes.some(
        (e) => e.scopeKeyId === id && e.recipientKind === req.kind && e.recipientId === req.id,
      ));
      if (missing.length > 0) reject('E2EE_EPOCH_INCOMPLETE');

      const revokedNow = new Set(server.revocations.map((r) => r.revokedDeviceId));
      if (server.envelopes.some(
        (e) => e.scopeKeyId === id && e.recipientKind === 'device' && revokedNow.has(e.recipientId),
      )) {
        reject('E2EE_EPOCH_HAS_REVOKED_RECIPIENT');
      }
      scope.state = 'READY';
    },
    activateEpoch: async (id) => {
      const scope = requireScope(id);
      if (!canManageScope(server, scope, userId)) reject('E2EE_EPOCH_FORBIDDEN');
      // The resurrection guard: RETIRED and ABANDONED are terminal.
      if (scope.state !== 'READY') reject('E2EE_ILLEGAL_EPOCH_TRANSITION');
      const revoked = new Set(server.revocations.map((r) => r.revokedDeviceId));
      if (server.envelopes.some(
        (e) => e.scopeKeyId === id && e.recipientKind === 'device' && revoked.has(e.recipientId),
      )) {
        reject('E2EE_EPOCH_HAS_REVOKED_RECIPIENT');
      }
      for (const other of server.scopeKeys) {
        if (other.domain === scope.domain && other.scopeId === scope.scopeId && other.state === 'ACTIVE') {
          other.state = 'RETIRED';
        }
      }
      scope.state = 'ACTIVE';
    },
    abandonEpoch: async (id) => {
      const scope = requireScope(id);
      if (scope.state !== 'PREPARING' && scope.state !== 'READY') reject('E2EE_ILLEGAL_EPOCH_TRANSITION');
      scope.state = 'ABANDONED';
    },

    /**
     * Only the envelopes THIS account may read.
     *
     * The permissive version returned every row and is the reason P0-3 shipped:
     * the application counted partner envelopes to decide epoch completeness and
     * passed here, while the real "Recipient reads own envelopes" policy hides B's
     * rows from A and the same code abandoned a complete epoch. Enforcing the
     * policy here makes that class of defect fail a test instead of production.
     */
    listEnvelopes: async (scopeKeyId) => server.envelopes.filter(
      (e) => e.scopeKeyId === scopeKeyId && envelopeVisibleTo(server, e, userId),
    ),
    listEnvelopesForDevice: async (deviceId) =>
      server.envelopes.filter((e) => e.recipientKind === 'device' && e.recipientId === deviceId),
    listEnvelopesForRecoveryIdentity: async (recoveryIdentityId) =>
      server.envelopes.filter(
        (e) => e.recipientKind === 'recovery_identity' && e.recipientId === recoveryIdentityId,
      ),
    insertEnvelope: async (record: NewEnvelope) => {
      const scope = requireScope(record.scopeKeyId);
      // trg_key_envelopes_recipient, in the same order the trigger checks.
      if (record.recipientKind === 'device') {
        const recipient = server.devices.find((d) => d.id === record.recipientId);
        if (!recipient) reject('E2EE_UNKNOWN_RECIPIENT');
        if ((scope.domain === 'personal' || scope.domain === 'health')
          && recipient.userId !== scope.ownerUserId) {
          reject('E2EE_DOMAIN_RECIPIENT_FORBIDDEN');
        }
        if (server.revocations.some((r) => r.revokedDeviceId === record.recipientId)) {
          reject('E2EE_RECIPIENT_REVOKED');
        }
      } else {
        const identity = server.recoveryIdentities.find((r) => r.id === record.recipientId);
        if (!identity) reject('E2EE_UNKNOWN_RECIPIENT');
        if ((scope.domain === 'personal' || scope.domain === 'health')
          && identity.userId !== scope.ownerUserId) {
          reject('E2EE_DOMAIN_RECIPIENT_FORBIDDEN');
        }
      }
      if (scope.state === 'RETIRED' || scope.state === 'ABANDONED') reject('E2EE_EPOCH_NOT_WRITABLE');
      if (record.envelope.length !== 360) reject('key_envelopes_envelope_check');
      if (!record.senderCertificateId) reject('key_envelopes_sender_certificate_required');
      if (server.envelopes.some(
        (e) => e.scopeKeyId === record.scopeKeyId && e.recipientId === record.recipientId,
      )) {
        reject('idx_envelope_one_per_recipient');
      }
      server.envelopes.push({ ...record, selfNotarized: record.selfNotarized ?? false });
    },
    selfNotarizeEnvelope: async (input) => {
      const envelope = server.envelopes.find(
        (e) => e.scopeKeyId === input.scopeKeyId
          && e.recipientKind === 'device'
          && e.recipientId === input.recipientDeviceId,
      );
      if (!envelope) reject('E2EE_UNKNOWN_ENVELOPE');
      envelope.envelope = input.envelope;
      envelope.senderCertificateId = input.senderCertificateId;
      envelope.senderDeviceId = input.senderDeviceId;
      envelope.selfNotarized = true;
    },

    insertEnrollment: async (record: NewEnrollment) => {
      if (server.enrollments.some((e) => equalBytes(e.enrollNonce, record.enrollNonce))) {
        reject('idx_enrollment_nonce');
      }
      const row: EnrollmentRecord = {
        ...record,
        id: newId(),
        transcriptHash: null,
        approvalSignature: null,
        createdAt: new Date(server.now()).toISOString(),
        approvedAt: null,
        consumedAt: null,
      };
      server.enrollments.push(row);
      return row;
    },
    getEnrollmentByNonce: async (nonce) =>
      server.enrollments.find((e) => equalBytes(e.enrollNonce, nonce)) ?? null,
    setEnrollmentApprover: async (id, approverDeviceId) => {
      const row = server.enrollments.find((e) => e.id === id);
      if (!row) reject('E2EE_UNKNOWN_ENROLLMENT');
      row.approverDeviceId = approverDeviceId;
    },
    approveDeviceEnrollment: async (input) => runApproveDevice(server, userId, input),

    getPairing: async (coupleId) => server.pairings.find((p) => p.coupleId === coupleId) ?? null,

    /**
     * `e2ee_owned_couple_scope_ids()`.
     *
     * Server-side discovery. The fake must not accept a caller-supplied list
     * either, or the P0-5 defect would survive here.
     */
    listOwnedCoupleScopeIds: async () => {
      const owned: string[] = [];
      for (const [coupleId, members] of server.couples) {
        if (!members.includes(userId)) continue;
        const live = server.scopeKeys.some(
          (k) => k.domain === 'couple' && k.scopeId === coupleId
            && (k.state === 'ACTIVE' || k.state === 'PREPARING' || k.state === 'READY'),
        );
        if (live) owned.push(coupleId);
      }
      return owned;
    },

    /** `e2ee_missing_device_coverage`. Fails closed on an uncertified device. */
    listMissingDeviceCoverage: async (deviceId) => missingCoverage(deviceId),

    /** `e2ee_begin_device_provisioning`. Requires a certificate first. */
    beginDeviceProvisioning: async (deviceId) => {
      const device = server.devices.find((d) => d.id === deviceId);
      if (!device) reject('E2EE_UNKNOWN_DEVICE');
      if (device.userId !== userId) reject('E2EE_DEVICE_WRONG_ACCOUNT');
      if (device.status === 'PROVISIONING') return;
      if (device.status !== 'PENDING' && device.status !== 'RECOVERY_AUTHENTICATED') {
        reject('E2EE_ILLEGAL_DEVICE_TRANSITION');
      }
      if (!server.certificates.some((c) => c.subjectDeviceId === deviceId)) {
        reject('E2EE_DEVICE_UNCERTIFIED');
      }
      device.status = 'PROVISIONING';
    },

    /**
     * `e2ee_finalize_device_provisioning` — the ONLY path to ACTIVE.
     *
     * The old fake let the application assign `status = 'ACTIVE'` directly, which
     * is what allowed a half-provisioned device to look finished. Every condition
     * the SQL checks is checked here in the same order.
     */
    finalizeDeviceProvisioning: async (deviceId) => {
      const device = server.devices.find((d) => d.id === deviceId);
      if (!device) reject('E2EE_UNKNOWN_DEVICE');
      if (device.userId !== userId) reject('E2EE_DEVICE_WRONG_ACCOUNT');
      if (server.revocations.some((r) => r.revokedDeviceId === deviceId)) {
        reject('E2EE_DEVICE_REVOKED');
      }
      if (device.status === 'ACTIVE') return;
      if (device.status !== 'PROVISIONING' && device.status !== 'RECOVERY_AUTHENTICATED') {
        reject('E2EE_DEVICE_NOT_PROVISIONING');
      }
      if (!server.certificates.some((c) => c.subjectDeviceId === deviceId)) {
        reject('E2EE_DEVICE_UNCERTIFIED');
      }
      if (missingCoverage(deviceId).length > 0) reject('E2EE_PROVISIONING_INCOMPLETE');
      device.status = 'ACTIVE';
    },
    setPairingState: async (id, state) => {
      const row = server.pairings.find((p) => p.id === id);
      if (!row) reject('E2EE_UNKNOWN_PAIRING');
      row.state = state;
    },

    listRevocations: async (owner) =>
      server.revocations
        .filter((r) => r.userId === owner)
        .sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0)),
    appendRevocation: async (input) => {
      const owns = server.devices.some((d) => d.id === input.revokedDeviceId && d.userId === input.userId);
      if (!owns) reject('revocation_owner_check');
      if (server.revocations.some((r) => r.userId === input.userId && r.sequence === input.sequence)) {
        reject('revocation_statements_user_id_sequence_key');
      }
      if (input.statement.length !== 203) reject('revocation_statement_length');
      if (input.signature.length !== 64) reject('revocation_signature_length');
      server.revocations.push({
        id: newId(),
        userId: input.userId,
        revokedDeviceId: input.revokedDeviceId,
        revokerDeviceId: input.revokerDeviceId,
        reason: 0,
        statement: input.statement,
        signature: input.signature,
        sequence: input.sequence,
        logHead: input.logHead,
      });
    },

    issueRecoveryChallenge: async (input) => runIssueRecoveryChallenge(server, userId, input.deviceId),
    verifyRecoveryAuthentication: async (input) => runVerifyRecovery(server, userId, input),
  };
}

// ---------------------------------------------------------------------------
// The REAL Edge handlers, over in-memory rows
// ---------------------------------------------------------------------------
//
// These three functions are not reimplementations. They call the actual
// handlers from `supabase/functions/**` with adapters that render this store the
// way PostgREST would — every `bytea` as a `\x` hex string, every timestamp as
// an ISO string. So the flow scenarios exercise the real canonical-transcript
// reconstruction, the real approval-signature check, the real challenge
// verification, and the real byte codec, rather than a friendly imitation of
// them. If the client and the Edge Function ever disagree about a transcript
// byte, Scenario B fails immediately instead of at a user's recovery.

/** How PostgREST renders a `bytea` column. */
function pg(bytes: Uint8Array): string {
  return `\\x${hex(bytes)}`;
}

function iso(ms: number | bigint): string {
  return new Date(Number(ms)).toISOString();
}

function edgeDeviceRow(device: DeviceRecord) {
  return {
    id: device.id,
    user_id: device.userId,
    sig_spki: pg(device.sigSpki),
    kem_spki: pg(device.kemSpki),
    status: device.status,
  };
}

/** Walk `issuer_certificate_id` upward, exactly as the entrypoint does. */
function edgeCertificateChain(server: MemoryServer, deviceId: string): EdgeCertificateRow[] {
  const leaf = [...server.certificates].reverse().find((c) => c.subjectDeviceId === deviceId);
  if (!leaf) return [];
  const chain: EdgeCertificateRow[] = [];
  const seen = new Set<string>();
  let current: CertificateRecord | undefined = leaf;
  while (current && chain.length < 8) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.push({
      id: current.id,
      subject_device_id: current.subjectDeviceId,
      issuer_certificate_id: current.issuerCertificateId,
      certificate: pg(current.certificate),
      subject_sig_spki: pg(current.subjectSigSpki),
      subject_kem_spki: pg(current.subjectKemSpki),
    });
    if (!current.issuerCertificateId) break;
    current = server.certificates.find((c) => c.id === current!.issuerCertificateId);
  }
  return chain;
}

function noopLog(): void {
  // The handlers log ids and codes only; the store has nowhere to put them.
}

async function runApproveDevice(
  server: MemoryServer,
  callerUserId: string,
  input: { enrollmentId: string; certificate: Uint8Array; approvalSignature: Uint8Array },
): Promise<{ deviceId: string }> {
  const outcome = await handleApproveDevice(
    {
      enrollmentId: input.enrollmentId,
      // An HTTP body carries base64, so that is what the adapter sends.
      certificate: toBase64(input.certificate),
      approvalSignature: toBase64(input.approvalSignature),
    },
    callerUserId,
    {
      now: () => server.now(),
      getServerOriginId: async () => server.serverOriginId,
      getEnrollment: async (id) => {
        const row = server.enrollments.find((e) => e.id === id);
        if (!row) return null;
        return {
          id: row.id,
          user_id: row.userId,
          new_device_id: row.newDeviceId,
          approver_device_id: row.approverDeviceId,
          enroll_nonce: pg(row.enrollNonce),
          granted_domains: row.grantedDomains,
          created_at: row.createdAt,
          expires_at: row.expiresAt,
          approved_at: row.approvedAt,
          consumed_at: row.consumedAt,
        };
      },
      getDevice: async (id) => {
        const device = server.devices.find((d) => d.id === id);
        return device ? edgeDeviceRow(device) : null;
      },
      getRecoveryAnchor: async (owner) => {
        const identity = server.recoveryIdentities.find(
          (r) => r.userId === owner && r.supersededAt === null,
        );
        if (!identity) return null;
        return {
          id: identity.id,
          recovery_version: identity.recoveryVersion,
          rec_sig_spki: pg(identity.recSigSpki),
          recovery_bundle_fp: pg(identity.recoveryBundleFp),
        };
      },
      getCertificateChain: async (deviceId) => edgeCertificateChain(server, deviceId),
      isDeviceRevoked: async (deviceId) =>
        server.revocations.some((r) => r.revokedDeviceId === deviceId),
      getRevocationLogHead: async (owner) => {
        const rows = server.revocations
          .filter((r) => r.userId === owner)
          .sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
        const last = rows[rows.length - 1];
        return last ? pg(last.logHead) : null;
      },
      commitApproval: async (commit) => {
        // `e2ee_commit_device_approval`: one transaction. Consume the nonce
        // conditionally, persist the certificate, then move status.
        const enrollment = server.enrollments.find((e) => e.id === commit.enrollmentId);
        if (!enrollment || enrollment.consumedAt) return { ok: false, code: 'E_NONCE_ALREADY_USED' };
        const device = server.devices.find((d) => d.id === commit.newDeviceId);
        if (!device || device.status !== 'PENDING') return { ok: false, code: 'E_DEVICE_NOT_PENDING' };

        enrollment.consumedAt = iso(server.now());
        enrollment.approvedAt = enrollment.consumedAt;
        enrollment.transcriptHash = commit.transcriptHash;
        enrollment.approvalSignature = commit.approvalSignature;

        // `e2ee_commit_device_approval` requires the issuer certificate from the
        // CALLER and re-validates it. The fake used to look the approver's newest
        // certificate up itself and fill the column in — which is precisely why
        // the RPC's missing parameter went unnoticed until a real database
        // rejected every approval on device_certificates_chain.
        if (!commit.issuerCertificateId) reject('E2EE_ISSUER_CERTIFICATE_REQUIRED');
        const issuer = server.certificates.find((c) => c.id === commit.issuerCertificateId);
        if (!issuer) reject('E2EE_UNKNOWN_ISSUER_CERTIFICATE');
        if (issuer.userId !== commit.userId) reject('E2EE_ISSUER_WRONG_ACCOUNT');
        if (issuer.subjectDeviceId !== enrollment.approverDeviceId) {
          reject('E2EE_ISSUER_NOT_APPROVER');
        }
        if (server.revocations.some((r) => r.revokedDeviceId === issuer.subjectDeviceId)) {
          reject('E2EE_ISSUER_REVOKED');
        }

        server.certificates.push({
          id: crypto.randomUUID(),
          userId: commit.userId,
          subjectDeviceId: commit.newDeviceId,
          issuerDeviceId: enrollment.approverDeviceId,
          issuerCertificateId: commit.issuerCertificateId,
          recoveryPublicAnchorId: null,
          recoveryIdentityId: commit.recoveryIdentityId,
          recoveryVersion: commit.recoveryVersion,
          certificate: commit.certificate,
          certificateFp: commit.certificateFp,
          subjectSigSpki: commit.subjectSigSpki,
          subjectKemSpki: commit.subjectKemSpki,
        });
        // Approval is not provisioning. The device holds a verifiable certificate
        // and not one scope key.
        device.status = 'PROVISIONING';
        return { ok: true };
      },
      logEvent: noopLog,
    },
  );
  if (outcome.status !== 200) reject((outcome.body as { error: string }).error);
  return { deviceId: (outcome.body as { deviceId: string }).deviceId };
}

async function runIssueRecoveryChallenge(
  server: MemoryServer,
  callerUserId: string,
  deviceId: string,
): Promise<RecoveryChallengeRecord> {
  const outcome = await handleIssueRecoveryChallenge({ deviceId }, callerUserId, {
    now: () => server.now(),
    // Server-controlled. A client that could choose this could replay a captured
    // signature forever, which is why issuance lives behind service_role.
    randomChallenge: () => randomBytes(32),
    getDevice: async (id) => {
      const device = server.devices.find((d) => d.id === id);
      return device ? { id: device.id, user_id: device.userId, status: device.status } : null;
    },
    getCurrentRecoveryIdentity: async (owner) => {
      const identity = server.recoveryIdentities.find(
        (r) => r.userId === owner && r.supersededAt === null,
      );
      if (!identity) return null;
      return {
        id: identity.id,
        user_id: identity.userId,
        recovery_version: identity.recoveryVersion,
        superseded_at: identity.supersededAt,
      };
    },
    countIssuedLastHour: async (owner) => server.challenges.filter(
      (c) => c.userId === owner && Number(c.issuedAtMs) >= server.now() - 3_600_000,
    ).length,
    issue: async ({ userId: owner, deviceId: target, challenge, ttlSeconds }) => {
      // `e2ee_issue_recovery_challenge`: ownership, device state and identity
      // liveness under a row lock, then supersede any earlier live challenge.
      const identity = server.recoveryIdentities.find(
        (r) => r.userId === owner && r.supersededAt === null,
      );
      if (!identity) return { ok: false, code: 'E_NO_RECOVERY_IDENTITY' };
      const device = server.devices.find((d) => d.id === target);
      if (!device) return { ok: false, code: 'E_UNKNOWN_DEVICE' };
      if (device.userId !== owner) return { ok: false, code: 'E_WRONG_ACCOUNT' };
      if (device.status !== 'PENDING') return { ok: false, code: 'E_DEVICE_NOT_PENDING' };
      for (const existing of server.challenges) {
        if (existing.newDeviceId === target && existing.consumedAt === null) {
          existing.consumedAt = server.now();
        }
      }
      const row: ChallengeRow = {
        id: crypto.randomUUID(),
        userId: owner,
        recoveryIdentityId: identity.id,
        challengeNonce: challenge,
        recoveryVersion: identity.recoveryVersion,
        newDeviceId: target,
        issuedAtMs: BigInt(server.now()),
        expiresAtMs: BigInt(server.now() + ttlSeconds * 1000),
        consumedAt: null,
      };
      server.challenges.push(row);
      return {
        ok: true,
        row: {
          id: row.id,
          user_id: row.userId,
          recovery_identity_id: row.recoveryIdentityId,
          recovery_version: row.recoveryVersion,
          new_device_id: row.newDeviceId,
          challenge_nonce: pg(row.challengeNonce),
          issued_at: iso(row.issuedAtMs),
          expires_at: iso(row.expiresAtMs),
        },
      };
    },
    logEvent: noopLog,
  });

  if (outcome.status !== 200) reject((outcome.body as { error: string }).error);
  const body = outcome.body as {
    challengeId: string;
    challenge: string;
    recoveryIdentityId: string;
    recoveryVersion: number;
    deviceId: string;
    issuedAt: string;
    expiresAt: string;
  };
  return {
    id: body.challengeId,
    userId: callerUserId,
    recoveryIdentityId: body.recoveryIdentityId,
    // The response body is base64; the column was `bytea`. Two encodings, and
    // the adapter has to know which one it is holding at each step.
    challengeNonce: unhex(
      [...atob(body.challenge)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    ),
    recoveryVersion: body.recoveryVersion,
    newDeviceId: body.deviceId,
    issuedAtMs: BigInt(Date.parse(body.issuedAt)),
    expiresAtMs: BigInt(Date.parse(body.expiresAt)),
  };
}

async function runVerifyRecovery(
  server: MemoryServer,
  callerUserId: string,
  input: { challengeId: string; deviceId: string; signature: Uint8Array },
): Promise<{ deviceId: string; nextState: 'RECOVERY_AUTHENTICATED' }> {
  const outcome = await handleVerifyRecovery(
    { challengeId: input.challengeId, deviceId: input.deviceId, signature: toBase64(input.signature) },
    callerUserId,
    {
      now: () => server.now(),
      getServerOriginId: async () => server.serverOriginId,
      getChallenge: async (id) => {
        const row = server.challenges.find((c) => c.id === id);
        if (!row) return null;
        return {
          id: row.id,
          user_id: row.userId,
          recovery_identity_id: row.recoveryIdentityId,
          challenge_nonce: pg(row.challengeNonce),
          recovery_version: row.recoveryVersion,
          new_device_id: row.newDeviceId,
          issued_at: iso(row.issuedAtMs),
          expires_at: iso(row.expiresAtMs),
          consumed_at: row.consumedAt === null ? null : iso(row.consumedAt),
        };
      },
      getCurrentRecoveryIdentity: async (owner) => {
        const identity = server.recoveryIdentities.find(
          (r) => r.userId === owner && r.supersededAt === null,
        );
        if (!identity) return null;
        return {
          id: identity.id,
          recovery_version: identity.recoveryVersion,
          rec_sig_spki: pg(identity.recSigSpki),
          superseded_at: identity.supersededAt,
        };
      },
      getDevice: async (id) => {
        const device = server.devices.find((d) => d.id === id);
        return device ? edgeDeviceRow(device) : null;
      },
      countRecentAttempts: async (owner) => server.challenges.filter(
        (c) => c.userId === owner && Number(c.issuedAtMs) >= server.now() - 3_600_000,
      ).length - 1,
      commitAuthentication: async ({ challengeId, deviceId, recoveryIdentityId, recoveryVersion }) => {
        const challenge = server.challenges.find((c) => c.id === challengeId);
        if (!challenge) return { ok: false, code: 'E_UNKNOWN_CHALLENGE' };
        if (challenge.recoveryIdentityId !== recoveryIdentityId
          || challenge.recoveryVersion !== recoveryVersion) {
          return { ok: false, code: 'E_RECOVERY_IDENTITY_MISMATCH' };
        }
        if (challenge.consumedAt !== null) return { ok: false, code: 'E_CHALLENGE_ALREADY_USED' };
        const device = server.devices.find((d) => d.id === deviceId);
        if (!device || device.status !== 'PENDING') return { ok: false, code: 'E_DEVICE_NOT_PENDING' };
        challenge.consumedAt = server.now();
        device.status = 'RECOVERY_AUTHENTICATED';
        return { ok: true };
      },
      logEvent: noopLog,
    },
  );
  if (outcome.status !== 200) reject((outcome.body as { error: string }).error);
  return { deviceId: input.deviceId, nextState: 'RECOVERY_AUTHENTICATED' };
}

// ---------------------------------------------------------------------------
// Local state and device keys
// ---------------------------------------------------------------------------

export type MemoryLocalState = E2eeLocalState & {
  bootstraps: Map<string, PendingBootstrap>;
  anchors: Map<string, PinnedTrustAnchor>;
};

/**
 * One local state per ACCOUNT, shared by that account's devices in these tests.
 *
 * The security-relevant separation is the key store, which stays strictly per
 * device below. Local state models what the account's client already knows —
 * including the partner anchor a confirmed pairing pinned.
 */
export function createMemoryLocalState(): MemoryLocalState {
  const bootstraps = new Map<string, PendingBootstrap>();
  const anchors = new Map<string, PinnedTrustAnchor>();
  return {
    bootstraps,
    anchors,
    loadBootstrap: async (userId) => bootstraps.get(userId) ?? null,
    saveBootstrap: async (userId, pending) => { bootstraps.set(userId, { ...pending }); },
    clearBootstrapSecret: async (userId) => {
      const pending = bootstraps.get(userId);
      if (pending) bootstraps.set(userId, { ...pending, recoverySecret: null });
    },
    pinTrustAnchor: async (userId, anchor) => { anchors.set(userId, anchor); },
    loadTrustAnchor: async (userId) => anchors.get(userId) ?? null,
  };
}

/** A software device-key port with the same contract as the native one. */
export function createMemoryDeviceKeys(assurance: Assurance = ASSURANCE.secureEnclave): DeviceKeyPort {
  const keys = new Map<string, { pair: CryptoKeyPair; spki: Uint8Array }>();

  async function generate(alias: string, kind: 'ECDSA' | 'ECDH') {
    const pair = (await crypto.subtle.generateKey(
      { name: kind, namedCurve: 'P-256' },
      // Non-extractable, exactly like the platform ports: nothing in the flows
      // may depend on reading a device private key back.
      false,
      kind === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'],
    )) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    keys.set(alias, { pair, spki });
    return { handle: alias, publicKeySpki: spki, assurance };
  }

  const require = (handle: string) => {
    const key = keys.get(handle);
    if (!key) throw new Error(`E_NO_SUCH_KEY: ${handle}`);
    return key;
  };

  return {
    generateSigningKey: (alias) => generate(alias, 'ECDSA'),
    generateAgreementKey: (alias) => generate(alias, 'ECDH'),
    getPublicKey: async (handle) => require(handle).spki,
    sign: async (handle, message) => toP1363(new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, require(handle).pair.privateKey, message as BufferSource,
      ),
    )),
    deriveSecret: async (handle, peerSpki) => {
      const peer = await crypto.subtle.importKey(
        'spki', peerSpki as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
      );
      return new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'ECDH', public: peer }, require(handle).pair.privateKey, 256,
      ));
    },
    deleteKey: async (handle) => { keys.delete(handle); },
    getAssurance: async () => assurance,
    hasKey: async (alias) => keys.has(alias),
  };
}

export type DeviceEnvironment = {
  deps: UseCaseDeps;
  deviceKeys: DeviceKeyPort;
};

/**
 * One physical device belonging to one account.
 *
 * Separate key store per device; shared server; shared account-level local
 * state. `newId` produces real UUIDs because every id in this protocol is
 * serialized as 16 bytes and a placeholder would not encode.
 */
export function createDeviceEnvironment(input: {
  server: MemoryServer;
  userId: string;
  localState: MemoryLocalState;
  assurance?: Assurance;
  enabled?: boolean;
}): DeviceEnvironment {
  const deviceKeys = createMemoryDeviceKeys(input.assurance ?? ASSURANCE.secureEnclave);
  return {
    deviceKeys,
    deps: {
      repository: createMemoryRepository(input.server, input.userId),
      localState: input.localState,
      deviceKeys,
      flag: { isEnabled: () => input.enabled !== false },
      now: () => input.server.now(),
      newId: () => crypto.randomUUID(),
    },
  };
}

export type MemoryAccount = {
  userId: string;
  localState: MemoryLocalState;
  devices: DeviceEnvironment[];
  addDevice(options?: { assurance?: Assurance; platform?: PlatformName }): DeviceEnvironment;
};

export function createMemoryAccount(server: MemoryServer, userId = crypto.randomUUID()): MemoryAccount {
  const localState = createMemoryLocalState();
  const devices: DeviceEnvironment[] = [];
  const account: MemoryAccount = {
    userId,
    localState,
    devices,
    addDevice(options) {
      const env = createDeviceEnvironment({
        server, userId, localState, assurance: options?.assurance,
      });
      devices.push(env);
      return env;
    },
  };
  account.addDevice();
  return account;
}

export function linkCouple(server: MemoryServer, a: string, b: string): string {
  const coupleId = crypto.randomUUID();
  server.couples.set(coupleId, [a, b]);
  server.pairings.push({
    id: crypto.randomUUID(),
    coupleId,
    state: 'CRYPTO_PENDING',
    pairingNonce: null,
    transcriptHash: null,
    confirmedLowSignature: null,
    confirmedLowDeviceId: null,
    confirmedHighSignature: null,
    confirmedHighDeviceId: null,
    expiresAt: null,
  });
  return coupleId;
}

export function envelopeRecipients(server: MemoryServer, scopeKeyId: string): string[] {
  return server.envelopes.filter((e) => e.scopeKeyId === scopeKeyId).map((e) => e.recipientId).sort();
}

export function activeScope(
  server: MemoryServer,
  domain: 'personal' | 'health' | 'couple',
  scopeId: string,
): ScopeKeyRecord | undefined {
  return server.scopeKeys.find((k) => k.domain === domain && k.scopeId === scopeId && k.state === 'ACTIVE');
}

export { hex };
