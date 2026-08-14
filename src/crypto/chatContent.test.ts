import { describe, expect, it } from 'vitest';

import { AES_KEY_BYTES, importAesKey } from './suite';
import { OBJECT_TYPE, FIELD_ID } from './gle1';
import {
  decodeChatMessage,
  encodeChatMessage,
  openChatMessage,
  sealChatMessage,
  type ChatMessageContent,
} from './chatContent';

const COUPLE = '11111111-2222-4333-8444-555555555555';
const OTHER_COUPLE = '22222222-2222-4333-8444-555555555555';
const MESSAGE_A = 'aaaaaaaa-2222-4333-8444-555555555555';
const MESSAGE_B = 'bbbbbbbb-2222-4333-8444-555555555555';

async function key(seed: number): Promise<CryptoKey> {
  return importAesKey(new Uint8Array(AES_KEY_BYTES).fill(seed), ['encrypt', 'decrypt']);
}

const content: ChatMessageContent = {
  v: 1,
  text: '오늘의 비밀 메시지',
  sentAt: '2026-08-15T12:00:00.000Z',
  replyTo: 'cccccccc-2222-4333-8444-555555555555',
  context: { kind: 'daily_record', id: 'dddddddd-2222-4333-8444-555555555555' },
  media: [],
  ext: { future_flag: true },
};

describe('chat content payload', () => {
  it('round-trips the canonical text payload and opaque context', () => {
    expect(decodeChatMessage(encodeChatMessage(content))).toEqual(content);
  });

  it('rejects V1 media and invalid context ids', () => {
    expect(() => encodeChatMessage({ ...content, media: ['not-allowed'] as never })).toThrow('E_CHAT_MEDIA_UNSUPPORTED');
    expect(() => encodeChatMessage({ ...content, context: { kind: 'daily_record', id: 'not-a-uuid' } })).toThrow('E_CHAT_BAD_UUID');
  });
});

describe('chat GLE1 binding', () => {
  it('uses the dedicated chat object/field ids', () => {
    expect(OBJECT_TYPE.chatMessage).toBe(8);
    expect(FIELD_ID.messageText).toBe(9);
  });

  it('does not leave message plaintext in the envelope', async () => {
    const envelope = await sealChatMessage({
      scopeKey: await key(1), coupleId: COUPLE, messageId: MESSAGE_A, keyEpoch: 1n, content,
    });
    expect(new TextDecoder().decode(envelope)).not.toContain(content.text);
    expect(envelope.length).toBeGreaterThanOrEqual(108);
  });

  it('opens with the shared CSK and rejects a PMK/HRK substitute', async () => {
    const coupleKey = await key(2);
    const envelope = await sealChatMessage({
      scopeKey: coupleKey, coupleId: COUPLE, messageId: MESSAGE_A, keyEpoch: 1n, content,
    });
    await expect(openChatMessage({
      scopeKey: coupleKey, coupleId: COUPLE, messageId: MESSAGE_A, keyEpoch: 1n, envelope,
    })).resolves.toEqual(content);
    await expect(openChatMessage({
      scopeKey: await key(3), coupleId: COUPLE, messageId: MESSAGE_A, keyEpoch: 1n, envelope,
    })).rejects.toThrow();
  });

  it('rejects ciphertext transplanted onto another message id', async () => {
    const scopeKey = await key(4);
    const envelope = await sealChatMessage({
      scopeKey, coupleId: COUPLE, messageId: MESSAGE_A, keyEpoch: 1n, content,
    });
    await expect(openChatMessage({
      scopeKey, coupleId: COUPLE, messageId: MESSAGE_B, keyEpoch: 1n, envelope,
    })).rejects.toThrow();
  });

  it('rejects ciphertext replayed into another couple scope', async () => {
    const scopeKey = await key(5);
    const envelope = await sealChatMessage({
      scopeKey, coupleId: COUPLE, messageId: MESSAGE_A, keyEpoch: 1n, content,
    });
    await expect(openChatMessage({
      scopeKey, coupleId: OTHER_COUPLE, messageId: MESSAGE_A, keyEpoch: 1n, envelope,
    })).rejects.toThrow();
  });
});
