import { describe, expect, it, beforeEach } from 'vitest';
import {
  approvalSignedMessage,
  handleApproveDevice,
  type ApproveDeviceDeps,
  type CertificateRow,
} from '../../supabase/functions/approve-device/handler.ts';
import {
  MAX_ATTEMPTS_PER_HOUR,
  buildRecoveryTranscript,
  handleVerifyRecovery,
  type VerifyRecoveryDeps,
} from '../../supabase/functions/verify-recovery/handler.ts';
import {
  MAX_ISSUED_PER_HOUR,
  handleIssueRecoveryChallenge,
  type IssueRecoveryChallengeDeps,
} from '../../supabase/functions/issue-recovery-challenge/handler.ts';
import {
  decodeBase64,
  decodePgBytea,
  encodeBase64,
  encodePgBytea,
} from '../../supabase/functions/_shared/e2eeVerify.ts';
import { bytesToUuid, hex, toBase64, uuidToBytes } from '@/crypto/bytes';
import { publicKeyFingerprint, randomBytes, sha256 } from '@/crypto/suite';
import {
  ISSUER_KIND,
  assembleCertificate,
  certificatePopMessage,
  certificateSignedMessage,
  encodeTbs,
} from '@/crypto/deviceCertificate';
import { enrollmentTranscriptHash } from '@/crypto/transcripts';
import { revocationLogGenesis } from '@/crypto/revocation';
import { ASSURANCE, grantsToMask } from '@/crypto/domains';
import { createTestAccount, signWith, type TestAccount } from '@/crypto/testing/virtualAccount';

/**
 * Edge Function security tests.
 *
 * Everything is driven by real signatures from `virtualAccount`, because an
 * attack test that passes against a stubbed verifier proves nothing. The
 * handlers are pure, so the database is a set of injected functions.
 *
 * Two properties these tests exist to pin, beyond the individual attacks:
 *
 *   1. Every injected row is rendered the way PostgREST actually renders it —
 *      `bytea` as `\x…` hex. The previous revision handed the handlers base64
 *      and passed, because the codec accepted either. It would have failed
 *      against a real database.
 *
 *   2. The canonical enrollment transcript is built on the CLIENT side, with
 *      `src/crypto/transcripts.ts`, and verified by the server's own
 *      independent reconstruction in `_shared/e2eeTranscript.ts`. That is the
 *      only thing keeping those two encoders byte-identical, and a drift
 *      between them would otherwise surface as a failed enrollment in the field.
 */

const NOW = 1_800_000_000_000;
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_USER = 'bbbbbbbb-0000-4000-8000-000000000002';
const NEW_DEVICE = 'd0000000-0000-4000-8000-00000000000a';
const APPROVER = 'd0000000-0000-4000-8000-00000000000b';
const OTHER_DEVICE = 'd0000000-0000-4000-8000-00000000000c';
const ENROLLMENT = 'e0000000-0000-4000-8000-00000000000a';
const APPROVER_CERT = 'f0000000-0000-4000-8000-00000000000a';
const CHALLENGE = 'c0000000-0000-4000-8000-00000000000a';

let account: TestAccount;
let logged: Array<{ event: string; detail: Record<string, string | number> }>;

beforeEach(async () => {
  account = await createTestAccount({ userId: USER, serverOriginId: new Uint8Array(32).fill(7) });
  logged = [];
});

const recoveryIdentityUuid = () => bytesToUuid(account.recoveryIdentityId);

// ---------------------------------------------------------------------------
// approve-device
// ---------------------------------------------------------------------------

const ENROLL_NONCE = new Uint8Array(32).fill(0x5a);
const REQUESTED_MASK = grantsToMask(['personal', 'couple']);
const CREATED_AT = new Date(NOW - 60_000).toISOString();
const EXPIRES_AT = new Date(NOW + 60_000).toISOString();

type EnrollmentOverrides = {
  grantedDomainsMask?: number;
  enrollNonce?: Uint8Array;
  issuedAtMs?: bigint;
  expiresAtMs?: bigint;
  revocationLogHead?: Uint8Array;
  /** Changes only the transcript, leaving the stored row alone. */
  transcriptEnrollNonce?: Uint8Array;
  issuerCertFp?: Uint8Array;
  newSigFp?: Uint8Array;
  serverOriginId?: Uint8Array;
};

/**
 * Build the fixture the way an honest CLIENT would.
 *
 * The transcript hash comes from the client encoder. The server rebuilds it
 * from the rows below and must arrive at the same 32 bytes; every negative test
 * works by making exactly one of those inputs disagree.
 */
async function buildApprovalFixture(overrides: EnrollmentOverrides = {}) {
  const approver = account.devices[0];
  const approverCertificate = await buildApproverCertificate(approver);
  const subject = (await createTestAccount()).devices[0];

  const grantedDomainsMask = overrides.grantedDomainsMask ?? REQUESTED_MASK;
  const enrollNonce = overrides.enrollNonce ?? ENROLL_NONCE;

  const transcriptHash = await enrollmentTranscriptHash({
    userId: account.userId,
    serverOriginId: overrides.serverOriginId ?? account.serverOriginId,
    oldDeviceId: uuidToBytes(APPROVER),
    oldSigFp: approver.sig.fingerprint,
    oldKemFp: approver.kem.fingerprint,
    newDeviceId: uuidToBytes(NEW_DEVICE),
    newSigFp: overrides.newSigFp ?? subject.sig.fingerprint,
    newKemFp: subject.kem.fingerprint,
    recoveryIdentityId: account.recoveryIdentityId,
    recoveryVersion: account.recoveryVersion,
    rootRecSigPubFp: account.recSig.fingerprint,
    recoveryBundleFp: account.recoveryBundleFp,
    revocationLogHead: overrides.revocationLogHead
      ?? await revocationLogGenesis(account.userId, account.recoveryIdentityId),
    issuerCertFp: overrides.issuerCertFp ?? await sha256(approverCertificate),
    grantedDomainsMask,
    enrollNonce: overrides.transcriptEnrollNonce ?? enrollNonce,
    issuedAtMs: overrides.issuedAtMs ?? BigInt(Date.parse(CREATED_AT)),
    expiresAtMs: overrides.expiresAtMs ?? BigInt(Date.parse(EXPIRES_AT)),
  });

  const tbs = encodeTbs({
    issuerKind: ISSUER_KIND.device,
    subjectAssurance: ASSURANCE.webNonExtractable,
    subjectPlatform: 'web',
    grantedDomains: ['personal', 'couple'],
    userId: account.userId,
    serverOriginId: account.serverOriginId,
    recoveryIdentityId: account.recoveryIdentityId,
    recoveryVersion: account.recoveryVersion,
    rootRecSigPubFp: account.recSig.fingerprint,
    issuerId: uuidToBytes(APPROVER),
    issuerSigPubFp: approver.sig.fingerprint,
    subjectDeviceId: uuidToBytes(NEW_DEVICE),
    subjectSigPubFp: subject.sig.fingerprint,
    subjectKemPubFp: subject.kem.fingerprint,
    notBeforeMs: 0n,
    notAfterMs: 0n,
    // The ceremony nonce IS the enrollment nonce, so a certificate minted for
    // one enrollment cannot be presented against another.
    ceremonyNonce: enrollNonce,
    ceremonyTranscriptHash: transcriptHash,
  });

  const certificate = assembleCertificate(
    tbs,
    await signWith(approver.sig, certificateSignedMessage(tbs)),
    await signWith(subject.sig, certificatePopMessage(tbs)),
  );

  return {
    certificate,
    transcriptHash,
    subject,
    approver,
    approverCertificate,
    enrollNonce,
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

type Fixture = Awaited<ReturnType<typeof buildApprovalFixture>>;

function approveDeps(overrides: Partial<ApproveDeviceDeps>, fixture: Fixture): ApproveDeviceDeps {
  const approverChain: CertificateRow[] = [{
    id: APPROVER_CERT,
    subject_device_id: APPROVER,
    issuer_certificate_id: null,
    // Rendered exactly as PostgREST renders a `bytea`.
    certificate: encodePgBytea(fixture.approverCertificate),
    subject_sig_spki: encodePgBytea(fixture.approver.sig.spki),
    subject_kem_spki: encodePgBytea(fixture.approver.kem.spki),
  }];

  return {
    now: () => NOW,
    getServerOriginId: async () => account.serverOriginId,
    getEnrollment: async (id) => (id === ENROLLMENT ? {
      id: ENROLLMENT,
      user_id: USER,
      new_device_id: NEW_DEVICE,
      approver_device_id: APPROVER,
      enroll_nonce: encodePgBytea(fixture.enrollNonce),
      granted_domains: REQUESTED_MASK,
      created_at: CREATED_AT,
      expires_at: EXPIRES_AT,
      approved_at: null,
      consumed_at: null,
    } : null),
    getDevice: async (id) => {
      if (id === NEW_DEVICE) {
        return {
          id: NEW_DEVICE, user_id: USER, status: 'PENDING',
          sig_spki: encodePgBytea(fixture.subject.sig.spki),
          kem_spki: encodePgBytea(fixture.subject.kem.spki),
        };
      }
      if (id === APPROVER) {
        return {
          id: APPROVER, user_id: USER, status: 'ACTIVE',
          sig_spki: encodePgBytea(fixture.approver.sig.spki),
          kem_spki: encodePgBytea(fixture.approver.kem.spki),
        };
      }
      return null;
    },
    getRecoveryAnchor: async () => ({
      id: recoveryIdentityUuid(),
      recovery_version: account.recoveryVersion,
      rec_sig_spki: encodePgBytea(account.recSig.spki),
      recovery_bundle_fp: encodePgBytea(account.recoveryBundleFp),
    }),
    getCertificateChain: async (deviceId) => (deviceId === APPROVER ? approverChain : []),
    isDeviceRevoked: async () => false,
    getRevocationLogHead: async () => null,
    commitApproval: async () => ({ ok: true }),
    logEvent: (event, detail) => { logged.push({ event, detail }); },
    ...overrides,
  };
}

function approveRequest(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    enrollmentId: ENROLLMENT,
    certificate: toBase64(fixture.certificate),
    approvalSignature: toBase64(fixture.approvalSignature),
    ...overrides,
  };
}

describe('approve-device — canonical transcript reconstruction', () => {
  it('activates a device when the client and the server build the same transcript', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ activated: true, deviceId: NEW_DEVICE });
  });

  it('commits the SERVER transcript hash, not one the caller supplied', async () => {
    const fixture = await buildApprovalFixture();
    let committed: Uint8Array | null = null;
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      commitApproval: async (input) => { committed = input.transcriptHash; return { ok: true }; },
    }, fixture));
    expect(result.status).toBe(200);
    expect(hex(committed!)).toBe(hex(fixture.transcriptHash));
  });

  it('accepts no transcript field at all: extra body keys change nothing', async () => {
    const fixture = await buildApprovalFixture();
    // A caller that tries to dictate the transcript is simply ignored — the
    // parameter does not exist any more.
    const result = await handleApproveDevice(
      approveRequest(fixture, { transcriptHash: toBase64(new Uint8Array(32).fill(9)) }),
      USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(200);
  });

  // --- one changed transcript field at a time ------------------------------

  it('rejects a changed granted-domain mask', async () => {
    // The client signed a transcript claiming health as well; the server derives
    // the mask from the enrollment row and the approver certificate instead.
    const fixture = await buildApprovalFixture({ grantedDomainsMask: grantsToMask(['personal', 'couple', 'health']) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });

  it('rejects a changed issuedAt', async () => {
    const fixture = await buildApprovalFixture({ issuedAtMs: BigInt(NOW - 999_999) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });

  it('rejects a changed expiry', async () => {
    const fixture = await buildApprovalFixture({ expiresAtMs: BigInt(NOW + 999_999) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });

  it('rejects a stale revocation log head', async () => {
    // A client that enrolled against an older view of who is still trusted.
    const fixture = await buildApprovalFixture({ revocationLogHead: new Uint8Array(32).fill(0x11) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });

  it('rejects a transcript naming a different approving certificate', async () => {
    const fixture = await buildApprovalFixture({ issuerCertFp: new Uint8Array(32).fill(0x22) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });

  it('rejects a transcript naming a nonce other than the stored one', async () => {
    // The stored row keeps the real nonce; only the signed transcript claims a
    // different one. The server reads the row, so the hashes diverge.
    const fixture = await buildApprovalFixture({ transcriptEnrollNonce: new Uint8Array(32).fill(0x77) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });

  it('rejects a transcript naming another deployment', async () => {
    const fixture = await buildApprovalFixture({ serverOriginId: new Uint8Array(32).fill(0x33) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });

  it('rejects a transcript naming a subject key the device row does not hold', async () => {
    const fixture = await buildApprovalFixture({ newSigFp: new Uint8Array(32).fill(0x44) });
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_CERT_WRONG_TRANSCRIPT' });
  });
});

describe('approve-device — approver trust', () => {
  it('rejects an arbitrary approval signature', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      approveRequest(fixture, { approvalSignature: toBase64(randomBytes(64)) }),
      USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_BAD_APPROVAL_SIGNATURE' });
  });

  it('rejects a legitimate approver id paired with an attacker key and signature', async () => {
    const fixture = await buildApprovalFixture();
    const attacker = (await createTestAccount()).devices[0];
    // The device row claims the attacker's key. The certificate does not, and
    // the certificate is what decides.
    const result = await handleApproveDevice(
      approveRequest(fixture, { approvalSignature: toBase64(
        await signWith(attacker.sig, approvalSignedMessage(fixture.transcriptHash)),
      ) }),
      USER,
      approveDeps({
        getDevice: async (id) => {
          if (id === APPROVER) {
            return {
              id: APPROVER, user_id: USER, status: 'ACTIVE',
              sig_spki: encodePgBytea(attacker.sig.spki),
              kem_spki: encodePgBytea(attacker.kem.spki),
            };
          }
          return {
            id: NEW_DEVICE, user_id: USER, status: 'PENDING',
            sig_spki: encodePgBytea(fixture.subject.sig.spki),
            kem_spki: encodePgBytea(fixture.subject.kem.spki),
          };
        },
      }, fixture),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_BAD_APPROVAL_SIGNATURE' });
  });

  it('rejects a signature from a different certified device of the same account', async () => {
    const fixture = await buildApprovalFixture();
    const other = (await createTestAccount()).devices[0];
    const result = await handleApproveDevice(
      approveRequest(fixture, { approvalSignature: toBase64(
        await signWith(other.sig, approvalSignedMessage(fixture.transcriptHash)),
      ) }),
      USER,
      approveDeps({}, fixture),
    );
    expect(result.body).toEqual({ error: 'E_BAD_APPROVAL_SIGNATURE' });
  });

  it('rejects a single flipped bit in an otherwise valid signature', async () => {
    const fixture = await buildApprovalFixture();
    const tampered = new Uint8Array(fixture.approvalSignature);
    tampered[0] ^= 0x01;
    const result = await handleApproveDevice(
      approveRequest(fixture, { approvalSignature: toBase64(tampered) }),
      USER,
      approveDeps({}, fixture),
    );
    expect(result.body).toEqual({ error: 'E_BAD_APPROVAL_SIGNATURE' });
  });

  it('rejects an uncertified approver', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getCertificateChain: async () => [],
    }, fixture));
    expect(result.body).toEqual({ error: 'E_APPROVER_UNCERTIFIED' });
  });

  it('rejects an approver with a signed revocation, whatever its status column says', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      isDeviceRevoked: async (id) => id === APPROVER,
    }, fixture));
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_APPROVER_REVOKED' });
  });

  it('rejects an approver whose own issuer was revoked', async () => {
    const fixture = await buildApprovalFixture();
    // A depth-2 approver chain: leaf issued by OTHER_DEVICE, which is revoked.
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      isDeviceRevoked: async (id) => id === OTHER_DEVICE,
      getCertificateChain: async () => [
        {
          id: APPROVER_CERT,
          subject_device_id: APPROVER,
          issuer_certificate_id: null,
          certificate: encodePgBytea(fixture.approverCertificate),
          subject_sig_spki: encodePgBytea(fixture.approver.sig.spki),
          subject_kem_spki: encodePgBytea(fixture.approver.kem.spki),
        },
        {
          id: 'f0000000-0000-4000-8000-00000000000b',
          subject_device_id: OTHER_DEVICE,
          issuer_certificate_id: null,
          certificate: encodePgBytea(fixture.approverCertificate),
          subject_sig_spki: encodePgBytea(fixture.approver.sig.spki),
          subject_kem_spki: encodePgBytea(fixture.approver.kem.spki),
        },
      ],
    }, fixture));
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/E_APPROVER/);
  });

  it('rejects a chain that does not terminate at the recovery root', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getCertificateChain: async () => [{
        // The new device's own certificate is device-issued, so a chain of just
        // it never reaches the root.
        id: APPROVER_CERT,
        subject_device_id: APPROVER,
        issuer_certificate_id: null,
        certificate: encodePgBytea(fixture.certificate),
        subject_sig_spki: encodePgBytea(fixture.subject.sig.spki),
        subject_kem_spki: encodePgBytea(fixture.subject.kem.spki),
      }],
    }, fixture));
    expect(result.body).toEqual({ error: 'E_APPROVER_CERT_CHAIN_NO_ROOT' });
  });

  it('rejects a certificate chain deeper than the protocol allows', async () => {
    const fixture = await buildApprovalFixture();
    const link: CertificateRow = {
      id: APPROVER_CERT,
      subject_device_id: APPROVER,
      issuer_certificate_id: null,
      certificate: encodePgBytea(fixture.approverCertificate),
      subject_sig_spki: encodePgBytea(fixture.approver.sig.spki),
      subject_kem_spki: encodePgBytea(fixture.approver.kem.spki),
    };
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getCertificateChain: async () => Array.from({ length: 9 }, () => link),
    }, fixture));
    expect(result.body).toEqual({ error: 'E_APPROVER_CHAIN_TOO_DEEP' });
  });
});

describe('approve-device — enrollment lifecycle', () => {
  it('rejects a replayed enrollment', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getEnrollment: async () => ({
        id: ENROLLMENT,
        user_id: USER,
        new_device_id: NEW_DEVICE,
        approver_device_id: APPROVER,
        enroll_nonce: encodePgBytea(fixture.enrollNonce),
        granted_domains: REQUESTED_MASK,
        created_at: CREATED_AT,
        expires_at: EXPIRES_AT,
        approved_at: new Date(NOW - 1000).toISOString(),
        consumed_at: new Date(NOW - 1000).toISOString(),
      }),
    }, fixture));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'E_NONCE_ALREADY_USED' });
  });

  it('rejects an expired enrollment', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      now: () => Date.parse(EXPIRES_AT) + 1,
    }, fixture));
    expect(result.status).toBe(410);
    expect(result.body).toEqual({ error: 'E_NONCE_EXPIRED' });
  });

  it('rejects an unknown enrollment id', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      approveRequest(fixture, { enrollmentId: 'e0000000-0000-4000-8000-0000000000ff' }),
      USER,
      approveDeps({}, fixture),
    );
    expect(result.body).toEqual({ error: 'E_UNKNOWN_ENROLLMENT' });
  });

  it('rejects an enrollment id that is not a uuid, without a lookup', async () => {
    const fixture = await buildApprovalFixture();
    let looked = false;
    const result = await handleApproveDevice(
      approveRequest(fixture, { enrollmentId: 'not-a-uuid' }),
      USER,
      approveDeps({ getEnrollment: async () => { looked = true; return null; } }, fixture),
    );
    expect(result.status).toBe(400);
    expect(looked).toBe(false);
  });

  it('rejects an enrollment belonging to a different account', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), OTHER_USER, approveDeps({
      getRecoveryAnchor: async () => null,
    }, fixture));
    expect(result.body).toEqual({ error: 'E_WRONG_ACCOUNT' });
  });

  it('rejects an unauthenticated caller', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), '', approveDeps({}, fixture));
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_UNAUTHENTICATED' });
  });

  it('rejects an already-provisioned target device', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getDevice: async (id) => (id === NEW_DEVICE
        ? {
          id: NEW_DEVICE, user_id: USER, status: 'ACTIVE',
          sig_spki: encodePgBytea(fixture.subject.sig.spki),
          kem_spki: encodePgBytea(fixture.subject.kem.spki),
        }
        : {
          id: APPROVER, user_id: USER, status: 'ACTIVE',
          sig_spki: encodePgBytea(fixture.approver.sig.spki),
          kem_spki: encodePgBytea(fixture.approver.kem.spki),
        }),
    }, fixture));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'E_DEVICE_NOT_PENDING' });
  });
});

describe('approve-device — malformed input', () => {
  it('rejects malformed bytea in a device row without throwing', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getDevice: async (id) => (id === NEW_DEVICE
        ? { id: NEW_DEVICE, user_id: USER, status: 'PENDING', sig_spki: 'not-hex', kem_spki: 'not-hex' }
        : {
          id: APPROVER, user_id: USER, status: 'ACTIVE',
          sig_spki: encodePgBytea(fixture.approver.sig.spki),
          kem_spki: encodePgBytea(fixture.approver.kem.spki),
        }),
    }, fixture));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'E_MALFORMED_STATE' });
  });

  it('rejects a base64 bytea column, which is the wrong representation', async () => {
    // Exactly the bug the split codec exists to make impossible: a row rendered
    // as base64 rather than `\x` hex is refused instead of silently decoded.
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getRecoveryAnchor: async () => ({
        id: recoveryIdentityUuid(),
        recovery_version: account.recoveryVersion,
        rec_sig_spki: toBase64(account.recSig.spki),
        recovery_bundle_fp: toBase64(account.recoveryBundleFp),
      }),
    }, fixture));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'E_MALFORMED_STATE' });
  });

  it('rejects a malformed certificate without throwing', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(
      approveRequest(fixture, { certificate: toBase64(new Uint8Array(10)) }),
      USER,
      approveDeps({}, fixture),
    );
    expect(result.status).toBe(400);
  });

  it('rejects an enrollment nonce of the wrong width', async () => {
    const fixture = await buildApprovalFixture();
    const result = await handleApproveDevice(approveRequest(fixture), USER, approveDeps({
      getEnrollment: async () => ({
        id: ENROLLMENT,
        user_id: USER,
        new_device_id: NEW_DEVICE,
        approver_device_id: APPROVER,
        enroll_nonce: encodePgBytea(new Uint8Array(8)),
        granted_domains: REQUESTED_MASK,
        created_at: CREATED_AT,
        expires_at: EXPIRES_AT,
        approved_at: null,
        consumed_at: null,
      }),
    }, fixture));
    expect(result.body).toEqual({ error: 'E_MALFORMED_STATE' });
  });

  it('logs identifiers and codes only, never key material', async () => {
    const fixture = await buildApprovalFixture();
    await handleApproveDevice(approveRequest(fixture), USER, approveDeps({}, fixture));
    const serialized = JSON.stringify(logged);
    expect(serialized).toContain(NEW_DEVICE);
    expect(serialized).not.toContain(hex(fixture.approver.sig.spki));
    expect(serialized).not.toContain(hex(fixture.transcriptHash));
    expect(serialized).not.toContain(hex(fixture.enrollNonce));
  });
});

// ---------------------------------------------------------------------------
// issue-recovery-challenge
// ---------------------------------------------------------------------------

const ISSUED_CHALLENGE = new Uint8Array(32).fill(0x2b);

function issueDeps(overrides: Partial<IssueRecoveryChallengeDeps> = {}): IssueRecoveryChallengeDeps {
  return {
    now: () => NOW,
    randomChallenge: () => ISSUED_CHALLENGE,
    getDevice: async (id) => (id === NEW_DEVICE
      ? { id: NEW_DEVICE, user_id: USER, status: 'PENDING' }
      : null),
    getCurrentRecoveryIdentity: async (userId) => (userId === USER ? {
      id: recoveryIdentityUuid(),
      user_id: USER,
      recovery_version: account.recoveryVersion,
      superseded_at: null,
    } : null),
    countIssuedLastHour: async () => 0,
    issue: async ({ userId, deviceId, challenge, ttlSeconds }) => ({
      ok: true,
      row: {
        id: CHALLENGE,
        user_id: userId,
        recovery_identity_id: recoveryIdentityUuid(),
        recovery_version: account.recoveryVersion,
        new_device_id: deviceId,
        challenge_nonce: encodePgBytea(challenge),
        issued_at: new Date(NOW).toISOString(),
        expires_at: new Date(NOW + ttlSeconds * 1000).toISOString(),
      },
    }),
    logEvent: (event, detail) => { logged.push({ event, detail }); },
    ...overrides,
  };
}

describe('issue-recovery-challenge', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, '', issueDeps());
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_UNAUTHENTICATED' });
  });

  it('rejects a device belonging to another account', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, OTHER_USER, issueDeps());
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_WRONG_ACCOUNT' });
  });

  it('rejects a device that is not PENDING', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps({
      getDevice: async () => ({ id: NEW_DEVICE, user_id: USER, status: 'ACTIVE' }),
    }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'E_DEVICE_NOT_PENDING' });
  });

  it('rejects a revoked device', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps({
      getDevice: async () => ({ id: NEW_DEVICE, user_id: USER, status: 'REVOKED' }),
    }));
    expect(result.body).toEqual({ error: 'E_DEVICE_NOT_PENDING' });
  });

  it('rejects an account with no recovery identity', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps({
      getCurrentRecoveryIdentity: async () => null,
    }));
    expect(result.body).toEqual({ error: 'E_NO_RECOVERY_IDENTITY' });
  });

  it('rejects a superseded recovery identity', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps({
      getCurrentRecoveryIdentity: async () => ({
        id: recoveryIdentityUuid(),
        user_id: USER,
        recovery_version: account.recoveryVersion,
        superseded_at: new Date(NOW - 1000).toISOString(),
      }),
    }));
    expect(result.body).toEqual({ error: 'E_RECOVERY_IDENTITY_SUPERSEDED' });
  });

  it('rejects a malformed device id without touching the database', async () => {
    let touched = false;
    const result = await handleIssueRecoveryChallenge({ deviceId: 'nope' }, USER, issueDeps({
      getDevice: async () => { touched = true; return null; },
    }));
    expect(result.status).toBe(400);
    expect(touched).toBe(false);
  });

  it('rate limits issuance', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps({
      countIssuedLastHour: async () => MAX_ISSUED_PER_HOUR,
    }));
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: 'E_TOO_MANY_CHALLENGES' });
  });

  it('issues a challenge whose id is NOT the challenge bytes', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps());
    expect(result.status).toBe(200);
    const body = result.body as Extract<typeof result, { status: 200 }>['body'];
    expect(body.challengeId).toBe(CHALLENGE);
    // Separate values, and the id is not derived from the secret.
    expect(body.challengeId).not.toBe(body.challenge);
    expect(hex(decodeBase64(body.challenge)!)).toBe(hex(ISSUED_CHALLENGE));
    expect(decodeBase64(body.challenge)).toHaveLength(32);
  });

  it('returns the persisted expiry, so the signed transcript can be reproduced', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps());
    const body = result.body as Extract<typeof result, { status: 200 }>['body'];
    expect(Date.parse(body.expiresAt) - Date.parse(body.issuedAt)).toBe(120_000);
    expect(body.recoveryIdentityId).toBe(recoveryIdentityUuid());
    expect(body.deviceId).toBe(NEW_DEVICE);
  });

  it('returns no secret material of any kind', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps());
    const body = result.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'challenge', 'challengeId', 'deviceId', 'expiresAt', 'issuedAt', 'recoveryIdentityId', 'recoveryVersion',
    ]);
    const serialized = JSON.stringify(body);
    // No salt, no encrypted private half, no bundle fingerprint, no scope key.
    expect(serialized).not.toContain(hex(account.recoverySalt));
    expect(serialized).not.toContain(hex(account.recoveryBundleFp));
    expect(serialized).not.toContain(hex(account.recSig.spki));
    expect(serialized).not.toContain(hex(account.recKem.spki));
  });

  it('never logs the challenge bytes', async () => {
    await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps());
    const serialized = JSON.stringify(logged);
    expect(serialized).toContain(CHALLENGE);
    expect(serialized).not.toContain(hex(ISSUED_CHALLENGE));
    expect(serialized).not.toContain(encodeBase64(ISSUED_CHALLENGE));
  });

  it('refuses a row that does not match the request it answered', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps({
      issue: async () => ({
        ok: true,
        row: {
          id: CHALLENGE,
          user_id: USER,
          recovery_identity_id: recoveryIdentityUuid(),
          recovery_version: account.recoveryVersion,
          new_device_id: OTHER_DEVICE,
          challenge_nonce: encodePgBytea(ISSUED_CHALLENGE),
          issued_at: new Date(NOW).toISOString(),
          expires_at: new Date(NOW + 120_000).toISOString(),
        },
      }),
    }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'E_CHALLENGE_MISMATCH' });
  });

  it('propagates a refusal from the issuing RPC', async () => {
    const result = await handleIssueRecoveryChallenge({ deviceId: NEW_DEVICE }, USER, issueDeps({
      issue: async () => ({ ok: false, code: 'E_DEVICE_NOT_PENDING' }),
    }));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'E_DEVICE_NOT_PENDING' });
  });
});

// ---------------------------------------------------------------------------
// verify-recovery
// ---------------------------------------------------------------------------

async function buildRecoveryFixture(options?: { deviceId?: string }) {
  const device = (await createTestAccount()).devices[0];
  const nonce = randomBytes(32);
  const issuedAt = new Date(NOW - 30_000).toISOString();
  const expiresAt = new Date(NOW + 90_000).toISOString();
  const deviceId = options?.deviceId ?? NEW_DEVICE;

  const transcript = buildRecoveryTranscript({
    serverOriginId: account.serverOriginId,
    userId: uuidToBytes(USER),
    challengeId: uuidToBytes(CHALLENGE),
    challengeNonce: nonce,
    issuedAtMs: BigInt(Date.parse(issuedAt)),
    expiresAtMs: BigInt(Date.parse(expiresAt)),
    recoveryVersion: account.recoveryVersion,
    recSigPubFp: account.recSig.fingerprint,
    newDeviceId: uuidToBytes(deviceId),
    newSigFp: await publicKeyFingerprint(device.sig.spki),
    newKemFp: await publicKeyFingerprint(device.kem.spki),
  });

  return {
    device,
    nonce,
    issuedAt,
    expiresAt,
    deviceId,
    signature: await signWith(account.recSig, transcript),
  };
}

type RecoveryFixture = Awaited<ReturnType<typeof buildRecoveryFixture>>;

function verifyDeps(overrides: Partial<VerifyRecoveryDeps>, fixture: RecoveryFixture): VerifyRecoveryDeps {
  return {
    now: () => NOW,
    getServerOriginId: async () => account.serverOriginId,
    getChallenge: async () => ({
      id: CHALLENGE,
      user_id: USER,
      recovery_identity_id: recoveryIdentityUuid(),
      challenge_nonce: encodePgBytea(fixture.nonce),
      recovery_version: account.recoveryVersion,
      new_device_id: fixture.deviceId,
      issued_at: fixture.issuedAt,
      expires_at: fixture.expiresAt,
      consumed_at: null,
    }),
    getCurrentRecoveryIdentity: async () => ({
      id: recoveryIdentityUuid(),
      recovery_version: account.recoveryVersion,
      rec_sig_spki: encodePgBytea(account.recSig.spki),
      superseded_at: null,
    }),
    getDevice: async (id) => (id === fixture.deviceId ? {
      id: fixture.deviceId,
      user_id: USER,
      status: 'PENDING',
      sig_spki: encodePgBytea(fixture.device.sig.spki),
      kem_spki: encodePgBytea(fixture.device.kem.spki),
    } : null),
    countRecentAttempts: async () => 0,
    commitAuthentication: async () => ({ ok: true }),
    logEvent: (event, detail) => { logged.push({ event, detail }); },
    ...overrides,
  };
}

function verifyRequest(fixture: RecoveryFixture, overrides: Record<string, unknown> = {}) {
  return {
    challengeId: CHALLENGE,
    deviceId: fixture.deviceId,
    signature: toBase64(fixture.signature),
    ...overrides,
  };
}

describe('verify-recovery', () => {
  it('authenticates a genuine recovery signature but does NOT activate the device', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({}, fixture));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      authenticated: true, deviceId: NEW_DEVICE, nextState: 'RECOVERY_AUTHENTICATED',
    });
  });

  it('binds the commit to the identity and generation it verified', async () => {
    const fixture = await buildRecoveryFixture();
    let committed: Record<string, unknown> | null = null;
    await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      commitAuthentication: async (input) => { committed = { ...input }; return { ok: true }; },
    }, fixture));
    expect(committed).toEqual({
      challengeId: CHALLENGE,
      deviceId: NEW_DEVICE,
      recoveryIdentityId: recoveryIdentityUuid(),
      recoveryVersion: account.recoveryVersion,
    });
  });

  it('rejects a signature from anything but the recovery key', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(
      verifyRequest(fixture, { signature: toBase64(await signWith(fixture.device.sig, new Uint8Array(32))) }),
      USER,
      verifyDeps({}, fixture),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_BAD_RECOVERY_SIGNATURE' });
  });

  it('rejects a modified challenge nonce', async () => {
    const fixture = await buildRecoveryFixture();
    const tampered = new Uint8Array(fixture.nonce);
    tampered[0] ^= 0xff;
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getChallenge: async () => ({
        id: CHALLENGE,
        user_id: USER,
        recovery_identity_id: recoveryIdentityUuid(),
        challenge_nonce: encodePgBytea(tampered),
        recovery_version: account.recoveryVersion,
        new_device_id: fixture.deviceId,
        issued_at: fixture.issuedAt,
        expires_at: fixture.expiresAt,
        consumed_at: null,
      }),
    }, fixture));
    expect(result.body).toEqual({ error: 'E_BAD_RECOVERY_SIGNATURE' });
  });

  it('rejects a replayed challenge', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getChallenge: async () => ({
        id: CHALLENGE,
        user_id: USER,
        recovery_identity_id: recoveryIdentityUuid(),
        challenge_nonce: encodePgBytea(fixture.nonce),
        recovery_version: account.recoveryVersion,
        new_device_id: fixture.deviceId,
        issued_at: fixture.issuedAt,
        expires_at: fixture.expiresAt,
        consumed_at: new Date(NOW - 1000).toISOString(),
      }),
    }, fixture));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'E_CHALLENGE_ALREADY_USED' });
  });

  it('rejects a challenge the commit step finds already spent', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      commitAuthentication: async () => ({ ok: false, code: 'E_CHALLENGE_ALREADY_USED' }),
    }, fixture));
    expect(result.status).toBe(409);
  });

  it('rejects an expired challenge', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      now: () => Date.parse(fixture.expiresAt) + 1,
    }, fixture));
    expect(result.status).toBe(410);
    expect(result.body).toEqual({ error: 'E_CHALLENGE_EXPIRED' });
  });

  it('rejects a cross-account replay', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), OTHER_USER, verifyDeps({}, fixture));
    expect(result.body).toEqual({ error: 'E_WRONG_ACCOUNT' });
  });

  it('rejects a response bound to a different device', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(
      verifyRequest(fixture, { deviceId: OTHER_DEVICE }),
      USER,
      verifyDeps({}, fixture),
    );
    expect(result.body).toEqual({ error: 'E_CHALLENGE_DEVICE_MISMATCH' });
  });

  it('rejects a downgrade to a retired recovery generation', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getCurrentRecoveryIdentity: async () => ({
        id: recoveryIdentityUuid(),
        recovery_version: account.recoveryVersion + 1,
        rec_sig_spki: encodePgBytea(account.recSig.spki),
        superseded_at: null,
      }),
    }, fixture));
    expect(result.body).toEqual({ error: 'E_RECOVERY_VERSION_MISMATCH' });
  });

  it('rejects a challenge issued against a REPLACED identity at the same version', async () => {
    // A version number alone cannot catch this: a rotation can reissue version 1.
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getCurrentRecoveryIdentity: async () => ({
        id: 'aaaaaaaa-1111-4111-8111-111111111111',
        recovery_version: account.recoveryVersion,
        rec_sig_spki: encodePgBytea(account.recSig.spki),
        superseded_at: null,
      }),
    }, fixture));
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'E_RECOVERY_IDENTITY_MISMATCH' });
  });

  it('rejects a superseded recovery identity', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getCurrentRecoveryIdentity: async () => ({
        id: recoveryIdentityUuid(),
        recovery_version: account.recoveryVersion,
        rec_sig_spki: encodePgBytea(account.recSig.spki),
        superseded_at: new Date(NOW - 1000).toISOString(),
      }),
    }, fixture));
    expect(result.body).toEqual({ error: 'E_RECOVERY_IDENTITY_SUPERSEDED' });
  });

  it('rejects a cross-deployment replay', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getServerOriginId: async () => new Uint8Array(32).fill(9),
    }, fixture));
    expect(result.body).toEqual({ error: 'E_BAD_RECOVERY_SIGNATURE' });
  });

  it('rejects a client transcript that disagrees with the server reconstruction', async () => {
    // The client signed a transcript with a different issuedAt. The server
    // rebuilds from the row, so the signature does not verify.
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getChallenge: async () => ({
        id: CHALLENGE,
        user_id: USER,
        recovery_identity_id: recoveryIdentityUuid(),
        challenge_nonce: encodePgBytea(fixture.nonce),
        recovery_version: account.recoveryVersion,
        new_device_id: fixture.deviceId,
        // Still inside the protocol's 120s window, so the TTL guard is not what
        // rejects this — the signature simply covers a different issuedAt.
        issued_at: new Date(NOW - 29_000).toISOString(),
        expires_at: fixture.expiresAt,
        consumed_at: null,
      }),
    }, fixture));
    expect(result.body).toEqual({ error: 'E_BAD_RECOVERY_SIGNATURE' });
  });

  it('rate limits attempts', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      countRecentAttempts: async () => MAX_ATTEMPTS_PER_HOUR,
    }, fixture));
    expect(result.status).toBe(429);
  });

  it('rejects an already-provisioned device', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getDevice: async () => ({
        id: fixture.deviceId,
        user_id: USER,
        status: 'ACTIVE',
        sig_spki: encodePgBytea(fixture.device.sig.spki),
        kem_spki: encodePgBytea(fixture.device.kem.spki),
      }),
    }, fixture));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'E_DEVICE_NOT_PENDING' });
  });

  it('rejects a base64 bytea column rather than decoding it as hex', async () => {
    const fixture = await buildRecoveryFixture();
    const result = await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({
      getCurrentRecoveryIdentity: async () => ({
        id: recoveryIdentityUuid(),
        recovery_version: account.recoveryVersion,
        rec_sig_spki: toBase64(account.recSig.spki),
        superseded_at: null,
      }),
    }, fixture));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'E_MALFORMED_STATE' });
  });

  it('rejects malformed input without throwing', async () => {
    const fixture = await buildRecoveryFixture();
    for (const bad of [{}, { challengeId: 1 }, { challengeId: CHALLENGE }, { signature: '!!!' }]) {
      const result = await handleVerifyRecovery(bad, USER, verifyDeps({}, fixture));
      expect(result.status).toBe(400);
    }
  });

  it('logs identifiers and codes only', async () => {
    const fixture = await buildRecoveryFixture();
    await handleVerifyRecovery(verifyRequest(fixture), USER, verifyDeps({}, fixture));
    const serialized = JSON.stringify(logged);
    expect(serialized).toContain(NEW_DEVICE);
    expect(serialized).not.toContain(hex(fixture.nonce));
    expect(serialized).not.toContain(hex(account.recSig.spki));
  });
});

// ---------------------------------------------------------------------------
// The byte boundary
// ---------------------------------------------------------------------------

describe('shared byte codec', () => {
  it('decodes the PostgreSQL hex form and nothing else', () => {
    expect(hex(decodePgBytea('\\x0011ff')!)).toBe('0011ff');
    expect(decodePgBytea('AAAA')).toBeNull();
    expect(decodePgBytea('0011ff')).toBeNull();
    expect(decodePgBytea(null)).toBeNull();
  });

  it('round-trips every protocol value at its real width', () => {
    for (const width of [16, 32, 64, 91, 203, 360, 445]) {
      const value = randomBytes(width);
      expect(hex(decodePgBytea(encodePgBytea(value))!)).toBe(hex(value));
    }
  });

  it('decodes a base64 transport value and nothing else', () => {
    const value = randomBytes(32);
    expect(hex(decodeBase64(encodeBase64(value))!)).toBe(hex(value));
    // The hex form is not base64, and is refused rather than mangled.
    expect(decodeBase64(encodePgBytea(value))).toBeNull();
  });

  it('refuses malformed hex rather than returning garbage', () => {
    expect(decodePgBytea('\\xabc')).toBeNull();
    expect(decodePgBytea('\\xzz')).toBeNull();
    expect(decodePgBytea('\\x')).toHaveLength(0);
  });

  it('the two decoders disagree, which is the point', () => {
    // `\x4142` is two bytes as bytea. As base64 it is not even valid. A single
    // lenient decoder would have quietly picked one interpretation.
    const asBytea = decodePgBytea('\\x4142');
    expect(hex(asBytea!)).toBe('4142');
    expect(decodeBase64('\\x4142')).toBeNull();
  });
});
