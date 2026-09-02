import { createContext } from 'react';
import type { AppState, UserProfile, DailyRecord, AuthUser, CoupleEvent, Role } from '@/types';
import type { CoupleHighlightDraft, HighlightMutationResult } from '@/lib/highlights';
import type { AccountDeletionOutcome, DeletionStatus } from '@/lib/accountDeletion';
import type { ServerErrorKind } from '@/lib/serverErrors';
import type { AuthSyncStage } from '@/lib/sync';
import type { CoupleLifecycle } from '@/lib/coupleLifecycle';

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

/**
 * Why a record mutation did not happen.
 *
 * Server-side causes reuse `ServerErrorKind` verbatim so the classification made
 * in `serverErrors.ts` is not re-invented; the extra variants are the local
 * refusals that never reach the network at all.
 */
export type RecordMutationReason =
  | ServerErrorKind
  /** The identity or couple space changed while the request was in flight. */
  | 'stale'
  /** No such record in local state. */
  | 'missing'
  /** The record belongs to the partner. */
  | 'not_owner'
  /** This account has no couple space (genuinely personal). */
  | 'no_workspace'
  /** Membership could not be resolved, so the write was not attempted. */
  | 'workspace_unresolved'
  /**
   * Membership could not be resolved because the RPC that answers it is not
   * deployed. Distinct from `workspace_unresolved` because a retry cannot fix it
   * and the user is not the one who can.
   */
  | 'workspace_unconfigured'
  /** A queued record belongs to a different couple space than the current one. */
  | 'couple_changed'
  /** The device has crossed the write floor but has not completed protection setup. */
  | 'protection_required'
  /** A deletion is pending for this account. */
  | 'deletion_pending';

/**
 * Result of a record mutation.
 *
 * `error` is ALWAYS populated on failure and always matches `reason`. That is
 * what removes the composer's old "check your internet connection" fallback:
 * there is no longer a case where the store fails without saying why.
 */
export type RecordMutationResult =
  | { ok: true }
  | { ok: false; reason: RecordMutationReason; error: string };

/**
 * A conversation-mark write and its immediate authoritative reconciliation.
 *
 * `syncPending` means the server accepted the mutation but the follow-up read
 * could not yet prove the screen is current. It must never be presented as a
 * plain failure (which invites a duplicate retry) or a fully reflected success.
 */
export interface TalkAboutMutationResult {
  ok: boolean;
  error?: string;
  syncPending?: boolean;
}

export interface StoreContextType {
  state: AppState;
  isReady: boolean;
  /** Initial account hydration failed; account existence must not be inferred. */
  authSyncUnavailable: boolean;
  /**
   * Why hydration failed, when it did.
   *
   * Lets the outage screen say "your session expired" instead of blaming the
   * connection for an authorization problem. `null` while hydration is healthy.
   */
  authSyncReason: ServerErrorKind | null;
  /** Safe support code identifying which account read failed. */
  authSyncStage: AuthSyncStage | null;
  /** Sanitized PostgREST/PostgreSQL code; never a raw server message. */
  sharedSyncStatus: SharedSyncStatus;
  /**
   * Server-authoritative couple lifecycle.
   *
   * `unknown` means the question could not be answered and MUST NOT be rendered
   * as `personal`: telling a connected user they have no couple space is exactly
   * the failure this state exists to prevent.
   */
  coupleLifecycle: CoupleLifecycle;
  /** ISO expiry of the outstanding invitation, when one is known to exist. */
  invitationExpiresAt: string | null;
  /** Re-read the couple lifecycle from the server. */
  refreshCoupleLifecycle: () => Promise<CoupleLifecycle>;
  /**
   * Try to rescue an unusable session: one refresh attempt, then sign out.
   *
   * Exposed because the invitation RPC is the one authenticated action pages
   * issue directly. When the server answers `not_authenticated` the honest copy
   * ("세션이 만료되었어요") is not enough on its own -- the session still has to be
   * refreshed or ended, and duplicating that here would create a second,
   * subtly different recovery path. Single-flight inside the store: N callers
   * cause one refresh attempt. Resolves to whether the session was rescued.
   */
  recoverExpiredSession: () => Promise<boolean>;
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
  updateProfile: (
    profileUpdates: Partial<UserProfile>,
    options?: { persist?: boolean },
  ) => Promise<boolean>;
  saveCoupleHighlight: (draft: CoupleHighlightDraft) => Promise<HighlightMutationResult>;
  deleteCoupleHighlight: (highlightId: string) => Promise<boolean>;
  setPartnerUsername: (username: string) => Promise<boolean>;
  addRecord: (record: Omit<DailyRecord, 'id' | 'createdAt'>) => Promise<boolean>;
  addRecordWithMedia: (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files: File[],
    options?: {
      /** Pins a long-running media preparation to the couple it started in. */
      expectedCoupleId?: string;
      /** A post keeps its selected order by committing either every photo or none. */
      allOrNothingMedia?: boolean;
    },
  ) => Promise<{
    ok: boolean;
    failedFiles: string[];
    error?: string;
    queued?: boolean;
    reason?: RecordMutationReason;
    /** Present once the record row exists, including a durable queued intent. */
    recordId?: string;
  }>;
  /**
   * Store a record for later without attempting the write.
   *
   * Called when the device reports itself offline, which is the one connectivity
   * fact the OS is trusted about. Resolves `{ queued: false }` with a reason when it
   * genuinely cannot be stored -- no IndexedDB, or no local couple space to attach
   * it to -- so a surface never tells the user their record is safe when it is not.
   */
  queueRecordForLater: (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files: File[],
  ) => Promise<{ queued: boolean; error?: string }>;
  /** Deliver everything queued for this account, oldest first. */
  flushOutbox: () => Promise<{ delivered: number; requeued: number; blocked: number }>;
  /** Un-block every stopped entry and flush again. Returns how many were unblocked. */
  retryBlockedRecords: () => Promise<number>;
  /** Discard the whole queue for this account. The only path to undelivered loss. */
  discardQueuedRecords: () => Promise<number>;
  /** Queued and still going to be retried automatically. */
  outboxWaiting: number;
  /** Queued but no longer retried automatically, so it needs the user. */
  outboxBlocked: number;
  updateRecord: (id: string, updates: Partial<DailyRecord>) => Promise<RecordMutationResult>;
  deleteRecord: (id: string) => Promise<RecordMutationResult>;
  /**
   * Add and/or remove media on an EXISTING record.
   *
   * Separate from `updateRecord` on purpose: the strict save -> upload -> patch
   * ordering that storage RLS requires is pinned by tests against
   * `addRecordWithMedia`, and widening `updateRecord` would have put a second,
   * differently-ordered media path behind the same contract.
   */
  updateRecordMedia: (
    id: string,
    changes: {
      addFiles?: File[];
      removePaths?: string[];
      /** Keep the existing row unchanged unless every added file succeeds. */
      allOrNothing?: boolean;
    },
  ) => Promise<{
    ok: boolean;
    failedFiles: string[];
    error?: string;
    /** Preserves retryable transport causes for offline post replay. */
    reason?: RecordMutationReason;
  }>;
  addEvent: (event: Omit<CoupleEvent, 'id' | 'createdAt'>) => Promise<boolean>;
  updateEvent: (
    id: string,
    updates: Partial<Omit<CoupleEvent, 'id' | 'coupleId' | 'createdBy' | 'createdAt'>>,
  ) => Promise<boolean>;
  deleteEvent: (id: string) => Promise<boolean>;
  reloadEvents: () => Promise<{ ok: boolean; reason?: 'forbidden' | 'error' }>;
  disconnect: () => Promise<boolean>;
  deleteAccount: () => Promise<AccountDeletionOutcome>;
  signOut: () => Promise<void>;
  setSetupComplete: (complete: boolean) => void;
  setOnboardingStep: (step: number) => void;
  setHighlightedRecordId: (id?: string) => void;
  /**
   * "이따 이야기하기" (migration 038). `markTalkAbout` / `unmarkTalkAbout`
   * act on the caller's own flag; `resolveTalkAbout` clears the topic for
   * both partners once the conversation has actually happened.
   */
  markTalkAbout: (recordId: string) => Promise<TalkAboutMutationResult>;
  unmarkTalkAbout: (recordId: string) => Promise<TalkAboutMutationResult>;
  resolveTalkAbout: (recordId: string) => Promise<TalkAboutMutationResult>;
  setAuthenticatedUser: (user: AuthUser | null) => void;
  /**
   * `role` selects which of the two per-role layouts is written. It defaults to
   * `gomsin` so existing call sites keep their meaning.
   */
  setWidgetLayout: (layout: string[], role?: Role) => void;
  setHasSeenInstallPrompt: (seen: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const StoreContext = createContext<StoreContextType | null>(null);
