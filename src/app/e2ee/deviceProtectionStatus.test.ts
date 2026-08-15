import { describe, expect, it } from 'vitest';
import { deviceProtectionStatusFromFacts } from './deviceProtectionStatus';
import type { BootstrapFacts } from './bootstrapStateMachine';

const setupFacts: BootstrapFacts = {
  hasLocalIdentity: false,
  recoveryCreated: false,
  recoveryConfirmed: false,
  deviceEnrolled: false,
  personalKeysReady: false,
  coupleKeysReady: false,
  runtimeReady: false,
  floorActive: false,
};

describe('deviceProtectionStatusFromFacts', () => {
  it('requires setup when neither this device nor the server has protection authority', () => {
    expect(deviceProtectionStatusFromFacts({ facts: setupFacts, hasServerRecoveryIdentity: false }))
      .toBe('SETUP_REQUIRED');
  });

  it('requires recovery rather than replacing keys after a reinstall', () => {
    expect(deviceProtectionStatusFromFacts({ facts: setupFacts, hasServerRecoveryIdentity: true }))
      .toBe('RECOVERY_REQUIRED');
  });

  it('only reports protected after the usable runtime is installed', () => {
    const facts = {
      ...setupFacts,
      hasLocalIdentity: true,
      recoveryCreated: true,
      recoveryConfirmed: true,
      deviceEnrolled: true,
      personalKeysReady: true,
    };
    expect(deviceProtectionStatusFromFacts({ facts, hasServerRecoveryIdentity: true }))
      .toBe('SETUP_REQUIRED');
    expect(deviceProtectionStatusFromFacts({ facts: { ...facts, runtimeReady: true }, hasServerRecoveryIdentity: true }))
      .toBe('PROTECTED');
  });

  it('treats a completed bootstrap with missing local identity as recovery-required', () => {
    expect(deviceProtectionStatusFromFacts({
      facts: { ...setupFacts, recoveryConfirmed: true },
      hasServerRecoveryIdentity: true,
    })).toBe('RECOVERY_REQUIRED');
  });
});
