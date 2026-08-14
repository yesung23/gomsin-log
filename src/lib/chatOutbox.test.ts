import { describe, expect, it } from 'vitest';

import { AES_KEY_BYTES, importAesKey } from '@/crypto/suite';
import type { PreparedChatMessage } from './chat';
import {
  applyChatDeliveryOutcome,
  enqueueChatMessage,
  pendingChatMessages,
  readQueuedChatMessage,
  type ChatOutboxPersistence,
  type QueuedChatMessage,
} from './chatOutbox';

class MemoryChatOutbox implements ChatOutboxPersistence {
  entries = new Map<string, QueuedChatMessage>();
  async all() { return [...this.entries.values()]; }
  async put(entry: QueuedChatMessage) { this.entries.set(entry.messageId, entry); }
  async remove(messageId: string) { this.entries.delete(messageId); }
}

async function key(seed: number): Promise<CryptoKey> {
  return importAesKey(new Uint8Array(AES_KEY_BYTES).fill(seed), ['encrypt', 'decrypt']);
}

const message: PreparedChatMessage = {
  messageId: 'aaaaaaaa-2222-4333-8444-555555555555',
  coupleId: '11111111-2222-4333-8444-555555555555',
  keyEpoch: 1n,
  ciphertext: new TextEncoder().encode('GLE1 ciphertext bytes, not plaintext message body'),
};

describe('chat encrypted outbox', () => {
  it('fails closed instead of persisting plaintext without LCK', async () => {
    const persistence = new MemoryChatOutbox();
    await expect(enqueueChatMessage(persistence, { localCacheKey: null, userId: 'user-a', message }))
      .resolves.toEqual({ ok: false, reason: 'local_cache_key_unavailable' });
    expect(persistence.entries.size).toBe(0);
  });

  it('stores ciphertext only and restores the exact prepared message', async () => {
    const persistence = new MemoryChatOutbox();
    const result = await enqueueChatMessage(persistence, { localCacheKey: await key(7), userId: 'user-a', message });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).not.toHaveProperty('record');
    expect(JSON.stringify(result.entry)).not.toContain('plaintext message body');
    const restored = await readQueuedChatMessage(result.entry, await key(7));
    expect(restored.messageId).toBe(message.messageId);
    expect(restored.coupleId).toBe(message.coupleId);
    expect(restored.keyEpoch).toBe(message.keyEpoch);
    expect(Array.from(restored.ciphertext)).toEqual(Array.from(message.ciphertext));
    await expect(readQueuedChatMessage(result.entry, await key(8))).rejects.toThrow();
  });

  it('keeps retryable entries and blocks definitive failures without dropping them', async () => {
    const persistence = new MemoryChatOutbox();
    const result = await enqueueChatMessage(persistence, { localCacheKey: await key(9), userId: 'user-a', message });
    if (!result.ok) throw new Error('expected enqueue');
    await expect(applyChatDeliveryOutcome(persistence, result.entry, {
      ok: false, reason: 'unreachable', message: 'network',
    })).resolves.toBe('requeued');
    expect((await pendingChatMessages(persistence, 'user-a'))).toHaveLength(1);
    const current = (await persistence.all())[0];
    await expect(applyChatDeliveryOutcome(persistence, current, {
      ok: false, reason: 'forbidden', message: 'not allowed',
    })).resolves.toBe('blocked');
    expect((await persistence.all())[0].blocked?.reason).toBe('forbidden');
  });
});
