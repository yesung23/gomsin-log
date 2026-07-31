import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { AppState, UserProfile, CoupleInfo, MilitaryInfo, ContactPreferences, DailyRecord, CoupleEvent, Trip, Role } from '@/types';
import { fetchRecordsFromDB } from '@/lib/records';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { fetchEventsFromDB } from '@/lib/events';
import { fetchTripsFromDB } from '@/lib/trips';

export async function fetchFullStateFromDB(userId: string): Promise<Partial<AppState> | null> {
  if (!isSupabaseConfigured || !supabase || !userId) return null;

  try {
    // 1. Fetch Profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profileData) return null;

    // 2. Fetch Couple Member Status
    const { data: memberData, error: memberError } = await supabase
      .from('couple_members')
      .select('couple_id, status, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    let couple: CoupleInfo = {
      partnerName: '',
      coupleCode: '',
      connected: false,
      status: 'pending',
    };

    if (memberData && memberData.couple_id) {
      // Fetch Couple Details
      const { data: coupleData } = await supabase
        .from('couples')
        .select('*')
        .eq('id', memberData.couple_id)
        .single();

      // Fetch Partner Profile
      const { data: partnerData } = await supabase.rpc('get_partner_profile');
      
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
    const { data: contactData } = await supabase
      .from('contact_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

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

    let records: DailyRecord[] = [];
    let events: CoupleEvent[] = [];
    let trips: Trip[] = [];
    /**
     * The owner of a couple space holds an `active` membership from the moment
     * they create it, so RLS already returns their own rows while the invitation
     * is outstanding. Requiring a partner here meant a user who journalled while
     * waiting saw their entries vanish on the next load.
     */
    const coupleSpaceId = couple.status === 'disconnected' ? undefined : couple.coupleId;
    if (coupleSpaceId) {
      const rawRecords = await fetchRecordsFromDB(coupleSpaceId);
      const partnerRole: Role = profile.role === 'gomsin' ? 'soldier' : 'gomsin';
      // Map authorRole based on userId, then drop anything this viewer is not
      // entitled to see (defence in depth on top of RLS).
      records = visibleRecordsForViewer(
        rawRecords.map((r) => ({
          ...r,
          authorRole: r.userId === userId ? profile.role : partnerRole,
        })),
        { userId, role: profile.role },
      );

      trips = await fetchTripsFromDB(coupleSpaceId);
    }
    // Private schedules remain available to their author after disconnect;
    // RLS adds shared rows only for a couple this account is still a member of.
    events = await fetchEventsFromDB(coupleSpaceId);

    return {
      profile,
      records,
      events,
      trips,
      setupComplete: !!profileData.onboarding_completed_at,
    };
  } catch (err) {
    console.error('fetchFullStateFromDB error:', err);
    return null;
  }
}
