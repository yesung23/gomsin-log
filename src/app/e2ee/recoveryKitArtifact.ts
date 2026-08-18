import { fromBase64, toBase64 } from '@/crypto/bytes';
import { encodeKitAnchor, type RecoveryKitAnchor } from '@/crypto/recoveryCode';

const PREFIX = 'GLRK1-';
const ANCHOR_BYTES = 97;

/**
 * A transport/display form for the existing canonical recovery-kit anchor.
 *
 * This does not introduce a key format or cryptographic protocol: it carries
 * the exact bytes `verifyKitAnchor` already requires. The recovery code remains
 * the secret half; this value is public binding data and is required to detect
 * the wrong account, origin, or recovery generation.
 */
export function formatRecoveryKitArtifact(anchor: RecoveryKitAnchor): string {
  return `${PREFIX}${toBase64(encodeKitAnchor(anchor))}`;
}

export function parseRecoveryKitArtifact(input: string): RecoveryKitAnchor {
  const text = input.replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) throw new Error('E_RECOVERY_ARTIFACT_FORMAT');
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(text.slice(PREFIX.length));
  } catch {
    throw new Error('E_RECOVERY_ARTIFACT_FORMAT');
  }
  if (bytes.length !== ANCHOR_BYTES) throw new Error('E_RECOVERY_ARTIFACT_FORMAT');
  return {
    recoveryIdentityId: bytes.slice(0, 16),
    recoveryVersion: bytes[16],
    recoveryBundleFp: bytes.slice(17, 49),
    serverOriginId: bytes.slice(49, 81),
    userId: bytes.slice(81, 97),
  };
}
