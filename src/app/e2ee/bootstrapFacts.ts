import type { DeviceKeyPort, LocalKeyCapability } from '@/crypto/keystore';
import { getOutboxLocalCacheKey } from '@/lib/outbox';
import { getRecordCryptoEnvironment } from '@/lib/records';
import type { RecordCryptoEnvironment } from '@/app/records/contentCrypto';
import type { E2eeLocalState, E2eeRepository } from './ports';
import { bootstrapStateFromFacts, type BootstrapFacts } from './bootstrapStateMachine';

export type BootstrapFactInput = {
  userId: string;
  coupleId?: string | null;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  deviceKeys: DeviceKeyPort;
  runtime?: RecordCryptoEnvironment | null;
  lck?: LocalKeyCapability | null;
};

/**
 * The only production fact producer. React must consume this result; it must
 * not construct BootstrapFacts from optimistic button state or cached labels.
 */
export async function produceBootstrapFacts(input: BootstrapFactInput): Promise<BootstrapFacts> {
  const pending = await input.localState.loadBootstrap(input.userId);
  const hasLocalIdentity = !!pending
    && pending.deviceId.length > 0
    && await input.deviceKeys.hasKey(pending.sigHandle)
    && await input.deviceKeys.hasKey(pending.kemHandle);
  const recovery = pending?.recoveryIdentityId
    ? await input.repository.getRecoveryIdentity(input.userId)
    : null;
  const recoveryCreated = !!recovery && recovery.id === pending?.recoveryIdentityId;
  const recoveryConfirmed = pending?.state === 'COMPLETE';
  const device = pending ? await input.repository.getDevice(pending.deviceId) : null;
  const certificates = pending ? await input.repository.listCertificates(input.userId) : [];
  const certificate = pending ? certificates.find((row) => row.subjectDeviceId === pending.deviceId) : null;
  const deviceEnrolled = !!device && device.userId === input.userId
    && device.status === 'ACTIVE'
    && !!certificate
    && certificate.subjectSigSpki.length > 0
    && certificate.subjectKemSpki.length > 0;

  const runtime = input.runtime === undefined ? getRecordCryptoEnvironment() : input.runtime;
  const lck = input.lck === undefined ? getOutboxLocalCacheKey() : input.lck;
  const runtimeReady = !!runtime && !!lck && 'has' in lck && await lck.has();

  async function openable(domain: 'personal' | 'couple', scopeId: string | null | undefined): Promise<boolean> {
    if (!runtime || !scopeId) return false;
    const active = (await runtime.epochsFor(domain, scopeId)).find((epoch) => epoch.state === 'ACTIVE');
    if (!active) return false;
    try {
      return (await runtime.scopeKeyFor(domain, scopeId, active.epoch)) !== null;
    } catch {
      return false;
    }
  }

  const personalKeysReady = await openable('personal', input.userId);
  const coupleKeysReady = await openable('couple', input.coupleId);
  const personalFloor = await input.repository.getWriteFloor('personal', input.userId);
  const coupleFloor = input.coupleId ? await input.repository.getWriteFloor('couple', input.coupleId) : 0;

  return {
    hasLocalIdentity,
    recoveryCreated,
    recoveryConfirmed,
    deviceEnrolled,
    personalKeysReady,
    coupleKeysReady,
    runtimeReady,
    floorActive: personalFloor >= 1 && (!input.coupleId || coupleFloor >= 1),
    personalFloorActive: personalFloor >= 1,
    coupleFloorActive: !!input.coupleId && coupleFloor >= 1,
    hasCoupleScope: !!input.coupleId,
  };
}

export async function produceBootstrapState(input: BootstrapFactInput) {
  return bootstrapStateFromFacts(await produceBootstrapFacts(input));
}
