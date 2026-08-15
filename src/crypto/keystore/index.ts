/**
 * Device key port selection.
 *
 * Native is preferred wherever the plugin is registered, because it is the only
 * path where the private key is genuinely outside the app's reach. Web is a
 * real, supported fallback — the product ships as a PWA — but a distinctly
 * weaker one, and callers can see which they got through `getAssurance`.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { DeviceKeyPort } from './DeviceKeyPort';
import { createNativeDeviceKeyPort, type NativeDeviceKeysPlugin } from './nativeDeviceKeys';
import { createWebDeviceKeyPort, isWebDeviceKeyStoreAvailable } from './webDeviceKeys';
import { createNativeLocalKeyPort } from './nativeLocalKey';
import { createWebLocalKeyPort, isWebLocalKeyPortAvailable } from './webLocalKey';
import type { LocalKeyPort } from './LocalKeyPort';

export type { DeviceKeyPort, GeneratedKey, KeyHandle, KeyPolicy } from './DeviceKeyPort';
export { DeviceKeyError, deviceKeyFail } from './DeviceKeyPort';
export { createWebDeviceKeyPort, isWebDeviceKeyStoreAvailable } from './webDeviceKeys';
export { createNativeDeviceKeyPort, mapAssurance } from './nativeDeviceKeys';
export type { LocalKeyBinding, LocalKeyCapability, LocalKeyPort, SealedLocalBytes } from './LocalKeyPort';
export { createNativeLocalKeyPort } from './nativeLocalKey';
export { createWebLocalKeyPort, isWebLocalKeyPortAvailable } from './webLocalKey';

let cached: DeviceKeyPort | null = null;
let cachedLocal: LocalKeyPort | null = null;

function nativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function nativeAvailable(): boolean {
  return nativePlatform() && Capacitor.isPluginAvailable('GomsinlogDeviceKeys');
}

/**
 * Returns null where no device key store exists at all.
 *
 * Null rather than a silently-forgetting stub: a caller that cannot persist a
 * device key must not tell the user their account is protected, because it is
 * not, and a stub would make that failure invisible until recovery time.
 */
export function getDeviceKeyPort(): DeviceKeyPort | null {
  if (cached) return cached;
  if (nativeAvailable()) {
    const plugin = registerPlugin<NativeDeviceKeysPlugin>('GomsinlogDeviceKeys');
    cached = createNativeDeviceKeyPort(plugin);
    return cached;
  }
  // A native build without its first-party plugin is not a web device. Do not
  // silently downgrade iOS/Android bootstrap to WebCrypto.
  if (nativePlatform()) return null;
  if (isWebDeviceKeyStoreAvailable()) {
    cached = createWebDeviceKeyPort();
    return cached;
  }
  return null;
}

/** Secure local capability selection. Native is mandatory on native platforms. */
export function getLocalKeyPort(): LocalKeyPort | null {
  if (cachedLocal) return cachedLocal;
  if (nativeAvailable()) {
    const plugin = registerPlugin<NativeDeviceKeysPlugin>('GomsinlogDeviceKeys');
    cachedLocal = createNativeLocalKeyPort(plugin);
    return cachedLocal;
  }
  if (nativePlatform()) return null;
  if (isWebLocalKeyPortAvailable()) {
    cachedLocal = createWebLocalKeyPort();
    return cachedLocal;
  }
  return null;
}

/** Test seam. Not for production callers. */
export function __setDeviceKeyPortForTests(port: DeviceKeyPort | null): void {
  cached = port;
}

export function __setLocalKeyPortForTests(port: LocalKeyPort | null): void {
  cachedLocal = port;
}
