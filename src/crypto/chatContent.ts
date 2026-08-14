/**
 * V1 chat message content and its GLE1 binding.
 *
 * The server row contains only the opaque GLE1 envelope. This module owns the
 * plaintext document that a later chat UI may use; it does not know Supabase,
 * RLS, or local persistence.
 */

import { utf8, uuidToBytes } from './bytes';
import {
  FIELD_ID,
  OBJECT_TYPE,
  openContent,
  sealContent,
  type Gle1Aad,
} from './gle1';
import { KEY_DOMAIN } from './domains';

export const CHAT_DOCUMENT_VERSION = 1;

export type ChatContext =
  | { kind: 'daily_record'; id: string }
  | { kind: 'talk_about'; id: string };

export type ChatMessageContent = {
  v: typeof CHAT_DOCUMENT_VERSION;
  text: string;
  sentAt: string;
  replyTo?: string;
  context?: ChatContext;
  /** V1 is text-only. P6 may add opaque media ids inside this array. */
  media: [];
  /** Unknown extension keys survive a decode/re-encode cycle. */
  ext?: Record<string, unknown>;
};

export class ChatContentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'ChatContentError';
  }
}

function fail(code: string, message: string): never {
  throw new ChatContentError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  try {
    uuidToBytes(value);
    return true;
  } catch {
    return false;
  }
}

function validateUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) fail('E_CHAT_BAD_UUID', `${field} must be a UUID`);
  return value;
}

function orderedPayload(content: ChatMessageContent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    v: CHAT_DOCUMENT_VERSION,
    text: content.text,
    sent_at: content.sentAt,
    media: [],
  };
  if (content.replyTo !== undefined) payload.reply_to = content.replyTo;
  if (content.context !== undefined) payload.context = content.context;
  if (content.ext !== undefined) payload.ext = content.ext;
  return payload;
}

export function encodeChatMessage(content: ChatMessageContent): Uint8Array {
  if (content.v !== CHAT_DOCUMENT_VERSION) fail('E_CHAT_VERSION', 'unsupported chat document version');
  if (typeof content.text !== 'string') fail('E_CHAT_TEXT', 'message text must be a string');
  if (typeof content.sentAt !== 'string') fail('E_CHAT_SENT_AT', 'sent_at must be a string');
  if (content.media.length !== 0) fail('E_CHAT_MEDIA_UNSUPPORTED', 'V1 chat messages cannot carry media');
  if (content.replyTo !== undefined) validateUuid(content.replyTo, 'reply_to');
  if (content.context !== undefined) {
    validateUuid(content.context.id, 'context.id');
    if (content.context.kind !== 'daily_record' && content.context.kind !== 'talk_about') {
      fail('E_CHAT_CONTEXT_KIND', 'unsupported chat context kind');
    }
  }
  if (content.ext !== undefined && !isObject(content.ext)) fail('E_CHAT_EXT', 'ext must be an object');
  return utf8(JSON.stringify(orderedPayload(content)));
}

export function decodeChatMessage(bytes: Uint8Array): ChatMessageContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail('E_CHAT_MALFORMED', 'chat payload is not valid JSON');
  }
  if (!isObject(parsed)) fail('E_CHAT_MALFORMED', 'chat payload must be an object');
  if (parsed.v !== CHAT_DOCUMENT_VERSION) fail('E_CHAT_VERSION', 'unsupported chat document version');
  if (typeof parsed.text !== 'string') fail('E_CHAT_TEXT', 'message text must be a string');
  if (typeof parsed.sent_at !== 'string') fail('E_CHAT_SENT_AT', 'sent_at must be a string');
  if (!Array.isArray(parsed.media) || parsed.media.length !== 0) {
    fail('E_CHAT_MEDIA_UNSUPPORTED', 'V1 chat messages must carry an empty media array');
  }

  const content: ChatMessageContent = {
    v: CHAT_DOCUMENT_VERSION,
    text: parsed.text,
    sentAt: parsed.sent_at,
    media: [],
  };
  if (parsed.reply_to !== undefined) content.replyTo = validateUuid(parsed.reply_to, 'reply_to');
  if (parsed.context !== undefined) {
    if (!isObject(parsed.context)) fail('E_CHAT_CONTEXT', 'context must be an object');
    const kind = parsed.context.kind;
    if (kind !== 'daily_record' && kind !== 'talk_about') fail('E_CHAT_CONTEXT_KIND', 'unsupported chat context kind');
    content.context = {
      kind,
      id: validateUuid(parsed.context.id, 'context.id'),
    };
  }
  if (parsed.ext !== undefined) {
    if (!isObject(parsed.ext)) fail('E_CHAT_EXT', 'ext must be an object');
    content.ext = parsed.ext;
  }
  return content;
}

export type ChatAadInput = {
  coupleId: string;
  messageId: string;
  keyEpoch: bigint;
  contentRevision?: bigint;
};

/**
 * A shared chat object has no durable user owner: sender_user_id becomes NULL
 * when that account is deleted, while the surviving partner must still open
 * the shared history. The couple scope id therefore occupies the stable owner
 * slot as well as scopeId. Sender identity remains server metadata, not crypto
 * identity, exactly as the chat contract requires.
 */
export function chatAad(input: ChatAadInput): Gle1Aad {
  return {
    domain: KEY_DOMAIN.couple,
    keyEpoch: input.keyEpoch,
    ownerUserId: uuidToBytes(input.coupleId),
    scopeId: uuidToBytes(input.coupleId),
    objectType: OBJECT_TYPE.chatMessage,
    objectId: uuidToBytes(input.messageId),
    fieldId: FIELD_ID.messageText,
    contentRevision: input.contentRevision ?? 1n,
  };
}

export async function sealChatMessage(input: ChatAadInput & {
  scopeKey: CryptoKey;
  content: ChatMessageContent;
}): Promise<Uint8Array> {
  return sealContent({
    scopeKey: input.scopeKey,
    plaintext: encodeChatMessage(input.content),
    aad: chatAad(input),
  });
}

export async function openChatMessage(input: ChatAadInput & {
  scopeKey: CryptoKey;
  envelope: Uint8Array;
}): Promise<ChatMessageContent> {
  return decodeChatMessage(await openContent({
    scopeKey: input.scopeKey,
    envelope: input.envelope,
    aad: chatAad(input),
  }));
}
