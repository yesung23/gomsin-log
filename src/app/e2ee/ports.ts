/**
 * Repository ports for the E2EE use cases.
 *
 * Narrow on purpose. The use cases below the presentation layer depend on these
 * interfaces, not on `@supabase/supabase-js` and not on `store.tsx`, which is
 * what keeps `AGENTS.md` §4's boundary real rather than aspirational:
 *
 *   Presentation → ViewModel/Hook → Use Case → Repository → Crypto → Supabase
 *
 * The Supabase-backed implementation is `src/data/e2ee/SupabaseE2eeRepository.ts`.
 * The use cases are ALSO driven against in-memory fakes so every branch is
 * reachable without a server — but the fakes are a test convenience, not the
 * delivery: `supabaseE2eeRepository.test.ts` pins the concrete adapter's row and
 * RPC mappings against a mocked transport shaped like the real client.
 *
 * Two representation rules, both learned the hard way:
 *
 *   - Every 64-bit protocol value is a `bigint` here and is selected as text at
 *     the transport. A JSON number silently rewrites anything above 2^53.
 *   - Every byte string is a `Uint8Array` here. `bytea` hex encoding belongs to
 *     the adapter and appears nowhere above it.
 */

import type { Assurance, KeyDomainName, PlatformName, RevocationReasonName } from '@/crypto/domains';

export type DeviceRecord = {
  id: string;
  userId: string;
  sigSpki: Uint8Array;
  kemSpki: Uint8Array;
  platform: PlatformName;
  assurance: Assurance;
  /** Operational only. Never used as a trust input by any use case. */
  status: string;
};

/**
 * A stored certificate, with its verification path modelled explicitly.
 *
 * `issuerCertificateId` and `recoveryPublicAnchorId` are mutually exclusive and
 * are how a chain is reassembled from rows: follow the issuer link upward until
 * one terminates at an anchor. Neither is optional-by-accident — migration 031
 * has a CHECK constraint requiring exactly one.
 */
export type CertificateRecord = {
  id: string;
  userId: string;
  subjectDeviceId: string;
  issuerDeviceId: string | null;
  issuerCertificateId: string | null;
  recoveryPublicAnchorId: string | null;
  recoveryIdentityId: string;
  recoveryVersion: number;
  certificate: Uint8Array;
  certificateFp: Uint8Array;
  subjectSigSpki: Uint8Array;
  subjectKemSpki: Uint8Array;
};

export type NewCertificate = Omit<CertificateRecord, 'id'>;

export type ScopeKeyRecord = {
  id: string;
  domain: KeyDomainName;
  scopeId: string;
  epoch: bigint;
  state: 'PREPARING' | 'READY' | 'ACTIVE' | 'RETIRED' | 'ABANDONED';
  ownerUserId: string | null;
  ownerCoupleId: string | null;
};

export type NewScopeKey = Omit<ScopeKeyRecord, 'id' | 'state'> & { state: 'PREPARING' };

export type EnvelopeRecord = {
  scopeKeyId: string;
  recipientKind: 'device' | 'recovery_identity';
  recipientId: string;
  senderDeviceId: string | null;
  senderCertificateId: string;
  envelope: Uint8Array;
  selfNotarized: boolean;
};

export type NewEnvelope = Omit<EnvelopeRecord, 'selfNotarized'> & { selfNotarized?: boolean };

/**
 * The recovery identity, with the AEAD nonces as first-class fields.
 *
 * Migration 031 has no nonce column: `enc_rec_sig_priv` is `nonce ‖ ct ‖ tag`.
 * Splitting it here rather than in the use case is deliberate — the previous
 * implementation generated a nonce, sealed with it, and dropped it on the floor,
 * which produced material that could never be decrypted by anyone including its
 * owner. A field that must survive a round trip is a field the port names.
 */
export type RecoveryIdentityRecord = {
  id: string;
  userId: string;
  recoveryVersion: number;
  recoverySalt: Uint8Array;
  recSigSpki: Uint8Array;
  recKemSpki: Uint8Array;
  /** 12-byte AES-GCM nonce for `encRecSigPriv`. */
  recSigNonce: Uint8Array;
  /** `ciphertext ‖ tag` only; the nonce is the field above. */
  encRecSigPriv: Uint8Array;
  /** 12-byte AES-GCM nonce for `encRecKemPriv`. */
  recKemNonce: Uint8Array;
  encRecKemPriv: Uint8Array;
  recoveryBundleFp: Uint8Array;
  /** ECDSA over `recoveryBundleSignedMessage(fp)` by `rec_sig`. 64 bytes. */
  bundleSig: Uint8Array;
  supersededAt: string | null;
};

export type NewRecoveryIdentity = Omit<RecoveryIdentityRecord, 'id' | 'supersededAt'>;

/** The non-secret half, kept so a historical certificate stays checkable. */
export type RecoveryAnchorRecord = {
  id: string;
  userId: string;
  recoveryIdentityId: string;
  recoveryVersion: number;
  recSigSpki: Uint8Array;
  recSigFp: Uint8Array;
  recoveryBundleFp: Uint8Array;
};

export type NewRecoveryAnchor = Omit<RecoveryAnchorRecord, 'id'>;

/** The partner's public anchor, from `get_partner_recovery_anchor()`. */
export type PartnerRecoveryAnchorRecord = {
  recoveryIdentityId: string;
  recoveryVersion: number;
  recSigSpki: Uint8Array;
  recKemSpki: Uint8Array;
  recoveryBundleFp: Uint8Array;
};

export type EnrollmentRecord = {
  id: string;
  userId: string;
  newDeviceId: string;
  approverDeviceId: string | null;
  enrollNonce: Uint8Array;
  grantedDomains: number;
  transcriptHash: Uint8Array | null;
  approvalSignature: Uint8Array | null;
  /**
   * Authoritative `issuedAtMs` for the enrollment transcript.
   *
   * Both devices AND the Edge Function bind this into the canonical bytes, so
   * it has to be the stored value. An earlier revision derived it as
   * `expiresAt - TTL`, which agreed with the server only for as long as nobody
   * ever changed the TTL constant on one side.
   */
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
};

export type NewEnrollment = {
  userId: string;
  newDeviceId: string;
  approverDeviceId: string | null;
  enrollNonce: Uint8Array;
  grantedDomains: number;
  expiresAt: string;
};

export type PairingRecord = {
  id: string;
  coupleId: string;
  state: string;
  pairingNonce: Uint8Array | null;
  transcriptHash: Uint8Array | null;
  confirmedLowSignature: Uint8Array | null;
  confirmedLowDeviceId: string | null;
  confirmedHighSignature: Uint8Array | null;
  confirmedHighDeviceId: string | null;
  expiresAt: string | null;
};

/**
 * A persisted revocation, exactly as stored.
 *
 * Note what is NOT here: the revoker's public key. `revocation_statements` does
 * not store one, and it must not — a signature checked against a key that
 * travels beside it proves nothing. The use case resolves the revoker's key from
 * its immutable certificate and verifies against that.
 */
export type RevocationRecord = {
  id: string;
  userId: string;
  revokedDeviceId: string;
  revokerDeviceId: string | null;
  reason: number;
  statement: Uint8Array;
  signature: Uint8Array;
  sequence: bigint;
  logHead: Uint8Array;
};

export type RecoveryChallengeRecord = {
  id: string;
  userId: string;
  /** Bound so a challenge cannot outlive the identity it was issued against. */
  recoveryIdentityId: string;
  challengeNonce: Uint8Array;
  recoveryVersion: number;
  newDeviceId: string;
  issuedAtMs: bigint;
  expiresAtMs: bigint;
};

export interface E2eeRepository {
  serverOriginId(): Promise<Uint8Array>;

  // --- devices -------------------------------------------------------------
  getDevice(deviceId: string): Promise<DeviceRecord | null>;
  listDevices(userId: string): Promise<DeviceRecord[]>;
  insertDevice(record: DeviceRecord): Promise<void>;
  setDeviceStatus(deviceId: string, status: string): Promise<void>;

  // --- certificates --------------------------------------------------------
  listCertificates(userId: string): Promise<CertificateRecord[]>;
  getCertificate(certificateId: string): Promise<CertificateRecord | null>;
  insertCertificate(record: NewCertificate): Promise<string>;

  // --- recovery identity and anchors ---------------------------------------
  getRecoveryIdentity(userId: string): Promise<RecoveryIdentityRecord | null>;
  insertRecoveryIdentity(record: NewRecoveryIdentity): Promise<string>;
  getRecoveryAnchorFor(recoveryIdentityId: string): Promise<RecoveryAnchorRecord | null>;
  insertRecoveryAnchor(record: NewRecoveryAnchor): Promise<string>;
  getPartnerRecoveryAnchor(): Promise<PartnerRecoveryAnchorRecord | null>;

  // --- scope keys ----------------------------------------------------------
  /** The server-authoritative minimum cipher format for one scope. */
  getWriteFloor(domain: KeyDomainName, scopeId: string): Promise<number>;
  /** The only application path allowed to request an irreversible floor. */
  activateWriteFloor(scopeKind: 'user' | 'couple', scopeId: string, deviceId: string): Promise<void>;
  listScopeKeys(domain: KeyDomainName, scopeId: string): Promise<ScopeKeyRecord[]>;
  getScopeKey(scopeKeyId: string): Promise<ScopeKeyRecord | null>;
  insertScopeKey(record: NewScopeKey): Promise<string>;
  /** Calls `e2ee_mark_epoch_ready`. Never a direct UPDATE. */
  markEpochReady(scopeKeyId: string): Promise<void>;
  /** Calls `e2ee_activate_epoch`. Never a direct UPDATE. */
  activateEpoch(scopeKeyId: string): Promise<void>;
  /** Calls `e2ee_abandon_epoch`. Never a direct UPDATE. */
  abandonEpoch(scopeKeyId: string): Promise<void>;

  // --- envelopes -----------------------------------------------------------
  listEnvelopes(scopeKeyId: string): Promise<EnvelopeRecord[]>;
  /** Every envelope addressed to one device, across every epoch it holds. */
  listEnvelopesForDevice(deviceId: string): Promise<EnvelopeRecord[]>;
  listEnvelopesForRecoveryIdentity(recoveryIdentityId: string): Promise<EnvelopeRecord[]>;
  insertEnvelope(record: NewEnvelope): Promise<void>;
  /** Re-wrap under the recipient's own signature; sets `self_notarized`. */
  selfNotarizeEnvelope(input: {
    scopeKeyId: string;
    recipientDeviceId: string;
    envelope: Uint8Array;
    senderCertificateId: string;
    senderDeviceId: string;
  }): Promise<void>;

  // --- enrollment ----------------------------------------------------------
  insertEnrollment(record: NewEnrollment): Promise<EnrollmentRecord>;
  getEnrollmentByNonce(enrollNonce: Uint8Array): Promise<EnrollmentRecord | null>;
  setEnrollmentApprover(enrollmentId: string, approverDeviceId: string): Promise<void>;
  /**
   * Invokes the `approve-device` Edge Function, which burns the nonce, persists
   * the certificate and moves operational status in ONE transaction.
   *
   * Addressed by enrollment id, and it carries NO transcript. The server
   * reconstructs the canonical transcript from its own state and derives the
   * hash itself; a client that could hand over transcript bytes could make the
   * server verify a signature over facts the client chose.
   */
  approveDeviceEnrollment(input: {
    enrollmentId: string;
    certificate: Uint8Array;
    approvalSignature: Uint8Array;
  }): Promise<{ deviceId: string }>;

  // --- pairing -------------------------------------------------------------
  getPairing(coupleId: string): Promise<PairingRecord | null>;
  setPairingState(pairingId: string, state: string): Promise<void>;

  /**
   * Every couple scope this account holds that requires rotation.
   *
   * Server-side and authoritative. The recovering client cannot be asked for
   * this list: a caller that omitted a couple would rotate PMK and HRK, skip the
   * CSK, and still look like a completed recovery — leaving a shared key in the
   * hands of a device the recovery was performed to displace.
   *
   * Calls `e2ee_owned_couple_scope_ids()`.
   */
  listOwnedCoupleScopeIds(): Promise<string[]>;

  /**
   * ACTIVE epochs a device is granted but holds no self-notarized envelope for.
   *
   * Empty means fully provisioned. Calls `e2ee_missing_device_coverage`.
   */
  listMissingDeviceCoverage(deviceId: string): Promise<{ domain: KeyDomainName; scopeId: string }[]>;

  /**
   * PENDING/RECOVERY_AUTHENTICATED → PROVISIONING. Calls
   * `e2ee_begin_device_provisioning`; never a direct status UPDATE.
   */
  beginDeviceProvisioning(deviceId: string): Promise<void>;

  /**
   * The ONLY path to ACTIVE. The server re-verifies the certificate, the absence
   * of a revocation, and full envelope coverage before it agrees.
   *
   * Calls `e2ee_finalize_device_provisioning`.
   */
  finalizeDeviceProvisioning(deviceId: string): Promise<void>;

  // --- revocation ----------------------------------------------------------
  listRevocations(userId: string): Promise<RevocationRecord[]>;
  appendRevocation(input: {
    userId: string;
    revokedDeviceId: string;
    revokerDeviceId: string;
    reason: RevocationReasonName;
    statement: Uint8Array;
    signature: Uint8Array;
    revokedAtMs: bigint;
    sequence: bigint;
    logHead: Uint8Array;
  }): Promise<void>;

  // --- recovery RPCs -------------------------------------------------------
  /** Server-issued, server-nonced. A client can never mint one. */
  issueRecoveryChallenge(input: { userId: string; deviceId: string }): Promise<RecoveryChallengeRecord>;
  /** Invokes `verify-recovery`, which burns the challenge atomically. */
  verifyRecoveryAuthentication(input: {
    challengeId: string;
    deviceId: string;
    signature: Uint8Array;
  }): Promise<{ deviceId: string; nextState: 'RECOVERY_AUTHENTICATED' }>;
}

// ---------------------------------------------------------------------------
// Local state
// ---------------------------------------------------------------------------

/**
 * Where the first-device bootstrap has got to.
 *
 * `CREATING` is resumable and `RECOVERY_KIT_PENDING_VERIFICATION` is the state
 * an account sits in until the human proves they kept the kit. Nothing between
 * them ever mints a second recovery identity: the resume path adopts what is
 * already persisted.
 */
export type BootstrapState =
  | 'NOT_STARTED'
  | 'CREATING'
  | 'RECOVERY_KIT_PENDING_VERIFICATION'
  | 'COMPLETE';

/**
 * Everything an interrupted bootstrap needs in order to be finished rather than
 * restarted.
 *
 * The recovery secret lives here, on this device only, from the moment it is
 * generated until the kit is confirmed — it is on the screen during that window
 * anyway. It is cleared at COMPLETE. Without it a crash between "recovery
 * identity written" and "kit confirmed" would be unrecoverable: the encrypted
 * private material on the server is openable by exactly one 256-bit value, and
 * that value is deliberately not on the server.
 */
export type PendingBootstrap = {
  state: BootstrapState;
  deviceId: string;
  sigHandle: string;
  kemHandle: string;
  platform: PlatformName;
  /** Present until COMPLETE, then cleared. */
  recoverySecret: Uint8Array | null;
  recoveryIdentityId: string | null;
  recoveryVersion: number;
  recoveryAnchorId: string | null;
  certificateId: string | null;
  recoveryCode: string | null;
  anchorTag: string | null;
  personalScopeKeyId: string | null;
  healthScopeKeyId: string | null;
};

export type PinnedTrustAnchor = {
  rootRecSigPubFp: Uint8Array;
  rootRecSigSpki: Uint8Array;
  recoveryIdentityId: string;
  recoveryVersion: number;
};

export interface E2eeLocalState {
  loadBootstrap(userId: string): Promise<PendingBootstrap | null>;
  saveBootstrap(userId: string, pending: PendingBootstrap): Promise<void>;
  clearBootstrapSecret(userId: string): Promise<void>;
  /** The pinned trust anchor for an account. Written once, at provisioning. */
  pinTrustAnchor(userId: string, anchor: PinnedTrustAnchor): Promise<void>;
  loadTrustAnchor(userId: string): Promise<PinnedTrustAnchor | null>;
}

/** Feature flag. E2EE stays OFF until the native integration gate closes. */
export interface E2eeFeatureFlag {
  isEnabled(): boolean;
}
