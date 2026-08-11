/**
 * Repository ports for the E2EE use cases.
 *
 * Narrow on purpose. The use cases below the presentation layer depend on these
 * interfaces, not on `@supabase/supabase-js` and not on `store.tsx`, which is
 * what keeps `AGENTS.md` §4's boundary real rather than aspirational:
 *
 *   Presentation → ViewModel/Hook → Use Case → Repository → Crypto → Supabase
 *
 * A Supabase-backed implementation lives in `src/data/e2ee/`; the use cases are
 * tested against in-memory fakes, so every branch is reachable without a server.
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

export type CertificateRecord = {
  id: string;
  userId: string;
  subjectDeviceId: string;
  certificate: Uint8Array;
  subjectSigSpki: Uint8Array;
  subjectKemSpki: Uint8Array;
};

export type ScopeKeyRecord = {
  id: string;
  domain: KeyDomainName;
  scopeId: string;
  epoch: bigint;
  state: 'PREPARING' | 'READY' | 'ACTIVE' | 'RETIRED' | 'ABANDONED';
};

export type EnvelopeRecord = {
  scopeKeyId: string;
  recipientKind: 'device' | 'recovery_identity';
  recipientId: string;
  senderCertificateId?: string;
  envelope: Uint8Array;
};

export type RecoveryIdentityRecord = {
  id: string;
  userId: string;
  recoveryVersion: number;
  recoverySalt: Uint8Array;
  recSigSpki: Uint8Array;
  recKemSpki: Uint8Array;
  encRecSigPriv: Uint8Array;
  encRecKemPriv: Uint8Array;
  recoveryBundleFp: Uint8Array;
};

export interface E2eeRepository {
  serverOriginId(): Promise<Uint8Array>;

  getDevice(deviceId: string): Promise<DeviceRecord | null>;
  listDevices(userId: string): Promise<DeviceRecord[]>;
  insertDevice(record: Omit<DeviceRecord, 'status'> & { status: string }): Promise<void>;
  setDeviceStatus(deviceId: string, status: string): Promise<void>;

  listCertificates(userId: string): Promise<CertificateRecord[]>;
  insertCertificate(record: Omit<CertificateRecord, 'id'>): Promise<string>;

  getRecoveryIdentity(userId: string): Promise<RecoveryIdentityRecord | null>;
  insertRecoveryIdentity(record: Omit<RecoveryIdentityRecord, 'id'>): Promise<string>;

  listScopeKeys(domain: KeyDomainName, scopeId: string): Promise<ScopeKeyRecord[]>;
  insertScopeKey(record: Omit<ScopeKeyRecord, 'id'>): Promise<string>;
  /** Calls `e2ee_mark_epoch_ready`. Never a direct UPDATE. */
  markEpochReady(scopeKeyId: string): Promise<void>;
  /** Calls `e2ee_activate_epoch`. Never a direct UPDATE. */
  activateEpoch(scopeKeyId: string): Promise<void>;
  abandonEpoch(scopeKeyId: string): Promise<void>;

  listEnvelopes(scopeKeyId: string): Promise<EnvelopeRecord[]>;
  insertEnvelope(record: EnvelopeRecord): Promise<void>;

  listRevocations(userId: string): Promise<{ tbs: Uint8Array; signature: Uint8Array; revokerSigSpki: Uint8Array }[]>;
  appendRevocation(input: {
    userId: string;
    revokedDeviceId: string;
    reason: RevocationReasonName;
    tbs: Uint8Array;
    signature: Uint8Array;
    sequence: bigint;
    logHead: Uint8Array;
  }): Promise<void>;
}

/** Where a partially completed flow left off, so it can resume or fail closed. */
export type BootstrapProgress = {
  deviceKeysCreated: boolean;
  recoveryIdentityCreated: boolean;
  rootCertificateIssued: boolean;
  personalKeyCreated: boolean;
  healthKeyCreated: boolean;
  kitVerified: boolean;
  completed: boolean;
};

export interface E2eeLocalState {
  loadBootstrapProgress(userId: string): Promise<BootstrapProgress | null>;
  saveBootstrapProgress(userId: string, progress: BootstrapProgress): Promise<void>;
  /** The pinned trust anchor for an account. Written once, at provisioning. */
  pinTrustAnchor(userId: string, anchor: { rootRecSigPubFp: Uint8Array; recoveryIdentityId: string; recoveryVersion: number }): Promise<void>;
  loadTrustAnchor(userId: string): Promise<{ rootRecSigPubFp: Uint8Array; recoveryIdentityId: string; recoveryVersion: number } | null>;
}

/** Feature flag. E2EE stays OFF until the native integration gate closes. */
export interface E2eeFeatureFlag {
  isEnabled(): boolean;
}
