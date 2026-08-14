/**
 * Application-facing V1 chat repository.
 *
 * A later UI calls this boundary with a prepared ciphertext. It never sees
 * Supabase row shapes, GLE1 fields, CSK, or epoch state. Encryption preparation
 * lives in `src/app/chat/contentCrypto.ts`; this module owns persistence,
 * pagination, decrypt-at-read, idempotency and tombstones.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fromBase64, hex, parseProtocolU64, unhex } from '@/crypto/bytes';
import {
  decryptChatMessage,
  decideChatWrite,
  encryptChatMessage,
  type ChatCryptoEnvironment,
  type ChatCryptoRefusal,
} from '@/app/chat/contentCrypto';
import type { ChatContext, ChatMessageContent } from '@/crypto/chatContent';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const CHAT_SELECT = 'message_id,couple_id,sender_user_id,ciphertext,ordinal,created_at';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type ChatRow = {
  message_id: string;
  couple_id: string;
  sender_user_id: string | null;
  ciphertext: string | Uint8Array | null;
  ordinal: string | number | bigint;
  created_at: string;
};

export type ChatMessageDraft = {
  coupleId: string;
  text: string;
  sentAt: string;
  replyTo?: string;
  context?: ChatContext;
  ext?: Record<string, unknown>;
  messageId?: string;
};

export type PreparedChatMessage = {
  messageId: string;
  coupleId: string;
  keyEpoch: bigint;
  /** The only message content sent to the repository is opaque ciphertext. */
  ciphertext: Uint8Array;
};

export type ChatUnavailableReason = ChatCryptoRefusal;

export type DecryptedChatMessage = {
  kind: 'message';
  messageId: string;
  coupleId: string;
  senderUserId: string | null;
  ordinal: bigint;
  createdAt: string;
  content: ChatMessageContent;
  keyEpoch: bigint;
};

export type ChatTombstone = {
  kind: 'tombstone';
  messageId: string;
  coupleId: string;
  senderUserId: string | null;
  ordinal: bigint;
  createdAt: string;
};

export type ChatUnavailable = {
  kind: 'unavailable';
  messageId: string;
  coupleId: string;
  senderUserId: string | null;
  ordinal: bigint;
  createdAt: string;
  reason: ChatUnavailableReason;
};

export type ChatFetchedMessage = DecryptedChatMessage | ChatTombstone | ChatUnavailable;

export type ChatOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ServerErrorKind | ChatCryptoRefusal };

export type ChatPage = {
  messages: ChatFetchedMessage[];
  /** Pass this to the next call as `beforeOrdinal`; null means no more page. */
  nextBeforeOrdinal: bigint | null;
};

export type ChatRepository = {
  sendMessage(message: PreparedChatMessage): Promise<ChatOperationResult<{ ordinal: bigint }>>;
  retryPendingMessage(message: PreparedChatMessage): Promise<ChatOperationResult<{ ordinal: bigint }>>;
  fetchMessages(input: { coupleId: string; beforeOrdinal?: bigint; limit?: number }): Promise<ChatOperationResult<ChatPage>>;
  deleteMessage(input: { coupleId: string; messageId: string }): Promise<ChatOperationResult<null>>;
};

function byteaForPostgrest(bytes: Uint8Array): string {
  return `\\x${hex(bytes)}`;
}

function bytesFromPostgrest(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return value.startsWith('\\x') ? unhex(value.slice(2)) : fromBase64(value);
  } catch {
    return null;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function pageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new RangeError(`chat page size must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return value;
}

export async function prepareChatMessage(
  environment: ChatCryptoEnvironment,
  draft: ChatMessageDraft,
): Promise<ChatOperationResult<PreparedChatMessage>> {
  const plan = await decideChatWrite(environment, draft.coupleId);
  if ('refused' in plan) return { ok: false, reason: plan.refused };
  const messageId = draft.messageId ?? crypto.randomUUID();
  const content: ChatMessageContent = {
    v: 1,
    text: draft.text,
    sentAt: draft.sentAt,
    ...(draft.replyTo === undefined ? {} : { replyTo: draft.replyTo }),
    ...(draft.context === undefined ? {} : { context: draft.context }),
    media: [],
    ...(draft.ext === undefined ? {} : { ext: draft.ext }),
  };
  const ciphertext = await encryptChatMessage({
    plan,
    coupleId: draft.coupleId,
    messageId,
    content,
  });
  return { ok: true, value: { messageId, coupleId: draft.coupleId, keyEpoch: plan.keyEpoch, ciphertext } };
}

function rowOrdinal(row: ChatRow): bigint {
  return parseProtocolU64(row.ordinal, 'chat_messages.ordinal');
}

function mapCommon(row: ChatRow) {
  return {
    messageId: row.message_id,
    coupleId: row.couple_id,
    senderUserId: row.sender_user_id,
    ordinal: rowOrdinal(row),
    createdAt: row.created_at,
  };
}

async function decryptRow(
  environment: ChatCryptoEnvironment,
  row: ChatRow,
): Promise<ChatFetchedMessage> {
  const common = mapCommon(row);
  if (row.ciphertext === null) return { kind: 'tombstone', ...common };
  const envelope = bytesFromPostgrest(row.ciphertext);
  if (!envelope) return { kind: 'unavailable', ...common, reason: 'undecryptable' };
  const opened = await decryptChatMessage({
    environment,
    coupleId: row.couple_id,
    messageId: row.message_id,
    envelope,
  });
  if (!opened.ok) return { kind: 'unavailable', ...common, reason: opened.reason };
  return { kind: 'message', ...common, content: opened.content, keyEpoch: opened.keyEpoch };
}

export function createChatRepository(
  environment: ChatCryptoEnvironment,
  client: SupabaseClient | null = supabase,
): ChatRepository {
  if (!client || !isSupabaseConfigured) {
    throw new Error('Chat repository requires a configured Supabase client.');
  }
  const db = client;

  async function findById(message: PreparedChatMessage): Promise<ChatOperationResult<{ ordinal: bigint }>> {
    const { data, error } = await db
      .from('chat_messages')
      .select(CHAT_SELECT)
      .eq('message_id', message.messageId)
      .maybeSingle();
    if (error) return { ok: false, reason: classifyServerError(error).kind };
    if (!data) return { ok: false, reason: 'unknown' };
    const row = data as ChatRow;
    const existing = bytesFromPostgrest(row.ciphertext);
    if (row.couple_id !== message.coupleId || !existing || !sameBytes(existing, message.ciphertext)) {
      return { ok: false, reason: 'forbidden' };
    }
    return { ok: true, value: { ordinal: rowOrdinal(row) } };
  }

  async function sendMessage(message: PreparedChatMessage): Promise<ChatOperationResult<{ ordinal: bigint }>> {
    const { data, error } = await db
      .from('chat_messages')
      .insert({
        message_id: message.messageId,
        couple_id: message.coupleId,
        ciphertext: byteaForPostgrest(message.ciphertext),
      })
      .select(CHAT_SELECT)
      .maybeSingle();
    if (!error && data) return { ok: true, value: { ordinal: rowOrdinal(data as ChatRow) } };
    if (!error || error.code === '23505') return findById(message);
    return { ok: false, reason: classifyServerError(error).kind };
  }

  return {
    sendMessage,
    retryPendingMessage: sendMessage,
    async fetchMessages(input) {
      const limit = pageSize(input.limit);
      let query = db
        .from('chat_messages')
        .select(CHAT_SELECT)
        .eq('couple_id', input.coupleId);
      if (input.beforeOrdinal !== undefined) query = query.lt('ordinal', input.beforeOrdinal.toString());
      const { data, error } = await query
        .order('ordinal', { ascending: false })
        .limit(limit);
      if (error) return { ok: false, reason: classifyServerError(error).kind };
      const rows = (data ?? []) as ChatRow[];
      const messages = await Promise.all(rows.map((row) => decryptRow(environment, row)));
      messages.reverse();
      return {
        ok: true,
        value: {
          messages,
          nextBeforeOrdinal: rows.length === limit && rows.length > 0 ? rowOrdinal(rows[rows.length - 1]) : null,
        },
      };
    },
    async deleteMessage(input) {
      const { data, error } = await db
        .from('chat_messages')
        .update({ ciphertext: null })
        .eq('message_id', input.messageId)
        .eq('couple_id', input.coupleId)
        .select('message_id')
        .maybeSingle();
      if (error) return { ok: false, reason: classifyServerError(error).kind };
      if (!data) return { ok: false, reason: 'not_found' };
      return { ok: true, value: null };
    },
  };
}
