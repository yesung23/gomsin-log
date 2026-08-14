/**
 * E2EE application use cases.
 *
 * These are the orchestration layer: they sequence device-key operations,
 * crypto primitives and repository calls into the flows the product needs. They
 * hold no Supabase client, no React, and no store, so a component asks a hook,
 * the hook asks a use case, and the use case does the work.
 *
 * Every one of them is gated by the feature flag and none is wired to a screen
 * yet. Nothing here activates E2EE for an existing account.
 *
 * Two invariants hold across every function below:
 *
 *   - No public use case accepts a `VerifiedDevice`, a `RevocationSet`, or any
 *     other already-trusted object. Callers pass ids and raw evidence; trust is
 *     derived inside the operation, from signatures, every time. See `trust.ts`.
 *   - Nothing reaches ACTIVE until the durable state that makes it usable is on
 *     the server and has been read back. A flow that fails half-way leaves a
 *     PREPARING epoch nobody references and a device nobody trusts.
 */

import { bytesToUuid, concat, equalBytes, fromBase64, uuidToBytes, utf8, zeroize } from '@/crypto/bytes';
import {
  ASSURANCE,
  KEY_DOMAIN,
  RECIPIENT_KIND,
  grantsToMask,
  maskToGrants,
  requiresRotation,
  type KeyDomainName,
  type PlatformName,
  type RevocationReasonName,
} from '@/crypto/domains';
import {
  ISSUER_KIND,
  assembleCertificate,
  certificatePopMessage,
  certificateSignedMessage,
  decodeTbs,
  encodeTbs,
  splitCertificate,
  verifyCertificateChain,
  type TrustAnchor,
} from '@/crypto/deviceCertificate';
import {
  aesGcmOpen,
  aesGcmSeal,
  ecdhWithCryptoKey,
  ecdsaVerify,
  generateEphemeralAgreement,
  hkdfSha256,
  importAesKey,
  publicKeyFingerprint,
  randomBytes,
  randomNonce,
  sec1ToSpki,
  sha256,
} from '@/crypto/suite';
import {
  RECOVERY_SECRET_BYTES,
  decodeRecoveryCode,
  deriveKitAnchorTagV2,
  encodeRecoveryCode,
  verifyKitAnchor,
  type RecoveryKitAnchor,
} from '@/crypto/recoveryCode';
import { deriveSas } from '@/crypto/sas';
import {
  encodeRecoveryChallengeTranscript,
  enrollmentTranscriptHash,
  partnerAssistConfirmMessage,
  partnerAssistTranscriptHash,
  recoveryBundleFingerprint,
  recoveryBundleSignedMessage,
  type PairingSide,
  type PartnerAssistTranscript,
  type RecoveryBundle,
} from '@/crypto/transcripts';
import {
  generateScopeKeyBytes,
  provisionScopeKeyToRecipient,
  sealScopeKeyForRecipient,
} from '@/crypto/keyring/scopeKeys';
import { canCreateCoupleKey, type Confirmation } from '@/crypto/protocol/pairing';
import { classifyLostDevice, type HeldScope } from '@/crypto/protocol/rotation';
import {
  encodeRevocationTbs,
  revocationLogAppend,
  revocationLogGenesis,
  revocationSignedMessage,
  type RevocationSet,
} from '@/crypto/revocation';
import type { DeviceKeyPort } from '@/crypto/keystore';
import {
  anchorFromPin,
  buildChain,
  certificatesById,
  chainPassesThroughDevice,
  loadRevocationSet,
  resolveTrustedDevices,
  verifyDeviceById,
} from './trust';
import type {
  CertificateRecord,
  E2eeFeatureFlag,
  E2eeLocalState,
  E2eeRepository,
  EnvelopeRecord,
  PendingBootstrap,
  RecoveryIdentityRecord,
  ScopeKeyRecord,
} from './ports';

export class E2eeUseCaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'E2eeUseCaseError';
  }
}

function fail(code: string, message: string): never {
  throw new E2eeUseCaseError(code, message);
}

export type UseCaseDeps = {
  repository: E2eeRepository;
  localState: E2eeLocalState;
  deviceKeys: DeviceKeyPort;
  flag: E2eeFeatureFlag;
  now: () => number;
  newId: () => string;
};

function requireEnabled(deps: UseCaseDeps): void {
  if (!deps.flag.isEnabled()) fail('E_E2EE_DISABLED', 'the E2EE feature flag is off');
}

/** Handles are derived from the device id, so a resumed flow finds its keys. */
function sigHandleFor(deviceId: string): string {
  return `dev_sig:${deviceId}`;
}

function kemHandleFor(deviceId: string): string {
  return `dev_kem:${deviceId}`;
}

const ENROLLMENT_TTL_MS = 10 * 60 * 1000;
const PARTNER_ASSIST_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function grantsForPlatform(platform: PlatformName, assurance: string): KeyDomainName[] {
  // Health is off by default on web: a non-extractable key cannot be exported
  // but can be used by same-origin script, so the browser is the weakest class.
  // Platform is caller-provided metadata. A native-looking platform must not
  // receive health capability when the selected key port actually reports the
  // weak web assurance (for example, a missing native plugin).
  return platform === 'web' || assurance === ASSURANCE.webNonExtractable
    ? ['personal', 'couple']
    : ['personal', 'couple', 'health'];
}

function domainCode(domain: KeyDomainName) {
  return KEY_DOMAIN[domain];
}

function recoveryPrivAad(version: number, userId: Uint8Array, salt: Uint8Array, role: number): Uint8Array {
  return concat(utf8('gomsinlog/recpriv/v1'), new Uint8Array([role, version]), userId, salt);
}

async function deriveRkek(secret: Uint8Array, salt: Uint8Array, userIdBytes: Uint8Array): Promise<Uint8Array> {
  return hkdfSha256(secret, salt, concat(utf8('gomsinlog/rkek/v1'), userIdBytes), 32);
}

type SoftwareKeyPair = { privateKey: CryptoKey; spki: Uint8Array; pkcs8: Uint8Array };

async function generateSoftwareKeyPair(kind: 'ECDSA' | 'ECDH'): Promise<SoftwareKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: kind, namedCurve: 'P-256' },
    true,
    kind === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'],
  )) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    spki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
    pkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  };
}

async function signWithSoftwareKey(key: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, message as BufferSource));
}

function base64UrlToBytes(text: string): Uint8Array {
  return fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'));
}

/**
 * Recover the public SPKI a private key actually belongs to.
 *
 * This is the key-pair consistency check, and it is not ceremony: a recovery
 * blob that decrypts cleanly but holds the wrong private key produces an account
 * whose kit "works" right up until the first envelope fails to open, by which
 * point the correct key is gone. Deriving the public half and comparing it to
 * the published one catches that at kit-confirmation time.
 */
async function publicSpkiFromPkcs8(pkcs8: Uint8Array, kind: 'ECDSA' | 'ECDH'): Promise<{
  spki: Uint8Array;
  privateKey: CryptoKey;
}> {
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8 as BufferSource,
      { name: kind, namedCurve: 'P-256' },
      true,
      kind === 'ECDSA' ? ['sign'] : ['deriveBits'],
    );
  } catch {
    fail('E_RECOVERY_KEY_MALFORMED', `the decrypted ${kind} private key is not a P-256 key`);
  }
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  if (!jwk.x || !jwk.y) fail('E_RECOVERY_KEY_MALFORMED', 'the decrypted private key carries no public point');
  const point = concat(new Uint8Array([0x04]), base64UrlToBytes(jwk.x), base64UrlToBytes(jwk.y));
  return { spki: sec1ToSpki(point), privateKey };
}

/** The anchor this device pinned for an account. */
async function pinnedAnchor(deps: UseCaseDeps, userId: string): Promise<TrustAnchor> {
  const pin = await deps.localState.loadTrustAnchor(userId);
  if (!pin) fail('E_NO_PINNED_ANCHOR', `no trust anchor is pinned for ${userId}`);
  return anchorFromPin({
    userId,
    serverOriginId: await deps.repository.serverOriginId(),
    rootRecSigSpki: pin.rootRecSigSpki,
    recoveryIdentityId: pin.recoveryIdentityId,
    recoveryVersion: pin.recoveryVersion,
  });
}

type SenderIdentity = {
  deviceId: string;
  sigSpki: Uint8Array;
  certificateId: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

type EpochRecipients = {
  devices: { deviceId: string; kemSpki: Uint8Array }[];
  recoveryIdentities: { id: string; kemSpki: Uint8Array }[];
};

function recipientCount(recipients: EpochRecipients): number {
  return recipients.devices.length + recipients.recoveryIdentities.length;
}

/**
 * Build one epoch, end to end: PREPARING, every envelope, completeness, ACTIVE.
 *
 * The completeness gate re-reads the envelopes FROM THE REPOSITORY rather than
 * counting what this function just wrote. That is the difference between "we
 * believe we wrote six envelopes" and "six envelopes are durable", and it is the
 * only version of the check worth having: an epoch that activates on the
 * strength of an in-memory tally locks out whichever recipient's write failed.
 */
async function createEpoch(
  deps: UseCaseDeps,
  input: {
    domain: KeyDomainName;
    scopeId: string;
    ownerUserId: string | null;
    ownerCoupleId: string | null;
    /** The 16-byte owner bound into every envelope header for this scope. */
    ownerUserIdBytes: Uint8Array;
    scopeKey: Uint8Array;
    recipients: EpochRecipients;
    sender: SenderIdentity;
    /** Set when the sender is also the recipient, as in kit recovery. */
    selfNotarized?: boolean;
  },
): Promise<ScopeKeyRecord> {
  if (recipientCount(input.recipients) === 0) {
    fail('E_NO_RECIPIENTS', `no certified recipient for the ${input.domain} key`);
  }

  const existing = await deps.repository.listScopeKeys(input.domain, input.scopeId);
  const epoch = existing.reduce((max, key) => (key.epoch > max ? key.epoch : max), 0n) + 1n;

  const scopeKeyId = await deps.repository.insertScopeKey({
    domain: input.domain,
    scopeId: input.scopeId,
    epoch,
    state: 'PREPARING',
    ownerUserId: input.ownerUserId,
    ownerCoupleId: input.ownerCoupleId,
  });

  const header = {
    domain: domainCode(input.domain),
    scopeKeyId: uuidToBytes(scopeKeyId),
    ownerUserId: input.ownerUserIdBytes,
    scopeId: uuidToBytes(input.scopeId),
    epoch,
  };
  const common = {
    scopeKey: input.scopeKey,
    senderDeviceId: uuidToBytes(input.sender.deviceId),
    senderSigSpki: input.sender.sigSpki,
    sign: input.sender.sign,
    makeEphemeral: (peer: Uint8Array) => generateEphemeralAgreement(peer),
    header,
    nowMs: BigInt(deps.now()),
  };

  try {
    for (const device of input.recipients.devices) {
      await deps.repository.insertEnvelope({
        scopeKeyId,
        recipientKind: 'device',
        recipientId: device.deviceId,
        senderDeviceId: input.sender.deviceId,
        senderCertificateId: input.sender.certificateId,
        selfNotarized: input.selfNotarized === true && device.deviceId === input.sender.deviceId,
        envelope: await sealScopeKeyForRecipient({
          ...common,
          recipientKemSpki: device.kemSpki,
          recipientId: uuidToBytes(device.deviceId),
          recipientKind: RECIPIENT_KIND.device,
        }),
      });
    }

  // The recovery envelope is what makes a lost device survivable at all. It is
  // written for every epoch, not just the first, which is why a rotation after a
  // device loss does not quietly strand the account's own recovery kit.
    for (const identity of input.recipients.recoveryIdentities) {
      await deps.repository.insertEnvelope({
        scopeKeyId,
        recipientKind: 'recovery_identity',
        recipientId: identity.id,
        senderDeviceId: input.sender.deviceId,
        senderCertificateId: input.sender.certificateId,
        envelope: await sealScopeKeyForRecipient({
          ...common,
          recipientKemSpki: identity.kemSpki,
          recipientId: uuidToBytes(identity.id),
          recipientKind: RECIPIENT_KIND.recoveryIdentity,
        }),
      });
    }

  // Completeness is the SERVER's decision, and `markEpochReady` is where it is
  // made. It cannot be made here: RLS correctly hides the partner's envelope
  // rows, so a client counting what it can read sees 3 of 5 for a couple epoch
  // and would abandon an epoch that is in fact complete. That is the defect this
  // replaces — the previous revision re-read `listEnvelopes` and compared counts,
  // which passed only because the in-memory double exposed both sides.
  //
  // The RPC raises E2EE_EPOCH_INCOMPLETE when a required recipient is missing, so
  // a genuinely half-built epoch still fails; it is abandoned here so it cannot
  // be mistaken later for a legitimate one, and ABANDONED is terminal.
    await deps.repository.markEpochReady(scopeKeyId);
    await deps.repository.activateEpoch(scopeKeyId);
  } catch (error) {
    await deps.repository.abandonEpoch(scopeKeyId).catch(() => {});
    throw error;
  }

  const reloaded = await deps.repository.getScopeKey(scopeKeyId);
  if (!reloaded || reloaded.state !== 'ACTIVE') {
    fail('E_EPOCH_NOT_ACTIVE', 'the epoch did not reach ACTIVE');
  }
  return reloaded;
}

// ---------------------------------------------------------------------------
// 1A-6  First device bootstrap
// ---------------------------------------------------------------------------

export type BootstrapResult = {
  state: 'RECOVERY_KIT_PENDING_VERIFICATION';
  deviceId: string;
  recoveryIdentityId: string;
  recoveryCode: string;
  anchorTag: string;
  /**
   * The trust anchor the user's artifact must carry, alongside the code.
   *
   * Returned as data rather than only as a display tag because recovery requires
   * it: `recoverWithKit` takes the anchor itself, so whatever persists the kit
   * has to persist all of it.
   */
  kitAnchor: RecoveryKitAnchor;
  resumed: boolean;
};

async function ensureDeviceProvisioned(deps: UseCaseDeps, deviceId: string): Promise<void> {
  const device = await deps.repository.getDevice(deviceId);
  if (!device) fail('E_DEVICE_MISSING', 'the bootstrapped device no longer exists');
  if (device.status === 'ACTIVE') return;
  if (device.status === 'PENDING' || device.status === 'RECOVERY_AUTHENTICATED') {
    await deps.repository.beginDeviceProvisioning(deviceId);
  } else if (device.status !== 'PROVISIONING') {
    fail('E_DEVICE_NOT_PROVISIONABLE', `device is in ${device.status}`);
  }
  await deps.repository.finalizeDeviceProvisioning(deviceId);
}

export async function bootstrapState(deps: UseCaseDeps, userId: string) {
  const pending = await deps.localState.loadBootstrap(userId);
  return pending?.state ?? 'NOT_STARTED';
}

/**
 * Create the account's first device, its recovery identity, and its personal
 * and health keys.
 *
 * Resumable and fail-closed. Every durable step is written to local state before
 * the next begins, and a retry ADOPTS what already exists rather than minting a
 * second one: the resume path reads the persisted recovery identity, the
 * persisted certificate and the persisted epochs, and only creates what is
 * genuinely absent.
 *
 * The recovery secret is held in local state for the duration — it is on the
 * user's screen for that whole window anyway — because the encrypted private
 * material on the server is openable by exactly one 256-bit value and that value
 * is deliberately not on the server. Losing it mid-bootstrap without this would
 * mean an account whose recovery identity can never be opened by anyone.
 */
export async function bootstrapFirstDevice(
  deps: UseCaseDeps,
  input: { userId: string; platform: PlatformName },
): Promise<BootstrapResult> {
  requireEnabled(deps);

  const userIdBytes = uuidToBytes(input.userId);
  const serverOriginId = await deps.repository.serverOriginId();
  const existing = await deps.localState.loadBootstrap(input.userId);
  if (existing?.state === 'COMPLETE') {
    fail('E_ALREADY_BOOTSTRAPPED', 'this account already has a confirmed first device');
  }

  const resumed = existing !== null;
  if (!existing && await deps.repository.getRecoveryIdentity(input.userId)) {
    fail(
      'E_EXISTING_CRYPTO_ACCOUNT',
      'this account already has a recovery identity; use device enrollment or recovery instead',
    );
  }
  let pending: PendingBootstrap;

  if (existing) {
    if (!existing.recoverySecret) {
      // The secret is cleared only at COMPLETE, so its absence here means local
      // state was tampered with or partially wiped. There is no honest way to
      // continue and minting a second identity would orphan the first.
      fail('E_BOOTSTRAP_UNRESUMABLE', 'the pending bootstrap has no recovery secret to resume with');
    }
    pending = { ...existing };
  } else {
    const deviceId = deps.newId();
    pending = {
      state: 'CREATING',
      deviceId,
      sigHandle: sigHandleFor(deviceId),
      kemHandle: kemHandleFor(deviceId),
      platform: input.platform,
      recoverySecret: randomBytes(32),
      recoveryIdentityId: null,
      recoveryVersion: 1,
      recoveryAnchorId: null,
      certificateId: null,
      recoveryCode: null,
      anchorTag: null,
      personalScopeKeyId: null,
      healthScopeKeyId: null,
    };
    await deps.localState.saveBootstrap(input.userId, pending);
  }

  // 1. Device identity, by handle. `hasKey` is what makes the retry safe: a
  // second `generateSigningKey` on the same alias would replace the key the
  // certificate already commits to.
  let sigSpki: Uint8Array;
  let kemSpki: Uint8Array;
  const hasSig = await deps.deviceKeys.hasKey(pending.sigHandle);
  const hasKem = await deps.deviceKeys.hasKey(pending.kemHandle);
  if (hasSig && hasKem) {
    sigSpki = await deps.deviceKeys.getPublicKey(pending.sigHandle);
    kemSpki = await deps.deviceKeys.getPublicKey(pending.kemHandle);
  } else if (!hasSig && !hasKem) {
    sigSpki = (await deps.deviceKeys.generateSigningKey(pending.sigHandle)).publicKeySpki;
    kemSpki = (await deps.deviceKeys.generateAgreementKey(pending.kemHandle)).publicKeySpki;
  } else {
    fail('E_DEVICE_KEY_PAIR_INCOMPLETE', 'only one half of the device identity exists; refusing to mint a conflicting pair');
  }
  const assurance = await deps.deviceKeys.getAssurance(pending.sigHandle);
  const grants = grantsForPlatform(pending.platform, assurance);

  if (!(await deps.repository.getDevice(pending.deviceId))) {
    await deps.repository.insertDevice({
      id: pending.deviceId,
      userId: input.userId,
      sigSpki,
      kemSpki,
      platform: pending.platform,
      assurance,
      status: 'PENDING',
    });
  }

  // 2. Recovery identity. The secret never reaches the server; only RKEK-sealed
  // private material and public keys do. A retry ADOPTS whatever is already
  // there — minting a second identity would orphan every certificate and every
  // recovery envelope the first one anchors.
  const recoverySecret = pending.recoverySecret;
  if (!recoverySecret) fail('E_BOOTSTRAP_UNRESUMABLE', 'no recovery secret in local state');

  const existingIdentity = await deps.repository.getRecoveryIdentity(input.userId);
  const identity = existingIdentity
    ?? await createRecoveryIdentity(deps, { userId: input.userId, userIdBytes, recoverySecret });

  pending.recoveryIdentityId = identity.id;
  pending.recoveryVersion = identity.recoveryVersion;
  await deps.localState.saveBootstrap(input.userId, pending);

  const rootRecSigFp = await publicKeyFingerprint(identity.recSigSpki);

  // 3. The public anchor row, so a historical certificate stays checkable after
  // the identity itself is superseded or the account is deleted.
  let anchorId = pending.recoveryAnchorId;
  const anchorRow = await deps.repository.getRecoveryAnchorFor(identity.id);
  if (anchorRow) {
    anchorId = anchorRow.id;
  } else {
    anchorId = await deps.repository.insertRecoveryAnchor({
      userId: input.userId,
      recoveryIdentityId: identity.id,
      recoveryVersion: identity.recoveryVersion,
      recSigSpki: identity.recSigSpki,
      recSigFp: rootRecSigFp,
      recoveryBundleFp: identity.recoveryBundleFp,
    });
  }
  pending.recoveryAnchorId = anchorId;
  await deps.localState.saveBootstrap(input.userId, pending);

  // The trust root exists before any scope key does, so there is never a window
  // in which a device is trusted by status alone.
  await deps.localState.pinTrustAnchor(input.userId, {
    rootRecSigPubFp: rootRecSigFp,
    rootRecSigSpki: identity.recSigSpki,
    recoveryIdentityId: identity.id,
    recoveryVersion: identity.recoveryVersion,
  });

  // 4. The first device certificate, signed by the recovery key. Signing needs
  // the recovery private half, which means unsealing it with the kit secret —
  // the same operation a recovery performs, so bootstrap proves the material is
  // openable before it ever asks the user to keep it.
  const recovery = await unsealRecoveryPrivates(identity, recoverySecret, userIdBytes);
  let certificateId = pending.certificateId;
  try {
    const existingCertificates = await deps.repository.listCertificates(input.userId);
    const already = existingCertificates.find((c) => c.subjectDeviceId === pending.deviceId);
    if (already) {
      certificateId = already.id;
    } else {
      const tbs = encodeTbs({
        issuerKind: ISSUER_KIND.recoveryIdentity,
        subjectAssurance: assurance,
        subjectPlatform: pending.platform,
        grantedDomains: grants,
        userId: userIdBytes,
        serverOriginId,
        recoveryIdentityId: uuidToBytes(identity.id),
        recoveryVersion: identity.recoveryVersion,
        rootRecSigPubFp: rootRecSigFp,
        issuerId: uuidToBytes(identity.id),
        issuerSigPubFp: rootRecSigFp,
        subjectDeviceId: uuidToBytes(pending.deviceId),
        subjectSigPubFp: await publicKeyFingerprint(sigSpki),
        subjectKemPubFp: await publicKeyFingerprint(kemSpki),
        notBeforeMs: 0n,
        notAfterMs: 0n,
        ceremonyNonce: randomBytes(32),
        ceremonyTranscriptHash: await sha256(
          concat(utf8('gomsinlog/bootstrap/v1'), userIdBytes, identity.recoveryBundleFp),
        ),
      });
      const certificate = assembleCertificate(
        tbs,
        await signWithSoftwareKey(recovery.sig.privateKey, certificateSignedMessage(tbs)),
        await deps.deviceKeys.sign(pending.sigHandle, certificatePopMessage(tbs)),
      );
      certificateId = await deps.repository.insertCertificate({
        userId: input.userId,
        subjectDeviceId: pending.deviceId,
        issuerDeviceId: null,
        issuerCertificateId: null,
        recoveryPublicAnchorId: anchorId,
        recoveryIdentityId: identity.id,
        recoveryVersion: identity.recoveryVersion,
        certificate,
        certificateFp: await sha256(certificate),
        subjectSigSpki: sigSpki,
        subjectKemSpki: kemSpki,
      });
    }
    if (!certificateId) fail('E_CERTIFICATE_MISSING', 'the first device certificate did not persist');
    pending.certificateId = certificateId;
    await deps.localState.saveBootstrap(input.userId, pending);

    // 5. Personal and health keys, wrapped to this device AND to recovery.
    const sender: SenderIdentity = {
      deviceId: pending.deviceId,
      sigSpki,
      certificateId,
      sign: (message) => deps.deviceKeys.sign(pending.sigHandle, message),
    };
    for (const domain of ['personal', 'health'] as const) {
      if (!grants.includes(domain)) continue;
      const already2 = await deps.repository.listScopeKeys(domain, input.userId);
      if (already2.some((key) => key.state === 'ACTIVE')) continue;

      const scopeKey = generateScopeKeyBytes();
      try {
        const created = await createEpoch(deps, {
          domain,
          scopeId: input.userId,
          ownerUserId: input.userId,
          ownerCoupleId: null,
          ownerUserIdBytes: userIdBytes,
          scopeKey,
          recipients: {
            devices: [{ deviceId: pending.deviceId, kemSpki }],
            recoveryIdentities: [{ id: identity.id, kemSpki: identity.recKemSpki }],
          },
          sender,
          // This device generated the key and wrapped it to itself, so its own
          // envelope needs nobody else's certificate to be verifiable. Marking it
          // here is what lets the provisioning gate see the first device as
          // covered — and the flag is only ever applied to the sender's own
          // envelope, never to the recovery identity's.
          selfNotarized: true,
        });
        if (domain === 'personal') pending.personalScopeKeyId = created.id;
        else pending.healthScopeKeyId = created.id;
      } finally {
        zeroize(scopeKey);
      }
      await deps.localState.saveBootstrap(input.userId, pending);
    }
  } finally {
    zeroize(recovery.sigPkcs8, recovery.kemPkcs8);
  }

  const recoveryCode = pending.recoveryCode ?? (await encodeRecoveryCode(recoverySecret));
  const kitAnchor: RecoveryKitAnchor = {
    recoveryIdentityId: uuidToBytes(identity.id),
    recoveryVersion: identity.recoveryVersion,
    recoveryBundleFp: identity.recoveryBundleFp,
    serverOriginId,
    userId: userIdBytes,
  };
  const anchorTag = await deriveKitAnchorTagV2(kitAnchor);

  pending.recoveryCode = recoveryCode;
  pending.anchorTag = anchorTag;
  pending.state = 'RECOVERY_KIT_PENDING_VERIFICATION';
  await deps.localState.saveBootstrap(input.userId, pending);

  return {
    state: 'RECOVERY_KIT_PENDING_VERIFICATION',
    deviceId: pending.deviceId,
    recoveryIdentityId: identity.id,
    recoveryCode,
    anchorTag,
    kitAnchor,
    resumed,
  };
}

/**
 * Mint the account's recovery identity and persist EVERY value recovery needs.
 *
 * The list is deliberately exhaustive, because the previous implementation
 * generated a nonce and a bundle signature and then threw both away: material
 * sealed under a nonce nobody kept is material nobody can ever open, and a
 * bundle nobody signed is a bundle a server can swap. Both now round-trip.
 */
async function createRecoveryIdentity(
  deps: UseCaseDeps,
  input: { userId: string; userIdBytes: Uint8Array; recoverySecret: Uint8Array },
): Promise<RecoveryIdentityRecord> {
  const recoverySalt = randomBytes(32);
  let rkekBytes: Uint8Array | null = null;
  let recSig: SoftwareKeyPair | null = null;
  let recKem: SoftwareKeyPair | null = null;
  try {
    rkekBytes = await deriveRkek(input.recoverySecret, recoverySalt, input.userIdBytes);
    const rkek = await importAesKey(rkekBytes, ['encrypt', 'decrypt']);

    recSig = await generateSoftwareKeyPair('ECDSA');
    recKem = await generateSoftwareKeyPair('ECDH');

    const bundle: RecoveryBundle = {
      recoveryVersion: 1,
      userId: input.userIdBytes,
      recoverySalt,
      recSigSpki: recSig.spki,
      recKemSpki: recKem.spki,
    };
    const recoveryBundleFp = await recoveryBundleFingerprint(bundle);

    const recSigNonce = randomNonce();
    const recKemNonce = randomNonce();
    const encRecSigPriv = await aesGcmSeal(
      rkek, recSigNonce, recSig.pkcs8, recoveryPrivAad(1, input.userIdBytes, recoverySalt, 1),
    );
    const encRecKemPriv = await aesGcmSeal(
      rkek, recKemNonce, recKem.pkcs8, recoveryPrivAad(1, input.userIdBytes, recoverySalt, 2),
    );
    const bundleSig = await signWithSoftwareKey(
      recSig.privateKey, recoveryBundleSignedMessage(recoveryBundleFp),
    );

    await deps.repository.insertRecoveryIdentity({
      userId: input.userId,
      recoveryVersion: 1,
      recoverySalt,
      recSigSpki: recSig.spki,
      recKemSpki: recKem.spki,
      recSigNonce,
      encRecSigPriv,
      recKemNonce,
      encRecKemPriv,
      recoveryBundleFp,
      bundleSig,
    });

    // Read back rather than assume. Everything downstream — certificate
    // signing, recovery, kit confirmation — uses the PERSISTED row, so if the
    // round trip damaged anything it fails here rather than months later.
    const persisted = await deps.repository.getRecoveryIdentity(input.userId);
    if (!persisted) fail('E_RECOVERY_IDENTITY_MISSING', 'the recovery identity did not persist');
    return persisted;
  } finally {
    zeroize(rkekBytes, recSig?.pkcs8, recKem?.pkcs8);
  }
}

type UnsealedRecovery = {
  sig: { privateKey: CryptoKey; spki: Uint8Array };
  kem: { privateKey: CryptoKey; spki: Uint8Array };
  sigPkcs8: Uint8Array;
  kemPkcs8: Uint8Array;
};

/**
 * Unseal both recovery private halves and prove they are the published pair.
 *
 * Used by bootstrap, kit confirmation and recovery alike, so all three agree
 * byte for byte on the nonce, the AAD and the consistency rule.
 */
async function unsealRecoveryPrivates(
  identity: RecoveryIdentityRecord,
  recoverySecret: Uint8Array,
  userIdBytes: Uint8Array,
): Promise<UnsealedRecovery> {
  let rkekBytes: Uint8Array | null = null;
  try {
    rkekBytes = await deriveRkek(recoverySecret, identity.recoverySalt, userIdBytes);
    const rkek = await importAesKey(rkekBytes, ['encrypt', 'decrypt']);

    let sigPkcs8: Uint8Array;
    let kemPkcs8: Uint8Array;
    try {
      sigPkcs8 = await aesGcmOpen(
        rkek, identity.recSigNonce, identity.encRecSigPriv,
        recoveryPrivAad(identity.recoveryVersion, userIdBytes, identity.recoverySalt, 1),
      );
      kemPkcs8 = await aesGcmOpen(
        rkek, identity.recKemNonce, identity.encRecKemPriv,
        recoveryPrivAad(identity.recoveryVersion, userIdBytes, identity.recoverySalt, 2),
      );
    } catch {
      // The AEAD is the kit check. A wrong code derives a wrong RKEK and the tag
      // fails; there is nothing else to compare and nothing to leak.
      fail('E_KIT_MISMATCH', 'the recovery kit does not open this account');
    }

    const sig = await publicSpkiFromPkcs8(sigPkcs8, 'ECDSA');
    const kem = await publicSpkiFromPkcs8(kemPkcs8, 'ECDH');
    if (!equalBytes(sig.spki, identity.recSigSpki)) {
      fail('E_RECOVERY_KEY_INCONSISTENT', 'the sealed signing key is not the published one');
    }
    if (!equalBytes(kem.spki, identity.recKemSpki)) {
      fail('E_RECOVERY_KEY_INCONSISTENT', 'the sealed agreement key is not the published one');
    }
    return {
      sig: { privateKey: sig.privateKey, spki: sig.spki },
      kem: { privateKey: kem.privateKey, spki: kem.spki },
      sigPkcs8,
      kemPkcs8,
    };
  } finally {
    zeroize(rkekBytes);
  }
}

/** Decode a kit code, use it, and wipe the secret on every path. */
async function unsealWithCode(
  identity: RecoveryIdentityRecord,
  recoveryCode: string,
  userIdBytes: Uint8Array,
): Promise<UnsealedRecovery> {
  const secret = await decodeRecoveryCode(recoveryCode);
  try {
    return await unsealRecoveryPrivates(identity, secret, userIdBytes);
  } finally {
    zeroize(secret);
  }
}

/**
 * Complete bootstrap only after the user has proved they kept the kit.
 *
 * Verification is against PERSISTED state, reloaded here, not against a value
 * this process happens to remember: the whole point of the step is to confirm
 * that what is on the server can be opened by what is in the user's hand.
 *
 * Checked, in order: the identity and generation the kit names, the bundle
 * fingerprint recomputed from the stored bundle, the stored bundle signature
 * under the stored recovery key, the full 56-symbol code, the decryptability of
 * both encrypted private halves, and the consistency of each decrypted private
 * key with its published public half.
 *
 * A wrong kit changes nothing. A repeated correct kit is a no-op.
 */
export async function confirmRecoveryKit(
  deps: UseCaseDeps,
  input: {
    userId: string;
    recoveryCode: string;
    /**
     * The anchor from the artifact being confirmed. MANDATORY.
     *
     * Confirmation is the step that proves the user kept a USABLE kit, and a kit
     * without its anchor is not usable for recovery — `recoverWithKit` will
     * refuse it. Accepting a bare code here would confirm an account into a state
     * whose recovery path cannot run.
     */
    kitAnchor: RecoveryKitAnchor;
  },
): Promise<{ state: 'COMPLETE'; alreadyComplete: boolean }> {
  requireEnabled(deps);

  const pending = await deps.localState.loadBootstrap(input.userId);
  if (!pending) fail('E_BOOTSTRAP_INCOMPLETE', 'nothing to confirm yet');
  if (pending.state === 'CREATING') fail('E_BOOTSTRAP_INCOMPLETE', 'bootstrap has not finished creating');

  // A response can be lost after the local state is committed but before the
  // server finishes provisioning. Retrying must continue the server-side gate,
  // not return early and leave a device marked complete while still unusable.
  if (pending.state === 'COMPLETE') {
    await ensureDeviceProvisioned(deps, pending.deviceId);
    return { state: 'COMPLETE', alreadyComplete: true };
  }

  const identity = await deps.repository.getRecoveryIdentity(input.userId);
  if (!identity) fail('E_RECOVERY_IDENTITY_MISSING', 'there is no recovery identity to confirm against');

  if (pending.recoveryIdentityId && identity.id !== pending.recoveryIdentityId) {
    fail('E_RECOVERY_IDENTITY_MISMATCH', 'the served recovery identity is not the one this device created');
  }
  if (identity.recoveryVersion !== pending.recoveryVersion) {
    fail('E_RECOVERY_VERSION_MISMATCH', 'the served recovery generation is not the one this device created');
  }

  const userIdBytes = uuidToBytes(input.userId);
  const serverOriginId = await deps.repository.serverOriginId();

  // The fingerprint is RECOMPUTED from the stored bundle, then compared to the
  // stored fingerprint. A server that swapped a public key would have to break
  // SHA-256 to keep both consistent.
  const recomputed = await recoveryBundleFingerprint({
    recoveryVersion: identity.recoveryVersion,
    userId: userIdBytes,
    recoverySalt: identity.recoverySalt,
    recSigSpki: identity.recSigSpki,
    recKemSpki: identity.recKemSpki,
  });
  if (!equalBytes(recomputed, identity.recoveryBundleFp)) {
    fail('E_BUNDLE_FP_MISMATCH', 'the stored bundle fingerprint does not match the stored bundle');
  }

  const bundleSigOk = await ecdsaVerify(
    identity.recSigSpki, recoveryBundleSignedMessage(identity.recoveryBundleFp), identity.bundleSig,
  );
  if (!bundleSigOk) fail('E_BUNDLE_SIG_INVALID', 'the stored recovery bundle signature does not verify');

  // The same total check recovery performs, so an artifact that would fail at
  // recovery time cannot be confirmed as good now.
  await verifyKitAnchor(
    { secret: new Uint8Array(RECOVERY_SECRET_BYTES), anchor: input.kitAnchor },
    {
      recoveryIdentityId: uuidToBytes(identity.id),
      recoveryVersion: identity.recoveryVersion,
      recoveryBundleFp: identity.recoveryBundleFp,
      serverOriginId,
      userId: userIdBytes,
    },
  );

  // The full code, decoded and checksummed, then actually USED: the AEAD is what
  // proves this kit opens this account, and the key-pair consistency check
  // inside proves the material it opens is the published pair.
  const unsealed = await unsealWithCode(identity, input.recoveryCode, userIdBytes);
  zeroize(unsealed.sigPkcs8, unsealed.kemPkcs8);

  // Operational status follows the evidence, never leads it — and the server is
  // what checks the evidence. The first device already holds its recovery-rooted
  // certificate and a self-notarized envelope for every epoch bootstrap created,
  // so finalization succeeds here; if it somehow does not, the account stays
  // confirmed but the device stays visibly unprovisioned rather than claiming a
  // readiness it cannot back.
  await ensureDeviceProvisioned(deps, pending.deviceId);
  await deps.localState.saveBootstrap(input.userId, {
    ...pending,
    state: 'COMPLETE',
    recoverySecret: null,
    // The display code is also secret material. Keeping only the anchor tag
    // after confirmation would let a stolen local state file recover the kit.
    recoveryCode: null,
  });
  await deps.localState.clearBootstrapSecret(input.userId);
  return { state: 'COMPLETE', alreadyComplete: false };
}

// ---------------------------------------------------------------------------
// 1A-7  Recovery with the kit
// ---------------------------------------------------------------------------

export type RecoveryState = 'PENDING' | 'RECOVERY_AUTHENTICATED' | 'PROVISIONING' | 'ACTIVE';

export type RecoveryResult = {
  state: 'ACTIVE';
  deviceId: string;
  certificateId: string;
  recoveredScopes: { domain: KeyDomainName; scopeId: string; epoch: bigint }[];
  rotatedScopes: { domain: KeyDomainName; scopeId: string; epoch: bigint }[];
  supersededDevices: string[];
};

/**
 * Recover an account onto a brand-new device using the recovery kit.
 *
 * The property this holds, stated as the test that proves it: an attacker with a
 * full database dump AND a valid Auth session still recovers nothing. The dump
 * yields public keys, RKEK-sealed blobs and spent challenges; none of that
 * produces a signature over a challenge issued after the dump, and only the
 * user's 256-bit kit secret unlocks the key that can.
 *
 * The device reaches ACTIVE at the END. Every failure before that point leaves
 * it PROVISIONING_FAILED — visible, retryable, and not a recipient for anything.
 */
export async function recoverWithKit(
  deps: UseCaseDeps,
  input: {
    userId: string;
    platform: PlatformName;
    recoveryCode: string;
    /**
     * The trust anchor from the user's kit. MANDATORY.
     *
     * Not optional, and not a tag the caller may omit: with no anchor the only
     * remaining authority on which recovery generation is current is the server,
     * which is exactly the rollback V2.1 section 7 requires the kit to detect.
     */
    kitAnchor: RecoveryKitAnchor;
    userConfirmedSecureErase?: boolean;
  },
): Promise<RecoveryResult> {
  requireEnabled(deps);

  const userIdBytes = uuidToBytes(input.userId);
  const serverOriginId = await deps.repository.serverOriginId();
  const nowMs = BigInt(deps.now());

  // 1. Load the recovery identity and its persisted encrypted material.
  const identity = await deps.repository.getRecoveryIdentity(input.userId);
  if (!identity) fail('E_RECOVERY_IDENTITY_MISSING', 'this account has no recovery identity');

  // 2. The kit decides which bundle is current, not the server.
  //
  // This runs before the bundle fingerprint is recomputed and before any AEAD is
  // attempted, so a server offering an older genuine generation is rejected on
  // the strength of the user's artifact alone. Total function: every field of
  // the anchor is compared, and there is no path through recovery that skips it.
  await verifyKitAnchor(
    { secret: new Uint8Array(RECOVERY_SECRET_BYTES), anchor: input.kitAnchor },
    {
      recoveryIdentityId: uuidToBytes(identity.id),
      recoveryVersion: identity.recoveryVersion,
      recoveryBundleFp: identity.recoveryBundleFp,
      serverOriginId,
      userId: userIdBytes,
    },
  );

  const recomputedFp = await recoveryBundleFingerprint({
    recoveryVersion: identity.recoveryVersion,
    userId: userIdBytes,
    recoverySalt: identity.recoverySalt,
    recSigSpki: identity.recSigSpki,
    recKemSpki: identity.recKemSpki,
  });
  if (!equalBytes(recomputedFp, identity.recoveryBundleFp)) {
    fail('E_BUNDLE_FP_MISMATCH', 'the served bundle does not match its fingerprint');
  }
  const bundleSigOk = await ecdsaVerify(
    identity.recSigSpki, recoveryBundleSignedMessage(identity.recoveryBundleFp), identity.bundleSig,
  );
  if (!bundleSigOk) fail('E_BUNDLE_SIG_INVALID', 'the served recovery bundle signature does not verify');

  // 3-4. Decrypt with the PERSISTED nonces, and prove key consistency.
  const recovery = await unsealWithCode(identity, input.recoveryCode, userIdBytes);

  const rootRecSigFp = await publicKeyFingerprint(identity.recSigSpki);
  const anchor: TrustAnchor = {
    rootRecSigPubFp: rootRecSigFp,
    rootRecSigSpki: identity.recSigSpki,
    recoveryIdentityId: uuidToBytes(identity.id),
    recoveryVersion: identity.recoveryVersion,
    userId: userIdBytes,
    serverOriginId,
  };

  const deviceId = deps.newId();
  const sigHandle = sigHandleFor(deviceId);
  const kemHandle = kemHandleFor(deviceId);

  try {
    // 9 (moved ahead of the challenge: the challenge transcript binds the new
    // device's key fingerprints, so the keys must exist first).
    const sig = await deps.deviceKeys.generateSigningKey(sigHandle);
    const kem = await deps.deviceKeys.generateAgreementKey(kemHandle);
    const grants = grantsForPlatform(input.platform, sig.assurance);

    await deps.repository.insertDevice({
      id: deviceId,
      userId: input.userId,
      sigSpki: sig.publicKeySpki,
      kemSpki: kem.publicKeySpki,
      platform: input.platform,
      assurance: sig.assurance,
      status: 'PENDING',
    });

    // 5. A FRESH challenge. Server-issued and server-nonced; a client cannot
    // mint one, which is what makes a database dump insufficient.
    const challenge = await deps.repository.issueRecoveryChallenge({ userId: input.userId, deviceId });
    if (challenge.recoveryVersion !== identity.recoveryVersion) {
      fail('E_RECOVERY_VERSION_MISMATCH', 'the challenge names a different recovery generation');
    }
    // The identity, not merely the generation: a version number repeats across a
    // rotation, so it alone would not catch a replaced recovery identity.
    if (challenge.recoveryIdentityId !== identity.id) {
      fail('E_RECOVERY_IDENTITY_MISMATCH', 'the challenge names a different recovery identity');
    }
    if (challenge.newDeviceId !== deviceId) {
      fail('E_CHALLENGE_DEVICE_MISMATCH', 'the challenge was issued for a different device');
    }
    if (challenge.expiresAtMs <= nowMs) fail('E_CHALLENGE_EXPIRED', 'the recovery challenge is already expired');

    // 6. Sign it with the recovery key the kit just unsealed.
    const transcript = encodeRecoveryChallengeTranscript({
      serverOriginId,
      userId: userIdBytes,
      challengeId: uuidToBytes(challenge.id),
      challengeNonce: challenge.challengeNonce,
      issuedAtMs: challenge.issuedAtMs,
      expiresAtMs: challenge.expiresAtMs,
      recoveryVersion: identity.recoveryVersion,
      recSigPubFp: rootRecSigFp,
      newDeviceId: uuidToBytes(deviceId),
      newSigFp: await publicKeyFingerprint(sig.publicKeySpki),
      newKemFp: await publicKeyFingerprint(kem.publicKeySpki),
    });
    const challengeSignature = await signWithSoftwareKey(recovery.sig.privateKey, transcript);

    // 7-8. Atomic: the challenge is burned and the device moves in one
    // transaction, so a failure never spends a valid single-use credential.
    const authenticated = await deps.repository.verifyRecoveryAuthentication({
      challengeId: challenge.id,
      deviceId,
      signature: challengeSignature,
    });
    if (authenticated.nextState !== 'RECOVERY_AUTHENTICATED') {
      fail('E_RECOVERY_NOT_AUTHENTICATED', 'the server did not authenticate this device');
    }

    // 10-11. A new certificate under the recovery root, with this device's own
    // proof of possession.
    const anchorRow = await deps.repository.getRecoveryAnchorFor(identity.id);
    const anchorId = anchorRow
      ? anchorRow.id
      : await deps.repository.insertRecoveryAnchor({
        userId: input.userId,
        recoveryIdentityId: identity.id,
        recoveryVersion: identity.recoveryVersion,
        recSigSpki: identity.recSigSpki,
        recSigFp: rootRecSigFp,
        recoveryBundleFp: identity.recoveryBundleFp,
      });

    const tbs = encodeTbs({
      issuerKind: ISSUER_KIND.recoveryIdentity,
      subjectAssurance: sig.assurance,
      subjectPlatform: input.platform,
      grantedDomains: grants,
      userId: userIdBytes,
      serverOriginId,
      recoveryIdentityId: uuidToBytes(identity.id),
      recoveryVersion: identity.recoveryVersion,
      rootRecSigPubFp: rootRecSigFp,
      issuerId: uuidToBytes(identity.id),
      issuerSigPubFp: rootRecSigFp,
      subjectDeviceId: uuidToBytes(deviceId),
      subjectSigPubFp: await publicKeyFingerprint(sig.publicKeySpki),
      subjectKemPubFp: await publicKeyFingerprint(kem.publicKeySpki),
      notBeforeMs: 0n,
      notAfterMs: 0n,
      ceremonyNonce: challenge.challengeNonce,
      ceremonyTranscriptHash: await sha256(transcript),
    });
    const certificate = assembleCertificate(
      tbs,
      await signWithSoftwareKey(recovery.sig.privateKey, certificateSignedMessage(tbs)),
      await deps.deviceKeys.sign(sigHandle, certificatePopMessage(tbs)),
    );
    const certificateId = await deps.repository.insertCertificate({
      userId: input.userId,
      subjectDeviceId: deviceId,
      issuerDeviceId: null,
      issuerCertificateId: null,
      recoveryPublicAnchorId: anchorId,
      recoveryIdentityId: identity.id,
      recoveryVersion: identity.recoveryVersion,
      certificate,
      certificateFp: await sha256(certificate),
      subjectSigSpki: sig.publicKeySpki,
      subjectKemSpki: kem.publicKeySpki,
    });

    // 12. Only now does the device claim to be provisioning.
    //
    // Through the server RPC, which re-checks that a certificate exists. A
    // direct status write is refused by the database.
    await deps.repository.beginDeviceProvisioning(deviceId);

    await deps.localState.pinTrustAnchor(input.userId, {
      rootRecSigPubFp: rootRecSigFp,
      rootRecSigSpki: identity.recSigSpki,
      recoveryIdentityId: identity.id,
      recoveryVersion: identity.recoveryVersion,
    });

    const sender: SenderIdentity = {
      deviceId,
      sigSpki: sig.publicKeySpki,
      certificateId,
      sign: (message) => deps.deviceKeys.sign(sigHandle, message),
    };

    // 13-15. Recover every scope through the recovery envelopes, then provision
    // this device into each of those live epochs.
    const certificates = await deps.repository.listCertificates(input.userId);
    const recoveryEnvelopes = await deps.repository.listEnvelopesForRecoveryIdentity(identity.id);
    const recovered: RecoveryResult['recoveredScopes'] = [];
    const deriveWithRecoveryKem = (peer: Uint8Array) => ecdhWithCryptoKey(recovery.kem.privateKey, peer);

    for (const envelope of recoveryEnvelopes) {
      const scope = await deps.repository.getScopeKey(envelope.scopeKeyId);
      if (!scope || scope.state !== 'ACTIVE') continue;

      const rewrapped = await provisionScopeKeyToRecipient({
        ownEnvelope: envelope.envelope,
        ownKemSpki: identity.recKemSpki,
        ownEnvelopeSenderSigSpki: await verifiedSenderKey(envelope, certificates, anchor, nowMs),
        deriveSecret: deriveWithRecoveryKem,
        recipientKemSpki: kem.publicKeySpki,
        recipientId: uuidToBytes(deviceId),
        recipientKind: RECIPIENT_KIND.device,
        senderDeviceId: uuidToBytes(deviceId),
        senderSigSpki: sig.publicKeySpki,
        sign: sender.sign,
        makeEphemeral: (peer) => generateEphemeralAgreement(peer),
        header: {
          domain: domainCode(scope.domain),
          scopeKeyId: uuidToBytes(scope.id),
          ownerUserId: scope.ownerUserId ? uuidToBytes(scope.ownerUserId) : userIdBytes,
          scopeId: uuidToBytes(scope.scopeId),
          epoch: scope.epoch,
        },
        nowMs,
      });

      const already = await deps.repository.listEnvelopes(scope.id);
      if (!already.some((e) => e.recipientKind === 'device' && e.recipientId === deviceId)) {
        await deps.repository.insertEnvelope({
          scopeKeyId: scope.id,
          recipientKind: 'device',
          recipientId: deviceId,
          senderDeviceId: deviceId,
          senderCertificateId: certificateId,
          envelope: rewrapped,
          // 16. Written by this device, under this device's own signature: the
          // sender's certificate is no longer load-bearing for it.
          selfNotarized: true,
        });
      }
      recovered.push({ domain: scope.domain, scopeId: scope.scopeId, epoch: scope.epoch });
    }

    // 17. Every other device is superseded by this recovery. That reason
    // requires rotation, which is what steps 18-20 then do.
    const superseded: string[] = [];
    const priorDevices = await deps.repository.listDevices(input.userId);
    for (const device of priorDevices) {
      if (device.id === deviceId || device.status === 'REVOKED') continue;
      await revokeDevice(deps, {
        userId: input.userId,
        revokedDeviceId: device.id,
        revokerDeviceId: deviceId,
        reason: 'supersededByRecovery',
        sign: sender.sign,
        recoveryIdentityId: identity.id,
        recoveryVersion: identity.recoveryVersion,
        serverOriginId,
      });
      superseded.push(device.id);
    }

    // 18-21. Rotate every domain this account holds.
    //
    // The couple set comes from the SERVER, not from the caller. A caller-supplied
    // list is a caller-selected subset: omit a couple and the CSK a displaced
    // device still holds is never rotated, while the recovery reports success.
    const coupleIds = await deps.repository.listOwnedCoupleScopeIds();
    const rotated = await rotateAllScopes(deps, {
      userId: input.userId,
      anchor,
      sender,
      recoveryIdentity: { id: identity.id, kemSpki: identity.recKemSpki },
      coupleIds,
      atMs: nowMs,
    });

    // Every discovered couple scope must actually have rotated. `rotateAllScopes`
    // throws on a failed rotation, so this catches the quieter failure: a scope
    // that was skipped rather than attempted.
    const rotatedCouples = new Set(
      rotated.filter((scope) => scope.domain === 'couple').map((scope) => scope.scopeId),
    );
    const missed = coupleIds.filter((id) => !rotatedCouples.has(id));
    if (missed.length > 0) {
      fail(
        'E_RECOVERY_ROTATION_INCOMPLETE',
        `${missed.length} couple scope(s) did not rotate; recovery is not complete`,
      );
    }

    // 22. Only now, and only with the server's agreement. It re-verifies the
    // certificate, the absence of a revocation, and full envelope coverage; a
    // partial recovery cannot reach ACTIVE by asserting that it did.
    await deps.repository.finalizeDeviceProvisioning(deviceId);
    return {
      state: 'ACTIVE',
      deviceId,
      certificateId,
      recoveredScopes: recovered,
      rotatedScopes: rotated,
      supersededDevices: superseded,
    };
  } catch (error) {
    // Fail closed and stay visible. A device that cannot finish provisioning
    // must never be left looking ACTIVE.
    await deps.repository.setDeviceStatus(deviceId, 'PROVISIONING_FAILED').catch(() => {});
    throw error;
  } finally {
    zeroize(recovery.sigPkcs8, recovery.kemPkcs8);
  }
}

/** The certified signing key of whoever wrote an envelope. */
async function verifiedSenderKey(
  envelope: EnvelopeRecord,
  certificates: readonly CertificateRecord[],
  anchor: TrustAnchor,
  atMs: bigint,
): Promise<Uint8Array> {
  const byId = certificatesById(certificates);
  const senderCertificate = byId.get(envelope.senderCertificateId);
  if (!senderCertificate) fail('E_UNKNOWN_SENDER_CERT', 'the envelope names a certificate that is not present');
  const verified = await verifyCertificateChain({
    chain: buildChain(senderCertificate, byId),
    anchor,
    atMs,
  });
  return verified.sigSpki;
}

// ---------------------------------------------------------------------------
// 1A-7b  Second device enrollment
// ---------------------------------------------------------------------------

export type BeginEnrollmentResult = {
  state: 'AWAITING_APPROVAL';
  deviceId: string;
  enrollmentId: string;
  enrollNonce: Uint8Array;
  grantedDomains: number;
};

/**
 * Step 1, on the NEW device: publish its keys and open a single-use enrollment.
 *
 * Nothing here grants the device anything. It has no certificate, so no honest
 * client will wrap a key to it, whatever `devices.status` says.
 */
export async function beginSecondDeviceEnrollment(
  deps: UseCaseDeps,
  input: { userId: string; platform: PlatformName; approverDeviceId?: string },
): Promise<BeginEnrollmentResult> {
  requireEnabled(deps);

  const deviceId = deps.newId();
  const sig = await deps.deviceKeys.generateSigningKey(sigHandleFor(deviceId));
  const kem = await deps.deviceKeys.generateAgreementKey(kemHandleFor(deviceId));

  await deps.repository.insertDevice({
    id: deviceId,
    userId: input.userId,
    sigSpki: sig.publicKeySpki,
    kemSpki: kem.publicKeySpki,
    platform: input.platform,
    assurance: sig.assurance,
    status: 'PENDING',
  });

  const enrollment = await deps.repository.insertEnrollment({
    userId: input.userId,
    newDeviceId: deviceId,
    approverDeviceId: input.approverDeviceId ?? null,
    enrollNonce: randomBytes(32),
    grantedDomains: grantsToMask(grantsForPlatform(input.platform, sig.assurance)),
    expiresAt: new Date(deps.now() + ENROLLMENT_TTL_MS).toISOString(),
  });

  return {
    state: 'AWAITING_APPROVAL',
    deviceId,
    enrollmentId: enrollment.id,
    enrollNonce: enrollment.enrollNonce,
    grantedDomains: enrollment.grantedDomains,
  };
}

type EnrollmentCeremony = {
  transcriptHash: Uint8Array;
  sas: string;
  /** The full 32-byte hash, for the QR path. No SAS truncation. */
  qrPayload: Uint8Array;
  tbs: Uint8Array;
  grantedDomains: KeyDomainName[];
};

/**
 * Rebuild the enrollment ceremony from server state.
 *
 * BOTH devices call this and must arrive at identical bytes. That is the entire
 * mechanism: if the server shows the two sides different facts — a different
 * approver key, a different recovery root, a different grant mask — the
 * transcripts differ, the SAS values differ, and the humans see it.
 *
 * The certificate body is derived here too, so the subject can produce its proof
 * of possession without waiting for the approver to send one over: every field
 * is a function of state both sides already fetched.
 */
async function buildEnrollmentCeremony(
  deps: UseCaseDeps,
  input: {
    userId: string;
    enrollNonce: Uint8Array;
    approverDeviceId: string;
  },
): Promise<EnrollmentCeremony & { enrollmentId: string; newDeviceId: string }> {
  const enrollment = await deps.repository.getEnrollmentByNonce(input.enrollNonce);
  if (!enrollment) fail('E_UNKNOWN_ENROLLMENT', 'no enrollment matches that nonce');
  if (enrollment.userId !== input.userId) fail('E_WRONG_ACCOUNT', 'the enrollment belongs to another account');
  if (enrollment.consumedAt) fail('E_NONCE_ALREADY_USED', 'this enrollment nonce has already been spent');
  if (Date.parse(enrollment.expiresAt) <= deps.now()) fail('E_NONCE_EXPIRED', 'this enrollment has expired');

  const identity = await deps.repository.getRecoveryIdentity(input.userId);
  if (!identity) fail('E_RECOVERY_IDENTITY_MISSING', 'the account has no recovery identity');

  const newDevice = await deps.repository.getDevice(enrollment.newDeviceId);
  if (!newDevice) fail('E_UNKNOWN_DEVICE', 'the enrolling device row is gone');
  const approverDevice = await deps.repository.getDevice(input.approverDeviceId);
  if (!approverDevice) fail('E_UNKNOWN_APPROVER', 'no such approving device');

  const certificates = await deps.repository.listCertificates(input.userId);
  const approverCertificate = certificates.find((c) => c.subjectDeviceId === input.approverDeviceId);
  if (!approverCertificate) fail('E_APPROVER_UNCERTIFIED', 'the approving device has no certificate');

  const revocations = await deps.repository.listRevocations(input.userId);
  const logHead = revocations.length > 0
    ? revocations[revocations.length - 1].logHead
    : await revocationLogGenesis(uuidToBytes(input.userId), uuidToBytes(identity.id));

  const userIdBytes = uuidToBytes(input.userId);
  const serverOriginId = await deps.repository.serverOriginId();
  const rootRecSigFp = await publicKeyFingerprint(identity.recSigSpki);
  // The STORED timestamps. Deriving `issuedAt` as `expiresAt - TTL` agreed with
  // the Edge Function's reconstruction only until somebody changed the TTL
  // constant on one side, and the failure would have looked like a bad
  // signature rather than a clock disagreement.
  const issuedAtMs = BigInt(Date.parse(enrollment.createdAt));
  const expiresAtMs = BigInt(Date.parse(enrollment.expiresAt));
  if (!Number.isFinite(Number(issuedAtMs)) || !Number.isFinite(Number(expiresAtMs))) {
    fail('E_MALFORMED_ENROLLMENT', 'the enrollment carries an unparsable timestamp');
  }

  // Grants are the intersection of what the enrollment asked for and what the
  // approver's own certificate holds. A device cannot grant what it lacks, and
  // the chain verifier refuses escalation independently.
  const requestedMask = enrollment.grantedDomains;
  const approverBody = decodeTbs(splitCertificate(approverCertificate.certificate).tbs);
  const grantedMask = requestedMask & grantsToMask(approverBody.grantedDomains);
  if (grantedMask === 0) fail('E_NO_GRANTS', 'the approver can grant this device nothing');

  const transcriptHash = await enrollmentTranscriptHash({
    userId: userIdBytes,
    serverOriginId,
    oldDeviceId: uuidToBytes(input.approverDeviceId),
    oldSigFp: await publicKeyFingerprint(approverCertificate.subjectSigSpki),
    oldKemFp: await publicKeyFingerprint(approverCertificate.subjectKemSpki),
    newDeviceId: uuidToBytes(enrollment.newDeviceId),
    newSigFp: await publicKeyFingerprint(newDevice.sigSpki),
    newKemFp: await publicKeyFingerprint(newDevice.kemSpki),
    recoveryIdentityId: uuidToBytes(identity.id),
    recoveryVersion: identity.recoveryVersion,
    rootRecSigPubFp: rootRecSigFp,
    recoveryBundleFp: identity.recoveryBundleFp,
    revocationLogHead: logHead,
    issuerCertFp: approverCertificate.certificateFp,
    grantedDomainsMask: grantedMask,
    enrollNonce: enrollment.enrollNonce,
    issuedAtMs,
    expiresAtMs,
  });

  const tbs = encodeTbs({
    issuerKind: ISSUER_KIND.device,
    subjectAssurance: newDevice.assurance,
    subjectPlatform: newDevice.platform,
    grantedDomains: maskToGrants(grantedMask),
    userId: userIdBytes,
    serverOriginId,
    recoveryIdentityId: uuidToBytes(identity.id),
    recoveryVersion: identity.recoveryVersion,
    rootRecSigPubFp: rootRecSigFp,
    issuerId: uuidToBytes(input.approverDeviceId),
    issuerSigPubFp: await publicKeyFingerprint(approverCertificate.subjectSigSpki),
    subjectDeviceId: uuidToBytes(enrollment.newDeviceId),
    subjectSigPubFp: await publicKeyFingerprint(newDevice.sigSpki),
    subjectKemPubFp: await publicKeyFingerprint(newDevice.kemSpki),
    notBeforeMs: 0n,
    notAfterMs: 0n,
    ceremonyNonce: enrollment.enrollNonce,
    ceremonyTranscriptHash: transcriptHash,
  });

  return {
    enrollmentId: enrollment.id,
    newDeviceId: enrollment.newDeviceId,
    transcriptHash,
    sas: await deriveSas('enroll', transcriptHash),
    qrPayload: transcriptHash,
    tbs,
    grantedDomains: maskToGrants(grantedMask),
  };
}

/**
 * Step 2, on the NEW device: derive the SAS and produce proof of possession.
 *
 * The PoP is over the certificate body the approver will sign, which this device
 * reconstructs itself rather than being sent — an issuer that could choose the
 * body AFTER seeing the PoP could certify a key the subject never held.
 */
export async function confirmSecondDeviceEnrollment(
  deps: UseCaseDeps,
  input: { userId: string; enrollNonce: Uint8Array; approverDeviceId: string },
): Promise<{ state: 'AWAITING_APPROVAL'; sas: string; qrPayload: Uint8Array; transcriptHash: Uint8Array; subjectPop: Uint8Array }> {
  requireEnabled(deps);
  const ceremony = await buildEnrollmentCeremony(deps, input);
  const subjectPop = await deps.deviceKeys.sign(
    sigHandleFor(ceremony.newDeviceId), certificatePopMessage(ceremony.tbs),
  );
  return {
    state: 'AWAITING_APPROVAL',
    sas: ceremony.sas,
    qrPayload: ceremony.qrPayload,
    transcriptHash: ceremony.transcriptHash,
    subjectPop,
  };
}

/**
 * Step 2b, on the NEW device: the human said the two SAS strings match.
 *
 * This is where the new device is allowed to pin the account's recovery root,
 * and it is the ONLY thing that entitles it to. Until a human compared six
 * groups of digits, the root the server served is a claim; after, it is the same
 * root the other device already trusted, because a fork would have produced two
 * different SAS values on two screens.
 */
export async function acceptEnrollmentSas(
  deps: UseCaseDeps,
  input: {
    userId: string;
    enrollNonce: Uint8Array;
    approverDeviceId: string;
    humanConfirmedSas: boolean;
  },
): Promise<{ pinned: true }> {
  requireEnabled(deps);
  if (!input.humanConfirmedSas) fail('E_SAS_NOT_CONFIRMED', 'the SAS comparison was not confirmed by a human');

  // Rebuilt, so the pin is against the same facts the displayed SAS covered.
  await buildEnrollmentCeremony(deps, input);

  const identity = await deps.repository.getRecoveryIdentity(input.userId);
  if (!identity) fail('E_RECOVERY_IDENTITY_MISSING', 'the account has no recovery identity');
  const bundleSigOk = await ecdsaVerify(
    identity.recSigSpki, recoveryBundleSignedMessage(identity.recoveryBundleFp), identity.bundleSig,
  );
  if (!bundleSigOk) fail('E_BUNDLE_SIG_INVALID', 'the served recovery bundle signature does not verify');

  await deps.localState.pinTrustAnchor(input.userId, {
    rootRecSigPubFp: await publicKeyFingerprint(identity.recSigSpki),
    rootRecSigSpki: identity.recSigSpki,
    recoveryIdentityId: identity.id,
    recoveryVersion: identity.recoveryVersion,
  });
  return { pinned: true };
}

/**
 * Step 3, on the APPROVING device: after a human says the two SAS strings match.
 *
 * `humanConfirmedSas` is not decoration. There is no auto-accept anywhere in
 * this flow, and a caller that passes `false` gets nothing — the comparison is
 * the only thing standing between an enrollment and a server that forked the
 * transcript.
 */
export async function approveSecondDeviceEnrollment(
  deps: UseCaseDeps,
  input: {
    userId: string;
    enrollNonce: Uint8Array;
    approverDeviceId: string;
    subjectPop: Uint8Array;
    humanConfirmedSas: boolean;
  },
): Promise<{ state: 'APPROVED'; deviceId: string; transcriptHash: Uint8Array }> {
  requireEnabled(deps);
  if (!input.humanConfirmedSas) fail('E_SAS_NOT_CONFIRMED', 'the SAS comparison was not confirmed by a human');

  const anchor = await pinnedAnchor(deps, input.userId);
  const nowMs = BigInt(deps.now());
  const revocations = await loadRevocationSet(deps.repository, input.userId, anchor, nowMs);

  // The approver must itself be certified, right now, under the pinned root.
  const approver = await verifyDeviceById(deps.repository, {
    userId: input.userId,
    deviceId: input.approverDeviceId,
    anchor,
    atMs: nowMs,
    revocations,
  });

  // Rebuilt independently on this side. If the server showed the two devices
  // different facts, this hash differs from the one the new device displayed.
  const ceremony = await buildEnrollmentCeremony(deps, input);

  const newDevice = await deps.repository.getDevice(ceremony.newDeviceId);
  if (!newDevice) fail('E_UNKNOWN_DEVICE', 'the enrolling device row is gone');

  // Subject proof of possession, checked before anything is signed.
  const popOk = await ecdsaVerify(newDevice.sigSpki, certificatePopMessage(ceremony.tbs), input.subjectPop);
  if (!popOk) fail('E_BAD_POP', 'the enrolling device did not prove possession of its signing key');

  const certificate = assembleCertificate(
    ceremony.tbs,
    await deps.deviceKeys.sign(sigHandleFor(input.approverDeviceId), certificateSignedMessage(ceremony.tbs)),
    input.subjectPop,
  );
  const approvalSignature = await deps.deviceKeys.sign(
    sigHandleFor(input.approverDeviceId),
    concat(utf8('gomsinlog/enroll-approve/v1'), ceremony.transcriptHash),
  );

  await deps.repository.setEnrollmentApprover(ceremony.enrollmentId, input.approverDeviceId);

  // The Edge Function burns the nonce, persists the certificate and moves the
  // operational status in ONE transaction. A replay finds the nonce spent.
  // The server rebuilds the canonical transcript from its own state and derives
  // the hash itself; this call carries the enrollment id and the signed evidence
  // and nothing the caller could steer.
  const approved = await deps.repository.approveDeviceEnrollment({
    enrollmentId: ceremony.enrollmentId,
    certificate,
    approvalSignature,
  });
  if (approved.deviceId !== ceremony.newDeviceId) {
    fail('E_APPROVAL_WRONG_DEVICE', 'the server activated a different device');
  }
  // Referenced so the approver's verified identity is not merely computed and
  // dropped: the certificate above is signed by exactly this key.
  if (!equalBytes(approver.verified.sigSpki, approver.certificate.subjectSigSpki)) {
    fail('E_APPROVER_KEY_MISMATCH', 'the approver certificate does not commit to its signing key');
  }

  return { state: 'APPROVED', deviceId: ceremony.newDeviceId, transcriptHash: ceremony.transcriptHash };
}

/**
 * Step 4, on the APPROVING device: hand over the scope keys.
 *
 * Separate from approval on purpose. A certificate makes a device trustable; it
 * does not make it able to read anything. Until this runs, the new device holds
 * no envelope for any scope and can decrypt nothing.
 */
export async function completeSecondDeviceProvisioning(
  deps: UseCaseDeps,
  input: {
    userId: string;
    newDeviceId: string;
    provisioningDeviceId: string;
  },
): Promise<{ state: 'PROVISIONED'; provisioned: { domain: KeyDomainName; scopeKeyId: string; epoch: bigint }[] }> {
  requireEnabled(deps);

  const anchor = await pinnedAnchor(deps, input.userId);
  const nowMs = BigInt(deps.now());
  const revocations = await loadRevocationSet(deps.repository, input.userId, anchor, nowMs);
  const certificates = await deps.repository.listCertificates(input.userId);

  const provisioner = await verifyDeviceById(deps.repository, {
    userId: input.userId, deviceId: input.provisioningDeviceId, anchor, atMs: nowMs, revocations,
  });
  // Verified HERE, from its certificate chain — not because a caller said so and
  // not because a `devices` row says ACTIVE.
  const target = await verifyDeviceById(deps.repository, {
    userId: input.userId, deviceId: input.newDeviceId, anchor, atMs: nowMs, revocations,
  });

  const identity = await deps.repository.getRecoveryIdentity(input.userId);
  if (!identity) fail('E_RECOVERY_IDENTITY_MISSING', 'the account has no recovery identity');

  const kemHandle = kemHandleFor(input.provisioningDeviceId);
  const provisioned: { domain: KeyDomainName; scopeKeyId: string; epoch: bigint }[] = [];

  const scopes: { domain: KeyDomainName; scopeId: string }[] = [
    { domain: 'personal', scopeId: input.userId },
    { domain: 'health', scopeId: input.userId },
  ];
  // Server-discovered, so a caller cannot omit the couple scope and leave the new
  // device unable to read shared content while still reporting PROVISIONED.
  for (const coupleId of await deps.repository.listOwnedCoupleScopeIds()) {
    scopes.push({ domain: 'couple', scopeId: coupleId });
  }

  for (const { domain, scopeId } of scopes) {
    if (!target.verified.grantedDomains.includes(domain)) continue;
    const keys = await deps.repository.listScopeKeys(domain, scopeId);
    const active = keys.find((key) => key.state === 'ACTIVE');
    if (!active) continue;

    const envelopes = await deps.repository.listEnvelopes(active.id);
    // Replay-safe: an already-provisioned recipient is left exactly as it is.
    if (envelopes.some((e) => e.recipientKind === 'device' && e.recipientId === input.newDeviceId)) {
      provisioned.push({ domain, scopeKeyId: active.id, epoch: active.epoch });
      continue;
    }
    const own = envelopes.find((e) => e.recipientKind === 'device' && e.recipientId === input.provisioningDeviceId);
    if (!own) fail('E_NO_OWN_ENVELOPE', `this device holds no ${domain} envelope to hand on`);

    const rewrapped = await provisionScopeKeyToRecipient({
      ownEnvelope: own.envelope,
      ownKemSpki: provisioner.verified.kemSpki,
      ownEnvelopeSenderSigSpki: await verifiedSenderKey(own, certificates, anchor, nowMs),
      deriveSecret: (peer) => deps.deviceKeys.deriveSecret(kemHandle, peer),
      recipientKemSpki: target.verified.kemSpki,
      recipientId: target.verified.deviceId,
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: uuidToBytes(input.provisioningDeviceId),
      senderSigSpki: provisioner.verified.sigSpki,
      sign: (message) => deps.deviceKeys.sign(sigHandleFor(input.provisioningDeviceId), message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: {
        domain: domainCode(domain),
        scopeKeyId: uuidToBytes(active.id),
        ownerUserId: active.ownerUserId ? uuidToBytes(active.ownerUserId) : uuidToBytes(input.userId),
        scopeId: uuidToBytes(active.scopeId),
        epoch: active.epoch,
      },
      nowMs,
    });

    await deps.repository.insertEnvelope({
      scopeKeyId: active.id,
      recipientKind: 'device',
      recipientId: input.newDeviceId,
      senderDeviceId: input.provisioningDeviceId,
      senderCertificateId: provisioner.certificate.id,
      envelope: rewrapped,
    });

    // The account's own recovery identity must hold every live epoch, or a later
    // kit recovery silently cannot reach this scope.
    if (!envelopes.some((e) => e.recipientKind === 'recovery_identity' && e.recipientId === identity.id)) {
      const forRecovery = await provisionScopeKeyToRecipient({
        ownEnvelope: own.envelope,
        ownKemSpki: provisioner.verified.kemSpki,
        ownEnvelopeSenderSigSpki: await verifiedSenderKey(own, certificates, anchor, nowMs),
        deriveSecret: (peer) => deps.deviceKeys.deriveSecret(kemHandle, peer),
        recipientKemSpki: identity.recKemSpki,
        recipientId: uuidToBytes(identity.id),
        recipientKind: RECIPIENT_KIND.recoveryIdentity,
        senderDeviceId: uuidToBytes(input.provisioningDeviceId),
        senderSigSpki: provisioner.verified.sigSpki,
        sign: (message) => deps.deviceKeys.sign(sigHandleFor(input.provisioningDeviceId), message),
        makeEphemeral: (peer) => generateEphemeralAgreement(peer),
        header: {
          domain: domainCode(domain),
          scopeKeyId: uuidToBytes(active.id),
          ownerUserId: active.ownerUserId ? uuidToBytes(active.ownerUserId) : uuidToBytes(input.userId),
          scopeId: uuidToBytes(active.scopeId),
          epoch: active.epoch,
        },
        nowMs,
      });
      await deps.repository.insertEnvelope({
        scopeKeyId: active.id,
        recipientKind: 'recovery_identity',
        recipientId: identity.id,
        senderDeviceId: input.provisioningDeviceId,
        senderCertificateId: provisioner.certificate.id,
        envelope: forRecovery,
      });
    }

    provisioned.push({ domain, scopeKeyId: active.id, epoch: active.epoch });
  }

  return { state: 'PROVISIONED', provisioned };
}

/**
 * Step 5, on the NEWLY provisioned device: re-wrap its own envelopes.
 *
 * After this the sender's certificate is no longer needed to verify them, which
 * is what lets the issuing device's certificate be retired later without
 * stranding anything.
 */
export async function selfNotarizeOwnEnvelopes(
  deps: UseCaseDeps,
  input: { userId: string; deviceId: string },
): Promise<{ notarized: number }> {
  requireEnabled(deps);

  const anchor = await pinnedAnchor(deps, input.userId);
  const nowMs = BigInt(deps.now());
  const revocations = await loadRevocationSet(deps.repository, input.userId, anchor, nowMs);
  const self = await verifyDeviceById(deps.repository, {
    userId: input.userId, deviceId: input.deviceId, anchor, atMs: nowMs, revocations,
  });
  const certificates = await deps.repository.listCertificates(input.userId);
  const envelopes = await deps.repository.listEnvelopesForDevice(input.deviceId);

  let notarized = 0;
  for (const envelope of envelopes) {
    if (envelope.selfNotarized) continue;
    const scope = await deps.repository.getScopeKey(envelope.scopeKeyId);
    if (!scope || scope.state === 'RETIRED' || scope.state === 'ABANDONED') continue;

    const rewrapped = await provisionScopeKeyToRecipient({
      ownEnvelope: envelope.envelope,
      ownKemSpki: self.verified.kemSpki,
      ownEnvelopeSenderSigSpki: await verifiedSenderKey(envelope, certificates, anchor, nowMs),
      deriveSecret: (peer) => deps.deviceKeys.deriveSecret(kemHandleFor(input.deviceId), peer),
      recipientKemSpki: self.verified.kemSpki,
      recipientId: self.verified.deviceId,
      recipientKind: RECIPIENT_KIND.device,
      senderDeviceId: uuidToBytes(input.deviceId),
      senderSigSpki: self.verified.sigSpki,
      sign: (message) => deps.deviceKeys.sign(sigHandleFor(input.deviceId), message),
      makeEphemeral: (peer) => generateEphemeralAgreement(peer),
      header: {
        domain: domainCode(scope.domain),
        scopeKeyId: uuidToBytes(scope.id),
        ownerUserId: scope.ownerUserId ? uuidToBytes(scope.ownerUserId) : uuidToBytes(input.userId),
        scopeId: uuidToBytes(scope.scopeId),
        epoch: scope.epoch,
      },
      nowMs,
    });
    await deps.repository.selfNotarizeEnvelope({
      scopeKeyId: scope.id,
      recipientDeviceId: input.deviceId,
      envelope: rewrapped,
      senderCertificateId: self.certificate.id,
      senderDeviceId: input.deviceId,
    });
    notarized += 1;
  }
  return { notarized };
}

// ---------------------------------------------------------------------------
// 1A-8  Couple pairing
// ---------------------------------------------------------------------------

export type PairingConfirmationInput = {
  /** A device id. NOT a `VerifiedDevice` — trust is derived here. */
  deviceId: string;
  signature: Uint8Array;
};

/**
 * Create the couple key, but only after both sides confirmed one transcript.
 *
 * Recipients are resolved by certificate chain on BOTH sides, and the new epoch
 * carries an envelope for every certified device of both members AND for each
 * member's recovery identity. Omitting the recovery recipients is not a missing
 * nicety: it means the first partner to lose every device loses the couple's
 * shared history permanently, with a kit in their hand that opens nothing.
 *
 * The partner's anchor is not taken on faith. It is loaded from the server and
 * then checked against the anchor fields the confirmed transcript already
 * committed to, so a server that swaps a recovery root after the humans compared
 * their SAS gets a mismatch rather than an envelope.
 */
export async function completeCouplePairing(
  deps: UseCaseDeps,
  input: {
    coupleId: string;
    ownUserId: string;
    partnerUserId: string;
    /** The hash both humans confirmed. */
    transcriptHash: Uint8Array;
    /** The two sides as they appeared in that confirmed transcript. */
    ownSide: PairingSide;
    partnerSide: PairingSide;
    ownConfirmation: PairingConfirmationInput;
    partnerConfirmation: PairingConfirmationInput;
    senderDeviceId: string;
    expiresAtMs: bigint;
  },
): Promise<{ scopeKeyId: string; epoch: bigint; recipients: { devices: number; recoveryIdentities: number } }> {
  requireEnabled(deps);
  const nowMs = BigInt(deps.now());

  const ownAnchor = await pinnedAnchor(deps, input.ownUserId);
  if (!equalBytes(ownAnchor.rootRecSigPubFp, input.ownSide.rootRecSigPubFp)) {
    fail('E_OWN_ANCHOR_MISMATCH', 'the confirmed transcript names a different root for this account');
  }

  // The partner's public anchor, loaded and then PINNED against the transcript
  // the two humans actually confirmed.
  const partnerAnchorRow = await deps.repository.getPartnerRecoveryAnchor();
  if (!partnerAnchorRow) fail('E_NO_PARTNER_ANCHOR', 'the partner has no published recovery anchor');
  const partnerRootFp = await publicKeyFingerprint(partnerAnchorRow.recSigSpki);
  if (!equalBytes(partnerRootFp, input.partnerSide.rootRecSigPubFp)) {
    fail('E_PARTNER_ANCHOR_MISMATCH', 'the served partner root is not the confirmed one');
  }
  if (!equalBytes(partnerAnchorRow.recoveryBundleFp, input.partnerSide.recoveryBundleFp)) {
    fail('E_PARTNER_BUNDLE_MISMATCH', 'the served partner bundle is not the confirmed one');
  }
  if (partnerAnchorRow.recoveryVersion !== input.partnerSide.recoveryVersion) {
    fail('E_PARTNER_VERSION_MISMATCH', 'the served partner recovery generation is not the confirmed one');
  }
  const partnerAnchor = await anchorFromPin({
    userId: input.partnerUserId,
    serverOriginId: ownAnchor.serverOriginId,
    rootRecSigSpki: partnerAnchorRow.recSigSpki,
    recoveryIdentityId: partnerAnchorRow.recoveryIdentityId,
    recoveryVersion: partnerAnchorRow.recoveryVersion,
  });

  // Both revocation sets come from persisted signed statements.
  const ownRevocations = await loadRevocationSet(deps.repository, input.ownUserId, ownAnchor, nowMs);
  const partnerRevocations = await loadRevocationSet(
    deps.repository, input.partnerUserId, partnerAnchor, nowMs,
  );

  const ownDevices = await resolveTrustedDevices(deps.repository, {
    userId: input.ownUserId, anchor: ownAnchor, domain: 'couple', atMs: nowMs, revocations: ownRevocations,
  });
  const partnerDevices = await resolveTrustedDevices(deps.repository, {
    userId: input.partnerUserId,
    anchor: partnerAnchor,
    domain: 'couple',
    atMs: nowMs,
    revocations: partnerRevocations,
  });

  // The two confirmations are bound to devices verified HERE. A caller naming a
  // device id it does not control gets a signature failure, not a key.
  const ownConfirming = ownDevices.find((d) => d.certificate.subjectDeviceId === input.ownConfirmation.deviceId);
  const partnerConfirming = partnerDevices.find(
    (d) => d.certificate.subjectDeviceId === input.partnerConfirmation.deviceId,
  );
  if (!ownConfirming) fail('E_CONFIRMING_DEVICE_UNTRUSTED', 'the confirming device on this side is not certified');
  if (!partnerConfirming) {
    fail('E_CONFIRMING_DEVICE_UNTRUSTED', 'the confirming device on the partner side is not certified');
  }

  const ownIsLow = compareUserIds(input.ownSide.userId, input.partnerSide.userId) < 0;
  const lowConfirmation: Confirmation = {
    device: (ownIsLow ? ownConfirming : partnerConfirming).verified,
    signature: ownIsLow ? input.ownConfirmation.signature : input.partnerConfirmation.signature,
  };
  const highConfirmation: Confirmation = {
    device: (ownIsLow ? partnerConfirming : ownConfirming).verified,
    signature: ownIsLow ? input.partnerConfirmation.signature : input.ownConfirmation.signature,
  };

  const gate = await canCreateCoupleKey({
    transcriptHash: input.transcriptHash,
    lowConfirmation,
    highConfirmation,
    lowVerifiedDevices: (ownIsLow ? ownDevices : partnerDevices).map((d) => d.verified),
    highVerifiedDevices: (ownIsLow ? partnerDevices : ownDevices).map((d) => d.verified),
    nowMs,
    expiresAtMs: input.expiresAtMs,
    revocations: ownIsLow ? ownRevocations : partnerRevocations,
  });
  // No CSK before CONFIRMED_BOTH. This is the whole point of the flow.
  if (!gate.allowed) fail('E_PAIRING_NOT_CONFIRMED', gate.reason ?? 'pairing is not confirmed');

  const ownIdentity = await deps.repository.getRecoveryIdentity(input.ownUserId);
  if (!ownIdentity) fail('E_RECOVERY_IDENTITY_MISSING', 'this account has no recovery identity');

  const sender = ownDevices.find((d) => d.certificate.subjectDeviceId === input.senderDeviceId);
  if (!sender) fail('E_SENDER_UNTRUSTED', 'the sending device is not certified for the couple domain');

  const recipients: EpochRecipients = {
    devices: [...ownDevices, ...partnerDevices].map((d) => ({
      deviceId: bytesToUuid(d.verified.deviceId),
      kemSpki: d.verified.kemSpki,
    })),
    recoveryIdentities: [
      { id: ownIdentity.id, kemSpki: ownIdentity.recKemSpki },
      { id: partnerAnchorRow.recoveryIdentityId, kemSpki: partnerAnchorRow.recKemSpki },
    ],
  };

  const scopeKey = generateScopeKeyBytes();
  let created: ScopeKeyRecord;
  try {
    created = await createEpoch(deps, {
      domain: 'couple',
      scopeId: input.coupleId,
      ownerUserId: null,
      ownerCoupleId: input.coupleId,
      // The low-ordered member, so both sides build identical header bytes.
      ownerUserIdBytes: ownIsLow ? input.ownSide.userId : input.partnerSide.userId,
      scopeKey,
      recipients,
      sender: {
        deviceId: input.senderDeviceId,
        sigSpki: sender.verified.sigSpki,
        certificateId: sender.certificate.id,
        sign: (message) => deps.deviceKeys.sign(sigHandleFor(input.senderDeviceId), message),
      },
    });
  } finally {
    zeroize(scopeKey);
  }

  // Pin the partner's anchor now that a human confirmed it. A later rotation of
  // the couple key needs a root for the partner's devices, and this — not a
  // fresh server answer — is where it comes from.
  await deps.localState.pinTrustAnchor(input.partnerUserId, {
    rootRecSigPubFp: partnerRootFp,
    rootRecSigSpki: partnerAnchorRow.recSigSpki,
    recoveryIdentityId: partnerAnchorRow.recoveryIdentityId,
    recoveryVersion: partnerAnchorRow.recoveryVersion,
  });

  const pairing = await deps.repository.getPairing(input.coupleId);
  if (pairing) await deps.repository.setPairingState(pairing.id, 'CRYPTO_ACTIVE');

  return {
    scopeKeyId: created.id,
    epoch: created.epoch,
    recipients: {
      devices: recipients.devices.length,
      recoveryIdentities: recipients.recoveryIdentities.length,
    },
  };
}

function compareUserIds(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 16; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ---------------------------------------------------------------------------
// 1A-9  Partner-assisted recovery — COUPLE ONLY, by construction
// ---------------------------------------------------------------------------

/**
 * Re-wrap the current couple key to a partner's replacement device.
 *
 * There is deliberately no `domain` parameter and no generic `recover(domain)`
 * anywhere in this module. The only scope this function can reach is the couple
 * key it looks up itself, so personal and health are unreachable by construction
 * rather than by a runtime check — and the database refuses a personal or health
 * envelope for another user's device regardless.
 *
 * Nothing trusted crosses the boundary. The caller names a device id and hands
 * over a transcript and a signature; this function loads the certificate, walks
 * the issuer chain to the partner's pinned recovery root, checks the persisted
 * revocations, rebuilds the transcript from server state and its own verified
 * view, checks freshness, and only then checks the SAS confirmation signature
 * under the key the certificate commits to.
 */
export async function partnerAssistRecoverCouple(
  deps: UseCaseDeps,
  input: {
    coupleId: string;
    ownUserId: string;
    partnerUserId: string;
    /** Raw id. Verified inside this call, every time. */
    targetDeviceId: string;
    assistingDeviceId: string;
    /** The 32-byte nonce that made this ceremony unique. */
    assistNonce: Uint8Array;
    issuedAtMs: bigint;
    expiresAtMs: bigint;
    /** Signed by the TARGET device over the transcript both humans compared. */
    targetSasConfirmation: Uint8Array;
    /** The assisting human's own comparison. No auto-accept. */
    humanConfirmedSas: boolean;
  },
): Promise<{ scopeKeyId: string; epoch: bigint; sas: string }> {
  requireEnabled(deps);
  if (!input.humanConfirmedSas) fail('E_SAS_NOT_CONFIRMED', 'the SAS comparison was not confirmed by a human');

  const nowMs = BigInt(deps.now());
  if (input.expiresAtMs <= nowMs) fail('E_ASSIST_EXPIRED', 'the partner-assist ceremony has expired');
  if (input.expiresAtMs - input.issuedAtMs > BigInt(PARTNER_ASSIST_TTL_MS)) {
    fail('E_ASSIST_TTL_TOO_LONG', 'the partner-assist window is longer than the protocol allows');
  }

  // CSK only. Resolved here, from the couple id, with no domain input anywhere.
  const keys = await deps.repository.listScopeKeys('couple', input.coupleId);
  const active = keys.find((key) => key.state === 'ACTIVE');
  if (!active) fail('E_NO_ACTIVE_COUPLE_KEY', 'there is no active couple key to share');

  const ownAnchor = await pinnedAnchor(deps, input.ownUserId);
  const partnerAnchor = await pinnedAnchor(deps, input.partnerUserId);
  const ownRevocations = await loadRevocationSet(deps.repository, input.ownUserId, ownAnchor, nowMs);
  const partnerRevocations = await loadRevocationSet(
    deps.repository, input.partnerUserId, partnerAnchor, nowMs,
  );

  const assisting = await verifyDeviceById(deps.repository, {
    userId: input.ownUserId,
    deviceId: input.assistingDeviceId,
    anchor: ownAnchor,
    domain: 'couple',
    atMs: nowMs,
    revocations: ownRevocations,
  });
  // Certificate, issuer chain, pinned recovery root, revocation state and
  // granted domain — all checked here, on raw ids, inside the trusted operation.
  const target = await verifyDeviceById(deps.repository, {
    userId: input.partnerUserId,
    deviceId: input.targetDeviceId,
    anchor: partnerAnchor,
    domain: 'couple',
    atMs: nowMs,
    revocations: partnerRevocations,
  });

  const transcript: PartnerAssistTranscript = {
    coupleId: uuidToBytes(input.coupleId),
    serverOriginId: ownAnchor.serverOriginId,
    assistingUserId: uuidToBytes(input.ownUserId),
    assistingDeviceId: uuidToBytes(input.assistingDeviceId),
    targetUserId: uuidToBytes(input.partnerUserId),
    targetDeviceId: uuidToBytes(input.targetDeviceId),
    targetSigFp: await publicKeyFingerprint(target.verified.sigSpki),
    targetKemFp: await publicKeyFingerprint(target.verified.kemSpki),
    targetCertFp: target.certificate.certificateFp,
    scopeKeyId: uuidToBytes(active.id),
    epoch: active.epoch,
    assistNonce: input.assistNonce,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
  };
  const transcriptHash = await partnerAssistTranscriptHash(transcript);

  const confirmationOk = await ecdsaVerify(
    target.verified.sigSpki,
    partnerAssistConfirmMessage(transcriptHash, target.verified.deviceId),
    input.targetSasConfirmation,
  );
  if (!confirmationOk) fail('E_BAD_ASSIST_CONFIRMATION', 'the target device did not confirm this ceremony');

  const envelopes = await deps.repository.listEnvelopes(active.id);
  const own = envelopes.find(
    (e) => e.recipientKind === 'device' && e.recipientId === input.assistingDeviceId,
  );
  if (!own) fail('E_NO_OWN_ENVELOPE', 'this device holds no couple envelope to hand on');
  if (envelopes.some((e) => e.recipientKind === 'device' && e.recipientId === input.targetDeviceId)) {
    return { scopeKeyId: active.id, epoch: active.epoch, sas: await deriveSas('partner-assist', transcriptHash) };
  }

  const certificates = await deps.repository.listCertificates(input.ownUserId);
  const rewrapped = await provisionScopeKeyToRecipient({
    ownEnvelope: own.envelope,
    ownKemSpki: assisting.verified.kemSpki,
    ownEnvelopeSenderSigSpki: await verifiedSenderKey(own, certificates, ownAnchor, nowMs),
    deriveSecret: (peer) => deps.deviceKeys.deriveSecret(kemHandleFor(input.assistingDeviceId), peer),
    recipientKemSpki: target.verified.kemSpki,
    recipientId: target.verified.deviceId,
    recipientKind: RECIPIENT_KIND.device,
    senderDeviceId: uuidToBytes(input.assistingDeviceId),
    senderSigSpki: assisting.verified.sigSpki,
    sign: (message) => deps.deviceKeys.sign(sigHandleFor(input.assistingDeviceId), message),
    makeEphemeral: (peer) => generateEphemeralAgreement(peer),
    header: {
      domain: domainCode('couple'),
      scopeKeyId: uuidToBytes(active.id),
      ownerUserId: active.ownerUserId ? uuidToBytes(active.ownerUserId) : uuidToBytes(input.ownUserId),
      scopeId: uuidToBytes(input.coupleId),
      epoch: active.epoch,
    },
    nowMs,
  });

  await deps.repository.insertEnvelope({
    scopeKeyId: active.id,
    recipientKind: 'device',
    recipientId: input.targetDeviceId,
    senderDeviceId: input.assistingDeviceId,
    senderCertificateId: assisting.certificate.id,
    envelope: rewrapped,
  });

  return { scopeKeyId: active.id, epoch: active.epoch, sas: await deriveSas('partner-assist', transcriptHash) };
}

/** The transcript hash and SAS the RECOVERING side must reproduce and sign. */
export async function partnerAssistCeremony(
  deps: UseCaseDeps,
  input: {
    coupleId: string;
    assistingUserId: string;
    assistingDeviceId: string;
    targetUserId: string;
    targetDeviceId: string;
    assistNonce: Uint8Array;
    issuedAtMs: bigint;
    expiresAtMs: bigint;
  },
): Promise<{ transcriptHash: Uint8Array; sas: string }> {
  requireEnabled(deps);
  const nowMs = BigInt(deps.now());
  const keys = await deps.repository.listScopeKeys('couple', input.coupleId);
  const active = keys.find((key) => key.state === 'ACTIVE');
  if (!active) fail('E_NO_ACTIVE_COUPLE_KEY', 'there is no active couple key to share');

  const targetAnchor = await pinnedAnchor(deps, input.targetUserId);
  const revocations = await loadRevocationSet(deps.repository, input.targetUserId, targetAnchor, nowMs);
  const target = await verifyDeviceById(deps.repository, {
    userId: input.targetUserId,
    deviceId: input.targetDeviceId,
    anchor: targetAnchor,
    domain: 'couple',
    atMs: nowMs,
    revocations,
  });
  const ownAnchor = await pinnedAnchor(deps, input.assistingUserId);

  const transcriptHash = await partnerAssistTranscriptHash({
    coupleId: uuidToBytes(input.coupleId),
    serverOriginId: ownAnchor.serverOriginId,
    assistingUserId: uuidToBytes(input.assistingUserId),
    assistingDeviceId: uuidToBytes(input.assistingDeviceId),
    targetUserId: uuidToBytes(input.targetUserId),
    targetDeviceId: uuidToBytes(input.targetDeviceId),
    targetSigFp: await publicKeyFingerprint(target.verified.sigSpki),
    targetKemFp: await publicKeyFingerprint(target.verified.kemSpki),
    targetCertFp: target.certificate.certificateFp,
    scopeKeyId: uuidToBytes(active.id),
    epoch: active.epoch,
    assistNonce: input.assistNonce,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
  });
  return { transcriptHash, sas: await deriveSas('partner-assist', transcriptHash) };
}

// ---------------------------------------------------------------------------
// 1A-10  Revocation and rotation
// ---------------------------------------------------------------------------

/** Append one signed, hash-chained revocation statement. */
async function revokeDevice(
  deps: UseCaseDeps,
  input: {
    userId: string;
    revokedDeviceId: string;
    revokerDeviceId: string;
    reason: RevocationReasonName;
    sign: (message: Uint8Array) => Promise<Uint8Array>;
    recoveryIdentityId: string;
    recoveryVersion: number;
    serverOriginId: Uint8Array;
  },
): Promise<void> {
  const certificates = await deps.repository.listCertificates(input.userId);
  const subject = certificates.find((c) => c.subjectDeviceId === input.revokedDeviceId);
  // The fingerprint comes from the immutable certificate, never from a caller
  // and never from the mutable `devices` row.
  const revokedSigFp = subject
    ? await publicKeyFingerprint(subject.subjectSigSpki)
    : await publicKeyFingerprint(
      (await deps.repository.getDevice(input.revokedDeviceId))?.sigSpki
      ?? fail('E_UNKNOWN_DEVICE', 'no such device'),
    );

  const existing = await deps.repository.listRevocations(input.userId);
  if (existing.some((r) => r.revokedDeviceId === input.revokedDeviceId)) return;

  const sequence = existing.reduce((max, r) => (r.sequence > max ? r.sequence : max), 0n) + 1n;
  const previousHead = existing.length > 0
    ? existing[existing.length - 1].logHead
    : await revocationLogGenesis(uuidToBytes(input.userId), uuidToBytes(input.recoveryIdentityId));

  const revokedAtMs = BigInt(deps.now());
  const tbs = encodeRevocationTbs({
    userId: uuidToBytes(input.userId),
    serverOriginId: input.serverOriginId,
    recoveryIdentityId: uuidToBytes(input.recoveryIdentityId),
    recoveryVersion: input.recoveryVersion,
    revokedDeviceId: uuidToBytes(input.revokedDeviceId),
    revokedSubjectSigPubFp: revokedSigFp,
    reason: input.reason,
    revokedAtMs,
    revokerDeviceId: uuidToBytes(input.revokerDeviceId),
    issuedAtMs: revokedAtMs,
    serverNonce: randomBytes(32),
  });

  await deps.repository.appendRevocation({
    userId: input.userId,
    revokedDeviceId: input.revokedDeviceId,
    revokerDeviceId: input.revokerDeviceId,
    reason: input.reason,
    statement: tbs,
    signature: await input.sign(revocationSignedMessage(tbs)),
    revokedAtMs,
    sequence,
    logHead: await revocationLogAppend(previousHead, tbs),
  });
  await deps.repository.setDeviceStatus(input.revokedDeviceId, 'REVOKED');
}

/**
 * Rotate every live scope this account participates in.
 *
 * Used by both revocation and kit recovery. Each rotation is a REAL new epoch:
 * fresh random key, fresh envelopes for the recipients that remain, READY, then
 * ACTIVE — which atomically retires the outgoing epoch inside
 * `e2ee_activate_epoch`. Returning a plan here instead would be the same defect
 * the previous implementation had: a caller can forget to execute a plan, and a
 * key that was supposed to rotate quietly does not.
 */
async function rotateAllScopes(
  deps: UseCaseDeps,
  input: {
    userId: string;
    anchor: TrustAnchor;
    sender: SenderIdentity;
    recoveryIdentity: { id: string; kemSpki: Uint8Array };
    /** Server-discovered. Never a caller-selected subset. */
    coupleIds: string[];
    atMs: bigint;
    /** Restrict to these scopes; omit to rotate every live scope. */
    only?: HeldScope[];
  },
): Promise<{ domain: KeyDomainName; scopeId: string; epoch: bigint }[]> {
  const revocations = await loadRevocationSet(deps.repository, input.userId, input.anchor, input.atMs);
  const rotated: { domain: KeyDomainName; scopeId: string; epoch: bigint }[] = [];

  const wanted = (domain: KeyDomainName, scopeId: string) =>
    !input.only || input.only.some((s) => s.domain === domain && bytesToUuid(s.scopeId) === scopeId);

  for (const domain of ['personal', 'health'] as const) {
    if (!wanted(domain, input.userId)) continue;
    const keys = await deps.repository.listScopeKeys(domain, input.userId);
    if (!keys.some((key) => key.state === 'ACTIVE')) continue;

    const devices = await resolveTrustedDevices(deps.repository, {
      userId: input.userId, anchor: input.anchor, domain, atMs: input.atMs, revocations,
    });
    const scopeKey = generateScopeKeyBytes();
    try {
      const created = await createEpoch(deps, {
        domain,
        scopeId: input.userId,
        ownerUserId: input.userId,
        ownerCoupleId: null,
        ownerUserIdBytes: uuidToBytes(input.userId),
        scopeKey,
        recipients: {
          devices: devices.map((d) => ({
            deviceId: bytesToUuid(d.verified.deviceId),
            kemSpki: d.verified.kemSpki,
          })),
          recoveryIdentities: [input.recoveryIdentity],
        },
        sender: input.sender,
        selfNotarized: true,
      });
      rotated.push({ domain, scopeId: input.userId, epoch: created.epoch });
    } finally {
      zeroize(scopeKey);
    }
  }

  // Every discovered couple scope, in order. A failure throws rather than being
  // collected: a partially rotated account must not read as a success, and the
  // caller decides whether the device may proceed.
  for (const coupleId of input.coupleIds) {
    if (!wanted('couple', coupleId)) continue;
    const keys = await deps.repository.listScopeKeys('couple', coupleId);
    if (!keys.some((key) => key.state === 'ACTIVE')) continue;
    const rotatedCouple = await rotateCoupleScope(deps, {
      coupleId,
      userId: input.userId,
      anchor: input.anchor,
      revocations,
      sender: input.sender,
      recoveryIdentity: input.recoveryIdentity,
      atMs: input.atMs,
    });
    rotated.push(rotatedCouple);
  }
  return rotated;
}

/**
 * Rotate the couple key, keeping BOTH members able to read what comes next.
 *
 * The partner's anchor comes from the pin written when the two humans confirmed
 * the pairing SAS — not from a fresh server answer, which a server could change.
 * Without a pin there is no honest way to decide which of the partner's devices
 * are real, so this fails closed rather than rotating a shared key to whatever
 * the server currently offers.
 */
async function rotateCoupleScope(
  deps: UseCaseDeps,
  input: {
    coupleId: string;
    userId: string;
    anchor: TrustAnchor;
    revocations: RevocationSet;
    sender: SenderIdentity;
    recoveryIdentity: { id: string; kemSpki: Uint8Array };
    atMs: bigint;
  },
): Promise<{ domain: KeyDomainName; scopeId: string; epoch: bigint }> {
  const partnerAnchorRow = await deps.repository.getPartnerRecoveryAnchor();
  if (!partnerAnchorRow) fail('E_NO_PARTNER_ANCHOR', 'the partner has no published recovery anchor');

  const partnerUserId = await partnerUserIdFor(deps, partnerAnchorRow.recoveryIdentityId);
  const pin = await deps.localState.loadTrustAnchor(partnerUserId);
  if (!pin) fail('E_PARTNER_ANCHOR_NOT_PINNED', 'no confirmed pairing anchor for the partner');
  const servedFp = await publicKeyFingerprint(partnerAnchorRow.recSigSpki);
  if (!equalBytes(servedFp, pin.rootRecSigPubFp)) {
    fail('E_PARTNER_ANCHOR_MISMATCH', 'the served partner root is not the confirmed one');
  }

  const partnerAnchor = await anchorFromPin({
    userId: partnerUserId,
    serverOriginId: input.anchor.serverOriginId,
    rootRecSigSpki: pin.rootRecSigSpki,
    recoveryIdentityId: pin.recoveryIdentityId,
    recoveryVersion: pin.recoveryVersion,
  });
  const partnerRevocations = await loadRevocationSet(
    deps.repository, partnerUserId, partnerAnchor, input.atMs,
  );

  const ownDevices = await resolveTrustedDevices(deps.repository, {
    userId: input.userId,
    anchor: input.anchor,
    domain: 'couple',
    atMs: input.atMs,
    revocations: input.revocations,
  });
  const partnerDevices = await resolveTrustedDevices(deps.repository, {
    userId: partnerUserId,
    anchor: partnerAnchor,
    domain: 'couple',
    atMs: input.atMs,
    revocations: partnerRevocations,
  });

  const previous = await deps.repository.listScopeKeys('couple', input.coupleId);
  const previousActive = previous.find((key) => key.state === 'ACTIVE');

  const scopeKey = generateScopeKeyBytes();
  try {
    const created = await createEpoch(deps, {
      domain: 'couple',
      scopeId: input.coupleId,
      ownerUserId: null,
      ownerCoupleId: input.coupleId,
      ownerUserIdBytes: previousActive?.ownerUserId
        ? uuidToBytes(previousActive.ownerUserId)
        : uuidToBytes(input.userId),
      scopeKey,
      recipients: {
        devices: [...ownDevices, ...partnerDevices].map((d) => ({
          deviceId: bytesToUuid(d.verified.deviceId),
          kemSpki: d.verified.kemSpki,
        })),
        recoveryIdentities: [
          input.recoveryIdentity,
          { id: partnerAnchorRow.recoveryIdentityId, kemSpki: partnerAnchorRow.recKemSpki },
        ],
      },
      sender: input.sender,
      selfNotarized: true,
    });
    return { domain: 'couple', scopeId: input.coupleId, epoch: created.epoch };
  } finally {
    zeroize(scopeKey);
  }
}

/** Which account a recovery identity belongs to, from its published anchor. */
async function partnerUserIdFor(deps: UseCaseDeps, recoveryIdentityId: string): Promise<string> {
  const anchor = await deps.repository.getRecoveryAnchorFor(recoveryIdentityId);
  if (!anchor) fail('E_NO_PARTNER_ANCHOR', 'the partner recovery identity has no public anchor row');
  return anchor.userId;
}

export type RevocationOutcome = {
  reason: RevocationReasonName;
  /** The epochs that actually exist now, read back from the server. */
  rotated: { domain: KeyDomainName; scopeId: string; epoch: bigint; scopeKeyId: string }[];
  retired: { domain: KeyDomainName; scopeId: string; epoch: bigint }[];
};

/**
 * Revoke a device and ROTATE every scope it held.
 *
 * This executes. An earlier revision returned a `RevocationPlan` and left
 * execution to the caller, which meant a caller that ignored the return value
 * revoked a device and rotated nothing — the compromised device kept every key
 * it had, and the account looked protected.
 *
 * A lost device defaults to `potentiallyCompromised`. Only an affirmed secure
 * erase on hardware-backed storage produces `lostSecured`, which is the one
 * lost-device outcome that skips rotation.
 */
export async function revokeDeviceAndRotate(
  deps: UseCaseDeps,
  input: {
    userId: string;
    revokedDeviceId: string;
    revokerDeviceId: string;
    userConfirmedSecureErase: boolean;
  },
): Promise<RevocationOutcome> {
  requireEnabled(deps);

  const nowMs = BigInt(deps.now());
  const anchor = await pinnedAnchor(deps, input.userId);
  const serverOriginId = anchor.serverOriginId;

  // 1. The target must be a real device of this account.
  const device = await deps.repository.getDevice(input.revokedDeviceId);
  if (!device) fail('E_UNKNOWN_DEVICE', 'no such device');
  if (device.userId !== input.userId) fail('E_WRONG_ACCOUNT', 'that device belongs to another account');

  const identity = await deps.repository.getRecoveryIdentity(input.userId);
  if (!identity) fail('E_RECOVERY_IDENTITY_MISSING', 'the account has no recovery identity');

  const revocationsBefore = await loadRevocationSet(deps.repository, input.userId, anchor, nowMs);
  const revoker = await verifyDeviceById(deps.repository, {
    userId: input.userId,
    deviceId: input.revokerDeviceId,
    anchor,
    atMs: nowMs,
    revocations: revocationsBefore,
  });

  const reason = classifyLostDevice({
    assurance: device.assurance ?? ASSURANCE.webNonExtractable,
    userConfirmedSecureErase: input.userConfirmedSecureErase,
  });

  // PRE-FLIGHT, before anything is persisted.
  //
  // Revocation is chain-wide: `verifyCertificateChain` refuses a chain that
  // contains a revoked link, so revoking a device ALSO distrusts every device it
  // certified. Rotating in that state would produce an epoch only the recovery
  // kit can open — a lockout dressed up as a security action. Refusing here
  // leaves the account exactly as it was, and the way out is the kit.
  const certificatesNow = await deps.repository.listCertificates(input.userId);
  const byIdNow = certificatesById(certificatesNow);
  const survivors = (await resolveTrustedDevices(deps.repository, {
    userId: input.userId, anchor, domain: 'personal', atMs: nowMs, revocations: revocationsBefore,
  })).filter((entry) => entry.certificate.subjectDeviceId !== input.revokedDeviceId
    && !chainPassesThroughDevice(entry.certificate, byIdNow, input.revokedDeviceId));
  if (survivors.length === 0) {
    fail(
      'E_REVOCATION_WOULD_STRAND_ACCOUNT',
      'revoking this device would leave no device with a valid certificate chain; recover with the kit instead',
    );
  }

  // 4. Everything the target held, from its persisted envelopes.
  const held: HeldScope[] = [];
  const retired: RevocationOutcome['retired'] = [];
  for (const envelope of await deps.repository.listEnvelopesForDevice(input.revokedDeviceId)) {
    const scope = await deps.repository.getScopeKey(envelope.scopeKeyId);
    if (!scope || scope.state !== 'ACTIVE') continue;
    held.push({ domain: scope.domain, scopeId: uuidToBytes(scope.scopeId), epoch: scope.epoch });
    retired.push({ domain: scope.domain, scopeId: scope.scopeId, epoch: scope.epoch });
  }

  // 2-3. The signed statement, persisted. The database refuses a new envelope
  // for a revoked device from this moment on, independently of any client.
  await revokeDevice(deps, {
    userId: input.userId,
    revokedDeviceId: input.revokedDeviceId,
    revokerDeviceId: input.revokerDeviceId,
    reason,
    sign: (message) => deps.deviceKeys.sign(sigHandleFor(input.revokerDeviceId), message),
    recoveryIdentityId: identity.id,
    recoveryVersion: identity.recoveryVersion,
    serverOriginId,
  });

  if (!requiresRotation(reason)) {
    return { reason, rotated: [], retired: [] };
  }

  // 5. Rotate every affected scope, for real. `loadRevocationSet` inside
  // `rotateAllScopes` now sees the statement written above, so the revoked
  // device is not a candidate for any of the new epochs.
  const sender: SenderIdentity = {
    deviceId: input.revokerDeviceId,
    sigSpki: revoker.verified.sigSpki,
    certificateId: revoker.certificate.id,
    sign: (message) => deps.deviceKeys.sign(sigHandleFor(input.revokerDeviceId), message),
  };
  const rotatedScopes = await rotateAllScopes(deps, {
    userId: input.userId,
    anchor,
    sender,
    recoveryIdentity: { id: identity.id, kemSpki: identity.recKemSpki },
    // Server-discovered here too: revoking a device must rotate every couple key
    // it held, and a caller that named none would leave the revoked device with a
    // live shared key.
    coupleIds: await deps.repository.listOwnedCoupleScopeIds(),
    atMs: nowMs,
    only: held.length > 0 ? held : undefined,
  });

  // 6-7. Read back what actually exists rather than reporting what was intended.
  const rotated: RevocationOutcome['rotated'] = [];
  for (const scope of rotatedScopes) {
    const keys = await deps.repository.listScopeKeys(scope.domain, scope.scopeId);
    const active = keys.find((key) => key.state === 'ACTIVE');
    if (!active) fail('E_ROTATION_NOT_ACTIVE', `${scope.domain} did not reach an ACTIVE epoch`);
    rotated.push({
      domain: scope.domain, scopeId: scope.scopeId, epoch: active.epoch, scopeKeyId: active.id,
    });
  }
  return { reason, rotated, retired };
}

/**
 * Devices that may receive a new epoch, resolved by certificate — never status,
 * and never with a revocation set a caller supplied.
 */
export async function eligibleRecipients(
  deps: UseCaseDeps,
  input: { userId: string; domain: KeyDomainName },
): Promise<{ deviceId: string; grantedDomains: KeyDomainName[] }[]> {
  const anchor = await pinnedAnchor(deps, input.userId);
  const atMs = BigInt(deps.now());
  // Loaded and VERIFIED from persisted signed statements, inside this call. A
  // caller cannot pass in an empty set and re-admit a revoked device.
  const revocations = await loadRevocationSet(deps.repository, input.userId, anchor, atMs);
  const resolved = await resolveTrustedDevices(deps.repository, {
    userId: input.userId, anchor, domain: input.domain, atMs, revocations,
  });
  return resolved.map((entry) => ({
    deviceId: bytesToUuid(entry.verified.deviceId),
    grantedDomains: entry.verified.grantedDomains,
  }));
}

export { verifyCertificateChain, requiresRotation };
