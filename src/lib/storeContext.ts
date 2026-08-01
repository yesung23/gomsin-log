import { createContext } from 'react';
import type { AppState, UserProfile, DailyRecord, AuthUser, CoupleEvent } from '@/types';
import type { AccountDeletionOutcome, DeletionStatus } from '@/lib/accountDeletion';

/**
 * Trustworthiness of the shared couple workspace currently on screen.
 *
 * `live` needs no explanation to the user. `delayed` and `unavailable` both do,
 * because in one case the data is real but frozen and in the other it is hidden.
 *
 * This is ONE OF THREE ORTHOGONAL AVAILABILITY AXES and must not be conflated
 * with the others, because reusing either of them for deletion status is exactly
 * how a failed check becomes indistinguishable from an authoritative negative:
 *
 *  - `SharedSyncStatus`  - how fresh the shared couple workspace on screen is.
 *  - `authSyncUnavailable` - whether initial account hydration succeeded.
 *  - `DeletionStatus`    - whether this account is being deleted.
 *
 * All combinations are reachable: a `live` workspace can coexist with `pending`;
 * `unavailable` does not imply `unknown` (a local marker yields `pending` while
 * sync is down); `unknown` does not imply `unavailable` (a `getUser()` failure
 * alongside healthy Postgres reads). The only place the axes meet is route
 * precedence, where the recovery gate takes priority over the sync-outage gate.
 */
export type SharedSyncStatus = 'live' | 'delayed' | 'unavailable';

export interface StoreContextType {
  state: AppState;
  isReady: boolean;
  /** Initial account hydration failed; account existence must not be inferred. */
  authSyncUnavailable: boolean;
  sharedSyncStatus: SharedSyncStatus;
  /**
   * Non-null while this account's data has been removed but its login has not.
   * `warnings` is in-memory only and is never persisted.
   */
  accountDeletionRecovery: { warnings: string[] } | null;
  /**
   * Tri-state deletion status. REQUIRED, not optional: no default-value
   * substitution may turn a missing answer into a negative one. `unknown` is
   * never represented, stored, cached, serialized or logged as `clear`.
   */
  deletionStatus: DeletionStatus;
  /** Finish an account deletion whose Auth step did not complete. */
  retryAccountDeletion: () => Promise<AccountDeletionOutcome>;
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
  deleteAccount: () => Promise<AccountDeletionOutcome>;
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
