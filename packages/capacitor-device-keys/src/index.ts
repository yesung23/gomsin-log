import { registerPlugin } from '@capacitor/core';
import type { DeviceKeysPlugin } from './definitions';

/**
 * The first-party device-key plugin, registered and TYPED.
 *
 * `registerPlugin` is generic on purpose: an untyped registration made every
 * bridge call `any`, so a renamed native method or a changed option key would
 * have compiled cleanly and failed at runtime on a device — the one place this
 * project cannot iterate quickly.
 *
 * There is deliberately no `web:` implementation registered here. The web path
 * is `src/crypto/keystore/webDeviceKeys.ts`, selected explicitly by
 * `getDeviceKeyPort()`; a silent web fallback inside the plugin would make
 * "which key store am I actually using" unanswerable from the call site, and
 * the two have materially different assurance classes.
 */
export const GomsinlogDeviceKeys = registerPlugin<DeviceKeysPlugin>('GomsinlogDeviceKeys');

export * from './definitions';
export default GomsinlogDeviceKeys;
