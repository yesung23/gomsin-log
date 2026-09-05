import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One `registerPlugin('GomsinlogDeviceKeys')` per process.
 *
 * `getDeviceKeyPort` and `getLocalKeyPort` each used to register the plugin, so a
 * session that used both produced, on a physical iPhone:
 *
 *   [warn] Capacitor plugin "GomsinlogDeviceKeys" already registered.
 *          Cannot register plugins twice.
 *
 * The warning was harmless in itself, but "how many bridges are there" must have one
 * answer: device keys and the local content key are methods on a SINGLE native plugin,
 * and two proxies invite a future change that gives the two ports different views of it.
 *
 * These tests are behavioural rather than textual, so they check the call count and the
 * identity of the object each port is handed -- not how the source is written.
 */

const isNativePlatform = vi.fn(() => true);
const isPluginAvailable = vi.fn(() => true);
const registerPlugin = vi.fn(() => ({ __bridge: Symbol('native-bridge') }));

const createNativeDeviceKeyPort = vi.fn((plugin: unknown) => ({ port: 'device', plugin }));
const createNativeLocalKeyPort = vi.fn((plugin: unknown) => ({ port: 'local', plugin }));
const createWebDeviceKeyPort = vi.fn(() => ({ port: 'web-device' }));
const createWebLocalKeyPort = vi.fn(() => ({ port: 'web-local' }));
const isWebDeviceKeyStoreAvailable = vi.fn(() => true);
const isWebLocalKeyPortAvailable = vi.fn(() => true);

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    isPluginAvailable: (name: string) => isPluginAvailable(name as never),
  },
  registerPlugin: (name: string) => registerPlugin(name as never),
}));

vi.mock('./nativeDeviceKeys', () => ({
  createNativeDeviceKeyPort: (plugin: unknown) => createNativeDeviceKeyPort(plugin),
  mapAssurance: vi.fn(),
}));
vi.mock('./nativeLocalKey', () => ({
  createNativeLocalKeyPort: (plugin: unknown) => createNativeLocalKeyPort(plugin),
}));
vi.mock('./webDeviceKeys', () => ({
  createWebDeviceKeyPort: () => createWebDeviceKeyPort(),
  isWebDeviceKeyStoreAvailable: () => isWebDeviceKeyStoreAvailable(),
}));
vi.mock('./webLocalKey', () => ({
  createWebLocalKeyPort: () => createWebLocalKeyPort(),
  isWebLocalKeyPortAvailable: () => isWebLocalKeyPortAvailable(),
}));

async function freshKeystore() {
  vi.resetModules();
  return import('./index');
}

beforeEach(() => {
  vi.clearAllMocks();
  isNativePlatform.mockReturnValue(true);
  isPluginAvailable.mockReturnValue(true);
  registerPlugin.mockImplementation(() => ({ __bridge: Symbol('native-bridge') }));
  isWebDeviceKeyStoreAvailable.mockReturnValue(true);
  isWebLocalKeyPortAvailable.mockReturnValue(true);
});

describe('the native device-keys plugin is registered exactly once', () => {
  it('registers once no matter which port is asked for first', async () => {
    const keystore = await freshKeystore();

    keystore.getDeviceKeyPort();
    keystore.getLocalKeyPort();

    expect(registerPlugin).toHaveBeenCalledTimes(1);
    expect(registerPlugin).toHaveBeenCalledWith('GomsinlogDeviceKeys');
  });

  it('registers once when the local port is asked for first', async () => {
    const keystore = await freshKeystore();

    keystore.getLocalKeyPort();
    keystore.getDeviceKeyPort();

    expect(registerPlugin).toHaveBeenCalledTimes(1);
  });

  it('hands both ports the SAME native bridge instance', async () => {
    const keystore = await freshKeystore();

    keystore.getDeviceKeyPort();
    keystore.getLocalKeyPort();

    const devicePlugin = createNativeDeviceKeyPort.mock.calls[0][0];
    const localPlugin = createNativeLocalKeyPort.mock.calls[0][0];
    expect(devicePlugin).toBeDefined();
    expect(devicePlugin).toBe(localPlugin);
  });

  it('still registers only once across repeated calls', async () => {
    const keystore = await freshKeystore();

    for (let i = 0; i < 5; i += 1) {
      keystore.getDeviceKeyPort();
      keystore.getLocalKeyPort();
    }

    expect(registerPlugin).toHaveBeenCalledTimes(1);
    // Each port is still memoised in its own right.
    expect(createNativeDeviceKeyPort).toHaveBeenCalledTimes(1);
    expect(createNativeLocalKeyPort).toHaveBeenCalledTimes(1);
  });
});

describe('consolidation does not weaken the fallback contract', () => {
  it('never registers the plugin on a web platform', async () => {
    isNativePlatform.mockReturnValue(false);
    isPluginAvailable.mockReturnValue(false);
    const keystore = await freshKeystore();

    expect(keystore.getDeviceKeyPort()).toEqual({ port: 'web-device' });
    expect(keystore.getLocalKeyPort()).toEqual({ port: 'web-local' });
    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it('fails closed on a native platform whose first-party plugin is missing', async () => {
    isNativePlatform.mockReturnValue(true);
    isPluginAvailable.mockReturnValue(false);
    const keystore = await freshKeystore();

    // Not a web downgrade: a native build without its plugin has no key store.
    expect(keystore.getDeviceKeyPort()).toBeNull();
    expect(keystore.getLocalKeyPort()).toBeNull();
    expect(registerPlugin).not.toHaveBeenCalled();
    expect(createWebDeviceKeyPort).not.toHaveBeenCalled();
    expect(createWebLocalKeyPort).not.toHaveBeenCalled();
  });

  it('returns null rather than a forgetful stub when no store exists at all', async () => {
    isNativePlatform.mockReturnValue(false);
    isPluginAvailable.mockReturnValue(false);
    isWebDeviceKeyStoreAvailable.mockReturnValue(false);
    isWebLocalKeyPortAvailable.mockReturnValue(false);
    const keystore = await freshKeystore();

    expect(keystore.getDeviceKeyPort()).toBeNull();
    expect(keystore.getLocalKeyPort()).toBeNull();
  });
});

describe('the test seams still isolate a port', () => {
  it('lets a test substitute each port independently', async () => {
    const keystore = await freshKeystore();
    const fakeDevice = { port: 'fake-device' } as never;
    const fakeLocal = { port: 'fake-local' } as never;

    keystore.__setDeviceKeyPortForTests(fakeDevice);
    keystore.__setLocalKeyPortForTests(fakeLocal);

    expect(keystore.getDeviceKeyPort()).toBe(fakeDevice);
    expect(keystore.getLocalKeyPort()).toBe(fakeLocal);
    // A substituted port must not reach the native bridge at all.
    expect(registerPlugin).not.toHaveBeenCalled();

    keystore.__setDeviceKeyPortForTests(null);
    keystore.__setLocalKeyPortForTests(null);
    expect(keystore.getDeviceKeyPort()).not.toBe(fakeDevice);
    expect(keystore.getLocalKeyPort()).not.toBe(fakeLocal);
  });
});
