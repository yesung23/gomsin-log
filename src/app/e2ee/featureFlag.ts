/**
 * Device bootstrap can change irreversible server authority, so it stays
 * explicitly opt-in per build until the native integration gate is closed.
 * This is a public boolean, never a credential.
 */
export function isDeviceProtectionEnabled(): boolean {
  return import.meta.env.VITE_E2EE_DEVICE_PROTECTION_ENABLED === 'true';
}
