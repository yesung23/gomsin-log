/**
 * TEST SUPPORT — an in-memory account with real cryptography.
 *
 * Every key here is generated inside the test process and protects nothing.
 * This module exists so protocol and attack tests exercise real signatures,
 * real ECDH and real AEAD rather than mocks: an attack test that passes against
 * a stub proves nothing about the protocol.
 *
 * Not imported by application code. Lives under `src/crypto/testing/` so the
 * boundary test can assert that.
 */

import { concat, uuidToBytes } from '../bytes';
import {
  ASSURANCE,
  KEY_DOMAIN,
  RECIPIENT_KIND,
  type Assurance,
  type KeyDomainName,
  type PlatformName,
} from '../domains';
import {
  ISSUER_KIND,
  assembleCertificate,
  certificatePopMessage,
  certificateSignedMessage,
  encodeTbs,
  type CertificateWithKeys,
  type TrustAnchor,
} from '../deviceCertificate';
import { decodeP1363 } from '../ecdsaFormat';
import {
  generateEphemeralAgreement,
  publicKeyFingerprint,
  randomBytes,
  sha256,
} from '../suite';
import { sealScopeKeyForRecipient } from '../keyring/scopeKeys';
import { recoveryBundleFingerprint, type RecoveryBundle } from '../transcripts';
import { generateScopeKeyBytes } from '../keyring/scopeKeys';

/** A software keypair with the raw private key available, for tests only. */
export type TestKeyPair = {
  privateKey: CryptoKey;
  spki: Uint8Array;
  fingerprint: Uint8Array;
};

async function makePair(kind: 'ECDSA' | 'ECDH'): Promise<TestKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: kind, namedCurve: 'P-256' },
    true,
    kind === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'],
  )) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { privateKey: pair.privateKey, spki, fingerprint: await publicKeyFingerprint(spki) };
}

export async function signWith(pair: TestKeyPair, message: Uint8Array): Promise<Uint8Array> {
  const raw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    message as BufferSource,
  );
  // WebCrypto always returns P-1363; validate rather than guess at the format.
  const signature = new Uint8Array(raw);
  decodeP1363(signature);
  return signature;
}

export async function deriveWith(pair: TestKeyPair, peerSpki: Uint8Array): Promise<Uint8Array> {
  const peer = await crypto.subtle.importKey(
    'spki',
    peerSpki as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, pair.privateKey, 256);
  return new Uint8Array(bits);
}

export type TestDevice = {
  deviceId: Uint8Array;
  sig: TestKeyPair;
  kem: TestKeyPair;
  certificate: Uint8Array;
  chain: CertificateWithKeys[];
  assurance: Assurance;
  platform: PlatformName;
  grantedDomains: KeyDomainName[];
};

export type TestAccount = {
  userId: Uint8Array;
  serverOriginId: Uint8Array;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  recoverySalt: Uint8Array;
  recSig: TestKeyPair;
  recKem: TestKeyPair;
  recoveryBundle: RecoveryBundle;
  recoveryBundleFp: Uint8Array;
  anchor: TrustAnchor;
  devices: TestDevice[];
};

const ZERO32 = new Uint8Array(32);

export async function createTestAccount(options?: {
  userId?: string;
  serverOriginId?: Uint8Array;
  grantedDomains?: KeyDomainName[];
  assurance?: Assurance;
  platform?: PlatformName;
}): Promise<TestAccount> {
  const userId = uuidToBytes(options?.userId ?? crypto.randomUUID());
  const serverOriginId = options?.serverOriginId ?? (await sha256(concat(userId, new Uint8Array([1]))));
  const recoveryIdentityId = uuidToBytes(crypto.randomUUID());
  const recoveryVersion = 1;
  const recoverySalt = randomBytes(32);

  const recSig = await makePair('ECDSA');
  const recKem = await makePair('ECDH');

  const recoveryBundle: RecoveryBundle = {
    recoveryVersion,
    userId,
    recoverySalt,
    recSigSpki: recSig.spki,
    recKemSpki: recKem.spki,
  };
  const recoveryBundleFp = await recoveryBundleFingerprint(recoveryBundle);

  const anchor: TrustAnchor = {
    rootRecSigPubFp: recSig.fingerprint,
    rootRecSigSpki: recSig.spki,
    recoveryIdentityId,
    recoveryVersion,
    userId,
    serverOriginId,
  };

  const account: TestAccount = {
    userId,
    serverOriginId,
    recoveryIdentityId,
    recoveryVersion,
    recoverySalt,
    recSig,
    recKem,
    recoveryBundle,
    recoveryBundleFp,
    anchor,
    devices: [],
  };

  await addRootDevice(account, {
    grantedDomains: options?.grantedDomains ?? ['personal', 'couple', 'health'],
    assurance: options?.assurance ?? ASSURANCE.secureEnclave,
    platform: options?.platform ?? 'ios',
  });

  return account;
}

/** A first device, certified directly by the recovery signing key. */
export async function addRootDevice(
  account: TestAccount,
  options: { grantedDomains: KeyDomainName[]; assurance: Assurance; platform: PlatformName },
): Promise<TestDevice> {
  const deviceId = uuidToBytes(crypto.randomUUID());
  const sig = await makePair('ECDSA');
  const kem = await makePair('ECDH');

  const tbs = encodeTbs({
    issuerKind: ISSUER_KIND.recoveryIdentity,
    subjectAssurance: options.assurance,
    subjectPlatform: options.platform,
    grantedDomains: options.grantedDomains,
    userId: account.userId,
    serverOriginId: account.serverOriginId,
    recoveryIdentityId: account.recoveryIdentityId,
    recoveryVersion: account.recoveryVersion,
    rootRecSigPubFp: account.recSig.fingerprint,
    issuerId: account.recoveryIdentityId,
    issuerSigPubFp: account.recSig.fingerprint,
    subjectDeviceId: deviceId,
    subjectSigPubFp: sig.fingerprint,
    subjectKemPubFp: kem.fingerprint,
    notBeforeMs: 0n,
    notAfterMs: 0n,
    ceremonyNonce: randomBytes(32),
    ceremonyTranscriptHash: ZERO32,
  });

  const issuerSignature = await signWith(account.recSig, certificateSignedMessage(tbs));
  const subjectPop = await signWith(sig, certificatePopMessage(tbs));
  const certificate = assembleCertificate(tbs, issuerSignature, subjectPop);

  const device: TestDevice = {
    deviceId,
    sig,
    kem,
    certificate,
    chain: [{ certificate, subjectSigSpki: sig.spki, subjectKemSpki: kem.spki }],
    assurance: options.assurance,
    platform: options.platform,
    grantedDomains: options.grantedDomains,
  };
  account.devices.push(device);
  return device;
}

/** A device certified by an existing device, producing a depth-2 chain. */
export async function addEnrolledDevice(
  account: TestAccount,
  issuer: TestDevice,
  options: {
    grantedDomains: KeyDomainName[];
    assurance?: Assurance;
    platform?: PlatformName;
    ceremonyTranscriptHash?: Uint8Array;
  },
): Promise<TestDevice> {
  const deviceId = uuidToBytes(crypto.randomUUID());
  const sig = await makePair('ECDSA');
  const kem = await makePair('ECDH');

  const tbs = encodeTbs({
    issuerKind: ISSUER_KIND.device,
    subjectAssurance: options.assurance ?? ASSURANCE.webNonExtractable,
    subjectPlatform: options.platform ?? 'web',
    grantedDomains: options.grantedDomains,
    userId: account.userId,
    serverOriginId: account.serverOriginId,
    recoveryIdentityId: account.recoveryIdentityId,
    recoveryVersion: account.recoveryVersion,
    rootRecSigPubFp: account.recSig.fingerprint,
    issuerId: issuer.deviceId,
    issuerSigPubFp: issuer.sig.fingerprint,
    subjectDeviceId: deviceId,
    subjectSigPubFp: sig.fingerprint,
    subjectKemPubFp: kem.fingerprint,
    notBeforeMs: 0n,
    notAfterMs: 0n,
    ceremonyNonce: randomBytes(32),
    ceremonyTranscriptHash: options.ceremonyTranscriptHash ?? ZERO32,
  });

  const issuerSignature = await signWith(issuer.sig, certificateSignedMessage(tbs));
  const subjectPop = await signWith(sig, certificatePopMessage(tbs));
  const certificate = assembleCertificate(tbs, issuerSignature, subjectPop);

  const device: TestDevice = {
    deviceId,
    sig,
    kem,
    certificate,
    chain: [{ certificate, subjectSigSpki: sig.spki, subjectKemSpki: kem.spki }, ...issuer.chain],
    assurance: options.assurance ?? ASSURANCE.webNonExtractable,
    platform: options.platform ?? 'web',
    grantedDomains: options.grantedDomains,
  };
  account.devices.push(device);
  return device;
}

/**
 * An attacker device with no certificate.
 *
 * Models exactly what a malicious `service_role` can produce: a row in
 * `devices` with real public keys and `status = 'ACTIVE'`, and nothing signed.
 */
export async function createUncertifiedDevice(): Promise<{
  deviceId: Uint8Array;
  sig: TestKeyPair;
  kem: TestKeyPair;
}> {
  return {
    deviceId: uuidToBytes(crypto.randomUUID()),
    sig: await makePair('ECDSA'),
    kem: await makePair('ECDH'),
  };
}

/** Seal a scope key to a recipient using real GLK2. */
export async function sealScopeKeyFrom(
  sender: TestDevice,
  recipient: { id: Uint8Array; kemSpki: Uint8Array; kind?: number },
  scopeKey: Uint8Array,
  header: {
    domain: (typeof KEY_DOMAIN)[keyof typeof KEY_DOMAIN];
    scopeKeyId: Uint8Array;
    ownerUserId: Uint8Array;
    scopeId: Uint8Array;
    epoch: bigint;
  },
): Promise<Uint8Array> {
  return sealScopeKeyForRecipient({
    scopeKey,
    recipientKemSpki: recipient.kemSpki,
    recipientId: recipient.id,
    recipientKind: recipient.kind ?? RECIPIENT_KIND.device,
    senderDeviceId: sender.deviceId,
    senderSigSpki: sender.sig.spki,
    sign: (message) => signWith(sender.sig, message),
    makeEphemeral: (peer) => generateEphemeralAgreement(peer),
    header,
    nowMs: 1_770_000_000_000n,
  });
}

export { generateScopeKeyBytes };
