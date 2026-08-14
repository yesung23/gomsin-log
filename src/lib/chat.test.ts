import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: null }));

import { createChatRepository, prepareChatMessage, type PreparedChatMessage } from './chat';
import { importAesKey, AES_KEY_BYTES } from '@/crypto/suite';
import type { ChatCryptoEnvironment } from '@/app/chat/contentCrypto';

const COUPLE = '11111111-2222-4333-8444-555555555555';
const MESSAGE = 'aaaaaaaa-2222-4333-8444-555555555555';

async function key(seed: number): Promise<CryptoKey> {
  return importAesKey(new Uint8Array(AES_KEY_BYTES).fill(seed), ['encrypt', 'decrypt']);
}

async function environment(): Promise<ChatCryptoEnvironment> {
  const scopeKey = await key(4);
  return {
    epochsFor: async () => [{ domain: 'couple', scopeId: COUPLE, epoch: 1n, state: 'ACTIVE' }],
    scopeKeyFor: async () => scopeKey,
  };
}

function fakeClient(options: {
  insert: { data: unknown; error: unknown };
  select?: { data: unknown; error: unknown };
  fetch?: { data: unknown; error: unknown };
  delete?: { data: unknown; error: unknown };
}) {
  const builder: Record<string, any> = {};
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.lt = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => Promise.resolve(options.fetch ?? { data: [], error: null }));
  const maybeSingle = vi.fn()
    .mockResolvedValueOnce(options.insert)
    .mockResolvedValueOnce(options.select ?? { data: null, error: null })
    .mockResolvedValue(options.delete ?? { data: { message_id: MESSAGE }, error: null });
  builder.maybeSingle = maybeSingle;
  return { client: { from: vi.fn(() => builder) }, builder, maybeSingle };
}

const prepared: PreparedChatMessage = {
  messageId: MESSAGE,
  coupleId: COUPLE,
  keyEpoch: 1n,
  ciphertext: new Uint8Array([1, 2, 3]),
};

describe('chat application boundary', () => {
  it('prepares CSK/GLE1 ciphertext without returning plaintext to persistence', async () => {
    const result = await prepareChatMessage(await environment(), {
      coupleId: COUPLE,
      messageId: MESSAGE,
      text: '서버가 보지 못할 본문',
      sentAt: '2026-08-15T12:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ciphertext).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result.value.ciphertext)).not.toContain('서버가 보지 못할 본문');
    expect(result.value.keyEpoch).toBe(1n);
  });

  it('uses INSERT-only send and adopts the existing row on an exact response-loss retry', async () => {
    const existing = {
      message_id: MESSAGE,
      couple_id: COUPLE,
      sender_user_id: 'bbbbbbbb-2222-4333-8444-555555555555',
      ciphertext: '\\x010203',
      ordinal: '4',
      created_at: '2026-08-15T12:00:00.000Z',
    };
    const fake = fakeClient({
      insert: { data: null, error: { code: '23505', message: 'duplicate key' } },
      select: { data: existing, error: null },
    });
    const repository = createChatRepository(await environment(), fake.client as never);
    await expect(repository.retryPendingMessage(prepared)).resolves.toEqual({ ok: true, value: { ordinal: 4n } });
    expect(fake.builder.insert).toHaveBeenCalledTimes(1);
    expect(fake.builder.update).not.toHaveBeenCalled();
  });

  it('returns tombstones and paginates by server ordinal, never client time', async () => {
    const fake = fakeClient({
      insert: { data: null, error: null },
      fetch: {
        data: [
          { message_id: MESSAGE, couple_id: COUPLE, sender_user_id: null, ciphertext: null, ordinal: '2', created_at: '2026-08-15T13:00:00Z' },
          { message_id: 'cccccccc-2222-4333-8444-555555555555', couple_id: COUPLE, sender_user_id: 'b', ciphertext: null, ordinal: '1', created_at: '2026-08-15T01:00:00Z' },
        ],
        error: null,
      },
    });
    const repository = createChatRepository(await environment(), fake.client as never);
    const result = await repository.fetchMessages({ coupleId: COUPLE, beforeOrdinal: 3n, limit: 2 });
    expect(result).toMatchObject({ ok: true, value: { nextBeforeOrdinal: 1n } });
    if (result.ok) expect(result.value.messages.map((message) => [message.kind, message.ordinal])).toEqual([
      ['tombstone', 1n], ['tombstone', 2n],
    ]);
    expect(fake.builder.lt).toHaveBeenCalledWith('ordinal', '3');
    expect(fake.builder.order).toHaveBeenCalledWith('ordinal', { ascending: false });
  });

  it('uses sender-only tombstone persistence and maps no match to not_found', async () => {
    const fake = fakeClient({
      insert: { data: null, error: null },
      delete: { data: null, error: null },
    });
    const repository = createChatRepository(await environment(), fake.client as never);
    await expect(repository.deleteMessage({ coupleId: COUPLE, messageId: MESSAGE }))
      .resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(fake.builder.update).toHaveBeenCalledWith({ ciphertext: null });
  });
});
