/**
 * Regression tests for the Phase 1A P0 closure.
 *
 * Two jobs, and the second is the important one:
 *
 *   1. Pin the SQL contract in migration 035 by inspection, so a future edit
 *      that removes the issuer persistence, the provisioning gate or the
 *      readiness completeness check fails here rather than in production. This is
 *      static evidence; the executable proof is `scripts/e2ee/p0-harness.mjs`,
 *      which runs these functions on a real PostgreSQL 17 cluster.
 *
 *   2. Pin the FAKE against the same contract. Every one of these P0s survived
 *      review because `memoryEnvironment` was more permissive than the database:
 *      it auto-filled the issuer certificate, returned both partners' envelopes,
 *      and let the application assign `status = 'ACTIVE'`. A test double that is
 *      easier to satisfy than the real thing does not reduce risk, it hides it —
 *      so the divergences are asserted closed here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KIT_ANCHOR_BYTES,
  deriveKitAnchorTagV2,
  deriveKitBinding,
  encodeKitAnchor,
  verifyKitAnchor,
  type RecoveryKitAnchor,
} from '@/crypto/recoveryCode';
import {
  createMemoryAccount,
  createMemoryServer,
  linkCouple,
} from '@/app/e2ee/testing/memoryEnvironment';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/035_e2ee_phase1a_p0_closure.sql'),
  'utf8',
);

// ---------------------------------------------------------------------------
// P0-1 — issuer certificate persistence
// ---------------------------------------------------------------------------

describe('P0-1 — the approval RPC persists the server-verified issuer', () => {
  it('takes the issuer certificate as a parameter and inserts it', () => {
    expect(migration).toMatch(/p_issuer_certificate_id UUID/);
    // The INSERT must name the column; the old version omitted it entirely and
    // therefore violated device_certificates_chain on every honest approval.
    const insert = migration.slice(
      migration.indexOf('INSERT INTO public.device_certificates'),
      migration.indexOf('RETURNING id INTO v_certificate_id'),
    );
    expect(insert).toMatch(/issuer_certificate_id/);
    expect(insert).toMatch(/p_issuer_certificate_id/);
  });

  it('re-validates the issuer rather than trusting the caller', () => {
    for (const guard of [
      'E2EE_ISSUER_CERTIFICATE_REQUIRED',
      'E2EE_UNKNOWN_ISSUER_CERTIFICATE',
      'E2EE_ISSUER_WRONG_ACCOUNT',
      'E2EE_ISSUER_NOT_APPROVER',
      'E2EE_ISSUER_RECOVERY_MISMATCH',
      'E2EE_ISSUER_REVOKED',
      'E2EE_ISSUER_GRANT_ESCALATION',
    ]) {
      expect(migration).toContain(guard);
    }
  });

  it('binds the issuer to the enrollment\'s approver, not to any same-account row', () => {
    expect(migration).toMatch(/v_issuer\.subject_device_id <> v_enrollment\.approver_device_id/);
  });
});

// ---------------------------------------------------------------------------
// P0-2 — approval is not activation
// ---------------------------------------------------------------------------

describe('P0-2 — PENDING → PROVISIONING → ACTIVE', () => {
  it('approval sets PROVISIONING and never ACTIVE', () => {
    const approval = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.e2ee_commit_device_approval'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.e2ee_commit_recovery_authentication'),
    );
    expect(approval).toMatch(/SET status = 'PROVISIONING'/);
    expect(approval).not.toMatch(/SET status = 'ACTIVE'/);
  });

  it('activation requires a certificate, no revocation, and full coverage', () => {
    const finalize = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.e2ee_finalize_device_provisioning'),
    );
    expect(finalize).toMatch(/E2EE_DEVICE_UNCERTIFIED/);
    expect(finalize).toMatch(/E2EE_DEVICE_REVOKED/);
    expect(finalize).toMatch(/E2EE_PROVISIONING_INCOMPLETE/);
    expect(finalize).toMatch(/e2ee_missing_device_coverage/);
  });

  it('a client cannot promote a device by direct UPDATE or INSERT', () => {
    // `authenticated` holds UPDATE on devices, so the gate has to be a trigger.
    expect(migration).toMatch(/CREATE TRIGGER trg_devices_status_transition/);
    expect(migration).toMatch(/CREATE TRIGGER trg_devices_insert_status/);
    expect(migration).toContain('E2EE_DEVICE_STATUS_FORBIDDEN');
    expect(migration).toContain('E2EE_DEVICE_MUST_START_PENDING');
  });

  it('requires self-notarization before a device counts as provisioned', () => {
    expect(migration).toMatch(/ke\.self_notarized = true/);
  });
});

// ---------------------------------------------------------------------------
// P0-3 — readiness without weakening RLS
// ---------------------------------------------------------------------------

describe('P0-3 — completeness moves into the database', () => {
  it('mark_epoch_ready counts required recipients instead of "at least one"', () => {
    const ready = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.e2ee_mark_epoch_ready'),
      migration.indexOf('COMMENT ON FUNCTION public.e2ee_mark_epoch_ready'),
    );
    expect(ready).toMatch(/e2ee_required_epoch_recipients/);
    expect(ready).toContain('E2EE_EPOCH_INCOMPLETE');
    expect(ready).not.toMatch(/E2EE_EPOCH_NO_RECIPIENTS/);
  });

  it('does not weaken any envelope SELECT policy', () => {
    // The fix must not touch read policies: A still cannot read B's ciphertext.
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*key_envelopes[\s\S]*FOR SELECT/);
    expect(migration).not.toMatch(/DROP POLICY[^\n]*Recipient reads own envelopes/);
  });

  it('requires recovery coverage as well as device coverage', () => {
    const required = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.e2ee_required_epoch_recipients'),
    );
    expect(required).toMatch(/recovery_identities/);
    expect(required).toMatch(/superseded_at IS NULL/);
  });

  it('closes the three-valued-logic hole that let an unrelated user manage an epoch', () => {
    // `NOT NULL` is NULL, so `IF NOT can_manage(...)` never fired for a caller
    // with no active couple. Every transition must use the NULL-safe form.
    // The old form may appear in a comment explaining the defect, so the check
    // targets executable occurrences: lines that are not comments.
    const executable = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(executable).not.toMatch(/IF NOT public\.e2ee_can_manage_scope_key/);
    const occurrences = migration.match(/e2ee_can_manage_scope_key\(v_key\) IS NOT TRUE/g) ?? [];
    expect(occurrences.length).toBe(3); // ready, activate, abandon
  });
});

// ---------------------------------------------------------------------------
// P0-4 — the recovery kit anchor is mandatory
// ---------------------------------------------------------------------------

describe('P0-4 — recovery kit external trust anchor', () => {
  const base: RecoveryKitAnchor = {
    recoveryIdentityId: new Uint8Array(16).fill(1),
    recoveryVersion: 3,
    recoveryBundleFp: new Uint8Array(32).fill(2),
    serverOriginId: new Uint8Array(32).fill(3),
    userId: new Uint8Array(16).fill(4),
  };

  it('binds all six required fields in a fixed-width canonical encoding', () => {
    expect(encodeKitAnchor(base)).toHaveLength(KIT_ANCHOR_BYTES);
    expect(KIT_ANCHOR_BYTES).toBe(16 + 1 + 32 + 32 + 16);
  });

  it('accepts a matching served anchor', async () => {
    await expect(verifyKitAnchor({ secret: new Uint8Array(32), anchor: base }, base))
      .resolves.toBeUndefined();
  });

  it('rejects a version rollback to an older genuine bundle', async () => {
    // The exact V2.1 attack: the server offers generation 2 with its real
    // fingerprint while the kit names generation 3.
    const older: RecoveryKitAnchor = {
      ...base,
      recoveryVersion: 2,
      recoveryBundleFp: new Uint8Array(32).fill(0x99),
      recoveryIdentityId: new Uint8Array(16).fill(0x88),
    };
    await expect(verifyKitAnchor({ secret: new Uint8Array(32), anchor: base }, older))
      .rejects.toThrow(/E_KIT_IDENTITY_MISMATCH/);
  });

  it('rejects a rollback that keeps the identity but lowers the generation', async () => {
    await expect(verifyKitAnchor(
      { secret: new Uint8Array(32), anchor: base },
      { ...base, recoveryVersion: 2 },
    )).rejects.toThrow(/E_KIT_VERSION_MISMATCH/);
  });

  it('rejects a NEWER generation too, so a server cannot retire a live kit', async () => {
    await expect(verifyKitAnchor(
      { secret: new Uint8Array(32), anchor: base },
      { ...base, recoveryVersion: 4 },
    )).rejects.toThrow(/E_KIT_VERSION_MISMATCH/);
  });

  it.each([
    ['recoveryBundleFp', 'E_KIT_BUNDLE_MISMATCH', { recoveryBundleFp: new Uint8Array(32).fill(9) }],
    ['userId', 'E_KIT_ACCOUNT_MISMATCH', { userId: new Uint8Array(16).fill(9) }],
    ['serverOriginId', 'E_KIT_ORIGIN_MISMATCH', { serverOriginId: new Uint8Array(32).fill(9) }],
    ['recoveryIdentityId', 'E_KIT_IDENTITY_MISMATCH', { recoveryIdentityId: new Uint8Array(16).fill(9) }],
  ])('rejects %s substitution with %s', async (_field, code, override) => {
    await expect(verifyKitAnchor(
      { secret: new Uint8Array(32), anchor: base },
      { ...base, ...override } as RecoveryKitAnchor,
    )).rejects.toThrow(new RegExp(code));
  });

  it('rejects a malformed anchor rather than comparing partial data', async () => {
    await expect(verifyKitAnchor(
      { secret: new Uint8Array(32), anchor: { ...base, recoveryIdentityId: new Uint8Array(4) } },
      base,
    )).rejects.toThrow(/E_FIELD_WIDTH/);
    await expect(verifyKitAnchor(
      { secret: new Uint8Array(32), anchor: { ...base, recoveryVersion: 0 } },
      base,
    )).rejects.toThrow(/E_FIELD_WIDTH/);
  });

  it('binds a secret to exactly one anchor, so the halves cannot be recombined', async () => {
    const secret = new Uint8Array(32).fill(7);
    const bound = await deriveKitBinding(secret, base);
    const elsewhere = await deriveKitBinding(secret, { ...base, recoveryVersion: 4 });
    expect(Buffer.from(bound).toString('hex')).not.toBe(Buffer.from(elsewhere).toString('hex'));
  });

  it('derives a display tag that changes with every anchor field', async () => {
    const tag = await deriveKitAnchorTagV2(base);
    expect(tag).toMatch(/^\d{3}-\d{3}-\d{3}-\d{3}$/);
    for (const override of [
      { recoveryVersion: 4 },
      { userId: new Uint8Array(16).fill(9) },
      { serverOriginId: new Uint8Array(32).fill(9) },
    ]) {
      expect(await deriveKitAnchorTagV2({ ...base, ...override } as RecoveryKitAnchor))
        .not.toBe(tag);
    }
  });
});

// ---------------------------------------------------------------------------
// P0-5 — recovery rotates every owned CSK
// ---------------------------------------------------------------------------

describe('P0-5 — couple scope discovery is server-side', () => {
  it('exposes a discovery function that takes no caller-supplied list', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.e2ee_owned_couple_scope_ids\(\)/);
    const discovery = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.e2ee_owned_couple_scope_ids'),
    );
    expect(discovery).toMatch(/auth\.uid\(\)/);
    expect(discovery).toMatch(/cm\.status = 'active'/);
  });

  it('the recovery use case no longer accepts a caller-selected couple', async () => {
    const source = readFileSync(resolve(ROOT, 'src/app/e2ee/useCases.ts'), 'utf8');
    const recover = source.slice(
      source.indexOf('export async function recoverWithKit'),
      source.indexOf('/** The certified signing key of whoever wrote an envelope. */'),
    );
    expect(recover).not.toMatch(/coupleId\?:/);
    expect(recover).toMatch(/listOwnedCoupleScopeIds\(\)/);
    // And a scope that fails to rotate must stop the recovery.
    expect(recover).toContain('E_RECOVERY_ROTATION_INCOMPLETE');
  });

  it('the fake discovers the couple from membership, not from an argument', async () => {
    const server = createMemoryServer();
    const alice = createMemoryAccount(server);
    const bob = createMemoryAccount(server);
    const coupleId = linkCouple(server, alice.userId, bob.userId);

    const repositoryOf = (account: typeof alice) => account.devices[0].deps.repository;

    // No live epoch yet: nothing to rotate.
    await expect(repositoryOf(alice).listOwnedCoupleScopeIds()).resolves.toEqual([]);

    server.scopeKeys.push({
      id: crypto.randomUUID(),
      domain: 'couple',
      scopeId: coupleId,
      ownerUserId: null,
      ownerCoupleId: coupleId,
      epoch: 1n,
      state: 'ACTIVE',
    });

    await expect(repositoryOf(alice).listOwnedCoupleScopeIds()).resolves.toEqual([coupleId]);
    await expect(repositoryOf(bob).listOwnedCoupleScopeIds()).resolves.toEqual([coupleId]);

    // An unrelated account discovers nothing.
    const carol = createMemoryAccount(server);
    await expect(repositoryOf(carol).listOwnedCoupleScopeIds()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MemoryEnvironment parity
// ---------------------------------------------------------------------------

describe('memoryEnvironment parity with the database contract', () => {
  const fake = readFileSync(resolve(ROOT, 'src/app/e2ee/testing/memoryEnvironment.ts'), 'utf8');

  it('no longer auto-fills the issuer certificate id', () => {
    // The fake used to look up the approver's newest certificate and supply it
    // itself, which is exactly why the missing RPC parameter went unnoticed.
    expect(fake).not.toMatch(/issuerCertificateId: approverCertificate\?\.id \?\? null/);
  });

  it('enforces the recipient-reads-own-envelopes policy', () => {
    expect(fake).toMatch(/envelopeVisibleTo\(server, e, userId\)/);
  });

  it('enforces epoch completeness and scope ownership', () => {
    expect(fake).toMatch(/E2EE_EPOCH_INCOMPLETE/);
    expect(fake).toMatch(/E2EE_EPOCH_FORBIDDEN/);
    expect(fake).toMatch(/requiredRecipients\(server, scope\)/);
  });

  it('routes activation through a finalization gate rather than assignment', () => {
    expect(fake).toMatch(/finalizeDeviceProvisioning/);
    expect(fake).toMatch(/E2EE_PROVISIONING_INCOMPLETE/);
    expect(fake).toMatch(/E2EE_DEVICE_NOT_PROVISIONING/);
  });

  it('the application never writes device status directly any more', () => {
    const source = readFileSync(resolve(ROOT, 'src/app/e2ee/useCases.ts'), 'utf8');
    // REVOKED and PROVISIONING_FAILED remain client-writable: they are the two
    // transitions that lower a device's standing, and the database permits them
    // for exactly that reason. Promotions must not appear.
    expect(source).not.toMatch(/setDeviceStatus\([^)]*'ACTIVE'\)/);
    expect(source).not.toMatch(/setDeviceStatus\([^)]*'PROVISIONING'\)/);
    expect(source).not.toMatch(/setDeviceStatus\([^)]*'RECOVERY_AUTHENTICATED'\)/);
    expect(source).toMatch(/finalizeDeviceProvisioning\(/);
    expect(source).toMatch(/beginDeviceProvisioning\(/);
  });
});
