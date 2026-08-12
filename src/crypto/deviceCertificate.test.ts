/**
 * Device certificate chain verification.
 *
 * These are the tests that stand between the architecture and the attack that
 * broke V2: a malicious server inserting a device row it controls and being
 * handed a scope key. Nothing in the verifier reads device status, so the tests
 * are written the same way — an attacker device here is simply a device with
 * real keys and no signature chain.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { hex, uuidToBytes } from './bytes';
import { ASSURANCE } from './domains';
import {
  CERTIFICATE_LENGTH,
  CERT_OFFSET,
  ISSUER_KIND,
  TBS_LENGTH,
  assembleCertificate,
  certificatePopMessage,
  certificateSignedMessage,
  decodeTbs,
  encodeTbs,
  isDeviceTrusted,
  splitCertificate,
  verifyCertificateChain,
  type CertificateWithKeys,
} from './deviceCertificate';
import { publicKeyFingerprint, randomBytes } from './suite';
import {
  addEnrolledDevice,
  createTestAccount,
  createUncertifiedDevice,
  signWith,
  type TestAccount,
  type TestDevice,
} from './testing/virtualAccount';

let account: TestAccount;
let root: TestDevice;
let second: TestDevice;
const NOW = 1_800_000_000_000n;

beforeAll(async () => {
  account = await createTestAccount();
  root = account.devices[0];
  second = await addEnrolledDevice(account, root, { grantedDomains: ['personal', 'couple'] });
});

describe('certificate structure', () => {
  it('is 445 bytes with a 317-byte body', () => {
    expect(root.certificate.length).toBe(CERTIFICATE_LENGTH);
    expect(CERTIFICATE_LENGTH).toBe(TBS_LENGTH + 64 + 64);
  });

  it('round-trips every body field', () => {
    const body = decodeTbs(splitCertificate(root.certificate).tbs);
    expect(body.issuerKind).toBe(ISSUER_KIND.recoveryIdentity);
    expect(hex(body.userId)).toBe(hex(account.userId));
    expect(hex(body.rootRecSigPubFp)).toBe(hex(account.recSig.fingerprint));
    expect(body.grantedDomains.sort()).toEqual(['couple', 'health', 'personal']);
    expect(body.subjectAssurance).toBe(ASSURANCE.secureEnclave);
    expect(body.subjectPlatform).toBe('ios');
  });

  it('rejects a non-zero reserved byte and an unknown version', () => {
    const tbs = splitCertificate(root.certificate).tbs.slice();
    tbs[CERT_OFFSET.reserved] = 1;
    expect(() => decodeTbs(tbs)).toThrow(/E_RESERVED_NONZERO/);

    const version = splitCertificate(root.certificate).tbs.slice();
    version[CERT_OFFSET.certVersion] = 2;
    expect(() => decodeTbs(version)).toThrow(/E_BAD_VERSION/);

    expect(() => splitCertificate(root.certificate.slice(0, 444))).toThrow(/E_CERT_LENGTH/);
  });
});

describe('valid chains', () => {
  it('verifies a root device', async () => {
    const verified = await verifyCertificateChain({ chain: root.chain, anchor: account.anchor, atMs: NOW });
    expect(hex(verified.deviceId)).toBe(hex(root.deviceId));
    expect(verified.grantedDomains).toContain('health');
  });

  it('verifies a depth-2 enrolled device', async () => {
    const verified = await verifyCertificateChain({ chain: second.chain, anchor: account.anchor, atMs: NOW });
    expect(hex(verified.deviceId)).toBe(hex(second.deviceId));
    expect(verified.grantedDomains).not.toContain('health');
  });

  it('enforces the required domain against the leaf grant', async () => {
    await expect(
      verifyCertificateChain({
        chain: second.chain,
        anchor: account.anchor,
        atMs: NOW,
        requiredDomain: 'health',
      }),
    ).rejects.toThrow(/E_DOMAIN_NOT_GRANTED/);

    await expect(
      verifyCertificateChain({
        chain: second.chain,
        anchor: account.anchor,
        atMs: NOW,
        requiredDomain: 'couple',
      }),
    ).resolves.toBeTruthy();
  });
});

describe('ATTACK: server-inserted device without a certificate', () => {
  it('cannot be trusted, because there is no chain to verify', async () => {
    const attacker = await createUncertifiedDevice();
    // What a malicious service_role actually has: real keys, a row it wrote,
    // and nothing signed by the account's recovery key.
    const forged: CertificateWithKeys[] = [];
    await expect(
      verifyCertificateChain({ chain: forged, anchor: account.anchor, atMs: NOW }),
    ).rejects.toThrow(/E_EMPTY_CHAIN/);
    expect(await isDeviceTrusted({ chain: forged, anchor: account.anchor, atMs: NOW })).toBeNull();
    expect(attacker.deviceId.length).toBe(16);
  });

  it('cannot self-sign a certificate that chains to the pinned root', async () => {
    const attacker = await createUncertifiedDevice();
    const attackerRecoveryId = uuidToBytes(crypto.randomUUID());

    // The attacker signs its own certificate with its own key and claims to be
    // a root. It cannot produce the account's rec_sig signature.
    const tbs = encodeTbs({
      issuerKind: ISSUER_KIND.recoveryIdentity,
      subjectAssurance: ASSURANCE.secureEnclave,
      subjectPlatform: 'ios',
      grantedDomains: ['personal', 'couple', 'health'],
      userId: account.userId,
      serverOriginId: account.serverOriginId,
      recoveryIdentityId: account.recoveryIdentityId,
      recoveryVersion: account.recoveryVersion,
      rootRecSigPubFp: account.recSig.fingerprint,
      issuerId: account.recoveryIdentityId,
      issuerSigPubFp: account.recSig.fingerprint,
      subjectDeviceId: attacker.deviceId,
      subjectSigPubFp: attacker.sig.fingerprint,
      subjectKemPubFp: attacker.kem.fingerprint,
      notBeforeMs: 0n,
      notAfterMs: 0n,
      ceremonyNonce: randomBytes(32),
      ceremonyTranscriptHash: new Uint8Array(32),
    });
    const certificate = assembleCertificate(
      tbs,
      await signWith(attacker.sig, certificateSignedMessage(tbs)),
      await signWith(attacker.sig, certificatePopMessage(tbs)),
    );

    await expect(
      verifyCertificateChain({
        chain: [{ certificate, subjectSigSpki: attacker.sig.spki, subjectKemSpki: attacker.kem.spki }],
        anchor: account.anchor,
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_BAD_ISSUER_SIGNATURE/);
    expect(attackerRecoveryId.length).toBe(16);
  });

  it('cannot substitute its own recovery root', async () => {
    // The attacker builds a complete, internally consistent account of its own
    // and presents it. The pinned anchor is what refuses it.
    const attackerAccount = await createTestAccount({ userId: crypto.randomUUID() });
    await expect(
      verifyCertificateChain({
        chain: attackerAccount.devices[0].chain,
        anchor: account.anchor,
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_USER_MISMATCH|E_ROOT_MISMATCH|E_ORIGIN_MISMATCH/);
  });

  it('cannot reuse a legitimate certificate with a different key', async () => {
    const attacker = await createUncertifiedDevice();
    await expect(
      verifyCertificateChain({
        chain: [{
          certificate: root.certificate,
          subjectSigSpki: attacker.sig.spki,
          subjectKemSpki: root.kem.spki,
        }],
        anchor: account.anchor,
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_SUBJECT_SIG_FP_MISMATCH/);
  });

  it('cannot swap the agreement key while keeping the signing key', async () => {
    const attacker = await createUncertifiedDevice();
    await expect(
      verifyCertificateChain({
        chain: [{
          certificate: root.certificate,
          subjectSigSpki: root.sig.spki,
          subjectKemSpki: attacker.kem.spki,
        }],
        anchor: account.anchor,
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_SUBJECT_KEM_FP_MISMATCH/);
  });
});

describe('chain integrity', () => {
  it('rejects a forged proof of possession', async () => {
    const attacker = await createUncertifiedDevice();
    const tbs = encodeTbs({
      issuerKind: ISSUER_KIND.device,
      subjectAssurance: ASSURANCE.webNonExtractable,
      subjectPlatform: 'web',
      grantedDomains: ['couple'],
      userId: account.userId,
      serverOriginId: account.serverOriginId,
      recoveryIdentityId: account.recoveryIdentityId,
      recoveryVersion: account.recoveryVersion,
      rootRecSigPubFp: account.recSig.fingerprint,
      issuerId: root.deviceId,
      issuerSigPubFp: root.sig.fingerprint,
      subjectDeviceId: attacker.deviceId,
      subjectSigPubFp: attacker.sig.fingerprint,
      subjectKemPubFp: attacker.kem.fingerprint,
      notBeforeMs: 0n,
      notAfterMs: 0n,
      ceremonyNonce: randomBytes(32),
      ceremonyTranscriptHash: new Uint8Array(32),
    });
    // Issuer signature is genuine; the PoP is signed by the wrong key.
    const certificate = assembleCertificate(
      tbs,
      await signWith(root.sig, certificateSignedMessage(tbs)),
      await signWith(root.sig, certificatePopMessage(tbs)),
    );
    await expect(
      verifyCertificateChain({
        chain: [
          { certificate, subjectSigSpki: attacker.sig.spki, subjectKemSpki: attacker.kem.spki },
          ...root.chain,
        ],
        anchor: account.anchor,
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_BAD_POP/);
  });

  it('rejects grant escalation by an issuer', async () => {
    // `second` holds personal+couple. It tries to grant health.
    const escalated = await addEnrolledDevice(account, second, {
      grantedDomains: ['personal', 'couple', 'health'],
    });
    await expect(
      verifyCertificateChain({ chain: escalated.chain, anchor: account.anchor, atMs: NOW }),
    ).rejects.toThrow(/E_GRANT_ESCALATION/);
  });

  it('rejects a chain that never reaches the root', async () => {
    await expect(
      verifyCertificateChain({ chain: [second.chain[0]], anchor: account.anchor, atMs: NOW }),
    ).rejects.toThrow(/E_INCOMPLETE_CHAIN/);
  });

  it('rejects a chain deeper than the limit', async () => {
    const chain = Array.from({ length: 9 }, () => second.chain[0]);
    await expect(
      verifyCertificateChain({ chain, anchor: account.anchor, atMs: NOW }),
    ).rejects.toThrow(/E_CHAIN_TOO_DEEP/);
  });

  it('rejects a superseded recovery generation', async () => {
    await expect(
      verifyCertificateChain({
        chain: root.chain,
        anchor: { ...account.anchor, recoveryVersion: 2 },
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_RECOVERY_VERSION_MISMATCH/);
  });

  it('rejects a different recovery identity and a different deployment', async () => {
    await expect(
      verifyCertificateChain({
        chain: root.chain,
        anchor: { ...account.anchor, recoveryIdentityId: uuidToBytes(crypto.randomUUID()) },
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_RECOVERY_IDENTITY_MISMATCH/);

    await expect(
      verifyCertificateChain({
        chain: root.chain,
        anchor: { ...account.anchor, serverOriginId: randomBytes(32) },
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_ORIGIN_MISMATCH/);
  });
});

describe('validity windows and revocation', () => {
  it('rejects a certificate outside its validity window', async () => {
    const timed = await addEnrolledDevice(account, root, { grantedDomains: ['couple'] });
    const { tbs } = splitCertificate(timed.certificate);
    const body = decodeTbs(tbs);
    const rebuilt = encodeTbs({ ...body, notBeforeMs: 2_000_000_000_000n, notAfterMs: 3_000_000_000_000n });
    const certificate = assembleCertificate(
      rebuilt,
      await signWith(root.sig, certificateSignedMessage(rebuilt)),
      await signWith(timed.sig, certificatePopMessage(rebuilt)),
    );
    const chain = [
      { certificate, subjectSigSpki: timed.sig.spki, subjectKemSpki: timed.kem.spki },
      ...root.chain,
    ];
    await expect(
      verifyCertificateChain({ chain, anchor: account.anchor, atMs: 1_000_000_000_000n }),
    ).rejects.toThrow(/E_NOT_YET_VALID/);
    await expect(
      verifyCertificateChain({ chain, anchor: account.anchor, atMs: 4_000_000_000_000n }),
    ).rejects.toThrow(/E_EXPIRED/);
    await expect(
      verifyCertificateChain({ chain, anchor: account.anchor, atMs: 2_500_000_000_000n }),
    ).resolves.toBeTruthy();
  });

  it('rejects a revoked device at a time after revocation, and allows it before', async () => {
    const revokedAtMs = 1_700_000_000_000n;
    const isRevoked = (deviceId: Uint8Array) => (
      hex(deviceId) === hex(second.deviceId) ? { revokedAtMs } : null
    );

    // Eligibility now: refused.
    await expect(
      verifyCertificateChain({ chain: second.chain, anchor: account.anchor, atMs: NOW, isRevoked }),
    ).rejects.toThrow(/E_REVOKED/);

    // A historical envelope written before revocation still verifies, which is
    // what keeps previously legitimate envelopes readable.
    await expect(
      verifyCertificateChain({
        chain: second.chain,
        anchor: account.anchor,
        atMs: revokedAtMs - 1n,
        isRevoked,
      }),
    ).resolves.toBeTruthy();
  });

  it('exposes the subject keys it verified', async () => {
    const verified = await verifyCertificateChain({ chain: root.chain, anchor: account.anchor, atMs: NOW });
    expect(hex(await publicKeyFingerprint(verified.sigSpki))).toBe(hex(root.sig.fingerprint));
    expect(hex(await publicKeyFingerprint(verified.kemSpki))).toBe(hex(root.kem.fingerprint));
  });
});
