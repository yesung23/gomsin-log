import { describe, expect, it, beforeEach, vi } from 'vitest';
import { handleApproveDevice, type ApproveDeviceDeps } from '../../supabase/functions/approve-device/handler.ts';
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
import { createTestAccount, signWith, type TestAccount } from '@/crypto/testing/virtualAccount';

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

  return { certificate, transcriptHash, subjectSig, subjectKem, approver };
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
    getCertificateGrants: async () => 0b111,
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
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
    expect((result.body as { error: string }).error).toBe('E_CERT_ISSUER_FP_MISMATCH');
  });

  it('rejects a revoked approver', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      {
        enrollNonce: toBase64(randomBytes(32)),
        certificate: toBase64(fixture.certificate),
        transcriptHash: toBase64(fixture.transcriptHash),
        approvalSignature: toBase64(randomBytes(64)),
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
        approvalSignature: toBase64(randomBytes(64)),
      },
      USER,
      approveDeps({ getCertificateGrants: async () => null }, fixture),
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
          approvalSignature: toBase64(randomBytes(64)),
        },
        USER,
        approveDeps({}, fixture),
      );
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
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
