import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { DailyRecord, Role, Attachment } from '@/types';

// ==========================================
// Records Synchronization
// ==========================================

export async function fetchRecordsFromDB(coupleId: string): Promise<DailyRecord[]> {
  if (!isSupabaseConfigured || !supabase || !coupleId) return [];

  const { data, error } = await supabase
    .from('daily_records')
    .select('*')
    .eq('couple_id', coupleId)
    .order('record_date', { ascending: false })
    .order('record_time', { ascending: false });

  if (error) {
    console.error('Failed to fetch records:', error);
    return [];
  }

  // Normalise rows first, migrating any legacy rows that stored the storage path
  // in `url` instead of `path`.
  const records: DailyRecord[] = data.map((row: any) => {
    const attachments: Attachment[] = (row.attachments || []).map((att: Attachment) => {
      if (!att.path && att.url && !att.url.startsWith('http')) {
        return { ...att, path: att.url, url: undefined };
      }
      return att;
    });

    return {
      id: row.id,
      date: row.record_date,
      time: row.record_time,
      authorRole: 'gomsin', // recomputed from user_id in sync.ts
      log: row.log_text,
      reaction: row.reaction,
      attachments,
      isPrivate: row.is_private,
      emotionFlow: row.emotion_flow || [],
      emotionUpdatedAt: row.emotion_updated_at || null,
      createdAt: row.created_at,
      userId: row.user_id,
    };
  });

  // Sign every attachment across all records in one request instead of one
  // network round trip per file.
  const allAttachments = records.flatMap((record) => record.attachments || []);
  if (allAttachments.length === 0) return records;

  const signed = await resolveAttachmentUrls(allAttachments);
  const urlByPath = new Map<string, string>();
  signed.forEach((att) => {
    if (att.path && att.url) urlByPath.set(att.path, att.url);
  });

  return records.map((record) => ({
    ...record,
    attachments: record.attachments?.map((att) =>
      att.path && urlByPath.has(att.path) ? { ...att, url: urlByPath.get(att.path) } : att,
    ),
  }));
}

export async function saveRecordToDB(record: DailyRecord, coupleId: string, userId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !coupleId || !userId) return false;

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
      attachments: record.attachments || [],
      is_private: record.isPrivate,
      emotion_flow: record.emotionFlow || [],
      emotion_updated_at: record.emotionUpdatedAt || null,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error('Failed to save record:', error);
    return false;
  }
  return true;
}

export async function deleteRecordFromDB(recordId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;

  const { error } = await supabase
    .from('daily_records')
    .delete()
    .eq('id', recordId);

  if (error) {
    console.error('Failed to delete record:', error);
    return false;
  }
  return true;
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
    return { error: '파일을 올리지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.' };
  }

  return {
    attachment: {
      type: classified.type,
      name: displayName || file.name || `${classified.type}.${classified.ext}`,
      path,
    },
  };
}

/** Remove uploaded objects, used to clean up after a partially failed post. */
export async function removeRecordMedia(paths: string[]): Promise<void> {
  if (!isSupabaseConfigured || !supabase || paths.length === 0) return;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
  if (error) console.error('[gomsinlog] Failed to clean up media objects:', error);
}

/**
 * Turn storage paths into temporary view URLs.
 *
 * Signing happens with the caller's own token, so the storage SELECT policy
 * decides what may be viewed: the author sees their own files, the partner sees
 * only files attached to shared (non-private) records.
 */
export async function resolveAttachmentUrls(attachments: Attachment[]): Promise<Attachment[]> {
  if (!isSupabaseConfigured || !supabase || attachments.length === 0) return attachments;

  const needsSigning = attachments.filter(
    (att) => att.path && !att.path.startsWith('http'),
  );
  if (needsSigning.length === 0) return attachments;

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(needsSigning.map((att) => att.path as string), SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error('[gomsinlog] Failed to sign media URLs:', error);
    return attachments;
  }

  const byPath = new Map<string, string>();
  (data || []).forEach((entry) => {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  });

  return attachments.map((att) =>
    att.path && byPath.has(att.path) ? { ...att, url: byPath.get(att.path) } : att,
  );
}
