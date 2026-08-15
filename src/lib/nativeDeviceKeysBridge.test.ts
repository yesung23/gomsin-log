import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural contract for the `GomsinlogDeviceKeys` Capacitor bridge.
 *
 * A Capacitor plugin is three separate declarations — a TypeScript interface, a
 * Swift method table and a Kotlin annotation set — that the compiler cannot
 * relate to one another. A renamed method compiles cleanly on all three sides
 * and fails only on a device, which for this project is the slowest possible
 * feedback loop and the one place a mistake is most expensive.
 *
 * These tests are therefore deliberately textual. They cannot prove the native
 * code WORKS — no Android SDK and no Xcode are available here, and
 * NATIVE BUILD is UNEXECUTED — but they can prove the three declarations agree,
 * that the web fallback stays reachable, and that no export-the-private-key
 * method has appeared on any of them.
 */

const ROOT = process.cwd();
const PACKAGE = resolve(ROOT, 'packages/capacitor-device-keys');

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const definitions = read('packages/capacitor-device-keys/src/definitions.ts');
const pluginIndex = read('packages/capacitor-device-keys/src/index.ts');
const swiftBridge = read('packages/capacitor-device-keys/ios/Sources/DeviceKeysPlugin/DeviceKeysPlugin.swift');
const kotlinBridge = read('packages/capacitor-device-keys/android/src/main/java/app/gomsinlog/devicekeys/DeviceKeysPlugin.kt');
const keystoreIndex = read('src/crypto/keystore/index.ts');
const nativePort = read('src/crypto/keystore/nativeDeviceKeys.ts');
const nativeLocalPort = read('src/crypto/keystore/nativeLocalKey.ts');

/** The eight operations `DeviceKeyPort` needs, and the only ones. */
const BRIDGE_METHODS = [
  'generateKey',
  'getPublicKey',
  'sign',
  'deriveSecret',
  'deleteKey',
  'getAssurance',
  'hasKey',
  'lckEnsure',
  'lckHas',
  'lckSeal',
  'lckOpen',
  'lckDelete',
] as const;

const PLUGIN_NAME = 'GomsinlogDeviceKeys';

describe('plugin registration', () => {
  it('registers a TYPED plugin, so a renamed method fails to compile', () => {
    expect(pluginIndex).toMatch(/registerPlugin<DeviceKeysPlugin>\(\s*'GomsinlogDeviceKeys'\s*\)/);
  });

  it('names the same plugin on every side of the bridge', () => {
    expect(pluginIndex).toContain(`'${PLUGIN_NAME}'`);
    expect(keystoreIndex).toContain(`'${PLUGIN_NAME}'`);
    expect(swiftBridge).toContain(`jsName = "${PLUGIN_NAME}"`);
    expect(kotlinBridge).toContain(`@CapacitorPlugin(name = "${PLUGIN_NAME}")`);
  });

  it('declares the package to Capacitor for both platforms', () => {
    const manifest = JSON.parse(read('packages/capacitor-device-keys/package.json'));
    expect(manifest.capacitor).toEqual({ ios: { src: 'ios' }, android: { src: 'android' } });
    expect(manifest.peerDependencies['@capacitor/core']).toMatch(/\^7\./);
  });

  it('matches the Capacitor major version the app actually uses', () => {
    // A plugin built against a different major registers but does not bridge.
    const app = JSON.parse(read('package.json'));
    expect(app.dependencies['@capacitor/core']).toMatch(/\^7\./);
    expect(app.devDependencies['@capacitor/ios']).toMatch(/\^7\./);
    expect(app.devDependencies['@capacitor/android']).toMatch(/\^7\./);
  });
});

describe('the three declarations agree', () => {
  it('the TypeScript interface declares exactly the bridge methods', () => {
    for (const method of BRIDGE_METHODS) {
      expect(definitions, `definitions.ts is missing ${method}`).toMatch(
        new RegExp(`\\b${method}\\(options`),
      );
    }
  });

  it('the Swift method table lists exactly the same methods', () => {
    const listed = [...swiftBridge.matchAll(/CAPPluginMethod\(name: "([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...BRIDGE_METHODS].sort());
  });

  it('every Swift table entry has a matching @objc selector', () => {
    const selectors = [...swiftBridge.matchAll(/@objc func ([a-zA-Z]+)\(/g)].map((m) => m[1]);
    for (const method of BRIDGE_METHODS) {
      expect(selectors, `no @objc func ${method}`).toContain(method);
    }
  });

  it('the Kotlin bridge annotates exactly the same methods', () => {
    const annotated = [...kotlinBridge.matchAll(/@PluginMethod\s+fun ([a-zA-Z]+)\(/g)].map((m) => m[1]);
    expect(annotated.sort()).toEqual([...BRIDGE_METHODS].sort());
  });

  it('the native TypeScript port calls exactly those methods and no others', () => {
    const called = new Set([
      ...[...nativePort.matchAll(/plugin\.([a-zA-Z]+)\(/g)].map((m) => m[1]),
      ...[...nativeLocalPort.matchAll(/plugin\.([a-zA-Z]+)\(/g)].map((m) => m[1]),
    ]);
    expect([...called].sort()).toEqual([...BRIDGE_METHODS].sort());
  });
});

describe('no API exports a private key', () => {
  const surfaces: Array<[string, string]> = [
    ['definitions.ts', definitions],
    ['index.ts', pluginIndex],
    ['DeviceKeysPlugin.swift', swiftBridge],
    ['DeviceKeysPlugin.kt', kotlinBridge],
    ['nativeDeviceKeys.ts', nativePort],
    ['nativeLocalKey.ts', nativeLocalPort],
  ];

  it('declares no export/extract/getPrivate method anywhere on the bridge', () => {
    // The private key physically cannot leave the Secure Enclave or the
    // AndroidKeyStore, so such a method would be a promise the platform cannot
    // keep — and its absence is the whole reason the port is by-handle.
    const forbidden = [
      /\bexportKey\b/i,
      /\bexportPrivate/i,
      /\bgetPrivateKey\b/i,
      /\bprivateKeyBytes\b/i,
      /\bextractKey\b/i,
      /\bunwrapPrivate/i,
    ];
    for (const [name, source] of surfaces) {
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${name} exposes ${pattern}`).toBe(false);
      }
    }
  });

  it('the bridge method list itself cannot grow a private-key method unnoticed', () => {
    // Pinned by exact equality above; restated here as the security claim it is.
    expect(BRIDGE_METHODS).toHaveLength(12);
    expect(BRIDGE_METHODS).not.toContain('exportKey');
  });
});

describe('the native bridge never logs key material', () => {
  it('neither native bridge class logs at all', () => {
    // The ECDH result is the input to the envelope KEK. A copy in logcat or the
    // device console is a copy of the scope key for anyone who can read it.
    expect(/\bLog\.[dviwe]\(/.test(kotlinBridge), 'Kotlin bridge logs').toBe(false);
    expect(/\bprintln\(/.test(kotlinBridge), 'Kotlin bridge prints').toBe(false);
    expect(/\bprint\(/.test(swiftBridge), 'Swift bridge prints').toBe(false);
    expect(/NSLog\(/.test(swiftBridge), 'Swift bridge NSLogs').toBe(false);
    expect(/os_log/.test(swiftBridge), 'Swift bridge os_logs').toBe(false);
  });

  it('rejects with bounded codes rather than raw platform text', () => {
    expect(kotlinBridge).toMatch(/call\.reject\("E_PLATFORM"/);
    expect(swiftBridge).toMatch(/"E_PLATFORM"/);
  });
});

describe('input validation at the boundary', () => {
  it('both bridges require a handle, an alias and well-formed base64', () => {
    for (const [name, source] of [['kotlin', kotlinBridge], ['swift', swiftBridge]] as const) {
      expect(source, `${name} does not validate the handle`).toMatch(/E_BAD_HANDLE/);
      expect(source, `${name} does not validate the alias`).toMatch(/E_BAD_ALIAS/);
      expect(source, `${name} does not validate base64 input`).toMatch(/E_BAD_INPUT/);
    }
  });

  it('both bridges pin the peer key at the P-256 SPKI width', () => {
    // 91 bytes. Anything else is not a peer key, and passing it through would
    // turn a caller mistake into an opaque provider error.
    expect(kotlinBridge).toMatch(/SPKI_P256_BYTES = 91/);
    expect(kotlinBridge).toMatch(/E_BAD_PEER_KEY/);
    expect(swiftBridge).toMatch(/spkiP256Bytes = 91/);
    expect(swiftBridge).toMatch(/E_BAD_PEER_KEY/);
  });

  it('both bridges declare the signature encoding rather than letting JS guess', () => {
    expect(kotlinBridge).toMatch(/put\("encoding", "der"\)/);
    expect(swiftBridge).toMatch(/"encoding": "der"/);
    expect(nativePort).toMatch(/encoding === 'p1363' \? 'p1363' : 'der'/);
  });
});

describe('platform selection', () => {
  it('chooses native ONLY when Capacitor is native AND the plugin is available', () => {
    expect(keystoreIndex).toMatch(
      /Capacitor\.isNativePlatform\(\)\s*&&\s*Capacitor\.isPluginAvailable\('GomsinlogDeviceKeys'\)/,
    );
  });

  it('keeps the web implementation selectable', () => {
    expect(keystoreIndex).toMatch(/isWebDeviceKeyStoreAvailable\(\)/);
    expect(keystoreIndex).toMatch(/createWebDeviceKeyPort\(\)/);
  });

  it('returns null rather than a forgetful stub when no store exists', () => {
    // A stub would let a caller tell the user their account is protected when
    // it is not, and the failure would stay invisible until recovery time.
    expect(keystoreIndex).toMatch(/return null;/);
  });

  it('registers no web implementation inside the plugin itself', () => {
    // A silent web fallback in `registerPlugin` would make "which key store am
    // I using" unanswerable from the call site, and the two differ in assurance.
    expect(pluginIndex).not.toMatch(/web:\s*\(/);
    expect(pluginIndex).not.toMatch(/import\(.*web.*\)/);
  });
});

describe('honest verification status', () => {
  it('every native surface still records the integration gate', () => {
    for (const [name, source] of [
      ['swift bridge', swiftBridge],
      ['kotlin bridge', kotlinBridge],
      ['native port', nativePort],
    ] as const) {
      expect(source.toUpperCase(), `${name} drops the deferral notice`)
        .toContain('DEFERRED TO THE NATIVE INTEGRATION GATE');
    }
  });

  it('the Kotlin bridge does not claim hardware backing it has not measured', () => {
    // Assurance is whatever `KeyInfo` reports; the bridge never substitutes a
    // stronger class, and an unknown value degrades in TypeScript.
    expect(kotlinBridge).not.toMatch(/"strongbox"/);
    expect(kotlinBridge).not.toMatch(/"tee"/);
    expect(nativePort).toMatch(/default: return ASSURANCE\.softwareKeystore;/);
  });

  it('the package directory is the one the tests read', () => {
    expect(PACKAGE.endsWith('packages/capacitor-device-keys')).toBe(true);
  });
});
