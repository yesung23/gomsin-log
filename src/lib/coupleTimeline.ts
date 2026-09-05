import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { CoupleInfo } from '@/types';

export interface PartnerMembershipSnapshot {
  userId: string;
  joinedAt?: string;
}

export type PartnerMembershipLookupResult =
  | { ok: true; partner: PartnerMembershipSnapshot | null }
  | { ok: false; error: unknown };

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
export async function fetchPartnerMembershipResult(
  coupleId: string,
  myUserId: string,
): Promise<PartnerMembershipLookupResult> {
  if (!isSupabaseConfigured || !supabase || !coupleId || !myUserId) {
    return { ok: false, error: new Error('Partner membership lookup unavailable') };
  }

  try {
    const { data, error } = await supabase
      .from('couple_members')
      .select('user_id, joined_at')
      .eq('couple_id', coupleId)
      .eq('status', 'active')
      .neq('user_id', myUserId)
      .limit(2);

    if (error) return { ok: false, error };
    if (!Array.isArray(data)) {
      return { ok: false, error: new Error('Malformed partner membership response') };
    }
    if (data.length === 0) return { ok: true, partner: null };
    if (data.length !== 1) {
      return { ok: false, error: new Error('Multiple active partner memberships') };
    }

    const row = data[0] as { user_id?: unknown; joined_at?: unknown };
    if (
      typeof row.user_id !== 'string'
      || !row.user_id
      || row.user_id === myUserId
      || (row.joined_at !== null
        && row.joined_at !== undefined
        && (typeof row.joined_at !== 'string'
          || !row.joined_at
          || Number.isNaN(Date.parse(row.joined_at))))
    ) {
      return { ok: false, error: new Error('Malformed partner membership row') };
    }

    return {
      ok: true,
      partner: {
        userId: row.user_id,
        ...(typeof row.joined_at === 'string' ? { joinedAt: row.joined_at } : {}),
      },
    };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Fail-closed compatibility projection for ancillary callers.
 *
 * Full hydration consumes the strict result above so verified absence and an
 * unavailable authority can never be confused.
 */
export async function fetchPartnerMembership(
  coupleId: string,
  myUserId: string,
): Promise<PartnerMembershipSnapshot | undefined> {
  const result = await fetchPartnerMembershipResult(coupleId, myUserId);
  if (!result.ok) {
    console.warn('[gomsinlog] Could not read partner membership.');
    return undefined;
  }
  return result.partner ?? undefined;
}

/** 기존 호출부를 위한 최소 projection. */
export async function fetchPartnerJoinedAt(
  coupleId: string,
  myUserId: string,
): Promise<string | undefined> {
  return (await fetchPartnerMembership(coupleId, myUserId))?.joinedAt;
}
