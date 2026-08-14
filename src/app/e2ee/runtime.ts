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
import { KEY_DOMAIN, type KeyDomainName } from '@/crypto/domains';
import { openEnvelope } from '@/crypto/glk2';
import { importScopeKeyForUse } from '@/crypto/keyring/scopeKeys';
import { type DeviceKeyPort } from '@/crypto/keystore';
import { loadRevocationSet, anchorFromPin, buildChain, certificatesById } from './trust';
import { isDeviceTrusted } from '@/crypto/deviceCertificate';
import type { RecordCryptoEnvironment, ScopeEpoch } from '@/app/records/contentCrypto';
import type { E2eeLocalState, E2eeRepository, CertificateRecord } from './ports';
import { setRecordCryptoEnvironment } from '@/lib/records';
import { setOutboxLocalCacheKey } from '@/lib/outbox';
import { clearE2eeRuntime as clearRuntimeLifecycle, registerE2eeRuntimeTeardown } from './runtimeLifecycle';

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

export type RuntimeLocalKeyProvider = {
  /**
   * Returns an account/device-scoped LCK from an approved secure local store.
   * A provider must never implement this with localStorage or plaintext
   * IndexedDB. This port is intentionally required by installation.
   */
  loadOrCreateLck(userId: string, deviceId: string): Promise<{
    key: CryptoKey;
    userId: string;
    deviceId: string;
  } | null>;
};

export type RuntimeInstallInput = {
  userId: string;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  deviceKeys: DeviceKeyPort;
  localKeys: RuntimeLocalKeyProvider;
  now?: () => number;
};

function deviceKemHandle(deviceId: string): string {
  return `dev_kem:${deviceId}`;
}

async function exactTrustedSender(input: {
  repository: E2eeRepository;
  localState: E2eeLocalState;
  certificate: CertificateRecord;
  domain: KeyDomainName;
  atMs: bigint;
}) {
  if (!input.certificate.issuerCertificateId && !input.certificate.recoveryPublicAnchorId) {
    fail('E_CERTIFICATE_UNBOUND', 'the envelope sender certificate has no trust anchor');
  }
  const pin = await input.localState.loadTrustAnchor(input.certificate.userId);
  if (!pin) fail('E_SENDER_ANCHOR_MISSING', 'the sender account has no locally confirmed trust anchor');
  const anchor = await anchorFromPin({
    userId: input.certificate.userId,
    serverOriginId: await input.repository.serverOriginId(),
    rootRecSigSpki: pin.rootRecSigSpki,
    recoveryIdentityId: pin.recoveryIdentityId,
    recoveryVersion: pin.recoveryVersion,
  });
  const revocations = await loadRevocationSet(
    input.repository,
    input.certificate.userId,
    anchor,
    input.atMs,
  );
  const all = await input.repository.listCertificates(input.certificate.userId);
  const byId = certificatesById(all);
  let chain;
  try {
    chain = buildChain(input.certificate, byId);
  } catch {
    fail('E_SENDER_CHAIN_INVALID', 'the envelope sender certificate chain is incomplete');
  }
  const verified = await isDeviceTrusted({
    chain,
    anchor,
    atMs: input.atMs,
    requiredDomain: input.domain,
    isRevoked: revocations.asLookup(),
  });
  if (!verified) fail('E_SENDER_NOT_TRUSTED', 'the envelope sender is not trusted for this domain');
  return verified;
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
  if (!(await input.deviceKeys.hasKey(deviceKemHandle(input.deviceId)))) {
    fail('E_DEVICE_KEM_UNAVAILABLE', 'the device agreement key is unavailable');
  }
  const ownKemSpki = await input.deviceKeys.getPublicKey(deviceKemHandle(input.deviceId));
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
        const sender = await exactTrustedSender({
          repository: input.repository,
          localState: input.localState,
          certificate,
          domain,
          atMs: BigInt(now()),
        });
        const unwrapped = await openEnvelope({
          envelope: envelope.envelope,
          recipientKemSpki: ownKemSpki,
          senderSigSpki: sender.sigSpki,
          deriveSecret: (peer) => input.deviceKeys.deriveSecret(deviceKemHandle(input.deviceId), peer),
        });
        const expectedOwner = scope.ownerUserId ? uuidToBytes(scope.ownerUserId) : null;
        if (unwrapped.header.domain !== KEY_DOMAIN[domain]
          || !equalBytes(unwrapped.header.scopeKeyId, uuidToBytes(scope.id))
          || !equalBytes(unwrapped.header.scopeId, uuidToBytes(scope.scopeId))
          || unwrapped.header.epoch !== scope.epoch
          || (expectedOwner && !equalBytes(unwrapped.header.ownerUserId, expectedOwner))) {
          zeroize(unwrapped.scopeKey);
          fail('E_ENVELOPE_ROUTING_MISMATCH', 'the authenticated envelope routing does not match the scope row');
        }
        try {
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
  const pending = await input.localState.loadBootstrap(input.userId);
  if (!pending || pending.state !== 'COMPLETE') fail('E_BOOTSTRAP_NOT_COMPLETE', 'bootstrap is not complete');
  const environment = await createVerifiedRecordCryptoEnvironment({ ...input, deviceId: pending.deviceId });
  const lck = await input.localKeys.loadOrCreateLck(input.userId, pending.deviceId);
  if (!lck) fail('E_SECURE_LOCAL_STORAGE_REQUIRED', 'no approved secure local storage is available for the LCK');
  if (lck.userId !== input.userId || lck.deviceId !== pending.deviceId) {
    fail('E_LOCAL_KEY_ACCOUNT_MISMATCH', 'the local cache key is bound to a different account or device');
  }

  // Re-installation is single-owner too: a late duplicate bootstrap must not
  // leave two teardown callbacks with different account/device bindings.
  clearRuntimeLifecycle();
  setRecordCryptoEnvironment(environment);
  setOutboxLocalCacheKey(lck.key);
  registerE2eeRuntimeTeardown(() => {
    setRecordCryptoEnvironment(null);
    setOutboxLocalCacheKey(null);
  });
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
