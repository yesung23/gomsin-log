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
import {
  saveRecordToDB,
  deleteRecordFromDB,
  uploadRecordAttachment,
  createLocalAttachment,
} from '@/lib/records';
import type { Attachment } from '@/types';
import {
  addDays,
  addMonths,
  calculateDischargeDate,
  localToday,
  toLocalDateString,
} from '@/lib/utils';

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
      // 예시 날짜를 넣지 않습니다. 미설정이면 위젯이 입력을 유도합니다.
      anniversaryDate: undefined,
      coupleCode: '',
      connected: false,
      status: 'pending',
    },
    military: {
      branch: 'army',
      militaryStatus: 'unknown',
      enlistmentDate: undefined,
      expectedDischargeDate: undefined,
      dischargeDateSource: 'unknown',
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
  myMemo: '',
};

/**
 * 기록 저장 결과. 레코드는 저장됐지만 일부 첨부 업로드만 실패할 수 있어
 * 실패 개수를 따로 알려줍니다.
 */
export interface AddRecordResult {
  ok: boolean;
  failedUploads: number;
}

interface StoreContextType {
  state: AppState;
  isReady: boolean;
  updateProfile: (profileUpdates: Partial<UserProfile>) => void;
  addRecord: (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files?: File[],
  ) => Promise<AddRecordResult>;
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
  setMyMemo: (memo: string) => void;
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
          myMemo: prev.myMemo || '',
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
        
        // Update couple anniversary (couples 테이블은 active 멤버만 수정 가능)
        if (profileUpdates.couple && newProfile.couple.coupleId) {
          supabase?.from('couples').update({
            anniversary_date: newProfile.couple.anniversaryDate || null,
            updated_at: new Date().toISOString(),
          }).eq('id', newProfile.couple.coupleId).then(({ error }) => {
            if (error) console.error('Failed to update couple:', error);
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

  const addRecord = async (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files: File[] = [],
  ): Promise<AddRecordResult> => {
    const newRecord: DailyRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    // 데모/오프라인 모드: 브라우저 안에서만 유효한 로컬 첨부를 사용합니다.
    if (state.isDemoMode || !state.authenticatedUser) {
      const localAttachments = files.map(createLocalAttachment);
      const merged = [...(newRecord.attachments || []), ...localAttachments];
      const localRecord: DailyRecord = {
        ...newRecord,
        attachments: merged.length > 0 ? merged : undefined,
      };
      setState((prev) => ({ ...prev, records: [...prev.records, localRecord] }));
      return { ok: true, failedUploads: 0 };
    }

    const coupleId = state.profile.couple.coupleId;
    if (!coupleId) {
      console.error('Cannot save record without an active couple.');
      return { ok: false, failedUploads: files.length };
    }

    try {
      // 1) Storage RLS(007)가 daily_records 행 존재를 요구하므로 먼저 레코드를 저장합니다.
      const saved = await saveRecordToDB(
        { ...newRecord, attachments: [] },
        coupleId,
        state.authenticatedUser.id,
      );
      if (!saved) return { ok: false, failedUploads: files.length };
    } catch (error) {
      console.error('Failed to save record:', error);
      return { ok: false, failedUploads: files.length };
    }

    // 2) 첨부 업로드 → couple-media/{coupleId}/{recordId}/{uuid}.{ext}
    const uploaded: Attachment[] = [];
    let failedUploads = 0;
    for (const file of files) {
      try {
        const attachment = await uploadRecordAttachment(file, coupleId, newRecord.id);
        if (attachment) uploaded.push(attachment);
        else failedUploads += 1;
      } catch (error) {
        console.error('Failed to upload attachment:', error);
        failedUploads += 1;
      }
    }

    const attachments = [...(newRecord.attachments || []), ...uploaded];
    const finalRecord: DailyRecord = {
      ...newRecord,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    // 3) 업로드된 첨부 정보를 레코드에 반영
    if (uploaded.length > 0) {
      try {
        await saveRecordToDB(finalRecord, coupleId, state.authenticatedUser.id);
      } catch (error) {
        console.error('Failed to attach media to record:', error);
        failedUploads += uploaded.length;
      }
    }

    setState((prev) => ({ ...prev, records: [...prev.records, finalRecord] }));
    return { ok: true, failedUploads };
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
        const deleted = await deleteRecordFromDB(id, state.profile.couple.coupleId);
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
    const todayStr = toLocalDateString(localToday());
    const daysAgo = (n: number) => addDays(todayStr, -n);
    const daysLater = (n: number) => addDays(todayStr, n);

    // 데모 데이터는 오늘 날짜를 기준으로 생성해서 위젯 계산이 항상 자연스럽게 보이도록 합니다.
    const demoAnniversary = daysAgo(430);
    const demoEnlistment = daysAgo(210);
    const demoDischarge = calculateDischargeDate(demoEnlistment, 'army');

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
          anniversaryDate: demoAnniversary,
          coupleCode: '123456',
          connected: true,
          status: 'active',
        },
        military: {
          ...prev.profile.military,
          branch: 'army',
          militaryStatus: 'serving',
          enlistmentDate: demoEnlistment,
          expectedDischargeDate: demoDischarge,
          dischargeDateSource: 'calculated',
        },
      },
      events: [
        {
          id: 'evt-demo-1',
          coupleId: 'demo-couple-id',
          createdBy: 'demo-user',
          title: '주말 면회',
          eventType: 'visit',
          startDate: daysLater(12),
          isPrivate: false,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'evt-demo-2',
          coupleId: 'demo-couple-id',
          createdBy: 'demo-user',
          title: '정기 휴가',
          eventType: 'vacation',
          startDate: daysLater(34),
          endDate: daysLater(38),
          isPrivate: false,
          createdAt: new Date().toISOString(),
        },
      ],
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
        // --- 1년 전 오늘 (추억 다시보기 위젯용) ---
        {
          id: 'rec-demo-13',
          date: addMonths(todayStr, -12),
          time: '17:45',
          authorRole: 'gomsin',
          log: '작년 이맘때 같이 걸었던 길, 아직 기억나?',
          attachments: [
            { type: 'photo', name: '작년_산책.jpg', url: 'https://images.unsplash.com/photo-1476231682828-37e571bc172f?w=500&auto=format&fit=crop' }
          ],
          reaction: 'good',
          isPrivate: false,
          createdAt: `${addMonths(todayStr, -12)}T17:45:00.000Z`,
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

  // 나만의 메모: 서버로 보내지 않고 기기 localStorage에만 저장합니다.
  const setMyMemo = (memo: string) => {
    setState((prev) => ({ ...prev, myMemo: memo }));
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
        setMyMemo,
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
