import { supabase } from './supabase';
import { Trip, TripItem, TripChecklist } from '@/types';

export const fetchTripsFromDB = async (): Promise<Trip[]> => {
  if (!supabase) return [];
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('start_date', { ascending: true });

  if (error) {
    console.error('Error fetching trips:', error);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    coupleId: row.couple_id,
    createdBy: row.created_by,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdAt: row.created_at,
  }));
};

export const saveTripToDB = async (trip: Omit<Trip, 'id' | 'createdAt' | 'coupleId' | 'createdBy' | 'status'>, coupleId: string, createdBy: string): Promise<Trip | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('trips')
    .insert([{
      couple_id: coupleId,
      created_by: createdBy,
      title: trip.title,
      start_date: trip.startDate,
      end_date: trip.endDate,
      status: 'planned'
    }])
    .select()
    .single();

  if (error) {
    console.error('Error saving trip:', error);
    return null;
  }

  return {
    id: data.id,
    coupleId: data.couple_id,
    createdBy: data.created_by,
    title: data.title,
    startDate: data.start_date,
    endDate: data.end_date,
    status: data.status,
    createdAt: data.created_at,
  };
};

export const updateTripInDB = async (
  tripId: string,
  updates: Partial<Pick<Trip, 'title' | 'startDate' | 'endDate' | 'status'>>,
): Promise<Trip | null> => {
  if (!supabase || !tripId) return null;

  const payload: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate;
  if (updates.endDate !== undefined) payload.end_date = updates.endDate;
  if (updates.status !== undefined) payload.status = updates.status;

  const { data, error } = await supabase
    .from('trips')
    .update(payload)
    .eq('id', tripId)
    .select()
    .maybeSingle();

  if (error || !data) {
    console.error('Error updating trip:', error);
    return null;
  }

  return {
    id: data.id,
    coupleId: data.couple_id,
    createdBy: data.created_by,
    title: data.title,
    startDate: data.start_date,
    endDate: data.end_date,
    status: data.status,
    createdAt: data.created_at,
  };
};

export const updateTrip = updateTripInDB;

export const deleteTripFromDB = async (tripId: string): Promise<boolean> => {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('trips')
    .delete()
    .eq('id', tripId)
    .select('id')
    .maybeSingle();
    
  if (error) {
    console.error('Error deleting trip:', error);
    return false;
  }
  return !!data;
};

// Trip Items
export const fetchTripItemsFromDB = async (tripId: string): Promise<TripItem[]> => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('trip_items')
    .select('*')
    .eq('trip_id', tripId)
    .order('item_date', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching trip items:', error);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    tripId: row.trip_id,
    itemDate: row.item_date,
    title: row.title,
    category: row.category,
    memo: row.memo,
    url: row.url,
    sortOrder: row.sort_order
  }));
};

export const saveTripItemToDB = async (item: Omit<TripItem, 'id'>): Promise<TripItem | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('trip_items')
    .insert([{
      trip_id: item.tripId,
      item_date: item.itemDate,
      title: item.title,
      category: item.category,
      memo: item.memo || null,
      url: item.url || null,
      sort_order: item.sortOrder
    }])
    .select()
    .single();

  if (error) {
    console.error('Error saving trip item:', error);
    return null;
  }

  return {
    id: data.id,
    tripId: data.trip_id,
    itemDate: data.item_date,
    title: data.title,
    category: data.category,
    memo: data.memo,
    url: data.url,
    sortOrder: data.sort_order
  };
};

export const updateTripItemInDB = async (item: TripItem): Promise<TripItem | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('trip_items')
    .update({
      trip_id: item.tripId,
      item_date: item.itemDate,
      title: item.title,
      category: item.category,
      memo: item.memo || null,
      url: item.url || null,
      sort_order: item.sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .select()
    .maybeSingle();

  if (error || !data) {
    console.error('Error updating trip item:', error);
    return null;
  }

  return {
    id: data.id,
    tripId: data.trip_id,
    itemDate: data.item_date,
    title: data.title,
    category: data.category,
    memo: data.memo,
    url: data.url,
    sortOrder: data.sort_order,
  };
};

export const updateTripItem = updateTripItemInDB;

export const reorderTripItemsInDB = async (
  items: Array<Pick<TripItem, 'id' | 'sortOrder'>>,
): Promise<boolean> => {
  const client = supabase;
  if (!client) return false;
  if (items.length === 0) return true;

  const updatedAt = new Date().toISOString();
  const results = await Promise.all(
    items.map((item) =>
      client
        .from('trip_items')
        .update({ sort_order: item.sortOrder, updated_at: updatedAt })
        .eq('id', item.id)
        .select('id')
        .maybeSingle(),
    ),
  );

  const failed = results.find(({ data, error }) => error || !data);
  if (failed) {
    console.error('Error reordering trip items:', failed.error);
    return false;
  }
  return true;
};

export const reorderTripItems = reorderTripItemsInDB;

export const deleteTripItemFromDB = async (itemId: string): Promise<boolean> => {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('trip_items')
    .delete()
    .eq('id', itemId)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Error deleting trip item:', error);
    return false;
  }
  return !!data;
};

// Trip Checklists
export const fetchTripChecklistsFromDB = async (tripId: string): Promise<TripChecklist[]> => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('trip_checklists')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching trip checklists:', error);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    tripId: row.trip_id,
    itemName: row.item_name,
    completed: row.completed,
  }));
};

export const saveTripChecklistToDB = async (tripId: string, itemName: string): Promise<TripChecklist | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('trip_checklists')
    .insert([{
      trip_id: tripId,
      item_name: itemName,
      completed: false,
    }])
    .select()
    .single();

  if (error || !data) {
    console.error('Error saving trip checklist:', error);
    return null;
  }

  return {
    id: data.id,
    tripId: data.trip_id,
    itemName: data.item_name,
    completed: data.completed,
  };
};

export const toggleTripChecklistInDB = async (checklistId: string, completed: boolean): Promise<boolean> => {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('trip_checklists')
    .update({ completed, updated_at: new Date().toISOString() })
    .eq('id', checklistId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Error toggling trip checklist:', error);
    return false;
  }
  return !!data;
};

export const deleteTripChecklistFromDB = async (checklistId: string): Promise<boolean> => {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('trip_checklists')
    .delete()
    .eq('id', checklistId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Error deleting trip checklist:', error);
    return false;
  }
  return !!data;
};
