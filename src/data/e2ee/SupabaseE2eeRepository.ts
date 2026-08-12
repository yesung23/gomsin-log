/**
 * The Supabase-backed `E2eeRepository`.
 *
 * This is the only module in the E2EE stack that knows a database exists.
 * `src/crypto/**` is pure and `src/app/e2ee/**` speaks the port, so a reviewer
 * can read the protocol without reading PostgREST and vice versa.
 *
 * Three rules this adapter holds absolutely:
 *
 *   1. EVERY DB and RPC error propagates. There is no `catch { return null }`
 *      anywhere below. A repository that answers "no rows" when it means "the
 *      request failed" turns a permission error into a missing key, and a
 *      missing key into a rotation that silently drops a recipient.
 *
 *   2. A row that must exist and is absent is an error, not `null`. `null` is
 *      returned ONLY where absence is a real, expected answer — no recovery
 *      identity yet, no partner, no pairing.
 *
 *   3. Epoch state changes go through the RPCs. There is no UPDATE on
 *      `scope_keys` in this file, and `authenticated` has no grant for one.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { REVOCATION_REASON, type KeyDomainName } from '@/crypto/domains';
import {
  decodeBigint,
  decodeBoolean,
  decodeBytea,
  decodeByteaOrNull,
  decodeEnum,
  decodeSmallint,
  encodeBigint,
  encodeBytea,
  optionalString,
  requireString,
  timestampMs,
} from './codec';
import type {
  CertificateRecord,
  DeviceRecord,
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
  RecoveryAnchorRecord,
  RecoveryChallengeRecord,
  RecoveryIdentityRecord,
  RevocationRecord,
  ScopeKeyRecord,
} from '@/app/e2ee/ports';

export class E2eeRepositoryError extends Error {
  readonly code: string;
  readonly operation: string;
  constructor(code: string, operation: string, message: string) {
    super(`${code} (${operation}): ${message}`);
    this.code = code;
    this.operation = operation;
    this.name = 'E2eeRepositoryError';
  }
}

function fail(code: string, operation: string, message: string): never {
  throw new E2eeRepositoryError(code, operation, message);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * The narrow slice of the Supabase client this adapter uses.
 *
 * Declared structurally so the contract tests can supply a transport shaped like
 * the real client's responses without reproducing supabase-js's generics. The
 * real client is adapted once, in `createSupabaseE2eeRepository`.
 */
export type PostgrestLikeError = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

export type TransportResult<T> = { data: T | null; error: PostgrestLikeError | null };

export type Row = Record<string, unknown>;

export interface E2eeQuery extends PromiseLike<TransportResult<Row[]>> {
  select(columns?: string): E2eeQuery;
  eq(column: string, value: unknown): E2eeQuery;
  in(column: string, values: readonly unknown[]): E2eeQuery;
  is(column: string, value: null): E2eeQuery;
  order(column: string, options?: { ascending?: boolean }): E2eeQuery;
  limit(count: number): E2eeQuery;
  maybeSingle(): PromiseLike<TransportResult<Row>>;
  single(): PromiseLike<TransportResult<Row>>;
}

export interface E2eeTable {
  select(columns?: string): E2eeQuery;
  insert(values: Row): E2eeQuery;
  update(values: Row): E2eeQuery;
}

export interface E2eeTransport {
  from(table: string): E2eeTable;
  rpc(fn: string, args?: Row): PromiseLike<TransportResult<unknown>>;
  functions: {
    invoke(name: string, options: { body: Row }): PromiseLike<TransportResult<unknown>>;
  };
}

/** Unwrap a transport result, turning any error into a thrown, named failure. */
async function unwrap<T>(operation: string, result: PromiseLike<TransportResult<T>>): Promise<T | null> {
  const { data, error } = await result;
  if (error) {
    fail(error.code ?? 'E_DB_ERROR', operation, error.message);
  }
  return data;
}

async function rows(operation: string, query: E2eeQuery): Promise<Row[]> {
  const data = await unwrap(operation, query);
  if (data === null) return [];
  if (!Array.isArray(data)) fail('E_DB_SHAPE', operation, 'expected a row array');
  return data;
}

/** A row that is allowed to be absent. */
async function maybeRow(operation: string, query: PromiseLike<TransportResult<Row>>): Promise<Row | null> {
  return unwrap(operation, query);
}

/** A row that must exist: a silent `null` here would be a fabricated success. */
async function requiredRow(operation: string, query: PromiseLike<TransportResult<Row>>): Promise<Row> {
  const row = await unwrap(operation, query);
  if (!row) fail('E_DB_NO_ROW', operation, 'the write returned no row');
  return row;
}

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

const DEVICE_COLUMNS = 'id,user_id,sig_spki,kem_spki,platform,assurance,status';
const CERTIFICATE_COLUMNS = [
  'id', 'user_id', 'subject_device_id', 'issuer_device_id', 'issuer_certificate_id',
  'recovery_public_anchor_id', 'recovery_identity_id', 'recovery_version',
  'certificate', 'certificate_fp', 'subject_sig_spki', 'subject_kem_spki',
].join(',');
const RECOVERY_IDENTITY_COLUMNS = [
  'id', 'user_id', 'recovery_version', 'recovery_salt', 'rec_sig_spki', 'rec_kem_spki',
  'enc_rec_sig_priv', 'enc_rec_kem_priv', 'recovery_bundle_fp', 'bundle_sig', 'superseded_at',
].join(',');
const RECOVERY_ANCHOR_COLUMNS = [
  'id', 'user_id', 'recovery_identity_id', 'recovery_version',
  'rec_sig_spki', 'rec_sig_fp', 'recovery_bundle_fp',
].join(',');
// `key_epoch::text` is not a nicety. Selected as a JSON number it silently loses
// precision above 2^53, and an epoch is a 64-bit protocol field.
const SCOPE_KEY_COLUMNS = 'id,domain,scope_id,key_epoch::text,state,owner_user_id,owner_couple_id';
const ENVELOPE_COLUMNS = [
  'scope_key_id', 'recipient_kind', 'recipient_device_id', 'recipient_recovery_id',
  'sender_device_id', 'sender_certificate_id', 'envelope', 'self_notarized',
].join(',');
const ENROLLMENT_COLUMNS = [
  'id', 'user_id', 'new_device_id', 'approver_device_id', 'enroll_nonce', 'granted_domains',
  'transcript_hash', 'approval_signature', 'created_at', 'expires_at', 'approved_at', 'consumed_at',
].join(',');
const PAIRING_COLUMNS = [
  'id', 'couple_id', 'state', 'pairing_nonce', 'transcript_hash',
  'confirmed_low_signature', 'confirmed_low_device_id',
  'confirmed_high_signature', 'confirmed_high_device_id', 'expires_at',
].join(',');
const REVOCATION_COLUMNS = [
  'id', 'user_id', 'revoked_device_id', 'revoker_device_id', 'reason',
  'statement', 'signature', 'sequence::text', 'log_head',
].join(',');

const PLATFORMS = ['ios', 'android', 'web'] as const;
const ASSURANCES = [
  'secure_enclave', 'strongbox', 'tee', 'software_keystore', 'web_nonextractable',
] as const;
const DOMAINS = ['personal', 'health', 'couple'] as const;
const EPOCH_STATES = ['PREPARING', 'READY', 'ACTIVE', 'RETIRED', 'ABANDONED'] as const;
const RECIPIENT_KINDS = ['device', 'recovery_identity'] as const;

// ---------------------------------------------------------------------------
// Row → record
// ---------------------------------------------------------------------------

function toDevice(row: Row): DeviceRecord {
  return {
    id: requireString(row.id, 'devices.id'),
    userId: requireString(row.user_id, 'devices.user_id'),
    sigSpki: decodeBytea(row.sig_spki, 'devices.sig_spki'),
    kemSpki: decodeBytea(row.kem_spki, 'devices.kem_spki'),
    platform: decodeEnum(row.platform, 'devices.platform', PLATFORMS),
    assurance: decodeEnum(row.assurance, 'devices.assurance', ASSURANCES),
    status: requireString(row.status, 'devices.status'),
  };
}

function toCertificate(row: Row): CertificateRecord {
  return {
    id: requireString(row.id, 'device_certificates.id'),
    userId: requireString(row.user_id, 'device_certificates.user_id'),
    subjectDeviceId: requireString(row.subject_device_id, 'device_certificates.subject_device_id'),
    issuerDeviceId: optionalString(row.issuer_device_id, 'device_certificates.issuer_device_id'),
    issuerCertificateId: optionalString(row.issuer_certificate_id, 'device_certificates.issuer_certificate_id'),
    recoveryPublicAnchorId: optionalString(
      row.recovery_public_anchor_id,
      'device_certificates.recovery_public_anchor_id',
    ),
    recoveryIdentityId: requireString(row.recovery_identity_id, 'device_certificates.recovery_identity_id'),
    recoveryVersion: decodeSmallint(row.recovery_version, 'device_certificates.recovery_version', 255),
    certificate: decodeBytea(row.certificate, 'device_certificates.certificate'),
    certificateFp: decodeBytea(row.certificate_fp, 'device_certificates.certificate_fp'),
    subjectSigSpki: decodeBytea(row.subject_sig_spki, 'device_certificates.subject_sig_spki'),
    subjectKemSpki: decodeBytea(row.subject_kem_spki, 'device_certificates.subject_kem_spki'),
  };
}

/**
 * Split `nonce ‖ ciphertext ‖ tag` back into its parts.
 *
 * Migration 031 stores one `bytea` per encrypted private half and has no nonce
 * column. Keeping the split here, once, is what stops a caller from inventing a
 * nonce at decrypt time — which is the failure that made the previous
 * implementation's recovery material permanently unopenable.
 */
const GCM_NONCE_BYTES = 12;

function splitSealed(value: Uint8Array, field: string): { nonce: Uint8Array; sealed: Uint8Array } {
  if (value.length <= GCM_NONCE_BYTES) {
    fail('E_SEALED_TRUNCATED', field, `expected more than ${GCM_NONCE_BYTES} bytes of nonce+ciphertext`);
  }
  return { nonce: value.slice(0, GCM_NONCE_BYTES), sealed: value.slice(GCM_NONCE_BYTES) };
}

function joinSealed(nonce: Uint8Array, sealed: Uint8Array, field: string): Uint8Array {
  if (nonce.length !== GCM_NONCE_BYTES) {
    fail('E_BAD_NONCE', field, `AES-GCM nonce must be ${GCM_NONCE_BYTES} bytes, saw ${nonce.length}`);
  }
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, nonce.length);
  return out;
}

function toRecoveryIdentity(row: Row): RecoveryIdentityRecord {
  const sig = splitSealed(
    decodeBytea(row.enc_rec_sig_priv, 'recovery_identities.enc_rec_sig_priv'),
    'recovery_identities.enc_rec_sig_priv',
  );
  const kem = splitSealed(
    decodeBytea(row.enc_rec_kem_priv, 'recovery_identities.enc_rec_kem_priv'),
    'recovery_identities.enc_rec_kem_priv',
  );
  return {
    id: requireString(row.id, 'recovery_identities.id'),
    userId: requireString(row.user_id, 'recovery_identities.user_id'),
    recoveryVersion: decodeSmallint(row.recovery_version, 'recovery_identities.recovery_version', 255),
    recoverySalt: decodeBytea(row.recovery_salt, 'recovery_identities.recovery_salt'),
    recSigSpki: decodeBytea(row.rec_sig_spki, 'recovery_identities.rec_sig_spki'),
    recKemSpki: decodeBytea(row.rec_kem_spki, 'recovery_identities.rec_kem_spki'),
    recSigNonce: sig.nonce,
    encRecSigPriv: sig.sealed,
    recKemNonce: kem.nonce,
    encRecKemPriv: kem.sealed,
    recoveryBundleFp: decodeBytea(row.recovery_bundle_fp, 'recovery_identities.recovery_bundle_fp'),
    bundleSig: decodeBytea(row.bundle_sig, 'recovery_identities.bundle_sig'),
    supersededAt: optionalString(row.superseded_at, 'recovery_identities.superseded_at'),
  };
}

function toRecoveryAnchor(row: Row): RecoveryAnchorRecord {
  return {
    id: requireString(row.id, 'recovery_public_anchors.id'),
    userId: requireString(row.user_id, 'recovery_public_anchors.user_id'),
    recoveryIdentityId: requireString(
      row.recovery_identity_id,
      'recovery_public_anchors.recovery_identity_id',
    ),
    recoveryVersion: decodeSmallint(row.recovery_version, 'recovery_public_anchors.recovery_version', 255),
    recSigSpki: decodeBytea(row.rec_sig_spki, 'recovery_public_anchors.rec_sig_spki'),
    recSigFp: decodeBytea(row.rec_sig_fp, 'recovery_public_anchors.rec_sig_fp'),
    recoveryBundleFp: decodeBytea(row.recovery_bundle_fp, 'recovery_public_anchors.recovery_bundle_fp'),
  };
}

function toScopeKey(row: Row): ScopeKeyRecord {
  return {
    id: requireString(row.id, 'scope_keys.id'),
    domain: decodeEnum(row.domain, 'scope_keys.domain', DOMAINS) as KeyDomainName,
    scopeId: requireString(row.scope_id, 'scope_keys.scope_id'),
    epoch: decodeBigint(row.key_epoch, 'scope_keys.key_epoch'),
    state: decodeEnum(row.state, 'scope_keys.state', EPOCH_STATES),
    ownerUserId: optionalString(row.owner_user_id, 'scope_keys.owner_user_id'),
    ownerCoupleId: optionalString(row.owner_couple_id, 'scope_keys.owner_couple_id'),
  };
}

function toEnvelope(row: Row): EnvelopeRecord {
  const kind = decodeEnum(row.recipient_kind, 'key_envelopes.recipient_kind', RECIPIENT_KINDS);
  const deviceId = optionalString(row.recipient_device_id, 'key_envelopes.recipient_device_id');
  const recoveryId = optionalString(row.recipient_recovery_id, 'key_envelopes.recipient_recovery_id');
  const recipientId = kind === 'device' ? deviceId : recoveryId;
  if (!recipientId) {
    fail('E_ENVELOPE_RECIPIENT', 'key_envelopes', `a ${kind} envelope carries no recipient id`);
  }
  return {
    scopeKeyId: requireString(row.scope_key_id, 'key_envelopes.scope_key_id'),
    recipientKind: kind,
    recipientId,
    senderDeviceId: optionalString(row.sender_device_id, 'key_envelopes.sender_device_id'),
    // NOT NULL by constraint: an envelope verifiable by nothing is not a state
    // this protocol has.
    senderCertificateId: requireString(row.sender_certificate_id, 'key_envelopes.sender_certificate_id'),
    envelope: decodeBytea(row.envelope, 'key_envelopes.envelope'),
    selfNotarized: decodeBoolean(row.self_notarized, 'key_envelopes.self_notarized'),
  };
}

function toEnrollment(row: Row): EnrollmentRecord {
  return {
    id: requireString(row.id, 'device_enrollments.id'),
    userId: requireString(row.user_id, 'device_enrollments.user_id'),
    newDeviceId: requireString(row.new_device_id, 'device_enrollments.new_device_id'),
    approverDeviceId: optionalString(row.approver_device_id, 'device_enrollments.approver_device_id'),
    enrollNonce: decodeBytea(row.enroll_nonce, 'device_enrollments.enroll_nonce'),
    grantedDomains: decodeSmallint(row.granted_domains, 'device_enrollments.granted_domains', 7),
    transcriptHash: decodeByteaOrNull(row.transcript_hash, 'device_enrollments.transcript_hash'),
    approvalSignature: decodeByteaOrNull(row.approval_signature, 'device_enrollments.approval_signature'),
    // Authoritative issuedAt for the canonical transcript, on both sides.
    createdAt: requireString(row.created_at, 'device_enrollments.created_at'),
    expiresAt: requireString(row.expires_at, 'device_enrollments.expires_at'),
    approvedAt: optionalString(row.approved_at, 'device_enrollments.approved_at'),
    consumedAt: optionalString(row.consumed_at, 'device_enrollments.consumed_at'),
  };
}

function toPairing(row: Row): PairingRecord {
  return {
    id: requireString(row.id, 'crypto_pairings.id'),
    coupleId: requireString(row.couple_id, 'crypto_pairings.couple_id'),
    state: requireString(row.state, 'crypto_pairings.state'),
    pairingNonce: decodeByteaOrNull(row.pairing_nonce, 'crypto_pairings.pairing_nonce'),
    transcriptHash: decodeByteaOrNull(row.transcript_hash, 'crypto_pairings.transcript_hash'),
    confirmedLowSignature: decodeByteaOrNull(
      row.confirmed_low_signature,
      'crypto_pairings.confirmed_low_signature',
    ),
    confirmedLowDeviceId: optionalString(row.confirmed_low_device_id, 'crypto_pairings.confirmed_low_device_id'),
    confirmedHighSignature: decodeByteaOrNull(
      row.confirmed_high_signature,
      'crypto_pairings.confirmed_high_signature',
    ),
    confirmedHighDeviceId: optionalString(
      row.confirmed_high_device_id,
      'crypto_pairings.confirmed_high_device_id',
    ),
    expiresAt: optionalString(row.expires_at, 'crypto_pairings.expires_at'),
  };
}

function toRevocation(row: Row): RevocationRecord {
  return {
    id: requireString(row.id, 'revocation_statements.id'),
    userId: requireString(row.user_id, 'revocation_statements.user_id'),
    revokedDeviceId: requireString(row.revoked_device_id, 'revocation_statements.revoked_device_id'),
    revokerDeviceId: optionalString(row.revoker_device_id, 'revocation_statements.revoker_device_id'),
    reason: decodeSmallint(row.reason, 'revocation_statements.reason', 5),
    statement: decodeBytea(row.statement, 'revocation_statements.statement'),
    signature: decodeBytea(row.signature, 'revocation_statements.signature'),
    sequence: decodeBigint(row.sequence, 'revocation_statements.sequence'),
    logHead: decodeBytea(row.log_head, 'revocation_statements.log_head'),
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export class SupabaseE2eeRepository implements E2eeRepository {
  private readonly db: E2eeTransport;

  constructor(transport: E2eeTransport) {
    this.db = transport;
  }

  async serverOriginId(): Promise<Uint8Array> {
    const row = await maybeRow(
      'crypto_deployment.select',
      this.db.from('crypto_deployment').select('server_origin_id').limit(1).maybeSingle(),
    );
    // Absence here is not an ordinary answer: every certificate and transcript
    // binds this value, so a deployment without one cannot produce anything.
    if (!row) fail('E_NO_DEPLOYMENT_IDENTITY', 'crypto_deployment.select', 'no deployment identity row');
    return decodeBytea(row.server_origin_id, 'crypto_deployment.server_origin_id');
  }

  // --- devices -------------------------------------------------------------

  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    const row = await maybeRow(
      'devices.get',
      this.db.from('devices').select(DEVICE_COLUMNS).eq('id', deviceId).maybeSingle(),
    );
    return row ? toDevice(row) : null;
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    const found = await rows(
      'devices.list',
      this.db.from('devices').select(DEVICE_COLUMNS).eq('user_id', userId),
    );
    return found.map(toDevice);
  }

  async insertDevice(record: DeviceRecord): Promise<void> {
    await requiredRow(
      'devices.insert',
      this.db.from('devices').insert({
        id: record.id,
        user_id: record.userId,
        sig_spki: encodeBytea(record.sigSpki),
        kem_spki: encodeBytea(record.kemSpki),
        platform: record.platform,
        assurance: record.assurance,
        status: record.status,
      }).select('id').single(),
    );
  }

  /**
   * Retire a device, or record that its provisioning did not finish.
   *
   * These go through RPCs rather than an UPDATE because 036 revoked the client's
   * table-level UPDATE on `devices` and re-granted only `label_ct` and
   * `last_seen_at`. `status` is no longer writable by an authenticated session
   * at all, which is what stops `UPDATE devices SET status='ACTIVE'` from
   * promoting an unprovisioned device — so this method cannot reach for the
   * column even for the two transitions a client is entitled to.
   *
   * Only narrowing transitions are accepted here. Promotions (PROVISIONING,
   * ACTIVE, RECOVERY_AUTHENTICATED) are conclusions the server draws from
   * evidence it has verified, and they have their own RPCs; asking for one here
   * is a programming error rather than something to forward to the database.
   */
  async setDeviceStatus(deviceId: string, status: string): Promise<void> {
    if (status === 'REVOKED') {
      await unwrap(
        'rpc.e2ee_revoke_own_device',
        this.db.rpc('e2ee_revoke_own_device', { p_device_id: deviceId }),
      );
      return;
    }
    if (status === 'PROVISIONING_FAILED') {
      await unwrap(
        'rpc.e2ee_mark_device_provisioning_failed',
        this.db.rpc('e2ee_mark_device_provisioning_failed', { p_device_id: deviceId }),
      );
      return;
    }
    fail('E_DEVICE_STATUS_NOT_CLIENT_SETTABLE', 'devices.setStatus', `${status} is server-decided`);
  }

  // --- certificates --------------------------------------------------------

  async listCertificates(userId: string): Promise<CertificateRecord[]> {
    const found = await rows(
      'device_certificates.list',
      this.db.from('device_certificates').select(CERTIFICATE_COLUMNS).eq('user_id', userId),
    );
    return found.map(toCertificate);
  }

  async getCertificate(certificateId: string): Promise<CertificateRecord | null> {
    const row = await maybeRow(
      'device_certificates.get',
      this.db.from('device_certificates').select(CERTIFICATE_COLUMNS).eq('id', certificateId).maybeSingle(),
    );
    return row ? toCertificate(row) : null;
  }

  async insertCertificate(record: NewCertificate): Promise<string> {
    const row = await requiredRow(
      'device_certificates.insert',
      this.db.from('device_certificates').insert({
        user_id: record.userId,
        subject_device_id: record.subjectDeviceId,
        issuer_device_id: record.issuerDeviceId,
        issuer_certificate_id: record.issuerCertificateId,
        recovery_public_anchor_id: record.recoveryPublicAnchorId,
        recovery_identity_id: record.recoveryIdentityId,
        recovery_version: record.recoveryVersion,
        certificate: encodeBytea(record.certificate),
        certificate_fp: encodeBytea(record.certificateFp),
        subject_sig_spki: encodeBytea(record.subjectSigSpki),
        subject_kem_spki: encodeBytea(record.subjectKemSpki),
      }).select('id').single(),
    );
    return requireString(row.id, 'device_certificates.id');
  }

  // --- recovery identity and anchors ---------------------------------------

  async getRecoveryIdentity(userId: string): Promise<RecoveryIdentityRecord | null> {
    const row = await maybeRow(
      'recovery_identities.get',
      this.db.from('recovery_identities')
        .select(RECOVERY_IDENTITY_COLUMNS)
        .eq('user_id', userId)
        .is('superseded_at', null)
        .maybeSingle(),
    );
    return row ? toRecoveryIdentity(row) : null;
  }

  async insertRecoveryIdentity(record: NewRecoveryIdentity): Promise<string> {
    const row = await requiredRow(
      'recovery_identities.insert',
      this.db.from('recovery_identities').insert({
        user_id: record.userId,
        recovery_version: record.recoveryVersion,
        recovery_salt: encodeBytea(record.recoverySalt),
        rec_sig_spki: encodeBytea(record.recSigSpki),
        rec_kem_spki: encodeBytea(record.recKemSpki),
        enc_rec_sig_priv: encodeBytea(
          joinSealed(record.recSigNonce, record.encRecSigPriv, 'enc_rec_sig_priv'),
        ),
        enc_rec_kem_priv: encodeBytea(
          joinSealed(record.recKemNonce, record.encRecKemPriv, 'enc_rec_kem_priv'),
        ),
        recovery_bundle_fp: encodeBytea(record.recoveryBundleFp),
        bundle_sig: encodeBytea(record.bundleSig),
      }).select('id').single(),
    );
    return requireString(row.id, 'recovery_identities.id');
  }

  async getRecoveryAnchorFor(recoveryIdentityId: string): Promise<RecoveryAnchorRecord | null> {
    const row = await maybeRow(
      'recovery_public_anchors.get',
      this.db.from('recovery_public_anchors')
        .select(RECOVERY_ANCHOR_COLUMNS)
        .eq('recovery_identity_id', recoveryIdentityId)
        .maybeSingle(),
    );
    return row ? toRecoveryAnchor(row) : null;
  }

  async insertRecoveryAnchor(record: NewRecoveryAnchor): Promise<string> {
    const row = await requiredRow(
      'recovery_public_anchors.insert',
      this.db.from('recovery_public_anchors').insert({
        user_id: record.userId,
        recovery_identity_id: record.recoveryIdentityId,
        recovery_version: record.recoveryVersion,
        rec_sig_spki: encodeBytea(record.recSigSpki),
        rec_sig_fp: encodeBytea(record.recSigFp),
        recovery_bundle_fp: encodeBytea(record.recoveryBundleFp),
      }).select('id').single(),
    );
    return requireString(row.id, 'recovery_public_anchors.id');
  }

  async getPartnerRecoveryAnchor(): Promise<PartnerRecoveryAnchorRecord | null> {
    const data = await unwrap('rpc.get_partner_recovery_anchor', this.db.rpc('get_partner_recovery_anchor'));
    // The RPC returns a set; no partner, or no partner recovery identity, is a
    // legitimate empty answer.
    if (!Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as Row;
    return {
      recoveryIdentityId: requireString(row.recovery_identity_id, 'partner_anchor.recovery_identity_id'),
      recoveryVersion: decodeSmallint(row.recovery_version, 'partner_anchor.recovery_version', 255),
      recSigSpki: decodeBytea(row.rec_sig_spki, 'partner_anchor.rec_sig_spki'),
      recKemSpki: decodeBytea(row.rec_kem_spki, 'partner_anchor.rec_kem_spki'),
      recoveryBundleFp: decodeBytea(row.recovery_bundle_fp, 'partner_anchor.recovery_bundle_fp'),
    };
  }

  // --- scope keys ----------------------------------------------------------

  async listScopeKeys(domain: KeyDomainName, scopeId: string): Promise<ScopeKeyRecord[]> {
    const found = await rows(
      'scope_keys.list',
      this.db.from('scope_keys')
        .select(SCOPE_KEY_COLUMNS)
        .eq('domain', domain)
        .eq('scope_id', scopeId)
        .order('key_epoch', { ascending: true }),
    );
    return found.map(toScopeKey);
  }

  async getScopeKey(scopeKeyId: string): Promise<ScopeKeyRecord | null> {
    const row = await maybeRow(
      'scope_keys.get',
      this.db.from('scope_keys').select(SCOPE_KEY_COLUMNS).eq('id', scopeKeyId).maybeSingle(),
    );
    return row ? toScopeKey(row) : null;
  }

  async insertScopeKey(record: NewScopeKey): Promise<string> {
    const row = await requiredRow(
      'scope_keys.insert',
      this.db.from('scope_keys').insert({
        domain: record.domain,
        scope_id: record.scopeId,
        owner_user_id: record.ownerUserId,
        owner_couple_id: record.ownerCoupleId,
        // Written as text: an epoch is 64-bit and a JSON number is not.
        key_epoch: encodeBigint(record.epoch),
        // The trigger refuses anything else, and so does this adapter — there is
        // no code path here that creates an epoch already ACTIVE.
        state: 'PREPARING',
      }).select('id').single(),
    );
    return requireString(row.id, 'scope_keys.id');
  }

  async markEpochReady(scopeKeyId: string): Promise<void> {
    await unwrap('rpc.e2ee_mark_epoch_ready', this.db.rpc('e2ee_mark_epoch_ready', { p_scope_key_id: scopeKeyId }));
  }

  async activateEpoch(scopeKeyId: string): Promise<void> {
    await unwrap('rpc.e2ee_activate_epoch', this.db.rpc('e2ee_activate_epoch', { p_scope_key_id: scopeKeyId }));
  }

  async abandonEpoch(scopeKeyId: string): Promise<void> {
    await unwrap('rpc.e2ee_abandon_epoch', this.db.rpc('e2ee_abandon_epoch', { p_scope_key_id: scopeKeyId }));
  }

  // --- envelopes -----------------------------------------------------------

  async listEnvelopes(scopeKeyId: string): Promise<EnvelopeRecord[]> {
    const found = await rows(
      'key_envelopes.list',
      this.db.from('key_envelopes').select(ENVELOPE_COLUMNS).eq('scope_key_id', scopeKeyId),
    );
    return found.map(toEnvelope);
  }

  async listEnvelopesForDevice(deviceId: string): Promise<EnvelopeRecord[]> {
    const found = await rows(
      'key_envelopes.listForDevice',
      this.db.from('key_envelopes').select(ENVELOPE_COLUMNS).eq('recipient_device_id', deviceId),
    );
    return found.map(toEnvelope);
  }

  async listEnvelopesForRecoveryIdentity(recoveryIdentityId: string): Promise<EnvelopeRecord[]> {
    const found = await rows(
      'key_envelopes.listForRecovery',
      this.db.from('key_envelopes').select(ENVELOPE_COLUMNS).eq('recipient_recovery_id', recoveryIdentityId),
    );
    return found.map(toEnvelope);
  }

  async insertEnvelope(record: NewEnvelope): Promise<void> {
    await requiredRow(
      'key_envelopes.insert',
      this.db.from('key_envelopes').insert({
        scope_key_id: record.scopeKeyId,
        recipient_kind: record.recipientKind,
        recipient_device_id: record.recipientKind === 'device' ? record.recipientId : null,
        recipient_recovery_id: record.recipientKind === 'recovery_identity' ? record.recipientId : null,
        sender_device_id: record.senderDeviceId,
        sender_certificate_id: record.senderCertificateId,
        envelope: encodeBytea(record.envelope),
        self_notarized: record.selfNotarized ?? false,
      }).select('id').single(),
    );
  }

  async selfNotarizeEnvelope(input: {
    scopeKeyId: string;
    recipientDeviceId: string;
    envelope: Uint8Array;
    senderCertificateId: string;
    senderDeviceId: string;
  }): Promise<void> {
    await requiredRow(
      'key_envelopes.selfNotarize',
      this.db.from('key_envelopes').update({
        envelope: encodeBytea(input.envelope),
        sender_device_id: input.senderDeviceId,
        sender_certificate_id: input.senderCertificateId,
        self_notarized: true,
      })
        .eq('scope_key_id', input.scopeKeyId)
        .eq('recipient_device_id', input.recipientDeviceId)
        .select('id')
        .single(),
    );
  }

  // --- enrollment ----------------------------------------------------------

  async insertEnrollment(record: NewEnrollment): Promise<EnrollmentRecord> {
    const row = await requiredRow(
      'device_enrollments.insert',
      this.db.from('device_enrollments').insert({
        user_id: record.userId,
        new_device_id: record.newDeviceId,
        approver_device_id: record.approverDeviceId,
        enroll_nonce: encodeBytea(record.enrollNonce),
        granted_domains: record.grantedDomains,
        expires_at: record.expiresAt,
      }).select(ENROLLMENT_COLUMNS).single(),
    );
    return toEnrollment(row);
  }

  async getEnrollmentByNonce(enrollNonce: Uint8Array): Promise<EnrollmentRecord | null> {
    const row = await maybeRow(
      'device_enrollments.getByNonce',
      this.db.from('device_enrollments')
        .select(ENROLLMENT_COLUMNS)
        .eq('enroll_nonce', encodeBytea(enrollNonce))
        .maybeSingle(),
    );
    return row ? toEnrollment(row) : null;
  }

  async setEnrollmentApprover(enrollmentId: string, approverDeviceId: string): Promise<void> {
    await requiredRow(
      'device_enrollments.setApprover',
      this.db.from('device_enrollments')
        .update({ approver_device_id: approverDeviceId })
        .eq('id', enrollmentId)
        .select('id')
        .single(),
    );
  }

  async approveDeviceEnrollment(input: {
    enrollmentId: string;
    certificate: Uint8Array;
    approvalSignature: Uint8Array;
  }): Promise<{ deviceId: string }> {
    // Addressed by stable uuid, and carrying NO transcript. The function
    // rebuilds the canonical transcript from server state and derives the hash
    // itself, so there is nothing here for a caller to steer.
    //
    // Binary fields are base64: this is an HTTP body, not a PostgREST `bytea`
    // parameter. The two encodings are never interchangeable.
    const data = await unwrap(
      'functions.approve-device',
      this.db.functions.invoke('approve-device', {
        body: {
          enrollmentId: input.enrollmentId,
          certificate: base64(input.certificate),
          approvalSignature: base64(input.approvalSignature),
        },
      }),
    );
    const body = data as { activated?: unknown; deviceId?: unknown } | null;
    if (!body || body.activated !== true) {
      fail('E_APPROVAL_REJECTED', 'functions.approve-device', 'the function did not confirm activation');
    }
    return { deviceId: requireString(body.deviceId, 'approve-device.deviceId') };
  }

  // --- pairing -------------------------------------------------------------

  async getPairing(coupleId: string): Promise<PairingRecord | null> {
    const row = await maybeRow(
      'crypto_pairings.get',
      this.db.from('crypto_pairings')
        .select(PAIRING_COLUMNS)
        .eq('couple_id', coupleId)
        .maybeSingle(),
    );
    return row ? toPairing(row) : null;
  }

  async setPairingState(pairingId: string, state: string): Promise<void> {
    await requiredRow(
      'crypto_pairings.setState',
      this.db.from('crypto_pairings')
        .update({ state, updated_at: new Date().toISOString() })
        .eq('id', pairingId)
        .select('id')
        .single(),
    );
  }

  // --- server-authoritative provisioning and scope discovery ---------------

  /**
   * Couple scopes this account holds, from the server.
   *
   * Deliberately takes no argument. Anything the caller could pass would be a
   * caller-selected subset, which is the defect this replaces.
   */
  async listOwnedCoupleScopeIds(): Promise<string[]> {
    const data = await unwrap(
      'rpc.e2ee_owned_couple_scope_ids',
      this.db.rpc('e2ee_owned_couple_scope_ids'),
    );
    const list = Array.isArray(data) ? data : [];
    return list.map((row, index) => requireString(
      (row as { couple_id?: unknown } | null)?.couple_id,
      `e2ee_owned_couple_scope_ids[${index}].couple_id`,
    ));
  }

  async listMissingDeviceCoverage(
    deviceId: string,
  ): Promise<{ domain: KeyDomainName; scopeId: string }[]> {
    const data = await unwrap(
      'rpc.e2ee_missing_device_coverage',
      this.db.rpc('e2ee_missing_device_coverage', { p_device_id: deviceId }),
    );
    const list = Array.isArray(data) ? data : [];
    return list.map((row, index) => {
      const record = row as { domain?: unknown; scope_id?: unknown } | null;
      return {
        domain: decodeEnum<KeyDomainName>(
          record?.domain,
          `e2ee_missing_device_coverage[${index}].domain`,
          ['personal', 'couple', 'health'],
        ),
        scopeId: requireString(record?.scope_id, `e2ee_missing_device_coverage[${index}].scope_id`),
      };
    });
  }

  async beginDeviceProvisioning(deviceId: string): Promise<void> {
    await unwrap(
      'rpc.e2ee_begin_device_provisioning',
      this.db.rpc('e2ee_begin_device_provisioning', { p_device_id: deviceId }),
    );
  }

  /**
   * The only path to ACTIVE.
   *
   * There is deliberately no client-side pre-check of coverage here: the server
   * re-verifies everything, and a client that decided for itself would be able to
   * disagree with the database about what "provisioned" means.
   */
  async finalizeDeviceProvisioning(deviceId: string): Promise<void> {
    await unwrap(
      'rpc.e2ee_finalize_device_provisioning',
      this.db.rpc('e2ee_finalize_device_provisioning', { p_device_id: deviceId }),
    );
  }

  // --- revocation ----------------------------------------------------------

  async listRevocations(userId: string): Promise<RevocationRecord[]> {
    const found = await rows(
      'revocation_statements.list',
      this.db.from('revocation_statements')
        .select(REVOCATION_COLUMNS)
        .eq('user_id', userId)
        .order('sequence', { ascending: true }),
    );
    return found.map(toRevocation);
  }

  async appendRevocation(input: {
    userId: string;
    revokedDeviceId: string;
    revokerDeviceId: string;
    reason: keyof typeof REVOCATION_REASON;
    statement: Uint8Array;
    signature: Uint8Array;
    revokedAtMs: bigint;
    sequence: bigint;
    logHead: Uint8Array;
  }): Promise<void> {
    await requiredRow(
      'revocation_statements.insert',
      this.db.from('revocation_statements').insert({
        user_id: input.userId,
        revoked_device_id: input.revokedDeviceId,
        revoker_device_id: input.revokerDeviceId,
        // The wire code, not the name: the column is SMALLINT and the numbering
        // is bound into the signed statement.
        reason: REVOCATION_REASON[input.reason],
        statement: encodeBytea(input.statement),
        signature: encodeBytea(input.signature),
        revoked_at: new Date(Number(input.revokedAtMs)).toISOString(),
        sequence: encodeBigint(input.sequence),
        log_head: encodeBytea(input.logHead),
      }).select('id').single(),
    );
  }

  // --- recovery RPCs -------------------------------------------------------

  async issueRecoveryChallenge(input: { userId: string; deviceId: string }): Promise<RecoveryChallengeRecord> {
    const data = await unwrap(
      'functions.issue-recovery-challenge',
      this.db.functions.invoke('issue-recovery-challenge', { body: { deviceId: input.deviceId } }),
    );
    const row = data as Row | null;
    if (!row) fail('E_NO_CHALLENGE', 'functions.issue-recovery-challenge', 'no challenge was issued');
    return {
      id: requireString(row.challengeId, 'recovery_challenge.challengeId'),
      userId: input.userId,
      recoveryIdentityId: requireString(row.recoveryIdentityId, 'recovery_challenge.recoveryIdentityId'),
      // An HTTP body, so base64 — not the `\x` form a bytea column would use.
      challengeNonce: decodeBase64Field(row.challenge, 'recovery_challenge.challenge', 32),
      recoveryVersion: decodeSmallint(row.recoveryVersion, 'recovery_challenge.recoveryVersion', 255),
      newDeviceId: requireString(row.deviceId, 'recovery_challenge.deviceId'),
      // The PERSISTED timestamps, echoed exactly. Recomputing them from a local
      // clock would produce a transcript the verifier cannot reproduce.
      issuedAtMs: timestampMs(row.issuedAt, 'recovery_challenge.issuedAt'),
      expiresAtMs: timestampMs(row.expiresAt, 'recovery_challenge.expiresAt'),
    };
  }

  async verifyRecoveryAuthentication(input: {
    challengeId: string;
    deviceId: string;
    signature: Uint8Array;
  }): Promise<{ deviceId: string; nextState: 'RECOVERY_AUTHENTICATED' }> {
    const data = await unwrap(
      'functions.verify-recovery',
      this.db.functions.invoke('verify-recovery', {
        body: {
          challengeId: input.challengeId,
          deviceId: input.deviceId,
          signature: base64(input.signature),
        },
      }),
    );
    const body = data as { authenticated?: unknown; deviceId?: unknown; nextState?: unknown } | null;
    if (!body || body.authenticated !== true) {
      fail('E_RECOVERY_REJECTED', 'functions.verify-recovery', 'the function did not authenticate the device');
    }
    if (body.nextState !== 'RECOVERY_AUTHENTICATED') {
      fail('E_RECOVERY_STATE', 'functions.verify-recovery', `unexpected next state ${String(body.nextState)}`);
    }
    return {
      deviceId: requireString(body.deviceId, 'verify-recovery.deviceId'),
      nextState: 'RECOVERY_AUTHENTICATED',
    };
  }
}

/** Base64 for Edge Function bodies, which is what `_shared/e2eeVerify.ts` decodes. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A base64 field from an Edge Function RESPONSE body.
 *
 * Deliberately distinct from `decodeBytea`: a response body is base64 and a
 * `bytea` column is `\x` hex, and a decoder that accepted either would make
 * "which encoding is this" unanswerable at the one boundary where getting it
 * wrong yields plausible-looking garbage.
 */
function decodeBase64Field(value: unknown, field: string, width: number): Uint8Array {
  const text = requireString(value, field);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    fail('E_BAD_BASE64', field, 'expected a base64 transport value');
  }
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  if (out.length !== width) fail('E_BAD_WIDTH', field, `expected ${width} bytes, saw ${out.length}`);
  return out;
}

/**
 * Adapt the application's Supabase client to this repository.
 *
 * The single cast is the whole seam. supabase-js's builder types are generic
 * over a schema this project does not generate types for; `E2eeTransport`
 * describes exactly the subset used, and every row that comes back is decoded
 * field by field above rather than trusted for its shape.
 */
export function createSupabaseE2eeRepository(client: SupabaseClient): SupabaseE2eeRepository {
  return new SupabaseE2eeRepository(client as unknown as E2eeTransport);
}
