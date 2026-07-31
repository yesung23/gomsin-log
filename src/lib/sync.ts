import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { AppState, UserProfile, CoupleInfo, MilitaryInfo, ContactPreferences, DailyRecord, CoupleEvent, Trip, Role } from '@/types';
import { fetchRecordsResultFromDB } from '@/lib/records';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { fetchEventsResultFromDB } from '@/lib/events';
import { fetchTripsResultFromDB } from '@/lib/trips';

export const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
export type FullStateFetchResult = Partial<AppState> | null | typeof FULL_STATE_UNAVAILABLE;

export async function fetchFullStateFromDB(userId: string): Promise<FullStateFetchResult> {
  if (!isSupabaseConfigured || !supabase || !userId) return null;

  try {
    // 1. Fetch Profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    // A successful empty lookup is a genuinely new account. Query failures are
    // retryable and must not be confused with onboarding.
    if (profileError) return FULL_STATE_UNAVAILABLE;
    if (!profileData) return null;

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
    if (memberError) return FULL_STATE_UNAVAILABLE;

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
      if (coupleError || !coupleData) return FULL_STATE_UNAVAILABLE;

      // Fetch Partner Profile
      const { data: partnerData, error: partnerError } = await supabase.rpc('get_partner_profile');
      if (partnerError) return FULL_STATE_UNAVAILABLE;
      
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
    if (contactError) return FULL_STATE_UNAVAILABLE;

    const contact: ContactPreferences = {
      weekdayStart: contactData?.weekday_start || '18:00',
      weekdayEnd: contactData?.weekday_end || '21:00',
      weekendStart: contactData?.weekend_start || '12:00',
      weekendEnd: contactData?.weekend_end || '21:00',
      enabled: true,
    };

    const military: MilitaryInfo = profileData.military_info || {
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2025-03-10',
      expectedDischargeDate: '2026-09-09',
      dischargeDateSource: 'calculated',
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
    const [recordsResult, eventsResult, tripsResult] = await Promise.all([
      coupleSpaceId
        ? fetchRecordsResultFromDB(coupleSpaceId)
        : Promise.resolve({ ok: true as const, records: [] as DailyRecord[] }),
      // Private schedules remain available to their author after disconnect;
      // RLS adds shared rows only for an active couple membership.
      fetchEventsResultFromDB(coupleSpaceId),
      coupleSpaceId
        ? fetchTripsResultFromDB(coupleSpaceId)
        : Promise.resolve({ ok: true as const, trips: [] as Trip[] }),
    ]);
    if (!recordsResult.ok || !eventsResult.ok || !tripsResult.ok) {
      return FULL_STATE_UNAVAILABLE;
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
      profile,
      records,
      events,
      trips,
      setupComplete: !!profileData.onboarding_completed_at,
    };
  } catch (err) {
    console.error('fetchFullStateFromDB error:', err);
    return FULL_STATE_UNAVAILABLE;
  }
}
