import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, DailyRecord, UserProfile, Role, AuthUser, ILogRepository } from '@/types';
import { authRepository, isSupabaseConfigured } from '@/lib/supabase';

const STORE_KEY = 'gomsinlog.state.v1';

export class LocalStorageRepository implements ILogRepository {
  isConfigured(): boolean {
    return true;
  }

  async loadState(): Promise<AppState | null> {
    try {
      const stored = localStorage.getItem(STORE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error('[gomsinlog] Failed to load state from localStorage', e);
    }
    return null;
  }

  async saveState(state: AppState): Promise<void> {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
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
};

interface StoreContextType {
  state: AppState;
  updateProfile: (profileUpdates: Partial<UserProfile>) => void;
  addRecord: (record: Omit<DailyRecord, 'id' | 'createdAt'>) => void;
  updateRecord: (id: string, updates: Partial<DailyRecord>) => void;
  deleteRecord: (id: string) => void;
  switchRole: () => void;
  reset: () => void;
  disconnect: () => void;
  signOut: () => Promise<void>;
  setSetupComplete: (complete: boolean) => void;
  setOnboardingStep: (step: number) => void;
  setHighlightedRecordId: (id?: string) => void;
  startDemo: () => void;
}

const StoreContext = createContext<StoreContextType | null>(null);
const localRepository = new LocalStorageRepository();

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    localRepository.loadState().then((stored) => {
      if (stored) {
        setState(stored);
      }
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (isHydrated) {
      localRepository.saveState(state);
    }
  }, [state, isHydrated]);

  const updateProfile = (profileUpdates: Partial<UserProfile>) => {
    setState((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        ...profileUpdates,
      },
    }));
  };

  const addRecord = (record: Omit<DailyRecord, 'id' | 'createdAt'>) => {
    const newRecord: DailyRecord = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      records: [...prev.records, newRecord],
    }));
  };

  const updateRecord = (id: string, updates: Partial<DailyRecord>) => {
    setState((prev) => ({
      ...prev,
      records: prev.records.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
  };

  const deleteRecord = (id: string) => {
    setState((prev) => ({
      ...prev,
      records: prev.records.filter((r) => r.id !== id),
    }));
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
    setState(DEFAULT_STATE);
  };

  const disconnect = () => {
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
    }));
  };

  const signOut = async () => {
    await authRepository.signOut();
    setState(DEFAULT_STATE);
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
      authenticatedUser: { id: 'demo-user-id', email: 'demo@gomsinlog.app', provider: 'demo' },
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

  return (
    <StoreContext.Provider
      value={{
        state,
        updateProfile,
        addRecord,
        updateRecord,
        deleteRecord,
        switchRole,
        reset,
        disconnect,
        signOut,
        setSetupComplete,
        setOnboardingStep,
        setHighlightedRecordId,
        startDemo,
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
