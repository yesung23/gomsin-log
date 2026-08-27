import { Capacitor } from '@capacitor/core';

/**
 * Record protection is a native product capability. Web/PWA remains unable to
 * start a key ceremony because it has no approved device-bound keystore.
 *
 * Device protection is enabled ONLY on native Capacitor builds when
 * `VITE_E2EE_DEVICE_PROTECTION_ENABLED` is explicitly `'true'`.
 * Omitted, empty, false, or web/PWA builds remain disabled by default.
 */
export function isDeviceProtectionEnabled(): boolean {
  return Capacitor.isNativePlatform()
    && import.meta.env.VITE_E2EE_DEVICE_PROTECTION_ENABLED === 'true';
}
