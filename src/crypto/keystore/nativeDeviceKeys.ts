/**
 * Native bridge for the device key port.
 *
 * Wraps the first-party `GomsinlogDeviceKeys` Capacitor plugin. The plugin
 * speaks base64 over the bridge because the Capacitor JSON boundary cannot
 * carry binary; every value is re-validated on this side rather than trusted.
 *
 * VERIFICATION STATUS, kept honest per the Phase 1A-1 report:
 *
 *   iOS      Secure Enclave P-256 signing, key agreement and non-exportability
 *            were VERIFIED on real Apple Secure Enclave hardware (macOS/M1),
 *            through the same Security.framework/CryptoKit API surface iOS
 *            uses. iOS *lifecycle* (restart, biometric change, reinstall) and
 *            entitlements are ASSUMED FOR IMPLEMENTATION and
 *            DEFERRED TO THE NATIVE INTEGRATION GATE.
 *
 *   Android  Nothing is verified. AndroidKeyStore behaviour, operation by
 *            handle, key invalidation and — critically — whether Conscrypt
 *            matches SunEC on ECDH output width are all
 *            DEFERRED TO THE NATIVE INTEGRATION GATE. The plugin therefore
 *            reports the assurance the platform actually states and never
 *            upgrades a software key to a hardware class.
 *
 * The protocol does not depend on which of these turns out true: assurance is a
 * reported value carried in the signed certificate, so a later correction
 * changes a classification, not the protocol.
 */

import { ASSURANCE, type Assurance } from '../domains';
import { fromBase64, toBase64 } from '../bytes';
import { assertValidSpki, normalizeSharedSecret, SHARED_SECRET_BYTES } from '../suite';
import { normalizeSignature } from '../ecdsaFormat';
import {
  type DeviceKeyPort,
  type GeneratedKey,
  type KeyHandle,
  type KeyPolicy,
  deviceKeyFail,
} from './DeviceKeyPort';
import type { NativeLocalKeyPlugin } from './nativeLocalKey';

/** The shape the native plugin exposes. Base64 in, base64 out. */
export type NativeDeviceKeysPlugin = NativeLocalKeyPlugin & {
  generateKey(options: {
    alias: string;
    kind: 'sign' | 'agree';
    requireUserPresence: boolean;
    invalidateOnBiometricChange: boolean;
  }): Promise<{ handle: string; publicKeySpki: string; assurance: string }>;
  getPublicKey(options: { handle: string }): Promise<{ publicKeySpki: string }>;
  sign(options: { handle: string; message: string }): Promise<{ signature: string; encoding: 'der' | 'p1363' }>;
  deriveSecret(options: { handle: string; peerPublicKeySpki: string }): Promise<{ secret: string }>;
  deleteKey(options: { handle: string }): Promise<void>;
  getAssurance(options: { handle: string }): Promise<{ assurance: string }>;
  hasKey(options: { alias: string }): Promise<{ present: boolean }>;
};

/**
 * Map the platform's assurance string.
 *
 * An unrecognised value degrades to the weakest software class rather than
 * throwing or guessing upward. Calling storage hardware-backed when that was
 * never established is the one mistake this function exists to prevent.
 */
export function mapAssurance(reported: string): Assurance {
  switch (reported) {
    case 'secure_enclave': return ASSURANCE.secureEnclave;
    case 'strongbox': return ASSURANCE.strongBox;
    case 'tee': return ASSURANCE.tee;
    case 'software_keystore': return ASSURANCE.softwareKeystore;
    default: return ASSURANCE.softwareKeystore;
  }
}

export function createNativeDeviceKeyPort(plugin: NativeDeviceKeysPlugin): DeviceKeyPort {
  async function generate(alias: string, kind: 'sign' | 'agree', policy?: KeyPolicy): Promise<GeneratedKey> {
    if (!alias) deviceKeyFail('E_BAD_ALIAS', 'alias must be a non-empty string');
    const result = await plugin.generateKey({
      alias,
      kind,
      requireUserPresence: policy?.requireUserPresence ?? false,
      invalidateOnBiometricChange: policy?.invalidateOnBiometricChange ?? false,
    });
    const spki = fromBase64(result.publicKeySpki);
    // Re-validate on this side: the bridge is a boundary, not a trusted source.
    assertValidSpki(spki);
    return { handle: result.handle, publicKeySpki: spki, assurance: mapAssurance(result.assurance) };
  }

  return {
    generateSigningKey: (alias, policy) => generate(alias, 'sign', policy),
    generateAgreementKey: (alias, policy) => generate(alias, 'agree', policy),

    async getPublicKey(handle: KeyHandle) {
      const { publicKeySpki } = await plugin.getPublicKey({ handle });
      const spki = fromBase64(publicKeySpki);
      assertValidSpki(spki);
      return spki;
    },

    async sign(handle, message) {
      const { signature, encoding } = await plugin.sign({ handle, message: toBase64(message) });
      const raw = fromBase64(signature);
      // Apple SecKey and JCA emit DER; Apple CryptoKit can emit either, so the
      // plugin declares which it used. Honouring the declaration rather than
      // inferring it from the bytes is what keeps this correct for the rare
      // signature that could plausibly be read either way.
      return normalizeSignature(raw, encoding === 'p1363' ? 'p1363' : 'der');
    },

    async deriveSecret(handle, peerPublicKeySpki) {
      assertValidSpki(peerPublicKeySpki);
      const { secret } = await plugin.deriveSecret({
        handle,
        peerPublicKeySpki: toBase64(peerPublicKeySpki),
      });
      const raw = fromBase64(secret);
      if (raw.length > SHARED_SECRET_BYTES) {
        deviceKeyFail('E_SHARED_SECRET_WIDTH', `native returned ${raw.length} bytes for an ECDH secret`);
      }
      // Left-pad rather than trust the provider. Measured stacks preserve the
      // leading zero, but Conscrypt is unmeasured and a stripped byte would
      // derive a different KEK on about one envelope in 256.
      return normalizeSharedSecret(raw);
    },

    deleteKey: (handle) => plugin.deleteKey({ handle }),

    async getAssurance(handle) {
      const { assurance } = await plugin.getAssurance({ handle });
      return mapAssurance(assurance);
    },

    async hasKey(alias) {
      const { present } = await plugin.hasKey({ alias });
      return present;
    },
  };
}
