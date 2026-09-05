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
let cachedNativePlugin: NativeDeviceKeysPlugin | null = null;

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
 * The one `registerPlugin('GomsinlogDeviceKeys')` call in the app.
 *
 * `getDeviceKeyPort` and `getLocalKeyPort` each held their own memo and each called
 * `registerPlugin`, so a session that used both registered the same plugin twice.
 * Capacitor answered the second one on a physical iPhone with
 * `Capacitor plugin "GomsinlogDeviceKeys" already registered. Cannot register plugins
 * twice.` The two ports address the same native bridge -- device keys and the local
 * content key are methods on one plugin -- so they share one proxy.
 *
 * Memoising the proxy changes no key semantics: `registerPlugin` returns a lazy proxy
 * that resolves the native implementation per call, so a shared proxy and two proxies
 * dispatch identically. Each port's own memo (`cached` / `cachedLocal`) is unchanged,
 * as are the test seams below.
 */
function nativeDeviceKeysPlugin(): NativeDeviceKeysPlugin {
  if (!cachedNativePlugin) {
    cachedNativePlugin = registerPlugin<NativeDeviceKeysPlugin>('GomsinlogDeviceKeys');
  }
  return cachedNativePlugin;
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
    cached = createNativeDeviceKeyPort(nativeDeviceKeysPlugin());
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
    cachedLocal = createNativeLocalKeyPort(nativeDeviceKeysPlugin());
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
