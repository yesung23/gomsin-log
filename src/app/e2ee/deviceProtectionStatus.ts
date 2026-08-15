import type { BootstrapFacts } from './bootstrapStateMachine';

/**
 * The small set of protection answers that may be shown to a person.
 *
 * This intentionally does not expose protocol progress (keys, epochs, or
 * certificates). A status is only `PROTECTED` when the running account can
 * actually use its verified runtime; unknown is never rendered as protected.
 */
export type DeviceProtectionStatus =
  | 'PROTECTED'
  | 'SETUP_REQUIRED'
  | 'RECOVERY_REQUIRED'
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE';

export type DeviceProtectionSnapshot = {
  status: DeviceProtectionStatus;
  facts?: BootstrapFacts;
};

export function deviceProtectionStatusFromFacts(input: {
  facts: BootstrapFacts;
  hasServerRecoveryIdentity: boolean;
}): DeviceProtectionStatus {
  const { facts } = input;

  // A local bootstrap that reached COMPLETE but can no longer use its device
  // identity is not a fresh setup. Starting over would overwrite authority for
  // existing ciphertext, so direct the user to recovery instead.
  if (input.hasServerRecoveryIdentity
    && facts.recoveryConfirmed
    && (!facts.hasLocalIdentity || !facts.deviceEnrolled || !facts.personalKeysReady)) {
    return 'RECOVERY_REQUIRED';
  }

  if (facts.hasLocalIdentity
    && facts.recoveryConfirmed
    && facts.deviceEnrolled
    && facts.personalKeysReady
    && facts.runtimeReady) {
    return 'PROTECTED';
  }

  // A server-side recovery identity with no matching local bootstrap is the
  // reinstall/new-device case. It must never offer a replacement-key shortcut.
  if (input.hasServerRecoveryIdentity && !facts.hasLocalIdentity) {
    return 'RECOVERY_REQUIRED';
  }

  return 'SETUP_REQUIRED';
}
