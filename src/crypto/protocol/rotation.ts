/**
 * Domain-aware revocation and scope-key rotation.
 *
 * Generic over the domain on purpose: a compromised device held whatever it was
 * provisioned with, so revoking it has to rotate PMK, HRK and every CSK it
 * could open — not just the couple key.
 *
 * What rotation does NOT do, stated plainly because the UI copy depends on it:
 * it protects content written after the new epoch becomes ACTIVE, and nothing
 * else. Plaintext the device already displayed, keys it already holds, and
 * ciphertext it already copied are all permanently exposed. Cryptography cannot
 * revoke what has already been read.
 */

import { hex } from '../bytes';
import {
  EPOCH_STATE,
  defaultsToCompromised,
  requiresRotation,
  type Assurance,
  type EpochState,
  type KeyDomainName,
  type RevocationReasonName,
} from '../domains';

export type HeldScope = {
  domain: KeyDomainName;
  scopeId: Uint8Array;
  epoch: bigint;
};

export type RevocationPlan = {
  reason: RevocationReasonName;
  rotate: HeldScope[];
  /** Scopes deliberately left alone, with why. */
  skipped: { scope: HeldScope; reason: string }[];
  deleteEnvelopesForDevice: boolean;
};

/**
 * Choose the revocation reason for a lost device.
 *
 * The default is the safe one. `lostSecured` — the only lost-device outcome
 * that skips rotation — requires the user to affirm a confirmed secure erase or
 * physical recovery, and a web device is never eligible for it because the app
 * cannot attest browser storage.
 */
export function classifyLostDevice(input: {
  assurance: Assurance;
  userConfirmedSecureErase: boolean;
}): RevocationReasonName {
  if (!input.userConfirmedSecureErase) return 'potentiallyCompromised';
  if (defaultsToCompromised(input.assurance)) return 'potentiallyCompromised';
  return 'lostSecured';
}

/**
 * Plan a revocation.
 *
 * Every scope the device held rotates when the reason implies compromise. There
 * is no partial rotation: a device that could open the health key and the
 * couple key compromises both.
 */
export function planRevocation(input: {
  reason: RevocationReasonName;
  heldScopes: HeldScope[];
}): RevocationPlan {
  if (!requiresRotation(input.reason)) {
    return {
      reason: input.reason,
      rotate: [],
      skipped: input.heldScopes.map((scope) => ({
        scope,
        reason: `reason ${input.reason} does not imply key exposure`,
      })),
      deleteEnvelopesForDevice: true,
    };
  }
  return {
    reason: input.reason,
    rotate: [...input.heldScopes],
    skipped: [],
    deleteEnvelopesForDevice: true,
  };
}

export type EpochTransition = {
  from: EpochState;
  to: EpochState;
  allowed: boolean;
  reason?: string;
};

const ALLOWED: Record<EpochState, EpochState[]> = {
  [EPOCH_STATE.preparing]: [EPOCH_STATE.ready, EPOCH_STATE.abandoned],
  [EPOCH_STATE.ready]: [EPOCH_STATE.active, EPOCH_STATE.abandoned],
  [EPOCH_STATE.active]: [EPOCH_STATE.retired],
  // Terminal. A retired epoch stays readable forever and is never deleted just
  // because rotation happened: historical ciphertext still needs it.
  [EPOCH_STATE.retired]: [],
  [EPOCH_STATE.abandoned]: [],
};

export function transitionEpoch(from: EpochState, to: EpochState): EpochTransition {
  const allowed = ALLOWED[from].includes(to);
  return {
    from,
    to,
    allowed,
    reason: allowed ? undefined : `illegal epoch transition ${from} -> ${to}`,
  };
}

/** A retired epoch may still decrypt; it may never accept a write. */
export function epochUsage(state: EpochState): { canRead: boolean; canWrite: boolean } {
  return {
    canRead: state === EPOCH_STATE.active || state === EPOCH_STATE.retired,
    canWrite: state === EPOCH_STATE.active,
  };
}

/**
 * Whether a revoked device may still receive an envelope for a new epoch.
 *
 * Always no. Kept as a named function so the rule is testable directly rather
 * than only through the recipient filter.
 */
export function revokedDeviceMayReceiveNewEpoch(): false {
  return false;
}

export type RotationOutcome = {
  newEpoch: bigint;
  state: EpochState;
  /** Old epochs, which stay readable. Never deleted here. */
  retained: bigint[];
};

/**
 * Compute the next epoch number and what survives.
 *
 * Epochs are append-only. An interrupted rotation leaves a PREPARING row that
 * nothing references, which is why a half-finished rotation is a non-event
 * rather than a recovery problem.
 */
export function planRotation(input: {
  currentEpochs: { epoch: bigint; state: EpochState }[];
}): RotationOutcome {
  const highest = input.currentEpochs.reduce((max, e) => (e.epoch > max ? e.epoch : max), 0n);
  return {
    newEpoch: highest + 1n,
    state: EPOCH_STATE.preparing,
    retained: input.currentEpochs
      .filter((e) => e.state === EPOCH_STATE.active || e.state === EPOCH_STATE.retired)
      .map((e) => e.epoch),
  };
}

/**
 * The honest limits of rotation, as data so the UI cannot quietly overstate it.
 */
export const ROTATION_LIMITS = {
  protects: 'content written after the new epoch becomes ACTIVE',
  doesNotProtect: [
    'plaintext the device already displayed or exported',
    'scope keys the device already holds for older epochs',
    'ciphertext the attacker already copied, which those older keys still open',
  ],
} as const;

export function describeRotationLimits(scopes: HeldScope[]): string[] {
  return scopes.map((scope) => `${scope.domain}:${hex(scope.scopeId).slice(0, 8)} epoch ${scope.epoch} remains readable by anyone holding that key`);
}
