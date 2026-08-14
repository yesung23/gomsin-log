import { describe, expect, it } from 'vitest';

import { AES_KEY_BYTES, importAesKey } from '@/crypto/suite';
import {
  decryptChatMessage,
  decideChatWrite,
  encryptChatMessage,
  type ChatCryptoEnvironment,
} from './contentCrypto';

const COUPLE = '11111111-2222-4333-8444-555555555555';
const MESSAGE = 'aaaaaaaa-2222-4333-8444-555555555555';
const content = { v: 1 as const, text: 'CSK only', sentAt: '2026-08-15T12:00:00.000Z', media: [] as [] };

async function key(seed: number): Promise<CryptoKey> {
  return importAesKey(new Uint8Array(AES_KEY_BYTES).fill(seed), ['encrypt', 'decrypt']);
}

function environment(options: { epoch: bigint; state: 'ACTIVE' | 'RETIRED'; scopeKey: CryptoKey | null }): ChatCryptoEnvironment {
  return {
    epochsFor: async () => [{ domain: 'couple', scopeId: COUPLE, epoch: options.epoch, state: options.state }],
    scopeKeyFor: async () => options.scopeKey,
  };
}

describe('chat crypto routing', () => {
  it('requires an ACTIVE couple epoch and never falls back', async () => {
    expect(await decideChatWrite(environment({ epoch: 1n, state: 'RETIRED', scopeKey: await key(1) }), COUPLE))
      .toEqual({ refused: 'no_active_epoch' });
    expect(await decideChatWrite(environment({ epoch: 1n, state: 'ACTIVE', scopeKey: null }), COUPLE))
      .toEqual({ refused: 'key_unavailable' });
  });

  it('reads RETIRED messages but cannot write a RETIRED message', async () => {
    const scopeKey = await key(2);
    const active = await decideChatWrite(environment({ epoch: 1n, state: 'ACTIVE', scopeKey }), COUPLE);
    if ('refused' in active) throw new Error('expected active plan');
    const envelope = await encryptChatMessage({ plan: active, coupleId: COUPLE, messageId: MESSAGE, content });
    const retired = await decryptChatMessage({
      environment: environment({ epoch: 1n, state: 'RETIRED', scopeKey }),
      coupleId: COUPLE,
      messageId: MESSAGE,
      envelope,
    });
    expect(retired).toMatchObject({ ok: true, keyEpoch: 1n });
  });
});
