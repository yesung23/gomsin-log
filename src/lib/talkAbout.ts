import { serverCallBlockedByPendingDeletion } from '@/lib/accountDeletion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { TalkAboutMark } from '@/types';

/**
 * "이따 이야기하기" — the client half of the bilateral conversation marks.
 *
 * The server row is metadata only: which record, which couple, which actor,
 * when (migration 038). Nothing here ever sends record text, a topic, an
 * excerpt or a summary, and there is no field on the table to put one in even
 * by mistake. The 오늘 이야기할 것 list joins these ids against records the
 * client is ALREADY authorized to hold, so the content never makes a round
 * trip through this table.
 */

const COLUMNS = 'id, record_id, couple_id, actor_user_id, created_at, is_completed';

function mapRow(row: {
  id: string;
  record_id: string;
  couple_id: string;
  actor_user_id: string;
  created_at: string;
  is_completed: boolean;
}): TalkAboutMark {
  return {
    id: row.id,
    recordId: row.record_id,
    coupleId: row.couple_id,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    isCompleted: row.is_completed,
  };
}

/** Pending marks never expire just because the date changes. */
export function isTalkAboutMarkActive(mark: TalkAboutMark, now: Date = new Date()): boolean {
  void now;
  return !mark.isCompleted;
}

export async function fetchTalkAboutMarksFromDB(coupleId: string): Promise<TalkAboutMark[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  if (!coupleId) return [];

  const { data, error } = await supabase
    .from('talk_about_marks')
    .select(COLUMNS)
    .eq('couple_id', coupleId)
    .eq('is_completed', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch talk-about marks:', error);
    return [];
  }
  return (data || []).map(mapRow);
}

export interface TalkAboutWriteResult {
  ok: boolean;
  error?: string;
}

/**
 * Mark a shared record for a later conversation.
 *
 * `ON CONFLICT DO NOTHING` via `upsert(..., { ignoreDuplicates: true })`: a
 * second tap, or both partners marking at the same instant, must be a no-op
 * rather than an error the user has to understand. The uniqueness constraint
 * decides the race; this just declines to treat losing it as a failure.
 */
export async function markTalkAboutInDB(
  recordId: string,
  coupleId: string,
  actorUserId: string,
): Promise<TalkAboutWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: '지금은 표시할 수 없어요.' };
  }
  if (!recordId || !coupleId || !actorUserId) {
    return { ok: false, error: '지금은 표시할 수 없어요.' };
  }
  if (await serverCallBlockedByPendingDeletion()) {
    return { ok: false, error: '계정 삭제가 진행 중이라 표시할 수 없어요.' };
  }

  // A completed item is intentionally not kept as user-visible history. If
  // this exact person later needs the same original as a new conversation
  // topic, remove only their old completion first, then let the original
  // unique constraint enforce one pending mark. No record is touched.
  const { error: clearCompletedError } = await supabase
    .from('talk_about_marks')
    .delete()
    .eq('record_id', recordId)
    .eq('actor_user_id', actorUserId)
    .eq('is_completed', true);
  if (clearCompletedError) {
    console.error('Failed to clear completed talk-about mark:', clearCompletedError);
    return { ok: false, error: '표시하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }

  // Only the three columns the INSERT grant actually allows. `created_at` is
  // the server's and is not ours to send.
  const { error } = await supabase
    .from('talk_about_marks')
    .upsert(
      { record_id: recordId, couple_id: coupleId, actor_user_id: actorUserId },
      { onConflict: 'record_id,actor_user_id', ignoreDuplicates: true },
    );

  if (error) {
    console.error('Failed to mark talk-about:', error);
    return { ok: false, error: '표시하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: true };
}

/** Remove only the caller's own mark. Never touches the partner's. */
export async function unmarkTalkAboutInDB(
  recordId: string,
  actorUserId: string,
): Promise<TalkAboutWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: '지금은 해제할 수 없어요.' };
  }
  if (await serverCallBlockedByPendingDeletion()) {
    return { ok: false, error: '계정 삭제가 진행 중이라 해제할 수 없어요.' };
  }

  const { error } = await supabase
    .from('talk_about_marks')
    .delete()
    .eq('record_id', recordId)
    .eq('actor_user_id', actorUserId);

  if (error) {
    console.error('Failed to unmark talk-about:', error);
    return { ok: false, error: '해제하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: true };
}

/**
 * "이야기했어요" — the conversation happened, so the topic is done for BOTH.
 *
 * Distinct from `unmark` on purpose. Unmarking withdraws your own intention;
 * this resolves a topic the couple has actually discussed, which is the whole
 * point of the feature. This changes metadata only; it never changes the
 * source record, and the monotonic RLS policy prevents reopening it.
 */
export async function resolveTalkAboutInDB(
  recordId: string,
  coupleId: string,
): Promise<TalkAboutWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: '지금은 처리할 수 없어요.' };
  }
  if (await serverCallBlockedByPendingDeletion()) {
    return { ok: false, error: '계정 삭제가 진행 중이라 처리할 수 없어요.' };
  }

  const { error } = await supabase
    .from('talk_about_marks')
    .update({ is_completed: true })
    .eq('record_id', recordId)
    .eq('couple_id', coupleId)
    .eq('is_completed', false);

  if (error) {
    console.error('Failed to resolve talk-about:', error);
    return { ok: false, error: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: true };
}
