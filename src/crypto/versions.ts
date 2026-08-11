/**
 * The single version register for every wire format.
 *
 * One file so a reviewer can see every version axis at once, and so nothing can
 * be bumped in isolation. Values are bound into signed and authenticated data;
 * changing one is a protocol change, not a refactor.
 */

/** Identifies this protocol across every transcript and envelope. */
export const PROTOCOL_ID = 1;

/**
 * Suite 1: AES-256-GCM / HKDF-SHA-256 / ECDH-P-256 / ECDSA-P-256-SHA-256.
 *
 * P-256 because it is the only curve available simultaneously in WebCrypto, the
 * Apple Secure Enclave and Android StrongBox. Phase 1A-1 confirmed the Apple
 * half on real Secure Enclave hardware.
 */
export const SUITE_ID = 1;

export const GLK2_ENVELOPE_VERSION = 2;
export const GLDC1_CERT_VERSION = 1;
export const GLE1_FORMAT_VERSION = 1;
export const REVOCATION_VERSION = 1;
export const RECOVERY_KIT_VERSION = 1;
export const MIGRATION_ACK_VERSION = 1;

/**
 * Content cipher format, stored per row.
 *
 * `0` means legacy plaintext, explicitly. Encryption state is never inferred
 * from whether a value happens to look like base64 — that inference is what
 * invariant 12 exists to forbid.
 */
export const CIPHER_FORMAT = {
  plaintext: 0,
  gle1: 1,
} as const;

/** The key hierarchy generation a device was provisioned under. */
export const KEY_SCHEMA_VERSION = 1;

export function assertSupportedSuite(suiteId: number): void {
  if (suiteId !== SUITE_ID) throw new RangeError(`unsupported suite: ${suiteId}`);
}

export function assertSupportedProtocol(protocolId: number): void {
  if (protocolId !== PROTOCOL_ID) throw new RangeError(`unsupported protocol: ${protocolId}`);
}
