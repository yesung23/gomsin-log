import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_STATE,
  bootstrapStateFromFacts,
  transitionBootstrap,
} from './bootstrapStateMachine';

describe('device bootstrap state machine', () => {
  it('requires recovery confirmation before device/runtime readiness', () => {
    expect(transitionBootstrap(BOOTSTRAP_STATE.uninitialized, 'LOCAL_IDENTITY_CREATED'))
      .toBe(BOOTSTRAP_STATE.localIdentityReady);
    expect(transitionBootstrap(BOOTSTRAP_STATE.localIdentityReady, 'RECOVERY_CREATED'))
      .toBe(BOOTSTRAP_STATE.recoveryCreated);
    expect(() => transitionBootstrap(BOOTSTRAP_STATE.recoveryCreated, 'DEVICE_ENROLLED'))
      .toThrow('cannot apply DEVICE_ENROLLED');
  });

  it('represents an unpaired account as pending rather than fully active', () => {
    expect(bootstrapStateFromFacts({
      hasLocalIdentity: true,
      recoveryCreated: true,
      recoveryConfirmed: true,
      deviceEnrolled: true,
      personalKeysReady: true,
      coupleKeysReady: false,
      runtimeReady: false,
      floorActive: false,
    })).toBe(BOOTSTRAP_STATE.coupleKeysPending);
  });

  it('does not derive ACTIVE without a runtime and floor fact', () => {
    const facts = {
      hasLocalIdentity: true,
      recoveryCreated: true,
      recoveryConfirmed: true,
      deviceEnrolled: true,
      personalKeysReady: true,
      coupleKeysReady: true,
      runtimeReady: true,
      floorActive: false,
    } as const;
    expect(bootstrapStateFromFacts(facts)).toBe(BOOTSTRAP_STATE.runtimeReady);
    expect(bootstrapStateFromFacts({ ...facts, floorActive: true })).toBe(BOOTSTRAP_STATE.active);
  });
});
