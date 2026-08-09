import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { emotionFlowForStorage } from '@/lib/privacy';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';
import { DailyRecord, Attachment } from '@/types';

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
    console.error('[gomsinlog] Failed to sign media URLs:', error);
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
    console.error('Failed to fetch records:', error);
    return { ok: false, records: [], error };
  }

  const records: DailyRecord[] = (data || []).map((row: any) => ({
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
    ...(row.talk_about === true ? { talkAbout: true } : {}),
    emotionFlow: row.emotion_flow || [],
    emotionUpdatedAt: row.emotion_updated_at || null,
    createdAt: row.created_at,
    userId: row.user_id,
  }));

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
 * Outcome of a record write or delete.
 *
 * Deliberately not a boolean. `false` threw away the only information the user
 * actually needed: an RLS rejection, an expired session and a dead network all
 * collapsed into one value, so every call site had to guess -- and guessed
 * "check your internet connection". The reason is classified once, here, and
 * carried all the way to the toast.
 */
export type RecordWriteResult =
  | { ok: true }
  | { ok: false; reason: ServerErrorKind };

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
): Promise<RecordWriteResult> {
  if (!isSupabaseConfigured || !supabase || !coupleId || !userId) {
    return { ok: false, reason: unconfiguredReason() };
  }

  const { error } = await supabase
    .from('daily_records')
    .upsert({
      id: record.id,
      user_id: userId,
      couple_id: coupleId,
      record_date: record.date,
      record_time: record.time,
      log_text: record.log,
      reaction: record.reaction || null,
      // Never persist the signed URL: it expires, and `path` is the durable
      // reference we re-sign on every read.
      attachments: (record.attachments || [])
        .map((attachment) =>
          mapAuthenticatedAttachment(attachment, coupleId, record.id, false),
        )
        .filter((attachment: Attachment | null): attachment is Attachment => !!attachment)
        .map(({ type, name, path }) => ({ type, name, path })),
      is_private: record.isPrivate,
      talk_about: !record.isPrivate && record.talkAbout === true,
      // Author-only emotion items must not travel inside a shared row, because
      // the partner is allowed to read that row.
      emotion_flow: emotionFlowForStorage(record),
      emotion_updated_at: record.emotionUpdatedAt || null,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error('Failed to save record:', error);
    return { ok: false, reason: classifyServerError(error).kind };
  }
  return { ok: true };
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
    console.error('Failed to delete record:', error);
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
  video: 100 * 1024 * 1024,
  voice: 20 * 1024 * 1024,
};

export const MEDIA_ACCEPT = Object.keys(MIME_MAP).join(',');

export type MediaKind = Attachment['type'];

export function classifyMediaFile(
  file: { type: string; size: number },
): { ext: string; type: MediaKind } | { error: string } {
  // Some Android browsers report an empty MIME type; fall back to rejecting
  // rather than guessing, so we never upload an unclassifiable blob.
  const match = MIME_MAP[file.type?.toLowerCase?.() ?? ''];
  if (!match) {
    return { error: '지원하지 않는 파일 형식이에요. 사진, 영상 또는 음성 파일을 선택해 주세요.' };
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

export function buildMediaPath(coupleId: string, recordId: string, ext: string): string {
  // Must stay in sync with the storage RLS policies:
  // foldername[1] = coupleId, foldername[2] = recordId (migration 007).
  return `${coupleId}/${recordId}/${crypto.randomUUID()}.${ext}`;
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
): Promise<{ attachment: Attachment } | { error: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { error: '서버에 연결되지 않아 파일을 올릴 수 없어요.' };
  }
  if (!coupleId || !recordId) {
    return { error: '커플 공간이 연결된 뒤에 파일을 올릴 수 있어요.' };
  }

  const classified = classifyMediaFile(file);
  if ('error' in classified) return classified;

  const path = buildMediaPath(coupleId, recordId, classified.ext);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    console.error('[gomsinlog] Media upload failed:', error);
    // Classified from the real Storage error. This used to hard-code
    // "연결 상태를 확인하고" while holding the actual cause, so an RLS rejection,
    // a 413 and an expired JWT all told the user to check a working connection.
    return { error: `파일을 올리지 못했어요. ${classifyServerError(error).message}` };
  }

  return {
    attachment: {
      type: classified.type,
      name: displayName || file.name || `${classified.type}.${classified.ext}`,
      path,
    },
  };
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
