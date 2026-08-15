import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { AppState, UserProfile, CoupleInfo, MilitaryInfo, ContactPreferences, DailyRecord, CoupleEvent, Trip, Role, TalkAboutMark } from '@/types';
import { fetchRecordsResultFromDB } from '@/lib/records';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { fetchEventsResultFromDB } from '@/lib/events';
import { fetchTripsResultFromDB } from '@/lib/trips';
import { fetchTalkAboutMarksResultFromDB } from '@/lib/talkAbout';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';

export const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
export type FullStateFetchResult = Partial<AppState> | null | typeof FULL_STATE_UNAVAILABLE;

/** The exact read that prevented an authenticated account from hydrating. */
export type AuthSyncStage =
  | 'profile'
  | 'membership'
  | 'couple'
  | 'partner'
  | 'contact'
  | 'records'
  | 'events'
  | 'trips'
  | 'talk-about'
  | 'unexpected'
  | 'timeout';

/**
 * Same fetch, but carrying WHY it failed.
 *
 * `FULL_STATE_UNAVAILABLE` says "retry later" and nothing else, so an expired
 * session was indistinguishable from a dead network and the user was told to
 * check their internet connection either way. The reason is classified here once
 * and consumed by the store's auth-recovery path.
 */
export type FullStateResult =
  | { ok: true; state: Partial<AppState> | null }
  | { ok: false; reason: ServerErrorKind; stage: AuthSyncStage; code?: string };

/**
 * Preserve the failing read without exposing database details to the UI.
 *
 * The stage is safe to display as a support code; raw messages remain in the
 * developer console and may contain schema names, so they never enter state.
 */
function syncFailure(stage: AuthSyncStage, error: unknown): FullStateResult {
  const reason = classifyServerError(error).kind;
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : null;
  console.error(`[gomsinlog] Account sync failed at ${stage}:`, {
    code: typeof record?.code === 'string' ? record.code : undefined,
    message: typeof record?.message === 'string' ? record.message : undefined,
  });
  const code = typeof record?.code === 'string' && /^[A-Z0-9_]{1,24}$/i.test(record.code)
    ? record.code.toUpperCase()
    : undefined;
  return { ok: false, reason, stage, ...(code ? { code } : {}) };
}

/**
 * Resume snapshot for an account that owns a couple space but has no profile row.
 *
 * `create_couple_and_invitation` inserts the creator's `active` membership before
 * onboarding ever writes `profiles`, so abandoning onboarding after step 3 left
 * the couple space real on the server and invisible to the client: the profile
 * lookup returned "absent", the client called that a brand-new account, and the
 * next `create_couple_and_invitation` raised `User already in an active couple`
 * with no way out.
 *
 * The result is explicitly three-valued, because "no membership" and "could not
 * ask" are different answers with opposite consequences:
 *
 *  - `{ ok: true, state: <snapshot> }` -- an active membership exists; resume
 *    onboarding INTO that couple space.
 *  - `{ ok: true, state: null }` -- the lookup SUCCEEDED and came back empty, so
 *    this really is a brand-new account.
 *  - `{ ok: false, reason }` -- the lookup failed. Collapsing this into `null`
 *    was the bug: a network blip, an RLS rejection or a malformed response sent
 *    an existing pending creator or member back through brand-new onboarding,
 *    where the next space creation then failed permanently. A failure must stay a
 *    failure and reach the user as a retryable unavailable result.
 */
type ResumableMembershipResult =
  | { ok: true; state: Partial<AppState> | null }
  | { ok: false; reason: ServerErrorKind; stage: 'membership'; code?: string };

async function fetchResumableMembership(
  userId: string,
): Promise<ResumableMembershipResult> {
  if (!supabase) return { ok: true, state: null };
  try {
    const { data, error } = await supabase
      .from('couple_members')
      .select('couple_id, status, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    // A query error is not evidence of absent membership.
    if (error) return syncFailure('membership', error) as ResumableMembershipResult;
    // A successful empty lookup is the only verified new-account answer.
    if (!data?.couple_id) return { ok: true, state: null };

    // Onboarding is deliberately NOT marked complete: the profile row really is
    // missing and still has to be written. What changes is that onboarding now
    // resumes INTO the existing couple space instead of trying to create a
    // second one.
    return {
      ok: true,
      state: {
        profile: {
          id: userId,
          myName: '',
          role: (data.role as Role) || 'gomsin',
          couple: {
            coupleId: data.couple_id,
            partnerName: '',
            coupleCode: '',
            connected: false,
            status: 'pending',
          },
        } as UserProfile,
        setupComplete: false,
      },
    };
  } catch (err) {
    // A thrown lookup (malformed response, transport failure) is also not proof
    // that the account is new.
    console.error('[gomsinlog] Resumable membership lookup failed:', err);
    return syncFailure('membership', err) as ResumableMembershipResult;
  }
}

export async function fetchFullStateResultFromDB(userId: string): Promise<FullStateResult> {
  if (!isSupabaseConfigured || !supabase || !userId) return { ok: true, state: null };

  try {
    // 1. Fetch Profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      // Keep this explicit: `select('*')` silently accepted a production schema
      // that had lost `military_info`, so login succeeded and the failure was
      // deferred until the user tried to save service information.
      .select('id, display_name, role, avatar_path, military_info, onboarding_completed_at')
      .eq('id', userId)
      .maybeSingle();

    // A successful empty lookup is a genuinely new account. Query failures are
    // retryable and must not be confused with onboarding.
    if (profileError) return syncFailure('profile', profileError);
    if (!profileData) {
      // Propagates the membership lookup's own ok/failure result, so a failed
      // lookup becomes FULL_STATE_UNAVAILABLE instead of new-account onboarding.
      return await fetchResumableMembership(userId);
    }

    // 2. Fetch Couple Member Status
    const { data: memberData, error: memberError } = await supabase
      .from('couple_members')
      .select('couple_id, status, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    // An authorization/network failure is not proof that membership is absent.
    // Returning an empty "disconnected" snapshot would overwrite known-good
    // state and mislead the user; surface a retryable unavailable result instead.
    if (memberError) return syncFailure('membership', memberError);

    let couple: CoupleInfo = {
      partnerName: '',
      coupleCode: '',
      connected: false,
      status: 'disconnected',
    };

    if (memberData && memberData.couple_id) {
      // Fetch Couple Details
      const { data: coupleData, error: coupleError } = await supabase
        .from('couples')
        .select('*')
        .eq('id', memberData.couple_id)
        .single();
      if (coupleError || !coupleData) {
        return syncFailure('couple', coupleError);
      }

      // Fetch Partner Profile
      const { data: partnerData, error: partnerError } = await supabase.rpc('get_partner_profile');
      if (partnerError) return syncFailure('partner', partnerError);
      
      const hasPartner = !!(partnerData && partnerData.length > 0);
      let partnerName = '';
      if (hasPartner) {
        partnerName = partnerData[0].display_name;
      }

      couple = {
        coupleId: memberData.couple_id,
        partnerName,
        anniversaryDate: coupleData?.anniversary_date || '',
        coupleCode: '',
        connected: hasPartner,
        status: hasPartner ? 'active' : 'pending',
      };
    }

    // 3. Fetch Contact Preferences
    const { data: contactData, error: contactError } = await supabase
      .from('contact_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (contactError) return syncFailure('contact', contactError);

    const contact: ContactPreferences = {
      weekdayStart: contactData?.weekday_start || '18:00',
      weekdayEnd: contactData?.weekday_end || '21:00',
      weekendStart: contactData?.weekend_start || '12:00',
      weekendEnd: contactData?.weekend_end || '21:00',
      enabled: true,
    };

    /**
     * A profile row with no `military_info` means the user has not told us
     * anything about a service period. It used to be filled in with a fixed
     * 2025-03-10 / 2026-09-09 pair marked `dischargeDateSource: 'calculated'`,
     * which produced a confident D-Day and a service percentage out of nothing
     * and asserted a provenance the value did not have. Absent stays absent:
     * `militaryStatus: 'unknown'` and no dates, so `computeServiceProgress`
     * returns null and every dependent surface renders its empty state.
     */
    const military: MilitaryInfo = profileData.military_info || {
      branch: 'army',
      militaryStatus: 'unknown',
      dischargeDateSource: 'unknown',
    };

    const profile: UserProfile = {
      id: userId,
      myName: profileData.display_name,
      role: memberData?.role || profileData.role,
      avatarPath: profileData.avatar_path,
      onboardingCompletedAt: profileData.onboarding_completed_at,
      couple,
      military,
      contact,
    };

    /**
     * The owner of a couple space holds an `active` membership from the moment
     * they create it, so RLS already returns their own rows while the invitation
     * is outstanding. Requiring a partner here meant a user who journalled while
     * waiting saw their entries vanish on the next load.
     */
    const coupleSpaceId = couple.coupleId;
    const [recordsResult, eventsResult, tripsResult, talkAboutResult] = await Promise.all([
      coupleSpaceId
        ? fetchRecordsResultFromDB(coupleSpaceId)
        : Promise.resolve({ ok: true as const, records: [] as DailyRecord[] }),
      // Private schedules remain available to their author after disconnect;
      // RLS adds shared rows only for an active couple membership.
      fetchEventsResultFromDB(coupleSpaceId),
      coupleSpaceId
        ? fetchTripsResultFromDB(coupleSpaceId)
        : Promise.resolve({ ok: true as const, trips: [] as Trip[] }),
      coupleSpaceId
        ? fetchTalkAboutMarksResultFromDB(coupleSpaceId)
        : Promise.resolve({ ok: true as const, marks: [] as TalkAboutMark[] }),
    ]);
    if (!recordsResult.ok || !eventsResult.ok || !tripsResult.ok || !talkAboutResult.ok) {
      // Prefer a definite cause over a generic one: `forbidden` from a slice read
      // is a membership answer and must not be reported as a connection failure.
      if (!recordsResult.ok) return syncFailure('records', recordsResult.error);
      if (!eventsResult.ok) {
        return {
          ok: false,
          reason: eventsResult.reason === 'forbidden' ? 'forbidden' : 'unknown',
          stage: 'events',
        };
      }
      if (!tripsResult.ok) {
        return {
          ok: false,
          reason: tripsResult.reason === 'forbidden' ? 'forbidden' : 'unknown',
          stage: 'trips',
        };
      }
      if (!talkAboutResult.ok) return syncFailure('talk-about', talkAboutResult.error);
    }

    const partnerRole: Role = profile.role === 'gomsin' ? 'soldier' : 'gomsin';
    // Map authorRole based on userId, then drop anything this viewer is not
    // entitled to see (defence in depth on top of RLS).
    const records = visibleRecordsForViewer(
      recordsResult.records.map((record) => ({
        ...record,
        authorRole: record.userId === userId ? profile.role : partnerRole,
      })),
      { userId, role: profile.role },
    );

    const events: CoupleEvent[] = eventsResult.events;
    const trips: Trip[] = tripsResult.trips;

    return {
      ok: true,
      state: {
        profile,
        records,
        events,
        trips,
        talkAboutMarks: talkAboutResult.marks,
        setupComplete: !!profileData.onboarding_completed_at,
      },
    };
  } catch (err) {
    console.error('fetchFullStateFromDB error:', err);
    return syncFailure('unexpected', err);
  }
}

/**
 * Reason-free wrapper, kept because the `FULL_STATE_UNAVAILABLE` sentinel is the
 * shape the availability tests and the splash-screen timeout fallback are pinned
 * to. New callers should prefer `fetchFullStateResultFromDB`.
 */
export async function fetchFullStateFromDB(userId: string): Promise<FullStateFetchResult> {
  const result = await fetchFullStateResultFromDB(userId);
  return result.ok ? result.state : FULL_STATE_UNAVAILABLE;
}
