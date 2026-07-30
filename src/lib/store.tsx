import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, DailyRecord, UserProfile, Role, AuthUser, ILogRepository, CoupleEvent } from '@/types';
import {
  authRepository,
  isSupabaseConfigured,
  supabase,
  disconnectCoupleFromDB,
  deleteAccountFromDB,
} from '@/lib/supabase';
import { fetchFullStateFromDB } from '@/lib/sync';
import { saveRecordToDB, deleteRecordFromDB } from '@/lib/records';

const STORE_KEY_V1 = 'gomsinlog.state.v1';
const STORE_KEY = 'gomsinlog.state.v2';

export class LocalStorageRepository implements ILogRepository {
  isConfigured(): boolean {
    return true;
  }

  async loadState(): Promise<AppState | null> {
    try {
      localStorage.removeItem(STORE_KEY_V1); // Remove legacy v1 state
      const stored = localStorage.getItem(STORE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error('[gomsinlog] Failed to load state from localStorage', e);
    }
    return null;
  }

  async saveState(state: AppState): Promise<void> {
    try {
      // 보안 처리: private 기록은 로컬 스토리지에 평문으로 남지 않도록 본문/첨부파일/감정/메타데이터 제외
      const sanitizedState = {
        ...state,
        records: state.records.map((r) =>
          r.isPrivate ? {
            id: r.id,
            date: r.date,
            time: r.time,
            isPrivate: true,
            authorRole: r.authorRole
          } as DailyRecord : r
        ),
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(sanitizedState));
    } catch (e) {
      console.error('[gomsinlog] Failed to save state to localStorage', e);
    }
  }
}

const DEFAULT_STATE: AppState = {
  setupComplete: false,
  onboardingStep: 0,
  isDemoMode: true,
  authenticatedUser: null,
  profile: {
    myName: '',
    role: 'gomsin',
    couple: {
      partnerName: '',
      anniversaryDate: '2024-02-14',
      coupleCode: '',
      connected: false,
      status: 'pending',
    },
    military: {
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2025-03-10',
      expectedDischargeDate: '2026-09-09',
      dischargeDateSource: 'calculated',
      memo: '',
    },
    contact: {
      weekdayStart: '18:00',
      weekdayEnd: '21:00',
      weekendStart: '12:00',
      weekendEnd: '21:00',
      enabled: true,
    },
  },
  records: [],
  events: [],
  trips: [],
  widgetLayout: ['today_briefing', 'today_word', 'dday'],
  hasSeenInstallPrompt: false,
  theme: 'light',
};

interface StoreContextType {
  state: AppState;
  isReady: boolean;
  updateProfile: (profileUpdates: Partial<UserProfile>) => void;
  addRecord: (record: Omit<DailyRecord, 'id' | 'createdAt'>) => Promise<boolean>;
  updateRecord: (id: string, updates: Partial<DailyRecord>) => void;
  deleteRecord: (id: string) => Promise<boolean>;
  addEvent: (event: Omit<CoupleEvent, 'id' | 'createdAt'>) => Promise<boolean>;
  deleteEvent: (id: string) => Promise<boolean>;
  switchRole: () => void;
  reset: () => void;
  disconnect: () => Promise<boolean>;
  deleteAccount: () => Promise<boolean>;
  signOut: () => Promise<void>;
  setSetupComplete: (complete: boolean) => void;
  setOnboardingStep: (step: number) => void;
  setHighlightedRecordId: (id?: string) => void;
  setAuthenticatedUser: (user: AuthUser | null) => void;
  startDemo: () => void;
  setWidgetLayout: (layout: string[]) => void;
  setHasSeenInstallPrompt: (seen: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

const StoreContext = createContext<StoreContextType | null>(null);
const localRepository = new LocalStorageRepository();

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthChecked, setIsAuthChecked] = useState(!supabase);

  useEffect(() => {
    localRepository.loadState().then((stored) => {
      if (stored) {
        setState({
          ...DEFAULT_STATE,
          ...stored,
          theme: stored.theme || 'light',
        });
      }
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!supabase || !isHydrated) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const provider = (session.user.app_metadata?.provider as 'apple' | 'google' | 'email') || 'google';
        const authUser: AuthUser = {
          id: session.user.id,
          email: session.user.email,
          provider,
        };
        
        const dbState = await fetchFullStateFromDB(session.user.id);
        
        setState((prev) => {
          const shouldKeepInviteCode =
            !!dbState?.profile?.couple.coupleId &&
            !dbState.profile.couple.connected &&
            dbState.profile.couple.coupleId === prev.profile.couple.coupleId &&
            prev.authenticatedUser?.id === session.user.id;

          const remoteProfile = dbState?.profile
            ? {
                ...dbState.profile,
                couple: {
                  ...dbState.profile.couple,
                  coupleCode: shouldKeepInviteCode
                    ? prev.profile.couple.coupleCode
                    : dbState.profile.couple.coupleCode,
                },
              }
            : undefined;

          return {
            ...prev,
            authenticatedUser: authUser,
            isDemoMode: false,
            ...(dbState || {}),
            ...(remoteProfile ? { profile: remoteProfile } : {}),
          };
        });
        setIsAuthChecked(true);
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        setState((prev) => ({
          ...DEFAULT_STATE,
          isDemoMode: false,
          widgetLayout: prev.widgetLayout,
          hasSeenInstallPrompt: prev.hasSeenInstallPrompt,
          theme: prev.theme || 'light',
        }));
        setIsAuthChecked(true);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isHydrated]);

  useEffect(() => {
    if (isHydrated) {
      localRepository.saveState(state);
    }
  }, [state, isHydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme || 'light';
    document.documentElement.style.colorScheme = state.theme || 'light';
  }, [state.theme]);

  useEffect(() => {
    if (!supabase || !state.authenticatedUser || !state.profile.couple.coupleId) return;

    const channel = supabase
      .channel('daily_records_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_records',
          filter: `couple_id=eq.${state.profile.couple.coupleId}`,
        },
        async (payload) => {
          const dbState = await fetchFullStateFromDB(state.authenticatedUser!.id);
          if (dbState && dbState.records) {
             setState(prev => ({ ...prev, records: dbState.records! }));
          }
        }
      )
      .subscribe();

    const eventChannel = supabase
      .channel('events_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `couple_id=eq.${state.profile.couple.coupleId}`,
        },
        async (payload) => {
          const dbState = await fetchFullStateFromDB(state.authenticatedUser!.id);
          if (dbState && dbState.events) {
             setState(prev => ({ ...prev, events: dbState.events! }));
          }
        }
      )
      .subscribe();

    const tripsChannel = supabase
      .channel('trips_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trips',
          filter: `couple_id=eq.${state.profile.couple.coupleId}`,
        },
        async (payload) => {
          const dbState = await fetchFullStateFromDB(state.authenticatedUser!.id);
          if (dbState && dbState.trips) {
             setState(prev => ({ ...prev, trips: dbState.trips! }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
      supabase?.removeChannel(eventChannel);
      supabase?.removeChannel(tripsChannel);
    };
  }, [state.profile.couple.coupleId, state.authenticatedUser]);

  useEffect(() => {
    const client = supabase;
    if (
      !client ||
      !state.authenticatedUser ||
      !state.profile.couple.coupleId ||
      state.profile.couple.connected
    ) {
      return;
    }

    let cancelled = false;
    const checkForPartner = async () => {
      const { data, error } = await client.rpc('get_partner_profile');
      if (cancelled || error || !data?.length) return;

      setState((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          couple: {
            ...prev.profile.couple,
            partnerName: data[0].display_name || '파트너',
            coupleCode: '',
            connected: true,
            status: 'active',
          },
        },
      }));
    };

    checkForPartner();
    const intervalId = window.setInterval(checkForPartner, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    state.authenticatedUser,
    state.profile.couple.connected,
    state.profile.couple.coupleId,
  ]);

  const updateProfile = (profileUpdates: Partial<UserProfile>) => {
    setState((prev) => {
      const newProfile = {
        ...prev.profile,
        ...profileUpdates,
      };
      const newState = { ...prev, profile: newProfile };

      // Async DB Sync
      if (newState.authenticatedUser && !newState.isDemoMode) {
        const userId = newState.authenticatedUser.id;
        
        // Update basic profile and military
        if (profileUpdates.myName || profileUpdates.military) {
           supabase?.from('profiles').update({
             display_name: newProfile.myName,
             military_info: newProfile.military,
             updated_at: new Date().toISOString()
           }).eq('id', userId).then(({error}) => {
             if (error) console.error('Failed to update profile:', error);
           });
        }
        
        // Update contact preferences
        if (profileUpdates.contact) {
           supabase?.from('contact_preferences').upsert({
             user_id: userId,
             weekday_start: newProfile.contact.weekdayStart,
             weekday_end: newProfile.contact.weekdayEnd,
             weekend_start: newProfile.contact.weekendStart,
             weekend_end: newProfile.contact.weekendEnd
           }).then(({error}) => {
             if (error) console.error('Failed to update contact:', error);
           });
        }
      }
      
      return newState;
    });
  };

  const addRecord = async (record: Omit<DailyRecord, 'id' | 'createdAt'>): Promise<boolean> => {
    const newRecord: DailyRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    if (!state.isDemoMode && state.authenticatedUser) {
      const coupleId = state.profile.couple.coupleId;
      if (!coupleId) {
        console.error('Cannot save record without an active couple.');
        return false;
      }

      try {
        const saved = await saveRecordToDB(newRecord, coupleId, state.authenticatedUser.id);
        if (!saved) return false;
      } catch (error) {
        console.error('Failed to save record:', error);
        return false;
      }
    }

    setState((prev) => ({
      ...prev,
      records: [...prev.records, newRecord],
    }));
    return true;
  };

  const updateRecord = (id: string, updates: Partial<DailyRecord>) => {
    setState((prev) => {
      const newRecords = prev.records.map((r) => (r.id === id ? { ...r, ...updates } : r));
      const newState = { ...prev, records: newRecords };
      if (newState.authenticatedUser && newState.profile.couple.coupleId) {
        const updatedRecord = newRecords.find(r => r.id === id);
        if (updatedRecord) saveRecordToDB(updatedRecord, newState.profile.couple.coupleId, newState.authenticatedUser.id);
      }
      return newState;
    });
  };

  const deleteRecord = async (id: string): Promise<boolean> => {
    if (!state.isDemoMode && state.authenticatedUser) {
      try {
        const deleted = await deleteRecordFromDB(id);
        if (!deleted) return false;
      } catch (error) {
        console.error('Failed to delete record:', error);
        return false;
      }
    }

    setState((prev) => ({
      ...prev,
      records: prev.records.filter((record) => record.id !== id),
    }));
    return true;
  };

  const addEvent = async (
    event: Omit<CoupleEvent, 'id' | 'createdAt'>,
  ): Promise<boolean> => {
    const newEvent: CoupleEvent = {
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    let eventToAdd = newEvent;
    if (!state.isDemoMode && state.authenticatedUser) {
      if (!state.profile.couple.coupleId) {
        console.error('Cannot save event without an active couple.');
        return false;
      }

      try {
        const saved = await import('@/lib/events').then((module) =>
          module.saveEventToDB(newEvent),
        );
        if (!saved) return false;
        eventToAdd = saved;
      } catch (error) {
        console.error('Failed to save event:', error);
        return false;
      }
    }

    setState((prev) => ({ ...prev, events: [...prev.events, eventToAdd] }));
    return true;
  };

  const deleteEvent = async (id: string): Promise<boolean> => {
    if (!state.isDemoMode && state.authenticatedUser) {
      try {
        const deleted = await import('@/lib/events').then((module) =>
          module.deleteEventFromDB(id),
        );
        if (!deleted) return false;
      } catch (error) {
        console.error('Failed to delete event:', error);
        return false;
      }
    }

    setState((prev) => ({
      ...prev,
      events: prev.events.filter((event) => event.id !== id),
    }));
    return true;
  };

  const switchRole = () => {
    setState((prev) => {
      const { myName, role, couple } = prev.profile;
      return {
        ...prev,
        profile: {
          ...prev.profile,
          myName: couple.partnerName,
          role: (role === 'gomsin' ? 'soldier' : 'gomsin') as Role,
          couple: {
            ...couple,
            partnerName: myName,
          },
        },
      };
    });
  };

  const reset = () => {
    setState((prev) => ({ ...DEFAULT_STATE, theme: prev.theme || 'light' }));
  };

  const disconnect = async (): Promise<boolean> => {
    try {
      if (isSupabaseConfigured) {
        const disconnected = await disconnectCoupleFromDB();
        if (!disconnected) return false;
      }
      localStorage.removeItem(STORE_KEY_V1);
      localStorage.removeItem(STORE_KEY); // 보안: 연결 해제 시 로컬 캐시 즉각 파기

      setState((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          couple: {
            ...prev.profile.couple,
            connected: false,
            coupleCode: '',
            status: 'disconnected',
          },
        },
        records: [], // 연결 해제 시 기록도 초기화
        events: [],
        trips: [],
      }));
      return true;
    } catch (e) {
      console.error('Failed to disconnect:', e);
      return false;
    }
  };

  const signOut = async () => {
    await authRepository.signOut();
    localStorage.removeItem(STORE_KEY_V1);
    localStorage.removeItem(STORE_KEY); // 보안: 로그아웃 시 로컬 캐시 즉각 파기
    setState((prev) => ({ ...DEFAULT_STATE, theme: prev.theme || 'light' }));
  };

  const deleteAccount = async (): Promise<boolean> => {
    if (state.isDemoMode) {
      setState((prev) => ({ ...DEFAULT_STATE, theme: prev.theme || 'light' }));
      return true;
    }

    const deleted = await deleteAccountFromDB();
    if (!deleted) return false;

    await authRepository.signOut();
    localStorage.removeItem(STORE_KEY_V1);
    localStorage.removeItem(STORE_KEY);
    setState((prev) => ({ ...DEFAULT_STATE, theme: prev.theme || 'light' }));
    return true;
  };

  const setSetupComplete = (complete: boolean) => {
    setState((prev) => ({ ...prev, setupComplete: complete }));
  };

  const setOnboardingStep = (step: number) => {
    setState((prev) => ({ ...prev, onboardingStep: step }));
  };

  const setHighlightedRecordId = (id?: string) => {
    setState((prev) => ({ ...prev, highlightedRecordId: id }));
  };

  const startDemo = () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const daysAgo = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d.toISOString().split('T')[0];
    };

    setState((prev) => ({
      ...prev,
      setupComplete: true,
      isDemoMode: true,
      authenticatedUser: null,
      profile: {
        ...prev.profile,
        myName: '춘향',
        role: 'gomsin',
        couple: {
          ...prev.profile.couple,
          partnerName: '몽룡',
          coupleCode: '123456',
          connected: true,
          status: 'active',
        },
      },
      records: [
        // --- Today ---
        {
          id: 'rec-demo-1',
          date: todayStr,
          time: '08:30',
          authorRole: 'gomsin',
          log: '오늘 출근길 날씨가 너무 좋다 🌸',
          attachments: [
            { type: 'photo', name: '출근길_풍경.jpg', url: 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=500&auto=format&fit=crop' }
          ],
          isPrivate: false,
          createdAt: `${todayStr}T08:30:00.000Z`,
        },
        {
          id: 'rec-demo-2',
          date: todayStr,
          time: '11:20',
          authorRole: 'gomsin',
          log: '오전 업무가 꼬여서 조금 지쳤어.',
          reaction: 'hard',
          isPrivate: false,
          createdAt: `${todayStr}T11:20:00.000Z`,
        },
        {
          id: 'rec-demo-3',
          date: todayStr,
          time: '12:40',
          authorRole: 'gomsin',
          log: '오늘 점심 메뉴는 돈까스!',
          attachments: [
            { type: 'photo', name: '점심_사진.jpg', url: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop' }
          ],
          isPrivate: false,
          createdAt: `${todayStr}T12:40:00.000Z`,
        },
        {
          id: 'rec-demo-4',
          date: todayStr,
          time: '13:10',
          authorRole: 'gomsin',
          log: '그래도 밥 먹으니 좀 살겠다 😋',
          isPrivate: false,
          createdAt: `${todayStr}T13:10:00.000Z`,
        },
        {
          id: 'rec-demo-5',
          date: todayStr,
          time: '19:15',
          authorRole: 'gomsin',
          log: '퇴근하고 집 가는 길에 남기는 음성 편지 💌',
          attachments: [
            { type: 'voice', name: '저녁_음성한마디.m4a' }
          ],
          isPrivate: false,
          createdAt: `${todayStr}T19:15:00.000Z`,
        },
        // --- 1 day ago ---
        {
          id: 'rec-demo-6',
          date: daysAgo(1),
          time: '09:00',
          authorRole: 'gomsin',
          log: '오늘은 재택이라 여유롭게 시작 ☕',
          isPrivate: false,
          createdAt: `${daysAgo(1)}T09:00:00.000Z`,
        },
        {
          id: 'rec-demo-7',
          date: daysAgo(1),
          time: '15:30',
          authorRole: 'gomsin',
          log: '산책하다가 예쁜 꽃 발견!',
          attachments: [
            { type: 'photo', name: '꽃사진.jpg', url: 'https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=500&auto=format&fit=crop' }
          ],
          reaction: 'good',
          isPrivate: false,
          createdAt: `${daysAgo(1)}T15:30:00.000Z`,
        },
        // --- 3 days ago ---
        {
          id: 'rec-demo-8',
          date: daysAgo(3),
          time: '20:00',
          authorRole: 'gomsin',
          log: '오늘 하루 종일 네 생각뿐이었어 💭',
          reaction: 'thought_of_you',
          isPrivate: false,
          createdAt: `${daysAgo(3)}T20:00:00.000Z`,
        },
        // --- 5 days ago (private record) ---
        {
          id: 'rec-demo-9',
          date: daysAgo(5),
          time: '23:00',
          authorRole: 'gomsin',
          log: '오늘 좀 울었다. 괜찮아질 거야.',
          isPrivate: true,
          createdAt: `${daysAgo(5)}T23:00:00.000Z`,
        },
        // --- 7 days ago ---
        {
          id: 'rec-demo-10',
          date: daysAgo(7),
          time: '12:00',
          authorRole: 'gomsin',
          log: '주말 브런치 먹으러 왔어!',
          attachments: [
            { type: 'photo', name: '브런치.jpg', url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&auto=format&fit=crop' }
          ],
          reaction: 'good',
          isPrivate: false,
          createdAt: `${daysAgo(7)}T12:00:00.000Z`,
        },
        {
          id: 'rec-demo-11',
          date: daysAgo(7),
          time: '18:30',
          authorRole: 'gomsin',
          log: '저녁노을이 진짜 예뻤어',
          attachments: [
            { type: 'photo', name: '노을.jpg', url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=500&auto=format&fit=crop' }
          ],
          isPrivate: false,
          createdAt: `${daysAgo(7)}T18:30:00.000Z`,
        },
        // --- 12 days ago ---
        {
          id: 'rec-demo-12',
          date: daysAgo(12),
          time: '10:15',
          authorRole: 'gomsin',
          log: '오늘 면회 다녀왔어. 보고 싶었어 🥹',
          reaction: 'thought_of_you',
          isPrivate: false,
          createdAt: `${daysAgo(12)}T10:15:00.000Z`,
        },
      ],
    }));
  };

  const setAuthenticatedUser = (user: AuthUser | null) => {
    setState((prev) => ({ ...prev, authenticatedUser: user }));
  };

  const setWidgetLayout = (layout: string[]) => {
    setState((prev) => ({ ...prev, widgetLayout: layout }));
  };

  const setHasSeenInstallPrompt = (seen: boolean) => {
    setState((prev) => ({ ...prev, hasSeenInstallPrompt: seen }));
  };

  const setTheme = (theme: 'light' | 'dark') => {
    setState((prev) => ({ ...prev, theme }));
  };

  return (
    <StoreContext.Provider
      value={{
        state,
        isReady: isHydrated && isAuthChecked,
        updateProfile,
        addRecord,
        updateRecord,
        deleteRecord,
        addEvent,
        deleteEvent,
        switchRole,
        reset,
        disconnect,
        deleteAccount,
        signOut,
        setSetupComplete,
        setOnboardingStep,
        setHighlightedRecordId,
        setAuthenticatedUser,
        startDemo,
        setWidgetLayout,
        setHasSeenInstallPrompt,
        setTheme,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}
