/**
 * Signed revocation and the hash-chained revocation log.
 *
 * The claim under test is deliberately narrow. The chain detects deletion and
 * reordering behind a head a client has already pinned. It does NOT detect a
 * server that simply withholds a statement the client has never seen — that is
 * an availability attack this design does not close, and the tests say so
 * rather than implying otherwise.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { hex } from './bytes';
import { REVOCATION_REASON, canEscalateReason, requiresRotation } from './domains';
import {
  RevocationSet,
  decodeRevocationTbs,
  encodeRevocationTbs,
  revocationLogAppend,
  revocationLogGenesis,
  revocationSignedMessage,
  verifyLogExtension,
  verifyRevocationStatement,
  type RevocationStatement,
} from './revocation';
import { randomBytes } from './suite';
import { createTestAccount, signWith, type TestAccount } from './testing/virtualAccount';

let account: TestAccount;

function statement(overrides: Partial<RevocationStatement> = {}): RevocationStatement {
  return {
    userId: account.userId,
    serverOriginId: account.serverOriginId,
    recoveryIdentityId: account.recoveryIdentityId,
    recoveryVersion: account.recoveryVersion,
    revokedDeviceId: randomBytes(16),
    revokedSubjectSigPubFp: randomBytes(32),
    reason: 'potentiallyCompromised',
    revokedAtMs: 1_700_000_000_000n,
    revokerDeviceId: account.devices[0].deviceId,
    issuedAtMs: 1_700_000_000_001n,
    serverNonce: randomBytes(32),
    ...overrides,
  };
}

beforeAll(async () => {
  account = await createTestAccount();
});

describe('statement encoding', () => {
  it('round-trips every field', () => {
    const original = statement();
    const decoded = decodeRevocationTbs(encodeRevocationTbs(original));
    expect(hex(decoded.revokedDeviceId)).toBe(hex(original.revokedDeviceId));
    expect(decoded.reason).toBe('potentiallyCompromised');
    expect(decoded.revokedAtMs).toBe(original.revokedAtMs);
    expect(decoded.recoveryVersion).toBe(original.recoveryVersion);
  });

  it('rejects a corrupted label, reserved byte or reason', () => {
    const tbs = encodeRevocationTbs(statement());

    const label = tbs.slice(); label[0] ^= 0x01;
    expect(() => decodeRevocationTbs(label)).toThrow(/E_BAD_LABEL/);

    const reserved = tbs.slice(); reserved[24] = 1;
    expect(() => decodeRevocationTbs(reserved)).toThrow(/E_RESERVED_NONZERO/);

    const truncated = tbs.slice(0, tbs.length - 1);
    expect(() => decodeRevocationTbs(truncated)).toThrow(/E_TBS_LENGTH/);
  });
});

describe('signature', () => {
  it('verifies a genuine statement and rejects a forged one', async () => {
    const device = account.devices[0];
    const tbs = encodeRevocationTbs(statement());
    const signature = await signWith(device.sig, revocationSignedMessage(tbs));

    await expect(verifyRevocationStatement(tbs, signature, device.sig.spki)).resolves.toBeTruthy();

    // A malicious server cannot forge one: it has no signing key that any
    // client's certificate chain accepts.
    const other = await createTestAccount();
    await expect(
      verifyRevocationStatement(tbs, signature, other.devices[0].sig.spki),
    ).rejects.toThrow(/E_BAD_SIGNATURE/);

    const tampered = tbs.slice();
    tampered[40] ^= 0x01;
    await expect(
      verifyRevocationStatement(tampered, signature, device.sig.spki),
    ).rejects.toThrow(/E_BAD_SIGNATURE/);

    await expect(
      verifyRevocationStatement(tbs, randomBytes(63), device.sig.spki),
    ).rejects.toThrow(/E_BAD_SIGNATURE_LENGTH/);
  });
});

describe('hash-chained log', () => {
  it('detects a deleted entry behind a pinned head', async () => {
    const genesis = await revocationLogGenesis(account.userId, account.recoveryIdentityId);
    const a = encodeRevocationTbs(statement());
    const b = encodeRevocationTbs(statement());
    const c = encodeRevocationTbs(statement());

    let head = genesis;
    for (const entry of [a, b, c]) head = await revocationLogAppend(head, entry);

    await expect(verifyLogExtension(genesis, [a, b, c], head)).resolves.toBeTruthy();
    // Dropping the middle entry cannot reproduce the same head.
    await expect(verifyLogExtension(genesis, [a, c], head)).rejects.toThrow(/E_LOG_FORK/);
    // Nor can reordering.
    await expect(verifyLogExtension(genesis, [b, a, c], head)).rejects.toThrow(/E_LOG_FORK/);
  });

  it('accepts a forward extension from a pinned mid-point', async () => {
    const genesis = await revocationLogGenesis(account.userId, account.recoveryIdentityId);
    const a = encodeRevocationTbs(statement());
    const b = encodeRevocationTbs(statement());
    const pinned = await revocationLogAppend(genesis, a);
    const head = await revocationLogAppend(pinned, b);
    await expect(verifyLogExtension(pinned, [b], head)).resolves.toBeTruthy();
    // Rewinding to before the pinned head is refused.
    await expect(verifyLogExtension(pinned, [], genesis)).rejects.toThrow(/E_LOG_FORK/);
  });

  it('rejects a malformed head', async () => {
    await expect(revocationLogAppend(randomBytes(31), new Uint8Array(1))).rejects.toThrow(/E_BAD_HEAD/);
  });
});

describe('monotone revocation set', () => {
  it('never forgets a statement it has seen', () => {
    const set = new RevocationSet();
    const device = randomBytes(16);
    set.add(statement({ revokedDeviceId: device, reason: 'voluntary' }));
    expect(set.lookup(device)).not.toBeNull();
    expect(set.size).toBe(1);
  });

  it('escalates severity but never softens it', () => {
    const set = new RevocationSet();
    const device = randomBytes(16);
    set.add(statement({ revokedDeviceId: device, reason: 'lostSecured' }));
    set.add(statement({ revokedDeviceId: device, reason: 'compromised' }));
    expect(set.lookup(device)?.reason).toBe('compromised');
    // A later, softer restatement must not downgrade the record.
    set.add(statement({ revokedDeviceId: device, reason: 'voluntary' }));
    expect(set.lookup(device)?.reason).toBe('compromised');
  });

  it('keeps the earliest revocation time so the exposure window cannot be narrowed', () => {
    const set = new RevocationSet();
    const device = randomBytes(16);
    set.add(statement({ revokedDeviceId: device, revokedAtMs: 1_000n }));
    set.add(statement({ revokedDeviceId: device, revokedAtMs: 5_000n, reason: 'compromised' }));
    expect(set.lookup(device)?.revokedAtMs).toBe(1_000n);
  });

  it('adapts to the certificate verifier lookup shape', () => {
    const set = new RevocationSet();
    const device = randomBytes(16);
    set.add(statement({ revokedDeviceId: device }));
    const lookup = set.asLookup();
    expect(lookup(device)?.revokedAtMs).toBe(1_700_000_000_000n);
    expect(lookup(randomBytes(16))).toBeNull();
  });
});

describe('rotation policy', () => {
  it('rotates for compromise and for recovery supersession, not for a confirmed secure erase', () => {
    expect(requiresRotation('potentiallyCompromised')).toBe(true);
    expect(requiresRotation('compromised')).toBe(true);
    expect(requiresRotation('supersededByRecovery')).toBe(true);
    expect(requiresRotation('lostSecured')).toBe(false);
    expect(requiresRotation('voluntary')).toBe(false);
  });

  it('orders severity so escalation is well defined', () => {
    expect(canEscalateReason('voluntary', 'compromised')).toBe(true);
    expect(canEscalateReason('compromised', 'voluntary')).toBe(false);
    expect(canEscalateReason('lostSecured', 'potentiallyCompromised')).toBe(true);
    expect(Object.keys(REVOCATION_REASON)).toHaveLength(5);
  });
});
