import { Capacitor } from '@capacitor/core';

/**
 * Record protection is a native product capability. Web/PWA remains unable to
 * start a key ceremony because it has no approved device-bound keystore.
 *
 * `false` is retained as an emergency build-time kill switch; an omitted flag
 * no longer ships an iPhone UI that can only tell the user the feature is off.
 */
export function isDeviceProtectionEnabled(): boolean {
  return Capacitor.isNativePlatform()
    && import.meta.env.VITE_E2EE_DEVICE_PROTECTION_ENABLED !== 'false';
}
