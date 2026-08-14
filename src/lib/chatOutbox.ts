/**
 * Chat-specific encrypted outbox.
 *
 * The existing record queue carries Files and a record-shaped plaintext legacy
 * branch. Chat has no media and must fail closed when an LCK is unavailable, so
 * this small adapter stores only a sealed message envelope and reuses the
 * repository's tested AES-GCM outbox primitive instead of copying crypto code.
 */

import {
  isRetryableReason,
  MAX_DELIVERY_ATTEMPTS,
  type RetryableReason,
} from '@/lib/outbox';
import {
  openOutboxRecord,
  sealOutboxRecord,
  type SealedOutboxRecord,
} from '@/lib/outboxCrypto';
import type { PreparedChatMessage } from '@/lib/chat';

export type QueuedChatMessage = {
  messageId: string;
  userId: string;
  coupleId: string;
  queuedAt: string;
  attempts: number;
  sealedMessage: SealedOutboxRecord;
  blocked?: { reason: string; message: string; at: string };
};

export interface ChatOutboxPersistence {
  all(): Promise<QueuedChatMessage[]>;
  put(entry: QueuedChatMessage): Promise<void>;
  remove(messageId: string): Promise<void>;
}

export type ChatOutboxResult =
  | { ok: true; entry: QueuedChatMessage }
  | { ok: false; reason: 'local_cache_key_unavailable' };

export async function enqueueChatMessage(
  persistence: ChatOutboxPersistence,
  input: { localCacheKey: CryptoKey | null; userId: string; message: PreparedChatMessage; queuedAt?: string },
): Promise<ChatOutboxResult> {
  if (!input.localCacheKey) return { ok: false, reason: 'local_cache_key_unavailable' };
  const sealedMessage = await sealOutboxRecord({
    localCacheKey: input.localCacheKey,
    entryId: input.message.messageId,
    userId: input.userId,
    record: {
      messageId: input.message.messageId,
      coupleId: input.message.coupleId,
      keyEpoch: input.message.keyEpoch.toString(),
      ciphertext: Array.from(input.message.ciphertext),
    },
  });
  const entry: QueuedChatMessage = {
    messageId: input.message.messageId,
    userId: input.userId,
    coupleId: input.message.coupleId,
    queuedAt: input.queuedAt ?? new Date().toISOString(),
    attempts: 0,
    sealedMessage,
  };
  await persistence.put(entry);
  return { ok: true, entry };
}

export async function readQueuedChatMessage(
  entry: QueuedChatMessage,
  localCacheKey: CryptoKey | null,
): Promise<PreparedChatMessage> {
  if (!localCacheKey) throw new Error('Queued chat message needs the local cache key.');
  const opened = await openOutboxRecord({
    localCacheKey,
    entryId: entry.messageId,
    userId: entry.userId,
    sealed: entry.sealedMessage,
  });
  if (!opened || typeof opened !== 'object' || Array.isArray(opened)) throw new Error('Malformed queued chat message.');
  const value = opened as Record<string, unknown>;
  if (typeof value.messageId !== 'string' || value.messageId !== entry.messageId) throw new Error('Queued chat id mismatch.');
  if (typeof value.coupleId !== 'string' || typeof value.keyEpoch !== 'string' || !Array.isArray(value.ciphertext)) {
    throw new Error('Malformed queued chat message.');
  }
  if (!value.ciphertext.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error('Queued chat ciphertext is malformed.');
  }
  return {
    messageId: value.messageId,
    coupleId: value.coupleId,
    keyEpoch: BigInt(value.keyEpoch),
    ciphertext: new Uint8Array(value.ciphertext as number[]),
  };
}

export async function pendingChatMessages(
  persistence: ChatOutboxPersistence,
  userId: string,
): Promise<QueuedChatMessage[]> {
  const entries = await persistence.all();
  return entries
    .filter((entry) => entry.userId === userId && !entry.blocked && entry.attempts < MAX_DELIVERY_ATTEMPTS)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export type ChatDeliveryOutcome =
  | { ok: true }
  | { ok: false; reason: string; message: string };

export async function applyChatDeliveryOutcome(
  persistence: ChatOutboxPersistence,
  entry: QueuedChatMessage,
  outcome: ChatDeliveryOutcome,
  now: () => string = () => new Date().toISOString(),
): Promise<'delivered' | 'requeued' | 'blocked'> {
  if (outcome.ok) {
    await persistence.remove(entry.messageId);
    return 'delivered';
  }
  const attempts = entry.attempts + 1;
  if (isRetryableReason(outcome.reason) && attempts < MAX_DELIVERY_ATTEMPTS) {
    await persistence.put({ ...entry, attempts });
    return 'requeued';
  }
  await persistence.put({
    ...entry,
    attempts,
    blocked: {
      reason: outcome.reason,
      message: outcome.message,
      at: now(),
    },
  });
  return 'blocked';
}

export function isChatRetryableReason(reason: string): reason is RetryableReason {
  return isRetryableReason(reason);
}
