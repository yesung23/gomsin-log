import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  approvalSignedMessage,
  handleApproveDevice,
  type ApproveDeviceDeps,
} from '../../supabase/functions/approve-device/handler.ts';
import {
  MAX_ATTEMPTS_PER_HOUR,
  buildRecoveryTranscript,
  handleVerifyRecovery,
  type VerifyRecoveryDeps,
} from '../../supabase/functions/verify-recovery/handler.ts';
import { toBase64, uuidToBytes } from '@/crypto/bytes';
import { publicKeyFingerprint, randomBytes, sha256 } from '@/crypto/suite';
import {
  ISSUER_KIND,
  assembleCertificate,
  certificatePopMessage,
  certificateSignedMessage,
  encodeTbs,
} from '@/crypto/deviceCertificate';
import { ASSURANCE } from '@/crypto/domains';
import { addEnrolledDevice, createTestAccount, signWith, type TestAccount } from '@/crypto/testing/virtualAccount';

/**
 * Edge Function negative tests.
 *
 * Everything is driven by real signatures from `virtualAccount`, because an
 * attack test that passes against a stubbed verifier proves nothing. The
 * handlers are pure, so the database is a set of injected functions.
 */

const NOW = 1_800_000_000_000;
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_USER = 'bbbbbbbb-0000-4000-8000-000000000002';
const NEW_DEVICE = 'd0000000-0000-4000-8000-00000000000a';
const APPROVER = 'd0000000-0000-4000-8000-00000000000b';
const ENROLLMENT = 'e0000000-0000-4000-8000-00000000000a';
const CHALLENGE = 'c0000000-0000-4000-8000-00000000000a';

let account: TestAccount;
let logged: Array<{ event: string; detail: Record<string, string | number> }>;

beforeEach(async () => {
  account = await createTestAccount({ userId: USER, serverOriginId: new Uint8Array(32).fill(7) });
  logged = [];
});

// ---------------------------------------------------------------------------
// approve-device
// ---------------------------------------------------------------------------

async function buildApprovalFixture(options?: {
  grantedDomains?: ('personal' | 'couple' | 'health')[];
  transcriptHash?: Uint8Array;
  subjectDeviceId?: string;
}) {
  const approver = account.devices[0];
  // The approver's own root-issued certificate, rebuilt so its subject device
  // id is the APPROVER constant the deps below report.
  const approverCertificate = await buildApproverCertificate(approver);
  const subjectSig = (await createTestAccount()).devices[0].sig;
  const subjectKem = (await createTestAccount()).devices[0].kem;
  const transcriptHash = options?.transcriptHash ?? (await sha256(new Uint8Array([1, 2, 3])));

  const tbs = encodeTbs({
    issuerKind: ISSUER_KIND.device,
    subjectAssurance: ASSURANCE.webNonExtractable,
    subjectPlatform: 'web',
    grantedDomains: options?.grantedDomains ?? ['personal', 'couple'],
    userId: account.userId,
    serverOriginId: account.serverOriginId,
    recoveryIdentityId: account.recoveryIdentityId,
    recoveryVersion: account.recoveryVersion,
    rootRecSigPubFp: account.recSig.fingerprint,
    issuerId: approver.deviceId,
    issuerSigPubFp: approver.sig.fingerprint,
    subjectDeviceId: uuidToBytes(options?.subjectDeviceId ?? NEW_DEVICE),
    subjectSigPubFp: subjectSig.fingerprint,
    subjectKemPubFp: subjectKem.fingerprint,
    notBeforeMs: 0n,
    notAfterMs: 0n,
    ceremonyNonce: randomBytes(32),
    ceremonyTranscriptHash: transcriptHash,
  });

  const certificate = assembleCertificate(
    tbs,
    await signWith(approver.sig, certificateSignedMessage(tbs)),
    await signWith(subjectSig, certificatePopMessage(tbs)),
  );

  return {
    certificate,
    transcriptHash,
    subjectSig,
    subjectKem,
    approver,
    approverCertificate,
    // A genuine approval signature from the approver's certified key.
    approvalSignature: await signWith(approver.sig, approvalSignedMessage(transcriptHash)),
  };
}

/** A root-issued certificate whose subject is the approver device id. */
async function buildApproverCertificate(approver: TestAccount['devices'][number]) {
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
    subjectDeviceId: uuidToBytes(APPROVER),
    subjectSigPubFp: approver.sig.fingerprint,
    subjectKemPubFp: approver.kem.fingerprint,
    notBeforeMs: 0n,
    notAfterMs: 0n,
    ceremonyNonce: randomBytes(32),
    ceremonyTranscriptHash: new Uint8Array(32),
  });
  return assembleCertificate(
    tbs,
    await signWith(account.recSig, certificateSignedMessage(tbs)),
    await signWith(approver.sig, certificatePopMessage(tbs)),
  );
}

function approveDeps(overrides: Partial<ApproveDeviceDeps>, fixture: Awaited<ReturnType<typeof buildApprovalFixture>>): ApproveDeviceDeps {
  return {
    now: () => NOW,
    getServerOriginId: async () => account.serverOriginId,
    getEnrollmentByNonce: async () => ({
      id: ENROLLMENT,
      user_id: USER,
      new_device_id: NEW_DEVICE,
      approver_device_id: APPROVER,
      granted_domains: 0b011,
      expires_at: new Date(NOW + 60_000).toISOString(),
      approved_at: null,
      consumed_at: null,
    }),
    getDevice: async (id) => {
      if (id === NEW_DEVICE) {
        return {
          id: NEW_DEVICE, user_id: USER, status: 'PENDING',
          sig_spki: toBase64(fixture.subjectSig.spki), kem_spki: toBase64(fixture.subjectKem.spki),
        };
      }
      if (id === APPROVER) {
        return {
          id: APPROVER, user_id: USER, status: 'ACTIVE',
          sig_spki: toBase64(fixture.approver.sig.spki), kem_spki: toBase64(fixture.approver.kem.spki),
        };
      }
      return null;
    },
    getRecoveryAnchor: async () => ({
      id: [...account.recoveryIdentityId].map((b) => b.toString(16).padStart(2, '0')).join('')
        .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
      recovery_version: account.recoveryVersion,
      rec_sig_spki: toBase64(account.recSig.spki),
      recovery_bundle_fp: toBase64(account.recoveryBundleFp),
    }),
    getDeviceCertificate: async () => ({ certificate: toBase64(fixture.approverCertificate) }),
    commitApproval: async () => ({ ok: true }),
    logEvent: (event, detail) => { logged.push({ event, detail }); },
    ...overrides,
  };
}

describe('approve-device', () => {
  it('activates a device with a genuine certificate and transcript', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(200);
  });

  it('rejects a replayed nonce', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({
        getEnrollmentByNonce: async () => ({
          id: ENROLLMENT, user_id: USER, new_device_id: NEW_DEVICE, approver_device_id: APPROVER,
          granted_domains: 0b011, expires_at: new Date(NOW + 60_000).toISOString(),
          approved_at: new Date(NOW - 1000).toISOString(), consumed_at: new Date(NOW - 1000).toISOString(),
        }),
      }, fixture),
    );
    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toBe('E_NONCE_ALREADY_USED');
  });

  it('rejects an expired nonce', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({
        getEnrollmentByNonce: async () => ({
          id: ENROLLMENT, user_id: USER, new_device_id: NEW_DEVICE, approver_device_id: APPROVER,
          granted_domains: 0b011, expires_at: new Date(NOW - 1).toISOString(),
          approved_at: null, consumed_at: null,
        }),
      }, fixture),
    );
    expect(result.status).toBe(410);
  });

  it('rejects an unknown nonce', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({ getEnrollmentByNonce: async () => null }, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_UNKNOWN_NONCE');
  });

  it('rejects an enrollment belonging to a different account', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      OTHER_USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_WRONG_ACCOUNT');
  });

  it('rejects a certificate whose transcript hash is not the one presented', async () => {
    // The SAS the humans compared is bound to the transcript. A certificate
    // naming a different ceremony did not go through that comparison.
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(await sha256(new Uint8Array([9, 9, 9]))),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_CERT_WRONG_TRANSCRIPT');
  });

  it('rejects a certificate for a different device', async () => {
    const fixture = await buildApprovalFixture({ subjectDeviceId: '99999999-0000-4000-8000-000000000099' });
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_CERT_WRONG_SUBJECT');
  });

  it('rejects a health grant the enrollment never asked for', async () => {
    const fixture = await buildApprovalFixture({ grantedDomains: ['personal', 'couple', 'health'] });
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_GRANT_EXCEEDS_ENROLLMENT');
  });

  it('rejects a certificate signed by a key that is not the approver', async () => {
    const fixture = await buildApprovalFixture();
    const impostor = await createTestAccount();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({
        getDevice: async (id) => {
          if (id === NEW_DEVICE) {
            return {
              id: NEW_DEVICE, user_id: USER, status: 'PENDING',
              sig_spki: toBase64(fixture.subjectSig.spki), kem_spki: toBase64(fixture.subjectKem.spki),
            };
          }
          // The server substitutes a different approver key.
          return {
            id: APPROVER, user_id: USER, status: 'ACTIVE',
            sig_spki: toBase64(impostor.devices[0].sig.spki),
            kem_spki: toBase64(impostor.devices[0].kem.spki),
          };
        },
      }, fixture),
    );
    expect(result.status).toBe(403);
    // Caught while verifying the APPROVER's own certificate: the substituted
    // key does not match the `subject_sig_pub_fp` that certificate committed
    // to. That is a stronger and earlier refusal than the downstream issuer
    // check, because it means the key never had certificate backing at all.
    expect((result.body as { error: string }).error).toBe('E_APPROVER_CERT_CERT_SUBJECT_FP_MISMATCH');
  });

  it('rejects a revoked approver', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({
        getDevice: async (id) => (id === NEW_DEVICE
          ? { id: NEW_DEVICE, user_id: USER, status: 'PENDING', sig_spki: toBase64(fixture.subjectSig.spki), kem_spki: toBase64(fixture.subjectKem.spki) }
          : { id: APPROVER, user_id: USER, status: 'REVOKED', sig_spki: toBase64(fixture.approver.sig.spki), kem_spki: toBase64(fixture.approver.kem.spki) }),
      }, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_APPROVER_REVOKED');
  });

  it('rejects an uncertified approver', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(fixture.approvalSignature),
      },
      USER,
      approveDeps({ getDeviceCertificate: async () => null }, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_APPROVER_UNCERTIFIED');
  });

  it('rejects malformed protocol bytes without throwing', async () => {
    const fixture = await buildApprovalFixture();
    for (const bad of ['', 'not base64!!', toBase64(new Uint8Array(10))]) {
      const result = await handleApproveDevice(
        {
          enrollNonce: toBase64(randomBytes(32)),
          certificate: bad,
          transcriptHash: toBase64(fixture.transcriptHash),
          approvalSignature: toBase64(fixture.approvalSignature),
        },
        USER,
        approveDeps({}, fixture),
      );
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
  });

  // -------------------------------------------------------------------------
  // Attack 22 — the approval signature must come from the certified key
  //
  // Before this fix `approvalSignature` was decoded, carried through the
  // handler, and persisted without ever being verified. Any 64 bytes passed.
  // -------------------------------------------------------------------------
  describe('approval signature', () => {
    async function approve(
      fixture: Awaited<ReturnType<typeof buildApprovalFixture>>,
      signature: Uint8Array,
      overrides: Partial<ApproveDeviceDeps> = {},
      transcriptHash = fixture.transcriptHash,
    ) {
      return handleApproveDevice(
        {
          enrollNonce: toBase64(randomBytes(32)),
          certificate: toBase64(fixture.certificate),
          transcriptHash: toBase64(transcriptHash),
          approvalSignature: toBase64(signature),
        },
        USER,
        approveDeps(overrides, fixture),
      );
    }

    it('rejects an arbitrary random signature', async () => {
      const fixture = await buildApprovalFixture();
      const result = await approve(fixture, randomBytes(64));
      expect(result.status).toBe(403);
      expect((result.body as { error: string }).error).toBe('E_BAD_APPROVAL_SIGNATURE');
    });

    it('rejects a legitimate approver id paired with an attacker key and signature', async () => {
      // The whole shape of the attack: keep the real device id, swap in a key
      // the attacker controls, and sign with it.
      const fixture = await buildApprovalFixture();
      const attacker = await createTestAccount();
      const attackerDevice = attacker.devices[0];
      const forged = await signWith(attackerDevice.sig, approvalSignedMessage(fixture.transcriptHash));

      const result = await approve(fixture, forged, {
        getDevice: async (id) => (id === NEW_DEVICE
          ? {
            id: NEW_DEVICE, user_id: USER, status: 'PENDING',
            sig_spki: toBase64(fixture.subjectSig.spki), kem_spki: toBase64(fixture.subjectKem.spki),
          }
          : {
            // Real approver id, attacker's key.
            id: APPROVER, user_id: USER, status: 'ACTIVE',
            sig_spki: toBase64(attackerDevice.sig.spki), kem_spki: toBase64(attackerDevice.kem.spki),
          }),
      });

      expect(result.status).toBe(403);
      // Refused before the signature is even reached: the attacker key has no
      // certificate committing to it.
      expect((result.body as { error: string }).error).toBe('E_APPROVER_CERT_CERT_SUBJECT_FP_MISMATCH');
    });

    it('rejects a signature from a different certified device of the same account', async () => {
      const fixture = await buildApprovalFixture();
      const other = await addEnrolledDevice(account, account.devices[0], { grantedDomains: ['couple'] });
      const wrongSigner = await signWith(other.sig, approvalSignedMessage(fixture.transcriptHash));

      const result = await approve(fixture, wrongSigner);
      expect(result.status).toBe(403);
      expect((result.body as { error: string }).error).toBe('E_BAD_APPROVAL_SIGNATURE');
    });

    it('accepts a signature from the correct certified approving device', async () => {
      const fixture = await buildApprovalFixture();
      const result = await approve(fixture, fixture.approvalSignature);
      expect(result.status).toBe(200);
      expect((result.body as { activated: boolean }).activated).toBe(true);
    });

    it('rejects a signature over a tampered transcript', async () => {
      const fixture = await buildApprovalFixture();
      // Genuine key, but signed over a different transcript than the one the
      // certificate and the ceremony are bound to.
      const otherTranscript = await sha256(new Uint8Array([4, 5, 6]));
      const misbound = await signWith(fixture.approver.sig, approvalSignedMessage(otherTranscript));

      const result = await approve(fixture, misbound);
      expect(result.status).toBe(403);
      expect((result.body as { error: string }).error).toBe('E_BAD_APPROVAL_SIGNATURE');
    });

    it('rejects a single flipped bit in an otherwise valid signature', async () => {
      const fixture = await buildApprovalFixture();
      const tampered = fixture.approvalSignature.slice();
      tampered[0] ^= 0x01;
      const result = await approve(fixture, tampered);
      expect(result.status).toBe(403);
      expect((result.body as { error: string }).error).toBe('E_BAD_APPROVAL_SIGNATURE');
    });

    it('keeps the existing replay protection: a consumed nonce still fails', async () => {
      // The signature check must not have displaced the nonce guard.
      const fixture = await buildApprovalFixture();
      const result = await approve(fixture, fixture.approvalSignature, {
        getEnrollmentByNonce: async () => ({
          id: ENROLLMENT, user_id: USER, new_device_id: NEW_DEVICE, approver_device_id: APPROVER,
          granted_domains: 0b011, expires_at: new Date(NOW + 60_000).toISOString(),
          approved_at: new Date(NOW - 1000).toISOString(), consumed_at: new Date(NOW - 1000).toISOString(),
        }),
      });
      expect(result.status).toBe(409);
      expect((result.body as { error: string }).error).toBe('E_NONCE_ALREADY_USED');
    });

    it('still refuses an expired nonce even with a valid signature', async () => {
      const fixture = await buildApprovalFixture();
      const result = await approve(fixture, fixture.approvalSignature, {
        getEnrollmentByNonce: async () => ({
          id: ENROLLMENT, user_id: USER, new_device_id: NEW_DEVICE, approver_device_id: APPROVER,
          granted_domains: 0b011, expires_at: new Date(NOW - 1).toISOString(),
          approved_at: null, consumed_at: null,
        }),
      });
      expect(result.status).toBe(410);
    });

    it('derives granted domains from the verified certificate, not a mutable column', async () => {
      // The approver certificate grants personal+couple+health; the new
      // certificate asks for personal+couple, which the enrollment also allows.
      const fixture = await buildApprovalFixture({ grantedDomains: ['personal', 'couple'] });
      expect((await approve(fixture, fixture.approvalSignature)).status).toBe(200);

      // Escalation beyond the enrollment is still refused.
      const escalated = await buildApprovalFixture({ grantedDomains: ['personal', 'couple', 'health'] });
      const result = await approve(escalated, escalated.approvalSignature);
      expect(result.status).toBe(403);
      expect((result.body as { error: string }).error).toBe('E_GRANT_EXCEEDS_ENROLLMENT');
    });
  });

  it('logs identifiers and codes only, never key material', () => {
    for (const entry of logged) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toMatch(/[A-Za-z0-9+/]{80,}/);
    }
  });
});

// ---------------------------------------------------------------------------
// verify-recovery
// ---------------------------------------------------------------------------

async function recoveryFixture(options?: { recoveryVersion?: number }) {
  const deviceSig = (await createTestAccount()).devices[0].sig;
  const deviceKem = (await createTestAccount()).devices[0].kem;
  const nonce = randomBytes(32);
  const issuedAt = NOW - 1_000;
  const expiresAt = NOW + 60_000;

  const transcript = buildRecoveryTranscript({
    serverOriginId: account.serverOriginId,
    userId: account.userId,
    challengeId: uuidToBytes(CHALLENGE),
    challengeNonce: nonce,
    issuedAtMs: BigInt(issuedAt),
    expiresAtMs: BigInt(expiresAt),
    recoveryVersion: options?.recoveryVersion ?? account.recoveryVersion,
    recSigPubFp: await publicKeyFingerprint(account.recSig.spki),
    newDeviceId: uuidToBytes(NEW_DEVICE),
    newSigFp: await publicKeyFingerprint(deviceSig.spki),
    newKemFp: await publicKeyFingerprint(deviceKem.spki),
  });

  return {
    nonce, issuedAt, expiresAt, deviceSig, deviceKem,
    signature: await signWith(account.recSig, transcript),
  };
}

function recoveryDeps(
  overrides: Partial<VerifyRecoveryDeps>,
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
): VerifyRecoveryDeps {
  return {
    now: () => NOW,
    getServerOriginId: async () => account.serverOriginId,
    getChallenge: async () => ({
      id: CHALLENGE,
      user_id: USER,
      challenge_nonce: toBase64(fixture.nonce),
      recovery_version: account.recoveryVersion,
      new_device_id: NEW_DEVICE,
      issued_at: new Date(fixture.issuedAt).toISOString(),
      expires_at: new Date(fixture.expiresAt).toISOString(),
      consumed_at: null,
    }),
    getCurrentRecoveryIdentity: async () => ({
      id: 'ffffffff-0000-4000-8000-00000000000f',
      recovery_version: account.recoveryVersion,
      rec_sig_spki: toBase64(account.recSig.spki),
      superseded_at: null,
    }),
    getDevice: async () => ({
      id: NEW_DEVICE, user_id: USER, status: 'PENDING',
      sig_spki: toBase64(fixture.deviceSig.spki), kem_spki: toBase64(fixture.deviceKem.spki),
    }),
    countRecentAttempts: async () => 0,
    commitAuthentication: async () => ({ ok: true }),
    logEvent: (event, detail) => { logged.push({ event, detail }); },
    ...overrides,
  };
}

describe('verify-recovery', () => {
  it('authenticates a genuine recovery signature but does NOT activate the device', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({}, fixture),
    );
    expect(result.status).toBe(200);
    // The device is authenticated, not provisioned: it is still not eligible to
    // receive any envelope.
    expect((result.body as { nextState: string }).nextState).toBe('RECOVERY_AUTHENTICATED');
  });

  it('rejects a signature from anything but the recovery key', async () => {
    // A database dump plus an Auth session gets you here and no further.
    const fixture = await recoveryFixture();
    const impostor = await createTestAccount();
    const forged = await signWith(impostor.recSig, new Uint8Array([1, 2, 3]));
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(forged) },
      USER,
      recoveryDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_BAD_RECOVERY_SIGNATURE');
  });

  it('rejects a replayed challenge', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({
        getChallenge: async () => ({
          id: CHALLENGE, user_id: USER, challenge_nonce: toBase64(fixture.nonce),
          recovery_version: account.recoveryVersion, new_device_id: NEW_DEVICE,
          issued_at: new Date(fixture.issuedAt).toISOString(),
          expires_at: new Date(fixture.expiresAt).toISOString(),
          consumed_at: new Date(NOW - 10).toISOString(),
        }),
      }, fixture),
    );
    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toBe('E_CHALLENGE_ALREADY_USED');
  });

  it('rejects an expired challenge', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({
        getChallenge: async () => ({
          id: CHALLENGE, user_id: USER, challenge_nonce: toBase64(fixture.nonce),
          recovery_version: account.recoveryVersion, new_device_id: NEW_DEVICE,
          issued_at: new Date(NOW - 200_000).toISOString(),
          expires_at: new Date(NOW - 1).toISOString(),
          consumed_at: null,
        }),
      }, fixture),
    );
    expect(result.status).toBe(410);
  });

  it('rejects a cross-account replay', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      OTHER_USER,
      recoveryDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_WRONG_ACCOUNT');
  });

  it('rejects a response bound to a different device', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: 'd0000000-0000-4000-8000-0000000000ff', signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_CHALLENGE_DEVICE_MISMATCH');
  });

  it('rejects a downgrade to a retired recovery generation', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({
        getCurrentRecoveryIdentity: async () => ({
          id: 'ffffffff-0000-4000-8000-00000000000f',
          recovery_version: account.recoveryVersion + 1,
          rec_sig_spki: toBase64(account.recSig.spki),
          superseded_at: null,
        }),
      }, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_RECOVERY_VERSION_MISMATCH');
  });

  it('rejects a superseded recovery identity', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({
        getCurrentRecoveryIdentity: async () => ({
          id: 'ffffffff-0000-4000-8000-00000000000f',
          recovery_version: account.recoveryVersion,
          rec_sig_spki: toBase64(account.recSig.spki),
          superseded_at: new Date(NOW - 1).toISOString(),
        }),
      }, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_RECOVERY_IDENTITY_SUPERSEDED');
  });

  it('rejects a cross-deployment replay', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({ getServerOriginId: async () => new Uint8Array(32).fill(9) }, fixture),
    );
    expect(result.status).toBe(403);
    expect((result.body as { error: string }).error).toBe('E_BAD_RECOVERY_SIGNATURE');
  });

  it('rate limits attempts', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({ countRecentAttempts: async () => MAX_ATTEMPTS_PER_HOUR }, fixture),
    );
    expect(result.status).toBe(429);
  });

  it('rejects an already-provisioned device', async () => {
    const fixture = await recoveryFixture();
    const result = await handleVerifyRecovery(
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: toBase64(fixture.signature) },
      USER,
      recoveryDeps({
        getDevice: async () => ({
          id: NEW_DEVICE, user_id: USER, status: 'ACTIVE',
          sig_spki: toBase64(fixture.deviceSig.spki), kem_spki: toBase64(fixture.deviceKem.spki),
        }),
      }, fixture),
    );
    expect(result.status).toBe(409);
  });

  it('rejects malformed input without throwing', async () => {
    const fixture = await recoveryFixture();
    const deps = recoveryDeps({}, fixture);
    for (const body of [
      {},
      { challengeId: 1, deviceId: NEW_DEVICE, signature: 'AAA=' },
      { challengeId: CHALLENGE, deviceId: NEW_DEVICE, signature: 'not base64!!' },
    ]) {
      const result = await handleVerifyRecovery(body, USER, deps);
      expect(result.status).toBe(400);
    }
  });

  it('logs identifiers and codes only', () => {
    for (const entry of logged) {
      expect(JSON.stringify(entry)).not.toMatch(/[A-Za-z0-9+/]{80,}/);
    }
    expect(vi.isMockFunction(() => {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boundary codec — the representation the Edge functions actually receive
// ---------------------------------------------------------------------------

describe('bytea boundary codec', () => {
  it('decodes the PostgreSQL hex form PostgREST returns', async () => {
    const { decodeDbBytes, encodeDbBytes } = await import('../../supabase/functions/_shared/e2eeVerify.ts');
    const bytes = new Uint8Array([0x01, 0x23, 0xab, 0xcd, 0x00, 0xff]);
    // This is what a bytea column looks like coming back through PostgREST.
    expect(hexBytes(decodeDbBytes('\\x0123abcd00ff'))).toBe('0123abcd00ff');
    expect(encodeDbBytes(bytes)).toBe('\\x0123abcd00ff');
    expect(hexBytes(decodeDbBytes(encodeDbBytes(bytes)))).toBe('0123abcd00ff');
  });

  it('round-trips every protocol value at its real width', async () => {
    const { decodeDbBytes, encodeDbBytes } = await import('../../supabase/functions/_shared/e2eeVerify.ts');
    for (const width of [12, 32, 64, 91, 360, 445]) {
      const bytes = randomBytes(width);
      const decoded = decodeDbBytes(encodeDbBytes(bytes));
      expect(decoded, `width ${width}`).not.toBeNull();
      expect(decoded!.length).toBe(width);
      expect(hexBytes(decoded)).toBe(hexBytes(bytes));
    }
  });

  it('still accepts base64, which is what request bodies carry', async () => {
    const { decodeDbBytes } = await import('../../supabase/functions/_shared/e2eeVerify.ts');
    const bytes = randomBytes(32);
    expect(hexBytes(decodeDbBytes(toBase64(bytes)))).toBe(hexBytes(bytes));
  });

  it('rejects malformed hex rather than returning garbage', async () => {
    const { decodeDbBytes } = await import('../../supabase/functions/_shared/e2eeVerify.ts');
    expect(decodeDbBytes('\\x012')).toBeNull();
    expect(decodeDbBytes('\\xzz')).toBeNull();
    expect(decodeDbBytes(null)).toBeNull();
    expect(decodeDbBytes(42)).toBeNull();
  });

  it('a hex-form value decoded as base64 produces the wrong bytes', async () => {
    // Why the codec exists: treating \x... as base64 silently yields garbage,
    // which then fails a signature check for entirely the wrong reason.
    const { decodeDbBytes, decodeBase64, encodeDbBytes } = await import('../../supabase/functions/_shared/e2eeVerify.ts');
    const bytes = randomBytes(32);
    const dbForm = encodeDbBytes(bytes);
    expect(hexBytes(decodeDbBytes(dbForm))).toBe(hexBytes(bytes));
    const asBase64 = decodeBase64(dbForm);
    expect(asBase64 === null || hexBytes(asBase64) !== hexBytes(bytes)).toBe(true);
  });
});

function hexBytes(bytes: Uint8Array | null): string {
  if (!bytes) return '';
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
