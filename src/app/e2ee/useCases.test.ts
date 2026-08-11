/**
 * E2EE application use cases, driven end to end against in-memory repositories
 * and a real software device-key port.
 *
 * These exist because the previous phase reported 1A-6..1A-10 as complete on
 * the strength of helper functions. A helper that computes a value is not a
 * flow that creates an account.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { hex, uuidToBytes } from '@/crypto/bytes';
import { ASSURANCE } from '@/crypto/domains';
import { publicKeyFingerprint } from '@/crypto/suite';
import { verifyCertificateChain, type TrustAnchor } from '@/crypto/deviceCertificate';
import { decodeRecoveryCode } from '@/crypto/recoveryCode';
import { toP1363 } from '@/crypto/ecdsaFormat';
import type { DeviceKeyPort } from '@/crypto/keystore';
import { bootstrapFirstDevice, confirmRecoveryKit, partnerAssistRecoverCouple } from './useCases';
import type {
  BootstrapProgress,
  CertificateRecord,
  DeviceRecord,
  E2eeLocalState,
  E2eeRepository,
  EnvelopeRecord,
  RecoveryIdentityRecord,
  ScopeKeyRecord,
  UseCaseDeps,
} from './ports';

/** In-memory repository with the same shape as the Supabase one. */
function makeRepository() {
  const devices: DeviceRecord[] = [];
  const certificates: (CertificateRecord & { id: string })[] = [];
  const scopeKeys: (ScopeKeyRecord & { id: string })[] = [];
  const envelopes: EnvelopeRecord[] = [];
  const recoveryIdentities: (RecoveryIdentityRecord & { id: string })[] = [];
  let seq = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(seq += 1).padStart(12, '0')}`;

  const repository: E2eeRepository = {
    serverOriginId: async () => new Uint8Array(32).fill(3),
    getDevice: async (id) => devices.find((d) => d.id === id) ?? null,
    listDevices: async (userId) => devices.filter((d) => d.userId === userId),
    insertDevice: async (record) => { devices.push(record as DeviceRecord); },
    setDeviceStatus: async (id, status) => {
      const device = devices.find((d) => d.id === id);
      if (device) device.status = status;
    },
    listCertificates: async (userId) => certificates.filter((c) => c.userId === userId),
    insertCertificate: async (record) => {
      const id = nextId();
      certificates.push({ ...record, id });
      return id;
    },
    getRecoveryIdentity: async (userId) => recoveryIdentities.find((r) => r.userId === userId) ?? null,
    insertRecoveryIdentity: async (record) => {
      const id = nextId();
      recoveryIdentities.push({ ...record, id });
      return id;
    },
    listScopeKeys: async (domain, scopeId) =>
      scopeKeys.filter((k) => k.domain === domain && k.scopeId === scopeId),
    insertScopeKey: async (record) => {
      const id = nextId();
      scopeKeys.push({ ...record, id });
      return id;
    },
    markEpochReady: async (id) => {
      const key = scopeKeys.find((k) => k.id === id)!;
      if (key.state !== 'PREPARING') throw new Error('E2EE_ILLEGAL_EPOCH_TRANSITION');
      key.state = 'READY';
    },
    activateEpoch: async (id) => {
      const key = scopeKeys.find((k) => k.id === id)!;
      // Mirrors e2ee_activate_epoch: only READY activates.
      if (key.state !== 'READY') throw new Error('E2EE_ILLEGAL_EPOCH_TRANSITION');
      for (const other of scopeKeys) {
        if (other.domain === key.domain && other.scopeId === key.scopeId && other.state === 'ACTIVE') {
          other.state = 'RETIRED';
        }
      }
      key.state = 'ACTIVE';
    },
    abandonEpoch: async (id) => {
      const key = scopeKeys.find((k) => k.id === id)!;
      key.state = 'ABANDONED';
    },
    listEnvelopes: async (scopeKeyId) => envelopes.filter((e) => e.scopeKeyId === scopeKeyId),
    insertEnvelope: async (record) => { envelopes.push(record); },
    listRevocations: async () => [],
    appendRevocation: async () => {},
  };

  return { repository, devices, certificates, scopeKeys, envelopes, recoveryIdentities };
}

function makeLocalState() {
  const progress = new Map<string, BootstrapProgress>();
  const anchors = new Map<string, { rootRecSigPubFp: Uint8Array; recoveryIdentityId: string; recoveryVersion: number }>();
  const localState: E2eeLocalState = {
    loadBootstrapProgress: async (userId) => progress.get(userId) ?? null,
    saveBootstrapProgress: async (userId, value) => { progress.set(userId, value); },
    pinTrustAnchor: async (userId, anchor) => { anchors.set(userId, anchor); },
    loadTrustAnchor: async (userId) => anchors.get(userId) ?? null,
  };
  return { localState, progress, anchors };
}

/** A software device-key port with the same contract as the native one. */
function makeDeviceKeyPort(): DeviceKeyPort {
  const keys = new Map<string, { kind: 'ECDSA' | 'ECDH'; pair: CryptoKeyPair; spki: Uint8Array }>();
  async function generate(alias: string, kind: 'ECDSA' | 'ECDH') {
    const pair = (await crypto.subtle.generateKey(
      { name: kind, namedCurve: 'P-256' },
      false,
      kind === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'],
    )) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    keys.set(alias, { kind, pair, spki });
    return { handle: alias, publicKeySpki: spki, assurance: ASSURANCE.secureEnclave };
  }
  return {
    generateSigningKey: (alias) => generate(alias, 'ECDSA'),
    generateAgreementKey: (alias) => generate(alias, 'ECDH'),
    getPublicKey: async (handle) => keys.get(handle)!.spki,
    sign: async (handle, message) => toP1363(new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.get(handle)!.pair.privateKey, message as BufferSource),
    )),
    deriveSecret: async (handle, peerSpki) => {
      const peer = await crypto.subtle.importKey('spki', peerSpki as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, keys.get(handle)!.pair.privateKey, 256));
    },
    deleteKey: async (handle) => { keys.delete(handle); },
    getAssurance: async () => ASSURANCE.secureEnclave,
    hasKey: async (alias) => keys.has(alias),
  };
}

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
let deps: UseCaseDeps;
let repo: ReturnType<typeof makeRepository>;
let local: ReturnType<typeof makeLocalState>;

beforeEach(() => {
  repo = makeRepository();
  local = makeLocalState();
  let counter = 0;
  deps = {
    repository: repo.repository,
    localState: local.localState,
    deviceKeys: makeDeviceKeyPort(),
    flag: { isEnabled: () => true },
    now: () => 1_800_000_000_000,
    newId: () => `d0000000-0000-4000-8000-${String(counter += 1).padStart(12, '0')}`,
  };
});

describe('FirstDeviceBootstrap', () => {
  it('creates the whole account: device, recovery identity, root certificate, PMK and HRK', async () => {
    const result = await bootstrapFirstDevice(deps, { userId: USER, platform: 'ios' });

    expect(repo.devices).toHaveLength(1);
    expect(repo.recoveryIdentities).toHaveLength(1);
    expect(repo.certificates).toHaveLength(1);

    const personal = repo.scopeKeys.filter((k) => k.domain === 'personal');
    const health = repo.scopeKeys.filter((k) => k.domain === 'health');
    expect(personal).toHaveLength(1);
    expect(health).toHaveLength(1);
    // Both reached ACTIVE only via READY.
    expect(personal[0].state).toBe('ACTIVE');
    expect(health[0].state).toBe('ACTIVE');

    // Each scope key has a device envelope AND a recovery envelope — the
    // recovery one is what makes a lost device survivable.
    for (const key of [...personal, ...health]) {
      const envelopes = repo.envelopes.filter((e) => e.scopeKeyId === key.id);
      expect(envelopes.map((e) => e.recipientKind).sort()).toEqual(['device', 'recovery_identity']);
      // Every envelope names the certificate needed to verify it later.
      for (const envelope of envelopes) expect(envelope.senderCertificateId).toBeTruthy();
    }

    // The recovery code is a real 56-symbol kit that decodes to 32 bytes.
    expect(result.recoveryCode.replace(/-/g, '')).toHaveLength(56);
    expect((await decodeRecoveryCode(result.recoveryCode)).length).toBe(32);
    expect(result.anchorTag).toMatch(/^\d{3}-\d{3}-\d{3}-\d{3}$/);
  });

  it('issues a root certificate that verifies against the pinned anchor', async () => {
    await bootstrapFirstDevice(deps, { userId: USER, platform: 'ios' });
    const anchorState = await local.localState.loadTrustAnchor(USER);
    expect(anchorState).not.toBeNull();

    const identity = repo.recoveryIdentities[0];
    const certificate = repo.certificates[0];
    const anchor: TrustAnchor = {
      rootRecSigPubFp: await publicKeyFingerprint(identity.recSigSpki),
      rootRecSigSpki: identity.recSigSpki,
      recoveryIdentityId: uuidToBytes(identity.id),
      recoveryVersion: 1,
      userId: uuidToBytes(USER),
      serverOriginId: new Uint8Array(32).fill(3),
    };

    const verified = await verifyCertificateChain({
      chain: [{
        certificate: certificate.certificate,
        subjectSigSpki: certificate.subjectSigSpki,
        subjectKemSpki: certificate.subjectKemSpki,
      }],
      anchor,
      atMs: 1_800_000_000_000n,
    });
    expect(hex(verified.deviceId)).toBe(hex(uuidToBytes(certificate.subjectDeviceId)));
    expect(verified.grantedDomains).toContain('health');

    // The pinned anchor is the same root the certificate chains to.
    expect(hex(anchorState!.rootRecSigPubFp)).toBe(hex(anchor.rootRecSigPubFp));
  });

  it('grants no health domain on web', async () => {
    await bootstrapFirstDevice(deps, { userId: USER, platform: 'web' });
    expect(repo.scopeKeys.filter((k) => k.domain === 'health')).toHaveLength(0);
    expect(repo.scopeKeys.filter((k) => k.domain === 'personal')).toHaveLength(1);
  });

  it('records progress at each durable step and refuses to run twice', async () => {
    await bootstrapFirstDevice(deps, { userId: USER, platform: 'ios' });
    const progress = local.progress.get(USER)!;
    expect(progress.deviceKeysCreated).toBe(true);
    expect(progress.recoveryIdentityCreated).toBe(true);
    expect(progress.rootCertificateIssued).toBe(true);
    expect(progress.personalKeyCreated).toBe(true);
    expect(progress.healthKeyCreated).toBe(true);
    // Not complete until the kit is verified.
    expect(progress.completed).toBe(false);

    local.progress.set(USER, { ...progress, completed: true });
    await expect(bootstrapFirstDevice(deps, { userId: USER, platform: 'ios' }))
      .rejects.toThrow(/E_ALREADY_BOOTSTRAPPED/);
  });

  it('leaves the device PENDING until the kit is verified in full', async () => {
    const result = await bootstrapFirstDevice(deps, { userId: USER, platform: 'ios' });
    expect(repo.devices[0].status).toBe('PENDING');

    await expect(confirmRecoveryKit(deps, {
      userId: USER,
      reEnteredCode: (await import('@/crypto/recoveryCode')).formatGroups(
        result.recoveryCode.replace(/-/g, '').slice(0, 55) + (result.recoveryCode.replace(/-/g, '')[55] === 'Z' ? 'Y' : 'Z'),
      ),
      expectedRecoveryCode: result.recoveryCode,
      expectedAnchorTag: result.anchorTag,
    })).rejects.toThrow();
    expect(repo.devices[0].status).toBe('PENDING');

    await confirmRecoveryKit(deps, {
      userId: USER,
      reEnteredCode: result.recoveryCode,
      expectedRecoveryCode: result.recoveryCode,
      reEnteredAnchorTag: result.anchorTag,
      expectedAnchorTag: result.anchorTag,
    });
    expect(repo.devices[0].status).toBe('ACTIVE');
    expect(local.progress.get(USER)!.completed).toBe(true);
  });

  it('refuses to run at all while the feature flag is off', async () => {
    const disabled = { ...deps, flag: { isEnabled: () => false } };
    await expect(bootstrapFirstDevice(disabled, { userId: USER, platform: 'ios' }))
      .rejects.toThrow(/E_E2EE_DISABLED/);
    expect(repo.devices).toHaveLength(0);
  });
});

describe('PartnerAssistRecoverCouple is CSK-only by construction', () => {
  it('exposes no domain parameter, so personal and health are unreachable', () => {
    // Structural, not a runtime check: there is no `recover(domain)` anywhere
    // and this function resolves its own scope key by couple id.
    const source = partnerAssistRecoverCouple.toString();
    expect(source).not.toMatch(/\bdomain\s*[:=]\s*(input\.|['"]personal|['"]health)/);
    expect(partnerAssistRecoverCouple.length).toBe(2);
  });

  it('fails when the couple has no active key rather than reaching for another scope', async () => {
    await expect(partnerAssistRecoverCouple(deps, {
      coupleId: 'c0000000-0000-4000-8000-000000000001',
      targetDevice: {
        deviceId: uuidToBytes('d0000000-0000-4000-8000-00000000000f'),
        sigSpki: new Uint8Array(91),
        kemSpki: new Uint8Array(91),
        assurance: ASSURANCE.secureEnclave,
        platform: 'ios',
        grantedDomains: ['couple'],
      },
      assistingDeviceId: 'd0000000-0000-4000-8000-000000000001',
      assistingSigSpki: new Uint8Array(91),
      assistingCertificateId: '00000000-0000-4000-8000-000000000001',
      assistingKemSpki: new Uint8Array(91),
      ownEnvelope: new Uint8Array(360),
      ownEnvelopeSenderSigSpki: new Uint8Array(91),
      signHandle: 'x',
      kemHandle: 'y',
      ownerUserId: uuidToBytes(USER),
    })).rejects.toThrow(/E_NO_ACTIVE_COUPLE_KEY/);
  });
});
