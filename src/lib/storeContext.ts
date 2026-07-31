import { createContext } from 'react';
import type { AppState, UserProfile, DailyRecord, AuthUser, CoupleEvent } from '@/types';

/**
 * Trustworthiness of the shared couple workspace currently on screen.
 *
 * `live` needs no explanation to the user. `delayed` and `unavailable` both do,
 * because in one case the data is real but frozen and in the other it is hidden.
 */
export type SharedSyncStatus = 'live' | 'delayed' | 'unavailable';

export interface StoreContextType {
  state: AppState;
  isReady: boolean;
  sharedSyncStatus: SharedSyncStatus;
  /** Re-verify membership and re-read every shared slice through RLS. */
  retrySharedAccess: () => Promise<boolean>;
  updateProfile: (profileUpdates: Partial<UserProfile>) => void;
  addRecord: (record: Omit<DailyRecord, 'id' | 'createdAt'>) => Promise<boolean>;
  addRecordWithMedia: (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files: File[],
  ) => Promise<{ ok: boolean; failedFiles: string[]; error?: string }>;
  updateRecord: (id: string, updates: Partial<DailyRecord>) => Promise<boolean>;
  deleteRecord: (id: string) => Promise<boolean>;
  addEvent: (event: Omit<CoupleEvent, 'id' | 'createdAt'>) => Promise<boolean>;
  updateEvent: (
    id: string,
    updates: Partial<Omit<CoupleEvent, 'id' | 'coupleId' | 'createdBy' | 'createdAt'>>,
  ) => Promise<boolean>;
  deleteEvent: (id: string) => Promise<boolean>;
  reloadEvents: () => Promise<{ ok: boolean; reason?: 'forbidden' | 'error' }>;
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
