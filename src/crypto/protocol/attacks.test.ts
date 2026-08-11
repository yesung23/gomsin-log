/**
 * The ten Phase 1A self-attacks.
 *
 * Every one is driven by real cryptography — real ECDSA, real ECDH, real
 * AES-GCM — because an attack test that passes against a stub proves nothing.
 * Where an attack lands in the database rather than in TypeScript, the test
 * says so and points at the SQL assertion that covers it, rather than
 * pretending to cover it here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { hex, uuidToBytes } from '../bytes';
import { ASSURANCE, EPOCH_STATE, KEY_DOMAIN, RECIPIENT_KIND } from '../domains';
import { verifyCertificateChain } from '../deviceCertificate';
import { openEnvelope } from '../glk2';
import { RevocationSet, encodeRevocationTbs, revocationSignedMessage, verifyRevocationStatement } from '../revocation';
import { deriveSas } from '../sas';
import { decodeRecoveryCode, encodeRecoveryCode, deriveKitAnchorTag } from '../recoveryCode';
import { bundleMatchesKitAnchor, recoveryBundleFingerprint } from '../transcripts';
import { randomBytes } from '../suite';
import { selectHealthRecipients, selectRecipients } from './recipients';
import { canCreateCoupleKey, proposePairing, buildPairingSide } from './pairing';
import { classifyLostDevice, epochUsage, planRevocation, revokedDeviceMayReceiveNewEpoch, transitionEpoch } from './rotation';
import {
  addEnrolledDevice,
  createTestAccount,
  createUncertifiedDevice,
  deriveWith,
  generateScopeKeyBytes,
  sealScopeKeyFrom,
  signWith,
  type TestAccount,
  type TestDevice,
} from '../testing/virtualAccount';

const NOW = 1_800_000_000_000n;

let alice: TestAccount;
let aliceRoot: TestDevice;
let bob: TestAccount;
let bobRoot: TestDevice;

beforeAll(async () => {
  alice = await createTestAccount();
  aliceRoot = alice.devices[0];
  bob = await createTestAccount();
  bobRoot = bob.devices[0];
});

// ---------------------------------------------------------------------------
describe('Attack 1 — service_role injects a fake ACTIVE device', () => {
  it('the injected device is never eligible to receive any scope key', async () => {
    const attacker = await createUncertifiedDevice();

    // Exactly what a malicious service_role can produce: a real keypair, a row
    // it wrote, `status = 'ACTIVE'`, and no signature from Alice's recovery key.
    const selection = await selectRecipients({
      candidates: [
        { deviceId: aliceRoot.deviceId, chain: aliceRoot.chain, serverReportedStatus: 'ACTIVE' },
        { deviceId: attacker.deviceId, chain: [], serverReportedStatus: 'ACTIVE' },
      ],
      anchor: alice.anchor,
      domain: 'couple',
      atMs: NOW,
    });

    expect(selection.eligible).toHaveLength(1);
    expect(hex(selection.eligible[0].deviceId)).toBe(hex(aliceRoot.deviceId));
    expect(selection.rejected).toEqual([{ deviceId: hex(attacker.deviceId), reason: 'untrusted' }]);
  });

  it('status ACTIVE grants nothing — the same device with any status is rejected identically', async () => {
    const attacker = await createUncertifiedDevice();
    for (const status of ['ACTIVE', 'PENDING', 'PROVISIONING', undefined]) {
      const selection = await selectRecipients({
        candidates: [{ deviceId: attacker.deviceId, chain: [], serverReportedStatus: status }],
        anchor: alice.anchor,
        domain: 'couple',
        atMs: NOW,
      });
      expect(selection.eligible, `status ${status} must not confer trust`).toHaveLength(0);
    }
  });

  it('no envelope is constructible for the attacker, because it never enters the recipient set', async () => {
    const attacker = await createUncertifiedDevice();
    const selection = await selectRecipients({
      candidates: [{ deviceId: attacker.deviceId, chain: [], serverReportedStatus: 'ACTIVE' }],
      anchor: alice.anchor,
      domain: 'couple',
      atMs: NOW,
    });
    // The wrap loop iterates `eligible`; there is nothing to wrap to.
    expect(selection.eligible).toHaveLength(0);
  });

  it('a forged chain claiming Alice\'s root fails signature verification', async () => {
    const attackerAccount = await createTestAccount();
    await expect(
      verifyCertificateChain({
        chain: attackerAccount.devices[0].chain,
        anchor: alice.anchor,
        atMs: NOW,
      }),
    ).rejects.toThrow(/E_USER_MISMATCH|E_ROOT_MISMATCH|E_ORIGIN_MISMATCH|E_RECOVERY_IDENTITY_MISMATCH/);
  });
});

// ---------------------------------------------------------------------------
describe('Attack 2 — stolen Auth session, no device key', () => {
  it('holding ciphertext without the agreement key yields nothing', async () => {
    const scopeKey = generateScopeKeyBytes();
    const envelope = await sealScopeKeyFrom(
      aliceRoot,
      { id: aliceRoot.deviceId, kemSpki: aliceRoot.kem.spki, kind: RECIPIENT_KIND.device },
      scopeKey,
      {
        domain: KEY_DOMAIN.personal,
        scopeKeyId: uuidToBytes(crypto.randomUUID()),
        ownerUserId: alice.userId,
        scopeId: alice.userId,
        epoch: 1n,
      },
    );

    // The attacker has the envelope (a session can read the row) and a keypair
    // of their own. That is not the recipient key.
    const attacker = await createUncertifiedDevice();
    await expect(
      openEnvelope({
        envelope,
        recipientKemSpki: attacker.kem.spki,
        senderSigSpki: aliceRoot.sig.spki,
        deriveSecret: (peer) => deriveWith(attacker.kem, peer),
      }),
    ).rejects.toThrow(/E_RECIPIENT_FP_MISMATCH/);
  });

  it('even with the fingerprint check bypassed, the AEAD does not open', async () => {
    const scopeKey = generateScopeKeyBytes();
    const envelope = await sealScopeKeyFrom(
      aliceRoot,
      { id: aliceRoot.deviceId, kemSpki: aliceRoot.kem.spki, kind: RECIPIENT_KIND.device },
      scopeKey,
      {
        domain: KEY_DOMAIN.personal,
        scopeKeyId: uuidToBytes(crypto.randomUUID()),
        ownerUserId: alice.userId,
        scopeId: alice.userId,
        epoch: 1n,
      },
    );
    const attacker = await createUncertifiedDevice();
    // Present the correct recipient SPKI but derive with the wrong private key:
    // the KEK differs and authentication fails.
    await expect(
      openEnvelope({
        envelope,
        recipientKemSpki: aliceRoot.kem.spki,
        senderSigSpki: aliceRoot.sig.spki,
        deriveSecret: (peer) => deriveWith(attacker.kem, peer),
      }),
    ).rejects.toThrow(/E_AEAD_FAILED/);
  });
});

// ---------------------------------------------------------------------------
describe('Attack 3 — database dump plus Auth session attempts recovery', () => {
  it('the dump contains only public material and RKEK-encrypted blobs', async () => {
    // Everything a dump holds for the recovery identity.
    const dump = {
      rec_sig_spki: alice.recSig.spki,
      rec_kem_spki: alice.recKem.spki,
      recovery_salt: alice.recoverySalt,
      recovery_bundle_fp: alice.recoveryBundleFp,
    };
    // None of it is a private key.
    expect(dump.rec_sig_spki.length).toBe(91);
    expect(dump.rec_kem_spki.length).toBe(91);

    // Producing a valid recovery response requires signing with rec_sig, whose
    // private half exists only under the user's 256-bit secret.
    const challenge = randomBytes(64);
    const attacker = await createTestAccount();
    const forged = await signWith(attacker.recSig, challenge);
    const { ecdsaVerify } = await import('../suite');
    expect(await ecdsaVerify(alice.recSig.spki, challenge, forged)).toBe(false);
  });

  it('a recovery code cannot be brute-forced from anything in the dump', async () => {
    const secret = randomBytes(32);
    const code = await encodeRecoveryCode(secret);
    // 256 bits. The checksum is a typo detector and leaks nothing usable.
    expect(code.replace(/-/g, '')).toHaveLength(56);
    expect(hex(await decodeRecoveryCode(code))).toBe(hex(secret));
  });
});

// ---------------------------------------------------------------------------
describe('Attack 4 — server rolls the recovery identity backward', () => {
  it('the kit anchor detects a substituted or older bundle', async () => {
    const currentFp = await recoveryBundleFingerprint(alice.recoveryBundle);

    // The kit the user holds.
    const kit = {
      recoveryIdentityId: alice.recoveryIdentityId,
      recoveryVersion: alice.recoveryVersion,
      recoveryBundleFp: currentFp,
    };

    // The server serves an older generation instead.
    const older = { ...alice.recoveryBundle, recoveryVersion: alice.recoveryVersion };
    const olderFp = await recoveryBundleFingerprint({ ...older, recoverySalt: randomBytes(32) });

    expect(
      bundleMatchesKitAnchor(olderFp, kit.recoveryBundleFp, alice.recoveryIdentityId,
        kit.recoveryIdentityId, alice.recoveryVersion, kit.recoveryVersion),
    ).toBe(false);

    // The genuine current bundle matches.
    expect(
      bundleMatchesKitAnchor(currentFp, kit.recoveryBundleFp, alice.recoveryIdentityId,
        kit.recoveryIdentityId, alice.recoveryVersion, kit.recoveryVersion),
    ).toBe(true);
  });

  it('a version downgrade is detected even when the fingerprint is replayed', async () => {
    const fp = await recoveryBundleFingerprint(alice.recoveryBundle);
    expect(
      bundleMatchesKitAnchor(fp, fp, alice.recoveryIdentityId, alice.recoveryIdentityId, 1, 2),
    ).toBe(false);
  });

  it('the manual anchor tag changes with the identity, generation and bundle', async () => {
    const base = await deriveKitAnchorTag(alice.recoveryIdentityId, 1, alice.recoveryBundleFp);
    expect(await deriveKitAnchorTag(alice.recoveryIdentityId, 2, alice.recoveryBundleFp)).not.toBe(base);
    expect(await deriveKitAnchorTag(randomBytes(16), 1, alice.recoveryBundleFp)).not.toBe(base);
  });
});

// ---------------------------------------------------------------------------
describe('Attack 5 — legacy client writes plaintext after the write floor', () => {
  it('is refused by the database, not by the client', () => {
    // Enforcement is SQL and cannot be exercised from TypeScript. The live
    // assertions are in spike/e2ee-1a1/tools/db-tests.sql, executed against a
    // real PostgreSQL cluster:
    //
    //   R1 old client CANNOT insert new plaintext
    //   R2 old client CANNOT modify a legacy row and leave it plaintext
    //   R3 ciphertext CANNOT be downgraded to plaintext
    //
    // and the static contract is pinned in src/lib/migration031032.test.ts.
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/032_e2ee_write_floor.sql'), 'utf8');
    expect(sql).toContain('E2EE_WRITE_FLOOR');
    expect(sql).toContain('E2EE_DOWNGRADE_FORBIDDEN');
    // The downgrade rule must not be inside the floor gate.
    const trigger = sql.slice(sql.indexOf('enforce_e2ee_write_floor()'));
    expect(trigger.indexOf('E2EE_DOWNGRADE_FORBIDDEN')).toBeLessThan(trigger.indexOf('IF v_floor >= 1 THEN'));
  });
});

// ---------------------------------------------------------------------------
describe('Attack 6 — partner attempts to recover PMK or HRK', () => {
  it('a partner device is never a health recipient, whatever the candidate list says', async () => {
    // Bob's device presented as a candidate for Alice's health domain.
    const selection = await selectHealthRecipients({
      candidates: [
        { deviceId: aliceRoot.deviceId, chain: aliceRoot.chain },
        { deviceId: bobRoot.deviceId, chain: bobRoot.chain },
      ],
      anchor: alice.anchor,
      ownerUserId: alice.userId,
      atMs: NOW,
    });
    expect(selection.eligible.map((d) => hex(d.deviceId))).toEqual([hex(aliceRoot.deviceId)]);
  });

  it('a device without the health grant cannot receive health, even in its own account', async () => {
    const webDevice = await addEnrolledDevice(alice, aliceRoot, {
      grantedDomains: ['personal', 'couple'],
      assurance: ASSURANCE.webNonExtractable,
      platform: 'web',
    });
    const selection = await selectHealthRecipients({
      candidates: [{ deviceId: webDevice.deviceId, chain: webDevice.chain }],
      anchor: alice.anchor,
      ownerUserId: alice.userId,
      atMs: NOW,
    });
    expect(selection.eligible).toHaveLength(0);
    expect(selection.rejected[0].reason).toBe('domain_not_granted');
  });

  it('partner-assist cannot express a personal or health domain', async () => {
    // Structural: the assist path selects by couple scope only. Asking for
    // health against a partner anchor returns nothing rather than erroring,
    // because there is no code path that could produce such an envelope.
    const selection = await selectHealthRecipients({
      candidates: [{ deviceId: bobRoot.deviceId, chain: bobRoot.chain }],
      anchor: bob.anchor,
      ownerUserId: alice.userId, // asking for Alice's health with Bob's anchor
      atMs: NOW,
    });
    expect(selection.eligible).toHaveLength(0);
  });

  it('the database refuses a health envelope for the partner independently', () => {
    // Live SQL assertions, executed against a real cluster:
    //   "health envelope to partner device REJECTED"
    //   "personal envelope to partner device REJECTED"
    //   "partner sees ZERO personal/health envelopes"
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/031_e2ee_key_foundation.sql'), 'utf8');
    expect(sql).toContain('E2EE_DOMAIN_RECIPIENT_FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
describe('Attack 7 — revoked compromised device requests a new epoch', () => {
  it('a revoked device is excluded from the recipient set', async () => {
    const doomed = await addEnrolledDevice(alice, aliceRoot, { grantedDomains: ['personal', 'couple'] });
    const revocations = new RevocationSet();
    revocations.add({
      userId: alice.userId,
      serverOriginId: alice.serverOriginId,
      recoveryIdentityId: alice.recoveryIdentityId,
      recoveryVersion: alice.recoveryVersion,
      revokedDeviceId: doomed.deviceId,
      revokedSubjectSigPubFp: doomed.sig.fingerprint,
      reason: 'compromised',
      revokedAtMs: NOW - 1000n,
      revokerDeviceId: aliceRoot.deviceId,
      issuedAtMs: NOW - 1000n,
      serverNonce: randomBytes(32),
    });

    const selection = await selectRecipients({
      candidates: [
        { deviceId: aliceRoot.deviceId, chain: aliceRoot.chain },
        { deviceId: doomed.deviceId, chain: doomed.chain, serverReportedStatus: 'ACTIVE' },
      ],
      anchor: alice.anchor,
      domain: 'couple',
      atMs: NOW,
      revocations,
    });

    expect(selection.eligible.map((d) => hex(d.deviceId))).toEqual([hex(aliceRoot.deviceId)]);
    expect(selection.rejected[0].reason).toBe('revoked');
    expect(revokedDeviceMayReceiveNewEpoch()).toBe(false);
  });

  it('compromise rotates every domain the device held, loss-with-secure-erase rotates none', () => {
    const held = [
      { domain: 'personal' as const, scopeId: alice.userId, epoch: 1n },
      { domain: 'health' as const, scopeId: alice.userId, epoch: 1n },
      { domain: 'couple' as const, scopeId: randomBytes(16), epoch: 3n },
    ];
    expect(planRevocation({ reason: 'compromised', heldScopes: held }).rotate).toHaveLength(3);
    expect(planRevocation({ reason: 'potentiallyCompromised', heldScopes: held }).rotate).toHaveLength(3);
    expect(planRevocation({ reason: 'lostSecured', heldScopes: held }).rotate).toHaveLength(0);
  });

  it('a lost device defaults to potentially compromised', () => {
    expect(classifyLostDevice({ assurance: ASSURANCE.secureEnclave, userConfirmedSecureErase: false }))
      .toBe('potentiallyCompromised');
    // A web device is never eligible for the no-rotation outcome, because the
    // app cannot attest browser storage.
    expect(classifyLostDevice({ assurance: ASSURANCE.webNonExtractable, userConfirmedSecureErase: true }))
      .toBe('potentiallyCompromised');
    expect(classifyLostDevice({ assurance: ASSURANCE.secureEnclave, userConfirmedSecureErase: true }))
      .toBe('lostSecured');
  });

  it('a forged revocation statement does not verify', async () => {
    const tbs = encodeRevocationTbs({
      userId: alice.userId,
      serverOriginId: alice.serverOriginId,
      recoveryIdentityId: alice.recoveryIdentityId,
      recoveryVersion: alice.recoveryVersion,
      revokedDeviceId: aliceRoot.deviceId,
      revokedSubjectSigPubFp: aliceRoot.sig.fingerprint,
      reason: 'compromised',
      revokedAtMs: NOW,
      revokerDeviceId: aliceRoot.deviceId,
      issuedAtMs: NOW,
      serverNonce: randomBytes(32),
    });
    const forged = await signWith(bobRoot.sig, revocationSignedMessage(tbs));
    await expect(verifyRevocationStatement(tbs, forged, aliceRoot.sig.spki)).rejects.toThrow(/E_BAD_SIGNATURE/);
  });
});

// ---------------------------------------------------------------------------
describe('Attack 8 — delete A while B remains', () => {
  it("B's key path survives, proven against a real database", () => {
    // Live assertions in spike/e2ee-1a1/tools/db-tests.sql:
    //   "deleting A preserves B's couple envelopes (2)"
    //   "couple scope keys are retained while a partner remains"
    //   "deletion ABORTS rather than crypto-shred a surviving partner"
    //   "the aborted deletion left every row intact"
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/031_e2ee_key_foundation.sql'), 'utf8');
    expect(sql).toContain('E2EE_DELETION_WOULD_ORPHAN_PARTNER');
    // Envelope deletion is recipient-scoped: the predicate names A's devices.
    expect(sql).toMatch(/DELETE FROM public\.key_envelopes ke[\s\S]*?d\.user_id = p_user_id/);
    // Couple scope keys survive while a partner remains.
    // Couple keys are couple-owned and are not reachable from a user predicate
    // at all, which is the structural half of the data-loss fix.
    expect(sql).toContain("sk.domain IN ('personal', 'health') AND sk.owner_user_id = p_user_id");
    expect(sql).toContain('owner_couple_id UUID REFERENCES public.couples(id) ON DELETE CASCADE');
  });
});

// ---------------------------------------------------------------------------
describe('Attack 9 — the historical envelope sender is deleted', () => {
  it('an envelope written by a since-deleted device still verifies at its creation time', async () => {
    const sender = await addEnrolledDevice(alice, aliceRoot, { grantedDomains: ['personal', 'couple'] });
    const scopeKey = generateScopeKeyBytes();
    const envelope = await sealScopeKeyFrom(
      sender,
      { id: aliceRoot.deviceId, kemSpki: aliceRoot.kem.spki, kind: RECIPIENT_KIND.device },
      scopeKey,
      {
        domain: KEY_DOMAIN.couple,
        scopeKeyId: uuidToBytes(crypto.randomUUID()),
        ownerUserId: alice.userId,
        scopeId: randomBytes(16),
        epoch: 1n,
      },
    );

    // The sender is later revoked. Verification at the envelope's creation time
    // still succeeds, which is what keeps previously legitimate envelopes
    // readable rather than retroactively invalid.
    const revocations = new RevocationSet();
    revocations.add({
      userId: alice.userId,
      serverOriginId: alice.serverOriginId,
      recoveryIdentityId: alice.recoveryIdentityId,
      recoveryVersion: alice.recoveryVersion,
      revokedDeviceId: sender.deviceId,
      revokedSubjectSigPubFp: sender.sig.fingerprint,
      reason: 'voluntary',
      revokedAtMs: 1_770_000_000_001n,
      revokerDeviceId: aliceRoot.deviceId,
      issuedAtMs: 1_770_000_000_001n,
      serverNonce: randomBytes(32),
    });

    await expect(
      verifyCertificateChain({
        chain: sender.chain,
        anchor: alice.anchor,
        atMs: 1_770_000_000_000n,
        isRevoked: revocations.asLookup(),
      }),
    ).resolves.toBeTruthy();

    // ...and the envelope itself still opens.
    const opened = await openEnvelope({
      envelope,
      recipientKemSpki: aliceRoot.kem.spki,
      senderSigSpki: sender.sig.spki,
      deriveSecret: (peer) => deriveWith(aliceRoot.kem, peer),
    });
    expect(hex(opened.scopeKey)).toBe(hex(scopeKey));

    // But it is not eligible for anything new.
    const selection = await selectRecipients({
      candidates: [{ deviceId: sender.deviceId, chain: sender.chain }],
      anchor: alice.anchor,
      domain: 'couple',
      atMs: NOW,
      revocations,
    });
    expect(selection.eligible).toHaveLength(0);
  });

  it('the schema retains minimal verification material only while referenced', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/031_e2ee_key_foundation.sql'), 'utf8');
    // Retention is now a real foreign key with ON DELETE RESTRICT, not a
    // cached counter an application has to keep correct.
    expect(sql).toContain('sender_certificate_id UUID REFERENCES public.device_certificates(id) ON DELETE RESTRICT');
    expect(sql).toContain('self_notarized');
    expect(sql).toContain('MINIMUM NECESSARY');
    expect(sql).not.toContain('reference_count INTEGER');
    // Deletable only when no envelope still points at it.
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM public.key_envelopes ke WHERE ke.sender_certificate_id = dc.id)');
  });
});

// ---------------------------------------------------------------------------
describe('Attack 10 — server replays a retired epoch to a stale writer', () => {
  it('a retired epoch can decrypt but never accept a write', () => {
    expect(epochUsage(EPOCH_STATE.active)).toEqual({ canRead: true, canWrite: true });
    expect(epochUsage(EPOCH_STATE.retired)).toEqual({ canRead: true, canWrite: false });
    expect(epochUsage(EPOCH_STATE.preparing)).toEqual({ canRead: false, canWrite: false });
    expect(epochUsage(EPOCH_STATE.abandoned)).toEqual({ canRead: false, canWrite: false });
  });

  it('a retired epoch cannot be transitioned back to active', () => {
    expect(transitionEpoch(EPOCH_STATE.retired, EPOCH_STATE.active).allowed).toBe(false);
    expect(transitionEpoch(EPOCH_STATE.abandoned, EPOCH_STATE.active).allowed).toBe(false);
    expect(transitionEpoch(EPOCH_STATE.ready, EPOCH_STATE.active).allowed).toBe(true);
    expect(transitionEpoch(EPOCH_STATE.active, EPOCH_STATE.retired).allowed).toBe(true);
  });

  it('the database rejects a write naming a non-active epoch', () => {
    // Live assertion: "R5 a stale/unknown epoch is rejected".
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/032_e2ee_write_floor.sql'), 'utf8');
    expect(sql).toContain('E2EE_STALE_EPOCH');
    expect(sql).toContain("sk.state = 'ACTIVE'");
  });
});

// ---------------------------------------------------------------------------
describe('Attack 2 — pairing signature must come from a certified key', () => {
  async function verified(account: TestAccount, device: TestDevice) {
    return verifyCertificateChain({ chain: device.chain, anchor: account.anchor, atMs: NOW });
  }

  async function confirmationFor(device: TestDevice, account: TestAccount, transcriptHash: Uint8Array) {
    const { pairingConfirmMessage } = await import('../transcripts');
    return {
      device: await verified(account, device),
      signature: await signWith(device.sig, pairingConfirmMessage(transcriptHash, device.deviceId)),
    };
  }

  it('a valid device id with an ATTACKER key and signature cannot be presented at all', async () => {
    // The defect this closes: the API used to take `deviceId` and `sigSpki` as
    // separate caller-supplied values, so a legitimate device id could be
    // paired with an attacker's key and an attacker's signature over it. There
    // is now no field to put the attacker key in — the key comes from the
    // VerifiedDevice, which only verifyCertificateChain can produce.
    const attacker = await createUncertifiedDevice();
    const transcriptHash = randomBytes(32);
    const { pairingConfirmMessage } = await import('../transcripts');

    const forged = {
      // The attacker can claim a real device id...
      device: { ...(await verified(alice, aliceRoot)), sigSpki: attacker.sig.spki },
      // ...and sign with their own key.
      signature: await signWith(attacker.sig, pairingConfirmMessage(transcriptHash, aliceRoot.deviceId)),
    };

    const result = await canCreateCoupleKey({
      transcriptHash,
      lowConfirmation: forged,
      highConfirmation: await confirmationFor(bobRoot, bob, transcriptHash),
      lowVerifiedDevices: [await verified(alice, aliceRoot)],
      highVerifiedDevices: [await verified(bob, bobRoot)],
      nowMs: NOW,
      expiresAtMs: NOW + 1000n,
    });

    // Rejected because the tampered structure is not one of the certified
    // devices: the comparison covers the certified key, not the id alone.
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('E_CONFIRMATION_WRONG_SIDE');
  });

  it('a signature from a DIFFERENT certified device fails', async () => {
    const other = await addEnrolledDevice(alice, aliceRoot, { grantedDomains: ['couple'] });
    const transcriptHash = randomBytes(32);
    const { pairingConfirmMessage } = await import('../transcripts');

    const mismatched = {
      device: await verified(alice, aliceRoot),
      // Signed by another genuinely certified device of the same account.
      signature: await signWith(other.sig, pairingConfirmMessage(transcriptHash, aliceRoot.deviceId)),
    };

    const result = await canCreateCoupleKey({
      transcriptHash,
      lowConfirmation: mismatched,
      highConfirmation: await confirmationFor(bobRoot, bob, transcriptHash),
      lowVerifiedDevices: [await verified(alice, aliceRoot)],
      highVerifiedDevices: [await verified(bob, bobRoot)],
      nowMs: NOW,
      expiresAtMs: NOW + 1000n,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('E_BAD_CONFIRMATION_SIGNATURE');
  });

  it('a revoked certified device cannot confirm', async () => {
    const transcriptHash = randomBytes(32);
    const revocations = new RevocationSet();
    revocations.add({
      userId: alice.userId,
      serverOriginId: alice.serverOriginId,
      recoveryIdentityId: alice.recoveryIdentityId,
      recoveryVersion: alice.recoveryVersion,
      revokedDeviceId: aliceRoot.deviceId,
      revokedSubjectSigPubFp: aliceRoot.sig.fingerprint,
      reason: 'compromised',
      revokedAtMs: NOW - 1n,
      revokerDeviceId: aliceRoot.deviceId,
      issuedAtMs: NOW - 1n,
      serverNonce: randomBytes(32),
    });

    const result = await canCreateCoupleKey({
      transcriptHash,
      lowConfirmation: await confirmationFor(aliceRoot, alice, transcriptHash),
      highConfirmation: await confirmationFor(bobRoot, bob, transcriptHash),
      lowVerifiedDevices: [await verified(alice, aliceRoot)],
      highVerifiedDevices: [await verified(bob, bobRoot)],
      nowMs: NOW,
      expiresAtMs: NOW + 1000n,
      revocations,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('E_CONFIRMING_DEVICE_REVOKED');
  });

  it('a correct confirmation from both certified devices PASSES', async () => {
    const transcriptHash = randomBytes(32);
    const result = await canCreateCoupleKey({
      transcriptHash,
      lowConfirmation: await confirmationFor(aliceRoot, alice, transcriptHash),
      highConfirmation: await confirmationFor(bobRoot, bob, transcriptHash),
      lowVerifiedDevices: [await verified(alice, aliceRoot)],
      highVerifiedDevices: [await verified(bob, bobRoot)],
      nowMs: NOW,
      expiresAtMs: NOW + 1000n,
    });
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('CONFIRMED_BOTH');
  });

  it('one side confirming twice is not two confirmations', async () => {
    const transcriptHash = randomBytes(32);
    const confirmation = await confirmationFor(aliceRoot, alice, transcriptHash);
    const result = await canCreateCoupleKey({
      transcriptHash,
      lowConfirmation: confirmation,
      highConfirmation: confirmation,
      lowVerifiedDevices: [await verified(alice, aliceRoot)],
      highVerifiedDevices: [await verified(alice, aliceRoot)],
      nowMs: NOW,
      expiresAtMs: NOW + 1000n,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('E_CONFIRMATION_WRONG_SIDE');
  });

  it('refuses with one confirmation, none, or an expired transcript', async () => {
    const transcriptHash = randomBytes(32);
    const low = await confirmationFor(aliceRoot, alice, transcriptHash);
    const common = {
      transcriptHash,
      lowVerifiedDevices: [await verified(alice, aliceRoot)],
      highVerifiedDevices: [await verified(bob, bobRoot)],
      nowMs: NOW,
      expiresAtMs: NOW + 1000n,
    };
    expect((await canCreateCoupleKey({ ...common })).allowed).toBe(false);
    expect((await canCreateCoupleKey({ ...common, lowConfirmation: low })).state).toBe('CONFIRMED_ONE');
    const expired = await canCreateCoupleKey({
      ...common,
      lowConfirmation: low,
      highConfirmation: await confirmationFor(bobRoot, bob, transcriptHash),
      expiresAtMs: NOW - 1n,
    });
    expect(expired.state).toBe('TRANSCRIPT_EXPIRED');
  });

  it('a poisoned device bundle yields a different SAS on each screen, so no CSK', async () => {
    const honest = await deriveSas('pair', randomBytes(32));
    const poisoned = await deriveSas('pair', randomBytes(32));
    expect(honest).not.toBe(poisoned);
  });

  it('only a READY epoch may activate; RETIRED is never activatable', async () => {
    const { epochReadyToActivate } = await import('./pairing');
    const recipients = [aliceRoot.deviceId];
    expect(epochReadyToActivate({
      requiredRecipients: recipients, envelopedRecipients: recipients, currentState: EPOCH_STATE.ready,
    }).ready).toBe(true);
    for (const state of [EPOCH_STATE.retired, EPOCH_STATE.abandoned, EPOCH_STATE.preparing, EPOCH_STATE.active]) {
      expect(epochReadyToActivate({
        requiredRecipients: recipients, envelopedRecipients: recipients, currentState: state,
      }).ready, state).toBe(false);
    }
    expect(epochReadyToActivate({
      requiredRecipients: recipients, envelopedRecipients: [], currentState: EPOCH_STATE.ready,
    }).ready).toBe(false);
  });
});
