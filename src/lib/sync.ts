import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { AppState, UserProfile, CoupleInfo, MilitaryInfo, PartnerServiceInfo, ContactPreferences, DailyRecord, CoupleEvent, Trip, Role, TalkAboutMark } from '@/types';
import { fetchRecordsResultFromDB } from '@/lib/records';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { fetchEventsResultFromDB } from '@/lib/events';
import { fetchTripsResultFromDB } from '@/lib/trips';
import { fetchTalkAboutMarksResultFromDB } from '@/lib/talkAbout';
import { fetchCoupleHighlightsResultFromDB } from '@/lib/highlights';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';
import { fetchPartnerMembershipResult } from '@/lib/coupleTimeline';
import {
  parseGenderIdentity,
  resolveRelationshipContext,
  usesMilitaryFeatures,
} from '@/lib/relationshipContext';

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

type FullStateSyncStage = AuthSyncStage | 'partner-membership';

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
  | { ok: false; reason: ServerErrorKind; stage: FullStateSyncStage; code?: string };

const PROFILE_COLUMNS = 'id, display_name, role, avatar_path, military_info, onboarding_completed_at';
const PROFILE_IDENTITY_COLUMNS = `${PROFILE_COLUMNS}, username, profile_caption, profile_date_type`;
const PROFILE_IDENTITY_AND_GENDER_COLUMNS = `${PROFILE_IDENTITY_COLUMNS}, gender_identity`;

type PartnerProfileRow = {
  display_name?: string | null;
  role?: string | null;
  avatar_path?: string | null;
  username?: string | null;
};

type PartnerServiceRow = {
  branch?: string | null;
  military_status?: string | null;
  enlistment_date?: string | null;
  expected_discharge_date?: string | null;
  discharge_date?: string | null;
  discharge_date_source?: string | null;
};

const BRANCHES = new Set<MilitaryInfo['branch']>([
  'army', 'navy', 'airforce', 'marine', 'reserve', 'social_service', 'other',
]);
const MILITARY_STATUSES = new Set<MilitaryInfo['militaryStatus']>([
  'planned', 'serving', 'discharge_soon', 'discharged', 'unknown',
]);
const DISCHARGE_SOURCES = new Set<MilitaryInfo['dischargeDateSource']>([
  'calculated', 'manual', 'unknown',
]);

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function partnerMilitaryFromRow(row: PartnerServiceRow | undefined): PartnerServiceInfo | undefined {
  if (!row
    || !BRANCHES.has(row.branch as MilitaryInfo['branch'])
    || !MILITARY_STATUSES.has(row.military_status as MilitaryInfo['militaryStatus'])
    || !DISCHARGE_SOURCES.has(row.discharge_date_source as MilitaryInfo['dischargeDateSource'])) {
    return undefined;
  }

  const military: PartnerServiceInfo = {
    branch: row.branch as MilitaryInfo['branch'],
    militaryStatus: row.military_status as MilitaryInfo['militaryStatus'],
    dischargeDateSource: row.discharge_date_source as MilitaryInfo['dischargeDateSource'],
  };
  if (isValidCalendarDate(row.enlistment_date)) {
    military.enlistmentDate = row.enlistment_date;
  }
  if (isValidCalendarDate(row.expected_discharge_date)) {
    military.expectedDischargeDate = row.expected_discharge_date;
  }
  if (isValidCalendarDate(row.discharge_date)) {
    military.dischargeDate = row.discharge_date;
  }
  return military;
}

/**
 * Read the partner's public couple-facing identity without widening profiles RLS.
 *
 * The username projection is additive. During the migration window, an older
 * deployment may only have `get_partner_profile()`, so only a confirmed missing
 * RPC gets the legacy fallback; auth/RLS/server failures remain failures.
 */
async function fetchPartnerProfile(): Promise<{ data: PartnerProfileRow[] | null; error: any }> {
  const extended = await supabase!.rpc('get_partner_profile_with_username');
  if (!extended.error || extended.error?.code !== 'PGRST202') return extended;
  return supabase!.rpc('get_partner_profile');
}

async function fetchProfileRow(userId: string) {
  const profiles = supabase!;
  let result: {
    data: any;
    error: any;
  };

  try {
    result = await profiles
      .from('profiles')
      .select(PROFILE_IDENTITY_AND_GENDER_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
  } catch (error) {
    result = { data: null, error };
  }

  if (!result.error) return result;

  // Migration 075 adds optional gender identity after the V4 identity fields.
  // Keep username/caption/date available while that additive column rolls out.
  try {
    result = await profiles
      .from('profiles')
      .select(PROFILE_IDENTITY_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
  } catch (error) {
    result = { data: null, error };
  }

  if (!result.error) return result;

  // 057 may not be applied on an existing remote yet. Keep the account usable
  // with the old profile shape and leave the new fields absent.
  try {
    return await profiles
      .from('profiles')
      .select('id, display_name, role, avatar_path, military_info, onboarding_completed_at')
      .eq('id', userId)
      .maybeSingle();
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Preserve the failing read without exposing database details to the UI.
 *
 * The stage is safe to keep as diagnostic metadata. Raw server messages and
 * response objects are deliberately not written to the developer console.
 */
function syncFailure(stage: FullStateSyncStage, error: unknown): FullStateResult {
  const reason = classifyServerError(error).kind;
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : null;
  console.error(`[gomsinlog] Account sync failed at ${stage}.`);
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
  | { ok: false; reason: ServerErrorKind; stage: 'membership' | 'couple'; code?: string };

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

    const { data: coupleData, error: coupleError } = await supabase
      .from('couples')
      .select('*')
      .eq('id', data.couple_id)
      .single();
    if (coupleError || !coupleData) {
      return syncFailure('couple', coupleError) as ResumableMembershipResult;
    }
    const relationshipContext = resolveRelationshipContext(coupleData.relationship_context);
    if (!relationshipContext) {
      return syncFailure(
        'couple',
        new Error('Invalid relationship context'),
      ) as ResumableMembershipResult;
    }

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
            relationshipContext,
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
    console.error('[gomsinlog] Resumable membership lookup failed.');
    return syncFailure('membership', err) as ResumableMembershipResult;
  }
}

export async function fetchFullStateResultFromDB(userId: string): Promise<FullStateResult> {
  if (!isSupabaseConfigured || !supabase || !userId) return { ok: true, state: null };

  try {
    // 1. Fetch Profile. The identity columns are optional during the 057 rollout;
    // `fetchProfileRow` retries once with the pre-057 contract when needed.
    const { data: profileData, error: profileError } = await fetchProfileRow(userId);

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
      const relationshipContext = resolveRelationshipContext(coupleData.relationship_context);
      if (!relationshipContext) {
        return syncFailure('couple', new Error('Invalid relationship context'));
      }

      couple = {
        coupleId: memberData.couple_id,
        relationshipContext,
        partnerName: '',
        anniversaryDate: coupleData?.anniversary_date || '',
        coupleCode: '',
        connected: false,
        status: 'pending',
      };

      // Presentation RPCs return no subject id, so they can never establish which
      // partner their fields describe. Bracket every presentation read with the
      // strict membership authority and publish only when both reads identify the
      // same active partner. A verified initial absence is the stable pending path
      // and intentionally skips all partner presentation RPCs.
      const membershipBeforePresentation = await fetchPartnerMembershipResult(
        memberData.couple_id,
        userId,
      );
      if (!membershipBeforePresentation.ok) {
        return syncFailure('partner-membership', membershipBeforePresentation.error);
      }
      const expectedPartner = membershipBeforePresentation.partner;

      if (expectedPartner) {
        const { data: partnerData, error: partnerError } = await fetchPartnerProfile();
        if (partnerError) return syncFailure('partner', partnerError);

        const hasPartnerPresentation = !!(partnerData && partnerData.length > 0);
        let partnerName = '';
        let partnerUsername: string | undefined;
        if (hasPartnerPresentation) {
          partnerName = partnerData[0].display_name || '';
          if (typeof partnerData[0].username === 'string' && partnerData[0].username.trim()) {
            partnerUsername = partnerData[0].username;
          }
        }

        let partnerMilitary: PartnerServiceInfo | undefined;
        const currentRole = memberData.role || profileData.role;
        if (
          hasPartnerPresentation
          && usesMilitaryFeatures(relationshipContext)
          && currentRole === 'gomsin'
        ) {
          const serviceResult = await supabase.rpc('get_partner_service_info');
          if (serviceResult.error && serviceResult.error.code !== 'PGRST202') {
            return syncFailure('partner', serviceResult.error);
          }
          partnerMilitary = partnerMilitaryFromRow(serviceResult.data?.[0]);
        }

        const membershipAfterPresentation = await fetchPartnerMembershipResult(
          memberData.couple_id,
          userId,
        );
        if (!membershipAfterPresentation.ok) {
          return syncFailure('partner-membership', membershipAfterPresentation.error);
        }
        const verifiedPartner = membershipAfterPresentation.partner;
        if (!verifiedPartner || verifiedPartner.userId !== expectedPartner.userId) {
          return syncFailure(
            'partner-membership',
            new Error('Partner membership changed during hydration'),
          );
        }

        couple = {
          ...couple,
          partnerName,
          partnerUserId: verifiedPartner.userId,
          ...(verifiedPartner.joinedAt ? { partnerJoinedAt: verifiedPartner.joinedAt } : {}),
          ...(partnerUsername ? { partnerUsername } : {}),
          ...(partnerMilitary ? { partnerMilitary } : {}),
          connected: true,
          status: 'active',
        };
      }
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
    const genderIdentity = parseGenderIdentity(profileData.gender_identity);

    const profile: UserProfile = {
      id: userId,
      myName: profileData.display_name,
      role: memberData?.role || profileData.role,
      ...(genderIdentity ? { genderIdentity } : {}),
      avatarPath: profileData.avatar_path,
      ...(typeof profileData.username === 'string' ? { username: profileData.username } : {}),
      ...(typeof profileData.profile_caption === 'string' ? { profileCaption: profileData.profile_caption } : {}),
      ...(profileData.profile_date_type === 'together'
        || profileData.profile_date_type === 'meeting'
        || profileData.profile_date_type === 'discharge'
        ? { profileDateType: profileData.profile_date_type }
        : {}),
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
    const [recordsResult, eventsResult, tripsResult, talkAboutResult, highlightsResult] = await Promise.all([
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
      coupleSpaceId
        ? fetchCoupleHighlightsResultFromDB(coupleSpaceId)
        : Promise.resolve({ ok: true as const, highlights: [] }),
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
        // Highlights are additive. An older deployment without migration 058
        // must keep the account usable while the rest of the workspace hydrates.
        coupleHighlights: highlightsResult.ok ? highlightsResult.highlights : [],
        setupComplete: !!profileData.onboarding_completed_at,
      },
    };
  } catch (err) {
    console.error('[gomsinlog] Full state fetch failed.');
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
