import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { CoupleInfo } from '@/types';

export interface PartnerMembershipSnapshot {
  userId: string;
  joinedAt?: string;
}

/** 요청을 시작한 active workspace와 여전히 같을 때만 상대 신원을 결속한다. */
export function bindPartnerMembership(
  couple: CoupleInfo,
  requestedCoupleId: string,
  partner: PartnerMembershipSnapshot,
): CoupleInfo {
  if (
    couple.coupleId !== requestedCoupleId
    || !couple.connected
    || couple.status !== 'active'
    || !partner.userId
  ) {
    return couple;
  }
  if (
    couple.partnerUserId === partner.userId
    && couple.partnerJoinedAt === partner.joinedAt
  ) {
    return couple;
  }
  const next = { ...couple, partnerUserId: partner.userId };
  if (partner.joinedAt) next.partnerJoinedAt = partner.joinedAt;
  else delete next.partnerJoinedAt;
  return next;
}

/**
 * The active partner membership facts this client needs.
 *
 * A single canonical fact, read rather than derived: `couple_members.joined_at`
 * has existed since migration 001, and the SELECT policy from the same migration
 * lets an active member read the partner's row. The user id proves which exact
 * author may enter on-device summarization; §7.6 uses the join time to tell which
 * records predate the partner without an "already asked" flag.
 *
 * Nothing else about the partner is selected. These two membership facts answer
 * the two product questions, and a wider select would have no purpose.
 */
export async function fetchPartnerMembership(
  coupleId: string,
  myUserId: string,
): Promise<PartnerMembershipSnapshot | undefined> {
  if (!isSupabaseConfigured || !supabase || !coupleId || !myUserId) return undefined;

  /*
    Wrapped, because this is an ancillary lookup and an ancillary lookup must not
    be able to break the app.

    A rejected error is not the same as `{ error }`: the client can throw outright
    on a transport failure, and this runs inside a `useEffect` where an unhandled
    rejection is exactly that -- unhandled. `recordProductEvent` already takes this
    shape for the same reason; this one did not, and the test run said so.

    Every failure path returns `undefined`, which means §7.6's prompt is simply not
    offered. That is the safe direction in every case: the prompt reveals nothing on
    its own, so not showing it can only ever be conservative.
  */
  try {
    const { data, error } = await supabase
      .from('couple_members')
      .select('user_id, joined_at')
      .eq('couple_id', coupleId)
      .eq('status', 'active')
      .neq('user_id', myUserId)
      .maybeSingle();

    if (error) {
      console.warn('[gomsinlog] Could not read the partner join time.');
      return undefined;
    }
    if (typeof data?.user_id !== 'string' || !data.user_id) return undefined;
    return {
      userId: data.user_id,
      ...(typeof data.joined_at === 'string' ? { joinedAt: data.joined_at } : {}),
    };
  } catch {
    console.warn('[gomsinlog] The partner join-time lookup threw.');
    return undefined;
  }
}

/** 기존 호출부를 위한 최소 projection. */
export async function fetchPartnerJoinedAt(
  coupleId: string,
  myUserId: string,
): Promise<string | undefined> {
  return (await fetchPartnerMembership(coupleId, myUserId))?.joinedAt;
}
