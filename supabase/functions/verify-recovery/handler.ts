/**
 * `verify-recovery` — authenticate a recovering device against a fresh
 * server challenge.
 *
 * The property this exists to hold: a full database dump plus a stolen Auth
 * session must not recover any key. The dump contains public keys, RKEK-
 * encrypted blobs and spent challenges, none of which can produce a signature
 * over a challenge issued after the dump was taken. Only the user's 256-bit
 * recovery secret unlocks the key that can.
 *
 * A successful verification does NOT make the device an eligible envelope
 * recipient. It moves it to RECOVERY_AUTHENTICATED, from which it must still
 * provision and publish a certificate before anything is wrapped to it.
 */

import {
  concat,
  decodeBase64,
  decodeDbBytes,
  equalBytes,
  sha256,
  utf8,
  uuidToBytes,
  verifySignature,
} from '../_shared/e2eeVerify.ts';

export type ChallengeRow = {
  id: string;
  user_id: string;
  challenge_nonce: string;
  recovery_version: number;
  new_device_id: string | null;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
};

export type RecoveryIdentityRow = {
  id: string;
  recovery_version: number;
  rec_sig_spki: string;
  superseded_at: string | null;
};

export type DeviceRow = {
  id: string;
  user_id: string;
  sig_spki: string;
  kem_spki: string;
  status: string;
};

export type VerifyRecoveryDeps = {
  now: () => number;
  getServerOriginId: () => Promise<Uint8Array | null>;
  getChallenge: (challengeId: string) => Promise<ChallengeRow | null>;
  getCurrentRecoveryIdentity: (userId: string) => Promise<RecoveryIdentityRow | null>;
  getDevice: (id: string) => Promise<DeviceRow | null>;
  countRecentAttempts: (userId: string) => Promise<number>;
  /** Atomic: burn the challenge and move the device to RECOVERY_AUTHENTICATED. */
  commitAuthentication: (input: { challengeId: string; deviceId: string })
    => Promise<{ ok: true } | { ok: false; code: string }>;
  logEvent: (event: string, detail: Record<string, string | number>) => void;
};

export type VerifyRecoveryRequest = {
  challengeId?: unknown;
  deviceId?: unknown;
  signature?: unknown;
};

export type VerifyRecoveryOutcome =
  | { status: 200; body: { authenticated: true; deviceId: string; nextState: 'RECOVERY_AUTHENTICATED' } }
  | { status: 400 | 403 | 409 | 410 | 429; body: { error: string } };

export const MAX_ATTEMPTS_PER_HOUR = 5;
const CHALLENGE_TTL_MS = 120_000;

/**
 * Rebuild the challenge transcript from server state.
 *
 * Reconstructing rather than accepting a client-supplied transcript is the
 * point: a response can only verify if the client signed exactly the facts the
 * server holds, which is what blocks cross-account, cross-device and
 * cross-deployment replay as well as a downgrade to an older recovery bundle.
 */
export function buildRecoveryTranscript(input: {
  serverOriginId: Uint8Array;
  userId: Uint8Array;
  challengeId: Uint8Array;
  challengeNonce: Uint8Array;
  issuedAtMs: bigint;
  expiresAtMs: bigint;
  recoveryVersion: number;
  recSigPubFp: Uint8Array;
  newDeviceId: Uint8Array;
  newSigFp: Uint8Array;
  newKemFp: Uint8Array;
}): Uint8Array {
  const u64 = (value: bigint) => {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value, false);
    return out;
  };
  return concat(
    utf8('gomsinlog/recovery-auth/v1'),
    new Uint8Array([1, 1]),
    input.serverOriginId,
    input.userId,
    input.challengeId,
    input.challengeNonce,
    u64(input.issuedAtMs),
    u64(input.expiresAtMs),
    new Uint8Array([input.recoveryVersion]),
    input.recSigPubFp,
    input.newDeviceId,
    input.newSigFp,
    input.newKemFp,
  );
}

export async function handleVerifyRecovery(
  request: VerifyRecoveryRequest,
  callerUserId: string,
  deps: VerifyRecoveryDeps,
): Promise<VerifyRecoveryOutcome> {
  const reject = (status: 400 | 403 | 409 | 410 | 429, code: string): VerifyRecoveryOutcome => {
    deps.logEvent('verify_recovery_rejected', { code, caller: callerUserId });
    return { status, body: { error: code } };
  };

  if (typeof request.challengeId !== 'string' || typeof request.deviceId !== 'string') {
    return reject(400, 'E_BAD_REQUEST');
  }
  const signature = typeof request.signature === 'string' ? decodeBase64(request.signature) : null;
  if (!signature) return reject(400, 'E_BAD_REQUEST');

  // Rate limiting protects nothing cryptographic — the secret is 256 bits — and
  // everything operational.
  if (await deps.countRecentAttempts(callerUserId) >= MAX_ATTEMPTS_PER_HOUR) {
    return reject(429, 'E_TOO_MANY_ATTEMPTS');
  }

  const challenge = await deps.getChallenge(request.challengeId);
  if (!challenge) return reject(403, 'E_UNKNOWN_CHALLENGE');
  if (challenge.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');
  if (challenge.consumed_at) return reject(409, 'E_CHALLENGE_ALREADY_USED');

  const now = deps.now();
  const expiresAt = Date.parse(challenge.expires_at);
  const issuedAt = Date.parse(challenge.issued_at);
  if (expiresAt <= now) return reject(410, 'E_CHALLENGE_EXPIRED');
  if (expiresAt - issuedAt > CHALLENGE_TTL_MS + 1000) return reject(403, 'E_CHALLENGE_TTL_TOO_LONG');

  if (challenge.new_device_id && challenge.new_device_id !== request.deviceId) {
    return reject(403, 'E_CHALLENGE_DEVICE_MISMATCH');
  }

  const device = await deps.getDevice(request.deviceId);
  if (!device) return reject(403, 'E_UNKNOWN_DEVICE');
  if (device.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');
  if (device.status !== 'PENDING') return reject(409, 'E_DEVICE_NOT_PENDING');

  const identity = await deps.getCurrentRecoveryIdentity(callerUserId);
  if (!identity) return reject(403, 'E_NO_RECOVERY_IDENTITY');
  if (identity.superseded_at) return reject(403, 'E_RECOVERY_IDENTITY_SUPERSEDED');

  // Downgrade block: a response signed against a retired recovery generation is
  // refused even if that generation's key is otherwise valid.
  if (challenge.recovery_version !== identity.recovery_version) {
    return reject(403, 'E_RECOVERY_VERSION_MISMATCH');
  }

  const serverOriginId = await deps.getServerOriginId();
  if (!serverOriginId) return reject(403, 'E_NO_DEPLOYMENT_IDENTITY');

  const userIdBytes = uuidToBytes(callerUserId);
  const challengeIdBytes = uuidToBytes(challenge.id);
  const deviceIdBytes = uuidToBytes(device.id);
  const nonce = decodeDbBytes(challenge.challenge_nonce);
  const recSigSpki = decodeDbBytes(identity.rec_sig_spki);
  const deviceSigSpki = decodeDbBytes(device.sig_spki);
  const deviceKemSpki = decodeDbBytes(device.kem_spki);
  if (!userIdBytes || !challengeIdBytes || !deviceIdBytes || !nonce || !recSigSpki
    || !deviceSigSpki || !deviceKemSpki) {
    return reject(400, 'E_MALFORMED_STATE');
  }
  if (nonce.length !== 32) return reject(400, 'E_MALFORMED_STATE');

  const transcript = buildRecoveryTranscript({
    serverOriginId,
    userId: userIdBytes,
    challengeId: challengeIdBytes,
    challengeNonce: nonce,
    issuedAtMs: BigInt(issuedAt),
    expiresAtMs: BigInt(expiresAt),
    recoveryVersion: identity.recovery_version,
    recSigPubFp: await sha256(recSigSpki),
    newDeviceId: deviceIdBytes,
    newSigFp: await sha256(deviceSigSpki),
    newKemFp: await sha256(deviceKemSpki),
  });

  const ok = await verifySignature(recSigSpki, transcript, signature);
  if (!ok) return reject(403, 'E_BAD_RECOVERY_SIGNATURE');

  const committed = await deps.commitAuthentication({ challengeId: challenge.id, deviceId: device.id });
  if (!committed.ok) return reject(409, committed.code);

  deps.logEvent('verify_recovery_ok', { deviceId: device.id, caller: callerUserId });
  // Authenticated, not provisioned. The device is still not a recipient.
  return {
    status: 200,
    body: { authenticated: true, deviceId: device.id, nextState: 'RECOVERY_AUTHENTICATED' },
  };
}

export { equalBytes };
