/**
 * The device key abstraction: operation by handle, never by key bytes.
 *
 * A handle is an opaque alias. It is not key material and carries no secret;
 * losing it costs availability, not confidentiality. There is deliberately no
 * method that returns a private key, and there must never be one — on iOS and
 * Android the private key physically cannot leave the Secure Enclave or
 * Keystore, and the interface should not pretend otherwise on any platform.
 *
 * What DOES cross into JavaScript, stated plainly because the architecture
 * depends on the distinction:
 *
 *   - public keys, as SPKI
 *   - signatures, as P-1363
 *   - the raw ECDH shared secret from `deriveSecret`
 *
 * Both Apple key-agreement APIs hand the shared secret back to the calling
 * process; that was measured in Phase 1A-1, not assumed. So the claim this port
 * makes is exactly: *device private keys never leave hardware*. It is not the
 * claim that no sensitive bytes ever reach JS.
 */

import type { Assurance } from '../domains';

export type KeyHandle = string;

export type KeyPolicy = {
  /**
   * Require a biometric/passcode check for each private-key operation.
   *
   * Defaults to false. A key that is invalidated when the user enrolls a new
   * fingerprint turns a routine device change into unrecoverable key loss,
   * which is a P0 data-loss path, so the safe default is the permissive one.
   */
  requireUserPresence?: boolean;
  /** Destroy the key if the biometric set changes. Defaults to false, same reason. */
  invalidateOnBiometricChange?: boolean;
};

export type GeneratedKey = {
  handle: KeyHandle;
  /** SubjectPublicKeyInfo DER. 91 bytes for P-256. */
  publicKeySpki: Uint8Array;
  assurance: Assurance;
};

export interface DeviceKeyPort {
  /** P-256 ECDSA key for device authentication and protocol signatures. */
  generateSigningKey(alias: string, policy?: KeyPolicy): Promise<GeneratedKey>;

  /** P-256 ECDH key that receives wrapped scope keys. */
  generateAgreementKey(alias: string, policy?: KeyPolicy): Promise<GeneratedKey>;

  getPublicKey(handle: KeyHandle): Promise<Uint8Array>;

  /** Returns P-1363 `r || s`, exactly 64 bytes, whatever the backend emits. */
  sign(handle: KeyHandle, message: Uint8Array): Promise<Uint8Array>;

  /**
   * Returns exactly 32 bytes: the big-endian X coordinate, left-zero-padded.
   *
   * A backend returning fewer bytes is padded; more than 32 is a hard error.
   */
  deriveSecret(handle: KeyHandle, peerPublicKeySpki: Uint8Array): Promise<Uint8Array>;

  deleteKey(handle: KeyHandle): Promise<void>;

  getAssurance(handle: KeyHandle): Promise<Assurance>;

  hasKey(alias: string): Promise<boolean>;
}

export class DeviceKeyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'DeviceKeyError';
  }
}

export function deviceKeyFail(code: string, message: string): never {
  throw new DeviceKeyError(code, message);
}
