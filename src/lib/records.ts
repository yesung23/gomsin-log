import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { emotionFlowForStorage } from '@/lib/privacy';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';
import { sanitizePhotoForUpload } from '@/lib/imageSanitization';
import {
  RECORD_CIPHER_GLE1,
  RECORD_CIPHER_PLAINTEXT,
  decideRecordWrite,
  decryptRecordRow,
  encryptRecordForWrite,
  type RecordCryptoEnvironment,
} from '@/app/records/contentCrypto';
import { fromBase64 } from '@/crypto/bytes';
import { DailyRecord, Attachment } from '@/types';

// ==========================================
// E2EE routing (P5)
// ==========================================

/**
 * The crypto environment, or null when this build/device has none.
 *
 * Injected rather than imported so that `records.ts` has no opinion about where
 * keys come from, and so every branch below is reachable in a test. Null means
 * "no E2EE on this client": records are written plaintext exactly as before,
 * which is the current state of every account until a floor is activated. P5
 * does not install this environment; Device Bootstrap must do that in a later
 * phase after the device holds verified scope-key envelopes.
 *
 * It is deliberately NOT a fallback for failure. Once a scope has a write floor
 * the environment's own refusal is final: `saveRecordToDB` returns the refusal
 * rather than writing plaintext.
 */
let recordCryptoEnvironment: RecordCryptoEnvironment | null = null;

export function setRecordCryptoEnvironment(environment: RecordCryptoEnvironment | null): void {
  recordCryptoEnvironment = environment;
}

export function getRecordCryptoEnvironment(): RecordCryptoEnvironment | null {
  return recordCryptoEnvironment;
}

/**
 * How a refusal to encrypt is reported.
 *
 * Mapped to `server` rather than to a retryable kind: the request was never
 * sent, and retrying the identical write cannot succeed until the device holds
 * the key. Reporting it as `offline` would put it in the outbox to be retried
 * forever against a cause the network cannot fix.
 */
export function encryptionRefusalReason(): ServerErrorKind {
  return 'server';
}

/**
 * The caller must say whether this is an insert or an edit.  Inferring that
 * from ciphertext shape is unsafe: a lost response can replay an insert with
 * the same id, and an encrypted legacy transition has a real server revision
 * that is not necessarily 1.
 */
export type RecordWriteIntent =
  | { kind: 'create' }
  | { kind: 'update'; expectedRevision: number };

/** The five protected fields, as the sealed document carries them. */
function documentForRecord(record: DailyRecord, coupleId: string) {
  return {
    log: record.log ?? '',
    ...(record.reaction ? { reaction: record.reaction } : {}),
    attachments: (record.attachments || [])
      .map((attachment) => mapAuthenticatedAttachment(attachment, coupleId, record.id, false))
      .filter((attachment): attachment is Attachment => !!attachment)
      .map(({ type, name, path }) => ({ type, name, path })),
    ...(record.emotionFlow ? { emotionFlow: emotionFlowForStorage(record) } : {}),
    ...(record.time ? { time: record.time } : {}),
  };
}

/**
 * `bytea` wants hex, and PostgREST passes a `\x…` string straight through.
 *
 * Base64 was the alternative and is worse here: `bytea` has no base64 input
 * syntax, so it would need a server-side `decode()` call inside the insert, which
 * means constructing SQL. Hex keeps the value an ordinary bound parameter.
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(text: string): Uint8Array {
  const body = text.startsWith('\\x') ? text.slice(2) : text;
  if (body.length % 2 !== 0) throw new Error('bytea hex payload has an odd length');
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Read a `content_envelope` value from a row.
 *
 * PostgREST renders `bytea` as a `\x…` hex string; a Uint8Array or base64 string
 * can arrive from a test double or a future transport change. All three are
 * accepted, and anything else is `null` rather than a guess — a mis-decoded
 * envelope would surface as an authentication failure and look like corruption.
 */
function readEnvelope(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return value.startsWith('\\x') ? hexToBytes(value) : fromBase64(value);
  } catch {
    return null;
  }
}

/** The plaintext content columns, for a scope with no write floor. */
function plaintextContentColumns(record: DailyRecord, coupleId: string) {
  return {
    record_time: record.time,
    log_text: record.log,
    reaction: record.reaction || null,
    // Never persist the signed URL: it expires, and `path` is the durable
    // reference we re-sign on every read.
    attachments: (record.attachments || [])
      .map((attachment) => mapAuthenticatedAttachment(attachment, coupleId, record.id, false))
      .filter((attachment: Attachment | null): attachment is Attachment => !!attachment)
      .map(({ type, name, path }) => ({ type, name, path })),
    // Author-only emotion items must not travel inside a shared row, because the
    // partner is allowed to read that row.
    emotion_flow: emotionFlowForStorage(record),
  };
}

// ==========================================
// Records Synchronization
// ==========================================

export type RecordsFetchResult =
  /**
   * `mediaUnavailable` is set when the records loaded but their media could not
   * be signed. It is deliberately NOT a failure: the diary text is readable and
   * throwing it away would be a worse outcome than un-openable media. It exists
   * so the caller cannot mistake the result for "everything is fine", which is
   * what a bare `{ ok: true }` used to claim while handing back attachments with
   * no `url` and no explanation.
   */
  | { ok: true; records: DailyRecord[]; mediaUnavailable?: ServerErrorKind }
  | { ok: false; records: []; error: unknown };

const ATTACHMENT_TYPES: ReadonlySet<Attachment['type']> = new Set([
  'photo',
  'video',
  'voice',
]);

/**
 * Storage objects created by this app always live at exactly
 * `{coupleId}/{recordId}/{filename}`. Treat attachment JSON from Postgres as
 * untrusted and reject anything outside that namespace before it is signed.
 */
export function isCanonicalRecordMediaPath(
  path: unknown,
  coupleId: string,
  recordId: string,
): path is string {
  if (typeof path !== 'string' || !coupleId || !recordId) return false;
  const parts = path.split('/');
  if (parts.length !== 3 || parts[0] !== coupleId || parts[1] !== recordId) return false;
  const filename = parts[2];
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)
    && path === `${coupleId}/${recordId}/${filename}`;
}

function mapAuthenticatedAttachment(
  value: unknown,
  coupleId: string,
  recordId: string,
  allowLegacyPathInUrl: boolean,
): Attachment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!ATTACHMENT_TYPES.has(candidate.type as Attachment['type'])) return null;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null;

  const path = isCanonicalRecordMediaPath(candidate.path, coupleId, recordId)
    ? candidate.path
    : allowLegacyPathInUrl && isCanonicalRecordMediaPath(candidate.url, coupleId, recordId)
      ? candidate.url
      : null;
  if (!path) return null;

  // Never trust or retain a URL supplied by a database row. A fresh URL is
  // generated below only after the canonical path has passed validation.
  return {
    type: candidate.type as Attachment['type'],
    name: candidate.name,
    path,
  };
}

/**
 * Sign a validated attachment list.
 *
 * A signing failure used to return the attachments bare and say nothing, so the
 * caller could not tell "no URL because signing failed" from "no URL yet". Every
 * attachment whose URL could not be produced now carries the classified reason
 * in `urlUnavailable`, which is what lets a surface explain itself. The record
 * itself is still returned: a signing failure must not escalate into data loss.
 */
async function signValidatedAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  if (!isSupabaseConfigured || !supabase || attachments.length === 0) return attachments;

  const paths = Array.from(new Set(
    attachments.map((attachment) => attachment.path).filter((path): path is string => !!path),
  ));
  if (paths.length === 0) return attachments;

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error('[gomsinlog] Failed to sign media URLs.');
    const reason = classifyServerError(error).kind;
    return attachments.map((attachment) => ({ ...attachment, url: undefined, urlUnavailable: reason }));
  }

  const byPath = new Map<string, string>();
  (data || []).forEach((entry) => {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  });

  return attachments.map((attachment) => {
    if (attachment.path && byPath.has(attachment.path)) {
      return { ...attachment, url: byPath.get(attachment.path), urlUnavailable: undefined };
    }
    // Signing was attempted for this path and the batch came back without it,
    // e.g. the storage SELECT policy withheld that single object.
    if (attachment.path) {
      return { ...attachment, url: undefined, urlUnavailable: 'forbidden' as ServerErrorKind };
    }
    return attachment;
  });
}

export async function fetchRecordsResultFromDB(coupleId: string): Promise<RecordsFetchResult> {
  if (!isSupabaseConfigured || !supabase || !coupleId) {
    return { ok: false, records: [], error: new Error('Records database is unavailable') };
  }

  const { data, error } = await supabase
    .from('daily_records')
    .select('*')
    .eq('couple_id', coupleId)
    .order('record_date', { ascending: false })
    .order('record_time', { ascending: false });

  if (error) {
    console.error('[gomsinlog] Failed to fetch records.');
    return { ok: false, records: [], error };
  }

  const records: DailyRecord[] = await Promise.all(
    (data || []).map((row: any) => mapRow(row, coupleId)),
  );

  const allAttachments = records.flatMap((record) => record.attachments || []);
  if (allAttachments.length === 0) return { ok: true, records };

  const signed = await signValidatedAttachments(allAttachments);
  const signedByPath = new Map<string, Attachment>();
  signed.forEach((attachment) => {
    if (attachment.path) signedByPath.set(attachment.path, attachment);
  });

  /**
   * The records themselves loaded, so this stays `ok: true` -- a media-signing
   * failure must not be converted into total data loss for a readable diary
   * entry. What it must NOT do is stay silent: `mediaUnavailable` names the
   * classified cause so a surface can tell the user why the media will not open,
   * and each affected attachment carries the same reason.
   */
  const withUrls = records.map((record) => ({
    ...record,
    attachments: record.attachments?.map((attachment) =>
      attachment.path && signedByPath.has(attachment.path)
        ? signedByPath.get(attachment.path)!
        : attachment,
    ),
  }));

  const mediaUnavailable = withUrls
    .flatMap((record) => record.attachments || [])
    .find((attachment) => !!attachment.urlUnavailable)?.urlUnavailable;

  return mediaUnavailable
    ? { ok: true, records: withUrls, mediaUnavailable }
    : { ok: true, records: withUrls };
}

export async function fetchRecordsFromDB(coupleId: string): Promise<DailyRecord[]> {
  const result = await fetchRecordsResultFromDB(coupleId);
  return result.ok ? result.records : [];
}

/**
 * Turn one row into a `DailyRecord`, decrypting it when it is encrypted.
 *
 * `cipher_format` decides, by column value. Nothing here inspects whether a
 * string happens to look like base64 — that inference is what invariant 12
 * forbids, and it is how mixed-version clients corrupt each other's data.
 *
 * A row that cannot be opened is returned as `contentUnavailable` rather than as
 * an empty record. An empty record is indistinguishable from one the author
 * cleared, and showing a blank page where a diary entry should be is the worst
 * available outcome.
 */
async function mapRow(row: any, coupleId: string): Promise<DailyRecord> {
  const contentRevision = Number(row.content_revision ?? 1);
  const base: DailyRecord = {
    id: row.id,
    date: row.record_date,
    time: row.record_time,
    authorRole: 'gomsin', // recomputed from user_id in sync.ts
    log: row.log_text,
    reaction: row.reaction,
    attachments: Array.isArray(row.attachments)
      ? row.attachments
          .map((attachment: unknown) =>
            mapAuthenticatedAttachment(attachment, coupleId, row.id, true),
          )
          .filter((attachment: Attachment | null): attachment is Attachment => !!attachment)
      : [],
    isPrivate: row.is_private,
    ...(row.is_profile_post === true ? { isProfilePost: true } : {}),
    ...(row.talk_about === true ? { talkAbout: true } : {}),
    emotionFlow: row.emotion_flow || [],
    emotionUpdatedAt: row.emotion_updated_at || null,
    createdAt: row.created_at,
    userId: row.user_id,
    // Migration 032 assigns a revision to legacy plaintext rows too. Keeping
    // it on every mapped row is what makes a later plaintext -> ciphertext
    // transition use the actual OLD + 1 rather than guessing revision 1.
    contentRevision: Number.isSafeInteger(contentRevision) && contentRevision >= 1
      ? contentRevision
      : 1,
  };

  const cipherFormat = typeof row.cipher_format === 'number' ? row.cipher_format : RECORD_CIPHER_PLAINTEXT;
  if (cipherFormat === RECORD_CIPHER_PLAINTEXT) return base;

  // Carry the revision so an edit can present `OLD + 1`, which 032's R6 requires.
  const withRouting: DailyRecord = { ...base, contentRevision };

  if (cipherFormat !== RECORD_CIPHER_GLE1) {
    // A format this build does not implement. Refusing to render is correct:
    // guessing at the bytes is how content gets destroyed on the next save.
    return { ...withRouting, log: '', contentUnavailable: 'undecryptable' };
  }

  const environment = recordCryptoEnvironment;
  const envelope = readEnvelope(row.content_envelope);
  if (!environment || !envelope) {
    return { ...withRouting, log: '', contentUnavailable: 'key_unavailable' };
  }

  const opened = await decryptRecordRow(environment, {
    recordId: row.id,
    isPrivate: row.is_private,
    ownerUserId: row.user_id,
    coupleId,
    keyDomain: row.key_domain,
    keyEpoch: BigInt(row.key_epoch ?? 0),
    contentRevision: BigInt(contentRevision),
    envelope,
  });

  if (!opened.ok) return { ...withRouting, log: '', contentUnavailable: opened.reason };

  const { document } = opened;
  return {
    ...withRouting,
    log: document.log,
    ...(document.reaction ? { reaction: document.reaction as DailyRecord['reaction'] } : {}),
    time: document.time ?? base.time,
    attachments: (document.attachments || [])
      .map((attachment) => mapAuthenticatedAttachment(attachment, coupleId, row.id, false))
      .filter((attachment: Attachment | null): attachment is Attachment => !!attachment),
    emotionFlow: (document.emotionFlow || []) as DailyRecord['emotionFlow'],
  };
}

/**
 * Outcome of a record write or delete.
 *
 * Deliberately not a boolean. `false` threw away the only information the user
 * actually needed: an RLS rejection, an expired session and a dead network all
 * collapsed into one value, so every call site had to guess -- and guessed
 * "check your internet connection". The reason is classified once, here, and
 * carried all the way to the toast.
 */
export type RecordWriteResult =
  | { ok: true; contentRevision?: number }
  | { ok: false; reason: ServerErrorKind };

export type RecordSaveResult =
  | { ok: true; contentRevision: number }
  | {
      ok: false;
      reason: ServerErrorKind;
      /** The request was blocked locally because the device lacks a required key. */
      protectionRequired?: boolean;
    };

/** Reason to use when the client is not configured to reach a server at all. */
function unconfiguredReason(): ServerErrorKind {
  return classifyServerError(new Error('Records database is unavailable')).kind === 'offline'
    ? 'offline'
    : 'server';
}

export async function saveRecordToDB(
  record: DailyRecord,
  coupleId: string,
  userId: string,
  intent: RecordWriteIntent = { kind: 'create' },
): Promise<RecordSaveResult> {
  if (!isSupabaseConfigured || !supabase || !coupleId || !userId) {
    return { ok: false, reason: unconfiguredReason() };
  }

  /**
   * Metadata the server keeps in the clear either way.
   *
   * `record_date` is accepted leakage (ordering), `talk_about` is bilateral
   * coordination metadata, `is_profile_post` is the author's explicit profile
   * publication intent, and `emotion_updated_at` is a timestamp. The marker carries
   * no text or media and remains subject to the row's existing private/shared RLS.
   * Omit the new column unless the caller explicitly carries the marker: ordinary
   * records must remain writable while a DB-first rollout is still in progress.
   */
  const metadata = {
    id: record.id,
    user_id: userId,
    couple_id: coupleId,
    record_date: record.date,
    is_private: record.isPrivate,
    ...(record.isProfilePost !== undefined
      ? { is_profile_post: record.isProfilePost }
      : {}),
    talk_about: !record.isPrivate && record.talkAbout === true,
    emotion_updated_at: record.emotionUpdatedAt || null,
    updated_at: new Date().toISOString(),
  };

  const environment = recordCryptoEnvironment;
  let payload: Record<string, unknown>;
  const contentRevision = intent.kind === 'create'
    ? 1n
    : Number.isSafeInteger(intent.expectedRevision) && intent.expectedRevision >= 1
      ? BigInt(intent.expectedRevision) + 1n
      : null;

  if (contentRevision === null) {
    return { ok: false, reason: 'server' };
  }

  if (!environment) {
    payload = { ...metadata, ...plaintextContentColumns(record, coupleId) };
  } else {
    const plan = await decideRecordWrite(environment, {
      isPrivate: record.isPrivate,
      ownerUserId: userId,
      coupleId,
    });

    if (plan.mode === 'refused') {
      // No plaintext fallback, ever. The scope is past its write floor, so
      // sending this in the clear is the exact downgrade the floor prevents --
      // and the database would refuse it anyway. Fail closed and say why.
      console.error('[gomsinlog] Refusing to write a record unencrypted:', plan.reason);
      return { ok: false, reason: encryptionRefusalReason(), protectionRequired: true };
    }

    if (plan.mode === 'plaintext') {
      payload = { ...metadata, ...plaintextContentColumns(record, coupleId) };
    } else {
      const columns = await encryptRecordForWrite({
        plan,
        routing: { isPrivate: record.isPrivate, ownerUserId: userId, coupleId },
        recordId: record.id,
        // R6 binds this exact value into GLE1 and the database accepts only
        // INSERT=1 or UPDATE=OLD+1. The write intent above decides which one.
        contentRevision,
        document: documentForRecord(record, coupleId),
      });
      payload = {
        ...metadata,
        // Every protected column is emptied in the SAME statement that writes the
        // ciphertext. 032's R4 refuses the row otherwise, and doing it here means
        // there is no window in which both representations exist.
        log_text: '',
        reaction: null,
        attachments: [],
        emotion_flow: [],
        record_time: null,
        cipher_format: columns.cipherFormat,
        content_revision: columns.contentRevision,
        key_domain: columns.keyDomain,
        key_epoch: columns.keyEpoch,
        content_envelope: `\\x${bytesToHex(columns.contentEnvelope)}`,
      };
    }
  }

  const table = supabase.from('daily_records');
  const request = intent.kind === 'create'
    ? table.insert(payload)
    : table
        .update(payload)
        .eq('id', record.id)
        .eq('user_id', userId)
        .eq('couple_id', coupleId);

  // Before migration 032 exists there is no revision column to select. That
  // is the deliberately dormant legacy path; once a crypto environment is
  // installed, the migration chain is present and the response is mandatory.
  if (!environment) {
    const { error } = await request;
    if (error) {
      console.error('[gomsinlog] Failed to save record.');
      return { ok: false, reason: classifyServerError(error).kind };
    }
    return { ok: true, contentRevision: record.contentRevision ?? 1 };
  }

  const { data, error } = await request
    .select('content_revision')
    .maybeSingle();

  if (error) {
    console.error('[gomsinlog] Failed to save record.');
    return { ok: false, reason: classifyServerError(error).kind };
  }
  if (!data || !Number.isSafeInteger(Number(data.content_revision))) {
    return { ok: false, reason: intent.kind === 'update' ? 'not_found' : 'server' };
  }
  return { ok: true, contentRevision: Number(data.content_revision) };
}

export async function deleteRecordFromDB(
  recordId: string,
  expectedUserId: string,
  expectedCoupleId: string,
): Promise<RecordWriteResult> {
  if (
    !isSupabaseConfigured
    || !supabase
    || !recordId
    || !expectedUserId
    || !expectedCoupleId
  ) return { ok: false, reason: unconfiguredReason() };

  const { data, error } = await supabase
    .from('daily_records')
    .delete()
    .eq('id', recordId)
    .eq('user_id', expectedUserId)
    .eq('couple_id', expectedCoupleId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[gomsinlog] Failed to delete record.');
    return { ok: false, reason: classifyServerError(error).kind };
  }
  // No matching row came back. The filters pin id + owner + couple, so this is
  // an ownership/visibility answer, not a transport failure.
  if (data?.id !== recordId) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// ==========================================
// Media attachments
// ==========================================

export const MEDIA_BUCKET = 'couple-media';
/** How long a generated view link stays valid. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * MIME allowlist. Anything not listed here is rejected before it reaches
 * Storage, which keeps arbitrary file types (e.g. scripts, archives) out of the
 * bucket even though the bucket itself is private.
 */
const MIME_MAP: Record<string, { ext: string; type: Attachment['type'] }> = {
  'image/jpeg': { ext: 'jpg', type: 'photo' },
  'image/png': { ext: 'png', type: 'photo' },
  'image/webp': { ext: 'webp', type: 'photo' },
  'image/heic': { ext: 'heic', type: 'photo' },
  'image/heif': { ext: 'heif', type: 'photo' },
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/quicktime': { ext: 'mov', type: 'video' },
  'video/webm': { ext: 'webm', type: 'video' },
  'audio/mp4': { ext: 'm4a', type: 'voice' },
  'audio/mpeg': { ext: 'mp3', type: 'voice' },
  'audio/webm': { ext: 'webm', type: 'voice' },
  'audio/ogg': { ext: 'ogg', type: 'voice' },
  'audio/wav': { ext: 'wav', type: 'voice' },
};

/** Per-kind size ceilings, chosen to stay friendly to mobile data plans. */
export const MAX_BYTES: Record<Attachment['type'], number> = {
  photo: 10 * 1024 * 1024,
  // Supabase Free projects cap a single object at 50 MB. Leave headroom for
  // proxy/accounting differences instead of accepting a file the server will
  // deterministically reject after the user waits for an upload.
  video: 45 * 1024 * 1024,
  voice: 20 * 1024 * 1024,
};

/**
 * What a NEW upload may be. Photos only.
 *
 * PRODUCT_V3 §12.3 places audio and video after the encrypted media foundation
 * (P6), and §12.4 forbids a quiet plaintext video path before Full User-Content
 * E2EE — this is that gate's option C, executed (approved 2026-08-21,
 * PRODUCT_STRATEGY_REDESIGN §1.4). The gate lives here, in the one classifier
 * every accept path crosses — pickers, the detail-edit add button, and outbox
 * replay — so no surface can offer what the app will not upload.
 *
 * EXISTING video/voice attachments still render: this constrains uploads, not
 * reads. `MIME_MAP` keeps the full vocabulary because a refused-by-policy file
 * deserves a policy message, not "unsupported format". When P6 lands, kinds are
 * re-admitted here — and only here.
 */
const UPLOADABLE_KINDS: ReadonlySet<Attachment['type']> = new Set(['photo']);

/**
 * What a policy refusal says, as opposed to what an unreadable file says.
 *
 * Exported so the gate's tests assert against this value rather than a copy of
 * the sentence: a reworded refusal should not need a test edit, but a refusal
 * that collapses into the "unsupported format" message must fail.
 */
export const MEDIA_POLICY_REFUSAL =
  '영상·음성 첨부는 암호화 보관이 준비된 뒤에 열려요. 지금은 사진만 첨부할 수 있어요.';

export const MEDIA_ACCEPT = Object.keys(MIME_MAP)
  .filter((mime) => UPLOADABLE_KINDS.has(MIME_MAP[mime].type))
  .join(',');

export type MediaKind = Attachment['type'];

export function classifyMediaFile(
  file: { type: string; size: number },
): { ext: string; type: MediaKind } | { error: string } {
  // Some Android browsers report an empty MIME type; fall back to rejecting
  // rather than guessing, so we never upload an unclassifiable blob.
  const match = MIME_MAP[file.type?.toLowerCase?.() ?? ''];
  if (!match) {
    return { error: '지원하지 않는 파일 형식이에요. 사진 파일을 선택해 주세요.' };
  }
  if (!UPLOADABLE_KINDS.has(match.type)) {
    return { error: MEDIA_POLICY_REFUSAL };
  }
  if (file.size <= 0) {
    return { error: '빈 파일은 첨부할 수 없어요.' };
  }
  if (file.size > MAX_BYTES[match.type]) {
    const limitMb = Math.round(MAX_BYTES[match.type] / (1024 * 1024));
    return { error: `파일이 너무 커요. ${limitMb}MB 이하로 올려주세요.` };
  }
  return match;
}

const MEDIA_OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidMediaObjectId(value: string): boolean {
  return MEDIA_OBJECT_ID_PATTERN.test(value);
}

export function buildMediaPath(
  coupleId: string,
  recordId: string,
  ext: string,
  stableObjectId?: string,
): string {
  // Must stay in sync with the storage RLS policies:
  // foldername[1] = coupleId, foldername[2] = recordId (migration 007).
  const objectId = stableObjectId && isValidMediaObjectId(stableObjectId)
    ? stableObjectId
    : crypto.randomUUID();
  return `${coupleId}/${recordId}/${objectId}.${ext}`;
}

function isAlreadyUploadedStableObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  const status = Number(candidate.statusCode ?? candidate.status);
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  return status === 409
    || code === 'duplicate'
    || code === 'resource_already_exists'
    || message.includes('already exists')
    || message.includes('duplicate');
}

/**
 * Upload one attachment for an already-persisted record.
 *
 * The record row must exist first: the storage INSERT policy checks that
 * `daily_records` contains a row whose id matches the second path segment and
 * whose owner is the caller.
 */
export async function uploadRecordMedia(
  file: File,
  coupleId: string,
  recordId: string,
  displayName?: string,
  stableObjectId?: string,
): Promise<{ attachment: Attachment } | { error: string; reason: ServerErrorKind }> {
  if (!isSupabaseConfigured || !supabase) {
    return { error: '서버에 연결되지 않아 파일을 올릴 수 없어요.', reason: 'server' };
  }
  if (!coupleId || !recordId) {
    return { error: '커플 공간이 연결된 뒤에 파일을 올릴 수 있어요.', reason: 'unknown' };
  }
  if (stableObjectId && !isValidMediaObjectId(stableObjectId)) {
    return {
      error: '첨부 파일 식별자가 올바르지 않아 업로드하지 않았어요.',
      reason: 'unknown',
    };
  }

  const classified = classifyMediaFile(file);
  if ('error' in classified) return { ...classified, reason: 'unknown' };

  let uploadFile = file;
  let uploadExtension = classified.ext;
  if (classified.type === 'photo') {
    const sanitized = await sanitizePhotoForUpload(file);
    if ('error' in sanitized) return { ...sanitized, reason: 'unknown' };
    uploadFile = sanitized.file;
    uploadExtension = sanitized.ext;
    if (uploadFile.size > MAX_BYTES.photo) {
      return {
        error: '사진을 변환한 뒤에도 파일이 너무 커요. 다른 사진을 선택해 주세요.',
        reason: 'unknown',
      };
    }
  }

  const path = buildMediaPath(coupleId, recordId, uploadExtension, stableObjectId);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, uploadFile, {
    contentType: uploadFile.type,
    upsert: false,
  });

  if (error && !(stableObjectId && isAlreadyUploadedStableObject(error))) {
    console.error('[gomsinlog] Media upload failed.');
    // Classified from the real Storage error. This used to hard-code
    // "연결 상태를 확인하고" while holding the actual cause, so an RLS rejection,
    // a 413 and an expired JWT all told the user to check a working connection.
    const classifiedError = classifyServerError(error);
    return {
      error: `파일을 올리지 못했어요. ${classifiedError.message}`,
      reason: classifiedError.kind,
    };
  }

  return {
    attachment: {
      type: classified.type,
      // The source basename can contain a person's name, location or date. The
      // photo sanitizer has already replaced it with a neutral filename, so use
      // that value unless the user deliberately supplied a display label.
      name: displayName?.trim() || uploadFile.name || `${classified.type}.${uploadExtension}`,
      path,
    },
  };
}

/**
 * Read an already-authorised photo so it can become an independent new post.
 *
 * A new record cannot reuse the old object's path: Storage RLS and
 * `isCanonicalRecordMediaPath` bind every object to the record id in its second
 * path segment. The caller therefore downloads through the current user's
 * Storage session and sends the returned File through `uploadRecordMedia`, which
 * re-sanitises the pixels and writes a new canonical destination path.
 */
export async function downloadRecordPhotoForReuse(
  attachment: Attachment,
  coupleId: string,
  sourceRecordId: string,
): Promise<{ file: File } | { error: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { error: '서버 설정을 확인하지 못해 기존 사진을 불러올 수 없어요.' };
  }
  if (
    attachment.type !== 'photo'
    || !attachment.name?.trim()
    || !isCanonicalRecordMediaPath(attachment.path, coupleId, sourceRecordId)
  ) {
    return { error: '기존 사진의 저장 경로를 확인하지 못했어요.' };
  }

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(attachment.path, {}, { cache: 'no-store' });
  if (error || !data) {
    const detail = error
      ? classifyServerError(error).message
      : '서버가 사진 데이터를 보내지 않았어요.';
    return { error: `기존 사진을 불러오지 못했어요. ${detail}` };
  }

  const file = new File([data], attachment.name, {
    type: data.type,
    lastModified: Date.now(),
  });
  const classified = classifyMediaFile(file);
  if ('error' in classified || classified.type !== 'photo') {
    return { error: '기존 사진을 이 기기에서 안전하게 처리하지 못했어요.' };
  }
  return { file };
}

/** Remove uploaded objects. Throws on error so callers can decide how to handle failure. */
export async function removeRecordMedia(paths: string[]): Promise<void> {
  if (!isSupabaseConfigured || !supabase || paths.length === 0) return;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
  if (error) throw new Error(`Failed to clean up media objects: ${error.message}`);
}

/**
 * Turn storage paths into temporary view URLs.
 *
 * Signing happens with the caller's own token, so the storage SELECT policy
 * decides what may be viewed: the author sees their own files, the partner sees
 * only files attached to shared (non-private) records.
 */
export async function resolveAttachmentUrls(
  attachments: Attachment[],
  coupleId: string,
  recordId: string,
): Promise<Attachment[]> {
  const validated = attachments
    .map((attachment) =>
      mapAuthenticatedAttachment(attachment, coupleId, recordId, false),
    )
    .filter((attachment: Attachment | null): attachment is Attachment => !!attachment);
  return signValidatedAttachments(validated);
}
