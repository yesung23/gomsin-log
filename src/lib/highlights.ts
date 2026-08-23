import { serverCallBlockedByPendingDeletion } from '@/lib/accountDeletion';
import { isMissingTable } from '@/lib/serverErrors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { CoupleHighlight } from '@/types';

export type HighlightFetchResult =
  | { ok: true; highlights: CoupleHighlight[] }
  | { ok: false; reason: 'unavailable' | 'forbidden' | 'error' };

export type HighlightMutationResult =
  | { ok: true; highlight?: CoupleHighlight }
  | { ok: false; reason: 'invalid' | 'unavailable' | 'forbidden' | 'error' };

export interface CoupleHighlightDraft {
  id?: string;
  coupleId: string;
  title: string;
  coverRecordId?: string;
  recordIds: string[];
  sortOrder?: number;
}

function failure(error: unknown): HighlightFetchResult {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === '42501') return { ok: false, reason: 'forbidden' };
  if (isMissingTable(error)) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'error' };
}

function mapHighlight(row: Record<string, unknown>, fallbackRecordIds: string[] = []): CoupleHighlight {
  const rawItems = Array.isArray(row.couple_highlight_items) ? row.couple_highlight_items : [];
  const recordIds = rawItems
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map((item) => item.record_id)
    .filter((id): id is string => typeof id === 'string');

  const resolvedRecordIds = recordIds.length > 0 ? recordIds : fallbackRecordIds;
  return {
    id: String(row.id),
    coupleId: String(row.couple_id),
    title: String(row.title),
    // The first child is the cover. Keeping the cover in the child list means
    // RLS can hide it together with the record instead of leaving a stale id
    // on the parent row.
    ...(resolvedRecordIds[0] ? { coverRecordId: resolvedRecordIds[0] } : {}),
    recordIds: resolvedRecordIds,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeRecordIds(recordIds: string[]): string[] {
  return [...new Set(recordIds.filter((id) => typeof id === 'string' && id.trim()))];
}

export async function fetchCoupleHighlightsResultFromDB(coupleId?: string): Promise<HighlightFetchResult> {
  if (!isSupabaseConfigured || !supabase || !coupleId) {
    return { ok: true, highlights: [] };
  }

  try {
    // The caller's couple id is only a query filter. The SELECT policy derives
    // the active couple from auth.uid(), so a stale or forged filter can only
    // return an empty/denied result and never widens access.
    const { data, error } = await supabase
      .from('couple_highlights')
      .select('id,couple_id,title,sort_order,created_at,updated_at,couple_highlight_items(record_id,sort_order)')
      .eq('couple_id', coupleId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) return failure(error);
    return {
      ok: true,
      highlights: (data || []).map((row) => mapHighlight(row as Record<string, unknown>)),
    };
  } catch (error) {
    // A missing 058 deployment or a partial client/mock surface must never turn
    // an otherwise usable account hydration into a full-state failure.
    return failure(error);
  }
}

export async function saveCoupleHighlightToDB(
  draft: CoupleHighlightDraft,
): Promise<HighlightMutationResult> {
  const title = draft.title.trim();
  const recordIds = normalizeRecordIds(draft.recordIds);
  const coverRecordId = draft.coverRecordId || recordIds[0];
  if (!draft.coupleId || title.length < 1 || title.length > 20 || recordIds.length === 0) {
    return { ok: false, reason: 'invalid' };
  }
  if (!coverRecordId || !recordIds.includes(coverRecordId)) {
    return { ok: false, reason: 'invalid' };
  }
  if (await serverCallBlockedByPendingDeletion()) return { ok: false, reason: 'forbidden' };
  if (!isSupabaseConfigured || !supabase) return { ok: false, reason: 'unavailable' };

  // The first item is the cover in the database. Reordering here is the only
  // persistence needed for cover selection.
  const orderedRecordIds = [coverRecordId, ...recordIds.filter((id) => id !== coverRecordId)];
  const { data, error } = await supabase.rpc('save_couple_highlight', {
    p_highlight_id: draft.id || null,
    p_title: title,
    p_record_ids: orderedRecordIds,
    p_sort_order: draft.sortOrder ?? 0,
  });
  if (error) {
    const classified = failure(error);
    return { ok: false, reason: classified.ok ? 'error' : classified.reason };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    highlight: row
      ? mapHighlight(row as Record<string, unknown>, orderedRecordIds)
      : undefined,
  };
}

export async function deleteCoupleHighlightFromDB(coupleId: string, highlightId: string): Promise<boolean> {
  if (!coupleId || !highlightId || await serverCallBlockedByPendingDeletion()) return false;
  if (!isSupabaseConfigured || !supabase) return false;

  const { data, error } = await supabase
    .from('couple_highlights')
    .delete()
    .eq('id', highlightId)
    .eq('couple_id', coupleId)
    .select('id')
    .maybeSingle();
  if (error) return false;
  return !!data;
}
