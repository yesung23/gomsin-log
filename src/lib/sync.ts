import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { AppState, UserProfile, CoupleInfo, MilitaryInfo, ContactPreferences, DailyRecord, CoupleEvent, Trip } from '@/types';
import { fetchRecordsFromDB } from '@/lib/records';
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
        anniversaryDate: coupleData?.anniversary_date || undefined,
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

    // 저장된 복무 정보가 없으면 예시 날짜를 만들지 않고 미설정 상태로 둡니다.
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

    let records: DailyRecord[] = [];
    let events: CoupleEvent[] = [];
    let trips: Trip[] = [];
    if (couple.coupleId) {
      const rawRecords = await fetchRecordsFromDB(couple.coupleId);
      // Map authorRole based on userId
      records = rawRecords.map(r => ({
        ...r,
        authorRole: r.userId === userId ? profile.role : (profile.role === 'gomsin' ? 'soldier' : 'gomsin'),
      }));
      
      events = await fetchEventsFromDB(couple.coupleId);
      trips = await fetchTripsFromDB(); // it uses session for user
    }

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
