import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { DailyRecord, Attachment } from '@/types';

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

  // Convert DB row to DailyRecord
  return Promise.all(data.map(async (row: any) => {
    let attachments: Attachment[] = row.attachments || [];
    
    // Resolve paths to signed URLs
    attachments = await Promise.all(attachments.map(async (att) => {
      if (att.path && !att.url?.startsWith('http')) {
        const signedUrl = await getMediaUrl(att.path);
        return { ...att, url: signedUrl || att.url };
      }
      if (att.url && !att.url.startsWith('http') && !att.path) {
        // Fallback if older data stored path in url
        const signedUrl = await getMediaUrl(att.url);
        return { ...att, path: att.url, url: signedUrl || att.url };
      }
      return att;
    }));

    return {
      id: row.id,
      date: row.record_date,
      time: row.record_time,
      authorRole: 'gomsin', // this will be updated in store
      log: row.log_text,
      reaction: row.reaction,
      attachments,
      isPrivate: row.is_private,
      emotionFlow: row.emotion_flow || [],
      emotionUpdatedAt: row.emotion_updated_at || null,
      createdAt: row.created_at,
      userId: row.user_id,
    };
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

export async function deleteRecordFromDB(recordId: string, coupleId?: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;

  // Storage DELETE 정책이 레코드 행 존재를 요구하므로 미디어를 먼저 정리합니다.
  if (coupleId) await deleteRecordMedia(coupleId, recordId);

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
// Media (Supabase Storage: couple-media)
// ==========================================

/** 허용 MIME 화이트리스트. 확장자와 첨부 종류를 함께 정의합니다. */
const ALLOWED_MEDIA: Record<string, { ext: string; type: Attachment['type'] }> = {
  'image/jpeg': { ext: 'jpg', type: 'photo' },
  'image/png': { ext: 'png', type: 'photo' },
  'image/webp': { ext: 'webp', type: 'photo' },
  'image/heic': { ext: 'heic', type: 'photo' },
  'image/gif': { ext: 'gif', type: 'photo' },
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/quicktime': { ext: 'mov', type: 'video' },
  'video/webm': { ext: 'webm', type: 'video' },
  'audio/mp4': { ext: 'm4a', type: 'voice' },
  'audio/mpeg': { ext: 'mp3', type: 'voice' },
  'audio/webm': { ext: 'webm', type: 'voice' },
  'audio/wav': { ext: 'wav', type: 'voice' },
};

/** 업로드 최대 크기 (25MB) */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export function isSupportedMedia(file: File): boolean {
  return !!ALLOWED_MEDIA[file.type];
}

export function attachmentTypeFromFile(file: File): Attachment['type'] {
  return ALLOWED_MEDIA[file.type]?.type
    || (file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'voice' : 'photo');
}

/**
 * 데모/오프라인 모드에서 사용하는 로컬 미리보기 첨부.
 * 서버에 올라가지 않고 브라우저 세션 안에서만 유효합니다.
 */
export function createLocalAttachment(file: File): Attachment {
  return {
    type: attachmentTypeFromFile(file),
    name: file.name,
    url: URL.createObjectURL(file),
  };
}

export async function uploadMedia(file: File, coupleId: string, recordId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !coupleId || !recordId) return null;

  const meta = ALLOWED_MEDIA[file.type];
  if (!meta) {
    console.error('Unsupported MIME type:', file.type);
    return null;
  }
  if (file.size > MAX_MEDIA_BYTES) {
    console.error('File too large:', file.size);
    return null;
  }

  const attachmentId = crypto.randomUUID();
  const path = `${coupleId}/${recordId}/${attachmentId}.${meta.ext}`;

  const { error } = await supabase.storage.from('couple-media').upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    console.error('Upload error:', error);
    return null;
  }
  return path;
}

/**
 * 파일 하나를 업로드하고 화면에 바로 렌더링할 수 있는 Attachment를 만듭니다.
 * Storage RLS(007_storage_policies)가 `daily_records` 행 존재를 요구하므로
 * 반드시 레코드가 먼저 저장된 뒤에 호출해야 합니다.
 */
export async function uploadRecordAttachment(
  file: File,
  coupleId: string,
  recordId: string,
): Promise<Attachment | null> {
  const path = await uploadMedia(file, coupleId, recordId);
  if (!path) return null;

  // 방금 올린 파일은 Signed URL이 준비되기 전에도 로컬 미리보기로 즉시 보여줍니다.
  const signedUrl = await getMediaUrl(path);

  return {
    type: attachmentTypeFromFile(file),
    name: file.name,
    path,
    url: signedUrl || URL.createObjectURL(file),
  };
}

/**
 * 레코드에 속한 미디어 전체 삭제. (레코드 행 삭제 전에 호출해야 RLS를 통과합니다)
 */
export async function deleteRecordMedia(coupleId: string, recordId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !coupleId || !recordId) return;

  const folder = `${coupleId}/${recordId}`;
  const bucket = supabase.storage.from('couple-media');
  const pageSize = 100;

  // 페이지네이션: 한 페이지(100개)만 지우면 나머지가 고아 객체로 남습니다.
  // 삭제 후에는 목록이 줄어들므로 항상 첫 페이지를 다시 조회합니다.
  for (;;) {
    const { data: files, error } = await bucket.list(folder, {
      limit: pageSize,
      offset: 0,
    });
    if (error) {
      console.error('Failed to list media for deletion:', error);
      return;
    }
    if (!files?.length) return;

    const paths = files
      .filter((f) => f.name && f.name !== '.emptyFolderPlaceholder')
      .map((f) => `${folder}/${f.name}`);

    if (paths.length > 0) {
      const { error: removeError } = await bucket.remove(paths);
      if (removeError) {
        console.error('Failed to remove media:', removeError);
        return;
      }
    }

    if (files.length < pageSize) return;
    // 삭제했으므로 offset을 증가시키지 않고 같은 위치를 다시 조회합니다.
  }
}

/**
 * 특정 첨부 객체들만 삭제합니다. (첨부 반영 실패 시 롤백용)
 * 반환값은 삭제 요청에 성공한 객체 수입니다.
 */
export async function deleteAttachmentObjects(attachments: Attachment[]): Promise<number> {
  if (!isSupabaseConfigured || !supabase) return 0;

  const paths = attachments
    .map((a) => a.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (paths.length === 0) return 0;

  const { error } = await supabase.storage.from('couple-media').remove(paths);
  if (error) {
    console.error('Failed to roll back uploaded media:', error);
    return 0;
  }
  return paths.length;
}

export async function getMediaUrl(path: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  
  // If it's an external URL (e.g. unsplash demo), return as is
  if (path.startsWith('http')) return path;
  
  // 클라이언트에서 직접 Signed URL을 만들지 않고 Edge Function을 호출하여 권한을 검증합니다.
  const { data, error } = await supabase.functions.invoke('create-media-signed-url', {
    body: { path }
  });
  if (error) {
    console.error('Signed URL error:', error);
    return null;
  }
  return data?.signedUrl || null;
}
