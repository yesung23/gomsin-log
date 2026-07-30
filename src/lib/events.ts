import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { CoupleEvent } from '@/types';

export async function fetchEventsFromDB(coupleId: string): Promise<CoupleEvent[]> {
  if (!isSupabaseConfigured || !supabase || !coupleId) return [];

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('couple_id', coupleId)
    .order('start_date', { ascending: true });

  if (error) {
    console.error('Failed to fetch events:', error);
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    coupleId: row.couple_id,
    createdBy: row.created_by,
    title: row.title,
    eventType: row.event_type,
    startDate: row.start_date,
    endDate: row.end_date,
    isPrivate: row.is_private,
    createdAt: row.created_at,
  }));
}

export async function saveEventToDB(event: Omit<CoupleEvent, 'id' | 'createdAt'> & { id?: string }): Promise<CoupleEvent | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const payload: any = {
    couple_id: event.coupleId,
    created_by: event.createdBy,
    title: event.title,
    event_type: event.eventType,
    start_date: event.startDate,
    end_date: event.endDate || null,
    is_private: event.isPrivate,
    updated_at: new Date().toISOString(),
  };

  if (event.id) payload.id = event.id;

  const { data, error } = await supabase
    .from('events')
    .upsert(payload)
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to save event:', error);
    return null;
  }

  return {
    id: data.id,
    coupleId: data.couple_id,
    createdBy: data.created_by,
    title: data.title,
    eventType: data.event_type,
    startDate: data.start_date,
    endDate: data.end_date,
    isPrivate: data.is_private,
    createdAt: data.created_at,
  };
}

export async function deleteEventFromDB(eventId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId);

  if (error) {
    console.error('Failed to delete event:', error);
    return false;
  }
  return true;
}
