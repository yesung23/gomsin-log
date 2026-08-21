import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * When the other member joined.
 *
 * A single canonical fact, read rather than derived: `couple_members.joined_at`
 * has existed since migration 001, and the SELECT policy from the same migration
 * lets an active member read the partner's row. §7.6 needs it to tell which
 * records predate the partner, and having it means the one-time reveal prompt
 * needs no "already asked" flag stored anywhere.
 *
 * Nothing else about the partner is selected. The one column answers the one
 * question, and a wider select would be a place for partner data to leak into a
 * client that has no product reason to hold it.
 */
export async function fetchPartnerJoinedAt(
  coupleId: string,
  myUserId: string,
): Promise<string | undefined> {
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
      .select('joined_at')
      .eq('couple_id', coupleId)
      .eq('status', 'active')
      .neq('user_id', myUserId)
      .maybeSingle();

    if (error) {
      console.warn('[gomsinlog] Could not read the partner join time:', error.message);
      return undefined;
    }
    return typeof data?.joined_at === 'string' ? data.joined_at : undefined;
  } catch (thrown) {
    console.warn('[gomsinlog] The partner join-time lookup threw:', thrown);
    return undefined;
  }
}
