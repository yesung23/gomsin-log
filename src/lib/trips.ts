import { runServerMutationBehindDeletionBarrier } from '@/lib/accountDeletion';
import { isSchemaCacheMiss, schemaCacheMissLog } from '@/lib/serverErrors';
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
    startTime: typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : undefined,
    title: row.title as string,
    category: row.category as TripItem['category'],
    memo: (row.memo as string | null) || undefined,
    ...(row.talk_about === true ? { talkAbout: true } : {}),
    url: safeUrl,
    address: (row.address as string | null) || undefined,
    businessHours: (row.business_hours as string | null) || undefined,
    latitude: typeof row.latitude === 'number' ? row.latitude : undefined,
    longitude: typeof row.longitude === 'number' ? row.longitude : undefined,
    source: (row.source as TripItem['source']) || 'manual',
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
  if (trimmed.length > 2048) return '링크 주소가 너무 길어요. (최대 2,048자)';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '링크는 http 또는 https 주소만 사용할 수 있어요.';
    }
    // Match the DB constraint: host must be non-empty and no whitespace anywhere.
    if (!parsed.hostname || /\s/.test(trimmed)) {
      return '올바른 링크 주소를 입력해 주세요.';
    }
    return null;
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

/**
 * A real `YYYY-MM-DD`, round-tripped rather than pattern-matched.
 *
 * Exported because `RecordPage` validates `?date=` with the same rule that
 * validates `?from=`/`?to=` here. Two validators for one URL date format is how
 * they drift -- the regex alone accepts `2026-13-99` and `2026-02-30`, and only
 * the round trip below rejects them.
 */
export function isCalendarDate(value: string): boolean {
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
      console.error('[gomsinlog] Failed to verify trip workspace.');
      return failure(membershipError);
    }
    if (activeCoupleId !== coupleId) return failure({ code: '42501' });
  }

  let query = supabase.from('trips').select('*').order('start_date', { ascending: true });
  if (coupleId) query = query.eq('couple_id', coupleId);
  const { data, error } = await query;
  if (error) {
    console.error('[gomsinlog] Failed to fetch trips.');
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
    console.error('[gomsinlog] Failed to fetch trip.');
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
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trips').insert([{
      couple_id: coupleId,
      created_by: createdBy,
      title: trip.title,
      start_date: trip.startDate,
      end_date: trip.endDate,
      status: 'planned',
    }]).select().single();
    assertCurrent();
    if (error || !data) {
      console.error('[gomsinlog] Failed to save trip.');
      return null;
    }
    return mapTrip(data);
  }, { expectedUserId: createdBy });
  return result.kind === 'executed' ? result.value : null;
}

/**
 * Edit one trip belonging to the caller's couple.
 *
 * `coupleId` is REQUIRED and applied as a predicate, matching
 * `deleteTripFromDB`. The three deletes in this module were already scoped with
 * the reasoning that "a widened policy cannot turn a stale id into a cross-couple
 * write" -- but the three mutations were still `id`-only, so the rule was stated
 * and then not followed. RLS covers this today; the predicate is what keeps it
 * covered if a policy is ever loosened.
 */
export async function updateTripInDB(
  tripId: string,
  updates: Partial<Pick<Trip, 'title' | 'startDate' | 'endDate' | 'status'>>,
  coupleId: string,
): Promise<Trip | null> {
  if (!supabase || !tripId || !coupleId) return null;
  const payload: Record<string, string> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate;
  if (updates.endDate !== undefined) payload.end_date = updates.endDate;
  if (updates.status !== undefined) payload.status = updates.status;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trips').update(payload)
      .eq('id', tripId).eq('couple_id', coupleId).select().maybeSingle();
    assertCurrent();
    if (error || !data) {
      console.error('[gomsinlog] Failed to update trip.');
      return null;
    }
    return mapTrip(data);
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : null;
}

export const updateTrip = updateTripInDB;

/**
 * Delete one trip belonging to the caller's couple.
 *
 * `coupleId` is REQUIRED and is applied as a predicate. The delete used to be
 * `id`-only, leaning entirely on RLS; scoping it here means a widened policy
 * cannot turn a stale id into a cross-couple delete. A 0-row result is a failure.
 */
export async function deleteTripFromDB(tripId: string, coupleId: string): Promise<boolean> {
  if (!supabase || !coupleId) return false;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trips').delete().eq('id', tripId)
      .eq('couple_id', coupleId).select('id').maybeSingle();
    assertCurrent();
    if (error) {
      console.error('[gomsinlog] Failed to delete trip.');
      return false;
    }
    return !!data;
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : false;
}

export async function fetchTripItemsResultFromDB(tripId: string): Promise<TripItemsFetchResult> {
  if (!supabase || !tripId) return failure();
  const { data, error } = await supabase.from('trip_items').select('*').eq('trip_id', tripId)
    .order('item_date', { ascending: true }).order('sort_order', { ascending: true });
  if (error) {
    console.error('[gomsinlog] Failed to fetch trip items.');
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
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trip_items').insert([{
      trip_id: item.tripId,
      item_date: item.itemDate,
      start_time: item.startTime || null,
      title: item.title,
      category: item.category,
      memo: item.memo || null,
      talk_about: item.talkAbout === true,
      url: item.url || null,
      address: item.address || null,
      business_hours: item.businessHours || null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      source: item.source || 'manual',
      sort_order: item.sortOrder,
    }]).select().single();
    assertCurrent();
    if (error || !data) {
      console.error('[gomsinlog] Failed to save trip item.');
      return null;
    }
    return mapTripItem(data);
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : null;
}

/**
 * Edit an item's own fields only.
 *
 * `trip_id`, `item_date` and `sort_order` are deliberately absent. The database
 * rejects a statement that names them outside `reorder_trip_items`, and it fires
 * on the columns a statement mentions rather than on the values changing, so
 * echoing a cached `sort_order` back made a plain title edit fail whenever the
 * cached rank had gone stale (the partner reordered the day, or a local
 * optimistic reorder was rolled back). Placement is owned by the reorder RPC.
 */
export async function updateTripItemInDB(item: TripItem): Promise<TripItem | null> {
  // `tripId` is required so the update can be scoped to its parent trip, exactly
  // like `deleteTripItemFromDB`. Without it a stale item id was the only thing
  // standing between this statement and another couple's row.
  if (!supabase || !item.tripId) return null;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trip_items').update({
      title: item.title,
      category: item.category,
      memo: item.memo || null,
      talk_about: item.talkAbout === true,
      url: item.url || null,
      address: item.address || null,
      business_hours: item.businessHours || null,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      source: item.source || 'manual',
      updated_at: new Date().toISOString(),
    }).eq('id', item.id).eq('trip_id', item.tripId).select().maybeSingle();
    assertCurrent();
    if (error || !data) {
      console.error('[gomsinlog] Failed to update trip item.');
      return null;
    }
    return mapTripItem(data);
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : null;
}

export const updateTripItem = updateTripItemInDB;

export async function reorderTripItemsInDB(items: Array<Pick<TripItem, 'id' | 'sortOrder'>>): Promise<boolean> {
  if (!supabase) return false;
  if (items.length === 0) return true;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { error } = await supabase!.rpc('reorder_trip_items', {
      p_item_ids: items.map((item) => item.id),
      p_sort_orders: items.map((item) => item.sortOrder),
    });
    assertCurrent();
    if (error) {
      // The RPC is the ONLY way to permute ranks (015 blocks direct topology
      // updates), so a missing schema reload disables reordering entirely. Say
      // which deploy step is missing instead of returning a bare `false`.
      if (isSchemaCacheMiss(error)) {
        console.error(schemaCacheMissLog('reorder_trip_items', '015'));
        return false;
      }
      console.error('[gomsinlog] Failed to reorder trip items.');
      return false;
    }
    return true;
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : false;
}

export const reorderTripItems = reorderTripItemsInDB;

/**
 * Delete one item of a specific trip.
 *
 * `tripId` is REQUIRED and is applied as a predicate: trip items are couple-shared
 * by design, so ownership is not the boundary here -- the parent trip is. An
 * `id`-only delete would let a stale id from another trip through if the policy
 * were ever widened.
 */
export async function deleteTripItemFromDB(itemId: string, tripId: string): Promise<boolean> {
  if (!supabase || !tripId) return false;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trip_items').delete().eq('id', itemId)
      .eq('trip_id', tripId).select('id').maybeSingle();
    assertCurrent();
    if (error) {
      console.error('[gomsinlog] Failed to delete trip item.');
      return false;
    }
    return !!data;
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : false;
}

export async function fetchTripChecklistsResultFromDB(tripId: string): Promise<TripChecklistsFetchResult> {
  if (!supabase || !tripId) return failure();
  const { data, error } = await supabase.from('trip_checklists').select('*').eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[gomsinlog] Failed to fetch trip checklists.');
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
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trip_checklists').insert([{
      trip_id: tripId,
      item_name: itemName,
      completed: false,
    }]).select().single();
    assertCurrent();
    if (error || !data) {
      console.error('[gomsinlog] Failed to save trip checklist.');
      return null;
    }
    return mapTripChecklist(data);
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : null;
}

/** Toggle one checklist entry of a specific trip. Scoped like the delete below. */
export async function toggleTripChecklistInDB(
  checklistId: string,
  completed: boolean,
  tripId: string,
): Promise<boolean> {
  if (!supabase || !tripId) return false;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trip_checklists').update({
      completed,
      updated_at: new Date().toISOString(),
    }).eq('id', checklistId).eq('trip_id', tripId).select('id').maybeSingle();
    assertCurrent();
    if (error) {
      console.error('[gomsinlog] Failed to toggle trip checklist.');
      return false;
    }
    return !!data;
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : false;
}

/** Delete one checklist entry of a specific trip. Scoped like the items above. */
export async function deleteTripChecklistFromDB(
  checklistId: string,
  tripId: string,
): Promise<boolean> {
  if (!supabase || !tripId) return false;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('trip_checklists').delete().eq('id', checklistId)
      .eq('trip_id', tripId).select('id').maybeSingle();
    assertCurrent();
    if (error) {
      console.error('[gomsinlog] Failed to delete trip checklist.');
      return false;
    }
    return !!data;
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : false;
}
