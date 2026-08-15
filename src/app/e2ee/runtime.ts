/**
 * Runtime E2EE adapter.
 *
 * This is the bridge from the Phase 1A repositories to P5 record writes. It
 * opens only the current device's GLK2 envelopes, verifies the sender's exact
 * certificate chain against a locally pinned recovery anchor, checks every
 * routing field, and only then imports the scope key as a non-extractable
 * CryptoKey. `devices.status` is intentionally never read as trust.
 */

import { equalBytes, uuidToBytes, zeroize } from '@/crypto/bytes';
import { KEY_DOMAIN, RECIPIENT_KIND, type KeyDomainName } from '@/crypto/domains';
import { canonicalCoupleOwnerUserId } from '@/crypto/canonicalOwner';
import { sha256 } from '@/crypto/suite';
import { openEnvelope } from '@/crypto/glk2';
import { importScopeKeyForUse } from '@/crypto/keyring/scopeKeys';
import { type DeviceKeyPort } from '@/crypto/keystore';
import type { LocalKeyBinding, LocalKeyPort } from '@/crypto/keystore/LocalKeyPort';
import { loadRevocationSet, anchorFromPin, buildChain, certificatesById } from './trust';
import { isDeviceTrusted } from '@/crypto/deviceCertificate';
import type { RecordCryptoEnvironment, ScopeEpoch } from '@/app/records/contentCrypto';
import type {
  E2eeLocalState,
  E2eeRepository,
  CertificateRecord,
  PinnedTrustAnchor,
  ScopeKeyRecord,
} from './ports';
import { setRecordCryptoEnvironment } from '@/lib/records';
import { setOutboxLocalCacheKey } from '@/lib/outbox';
import {
  clearE2eeRuntime as clearRuntimeLifecycle,
  clearE2eeRuntimeCapabilities,
  registerE2eeRuntimeTeardown,
} from './runtimeLifecycle';

export class E2eeRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'E2eeRuntimeError';
  }
}

function fail(code: string, message: string): never {
  throw new E2eeRuntimeError(code, message);
}

export type RuntimeLocalKeyProvider = LocalKeyPort;

export type RuntimeInstallInput = {
  userId: string;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  deviceKeys: DeviceKeyPort;
  localKeys: RuntimeLocalKeyProvider;
  installationId: string;
  /** Read-only probe used to refuse silent LCK replacement after ciphertext loss. */
  hasSealedOutbox?: () => Promise<boolean>;
  /** Refuses a late async install after the authenticated identity changed. */
  isCurrentSession?: () => boolean;
  now?: () => number;
};

function deviceKemHandle(deviceId: string): string {
  return `dev_kem:${deviceId}`;
}

function deviceSigHandle(deviceId: string): string {
  return `dev_sig:${deviceId}`;
}

function sameAnchor(a: PinnedTrustAnchor, b: PinnedTrustAnchor): boolean {
  return a.subjectUserId === b.subjectUserId
    && a.recoveryIdentityId === b.recoveryIdentityId
    && a.recoveryVersion === b.recoveryVersion
    && equalBytes(a.serverOriginId, b.serverOriginId)
    && equalBytes(a.rootRecSigPubFp, b.rootRecSigPubFp)
    && equalBytes(a.rootRecSigSpki, b.rootRecSigSpki)
    && equalBytes(a.recoveryBundleFp, b.recoveryBundleFp);
}

async function authorizeAndVerifyScopeSender(input: {
  runtimeUserId: string;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  scope: ScopeKeyRecord;
  envelope: {
    senderDeviceId: string | null;
    recipientKind: 'device' | 'recovery_identity';
    recipientId: string;
    envelope: Uint8Array;
  };
  certificate: CertificateRecord;
  atMs: bigint;
}) {
  const { scope, certificate } = input;
  let pin: PinnedTrustAnchor | null = null;
  let expectedOwnerUserId: string;

  if (scope.domain === 'personal' || scope.domain === 'health') {
    if (!scope.ownerUserId || scope.ownerCoupleId !== null || scope.scopeId !== scope.ownerUserId
      || scope.ownerUserId !== input.runtimeUserId) {
      fail('E_SCOPE_STRUCTURE_INVALID', 'a user-owned scope has invalid owner structure');
    }
    expectedOwnerUserId = scope.ownerUserId;
    // This check is deliberately before any generic trust-anchor lookup.
    if (certificate.userId !== expectedOwnerUserId) {
      fail('E_SCOPE_SENDER_UNAUTHORIZED', 'the sender is not the owner of this user scope');
    }
    pin = await input.localState.loadTrustAnchor(expectedOwnerUserId);
  } else {
    if (scope.ownerUserId !== null || scope.ownerCoupleId !== scope.scopeId) {
      fail('E_SCOPE_STRUCTURE_INVALID', 'a couple scope has invalid owner structure');
    }
    const authority = await input.localState.loadCoupleAuthority(scope.scopeId);
    if (authority?.state === 'UNLINKED') {
      fail('E_COUPLE_UNLINKED', 'the pinned couple authority is permanently unlinked');
    }
    if (!authority || authority.state !== 'CRYPTO_ACTIVE') {
      fail('E_COUPLE_AUTHORITY_UNAVAILABLE', 'the local pairing authority is not crypto-active');
    }
    const canonicalOwner = canonicalCoupleOwnerUserId(authority.lowUserId, authority.highUserId);
    if (canonicalOwner !== authority.lowUserId) {
      fail('E_COUPLE_OWNER_INVALID', 'the pinned pairing transcript has a non-canonical low owner');
    }
    const snapshot = await input.repository.getCoupleAuthorizationSnapshot(scope.scopeId);
    const active = [...snapshot.activeUserIds].sort();
    const expectedMembers = [authority.lowUserId, authority.highUserId].sort();
    if (snapshot.currentUserActiveCoupleId !== scope.scopeId
      || snapshot.pairingState !== 'CRYPTO_ACTIVE'
      || active.length !== 2
      || active.some((userId, index) => userId !== expectedMembers[index])) {
      fail('E_COUPLE_LIFECYCLE_INVALID', 'server couple lifecycle is not the pinned two-party state');
    }
    if (certificate.userId !== authority.lowUserId && certificate.userId !== authority.highUserId) {
      fail('E_SCOPE_SENDER_UNAUTHORIZED', 'the sender is not one of the paired users');
    }
    expectedOwnerUserId = authority.lowUserId;
    const expectedAnchor = certificate.userId === authority.lowUserId ? authority.lowAnchor : authority.highAnchor;
    pin = certificate.userId === input.runtimeUserId
      ? await input.localState.loadTrustAnchor(certificate.userId)
      : expectedAnchor;
    if (!pin || !sameAnchor(pin, expectedAnchor)) {
      fail('E_PARTNER_ANCHOR_MISMATCH', 'the sender anchor is not the pinned pairing anchor');
    }
  }
  if (!pin) fail('E_SENDER_ANCHOR_MISSING', 'the sender account has no locally confirmed trust anchor');
  const serverOriginId = await input.repository.serverOriginId();
  if (pin.subjectUserId !== certificate.userId || !equalBytes(pin.serverOriginId, serverOriginId)) {
    fail('E_SENDER_ANCHOR_CONTEXT_MISMATCH', 'the pinned sender anchor is bound to another user or server');
  }
  if (!certificate.issuerCertificateId && !certificate.recoveryPublicAnchorId) {
    fail('E_CERTIFICATE_UNBOUND', 'the envelope sender certificate has no trust anchor');
  }
  const anchor = await anchorFromPin({
    userId: certificate.userId,
    serverOriginId,
    rootRecSigSpki: pin.rootRecSigSpki,
    recoveryIdentityId: pin.recoveryIdentityId,
    recoveryVersion: pin.recoveryVersion,
  });
  const revocations = await loadRevocationSet(
    input.repository,
    certificate.userId,
    anchor,
    input.atMs,
  );
  const all = await input.repository.listCertificates(certificate.userId);
  const byId = certificatesById(all);
  let chain;
  try {
    chain = buildChain(certificate, byId);
  } catch {
    fail('E_SENDER_CHAIN_INVALID', 'the envelope sender certificate chain is incomplete');
  }
  const verified = await isDeviceTrusted({
    chain,
    anchor,
    atMs: input.atMs,
    requiredDomain: scope.domain,
    isRevoked: revocations.asLookup(),
  });
  if (!verified) fail('E_SENDER_NOT_TRUSTED', 'the envelope sender is not trusted for this domain');
  if (!input.envelope.senderDeviceId || input.envelope.senderDeviceId !== certificate.subjectDeviceId) {
    fail('E_ENVELOPE_SENDER_MISMATCH', 'the envelope sender device does not match its certificate');
  }
  return { verified, expectedOwnerUserId };
}

export async function createVerifiedRecordCryptoEnvironment(input: {
  userId: string;
  deviceId: string;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  deviceKeys: DeviceKeyPort;
  now?: () => number;
}): Promise<RecordCryptoEnvironment> {
  const now = input.now ?? Date.now;
  const pending = await input.localState.loadBootstrap(input.userId);
  if (!pending || pending.state !== 'COMPLETE' || pending.deviceId !== input.deviceId) {
    fail('E_BOOTSTRAP_NOT_COMPLETE', 'this account/device has not completed bootstrap');
  }
  const device = await input.repository.getDevice(input.deviceId);
  if (!device || device.userId !== input.userId) fail('E_DEVICE_NOT_FOUND', 'the runtime device is not owned by this account');
  if (!(await input.deviceKeys.hasKey(deviceSigHandle(input.deviceId)))) {
    fail('E_DEVICE_SIG_UNAVAILABLE', 'the device signing key is unavailable');
  }
  if (!(await input.deviceKeys.hasKey(deviceKemHandle(input.deviceId)))) {
    fail('E_DEVICE_KEM_UNAVAILABLE', 'the device agreement key is unavailable');
  }
  const ownSigSpki = await input.deviceKeys.getPublicKey(deviceSigHandle(input.deviceId));
  const ownKemSpki = await input.deviceKeys.getPublicKey(deviceKemHandle(input.deviceId));
  if (!equalBytes(ownSigSpki, device.sigSpki)) {
    fail('E_DEVICE_KEY_MISMATCH', 'the installed device signing key does not match the server public key');
  }
  if (!equalBytes(ownKemSpki, device.kemSpki)) {
    fail('E_DEVICE_KEY_MISMATCH', 'the installed device key does not match the server public key');
  }

  const opened = new Map<string, Promise<CryptoKey | null>>();
  const environment: RecordCryptoEnvironment = {
    floorFor: (domain, scopeId) => input.repository.getWriteFloor(domain, scopeId),
    epochsFor: async (domain, scopeId): Promise<ScopeEpoch[]> => (await input.repository.listScopeKeys(domain, scopeId)).map((key) => ({
      domain: key.domain,
      scopeId: key.scopeId,
      epoch: key.epoch,
      state: key.state,
    })),
    scopeKeyFor: async (domain, scopeId, epoch) => {
      const cacheKey = `${domain}:${scopeId}:${epoch.toString()}`;
      const existing = opened.get(cacheKey);
      if (existing) return existing;
      const operation = (async (): Promise<CryptoKey | null> => {
        const scope = (await input.repository.listScopeKeys(domain, scopeId)).find((candidate) => candidate.epoch === epoch);
        if (!scope || scope.domain !== domain || scope.scopeId !== scopeId) return null;
        if (scope.state !== 'ACTIVE' && scope.state !== 'RETIRED') return null;
        const envelope = (await input.repository.listEnvelopesForDevice(input.deviceId)).find(
          (candidate) => candidate.scopeKeyId === scope.id && candidate.recipientKind === 'device'
            && candidate.recipientId === input.deviceId,
        );
        if (!envelope) return null;
        if (!envelope.senderDeviceId) fail('E_ENVELOPE_SENDER_MISSING', 'the envelope has no sender device');
        const certificate = await input.repository.getCertificate(envelope.senderCertificateId);
        if (!certificate || certificate.subjectDeviceId !== envelope.senderDeviceId) {
          fail('E_ENVELOPE_CERTIFICATE_MISMATCH', 'the envelope sender certificate does not name its sender');
        }
        const sender = await authorizeAndVerifyScopeSender({
          runtimeUserId: input.userId,
          repository: input.repository,
          localState: input.localState,
          scope,
          envelope,
          certificate,
          atMs: BigInt(now()),
        });
        const unwrapped = await openEnvelope({
          envelope: envelope.envelope,
          recipientKemSpki: ownKemSpki,
          senderSigSpki: sender.verified.sigSpki,
          deriveSecret: (peer) => input.deviceKeys.deriveSecret(deviceKemHandle(input.deviceId), peer),
        });
        try {
          const expectedOwner = uuidToBytes(sender.expectedOwnerUserId);
          if (unwrapped.header.domain !== KEY_DOMAIN[domain]
            || !equalBytes(unwrapped.header.scopeKeyId, uuidToBytes(scope.id))
            || !equalBytes(unwrapped.header.scopeId, uuidToBytes(scope.scopeId))
            || unwrapped.header.epoch !== scope.epoch
            || !equalBytes(unwrapped.header.ownerUserId, expectedOwner)
            || !equalBytes(unwrapped.header.senderDeviceId, uuidToBytes(envelope.senderDeviceId))
            || !equalBytes(unwrapped.header.senderDeviceId, uuidToBytes(certificate.subjectDeviceId))
            || unwrapped.header.recipientKind !== RECIPIENT_KIND.device
            || !equalBytes(unwrapped.header.recipientId, uuidToBytes(input.deviceId))) {
            fail('E_ENVELOPE_ROUTING_MISMATCH', 'the authenticated envelope routing does not match the scope row');
          }
          if (scope.domain === 'couple') {
            await input.localState.recordAcceptedEnvelope({
              coupleId: scope.scopeId,
              scopeKeyId: scope.id,
              epoch: scope.epoch,
              envelopeFingerprint: await sha256(envelope.envelope),
            });
          }
          return await importScopeKeyForUse(unwrapped.scopeKey);
        } finally {
          zeroize(unwrapped.scopeKey);
        }
      })();
      opened.set(cacheKey, operation);
      try {
        return await operation;
      } catch (error) {
        opened.delete(cacheKey);
        throw error;
      }
    },
  };
  return environment;
}

export type InstalledE2eeRuntime = {
  environment: RecordCryptoEnvironment;
  deviceId: string;
  close(): void;
};

/** Install both runtime capabilities atomically, or install neither. */
export async function installE2eeRuntime(input: RuntimeInstallInput): Promise<InstalledE2eeRuntime> {
  const assertCurrentSession = () => {
    if (input.isCurrentSession && !input.isCurrentSession()) {
      fail('E_RUNTIME_SESSION_STALE', 'the authenticated session changed during runtime installation');
    }
  };
  assertCurrentSession();
  const pending = await input.localState.loadBootstrap(input.userId);
  if (!pending || pending.state !== 'COMPLETE') fail('E_BOOTSTRAP_NOT_COMPLETE', 'bootstrap is not complete');
  const environment = await createVerifiedRecordCryptoEnvironment({ ...input, deviceId: pending.deviceId });
  const binding: LocalKeyBinding = {
    installationId: input.installationId,
    userId: input.userId,
    deviceId: pending.deviceId,
    purpose: 'lck',
    version: 1,
  };
  if (input.hasSealedOutbox && await input.hasSealedOutbox()) {
    const existing = await input.localKeys.load(binding);
    if (!existing || !(await existing.has())) {
      fail('E_LCK_MISSING_WITH_CIPHERTEXT', 'sealed outbox content exists but its LCK is unavailable');
    }
  }
  const lck = await input.localKeys.loadOrCreate(binding);
  if (!lck) fail('E_SECURE_LOCAL_STORAGE_REQUIRED', 'no approved secure local storage is available for the LCK');
  if (lck.binding.userId !== input.userId || lck.binding.deviceId !== pending.deviceId
    || lck.binding.installationId !== input.installationId) {
    fail('E_LOCAL_KEY_ACCOUNT_MISMATCH', 'the local cache key is bound to a different account or device');
  }
  assertCurrentSession();

  // Re-installation is single-owner too: a late duplicate bootstrap must not
  // leave two teardown callbacks with different account/device bindings.
  clearE2eeRuntimeCapabilities();
  try {
    setRecordCryptoEnvironment(environment);
    setOutboxLocalCacheKey(lck);
    registerE2eeRuntimeTeardown(() => {
      setRecordCryptoEnvironment(null);
      setOutboxLocalCacheKey(null);
    });
  } catch (error) {
    // Do not leave one capability installed if a later registration step fails.
    setRecordCryptoEnvironment(null);
    setOutboxLocalCacheKey(null);
    clearRuntimeLifecycle();
    throw error;
  }
  let closed = false;
  return {
    environment,
    deviceId: pending.deviceId,
    close: () => {
      if (closed) return;
      closed = true;
      clearRuntimeLifecycle();
    },
  };
}

export function clearE2eeRuntime(): void {
  clearRuntimeLifecycle();
}

async function requireRuntimeKey(input: {
  environment: RecordCryptoEnvironment;
  domain: KeyDomainName;
  scopeId: string;
}) {
  const epochs = await input.environment.epochsFor(input.domain, input.scopeId);
  const active = epochs.find((epoch) => epoch.state === 'ACTIVE');
  if (!active) fail('E_ACTIVE_EPOCH_REQUIRED', `${input.domain} has no ACTIVE epoch`);
  const key = await input.environment.scopeKeyFor(input.domain, input.scopeId, active.epoch);
  if (!key) fail('E_VERIFIED_SCOPE_KEY_REQUIRED', `${input.domain} key is not available on this device`);
  return active;
}

/** Guarded personal-floor activation. PMK is checked by exact domain routing. */
export async function activatePersonalProtection(input: {
  userId: string;
  deviceId: string;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  environment: RecordCryptoEnvironment;
}): Promise<void> {
  const pending = await input.localState.loadBootstrap(input.userId);
  if (!pending || pending.state !== 'COMPLETE' || pending.deviceId !== input.deviceId) {
    fail('E_RECOVERY_CONFIRMATION_REQUIRED', 'recovery confirmation is required before activation');
  }
  if (await input.repository.getWriteFloor('personal', input.userId) >= 1) return;
  await requireRuntimeKey({ environment: input.environment, domain: 'personal', scopeId: input.userId });
  await input.repository.activateWriteFloor('user', input.userId, input.deviceId);
}

/** Guarded couple-floor activation. A missing CSK is a hard refusal, never PMK/HRK substitution. */
export async function activateCoupleProtection(input: {
  userId: string;
  deviceId: string;
  coupleId: string;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  environment: RecordCryptoEnvironment;
}): Promise<void> {
  const pending = await input.localState.loadBootstrap(input.userId);
  if (!pending || pending.state !== 'COMPLETE' || pending.deviceId !== input.deviceId) {
    fail('E_RECOVERY_CONFIRMATION_REQUIRED', 'recovery confirmation is required before activation');
  }
  if (!input.coupleId) fail('E_COUPLE_KEYS_PENDING', 'there is no active couple scope');
  if (await input.repository.getWriteFloor('couple', input.coupleId) >= 1) return;
  await requireRuntimeKey({ environment: input.environment, domain: 'couple', scopeId: input.coupleId });
  await input.repository.activateWriteFloor('couple', input.coupleId, input.deviceId);
}
