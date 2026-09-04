import {
  serverCallBlockedByPendingDeletion,
  type AccountDeletionLockLease,
} from '@/lib/accountDeletion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isMissingTable } from '@/lib/serverErrors';
import type { TalkAboutMark } from '@/types';

export const TALK_ABOUT_SYNC_PENDING_MESSAGE =
  '저장은 됐지만 화면 반영이 늦어지고 있어요. 잠시 후 다시 확인해 주세요.';

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

export type TalkAboutFetchResult =
  /**
   * `deployed: false` means the table is not in the schema at all, so `marks` is
   * empty because **there are none** -- not because the read failed. See
   * `isMissingTable` for why schema absence is the one failure that licenses an
   * empty answer.
   */
  | { ok: true; marks: TalkAboutMark[]; deployed?: boolean }
  | { ok: false; error: unknown };

export async function fetchTalkAboutMarksResultFromDB(
  coupleId: string,
): Promise<TalkAboutFetchResult> {
  if (!coupleId) return { ok: true, marks: [] };
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: new Error('E_TALK_ABOUT_UNAVAILABLE') };
  }

  const { data, error } = await supabase
    .from('talk_about_marks')
    .select(COLUMNS)
    .eq('couple_id', coupleId)
    .eq('is_completed', false)
    .order('created_at', { ascending: false });

  if (error) {
    /*
      테이블이 스키마에 아예 없으면 실패가 아니라 **없음**이다.

      `이따 이야기하기` 표시는 기록 위에 얹히는 부가 메타데이터다. 038/043 이 아직
      운영에 적용되지 않았다면 그 표시는 누구에게도 존재하지 않으므로 빈 목록이
      추측이 아니라 사실이다.

      이것을 실패로 다루면 어떻게 되는지는 실제로 겪었다 -- 로그인 직후 하이드레이션이
      이 조각에서 멈춰 `TALK_ABOUT-SERVER` 화면이 뜨고, **앱 전체에 들어갈 수 없었다.**
      기능 하나의 배포 지연이 계정을 인질로 잡으면 안 된다.

      권한 거부(42501)나 네트워크 실패는 여전히 실패다. 그때는 표시가 있는데 못 읽는
      것이므로 빈 목록이 거짓말이 된다.
    */
    if (isMissingTable(error)) {
      console.warn(
        '[gomsinlog] talk_about_marks is not in the schema (PGRST205). '
        + 'Apply migrations 038 and 043 and reload the schema cache '
        + '(Settings -> API -> Reload schema). Talk-about marks read as empty until then.',
      );
      return { ok: true, marks: [], deployed: false };
    }
    console.error('[gomsinlog] Failed to fetch talk-about marks.');
    return { ok: false, error };
  }
  return { ok: true, marks: (data || []).map(mapRow), deployed: true };
}

export interface TalkAboutWriteResult {
  ok: boolean;
  error?: string;
  /** Whether this request actually transitioned at least one pending row. */
  changed?: boolean;
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
  deletionLease?: AccountDeletionLockLease,
): Promise<TalkAboutWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: '지금은 표시할 수 없어요.' };
  }
  if (!recordId || !coupleId || !actorUserId) {
    return { ok: false, error: '지금은 표시할 수 없어요.' };
  }
  if (await serverCallBlockedByPendingDeletion(deletionLease)) {
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
    console.error('[gomsinlog] Failed to clear completed talk-about mark.');
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
    console.error('[gomsinlog] Failed to mark talk-about.');
    return { ok: false, error: '표시하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: true };
}

/** Remove only the caller's own mark. Never touches the partner's. */
export async function unmarkTalkAboutInDB(
  recordId: string,
  actorUserId: string,
  deletionLease?: AccountDeletionLockLease,
): Promise<TalkAboutWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: '지금은 해제할 수 없어요.' };
  }
  if (await serverCallBlockedByPendingDeletion(deletionLease)) {
    return { ok: false, error: '계정 삭제가 진행 중이라 해제할 수 없어요.' };
  }

  const { error } = await supabase
    .from('talk_about_marks')
    .delete()
    .eq('record_id', recordId)
    .eq('actor_user_id', actorUserId);

  if (error) {
    console.error('[gomsinlog] Failed to unmark talk-about.');
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
  deletionLease?: AccountDeletionLockLease,
): Promise<TalkAboutWriteResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: '지금은 처리할 수 없어요.' };
  }
  if (await serverCallBlockedByPendingDeletion(deletionLease)) {
    return { ok: false, error: '계정 삭제가 진행 중이라 처리할 수 없어요.' };
  }

  const { data, error } = await supabase
    .from('talk_about_marks')
    .update({ is_completed: true })
    .eq('record_id', recordId)
    .eq('couple_id', coupleId)
    .eq('is_completed', false)
    .select('id');

  if (error) {
    console.error('[gomsinlog] Failed to resolve talk-about.');
    return { ok: false, error: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: true, changed: Array.isArray(data) && data.length > 0 };
}
