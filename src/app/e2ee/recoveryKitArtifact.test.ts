import { describe, expect, it } from 'vitest';
import { equalBytes } from '@/crypto/bytes';
import { formatRecoveryKitArtifact, parseRecoveryKitArtifact } from './recoveryKitArtifact';

const anchor = {
  recoveryIdentityId: new Uint8Array(16).fill(1),
  recoveryVersion: 2,
  recoveryBundleFp: new Uint8Array(32).fill(3),
  serverOriginId: new Uint8Array(32).fill(4),
  userId: new Uint8Array(16).fill(5),
};

describe('recovery kit artifact', () => {
  it('round-trips every canonical anchor field without serializing it as JSON', () => {
    const encoded = formatRecoveryKitArtifact(anchor);
    expect(encoded).toMatch(/^GLRK1-/);
    expect(encoded).not.toContain('{');
    const decoded = parseRecoveryKitArtifact(encoded);
    expect(decoded.recoveryVersion).toBe(anchor.recoveryVersion);
    expect(equalBytes(decoded.recoveryIdentityId, anchor.recoveryIdentityId)).toBe(true);
    expect(equalBytes(decoded.recoveryBundleFp, anchor.recoveryBundleFp)).toBe(true);
    expect(equalBytes(decoded.serverOriginId, anchor.serverOriginId)).toBe(true);
    expect(equalBytes(decoded.userId, anchor.userId)).toBe(true);
  });

  it('rejects a truncated or unmarked artifact', () => {
    expect(() => parseRecoveryKitArtifact('not-a-kit')).toThrow('E_RECOVERY_ARTIFACT_FORMAT');
    expect(() => parseRecoveryKitArtifact('GLRK1-AQ==')).toThrow('E_RECOVERY_ARTIFACT_FORMAT');
  });
});
