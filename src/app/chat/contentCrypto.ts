/** Chat's application crypto boundary: couple CSK only, GLE1, ACTIVE writes. */

import { epochAcceptsWrites, epochAllowsDecrypt, KEY_DOMAIN } from '@/crypto/domains';
import { decodeHeader } from '@/crypto/gle1';
import {
  openChatMessage,
  sealChatMessage,
  type ChatMessageContent,
} from '@/crypto/chatContent';
import type { RecordCryptoEnvironment } from '@/app/records/contentCrypto';

export type ChatCryptoEnvironment = Pick<RecordCryptoEnvironment, 'epochsFor' | 'scopeKeyFor'>;

export type ChatCryptoRefusal = 'no_active_epoch' | 'key_unavailable' | 'undecryptable';

export type ChatWritePlan = {
  keyEpoch: bigint;
  scopeKey: CryptoKey;
};

export async function decideChatWrite(
  environment: ChatCryptoEnvironment,
  coupleId: string,
): Promise<ChatWritePlan | { refused: ChatCryptoRefusal }> {
  const epochs = await environment.epochsFor('couple', coupleId);
  const active = epochs.find((candidate) => epochAcceptsWrites(candidate.state));
  if (!active) return { refused: 'no_active_epoch' };
  const scopeKey = await environment.scopeKeyFor('couple', coupleId, active.epoch);
  if (!scopeKey) return { refused: 'key_unavailable' };
  return { keyEpoch: active.epoch, scopeKey };
}

export async function encryptChatMessage(input: {
  plan: ChatWritePlan;
  coupleId: string;
  messageId: string;
  content: ChatMessageContent;
}): Promise<Uint8Array> {
  return sealChatMessage({
    scopeKey: input.plan.scopeKey,
    coupleId: input.coupleId,
    messageId: input.messageId,
    keyEpoch: input.plan.keyEpoch,
    content: input.content,
  });
}

export async function decryptChatMessage(input: {
  environment: ChatCryptoEnvironment;
  coupleId: string;
  messageId: string;
  envelope: Uint8Array;
}): Promise<{ ok: true; content: ChatMessageContent; keyEpoch: bigint } | { ok: false; reason: ChatCryptoRefusal }> {
  let header;
  try {
    header = decodeHeader(input.envelope);
  } catch {
    return { ok: false, reason: 'undecryptable' };
  }
  if (header.domain !== KEY_DOMAIN.couple) return { ok: false, reason: 'undecryptable' };
  const epochs = await input.environment.epochsFor('couple', input.coupleId);
  const epoch = epochs.find((candidate) => candidate.epoch === header.keyEpoch);
  if (!epoch || !epochAllowsDecrypt(epoch.state)) return { ok: false, reason: 'undecryptable' };
  const scopeKey = await input.environment.scopeKeyFor('couple', input.coupleId, header.keyEpoch);
  if (!scopeKey) return { ok: false, reason: 'key_unavailable' };
  try {
    const content = await openChatMessage({
      scopeKey,
      coupleId: input.coupleId,
      messageId: input.messageId,
      keyEpoch: header.keyEpoch,
      envelope: input.envelope,
    });
    return { ok: true, content, keyEpoch: header.keyEpoch };
  } catch {
    return { ok: false, reason: 'undecryptable' };
  }
}
