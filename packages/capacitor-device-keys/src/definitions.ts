/**
 * The bridge contract for `GomsinlogDeviceKeys`.
 *
 * One rule governs this whole interface, and it is the reason the plugin exists
 * at all:
 *
 *   NO METHOD RETURNS A PRIVATE KEY, AND NO METHOD CAN BE ADDED THAT DOES.
 *
 * On iOS and Android the private key physically cannot leave the Secure Enclave
 * or the Keystore, so an export method would not merely be unsafe — it would be
 * unimplementable, and pretending otherwise on the web would make the two
 * platforms silently different. Everything here is operation-by-handle: the
 * caller names a key and asks for a signature or a shared secret.
 *
 * What DOES cross the bridge, stated plainly because the security argument
 * depends on the distinction:
 *
 *   - public keys, as base64 SPKI
 *   - signatures, as base64 (DER or P-1363; the plugin declares which)
 *   - the raw ECDH shared secret from `deriveSecret`
 *
 * Both Apple key-agreement APIs hand the shared secret back to the calling
 * process — measured in Phase 1A-1, not assumed. So the claim is exactly
 * *device private keys never leave hardware*, not *no sensitive bytes reach JS*.
 *
 * TRANSPORT: base64 everywhere. The Capacitor JSON boundary has no binary type,
 * and every value is re-validated on the TypeScript side in
 * `src/crypto/keystore/nativeDeviceKeys.ts` rather than trusted.
 *
 * VERIFICATION: the native implementations behind this interface are
 * DEFERRED TO THE NATIVE INTEGRATION GATE. See the per-platform notes in
 * `ios/Sources/DeviceKeysPlugin/DeviceKeys.swift` and
 * `android/src/main/java/app/gomsinlog/devicekeys/DeviceKeys.kt`.
 */

export type DeviceKeyKind = 'sign' | 'agree';

/**
 * The assurance class the PLATFORM reports.
 *
 * Never inferred and never upgraded. An unrecognised value degrades to the
 * weakest software class on the TypeScript side; calling storage
 * hardware-backed when that was never established is the single mistake this
 * value exists to prevent.
 */
export type DeviceKeyAssurance =
  | 'secure_enclave'
  | 'strongbox'
  | 'tee'
  | 'software_keystore'
  | 'web_nonextractable';

export interface GenerateKeyOptions {
  alias: string;
  kind: DeviceKeyKind;
  /**
   * Require a biometric/passcode check per private-key operation.
   *
   * Defaults to false at the call site. A key invalidated by a biometric
   * enrollment change turns an ordinary device change into unrecoverable key
   * loss, which is a data-loss path rather than a security win.
   */
  requireUserPresence: boolean;
  invalidateOnBiometricChange: boolean;
}

export interface GeneratedKeyResult {
  handle: string;
  /** SubjectPublicKeyInfo DER, base64. 91 bytes for P-256. */
  publicKeySpki: string;
  assurance: string;
}

export interface SignResult {
  signature: string;
  /**
   * Which format the platform actually produced.
   *
   * Apple SecKey and JCA emit DER; CryptoKit can emit either. The plugin
   * DECLARES it rather than letting TypeScript infer it from the bytes, because
   * a 64-byte DER signature and a P-1363 one are not always distinguishable and
   * guessing wrong yields a verification failure nobody can trace.
   */
  encoding: 'der' | 'p1363';
}

export interface DeviceKeysPlugin {
  /** P-256 ECDSA (`sign`) or ECDH (`agree`), created in platform key storage. */
  generateKey(options: GenerateKeyOptions): Promise<GeneratedKeyResult>;

  getPublicKey(options: { handle: string }): Promise<{ publicKeySpki: string }>;

  /** `message` is base64. Returns a base64 signature plus its encoding. */
  sign(options: { handle: string; message: string }): Promise<SignResult>;

  /**
   * ECDH against a peer public key.
   *
   * Returns the 32-byte big-endian X coordinate, base64. The TypeScript side
   * left-pads unconditionally: measured stacks preserve the leading zero, but
   * Conscrypt is unmeasured and a stripped byte would derive a different KEK on
   * roughly one envelope in 256.
   */
  deriveSecret(options: { handle: string; peerPublicKeySpki: string }): Promise<{ secret: string }>;

  deleteKey(options: { handle: string }): Promise<void>;

  getAssurance(options: { handle: string }): Promise<{ assurance: string }>;

  hasKey(options: { alias: string }): Promise<{ present: boolean }>;
}
