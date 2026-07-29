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

export const deleteTripFromDB = async (tripId: string): Promise<boolean> => {
  if (!supabase) return false;
  const { error } = await supabase
    .from('trips')
    .delete()
    .eq('id', tripId);
    
  if (error) {
    console.error('Error deleting trip:', error);
    return false;
  }
  return true;
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

export const deleteTripItemFromDB = async (itemId: string): Promise<boolean> => {
  if (!supabase) return false;
  const { error } = await supabase
    .from('trip_items')
    .delete()
    .eq('id', itemId);
  if (error) {
    console.error('Error deleting trip item:', error);
    return false;
  }
  return true;
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
  const { error } = await supabase
    .from('trip_checklists')
    .update({ completed })
    .eq('id', checklistId);

  if (error) {
    console.error('Error toggling trip checklist:', error);
    return false;
  }
  return true;
};

export const deleteTripChecklistFromDB = async (checklistId: string): Promise<boolean> => {
  if (!supabase) return false;
  const { error } = await supabase
    .from('trip_checklists')
    .delete()
    .eq('id', checklistId);

  if (error) {
    console.error('Error deleting trip checklist:', error);
    return false;
  }
  return true;
};
