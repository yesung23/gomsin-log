import type { LocalKeyPort } from '@/crypto/keystore/LocalKeyPort';
import type { PlatformName } from '@/crypto/domains';
import { activatePersonalProtection, installE2eeRuntime } from './runtime';
import { E2EE_RUNTIME_INSTALLATION_ID } from './runtimeSession';
import {
  bootstrapFirstDevice,
  confirmRecoveryKit,
  recoverWithKit,
  type BootstrapResult,
  type RecoveryResult,
  type UseCaseDeps,
} from './useCases';
import type { RecoveryKitAnchor } from '@/crypto/recoveryCode';

export type DeviceProtectionFlow = {
  beginFirstDevice(): Promise<BootstrapResult>;
  confirmFirstDevice(input: { recoveryCode: string; kitAnchor: RecoveryKitAnchor }): Promise<void>;
  recover(input: { recoveryCode: string; kitAnchor: RecoveryKitAnchor }): Promise<RecoveryResult>;
};

/**
 * Application boundary for the Settings screen. It deliberately owns no React
 * state and exposes no crypto capability to presentation code.
 */
export function createDeviceProtectionFlow(input: {
  userId: string;
  platform: PlatformName;
  deps: UseCaseDeps;
  localKeys: LocalKeyPort;
}): DeviceProtectionFlow {
  return {
    beginFirstDevice: () => bootstrapFirstDevice(input.deps, {
      userId: input.userId,
      platform: input.platform,
    }),
    async confirmFirstDevice({ recoveryCode, kitAnchor }) {
      await confirmRecoveryKit(input.deps, { userId: input.userId, recoveryCode, kitAnchor });
      const installed = await installE2eeRuntime({
        userId: input.userId,
        repository: input.deps.repository,
        localState: input.deps.localState,
        deviceKeys: input.deps.deviceKeys,
        localKeys: input.localKeys,
        installationId: E2EE_RUNTIME_INSTALLATION_ID,
      });
      // This is the first device, before any protected runtime existed, so it
      // cannot be replacing an LCK that sealed queued ciphertext. Later session
      // restoration performs that separate outbox-loss check.
      await activatePersonalProtection({
        userId: input.userId,
        deviceId: installed.deviceId,
        repository: input.deps.repository,
        localState: input.deps.localState,
        environment: installed.environment,
      });
    },
    recover: ({ recoveryCode, kitAnchor }) => recoverWithKit(input.deps, {
      userId: input.userId,
      platform: input.platform,
      recoveryCode,
      kitAnchor,
    }),
  };
}
