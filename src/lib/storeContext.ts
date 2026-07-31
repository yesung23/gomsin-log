import { createContext } from 'react';
import type { AppState, UserProfile, DailyRecord, AuthUser, CoupleEvent } from '@/types';

export interface StoreContextType {
  state: AppState;
  isReady: boolean;
  updateProfile: (profileUpdates: Partial<UserProfile>) => void;
  addRecord: (record: Omit<DailyRecord, 'id' | 'createdAt'>) => Promise<boolean>;
  addRecordWithMedia: (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files: File[],
  ) => Promise<{ ok: boolean; failedFiles: string[]; error?: string }>;
  updateRecord: (id: string, updates: Partial<DailyRecord>) => Promise<boolean>;
  deleteRecord: (id: string) => Promise<boolean>;
  addEvent: (event: Omit<CoupleEvent, 'id' | 'createdAt'>) => Promise<boolean>;
  deleteEvent: (id: string) => Promise<boolean>;
  switchRole: () => void;
  disconnect: () => Promise<boolean>;
  deleteAccount: () => Promise<{ ok: boolean; warnings: string[] }>;
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

export const StoreContext = createContext<StoreContextType | null>(null);
