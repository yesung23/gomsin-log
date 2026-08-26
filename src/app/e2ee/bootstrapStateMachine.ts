/**
 * The device-protection state machine.
 *
 * This is deliberately independent of React and Supabase. UI code renders a
 * state; use cases emit events; this reducer is the one place that defines which
 * transitions are legal. In particular, runtime readiness and an irreversible
 * write-floor activation are never implied by a device row's status.
 */

export const BOOTSTRAP_STATE = {
  uninitialized: 'UNINITIALIZED',
  localIdentityReady: 'LOCAL_IDENTITY_READY',
  recoveryCreated: 'RECOVERY_CREATED',
  recoveryConfirmed: 'RECOVERY_CONFIRMED',
  deviceEnrolled: 'DEVICE_ENROLLED',
  personalKeysReady: 'PERSONAL_KEYS_READY',
  coupleKeysPending: 'COUPLE_KEYS_PENDING',
  coupleKeysReady: 'COUPLE_KEYS_READY',
  runtimeReady: 'RUNTIME_READY',
  active: 'ACTIVE',
  error: 'ERROR',
} as const;

export type BootstrapState = (typeof BOOTSTRAP_STATE)[keyof typeof BOOTSTRAP_STATE];

export type BootstrapEvent =
  | 'LOCAL_IDENTITY_CREATED'
  | 'RECOVERY_CREATED'
  | 'RECOVERY_CONFIRMED'
  | 'DEVICE_ENROLLED'
  | 'PERSONAL_KEYS_READY'
  | 'COUPLE_KEYS_PENDING'
  | 'COUPLE_KEYS_READY'
  | 'RUNTIME_READY'
  | 'FLOOR_ACTIVATED'
  | 'FAILED'
  | 'RESET';

export class BootstrapStateError extends Error {
  readonly code = 'E_BOOTSTRAP_ILLEGAL_TRANSITION';

  constructor(state: BootstrapState, event: BootstrapEvent) {
    super(`cannot apply ${event} while bootstrap is ${state}`);
    this.name = 'BootstrapStateError';
  }
}

const transitions: Record<BootstrapState, Partial<Record<BootstrapEvent, BootstrapState>>> = {
  UNINITIALIZED: {
    LOCAL_IDENTITY_CREATED: 'LOCAL_IDENTITY_READY',
    FAILED: 'ERROR',
  },
  LOCAL_IDENTITY_READY: {
    RECOVERY_CREATED: 'RECOVERY_CREATED',
    FAILED: 'ERROR',
  },
  RECOVERY_CREATED: {
    RECOVERY_CONFIRMED: 'RECOVERY_CONFIRMED',
    FAILED: 'ERROR',
  },
  RECOVERY_CONFIRMED: {
    DEVICE_ENROLLED: 'DEVICE_ENROLLED',
    FAILED: 'ERROR',
  },
  DEVICE_ENROLLED: {
    PERSONAL_KEYS_READY: 'PERSONAL_KEYS_READY',
    FAILED: 'ERROR',
  },
  PERSONAL_KEYS_READY: {
    COUPLE_KEYS_PENDING: 'COUPLE_KEYS_PENDING',
    COUPLE_KEYS_READY: 'COUPLE_KEYS_READY',
    RUNTIME_READY: 'RUNTIME_READY',
    FAILED: 'ERROR',
  },
  COUPLE_KEYS_PENDING: {
    COUPLE_KEYS_READY: 'COUPLE_KEYS_READY',
    RUNTIME_READY: 'RUNTIME_READY',
    FAILED: 'ERROR',
  },
  COUPLE_KEYS_READY: {
    RUNTIME_READY: 'RUNTIME_READY',
    FAILED: 'ERROR',
  },
  RUNTIME_READY: {
    FLOOR_ACTIVATED: 'ACTIVE',
    COUPLE_KEYS_PENDING: 'COUPLE_KEYS_PENDING',
    FAILED: 'ERROR',
  },
  ACTIVE: {
    COUPLE_KEYS_PENDING: 'COUPLE_KEYS_PENDING',
    FAILED: 'ERROR',
  },
  ERROR: {
    RESET: 'UNINITIALIZED',
  },
};

export function transitionBootstrap(state: BootstrapState, event: BootstrapEvent): BootstrapState {
  const next = transitions[state][event];
  if (!next) throw new BootstrapStateError(state, event);
  return next;
}

export type BootstrapFacts = {
  hasLocalIdentity: boolean;
  recoveryCreated: boolean;
  recoveryConfirmed: boolean;
  deviceEnrolled: boolean;
  personalKeysReady: boolean;
  coupleKeysReady: boolean;
  runtimeReady: boolean;
  floorActive: boolean;
  /** Exact-scope floor facts keep personal setup separate from couple pairing. */
  personalFloorActive?: boolean;
  coupleFloorActive?: boolean;
  /** A current couple scope exists; key availability is separate from floor state. */
  hasCoupleScope?: boolean;
  error?: boolean;
};

/** Derive the semantic UI state from verified facts, in precedence order. */
export function bootstrapStateFromFacts(facts: BootstrapFacts): BootstrapState {
  if (facts.error) return BOOTSTRAP_STATE.error;
  if (!facts.hasLocalIdentity) return BOOTSTRAP_STATE.uninitialized;
  if (!facts.recoveryCreated) return BOOTSTRAP_STATE.localIdentityReady;
  if (!facts.recoveryConfirmed) return BOOTSTRAP_STATE.recoveryCreated;
  if (!facts.deviceEnrolled) return BOOTSTRAP_STATE.recoveryConfirmed;
  if (!facts.personalKeysReady) return BOOTSTRAP_STATE.deviceEnrolled;
  if (!facts.runtimeReady) {
    return facts.coupleKeysReady ? BOOTSTRAP_STATE.coupleKeysReady : BOOTSTRAP_STATE.coupleKeysPending;
  }
  if (facts.hasCoupleScope && !facts.coupleKeysReady) return BOOTSTRAP_STATE.coupleKeysPending;
  return facts.floorActive ? BOOTSTRAP_STATE.active : BOOTSTRAP_STATE.runtimeReady;
}
