import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { CoupleEvent } from '@/types';

export type EventFetchResult =
  | { ok: true; events: CoupleEvent[] }
  | { ok: false; reason: 'forbidden' | 'error' };

export async function fetchEventsResultFromDB(coupleId?: string): Promise<EventFetchResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, reason: 'error' };
  }

  if (coupleId) {
    const { data: activeCoupleId, error: membershipError } = await supabase
      .rpc('get_my_active_couple_id');
    if (membershipError) {
      console.error('Failed to verify event workspace:', membershipError);
      return { ok: false, reason: 'error' };
    }
    if (activeCoupleId !== coupleId) return { ok: false, reason: 'forbidden' };
  }

  // RLS returns every owner-private event regardless of former couple, plus
  // shared rows only for the active couple. When disconnected, narrowing to
  // private rows avoids an unnecessary shared-row scan.
  let query = supabase
    .from('events')
    .select('*')
    .order('start_date', { ascending: true });
  if (!coupleId) query = query.eq('is_private', true);

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch events:', error);
    return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'error' };
  }

  return {
    ok: true,
    events: data.map((row: any) => ({
      id: row.id,
      coupleId: row.couple_id,
      createdBy: row.created_by,
      title: row.title,
      eventType: row.event_type,
      startDate: row.start_date,
      endDate: row.end_date,
      isPrivate: row.is_private,
      createdAt: row.created_at,
    })),
  };
}

export async function fetchEventsFromDB(coupleId?: string): Promise<CoupleEvent[]> {
  const result = await fetchEventsResultFromDB(coupleId);
  return result.ok ? result.events : [];
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

export async function updateEventInDB(event: CoupleEvent): Promise<CoupleEvent | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from('events')
    .update({
      title: event.title,
      event_type: event.eventType,
      start_date: event.startDate,
      end_date: event.endDate || null,
      is_private: event.isPrivate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', event.id)
    .eq('created_by', event.createdBy)
    .select()
    .maybeSingle();

  if (error || !data) {
    console.error('Failed to update event:', error);
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

/**
 * Delete one event the caller authored.
 *
 * `ownerId` is REQUIRED and is applied as a predicate, matching `updateEventInDB`
 * and the records path (`records.ts` filters on `user_id` AND `couple_id`). The
 * delete used to be `id`-only, leaning entirely on the RLS policy: correct today,
 * but it meant a future policy widened to couple scope would silently let a
 * partner delete the author's events with no client-side barrier at all. A 0-row
 * result is a failure, not a success.
 */
export async function deleteEventFromDB(eventId: string, ownerId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !ownerId) return false;

  const { data, error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('created_by', ownerId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to delete event:', error);
    return false;
  }
  return !!data;
}
