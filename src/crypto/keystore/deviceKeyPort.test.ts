/**
 * Device key port contract.
 *
 * The native bridge is exercised against a fake plugin that deliberately
 * misbehaves in the ways real providers have historically misbehaved: emitting
 * DER instead of P-1363, stripping the leading zero from an ECDH result, and
 * reporting an assurance string nobody recognises. The bridge, not the caller,
 * has to absorb all three.
 *
 * IndexedDB is absent under jsdom, so the web implementation's storage path is
 * covered by the Phase 1A-1 browser probe rather than here; what is asserted
 * here is the contract every implementation must satisfy.
 */

import { describe, expect, it } from 'vitest';
import { ASSURANCE } from '../domains';
import { hex, toBase64, fromBase64 } from '../bytes';
import { P256_SPKI_PREFIX, ecdsaVerify, randomBytes, sec1ToSpki } from '../suite';
import { p1363ToDer } from '../ecdsaFormat';
import { createNativeDeviceKeyPort, mapAssurance, type NativeDeviceKeysPlugin } from './nativeDeviceKeys';
import type { DeviceKeyPort } from './DeviceKeyPort';

async function softwarePair(kind: 'ECDSA' | 'ECDH') {
  const pair = (await crypto.subtle.generateKey(
    { name: kind, namedCurve: 'P-256' },
    true,
    kind === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'],
  )) as CryptoKeyPair;
  return {
    pair,
    spki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
  };
}

/** A fake native plugin that emits DER and strips ECDH leading zeros. */
function makeFakePlugin(options?: {
  assurance?: string;
  stripLeadingZeros?: boolean;
  overWideSecret?: boolean;
}): { plugin: NativeDeviceKeysPlugin; keys: Map<string, Awaited<ReturnType<typeof softwarePair>>> } {
  const keys = new Map<string, Awaited<ReturnType<typeof softwarePair>>>();
  const kinds = new Map<string, 'sign' | 'agree'>();

  const plugin: NativeDeviceKeysPlugin = {
    async generateKey({ alias, kind }) {
      const made = await softwarePair(kind === 'sign' ? 'ECDSA' : 'ECDH');
      keys.set(alias, made);
      kinds.set(alias, kind);
      return {
        handle: alias,
        publicKeySpki: toBase64(made.spki),
        assurance: options?.assurance ?? 'secure_enclave',
      };
    },
    async getPublicKey({ handle }) {
      const made = keys.get(handle)!;
      return { publicKeySpki: toBase64(made.spki) };
    },
    async sign({ handle, message }) {
      const made = keys.get(handle)!;
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, made.pair.privateKey, fromBase64(message)),
      );
      // Apple SecKey and JCA both emit DER. Emit DER here so the bridge has to
      // do the conversion the protocol depends on.
      return { signature: toBase64(p1363ToDer(raw)), encoding: 'der' };
    },
    async deriveSecret({ handle, peerPublicKeySpki }) {
      const made = keys.get(handle)!;
      const peer = await crypto.subtle.importKey(
        'spki',
        fromBase64(peerPublicKeySpki) as BufferSource,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
      let secret = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, made.pair.privateKey, 256),
      );
      if (options?.overWideSecret) secret = new Uint8Array(33);
      else if (options?.stripLeadingZeros) {
        let at = 0;
        while (at < secret.length - 1 && secret[at] === 0) at += 1;
        secret = secret.subarray(at);
      }
      return { secret: toBase64(secret) };
    },
    async deleteKey({ handle }) { keys.delete(handle); },
    async getAssurance() { return { assurance: options?.assurance ?? 'secure_enclave' }; },
    async hasKey({ alias }) { return { present: keys.has(alias) }; },
  };
  return { plugin, keys };
}

describe('interface shape', () => {
  it('offers no way to export a private key', () => {
    const { plugin } = makeFakePlugin();
    const port = createNativeDeviceKeyPort(plugin) as DeviceKeyPort & Record<string, unknown>;
    for (const name of ['exportKey', 'getPrivateKey', 'exportPrivateKey', 'getSecret', 'unwrap']) {
      expect(port[name], `port must not expose ${name}`).toBeUndefined();
    }
    expect(Object.keys(port).sort()).toEqual([
      'deleteKey', 'deriveSecret', 'generateAgreementKey', 'generateSigningKey',
      'getAssurance', 'getPublicKey', 'hasKey', 'sign',
    ]);
  });
});

describe('signature normalization', () => {
  it('converts a DER signature from the native side into verifiable P-1363', async () => {
    const port = createNativeDeviceKeyPort(makeFakePlugin().plugin);
    const generated = await port.generateSigningKey('dev_sig');
    const message = new TextEncoder().encode('gomsinlog/keystore-test');

    const signature = await port.sign(generated.handle, message);
    expect(signature.length).toBe(64);
    expect(signature[0]).not.toBe(0x30);
    expect(await ecdsaVerify(generated.publicKeySpki, message, signature)).toBe(true);
  });
});

describe('ECDH width handling', () => {
  it('left-pads a provider that strips the leading zero', async () => {
    // The exact failure mode a stripping provider would cause: a different KEK
    // on roughly one envelope in 256, and only on those envelopes.
    const honest = createNativeDeviceKeyPort(makeFakePlugin().plugin);
    const stripping = createNativeDeviceKeyPort(makeFakePlugin({ stripLeadingZeros: true }).plugin);

    const peer = await softwarePair('ECDH');
    for (let i = 0; i < 400; i += 1) {
      const a = await honest.generateAgreementKey(`h${i}`);
      const b = await stripping.generateAgreementKey(`s${i}`);
      const secretA = await honest.deriveSecret(a.handle, peer.spki);
      const secretB = await stripping.deriveSecret(b.handle, peer.spki);
      expect(secretA.length).toBe(32);
      expect(secretB.length).toBe(32);
    }
  });

  it('produces the same 32 bytes as WebCrypto for a leading-zero result', async () => {
    const { plugin, keys } = makeFakePlugin({ stripLeadingZeros: true });
    const port = createNativeDeviceKeyPort(plugin);
    const peer = await softwarePair('ECDH');

    // Search for a pair whose shared secret genuinely starts with 0x00.
    for (let i = 0; i < 2000; i += 1) {
      const generated = await port.generateAgreementKey(`k${i}`);
      const made = keys.get(generated.handle)!;
      const reference = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'ECDH', public: peer.pair.publicKey },
          made.pair.privateKey,
          256,
        ),
      );
      if (reference[0] !== 0x00) continue;
      const viaPort = await port.deriveSecret(generated.handle, peer.spki);
      expect(viaPort.length).toBe(32);
      expect(hex(viaPort)).toBe(hex(reference));
      return;
    }
    throw new Error('no leading-zero shared secret found in 2000 attempts');
  });

  it('rejects an over-wide secret rather than truncating it', async () => {
    const port = createNativeDeviceKeyPort(makeFakePlugin({ overWideSecret: true }).plugin);
    const generated = await port.generateAgreementKey('wide');
    const peer = await softwarePair('ECDH');
    await expect(port.deriveSecret(generated.handle, peer.spki)).rejects.toThrow(/E_SHARED_SECRET_WIDTH/);
  });
});

describe('public key validation at the bridge', () => {
  it('rejects a malformed peer key before deriving anything', async () => {
    const port = createNativeDeviceKeyPort(makeFakePlugin().plugin);
    const generated = await port.generateAgreementKey('peer-check');
    await expect(port.deriveSecret(generated.handle, randomBytes(91))).rejects.toThrow(/E_BAD_SPKI_PREFIX/);
    await expect(port.deriveSecret(generated.handle, randomBytes(64))).rejects.toThrow(/E_BAD_SPKI_LENGTH/);
  });

  it('rejects the point at infinity', () => {
    const infinity = new Uint8Array(65);
    infinity[0] = 0x04;
    expect(() => sec1ToSpki(infinity)).toThrow(/E_POINT_AT_INFINITY/);
    expect(P256_SPKI_PREFIX.length).toBe(26);
  });
});

describe('assurance mapping', () => {
  it('maps known platform classes', () => {
    expect(mapAssurance('secure_enclave')).toBe(ASSURANCE.secureEnclave);
    expect(mapAssurance('strongbox')).toBe(ASSURANCE.strongBox);
    expect(mapAssurance('tee')).toBe(ASSURANCE.tee);
    expect(mapAssurance('software_keystore')).toBe(ASSURANCE.softwareKeystore);
  });

  it('degrades an unknown value to software rather than guessing upward', () => {
    // Calling storage hardware-backed when that was never established is the
    // one mistake this mapping exists to prevent.
    expect(mapAssurance('quantum_vault')).toBe(ASSURANCE.softwareKeystore);
    expect(mapAssurance('')).toBe(ASSURANCE.softwareKeystore);
  });

  it('reports whatever the platform stated, without upgrading it', async () => {
    const port = createNativeDeviceKeyPort(makeFakePlugin({ assurance: 'software_keystore' }).plugin);
    const generated = await port.generateSigningKey('soft');
    expect(generated.assurance).toBe(ASSURANCE.softwareKeystore);
    expect(await port.getAssurance(generated.handle)).toBe(ASSURANCE.softwareKeystore);
  });
});

describe('handle lifecycle', () => {
  it('reports presence and forgets a deleted handle', async () => {
    const port = createNativeDeviceKeyPort(makeFakePlugin().plugin);
    expect(await port.hasKey('gone')).toBe(false);
    const generated = await port.generateSigningKey('gone');
    expect(await port.hasKey('gone')).toBe(true);
    await port.deleteKey(generated.handle);
    expect(await port.hasKey('gone')).toBe(false);
  });

  it('refuses an empty alias', async () => {
    const port = createNativeDeviceKeyPort(makeFakePlugin().plugin);
    await expect(port.generateSigningKey('')).rejects.toThrow(/E_BAD_ALIAS/);
  });
});
