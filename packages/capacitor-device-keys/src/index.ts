import { registerPlugin } from '@capacitor/core';

/**
 * Bridge definition for the first-party device-key plugin.
 *
 * The TypeScript contract lives in `src/crypto/keystore/nativeDeviceKeys.ts`;
 * this file only names the plugin so Capacitor can resolve it. Registration is
 * lazy — `getDeviceKeyPort()` falls back to the web implementation whenever the
 * native side is absent, which is the state until the native integration gate
 * closes.
 */
export const GomsinlogDeviceKeys = registerPlugin('GomsinlogDeviceKeys');
export default GomsinlogDeviceKeys;
