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

export async function uploadMedia(file: File, coupleId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !coupleId) return null;
  
  const ext = file.name.split('.').pop();
  const path = `${coupleId}/${crypto.randomUUID()}.${ext}`;
  
  const { error } = await supabase.storage.from('couple-media').upload(path, file);
  if (error) {
    console.error('Upload error:', error);
    return null;
  }
  return path;
}

export async function getMediaUrl(path: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  
  // If it's an external URL (e.g. unsplash demo), return as is
  if (path.startsWith('http')) return path;
  
  const { data, error } = await supabase.storage.from('couple-media').createSignedUrl(path, 3600);
  if (error) {
    console.error('Signed URL error:', error);
    return null;
  }
  return data?.signedUrl || null;
}

