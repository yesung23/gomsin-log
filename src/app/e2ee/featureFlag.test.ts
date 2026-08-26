import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}));

import { isDeviceProtectionEnabled } from './featureFlag';

describe('native record-protection feature gate', () => {
  afterEach(() => {
    native.value = false;
    vi.unstubAllEnvs();
  });

  it('never enables the device-key ceremony on web/PWA', () => {
    native.value = false;
    vi.stubEnv('VITE_E2EE_DEVICE_PROTECTION_ENABLED', 'true');
    expect(isDeviceProtectionEnabled()).toBe(false);
  });

  it('enables native protection by default and retains an explicit kill switch', () => {
    native.value = true;
    vi.stubEnv('VITE_E2EE_DEVICE_PROTECTION_ENABLED', '');
    expect(isDeviceProtectionEnabled()).toBe(true);

    vi.stubEnv('VITE_E2EE_DEVICE_PROTECTION_ENABLED', 'false');
    expect(isDeviceProtectionEnabled()).toBe(false);
  });
});
