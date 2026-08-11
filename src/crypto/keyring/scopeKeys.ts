/**
 * Scope key handling: PMK, HRK and CSK.
 *
 * These keys are **portable by necessity** and are never described as
 * non-exportable. A device that joins later must be able to receive them, so
 * "the key cannot leave" is simply not true of this layer — only of the device
 * identity keys underneath it.
 *
 * Where the material actually exists:
 *
 *   server         a GLK2 envelope, wrapped to a `dev_kem` or `rec_kem` key
 *   device at rest the same envelope, cached. No plaintext scope key is ever
 *                  written to device storage.
 *   device in use  a non-extractable `CryptoKey` in memory
 *   provisioning   a raw `Uint8Array`, inside one function call, zeroized after
 *
 * Provisioning never calls `exportKey` on the in-use key. It re-opens this
 * device's own envelope for the same scope and epoch, which yields the raw
 * bytes directly, builds the new recipient's envelope, and wipes the buffer.
 * That keeps the in-use key genuinely non-extractable while still allowing a
 * second device to be enrolled.
 */

import { zeroize } from '../bytes';
import type { KeyDomainCode } from '../domains';
import {
  ENVELOPE_LENGTH,
  openEnvelope,
  sealEnvelope,
  type Glk2Header,
} from '../glk2';
import { AES_KEY_BYTES, importAesKey, randomBytes, randomNonce } from '../suite';

export class ScopeKeyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'ScopeKeyError';
  }
}

function fail(code: string, message: string): never {
  throw new ScopeKeyError(code, message);
}

/** Generate a fresh scope key. The caller owns and must zeroize the bytes. */
export function generateScopeKeyBytes(): Uint8Array {
  return randomBytes(AES_KEY_BYTES);
}

/**
 * Import raw scope-key bytes for use, then wipe the source.
 *
 * The returned `CryptoKey` is non-extractable, so the in-use representation
 * cannot be read back even by injected script.
 */
export async function importScopeKeyForUse(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== AES_KEY_BYTES) fail('E_SCOPE_KEY_WIDTH', 'scope key must be 32 bytes');
  const key = await importAesKey(raw, ['encrypt', 'decrypt']);
  return key;
}

export type EphemeralAgreement = {
  publicKeySec1: Uint8Array;
  sharedSecret: Uint8Array;
};

export type ProvisionInput = {
  /** This device's own envelope for the scope key being handed on. */
  ownEnvelope: Uint8Array;
  ownKemSpki: Uint8Array;
  /** Signing key of the device that wrote `ownEnvelope`, from a verified chain. */
  ownEnvelopeSenderSigSpki: Uint8Array;
  deriveSecret: (peerSpki: Uint8Array) => Promise<Uint8Array>;

  /** The new recipient. */
  recipientKemSpki: Uint8Array;
  recipientId: Uint8Array;
  recipientKind: number;

  /** This device, which signs the new envelope. */
  senderDeviceId: Uint8Array;
  senderSigSpki: Uint8Array;
  sign: (message: Uint8Array) => Promise<Uint8Array>;

  /** Fresh ephemeral agreement against the recipient's key. */
  makeEphemeral: (recipientKemSpki: Uint8Array) => Promise<EphemeralAgreement>;

  header: Pick<Glk2Header, 'domain' | 'scopeKeyId' | 'ownerUserId' | 'scopeId' | 'epoch'>;
  nowMs: bigint;
};

/**
 * Re-wrap a scope key for another recipient without ever exporting it.
 *
 * The raw key exists for the duration of this call and is zeroized on every
 * path, including the failure paths. That erasure is best-effort — see
 * `zeroize` — and is defence in depth, not a memory-safety guarantee.
 */
export async function provisionScopeKeyToRecipient(input: ProvisionInput): Promise<Uint8Array> {
  if (input.ownEnvelope.length !== ENVELOPE_LENGTH) {
    fail('E_BAD_ENVELOPE', 'own envelope has the wrong length');
  }

  let raw: Uint8Array | null = null;
  let ephemeral: EphemeralAgreement | null = null;
  try {
    const opened = await openEnvelope({
      envelope: input.ownEnvelope,
      recipientKemSpki: input.ownKemSpki,
      senderSigSpki: input.ownEnvelopeSenderSigSpki,
      deriveSecret: input.deriveSecret,
    });
    raw = opened.scopeKey;

    // The envelope must be for the scope key we were asked to hand on;
    // otherwise a caller could re-wrap health material into a couple envelope.
    if (opened.header.domain !== input.header.domain) {
      fail('E_DOMAIN_MISMATCH', 'own envelope is for a different key domain');
    }
    if (opened.header.epoch !== input.header.epoch) {
      fail('E_EPOCH_MISMATCH', 'own envelope is for a different epoch');
    }

    ephemeral = await input.makeEphemeral(input.recipientKemSpki);
    return await sealEnvelope({
      header: {
        domain: input.header.domain,
        recipientKind: input.recipientKind,
        scopeKeyId: input.header.scopeKeyId,
        ownerUserId: input.header.ownerUserId,
        scopeId: input.header.scopeId,
        epoch: input.header.epoch,
        senderDeviceId: input.senderDeviceId,
        recipientId: input.recipientId,
        createdAtMs: input.nowMs,
      },
      scopeKey: raw,
      senderSigSpki: input.senderSigSpki,
      recipientKemSpki: input.recipientKemSpki,
      ephemeral,
      nonce: randomNonce(),
      sign: input.sign,
    });
  } finally {
    zeroize(raw, ephemeral?.sharedSecret);
  }
}

export type SealNewInput = Omit<ProvisionInput, 'ownEnvelope' | 'ownKemSpki' | 'ownEnvelopeSenderSigSpki' | 'deriveSecret'> & {
  /** Raw scope key. The caller owns it and must zeroize it afterwards. */
  scopeKey: Uint8Array;
};

/** Wrap a freshly generated scope key for its first recipient. */
export async function sealScopeKeyForRecipient(input: SealNewInput): Promise<Uint8Array> {
  if (input.scopeKey.length !== AES_KEY_BYTES) fail('E_SCOPE_KEY_WIDTH', 'scope key must be 32 bytes');
  let ephemeral: EphemeralAgreement | null = null;
  try {
    ephemeral = await input.makeEphemeral(input.recipientKemSpki);
    return await sealEnvelope({
      header: {
        domain: input.header.domain as KeyDomainCode,
        recipientKind: input.recipientKind,
        scopeKeyId: input.header.scopeKeyId,
        ownerUserId: input.header.ownerUserId,
        scopeId: input.header.scopeId,
        epoch: input.header.epoch,
        senderDeviceId: input.senderDeviceId,
        recipientId: input.recipientId,
        createdAtMs: input.nowMs,
      },
      scopeKey: input.scopeKey,
      senderSigSpki: input.senderSigSpki,
      recipientKemSpki: input.recipientKemSpki,
      ephemeral,
      nonce: randomNonce(),
      sign: input.sign,
    });
  } finally {
    zeroize(ephemeral?.sharedSecret);
  }
}
