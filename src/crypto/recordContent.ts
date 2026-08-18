/**
 * The `daily_records` content document — P5's one new crypto surface.
 *
 * This module owns exactly one question: what plaintext bytes go inside a GLE1
 * envelope for a daily record, and how do they come back out. It invents no
 * cryptography. Sealing, unsealing, the envelope layout, the DEK and the AAD all
 * belong to `gle1.ts`; the key hierarchy belongs to `domains.ts` and
 * `keyring/scopeKeys.ts`. What is new here is a canonical document format and
 * the routing rule that decides WHICH scope key a record is sealed under.
 *
 * ONE envelope per record, not one per field. Five envelopes would put five
 * 92-byte headers and five wrapped DEKs on every row in order to hide fields
 * whose lengths are already correlated, and — worse — would let a client mix
 * epochs or domains within a single record. So the five protected fields are
 * serialized into one document, sealed once, and stored in one column. The GLE1
 * AAD therefore pins `objectType = dailyRecord` and `fieldId = logText`, the
 * latter meaning "the record's content document" for this object type.
 *
 * The protected set is not chosen here. It is architecture V2.1 §10's list, and
 * it is the same list migration 032's residue rule enforces:
 *
 *   log_text · reaction · attachments · emotion_flow · record_time
 *
 * Accepted plaintext, deliberately absent from the document: `record_date`
 * (ordering), `emotion_updated_at`, `talk_about`, and the ids. Putting those in
 * the envelope would break sorting and the bilateral talk-about coordination
 * without hiding anything the row's existence does not already reveal.
 */

import { utf8, uuidToBytes } from './bytes';
import { KEY_DOMAIN, type KeyDomainCode, type KeyDomainName } from './domains';
import {
  FIELD_ID,
  Gle1Error,
  OBJECT_TYPE,
  openContent,
  sealContent,
  type Gle1Aad,
} from './gle1';

/**
 * The document version, inside the ciphertext.
 *
 * Separate from `GLE1_FORMAT_VERSION`: that versions the envelope, this versions
 * what the plaintext means. A future field can be added by bumping this without
 * touching the envelope format, and an old client reading a newer document fails
 * loudly instead of silently dropping a field it does not know about.
 */
export const RECORD_DOCUMENT_VERSION = 1;

/** The five protected fields, as the document carries them. */
export type RecordContentDocument = {
  /** `log_text`. Always present, possibly empty. */
  log: string;
  /** `reaction`. Absent when the author chose no tag. */
  reaction?: string;
  /**
   * `attachments`, projected to exactly what a row stores: type, name, path.
   * A signed `url` is never sealed — it expires, and re-signing needs the path.
   */
  attachments?: { type: string; name: string; path?: string }[];
  /** `emotion_flow`, already filtered for the record's visibility. */
  emotionFlow?: unknown[];
  /** `record_time`, `HH:mm`. */
  time?: string;
};

export class RecordContentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'RecordContentError';
  }
}

function fail(code: string, message: string): never {
  throw new RecordContentError(code, message);
}

/**
 * The routing rule, in one place.
 *
 * A private record uses the owner's personal domain (PMK); a shared record uses
 * the couple domain (CSK). `health` is not reachable from here at all: HRK must
 * never stand in for PMK or CSK, and the way to guarantee that is for this
 * function to be unable to return it. The database refuses the same pairing
 * independently (032's R7 and 039), so a client bug cannot produce a row whose
 * visibility and key disagree.
 */
export function domainForRecord(isPrivate: boolean): Extract<KeyDomainName, 'personal' | 'couple'> {
  return isPrivate ? 'personal' : 'couple';
}

/** The scope a record's key belongs to: the author for PMK, the couple for CSK. */
export function scopeIdForRecord(
  isPrivate: boolean,
  ownerUserId: string,
  coupleId: string,
): string {
  return isPrivate ? ownerUserId : coupleId;
}

/**
 * Serialize the document to bytes.
 *
 * JSON with sorted keys. Canonical ordering is not for security — the AAD and the
 * GCM tag already authenticate every byte — but it keeps the ciphertext length a
 * function of the content rather than of object-literal ordering, which makes a
 * length change mean something when reviewing a diff or a migration.
 *
 * Absent fields are OMITTED rather than serialized as null, so a record with no
 * reaction and no attachments produces a shorter document than one that has
 * them, and `undefined` round-trips as absent.
 */
export function encodeRecordDocument(document: RecordContentDocument): Uint8Array {
  const ordered: Record<string, unknown> = { v: RECORD_DOCUMENT_VERSION };
  if (document.attachments !== undefined) ordered.attachments = document.attachments;
  if (document.emotionFlow !== undefined) ordered.emotionFlow = document.emotionFlow;
  ordered.log = document.log;
  if (document.reaction !== undefined) ordered.reaction = document.reaction;
  if (document.time !== undefined) ordered.time = document.time;
  return utf8(JSON.stringify(ordered));
}

export function decodeRecordDocument(bytes: Uint8Array): RecordContentDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail('E_DOCUMENT_MALFORMED', 'record content document is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('E_DOCUMENT_MALFORMED', 'record content document must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== RECORD_DOCUMENT_VERSION) {
    // Loud, not lossy. A newer document may carry a field this build would drop
    // on the next save, which would destroy user content silently.
    fail('E_DOCUMENT_VERSION', `unsupported record document version ${String(record.v)}`);
  }
  if (typeof record.log !== 'string') fail('E_DOCUMENT_MALFORMED', 'log must be a string');

  const document: RecordContentDocument = { log: record.log };
  if (typeof record.reaction === 'string') document.reaction = record.reaction;
  if (Array.isArray(record.attachments)) {
    document.attachments = record.attachments.filter(
      (item): item is { type: string; name: string; path?: string } =>
        !!item && typeof item === 'object' && !Array.isArray(item),
    );
  }
  if (Array.isArray(record.emotionFlow)) document.emotionFlow = record.emotionFlow;
  if (typeof record.time === 'string') document.time = record.time;
  return document;
}

export type RecordAadInput = {
  isPrivate: boolean;
  /** The record's own id — the opaque context id other objects reference. */
  recordId: string;
  ownerUserId: string;
  coupleId: string;
  keyEpoch: bigint;
  /** Server-validated monotonic counter. 1 for a new record. */
  contentRevision: bigint;
};

/**
 * Build the GLE1 associated data for a record.
 *
 * The scope id follows the domain: for a private record the scope is the owner,
 * for a shared one it is the couple. Getting that wrong would let a ciphertext
 * authenticate under the wrong scope, so it is derived here from `isPrivate`
 * rather than passed in.
 */
export function recordAad(input: RecordAadInput): Gle1Aad {
  const domain: KeyDomainCode = input.isPrivate ? KEY_DOMAIN.personal : KEY_DOMAIN.couple;
  return {
    domain,
    keyEpoch: input.keyEpoch,
    ownerUserId: uuidToBytes(input.ownerUserId),
    scopeId: uuidToBytes(scopeIdForRecord(input.isPrivate, input.ownerUserId, input.coupleId)),
    objectType: OBJECT_TYPE.dailyRecord,
    objectId: uuidToBytes(input.recordId),
    fieldId: FIELD_ID.logText,
    contentRevision: input.contentRevision,
  };
}

export type SealRecordInput = RecordAadInput & {
  /** The routed scope key: PMK for a private record, CSK for a shared one. */
  scopeKey: CryptoKey;
  document: RecordContentDocument;
};

/** Seal a record's content document into one GLE1 envelope. */
export async function sealRecordContent(input: SealRecordInput): Promise<Uint8Array> {
  return sealContent({
    scopeKey: input.scopeKey,
    plaintext: encodeRecordDocument(input.document),
    aad: recordAad(input),
  });
}

export type OpenRecordInput = RecordAadInput & {
  scopeKey: CryptoKey;
  envelope: Uint8Array;
};

/**
 * Open a record's envelope.
 *
 * Any authentication failure surfaces as a `Gle1Error`, which callers translate
 * into "this record cannot be shown" rather than into an empty record. A record
 * that silently decrypts to nothing is indistinguishable from one the user
 * cleared, and that difference matters to someone reading their own diary.
 */
export async function openRecordContent(input: OpenRecordInput): Promise<RecordContentDocument> {
  const plaintext = await openContent({
    scopeKey: input.scopeKey,
    envelope: input.envelope,
    aad: recordAad(input),
  });
  return decodeRecordDocument(plaintext);
}

export { Gle1Error };
