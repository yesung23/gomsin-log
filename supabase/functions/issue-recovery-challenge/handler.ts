/**
 * `issue-recovery-challenge` — mint the fresh, single-use challenge a recovering
 * device must sign with the account's recovery key.
 *
 * This function is the reason a stolen session plus a full database dump is not
 * enough to recover an account. The dump contains public keys, RKEK-sealed
 * private blobs and spent challenges; none of it can produce an ECDSA signature
 * over a challenge issued AFTER the dump was taken, and only the user's 256-bit
 * kit secret unlocks the key that can. A client that could mint its own
 * challenge would destroy that property entirely, which is why issuance lives
 * here under `service_role` and behind one narrow RPC rather than in a table
 * policy.
 *
 * What it deliberately does NOT return: the recovery salt, either encrypted
 * private half, the bundle fingerprint, any scope key, any envelope, or any
 * user content. The recovering client already has to fetch the recovery bundle
 * through its own authenticated read; this endpoint's only output is a
 * challenge and the two timestamps that challenge is bound to.
 *
 * The handler is pure and takes its platform pieces as arguments, matching
 * `delete-account` and `approve-device`, so every branch is reachable from the
 * vitest suite without a Deno runtime.
 *
 * Logging rule: ids and error codes only. Never the challenge bytes — logging a
 * live challenge would put a credential in a log aggregator.
 */

import { encodeBase64 } from '../_shared/e2eeVerify.ts';

/** Two minutes. The verifier independently refuses a wider window. */
export const CHALLENGE_TTL_SECONDS = 120;

/**
 * Issued challenges per account per hour.
 *
 * This protects nothing cryptographic — the recovery secret is 256 bits — and
 * everything operational: it bounds how fast an attacker holding a session can
 * churn rows, and keeps a stuck client from filling the table.
 */
export const MAX_ISSUED_PER_HOUR = 10;

export type DeviceRow = {
  id: string;
  user_id: string;
  status: string;
};

export type RecoveryIdentityRow = {
  id: string;
  user_id: string;
  recovery_version: number;
  superseded_at: string | null;
};

/** The row `e2ee_issue_recovery_challenge` returns. `bytea` stays `bytea`. */
export type IssuedChallengeRow = {
  id: string;
  user_id: string;
  recovery_identity_id: string;
  recovery_version: number;
  new_device_id: string;
  /** PostgreSQL hex output. Decoded by the entrypoint, never by the client. */
  challenge_nonce: string;
  issued_at: string;
  expires_at: string;
};

export type IssueRecoveryChallengeDeps = {
  now: () => number;
  /** 32 cryptographically random bytes. WebCrypto in the entrypoint. */
  randomChallenge: () => Uint8Array;
  getDevice: (id: string) => Promise<DeviceRow | null>;
  getCurrentRecoveryIdentity: (userId: string) => Promise<RecoveryIdentityRow | null>;
  countIssuedLastHour: (userId: string) => Promise<number>;
  /**
   * Calls `e2ee_issue_recovery_challenge`, which re-checks ownership, device
   * state and identity liveness under a row lock. This handler's checks are the
   * readable rejection; that function is the one that cannot be raced.
   */
  issue: (input: {
    userId: string;
    deviceId: string;
    challenge: Uint8Array;
    ttlSeconds: number;
  }) => Promise<{ ok: true; row: IssuedChallengeRow } | { ok: false; code: string }>;
  logEvent: (event: string, detail: Record<string, string | number>) => void;
};

export type IssueRecoveryChallengeRequest = {
  deviceId?: unknown;
};

/**
 * The response body.
 *
 * `challengeId` is the opaque row identity; `challenge` is the secret material,
 * base64 for transport. They are separate values and the id is never derived
 * from the bytes — see `E5` in the Patch E scope and the unique-index reasoning
 * in migration 034.
 */
export type IssueRecoveryChallengeOutcome =
  | {
    status: 200;
    body: {
      challengeId: string;
      challenge: string;
      recoveryIdentityId: string;
      recoveryVersion: number;
      deviceId: string;
      issuedAt: string;
      expiresAt: string;
    };
  }
  | { status: 400 | 403 | 409 | 429; body: { error: string } };

export async function handleIssueRecoveryChallenge(
  request: IssueRecoveryChallengeRequest,
  callerUserId: string,
  deps: IssueRecoveryChallengeDeps,
): Promise<IssueRecoveryChallengeOutcome> {
  const reject = (status: 400 | 403 | 409 | 429, code: string): IssueRecoveryChallengeOutcome => {
    deps.logEvent('issue_recovery_challenge_rejected', { code, caller: callerUserId });
    return { status, body: { error: code } };
  };

  if (typeof callerUserId !== 'string' || callerUserId.length === 0) {
    return reject(403, 'E_UNAUTHENTICATED');
  }
  if (typeof request.deviceId !== 'string' || !isUuid(request.deviceId)) {
    return reject(400, 'E_BAD_REQUEST');
  }

  if (await deps.countIssuedLastHour(callerUserId) >= MAX_ISSUED_PER_HOUR) {
    return reject(429, 'E_TOO_MANY_CHALLENGES');
  }

  const device = await deps.getDevice(request.deviceId);
  if (!device) return reject(403, 'E_UNKNOWN_DEVICE');
  // The device must belong to the CALLER, not to whoever the body names.
  if (device.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');
  // Only a device that is nothing yet may start a recovery. An ACTIVE device
  // does not need one; a REVOKED or already-authenticated one must not get one.
  if (device.status !== 'PENDING') return reject(409, 'E_DEVICE_NOT_PENDING');

  const identity = await deps.getCurrentRecoveryIdentity(callerUserId);
  if (!identity) return reject(403, 'E_NO_RECOVERY_IDENTITY');
  if (identity.superseded_at) return reject(403, 'E_RECOVERY_IDENTITY_SUPERSEDED');
  // Belt and braces: the query filters by user, and this refuses to proceed if
  // it ever returned somebody else's row.
  if (identity.user_id !== callerUserId) return reject(403, 'E_WRONG_ACCOUNT');

  const challenge = deps.randomChallenge();
  if (!(challenge instanceof Uint8Array) || challenge.length !== 32) {
    return reject(400, 'E_BAD_CHALLENGE_WIDTH');
  }

  const issued = await deps.issue({
    userId: callerUserId,
    deviceId: device.id,
    challenge,
    ttlSeconds: CHALLENGE_TTL_SECONDS,
  });
  if (!issued.ok) return reject(409, issued.code);

  const row = issued.row;
  // The persisted row is authoritative for every field the client will bind
  // into its signature. Returning locally computed timestamps instead would
  // produce a transcript the verifier cannot reproduce.
  if (row.user_id !== callerUserId || row.new_device_id !== device.id) {
    return reject(409, 'E_CHALLENGE_MISMATCH');
  }
  if (row.recovery_identity_id !== identity.id) return reject(409, 'E_CHALLENGE_IDENTITY_MISMATCH');

  const challengeBytes = decodeIssuedChallenge(row.challenge_nonce);
  if (!challengeBytes) return reject(409, 'E_MALFORMED_STATE');

  deps.logEvent('issue_recovery_challenge_ok', {
    caller: callerUserId,
    deviceId: device.id,
    challengeId: row.id,
  });

  return {
    status: 200,
    body: {
      challengeId: row.id,
      // Base64 because this is an HTTP body. The row stores `bytea`.
      challenge: encodeBase64(challengeBytes),
      recoveryIdentityId: row.recovery_identity_id,
      recoveryVersion: row.recovery_version,
      deviceId: row.new_device_id,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    },
  };
}

/**
 * The RPC hands back a `bytea`, so this is the hex form.
 *
 * Kept as its own named step rather than inlined, because "which encoding is
 * this value in" is exactly the question the shared codec exists to make
 * unambiguous.
 */
function decodeIssuedChallenge(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') return null;
  if (!(value.startsWith('\\x') || value.startsWith('\\\\x'))) return null;
  const hex = value.replace(/^\\+x/, '');
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.trim().toLowerCase());
}
