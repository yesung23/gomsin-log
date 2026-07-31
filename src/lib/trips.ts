import { supabase } from '@/lib/supabase';
import type { DailyRecord, Trip, TripChecklist, TripItem, TripStatus } from '@/types';

export type TripFetchFailure = { ok: false; reason: 'forbidden' | 'error' };
export type TripsFetchResult = { ok: true; trips: Trip[] } | TripFetchFailure;
export type TripFetchResult = { ok: true; trip: Trip | null } | TripFetchFailure;
export type TripItemsFetchResult = { ok: true; items: TripItem[] } | TripFetchFailure;
export type TripChecklistsFetchResult = { ok: true; checklists: TripChecklist[] } | TripFetchFailure;

export interface TripDraft {
  title: string;
  startDate: string;
  endDate: string;
  status?: TripStatus;
}

function failure(error?: { code?: string } | null): TripFetchFailure {
  return { ok: false, reason: error?.code === '42501' ? 'forbidden' : 'error' };
}

function mapTrip(row: Record<string, unknown>): Trip {
  return {
    id: row.id as string,
    coupleId: row.couple_id as string,
    createdBy: row.created_by as string,
    title: row.title as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    status: row.status as TripStatus,
    createdAt: row.created_at as string,
  };
}

function mapTripItem(row: Record<string, unknown>): TripItem {
  const rawUrl = typeof row.url === 'string' ? row.url.trim() : '';
  const safeUrl = rawUrl && validateTripItemUrl(rawUrl) === null ? rawUrl : undefined;
  return {
    id: row.id as string,
    tripId: row.trip_id as string,
    itemDate: row.item_date as string,
    title: row.title as string,
    category: row.category as TripItem['category'],
    memo: (row.memo as string | null) || undefined,
    url: safeUrl,
    sortOrder: row.sort_order as number,
  };
}

function mapTripChecklist(row: Record<string, unknown>): TripChecklist {
  return {
    id: row.id as string,
    tripId: row.trip_id as string,
    itemName: row.item_name as string,
    completed: row.completed as boolean,
  };
}

export function reconcileParentTrips(trips: Trip[]): Trip[] {
  const byId = new Map<string, Trip>();
  trips.forEach((trip) => byId.set(trip.id, trip));
  return Array.from(byId.values());
}

export function validateTripDraft(draft: TripDraft): string | null {
  if (!draft.title.trim()) return '여행 이름을 입력해 주세요.';
  if (!draft.startDate) return '가는 날을 선택해 주세요.';
  if (!draft.endDate) return '오는 날을 선택해 주세요.';
  if (draft.endDate < draft.startDate) return '오는 날은 가는 날보다 빠를 수 없어요.';
  return null;
}

export function validateTripRangeAgainstItems(
  draft: Pick<TripDraft, 'startDate' | 'endDate'>,
  items: Array<Pick<TripItem, 'itemDate'>>,
): string | null {
  if (items.some((item) => item.itemDate < draft.startDate || item.itemDate > draft.endDate)) {
    return '기존 일정이 포함되도록 여행 기간을 설정해 주세요.';
  }
  return null;
}

export function validateTripItemUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? null
      : '링크는 http 또는 https 주소만 사용할 수 있어요.';
  } catch {
    return '올바른 링크 주소를 입력해 주세요.';
  }
}

export function inclusiveTripDates(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate || endDate < startDate) return [];
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function recordsInInclusiveRange<T extends Pick<DailyRecord, 'date'>>(
  records: T[],
  startDate: string,
  endDate: string,
): T[] {
  return records.filter((record) => startDate <= record.date && record.date <= endDate);
}

export interface TripPeriodParams {
  from: string;
  to: string;
  tripId: string;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseTripPeriodParams(params: URLSearchParams): TripPeriodParams | null {
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const tripId = params.get('trip')?.trim() || '';
  if (!tripId || !isCalendarDate(from) || !isCalendarDate(to) || to < from) return null;
  return { from, to, tripId };
}

export async function fetchTripsResultFromDB(coupleId?: string): Promise<TripsFetchResult> {
  if (!supabase) return failure();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return failure({ code: '42501' });

  if (coupleId) {
    const { data: activeCoupleId, error: membershipError } = await supabase
      .rpc('get_my_active_couple_id');
    if (membershipError) {
      console.error('Error verifying trip workspace:', membershipError);
      return failure(membershipError);
    }
    if (activeCoupleId !== coupleId) return failure({ code: '42501' });
  }

  let query = supabase.from('trips').select('*').order('start_date', { ascending: true });
  if (coupleId) query = query.eq('couple_id', coupleId);
  const { data, error } = await query;
  if (error) {
    console.error('Error fetching trips:', error);
    return failure(error);
  }
  return { ok: true, trips: (data || []).map(mapTrip) };
}

/** Backward-compatible list fetch for existing sync callers. */
export async function fetchTripsFromDB(coupleId?: string): Promise<Trip[]> {
  const result = await fetchTripsResultFromDB(coupleId);
  return result.ok ? result.trips : [];
}

export async function fetchTripResultFromDB(tripId: string): Promise<TripFetchResult> {
  if (!supabase || !tripId) return failure();
  const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle();
  if (error) {
    console.error('Error fetching trip:', error);
    return failure(error);
  }
  return { ok: true, trip: data ? mapTrip(data) : null };
}

export async function saveTripToDB(
  trip: Omit<Trip, 'id' | 'createdAt' | 'coupleId' | 'createdBy' | 'status'>,
  coupleId: string,
  createdBy: string,
): Promise<Trip | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('trips').insert([{
    couple_id: coupleId,
    created_by: createdBy,
    title: trip.title,
    start_date: trip.startDate,
    end_date: trip.endDate,
    status: 'planned',
  }]).select().single();
  if (error || !data) {
    console.error('Error saving trip:', error);
    return null;
  }
  return mapTrip(data);
}

export async function updateTripInDB(
  tripId: string,
  updates: Partial<Pick<Trip, 'title' | 'startDate' | 'endDate' | 'status'>>,
): Promise<Trip | null> {
  if (!supabase || !tripId) return null;
  const payload: Record<string, string> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate;
  if (updates.endDate !== undefined) payload.end_date = updates.endDate;
  if (updates.status !== undefined) payload.status = updates.status;
  const { data, error } = await supabase.from('trips').update(payload).eq('id', tripId).select().maybeSingle();
  if (error || !data) {
    console.error('Error updating trip:', error);
    return null;
  }
  return mapTrip(data);
}

export const updateTrip = updateTripInDB;

export async function deleteTripFromDB(tripId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from('trips').delete().eq('id', tripId).select('id').maybeSingle();
  if (error) {
    console.error('Error deleting trip:', error);
    return false;
  }
  return !!data;
}

export async function fetchTripItemsResultFromDB(tripId: string): Promise<TripItemsFetchResult> {
  if (!supabase || !tripId) return failure();
  const { data, error } = await supabase.from('trip_items').select('*').eq('trip_id', tripId)
    .order('item_date', { ascending: true }).order('sort_order', { ascending: true });
  if (error) {
    console.error('Error fetching trip items:', error);
    return failure(error);
  }
  return { ok: true, items: (data || []).map(mapTripItem) };
}

export async function fetchTripItemsFromDB(tripId: string): Promise<TripItem[]> {
  const result = await fetchTripItemsResultFromDB(tripId);
  return result.ok ? result.items : [];
}

export async function saveTripItemToDB(item: Omit<TripItem, 'id'>): Promise<TripItem | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('trip_items').insert([{
    trip_id: item.tripId,
    item_date: item.itemDate,
    title: item.title,
    category: item.category,
    memo: item.memo || null,
    url: item.url || null,
    sort_order: item.sortOrder,
  }]).select().single();
  if (error || !data) {
    console.error('Error saving trip item:', error);
    return null;
  }
  return mapTripItem(data);
}

export async function updateTripItemInDB(item: TripItem): Promise<TripItem | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('trip_items').update({
    trip_id: item.tripId,
    item_date: item.itemDate,
    title: item.title,
    category: item.category,
    memo: item.memo || null,
    url: item.url || null,
    sort_order: item.sortOrder,
    updated_at: new Date().toISOString(),
  }).eq('id', item.id).select().maybeSingle();
  if (error || !data) {
    console.error('Error updating trip item:', error);
    return null;
  }
  return mapTripItem(data);
}

export const updateTripItem = updateTripItemInDB;

export async function reorderTripItemsInDB(items: Array<Pick<TripItem, 'id' | 'sortOrder'>>): Promise<boolean> {
  if (!supabase) return false;
  if (items.length === 0) return true;
  const { error } = await supabase.rpc('reorder_trip_items', {
    p_item_ids: items.map((item) => item.id),
    p_sort_orders: items.map((item) => item.sortOrder),
  });
  if (error) {
    console.error('Error reordering trip items:', error);
    return false;
  }
  return true;
}

export const reorderTripItems = reorderTripItemsInDB;

export async function deleteTripItemFromDB(itemId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from('trip_items').delete().eq('id', itemId).select('id').maybeSingle();
  if (error) {
    console.error('Error deleting trip item:', error);
    return false;
  }
  return !!data;
}

export async function fetchTripChecklistsResultFromDB(tripId: string): Promise<TripChecklistsFetchResult> {
  if (!supabase || !tripId) return failure();
  const { data, error } = await supabase.from('trip_checklists').select('*').eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Error fetching trip checklists:', error);
    return failure(error);
  }
  return { ok: true, checklists: (data || []).map(mapTripChecklist) };
}

export async function fetchTripChecklistsFromDB(tripId: string): Promise<TripChecklist[]> {
  const result = await fetchTripChecklistsResultFromDB(tripId);
  return result.ok ? result.checklists : [];
}

export async function saveTripChecklistToDB(tripId: string, itemName: string): Promise<TripChecklist | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('trip_checklists').insert([{
    trip_id: tripId,
    item_name: itemName,
    completed: false,
  }]).select().single();
  if (error || !data) {
    console.error('Error saving trip checklist:', error);
    return null;
  }
  return mapTripChecklist(data);
}

export async function toggleTripChecklistInDB(checklistId: string, completed: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from('trip_checklists').update({
    completed,
    updated_at: new Date().toISOString(),
  }).eq('id', checklistId).select('id').maybeSingle();
  if (error) {
    console.error('Error toggling trip checklist:', error);
    return false;
  }
  return !!data;
}

export async function deleteTripChecklistFromDB(checklistId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from('trip_checklists').delete().eq('id', checklistId)
    .select('id').maybeSingle();
  if (error) {
    console.error('Error deleting trip checklist:', error);
    return false;
  }
  return !!data;
}
