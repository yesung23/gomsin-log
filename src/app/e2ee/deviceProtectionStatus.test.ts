import { describe, expect, it } from 'vitest';
import { deviceProtectionStatusFromFacts } from './deviceProtectionStatus';
import { activeCoupleScopeId } from './settingsFacts';
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

  it('only reports protected after the runtime and write floor are ready', () => {
    const facts = {
      ...setupFacts,
      hasLocalIdentity: true,
      recoveryCreated: true,
      recoveryConfirmed: true,
      deviceEnrolled: true,
      personalKeysReady: true,
    };
    expect(deviceProtectionStatusFromFacts({ facts, hasServerRecoveryIdentity: true }))
      .toBe('TEMPORARILY_UNAVAILABLE');
    expect(deviceProtectionStatusFromFacts({ facts: { ...facts, runtimeReady: true }, hasServerRecoveryIdentity: true }))
      .toBe('TEMPORARILY_UNAVAILABLE');
    expect(deviceProtectionStatusFromFacts({
      facts: { ...facts, runtimeReady: true, floorActive: true },
      hasServerRecoveryIdentity: true,
    })).toBe('PROTECTED');
  });

  it('keeps a complete connected-couple bootstrap unavailable until couple keys are ready', () => {
    const complete = {
      ...setupFacts,
      hasLocalIdentity: true,
      recoveryCreated: true,
      recoveryConfirmed: true,
      deviceEnrolled: true,
      personalKeysReady: true,
      runtimeReady: true,
      floorActive: true,
      hasCoupleScope: true,
    };
    expect(deviceProtectionStatusFromFacts({ facts: complete, hasServerRecoveryIdentity: true }))
      .toBe('TEMPORARILY_UNAVAILABLE');
    expect(deviceProtectionStatusFromFacts({
      facts: { ...complete, coupleKeysReady: true },
      hasServerRecoveryIdentity: true,
    })).toBe('PROTECTED');
  });

  it('treats a completed bootstrap with missing local identity as recovery-required', () => {
    expect(deviceProtectionStatusFromFacts({
      facts: { ...setupFacts, recoveryConfirmed: true },
      hasServerRecoveryIdentity: true,
    })).toBe('RECOVERY_REQUIRED');
  });
});

describe('activeCoupleScopeId', () => {
  it('does not require a couple crypto scope for a pending invitation space', () => {
    expect(activeCoupleScopeId({ coupleId: 'pending-space', connected: false, status: 'pending' }))
      .toBeNull();
    expect(activeCoupleScopeId({ coupleId: 'active-space', connected: true, status: 'active' }))
      .toBe('active-space');
  });
});
