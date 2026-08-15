/**
 * Encryption for the offline record queue.
 *
 * The defect this closes is named in two canonical documents: the chat contract
 * §8 says "기존 기록 outbox는 IndexedDB에 평문을 넣는데 (DATA_LEGAL §B가 지적)",
 * and P4's decision 5 requires that offline queued User Content be ciphertext.
 * Until now a record written with no network sat in IndexedDB as readable text —
 * on a device whose disk the app cannot attest — for as long as delivery kept
 * failing.
 *
 * The key is the LCK (architecture V2.1 §2): the device-local cache/draft/outbox
 * key. Not the PMK and not the CSK, and that distinction is the point. A queued
 * entry is not yet a record in a scope: its visibility can still change before it
 * is sent, an unsent private draft must not be wrapped under a couple key, and
 * the queue must stay openable while the couple's epoch rotates underneath it.
 * The scope key is applied at DELIVERY, by the normal write path, where the
 * record's routing is finally known.
 *
 * So this is defence for data at rest on one device, and it is described as
 * exactly that. It is NOT end-to-end encryption of the queue: the same device
 * holds the key, which is unavoidable because the same device must re-read the
 * entry to send it.
 *
 * AES-256-GCM with a fresh 96-bit nonce per entry, via `crypto/suite.ts`. The
 * entry id is bound as associated data, so a queue entry cannot be moved onto
 * another id — which would otherwise let a tampered queue redirect one record's
 * content onto another record's row at delivery time.
 */

import { concat, utf8 } from '@/crypto/bytes';
import { GCM_NONCE_BYTES, aesGcmOpen, aesGcmSeal, randomNonce } from '@/crypto/suite';
import type { LocalKeyCapability } from '@/crypto/keystore/LocalKeyPort';

const AAD_LABEL = utf8('gomsinlog/outbox/v1');
export type OutboxLocalKey = CryptoKey | LocalKeyCapability;

function isCapability(key: OutboxLocalKey): key is LocalKeyCapability {
  return typeof key === 'object' && 'seal' in key && 'open' in key;
}

/** The queue payload, once decoded. Files travel separately — see below. */
export type OutboxPlaintext = {
  record: unknown;
};

export const OUTBOX_CIPHER_VERSION = 1;

/**
 * What a sealed entry stores in place of the record.
 *
 * `version` is explicit so an entry queued by an older build is recognised rather
 * than mis-parsed, and so a plaintext legacy entry (no `sealed` field at all) is
 * distinguishable by structure rather than by guessing at its shape.
 */
export type SealedOutboxRecord = {
  version: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

function aadFor(entryId: string, userId: string): Uint8Array {
  // Both ids, so an entry cannot be replayed into another account's queue either.
  return concat(AAD_LABEL, utf8(entryId), utf8('|'), utf8(userId));
}

export async function sealOutboxRecord(input: {
  localCacheKey: OutboxLocalKey;
  entryId: string;
  userId: string;
  record: unknown;
}): Promise<SealedOutboxRecord> {
  const nonce = randomNonce();
  const plaintext = utf8(JSON.stringify(input.record));
  const aad = aadFor(input.entryId, input.userId);
  if (isCapability(input.localCacheKey)) {
    const sealed = await input.localCacheKey.seal({ plaintext, aad });
    return { version: OUTBOX_CIPHER_VERSION, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
  }
  const ciphertext = await aesGcmSeal(input.localCacheKey, nonce, plaintext, aad);
  return { version: OUTBOX_CIPHER_VERSION, nonce, ciphertext };
}

export class OutboxCryptoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'OutboxCryptoError';
  }
}

export async function openOutboxRecord(input: {
  localCacheKey: OutboxLocalKey;
  entryId: string;
  userId: string;
  sealed: SealedOutboxRecord;
}): Promise<unknown> {
  if (input.sealed.version !== OUTBOX_CIPHER_VERSION) {
    throw new OutboxCryptoError('E_OUTBOX_VERSION', `unsupported outbox cipher version ${input.sealed.version}`);
  }
  if (input.sealed.nonce.length !== GCM_NONCE_BYTES) {
    throw new OutboxCryptoError('E_OUTBOX_NONCE', 'outbox nonce has the wrong width');
  }
  const aad = aadFor(input.entryId, input.userId);
  const plaintext = isCapability(input.localCacheKey)
    ? await input.localCacheKey.open({ sealed: input.sealed, aad })
    : await aesGcmOpen(input.localCacheKey, input.sealed.nonce, input.sealed.ciphertext, aad);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/** True when an entry is sealed rather than a legacy plaintext one. */
export function isSealedOutboxRecord(value: unknown): value is SealedOutboxRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.version === 'number'
    && candidate.nonce instanceof Uint8Array
    && candidate.ciphertext instanceof Uint8Array;
}
