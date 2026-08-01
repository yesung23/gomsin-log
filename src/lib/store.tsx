import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  DailyRecord,
  UserProfile,
  Role,
  AuthUser,
  CoupleEvent,
  Attachment,
} from '@/types';
import {
  authRepository,
  supabase,
  disconnectCoupleFromDB,
  deleteAccountFromDB,
  saveCoupleAnniversary,
} from '@/lib/supabase';
import { fetchFullStateFromDB, FULL_STATE_UNAVAILABLE } from '@/lib/sync';
import { fetchEventsResultFromDB } from '@/lib/events';
import { fetchTripsResultFromDB, reconcileParentTrips } from '@/lib/trips';
import { visibleRecordsForViewer } from '@/lib/privacy';
import {
  saveRecordToDB,
  deleteRecordFromDB,
  fetchRecordsResultFromDB,
  uploadRecordMedia,
  removeRecordMedia,
  resolveAttachmentUrls,
  classifyMediaFile,
} from '@/lib/records';
import { StoreContext } from '@/lib/storeContext';
import type { SharedSyncStatus } from '@/lib/storeContext';
import {
  assertNever,
  classifyDeletionStatus,
  clearRecoveryMarker,
  deletionStatusLogToken,
  markRecoveryPending,
  readRecoveryMarker,
  serverAnswerFromUser,
  type AccountDeletionOutcome,
  type DeletionStatus,
  type ServerAnswer,
} from '@/lib/accountDeletion';

/** Which slice of shared state a realtime notification affects. */
type SyncSlice = 'records' | 'events' | 'trips';
type ActiveIdentity = { userId: string; generation: number };
type ActiveWorkspace = ActiveIdentity & { coupleId: string };

/**
 * The couple space this account belongs to, whether or not a partner has joined.
 *
 * `create_couple_and_invitation` inserts the creator's membership as `active`, so
 * `get_my_active_couple_id()` already returns this couple and RLS already accepts
 * the owner's reads and writes while the invitation is outstanding. This is the
 * right scope for anything that only touches the caller's own rows.
 */
function stateMatchesLinkedCouple(state: AppState, workspace: ActiveWorkspace): boolean {
  return state.authenticatedUser?.id === workspace.userId
    && state.profile.couple.coupleId === workspace.coupleId
    && state.profile.couple.status !== 'disconnected';
}

/**
 * A couple space with both partners present.
 *
 * Required for anything that can expose one partner's data to the other, which
 * is why realtime, quarantine and reconciliation all key on it.
 */
function stateMatchesWorkspace(state: AppState, workspace: ActiveWorkspace): boolean {
  return stateMatchesLinkedCouple(state, workspace)
    && state.profile.couple.connected
    && state.profile.couple.status === 'active';
}

function workspaceRefMatches(
  value: ActiveWorkspace | null,
  workspace: ActiveWorkspace,
): boolean {
  return value?.generation === workspace.generation
    && value.userId === workspace.userId
    && value.coupleId === workspace.coupleId;
}
/** Coalesce realtime bursts into a single refetch. */
const REALTIME_DEBOUNCE_MS = 250;
/** First HTTP recovery attempt after the couple channel fails. */
const REALTIME_RECOVERY_BASE_DELAY_MS = 2_000;
/** Ceiling for the recovery backoff, which also becomes the fallback poll rate. */
const REALTIME_RECOVERY_MAX_DELAY_MS = 30_000;
/** Stop polling for the partner after roughly 15 minutes. */
const PARTNER_POLL_MAX_ATTEMPTS = 26;
/** Must match --background in styles/index.css for each theme. */
const LIGHT_THEME_COLOR = '#FAF8F5';
const DARK_THEME_COLOR = '#16181D';

/**
 * The theme to use on a device that has never chosen one, so the app opens in
 * dark mode for users whose system is set to dark instead of flashing light.
 */
function preferredTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
import { withTimeout, AUTH_SYNC_TIMEOUT_MS } from '@/lib/async';

const STORE_KEY_V1 = 'gomsinlog.state.v1';
const STORE_KEY = 'gomsinlog.state.v2';

class LocalStorageRepository {
  isConfigured(): boolean {
    return true;
  }

  async loadState(): Promise<Partial<AppState> | null> {
    try {
      localStorage.removeItem(STORE_KEY_V1); // Remove legacy v1 state
      const stored = localStorage.getItem(STORE_KEY);
      if (!stored) return null;
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        localStorage.removeItem(STORE_KEY);
        return null;
      }
      return parsed as Partial<AppState>;
    } catch (e) {
      // Corrupt state must not be retried on every launch.
      localStorage.removeItem(STORE_KEY);
      console.error('[gomsinlog] Failed to load state from localStorage', e);
      return null;
    }
  }

  async saveState(state: AppState, hasAuthenticatedSession = false): Promise<void> {
    try {
      if (hasAuthenticatedSession || !state.isDemoMode) {
        // Authenticated browser storage is a strict device-preference whitelist.
        // Auth, profile, couple, invite, military, contact and shared/private
        // content all remain server/session-owned.
        localStorage.setItem(STORE_KEY, JSON.stringify(carryOverDevicePrefs(state)));
        return;
      }

      const records = state.records.map((record) => {
        if (!record.attachments?.length) return record;
        return {
          ...record,
          attachments: record.attachments
            // Blob URLs are session-only; persisting them guarantees a broken
            // image after reload.
            .filter((attachment) => !(attachment.url?.startsWith('blob:') && !attachment.path))
            .map((attachment) =>
              attachment.url?.startsWith('blob:')
                ? { ...attachment, url: undefined }
                : attachment,
            ),
        };
      });
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, records }));
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

/**
 * Preferences that belong to the device rather than to the signed-in account.
 * These survive sign-out and account switches; everything else must not.
 */
function carryOverDevicePrefs(prev: AppState): Pick<AppState, 'widgetLayout' | 'hasSeenInstallPrompt' | 'theme'> {
  return {
    widgetLayout: prev.widgetLayout,
    hasSeenInstallPrompt: prev.hasSeenInstallPrompt,
    theme: prev.theme || 'light',
  };
}

const localRepository = new LocalStorageRepository();

/**
 * Whether a resolved deletion status must stop a server call.
 *
 * Exhaustive at compile time: a fourth variant, or an unhandled `unknown`, is a
 * TYPE ERROR rather than a silent fall-through into permissive behaviour.
 */
function blocksServerCall(status: DeletionStatus): boolean {
  switch (status.kind) {
    case 'pending':
      return true;
    case 'clear':
      return false;
    case 'unknown':
      // A DELIBERATE AVAILABILITY TRADEOFF, and explicitly NOT fail-closed: an
      // offline user with no deletion outstanding must not be stranded. It is
      // not safe, not verified and not fail-safe -- it confers no settled
      // status at all, which is why the authoritative check is re-issued before
      // the next server call rather than cached.
      return false;
    default:
      return assertNever(status);
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthChecked, setIsAuthChecked] = useState(!supabase);
  const [authSyncUnavailable, setAuthSyncUnavailable] = useState(false);
  /**
   * The user id whose server state we have already loaded. Lets us ignore
   * TOKEN_REFRESHED / USER_UPDATED events instead of re-running the full sync,
   * and lets us detect an account switch so we never show account A's cached
   * records to account B.
   */
  const hydratedUserIdRef = useRef<string | null>(null);
  /** Current authenticated session owner, updated synchronously before async auth hydration. */
  const sessionUserIdRef = useRef<string | null>(null);
  /** Invalidates post-await writes from a previous authenticated identity. */
  const sessionGenerationRef = useRef(0);
  /** Set while signing out / deleting so the persistence effect cannot resurrect the cache. */
  const cachePurgedRef = useRef(false);
  /** Always-current state, so actions can read it without depending on stale closures. */
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Workspace whose shared slices are hidden pending authoritative recovery. */
  const quarantinedWorkspaceRef = useRef<ActiveWorkspace | null>(null);
  /** Blocks background recovery until an explicit disconnect RPC has settled. */
  const pendingDisconnectRef = useRef<ActiveWorkspace | null>(null);
  /** Orders membership checks so an older response cannot undo a newer verdict. */
  const membershipReconciliationRef = useRef(0);
  /**
   * How trustworthy the shared workspace on screen currently is.
   *
   * `live`        - the realtime channel is subscribed and the last check passed.
   * `delayed`     - the channel is down but shared data was re-read over HTTP,
   *                 so it is current as of the last refresh and will not update
   *                 on its own.
   * `unavailable` - authorization could not be confirmed, so shared content is
   *                 hidden until a check succeeds.
   *
   * Kept outside `AppState` on purpose: it describes the transport and the
   * authorization check, not user data, and must never be persisted.
   */
  const [sharedSyncStatus, setSharedSyncStatus] = useState<SharedSyncStatus>('live');
  /** Lets a recovery attempt started from the UI reuse the effect's retry path. */
  const retrySharedAccessRef = useRef<(() => Promise<boolean>) | null>(null);
  /** False once the couple channel reports a terminal transport failure. */
  const realtimeHealthyRef = useRef(true);
  /**
   * Non-null while this account is in account-deletion recovery: its data has
   * been removed but its login has not. `warnings` is kept IN MEMORY ONLY --
   * warning strings can name storage paths, and the durable marker is a boolean
   * carrying no deleted-account content of any kind.
   */
  const [accountDeletionRecovery, setAccountDeletionRecovery] =
    useState<{ warnings: string[] } | null>(null);
  /**
   * Tri-state deletion status. Deliberately NOT part of `AppState`, so it can
   * never reach `localStorage`: `saveState` persists only the
   * `carryOverDevicePrefs` whitelist, which has no deletion field.
   */
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus>({ kind: 'unknown' });
  /**
   * Last observed status, for rendering and logging ONLY. Never a decision
   * input: the pre-flight gate re-issues the authoritative check every time.
   */
  const deletionStatusRef = useRef<DeletionStatus>({ kind: 'unknown' });
  /** Cancels every deferred sync timer owned by the realtime effect. */
  const cancelDeferredSyncRef = useRef<(() => void) | null>(null);

  const replaceStateImmediately = useCallback((nextState: AppState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const updateStateImmediately = useCallback((
    updater: (current: AppState) => AppState,
  ): AppState => {
    const current = stateRef.current;
    const nextState = updater(current);
    if (nextState !== current) replaceStateImmediately(nextState);
    return nextState;
  }, [replaceStateImmediately]);

  const captureActiveIdentity = useCallback((): ActiveIdentity | null => {
    const current = stateRef.current;
    const userId = current.authenticatedUser?.id;
    if (!userId || sessionUserIdRef.current !== userId) return null;
    return { userId, generation: sessionGenerationRef.current };
  }, []);

  const isCurrentIdentity = useCallback((identity: ActiveIdentity): boolean =>
    sessionGenerationRef.current === identity.generation
    && sessionUserIdRef.current === identity.userId
    && stateRef.current.authenticatedUser?.id === identity.userId, []);

  const matchesCurrentWorkspace = useCallback((workspace: ActiveWorkspace): boolean =>
    sessionGenerationRef.current === workspace.generation
    && sessionUserIdRef.current === workspace.userId
    && stateMatchesWorkspace(stateRef.current, workspace), []);

  const isCurrentWorkspace = useCallback((workspace: ActiveWorkspace): boolean =>
    matchesCurrentWorkspace(workspace)
    && !workspaceRefMatches(quarantinedWorkspaceRef.current, workspace),
  [matchesCurrentWorkspace]);

  const captureActiveWorkspace = useCallback((): ActiveWorkspace | null => {
    const identity = captureActiveIdentity();
    const current = stateRef.current;
    const activeCoupleId = current.profile.couple.coupleId;
    if (!identity || !activeCoupleId) return null;
    const workspace = { ...identity, coupleId: activeCoupleId };
    return isCurrentWorkspace(workspace) ? workspace : null;
  }, [captureActiveIdentity, isCurrentWorkspace]);

  /**
   * The couple space this account is attached to, accepted or not.
   *
   * Used by everything that only reads or writes the caller's own rows: the
   * owner of an unaccepted couple space can already do so under RLS, so gating
   * those actions on the partner's arrival only loses the user's own work.
   */
  const captureLinkedCouple = useCallback((): ActiveWorkspace | null => {
    const identity = captureActiveIdentity();
    const linkedCoupleId = stateRef.current.profile.couple.coupleId;
    if (!identity || !linkedCoupleId) return null;
    const workspace = { ...identity, coupleId: linkedCoupleId };
    return stateMatchesLinkedCouple(stateRef.current, workspace) ? workspace : null;
  }, [captureActiveIdentity]);

  const isCurrentLinkedCouple = useCallback((workspace: ActiveWorkspace): boolean =>
    isCurrentIdentity(workspace)
    && stateMatchesLinkedCouple(stateRef.current, workspace),
  [isCurrentIdentity]);

  /**
   * Record a resolved status.
   *
   * There is no promotion path anywhere: the only writers are this function and
   * the resolver it is fed from. No attempt counter, no expiry, no elapsed-time
   * promotion, no `??` default and no `||` fallback can turn `unknown` into
   * `clear`.
   */
  const applyDeletionStatus = useCallback((status: DeletionStatus): DeletionStatus => {
    deletionStatusRef.current = status;
    setDeletionStatus(status);
    if (status.kind === 'unknown') {
      // `withTimeout`'s own warning does not say WHICH question went
      // unanswered, so the distinct token is logged here as well. Never `false`,
      // never `null`, never an omitted field.
      console.warn(
        `[gomsinlog] ${deletionStatusLogToken(status)} - the authoritative deletion check could not complete`,
      );
    }
    return status;
  }, []);

  /**
   * Purge local account CONTENT while retaining the authenticated identity.
   *
   * Deliberately separate from `purgeLocalAccountData`, which stays exactly as
   * it was for sign-out, account switch and fully successful deletion. Here the
   * session is kept on purpose, because the user still has to be able to finish
   * the deletion.
   */
  const purgeLocalContentRetainingIdentity = useCallback((
    expected: ActiveIdentity,
  ): boolean => {
    if (!isCurrentIdentity(expected)) return false;
    const current = stateRef.current;
    membershipReconciliationRef.current += 1;
    quarantinedWorkspaceRef.current = null;
    pendingDisconnectRef.current = null;
    retrySharedAccessRef.current = null;
    // Deliberately NOT bumping `sessionGenerationRef`: the session is kept.
    localStorage.removeItem(STORE_KEY_V1);
    const nextState: AppState = {
      ...DEFAULT_STATE,
      isDemoMode: false,
      ...carryOverDevicePrefs(current),
      authenticatedUser: current.authenticatedUser,
    };
    // Rewrite `STORE_KEY` through the existing save path, then block the save
    // effect so it cannot resurrect the cache on the next render. The recovery
    // marker lives at its own top-level key and is untouched by either.
    void localRepository.saveState(nextState, sessionUserIdRef.current !== null);
    cachePurgedRef.current = true;
    // Pin hydration to the retained user so the hydration effect cannot
    // re-fetch the data that was just removed.
    hydratedUserIdRef.current = expected.userId;
    replaceStateImmediately(nextState);
    return true;
  }, [isCurrentIdentity, replaceStateImmediately]);

  /**
   * Resolve the tri-state deletion status for `userId`.
   *
   * The local marker is read FIRST and synchronously. A positive marker
   * outranks any server answer -- it is cleared only after confirmed Auth
   * deletion, and a `not_pending` answer is not that confirmation -- so it
   * resolves the status with NO round-trip at all. That is what blocks an
   * offline initiating device before first paint.
   */
  const verifyDeletionStatus = useCallback(async (
    userId: string,
  ): Promise<DeletionStatus> => {
    const marker = readRecoveryMarker(userId);
    if (marker === 'active') {
      return applyDeletionStatus(classifyDeletionStatus(marker, { kind: 'unavailable' }));
    }

    const client = supabase;
    if (!client) return applyDeletionStatus(classifyDeletionStatus(marker, { kind: 'unavailable' }));

    // `supabase.auth.getUser()` is a SERVER round-trip. `session.user.app_metadata`
    // is deliberately not used: that JWT was issued before the flag was written
    // and reports the stale value on exactly the reload that must catch it.
    //
    // `withTimeout` resolves the CALLER'S OWN fallback on both timeout and
    // rejection, so the fallback's type IS the state. It must be `unavailable`.
    // Passing `not_pending` (or `false`) here would reintroduce the original
    // defect exactly: an unanswered question becoming an authoritative negative.
    const server = await withTimeout<ServerAnswer>(
      (async (): Promise<ServerAnswer> => {
        try {
          const { data, error } = await client.auth.getUser();
          return error ? { kind: 'unavailable' } : serverAnswerFromUser(data?.user);
        } catch {
          // The question could not be answered. That is NOT an answer, and
          // specifically not `not_pending`.
          return { kind: 'unavailable' };
        }
      })(),
      AUTH_SYNC_TIMEOUT_MS,
      { kind: 'unavailable' } as ServerAnswer,
    );
    // A positive server answer also writes the local marker, so the next reload
    // is instant and does not depend on repeating the round-trip.
    if (server.kind === 'pending') markRecoveryPending(userId);
    return applyDeletionStatus(classifyDeletionStatus(marker, server));
  }, [applyDeletionStatus]);

  /**
   * Abort with NO WRITES APPLIED, then purge local content and enter recovery.
   *
   * Runs synchronously with respect to the caller's first request: the caller
   * returns on the gate's `pending` result and never reaches its request.
   *
   * FORWARD CONSTRAINT: the "no queued mutation delivered" claim holds because
   * there is no outbox in this codebase -- every mutation is issued directly by
   * the store methods, and the only deferred work is two read-only timer-based
   * schedulers, both cancelled in step 4. IF A PERSISTENT MUTATION QUEUE IS EVER
   * ADDED, a drain-blocking gate must be added at its drain point too.
   */
  const abortForPendingDeletion = useCallback((identity: ActiveIdentity): void => {
    // (1) Make the verdict durable first, so it survives a reload without
    //     needing the round-trip again.
    markRecoveryPending(identity.userId);
    // (2) Content goes, identity and session stay, device prefs untouched.
    purgeLocalContentRetainingIdentity(identity);
    // (3) Close the route gate on the next render.
    setAccountDeletionRecovery((previous) => previous ?? { warnings: [] });
    applyDeletionStatus({ kind: 'pending' });
    // (4) Nothing deferred may fire afterwards.
    cancelDeferredSyncRef.current?.();
  }, [applyDeletionStatus, purgeLocalContentRetainingIdentity]);

  /**
   * Pre-flight gate for every server synchronization and every server mutation.
   *
   * Re-issues the authoritative check on EVERY entry; it never reads a cached
   * verdict. A `pending` result aborts the attempt before its first request is
   * sent, so no server state is modified and no write is applied.
   */
  const ensureNotPendingBeforeServerCall = useCallback(async (): Promise<DeletionStatus> => {
    const identity = captureActiveIdentity();
    if (!identity) return { kind: 'unknown' };
    const status = await verifyDeletionStatus(identity.userId);
    if (status.kind === 'pending' && isCurrentIdentity(identity)) {
      abortForPendingDeletion(identity);
    }
    return status;
  }, [abortForPendingDeletion, captureActiveIdentity, isCurrentIdentity, verifyDeletionStatus]);

  useEffect(() => {
    localRepository.loadState().then((stored) => {
      if (stored) {
        const theme = stored.theme === 'light' || stored.theme === 'dark'
          ? stored.theme
          : preferredTheme();
        const devicePrefs = {
          widgetLayout: Array.isArray(stored.widgetLayout)
            && stored.widgetLayout.every((item) => typeof item === 'string')
            ? stored.widgetLayout
            : DEFAULT_STATE.widgetLayout,
          hasSeenInstallPrompt: typeof stored.hasSeenInstallPrompt === 'boolean'
            ? stored.hasSeenInstallPrompt
            : DEFAULT_STATE.hasSeenInstallPrompt,
          theme,
        };
        const nextState: AppState = stored.isDemoMode === true
          ? {
              ...DEFAULT_STATE,
              ...stored,
              ...devicePrefs,
              isDemoMode: true,
              authenticatedUser: null,
            } as AppState
          : {
              ...DEFAULT_STATE,
              ...devicePrefs,
              isDemoMode: false,
            };
        stateRef.current = nextState;
        setState(nextState);
      } else {
        const nextState = { ...stateRef.current, theme: preferredTheme() };
        stateRef.current = nextState;
        setState(nextState);
      }
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!supabase || !isHydrated) return;
    let disposed = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Revoke the previous account's realtime refresh authority immediately,
      // before any asynchronous state hydration for the new session begins.
      const nextSessionUserId = session?.user?.id ?? null;
      const previousSessionUserId = sessionUserIdRef.current;
      const previousHydratedUserId = hydratedUserIdRef.current;
      const identityChanged = previousSessionUserId !== nextSessionUserId;
      if (identityChanged) {
        sessionGenerationRef.current += 1;
        membershipReconciliationRef.current += 1;
        quarantinedWorkspaceRef.current = null;
        pendingDisconnectRef.current = null;
        retrySharedAccessRef.current = null;
        realtimeHealthyRef.current = true;
        setSharedSyncStatus('live');
        setAuthSyncUnavailable(false);
        hydratedUserIdRef.current = null;
        // Fail closed before account hydration starts: the previous account's
        // React state must not remain rendered during the network request.
        setIsAuthChecked(false);
        const current = stateRef.current;
        const clearedState: AppState = {
          ...DEFAULT_STATE,
          isDemoMode: false,
          ...carryOverDevicePrefs(current),
        };
        stateRef.current = clearedState;
        setState(clearedState);
      }
      sessionUserIdRef.current = nextSessionUserId;
      const authGeneration = sessionGenerationRef.current;
      // The callback is intentionally sync: supabase-js serialises auth events and
      // awaiting inside it can deadlock other auth calls.
      void (async () => {
        if (disposed) return;

        if (session?.user) {
          const sessionUser = session.user;
          const provider = (sessionUser.app_metadata?.provider as AuthUser['provider']) || 'google';
          const authUser: AuthUser = {
            id: sessionUser.id,
            email: sessionUser.email,
            provider,
          };

          // A refreshed token for the account we already loaded changes nothing.
          if (
            (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') &&
            hydratedUserIdRef.current === sessionUser.id
          ) {
            setIsAuthChecked(true);
            return;
          }

          // Deletion recovery, resolved BEFORE any account data is fetched.
          //
          // The local marker is read synchronously, before the first await, so
          // an initiating device is blocked on first paint with no network time
          // spent and no round-trip required. A positive marker outranks any
          // server answer, so this branch needs no `getUser()` call at all.
          if (readRecoveryMarker(sessionUser.id) === 'active') {
            applyDeletionStatus({ kind: 'pending' });
            setAccountDeletionRecovery((previous) => previous ?? { warnings: [] });
            hydratedUserIdRef.current = null;
            cachePurgedRef.current = true;
            replaceStateImmediately({
              ...DEFAULT_STATE,
              isDemoMode: false,
              ...carryOverDevicePrefs(stateRef.current),
              authenticatedUser: authUser,
            });
            setIsAuthChecked(true);
            return;
          }

          const isAccountSwitch =
            previousHydratedUserId !== null && previousHydratedUserId !== sessionUser.id;

          try {
            cachePurgedRef.current = false;

            // No local marker. The authoritative question still has to be asked
            // over the network, because clearing browser storage, a private
            // window and a different device all bypass a local signal. The
            // session's own JWT claims are NOT consulted: they predate the flag.
            const deletion = await verifyDeletionStatus(sessionUser.id);
            if (
              disposed
              || sessionGenerationRef.current !== authGeneration
              || sessionUserIdRef.current !== sessionUser.id
            ) return;
            if (deletion.kind === 'pending') {
              setAccountDeletionRecovery((previous) => previous ?? { warnings: [] });
              hydratedUserIdRef.current = null;
              cachePurgedRef.current = true;
              replaceStateImmediately({
                ...DEFAULT_STATE,
                isDemoMode: false,
                ...carryOverDevicePrefs(stateRef.current),
                authenticatedUser: authUser,
              });
              return;
            }
            setAccountDeletionRecovery(null);

            const authReconciliationRevision = membershipReconciliationRef.current;
            // A hanging fetch must never keep the app behind the splash spinner.
            const dbState = await withTimeout(
              fetchFullStateFromDB(sessionUser.id),
              AUTH_SYNC_TIMEOUT_MS,
              FULL_STATE_UNAVAILABLE,
            );
            if (
              disposed
              || sessionGenerationRef.current !== authGeneration
              || sessionUserIdRef.current !== sessionUser.id
              || membershipReconciliationRef.current !== authReconciliationRevision
              || workspaceRefMatches(quarantinedWorkspaceRef.current, {
                userId: sessionUser.id,
                coupleId: stateRef.current.profile.couple.coupleId || '',
                generation: authGeneration,
              })
              || workspaceRefMatches(pendingDisconnectRef.current, {
                userId: sessionUser.id,
                coupleId: stateRef.current.profile.couple.coupleId || '',
                generation: authGeneration,
              })
            ) return;

            const prev = stateRef.current;
            const syncUnavailable = dbState === FULL_STATE_UNAVAILABLE;
            setAuthSyncUnavailable(syncUnavailable);
            const nextState = (() => {
              // On an account switch, start from a clean slate so none of the
              // previous account's records/profile can survive.
              const base: AppState = isAccountSwitch
                ? { ...DEFAULT_STATE, ...carryOverDevicePrefs(prev) }
                : prev;

              if (dbState === FULL_STATE_UNAVAILABLE) {
                // Keep the authenticated identity but expose a dedicated retry
                // screen. Shared and account-scoped data remain cleared; a
                // retryable outage must never masquerade as a new account.
                return {
                  ...base,
                  authenticatedUser: authUser,
                  isDemoMode: false,
                  records: [],
                  events: [],
                  trips: [],
                };
              }

              if (!dbState) {
                // A successful empty profile lookup identifies a brand-new
                // account. Only this verified case may enter onboarding.
                return {
                  ...base,
                  authenticatedUser: authUser,
                  isDemoMode: false,
                  setupComplete: false,
                  records: [],
                  events: [],
                  trips: [],
                };
              }

              // The plaintext invite code only exists on the creator's device
              // (the server stores a hash), so keep it while the partner has not joined.
              const shouldKeepInviteCode =
                !!dbState.profile?.couple.coupleId &&
                !dbState.profile.couple.connected &&
                dbState.profile.couple.coupleId === prev.profile.couple.coupleId &&
                prev.authenticatedUser?.id === sessionUser.id;

              const remoteProfile = dbState.profile
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
                ...base,
                authenticatedUser: authUser,
                isDemoMode: false,
                ...dbState,
                ...(remoteProfile ? { profile: remoteProfile } : {}),
              };
            })();
            replaceStateImmediately(nextState);

            hydratedUserIdRef.current = dbState && dbState !== FULL_STATE_UNAVAILABLE
              ? sessionUser.id
              : null;
          } finally {
            // Always release the splash screen, even when the sync failed.
            if (
              !disposed
              && sessionGenerationRef.current === authGeneration
              && sessionUserIdRef.current === sessionUser.id
            ) setIsAuthChecked(true);
          }
          return;
        }

        if (event === 'SIGNED_OUT') {
          hydratedUserIdRef.current = null;
          const nextState: AppState = {
            ...DEFAULT_STATE,
            isDemoMode: false,
            ...carryOverDevicePrefs(stateRef.current),
          };
          replaceStateImmediately(nextState);
          setIsAuthChecked(true);
          return;
        }

        if (event === 'INITIAL_SESSION') {
          hydratedUserIdRef.current = null;
          const current = stateRef.current;
          // A demo session the user explicitly started must survive a reload.
          const nextState = current.isDemoMode && current.setupComplete
            ? current
            : { ...DEFAULT_STATE, isDemoMode: false, ...carryOverDevicePrefs(current) };
          replaceStateImmediately(nextState);
          setIsAuthChecked(true);
        }
      })();
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [applyDeletionStatus, isHydrated, replaceStateImmediately, verifyDeletionStatus]);

  useEffect(() => {
    if (!isHydrated || (supabase && !isAuthChecked)) return;
    // After an explicit sign-out / account deletion the cache stays empty until
    // the next real state change, so the purge cannot be silently undone.
    if (cachePurgedRef.current) {
      cachePurgedRef.current = false;
      return;
    }
    localRepository.saveState(state, sessionUserIdRef.current !== null);
  }, [state, isHydrated, isAuthChecked]);

  useEffect(() => {
    const theme = state.theme || 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    // Keep the browser/OS chrome in sync. index.html hardcoded a light
    // theme-color, so the status bar stayed light while the app was dark.
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.content = theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
    }
  }, [state.theme]);

  /**
   * Realtime sync for the shared couple space.
   *
   * Deliberately keyed on primitive ids: the previous version depended on the
   * `authenticatedUser` object, which is recreated on every auth event, so the
   * subscriptions were torn down and re-established repeatedly.
   *
   * Each notification refreshes only the affected slice. Previously every
   * payload re-ran the whole `fetchFullStateFromDB` (5-6 queries plus one
   * signing request per attachment) and three handlers could fire for a single
   * user action.
   */
  const coupleId = state.profile.couple.coupleId;
  const coupleConnected = state.profile.couple.connected;
  const coupleStatus = state.profile.couple.status;
  const authUserId = state.authenticatedUser?.id;

  const quarantineSharedAccess = useCallback((expected: ActiveWorkspace): boolean => {
    if (!matchesCurrentWorkspace(expected)) return false;
    const current = stateRef.current;
    membershipReconciliationRef.current += 1;
    quarantinedWorkspaceRef.current = expected;
    setSharedSyncStatus('unavailable');
    const nextState: AppState = {
      ...current,
      highlightedRecordId: undefined,
      records: [],
      // Only owner-private schedules remain visible while shared authorization
      // is uncertain. No snapshot is retained for later restoration.
      events: current.events.filter((event) =>
        event.isPrivate && event.createdBy === expected.userId),
      trips: [],
    };
    replaceStateImmediately(nextState);
    return true;
  }, [matchesCurrentWorkspace, replaceStateImmediately]);

  const purgeSharedAccess = useCallback((expected?: ActiveWorkspace): boolean => {
    const current = stateRef.current;
    if (
      expected
      && (
        sessionGenerationRef.current !== expected.generation
        || sessionUserIdRef.current !== expected.userId
        || current.authenticatedUser?.id !== expected.userId
        || current.profile.couple.coupleId !== expected.coupleId
      )
    ) return false;

    membershipReconciliationRef.current += 1;
    quarantinedWorkspaceRef.current = null;
    pendingDisconnectRef.current = null;
    retrySharedAccessRef.current = null;
    realtimeHealthyRef.current = true;
    // There is no shared workspace left to be out of sync with.
    setSharedSyncStatus('live');
    localStorage.removeItem(STORE_KEY_V1);
    localStorage.removeItem(STORE_KEY);
    const nextState: AppState = {
      ...current,
      highlightedRecordId: undefined,
      profile: {
        ...current.profile,
        couple: {
          coupleId: undefined,
          partnerName: '',
          anniversaryDate: undefined,
          coupleCode: '',
          connected: false,
          status: 'disconnected',
        },
      },
      records: [],
      // Private schedules remain owner-readable after a disconnect; shared
      // schedules are revoked with the couple workspace.
      events: current.events.filter((event) =>
        event.isPrivate && event.createdBy === current.authenticatedUser?.id),
      trips: [],
    };
    replaceStateImmediately(nextState);
    return true;
  }, [replaceStateImmediately]);

  const reconcileSharedAccess = useCallback(async (
    workspace: ActiveWorkspace,
  ): Promise<boolean> => {
    const client = supabase;
    const canReconcile = () => matchesCurrentWorkspace(workspace)
      && !workspaceRefMatches(pendingDisconnectRef.current, workspace);
    if (!client || !canReconcile()) return false;

    // Re-verify before the FIRST request. `reconcileSharedAccess` is the single
    // funnel for the recovery poll, the visibilitychange/online handler and the
    // UI retry, so the `online` listener is the concrete path by which an
    // offline secondary device learns about a deletion started elsewhere.
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    if (!canReconcile()) return false;

    const reconciliation = ++membershipReconciliationRef.current;
    const isLatestCurrentWorkspace = () =>
      membershipReconciliationRef.current === reconciliation
      && canReconcile();

    try {
      const { data, error } = await client.rpc('get_my_active_couple_id');
      if (!isLatestCurrentWorkspace()) return false;
      if (error) {
        console.error('[gomsinlog] Failed to verify active membership:', error);
        quarantineSharedAccess(workspace);
        return false;
      }
      if (data !== workspace.coupleId) {
        purgeSharedAccess(workspace);
        return false;
      }

      // Recovery is never snapshot-based: every shared slice must be read again
      // through the caller's current RLS policy after membership is confirmed.
      const [recordsResult, eventsResult, tripsResult] = await Promise.all([
        fetchRecordsResultFromDB(workspace.coupleId),
        fetchEventsResultFromDB(workspace.coupleId),
        fetchTripsResultFromDB(workspace.coupleId),
      ]);
      if (!isLatestCurrentWorkspace()) return false;
      if (!recordsResult.ok || !eventsResult.ok || !tripsResult.ok) {
        console.error('[gomsinlog] Authoritative shared workspace refresh failed');
        quarantineSharedAccess(workspace);
        return false;
      }

      const current = stateRef.current;
      const role = current.profile.role;
      const partnerRole: Role = role === 'gomsin' ? 'soldier' : 'gomsin';
      const records = visibleRecordsForViewer(
        recordsResult.records.map((record) => ({
          ...record,
          authorRole: record.userId === workspace.userId ? role : partnerRole,
        })),
        { userId: workspace.userId, role },
      );
      const nextState: AppState = {
        ...current,
        records,
        events: eventsResult.events,
        trips: reconcileParentTrips(tripsResult.trips),
      };
      quarantinedWorkspaceRef.current = null;
      // Shared data is authoritative again. Whether it will keep itself up to
      // date depends on the channel, which the caller tracks separately.
      setSharedSyncStatus(realtimeHealthyRef.current ? 'live' : 'delayed');
      replaceStateImmediately(nextState);
      return true;
    } catch (error) {
      if (!isLatestCurrentWorkspace()) return false;
      console.error('[gomsinlog] Failed to reconcile shared access:', error);
      quarantineSharedAccess(workspace);
      return false;
    }
  }, [
    ensureNotPendingBeforeServerCall,
    matchesCurrentWorkspace,
    purgeSharedAccess,
    quarantineSharedAccess,
    replaceStateImmediately,
  ]);

  useEffect(() => {
    const client = supabase;
    const activeCouple = coupleConnected && coupleStatus === 'active';
    if (
      !client ||
      !isAuthChecked ||
      !activeCouple ||
      !coupleId ||
      !authUserId ||
      sessionUserIdRef.current !== authUserId
    ) return;

    let disposed = false;
    const generation = sessionGenerationRef.current;
    const workspace: ActiveWorkspace = { userId: authUserId, coupleId, generation };
    const timers = new Map<SyncSlice, number>();
    const isCurrentActiveCouple = () => {
      const current = stateRef.current;
      return !disposed
        && sessionGenerationRef.current === generation
        && sessionUserIdRef.current === authUserId
        && stateMatchesWorkspace(current, workspace);
    };

    const isWorkspaceQuarantined = () => {
      const quarantined = quarantinedWorkspaceRef.current;
      return quarantined?.generation === workspace.generation
        && quarantined.userId === workspace.userId
        && quarantined.coupleId === workspace.coupleId;
    };

    const refreshSlice = async (slice: SyncSlice) => {
      if (!isCurrentActiveCouple()) return;
      // Re-verify before the first request, and before the quarantine branch, so
      // that branch's own reconciliation is covered by the same decision.
      if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return;
      if (!isCurrentActiveCouple()) return;
      // Once authorization is uncertain, a single-slice refresh cannot reveal
      // content. Recovery requires membership plus a full RLS-backed refetch.
      if (isWorkspaceQuarantined()) {
        await reconcileSharedAccess(workspace);
        return;
      }
      const authorizationRevision = membershipReconciliationRef.current;
      const isCurrentRefresh = () => isCurrentActiveCouple()
        && !isWorkspaceQuarantined()
        && membershipReconciliationRef.current === authorizationRevision;
      try {
        if (slice === 'records') {
          const result = await fetchRecordsResultFromDB(coupleId);
          if (!isCurrentRefresh()) return;
          if (!result.ok) {
            quarantineSharedAccess(workspace);
            return;
          }
          const role = stateRef.current.profile.role;
          const partnerRole: Role = role === 'gomsin' ? 'soldier' : 'gomsin';
          const records = visibleRecordsForViewer(
            result.records.map((record) => ({
              ...record,
              authorRole: record.userId === authUserId ? role : partnerRole,
            })),
            { userId: authUserId, role },
          );
          if (isCurrentRefresh()) {
            updateStateImmediately((current) =>
              isCurrentRefresh() ? { ...current, records } : current,
            );
          }
          return;
        }
        if (slice === 'events') {
          const result = await fetchEventsResultFromDB(coupleId);
          if (!isCurrentRefresh()) return;
          if (!result.ok) {
            quarantineSharedAccess(workspace);
            return;
          }
          updateStateImmediately((current) =>
            isCurrentRefresh() ? { ...current, events: result.events } : current,
          );
          return;
        }
        const result = await fetchTripsResultFromDB(coupleId);
        if (!isCurrentRefresh()) return;
        if (!result.ok) {
          quarantineSharedAccess(workspace);
          return;
        }
        updateStateImmediately((current) =>
          isCurrentRefresh()
            ? { ...current, trips: reconcileParentTrips(result.trips) }
            : current,
        );
      } catch (error) {
        if (!isCurrentRefresh()) return;
        console.error(`[gomsinlog] Realtime refresh of ${slice} failed:`, error);
        quarantineSharedAccess(workspace);
      }
    };

    // Coalesce bursts (e.g. a record insert immediately followed by the
    // attachment patch) into a single refresh.
    const scheduleRefresh = (slice: SyncSlice) => {
      if (!isCurrentActiveCouple()) return;
      const existing = timers.get(slice);
      if (existing) window.clearTimeout(existing);
      timers.set(
        slice,
        window.setTimeout(() => {
          timers.delete(slice);
          void refreshSlice(slice);
        }, REALTIME_DEBOUNCE_MS),
      );
    };

    const reconcileOwnMembership = (): Promise<boolean> =>
      isCurrentActiveCouple()
        ? reconcileSharedAccess(workspace)
        : Promise.resolve(false);

    /**
     * Keep trying to re-establish the shared workspace after the channel fails.
     *
     * Reconciliation runs over HTTP, so it still succeeds where WebSockets are
     * blocked entirely: the couple's data comes back and is simply marked
     * `delayed` instead of leaving the user on a blank screen forever. The poll
     * both refreshes that data and re-checks membership, so a disconnect during
     * an outage is still noticed.
     */
    let recoveryTimer: number | undefined;
    let recoveryAttempt = 0;
    const clearRecovery = () => {
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    };
    const scheduleRecovery = () => {
      if (disposed || recoveryTimer !== undefined || !isCurrentActiveCouple()) return;
      const delay = Math.min(
        REALTIME_RECOVERY_MAX_DELAY_MS,
        REALTIME_RECOVERY_BASE_DELAY_MS * 2 ** recoveryAttempt,
      );
      recoveryAttempt += 1;
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = undefined;
        void (async () => {
          await reconcileOwnMembership();
          if (disposed || !isCurrentActiveCouple()) return;
          // Keep polling while the transport is down even after a successful
          // read, because nothing else will deliver the partner's changes. Do
          // not reset the attempt after success: the delay must continue growing
          // to the 30-second fallback cadence rather than polling four HTTP
          // endpoints every two seconds forever.
          if (!realtimeHealthyRef.current) scheduleRecovery();
        })();
      }, delay);
    };
    // Lets an abort cancel everything deferred, so nothing fires after the purge.
    cancelDeferredSyncRef.current = () => {
      clearRecovery();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
    retrySharedAccessRef.current = async () => {
      clearRecovery();
      recoveryAttempt = 0;
      const recovered = await reconcileOwnMembership();
      if (!disposed && !realtimeHealthyRef.current) scheduleRecovery();
      return recovered;
    };

    // One channel covers the shared tables and the current user's own
    // membership row. A partner disconnect updates that row and revokes access.
    const channel = client
      .channel(`couple-sync:${coupleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'couple_members', filter: `user_id=eq.${authUserId}` },
        () => {
          quarantineSharedAccess(workspace);
          void reconcileOwnMembership();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'collaboration_invalidations', filter: `couple_id=eq.${coupleId}` },
        (payload) => {
          const invalidation = payload.new as Record<string, unknown>;
          if (invalidation.slice === 'events') scheduleRefresh('events');
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_records', filter: `couple_id=eq.${coupleId}` },
        () => scheduleRefresh('records'),
      )
      // No direct `events` subscription. Realtime does not apply RLS to DELETE
      // payloads, so subscribing to the table told the partner exactly when the
      // author deleted a *private* schedule. Migration 015 removes events from
      // the publication and routes shared-event changes through
      // collaboration_invalidations, which is filtered server-side.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `couple_id=eq.${coupleId}` },
        () => scheduleRefresh('trips'),
      )
      .subscribe((status) => {
        // A healthy subscription proves only transport health, so membership and
        // every slice are still re-read authoritatively. What this deliberately
        // does *not* do is blank the screen first: the content was already on
        // screen before, no new content can appear without passing RLS, and
        // reconciliation purges or quarantines the moment the answer says so.
        // Pre-emptive clearing made the timeline flash empty on every foreground.
        if (status === 'SUBSCRIBED') {
          realtimeHealthyRef.current = true;
          clearRecovery();
          recoveryAttempt = 0;
          void reconcileOwnMembership();
          return;
        }
        if (
          !disposed
          && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
        ) {
          // Live updates have stopped, so partner changes and a partner-initiated
          // disconnect would both go unnoticed. Hide shared content until a check
          // succeeds, then keep re-checking over HTTP.
          realtimeHealthyRef.current = false;
          quarantineSharedAccess(workspace);
          scheduleRecovery();
        }
      });

    // Realtime messages are dropped while a mobile browser is backgrounded, so
    // re-verify membership on return; reconciliation purges if it was revoked.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void reconcileOwnMembership();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleVisibility);

    return () => {
      disposed = true;
      retrySharedAccessRef.current = null;
      cancelDeferredSyncRef.current = null;
      clearRecovery();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleVisibility);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      void client.removeChannel(channel);
    };
  }, [
    authUserId,
    coupleConnected,
    coupleId,
    coupleStatus,
    ensureNotPendingBeforeServerCall,
    isAuthChecked,
    quarantineSharedAccess,
    reconcileSharedAccess,
    updateStateImmediately,
  ]);

  /**
   * Wait for the partner to redeem the invite code.
   *
   * Pending couples keep a bounded poll because the active shared-space channel
   * is intentionally not mounted until both partners are connected.
   */
  useEffect(() => {
    const client = supabase;
    if (
      !client ||
      !isAuthChecked ||
      !authUserId ||
      !coupleId ||
      coupleConnected ||
      coupleStatus !== 'pending' ||
      sessionUserIdRef.current !== authUserId
    ) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let attempts = 0;

    const checkForPartner = async () => {
      if (cancelled) return;

      // Don't poll a backgrounded tab; visibilitychange re-arms it.
      if (document.visibilityState !== 'visible') {
        schedule();
        return;
      }

      attempts += 1;
      const { data, error } = await client.rpc('get_partner_profile');
      const current = stateRef.current;
      if (
        cancelled ||
        sessionUserIdRef.current !== authUserId ||
        current.authenticatedUser?.id !== authUserId ||
        current.profile.couple.coupleId !== coupleId ||
        current.profile.couple.status !== 'pending'
      ) return;

      if (!error && data?.length) {
        updateStateImmediately((prev) => ({
          ...prev,
          profile: {
            ...prev.profile,
            couple: {
              ...prev.profile.couple,
              partnerName: data[0].display_name || '파트너',
              // The invite code has served its purpose once the partner joins.
              coupleCode: '',
              connected: true,
              status: 'active',
            },
          },
        }));
        return; // Connected: stop polling.
      }

      if (error) console.error('[gomsinlog] Partner lookup failed:', error);
      if (attempts >= PARTNER_POLL_MAX_ATTEMPTS) return; // Give up quietly.
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      // 10s for the first minute, then 30s, then 60s.
      const delay =
        attempts < 6 ? 10_000 : attempts < 16 ? 30_000 : 60_000;
      timeoutId = window.setTimeout(() => void checkForPartner(), delay);
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      if (timeoutId) window.clearTimeout(timeoutId);
      void checkForPartner();
    };

    void checkForPartner();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [
    authUserId,
    coupleConnected,
    coupleId,
    coupleStatus,
    isAuthChecked,
    updateStateImmediately,
  ]);

  const updateProfile = (profileUpdates: Partial<UserProfile>) => {
    // Compute the next profile outside the updater. React StrictMode invokes
    // updaters twice, so performing network writes inside one would fire every
    // request twice.
    const prev = stateRef.current;
    const newProfile: UserProfile = { ...prev.profile, ...profileUpdates };
    // The optimistic local update stays SYNCHRONOUS and unchanged. Only the
    // issuing of the three writes moves behind the gate. If the gate aborts, the
    // optimistic update is discarded anyway, because the purge replaces state
    // wholesale.
    updateStateImmediately((current) => ({
      ...current,
      profile: { ...current.profile, ...profileUpdates },
    }));

    if (!supabase || !prev.authenticatedUser || prev.isDemoMode) return;
    const userId = prev.authenticatedUser.id;

    void (async () => {
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return;

    if (profileUpdates.myName || profileUpdates.military || profileUpdates.role) {
      void supabase
        .from('profiles')
        .update({
          display_name: newProfile.myName,
          role: newProfile.role,
          military_info: newProfile.military,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .then(({ error }) => {
          if (error) console.error('[gomsinlog] Failed to update profile:', error);
        });
    }

    if (profileUpdates.contact) {
      void supabase
        .from('contact_preferences')
        .upsert({
          user_id: userId,
          weekday_start: newProfile.contact.weekdayStart,
          weekday_end: newProfile.contact.weekdayEnd,
          weekend_start: newProfile.contact.weekendStart,
          weekend_end: newProfile.contact.weekendEnd,
        })
        .then(({ error }) => {
          if (error) console.error('[gomsinlog] Failed to update contact preferences:', error);
        });
    }

    // The anniversary lives on the shared `couples` row. Without this it was only
    // ever kept locally and silently reset to empty on the next login.
    const nextAnniversary = profileUpdates.couple?.anniversaryDate;
    const coupleId = newProfile.couple.coupleId;
    if (coupleId && nextAnniversary && nextAnniversary !== prev.profile.couple.anniversaryDate) {
      void saveCoupleAnniversary(coupleId, nextAnniversary);
    }
    })();
  };

  const addRecord = async (record: Omit<DailyRecord, 'id' | 'createdAt'>): Promise<boolean> => {
    const result = await addRecordWithMedia(record, []);
    return result.ok;
  };

  /**
   * Create a record and attach media files to it.
   *
   * Two phases are required by the storage RLS policy (migration 007): the
   * `daily_records` row must already exist before any object may be written to
   * `{coupleId}/{recordId}/...`. So we save the row, upload, then patch the row
   * with the resulting attachment metadata.
   */
  const addRecordWithMedia = async (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files: File[],
  ): Promise<{ ok: boolean; failedFiles: string[]; error?: string }> => {
    const initial = stateRef.current;
    const recordId = crypto.randomUUID();
    const baseRecord: DailyRecord = {
      ...record,
      id: recordId,
      createdAt: new Date().toISOString(),
    };

    // Demo previews are explicitly local, even when Supabase is configured.
    if (initial.isDemoMode) {
      const previews: Attachment[] = files.map((file) => {
        const classified = classifyMediaFile(file);
        return {
          type: 'error' in classified ? 'photo' : classified.type,
          name: file.name,
          url: URL.createObjectURL(file),
        };
      });
      const demoRecord: DailyRecord = {
        ...baseRecord,
        attachments: [...(baseRecord.attachments || []), ...previews],
      };
      updateStateImmediately((current) => current.isDemoMode
        ? { ...current, records: [...current.records, demoRecord] }
        : current);
      return stateRef.current.isDemoMode
        ? { ok: true, failedFiles: [] }
        : { ok: false, failedFiles: files.map((file) => file.name) };
    }

    const workspace = captureLinkedCouple();
    if (!workspace) {
      return {
        ok: false,
        failedFiles: files.map((file) => file.name),
        error: '커플 공간을 만든 뒤에 기록을 남길 수 있어요.',
      };
    }
    const newRecord: DailyRecord = { ...baseRecord, userId: workspace.userId };
    const staleResult = {
      ok: false,
      failedFiles: files.map((file) => file.name),
      error: '계정 또는 커플 공간이 변경되어 작업을 중단했어요.',
    };

    // Aborted at phase zero, so there is no orphaned `daily_records` row and no
    // orphaned storage object.
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return staleResult;

    try {
      const saved = await saveRecordToDB(
        newRecord,
        workspace.coupleId,
        workspace.userId,
      );
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      if (!saved) {
        return { ok: false, failedFiles: files.map((file) => file.name), error: '기록을 저장하지 못했어요.' };
      }
    } catch (error) {
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      console.error('[gomsinlog] Failed to save record:', error);
      return { ok: false, failedFiles: files.map((file) => file.name), error: '기록을 저장하지 못했어요.' };
    }

    const attachments: Attachment[] = [...(newRecord.attachments || [])];
    const uploadedPaths: string[] = [];
    const failedFiles: string[] = [];
    for (const file of files) {
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      const result = await uploadRecordMedia(file, workspace.coupleId, recordId);
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      if ('error' in result) {
        failedFiles.push(file.name);
        console.error(`[gomsinlog] Attachment failed (${file.name}): ${result.error}`);
        continue;
      }
      attachments.push(result.attachment);
      if (result.attachment.path) uploadedPaths.push(result.attachment.path);
    }

    let finalRecord: DailyRecord = { ...newRecord, attachments };
    if (attachments.length > 0) {
      try {
        const patched = await saveRecordToDB(
          finalRecord,
          workspace.coupleId,
          workspace.userId,
        );
        if (!isCurrentLinkedCouple(workspace)) return staleResult;
        if (!patched) {
          await removeRecordMedia(uploadedPaths);
          if (!isCurrentLinkedCouple(workspace)) return staleResult;
          failedFiles.push(...files.map((file) => file.name));
          finalRecord = { ...newRecord, attachments: newRecord.attachments || [] };
        }
      } catch (error) {
        if (!isCurrentLinkedCouple(workspace)) return staleResult;
        console.error('[gomsinlog] Failed to attach media to record:', error);
        await removeRecordMedia(uploadedPaths);
        if (!isCurrentLinkedCouple(workspace)) return staleResult;
        failedFiles.push(...files.map((file) => file.name));
        finalRecord = { ...newRecord, attachments: newRecord.attachments || [] };
      }
    }

    if (finalRecord.attachments?.length) {
      finalRecord = {
        ...finalRecord,
        attachments: await resolveAttachmentUrls(
          finalRecord.attachments,
          workspace.coupleId,
          recordId,
        ),
      };
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
    }

    const recordToCommit = finalRecord;
    updateStateImmediately((current) =>
      isCurrentLinkedCouple(workspace) && stateMatchesLinkedCouple(current, workspace)
        ? { ...current, records: [...current.records, recordToCommit] }
        : current,
    );
    return isCurrentLinkedCouple(workspace)
      ? { ok: true, failedFiles: Array.from(new Set(failedFiles)) }
      : staleResult;
  };

  const updateRecord = async (id: string, updates: Partial<DailyRecord>): Promise<boolean> => {
    const initial = stateRef.current;
    const existing = initial.records.find((record) => record.id === id);
    if (!existing) return false;
    // Identity-bearing fields are immutable even if an older caller still
    // passes the broad Partial<DailyRecord> API.
    const updated: DailyRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
    };

    if (initial.isDemoMode) {
      updateStateImmediately((current) => current.isDemoMode
        ? {
            ...current,
            records: current.records.map((record) => record.id === id ? updated : record),
          }
        : current);
      return stateRef.current.isDemoMode;
    }

    const workspace = captureLinkedCouple();
    if (!workspace || existing.userId !== workspace.userId) return false;
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    try {
      const saved = await saveRecordToDB(updated, workspace.coupleId, workspace.userId);
      if (!isCurrentLinkedCouple(workspace) || !saved) return false;
    } catch (error) {
      if (isCurrentLinkedCouple(workspace)) {
        console.error('[gomsinlog] Failed to update record:', error);
      }
      return false;
    }

    let recordToCommit = updated;
    if (updated.attachments?.length) {
      recordToCommit = {
        ...updated,
        attachments: await resolveAttachmentUrls(
          updated.attachments,
          workspace.coupleId,
          updated.id,
        ),
      };
      if (!isCurrentLinkedCouple(workspace)) return false;
    }

    updateStateImmediately((current) =>
      isCurrentLinkedCouple(workspace) && stateMatchesLinkedCouple(current, workspace)
        ? {
            ...current,
            records: current.records.map((record) =>
              record.id === id ? recordToCommit : record,
            ),
          }
        : current,
    );
    return isCurrentLinkedCouple(workspace);
  };

  const deleteRecord = async (id: string): Promise<boolean> => {
    const initial = stateRef.current;
    const existing = initial.records.find((record) => record.id === id);
    if (!existing) return false;

    if (initial.isDemoMode) {
      updateStateImmediately((current) => current.isDemoMode
        ? { ...current, records: current.records.filter((record) => record.id !== id) }
        : current);
      return stateRef.current.isDemoMode;
    }

    const workspace = captureLinkedCouple();
    if (!workspace || existing.userId !== workspace.userId) return false;
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    try {
      const deleted = await deleteRecordFromDB(
        id,
        workspace.userId,
        workspace.coupleId,
      );
      if (!isCurrentLinkedCouple(workspace) || !deleted) return false;
    } catch (error) {
      if (isCurrentLinkedCouple(workspace)) console.error('Failed to delete record:', error);
      return false;
    }

    updateStateImmediately((current) =>
      isCurrentLinkedCouple(workspace) && stateMatchesLinkedCouple(current, workspace)
        ? { ...current, records: current.records.filter((record) => record.id !== id) }
        : current,
    );
    return isCurrentLinkedCouple(workspace);
  };

  const addEvent = async (
    event: Omit<CoupleEvent, 'id' | 'createdAt'>,
  ): Promise<boolean> => {
    const workspace = captureLinkedCouple();
    if (
      !workspace
      || event.createdBy !== workspace.userId
      || event.coupleId !== workspace.coupleId
    ) return false;

    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;

    const newEvent: CoupleEvent = {
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    try {
      const saved = await import('@/lib/events').then((module) =>
        module.saveEventToDB(newEvent),
      );
      if (!isCurrentLinkedCouple(workspace) || !saved) return false;
      updateStateImmediately((prev) => isCurrentLinkedCouple(workspace) && stateMatchesLinkedCouple(prev, workspace)
        ? { ...prev, events: [...prev.events, saved] }
        : prev);
      return true;
    } catch (error) {
      if (isCurrentLinkedCouple(workspace)) console.error('Failed to save event:', error);
      return false;
    }
  };

  const updateEvent = async (
    id: string,
    updates: Partial<Omit<CoupleEvent, 'id' | 'coupleId' | 'createdBy' | 'createdAt'>>,
  ): Promise<boolean> => {
    const identity = captureActiveIdentity();
    const workspace = captureActiveWorkspace();
    const current = stateRef.current;
    const existing = current.events.find((event) => event.id === id);
    const remainsPrivate = existing?.isPrivate && updates.isPrivate !== false;
    if (
      !identity
      || !existing
      || existing.createdBy !== identity.userId
      || (!remainsPrivate && (
        !workspace
        || existing.coupleId !== workspace.coupleId
      ))
    ) return false;

    const isCurrentScope = () => isCurrentIdentity(identity)
      && (remainsPrivate || (!!workspace && isCurrentWorkspace(workspace)));
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    if (!isCurrentScope()) return false;
    const updated = { ...existing, ...updates };
    updateStateImmediately((prev) => isCurrentScope()
      ? { ...prev, events: prev.events.map((event) => (event.id === id ? updated : event)) }
      : prev);

    try {
      const saved = await import('@/lib/events').then((module) =>
        module.updateEventInDB(updated),
      );
      if (!isCurrentScope()) return false;
      if (!saved) {
        updateStateImmediately((prev) => isCurrentScope()
          ? { ...prev, events: prev.events.map((event) => (event.id === id ? existing : event)) }
          : prev);
        return false;
      }
      updateStateImmediately((prev) => isCurrentScope()
        ? { ...prev, events: prev.events.map((event) => (event.id === id ? saved : event)) }
        : prev);
      return true;
    } catch (error) {
      if (!isCurrentScope()) return false;
      console.error('Failed to update event:', error);
      updateStateImmediately((prev) => isCurrentScope()
        ? { ...prev, events: prev.events.map((event) => (event.id === id ? existing : event)) }
        : prev);
      return false;
    }
  };

  const deleteEvent = async (id: string): Promise<boolean> => {
    const identity = captureActiveIdentity();
    const workspace = captureActiveWorkspace();
    const existing = stateRef.current.events.find((event) => event.id === id);
    if (
      !identity
      || !existing
      || existing.createdBy !== identity.userId
      || (!existing.isPrivate && (
        !workspace
        || existing.coupleId !== workspace.coupleId
      ))
    ) return false;

    const isCurrentScope = () => isCurrentIdentity(identity)
      && (existing.isPrivate || (!!workspace && isCurrentWorkspace(workspace)));
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    if (!isCurrentScope()) return false;
    try {
      const deleted = await import('@/lib/events').then((module) =>
        module.deleteEventFromDB(id),
      );
      if (!isCurrentScope() || !deleted) return false;
    } catch (error) {
      if (isCurrentScope()) console.error('Failed to delete event:', error);
      return false;
    }

    updateStateImmediately((prev) => isCurrentScope()
      ? { ...prev, events: prev.events.filter((event) => event.id !== id) }
      : prev);
    return true;
  };

  const reloadEvents = async (): Promise<{
    ok: boolean;
    reason?: 'forbidden' | 'error';
  }> => {
    const identity = captureActiveIdentity();
    if (!identity) return { ok: false, reason: 'forbidden' };
    // Reads are scoped to the couple space this account belongs to; quarantine
    // and recovery only apply once a partner is actually present.
    const linked = captureLinkedCouple();
    const shared = captureActiveWorkspace();
    const current = stateRef.current;
    if (
      !shared
      && current.profile.couple.coupleId
      && current.profile.couple.connected
      && current.profile.couple.status === 'active'
    ) return { ok: false, reason: 'forbidden' };

    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) {
      return { ok: false, reason: 'forbidden' };
    }

    try {
      // Without a couple space the query returns only owner-private rows; with
      // one it additionally returns that couple's shared rows under RLS.
      const result = await fetchEventsResultFromDB(linked?.coupleId);
      if (!isCurrentIdentity(identity)) return { ok: false, reason: 'forbidden' };
      if (linked && !isCurrentLinkedCouple(linked)) {
        return { ok: false, reason: 'forbidden' };
      }
      if (!result.ok) {
        if (shared) quarantineSharedAccess(shared);
        return result;
      }
      updateStateImmediately((prev) => isCurrentIdentity(identity)
        && (!linked || (isCurrentLinkedCouple(linked) && stateMatchesLinkedCouple(prev, linked)))
        ? { ...prev, events: result.events }
        : prev);
      return { ok: true };
    } catch (error) {
      if (!isCurrentIdentity(identity)) return { ok: false, reason: 'forbidden' };
      if (shared) quarantineSharedAccess(shared);
      console.error('Failed to reload events:', error);
      return { ok: false, reason: 'error' };
    }
  };

  /**
   * Demo-only role preview: swaps my name with my partner's and flips the role
   * so both role-specific home screens can be tried without a second account.
   *
   * Guarded to demo mode because it is purely local. On a real account the
   * server would still hold the original role, the next sync would revert it,
   * and in the meantime `authorRole` on existing records would no longer match
   * the profile -- which decides which records count as "mine".
   */
  const switchRole = () => {
    updateStateImmediately((prev) => {
      if (!prev.isDemoMode) {
        console.warn('[gomsinlog] switchRole is a demo-only preview and was ignored.');
        return prev;
      }
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

  /**
   * Cancel a couple link that was never accepted. There is no partner and no
   * shared row to revoke, so nothing has to be quarantined or reconciled: the
   * only requirement is that a confirmed cancellation drops the local pending
   * couple so the invitation UI and the partner poll both stop.
   */
  const cancelPendingLink = async (): Promise<boolean> => {
    const pending = captureLinkedCouple();
    if (!pending || workspaceRefMatches(pendingDisconnectRef.current, pending)) return false;
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    if (!isCurrentLinkedCouple(pending)) return false;
    pendingDisconnectRef.current = pending;
    const clearPendingDisconnect = () => {
      if (workspaceRefMatches(pendingDisconnectRef.current, pending)) {
        pendingDisconnectRef.current = null;
      }
    };
    try {
      const disconnected = await disconnectCoupleFromDB();
      clearPendingDisconnect();
      if (!disconnected || !isCurrentLinkedCouple(pending)) return false;
      return purgeSharedAccess(pending);
    } catch (error) {
      clearPendingDisconnect();
      console.error('Failed to cancel the pending couple link:', error);
      return false;
    }
  };

  const disconnect = async (): Promise<boolean> => {
    const current = stateRef.current;
    if (current.isDemoMode) {
      // Demo mode never calls the configured backend.
      return purgeSharedAccess();
    }

    const workspace = captureActiveWorkspace();
    if (!workspace) return cancelPendingLink();
    if (workspaceRefMatches(pendingDisconnectRef.current, workspace)) return false;
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    if (!matchesCurrentWorkspace(workspace)) return false;
    // Hide all shared content before the RPC leaves this turn. The couple id is
    // retained so a failed request can be recovered authoritatively.
    pendingDisconnectRef.current = workspace;
    quarantineSharedAccess(workspace);
    const clearPendingDisconnect = () => {
      if (workspaceRefMatches(pendingDisconnectRef.current, workspace)) {
        pendingDisconnectRef.current = null;
      }
    };

    try {
      const disconnected = await disconnectCoupleFromDB();
      if (!matchesCurrentWorkspace(workspace)) {
        clearPendingDisconnect();
        return false;
      }
      clearPendingDisconnect();
      if (disconnected) return purgeSharedAccess(workspace);
      await reconcileSharedAccess(workspace);
      return false;
    } catch (error) {
      if (!matchesCurrentWorkspace(workspace)) {
        clearPendingDisconnect();
        return false;
      }
      console.error('Failed to disconnect:', error);
      clearPendingDisconnect();
      await reconcileSharedAccess(workspace);
      return false;
    }
  };

  /**
   * Drop every trace of the signed-in account from this device.
   * Only device-level preferences (theme, widget layout) are kept.
   *
   * It removes exactly `STORE_KEY_V1` and `STORE_KEY`. It deliberately does NOT
   * remove the deletion-recovery marker, which lives at its own top-level key.
   * That looks like an omission and is not: LOGOUT RETAINS THE MARKER, because
   * logging out does not cancel an irreversible deletion, so a purge path that
   * also removed it would reintroduce the fail-open bypass. `signOut` calls this
   * function and must likewise never touch that key.
   */
  const purgeLocalAccountData = (expected?: ActiveIdentity): boolean => {
    if (expected && !isCurrentIdentity(expected)) return false;
    hydratedUserIdRef.current = null;
    membershipReconciliationRef.current += 1;
    quarantinedWorkspaceRef.current = null;
    if (sessionUserIdRef.current !== null) sessionGenerationRef.current += 1;
    sessionUserIdRef.current = null;
    cachePurgedRef.current = true;
    localStorage.removeItem(STORE_KEY_V1);
    localStorage.removeItem(STORE_KEY);
    const current = stateRef.current;
    const nextState: AppState = {
      ...DEFAULT_STATE,
      isDemoMode: false,
      ...carryOverDevicePrefs(current),
    };
    replaceStateImmediately(nextState);
    return true;
  };

  const signOut = async () => {
    // Purge locally first: even if the network call fails, this device must not
    // keep the previous account's records readable.
    purgeLocalAccountData();
    try {
      await authRepository.signOut();
    } catch (error) {
      console.error('[gomsinlog] Sign-out request failed; local session was cleared anyway', error);
    }
  };

  /**
   * DELIBERATELY NOT GATED by `ensureNotPendingBeforeServerCall`.
   *
   * This and `retryAccountDeletion` / `signOut` are the paths OUT of recovery.
   * Gating them on "is a deletion pending" would trap the user with no way to
   * either finish or leave the deletion.
   */
  const deleteAccount = async (): Promise<AccountDeletionOutcome> => {
    if (stateRef.current.isDemoMode) {
      purgeLocalAccountData();
      return { status: 'deleted', dataRemoved: true, warnings: [] };
    }

    const identity = captureActiveIdentity();
    if (!identity) return { status: 'failed', dataRemoved: false, warnings: [] };
    const outcome = await deleteAccountFromDB();
    // Account A's completion must never clear a session that has switched to B.
    if (!isCurrentIdentity(identity)) {
      return { status: 'failed', dataRemoved: false, warnings: outcome.warnings };
    }

    // No purge, no recovery and NO MARKER: the account is fully intact.
    if (outcome.status === 'failed') return outcome;

    if (outcome.status === 'partially_deleted') {
      // Marker FIRST, so a reload cannot escape recovery, then contain the
      // exposure while keeping the session so the deletion can be finished.
      markRecoveryPending(identity.userId);
      if (!purgeLocalContentRetainingIdentity(identity)) return outcome;
      setAccountDeletionRecovery({ warnings: outcome.warnings });
      applyDeletionStatus({ kind: 'pending' });
      cancelDeferredSyncRef.current?.();
      return outcome;
    }

    // `deleted`: the Auth user is gone, which is the ONLY confirmation that
    // permits clearing the marker.
    if (!purgeLocalAccountData(identity)) return outcome;
    setAccountDeletionRecovery(null);
    applyDeletionStatus({ kind: 'clear' });
    try {
      await authRepository.signOut();
    } catch (error) {
      console.error('[gomsinlog] Sign-out after deletion failed; local data was cleared', error);
    }
    clearRecoveryMarker(identity.userId);
    return outcome;
  };

  /**
   * Retry from the recovery screen. Re-invokes the Edge Function, which
   * re-writes the same `true` pending flag idempotently.
   *
   * A `partially_deleted` or `failed` retry stays in recovery, LEAVES THE MARKER
   * IN PLACE and re-fetches nothing.
   */
  const retryAccountDeletion = async (): Promise<AccountDeletionOutcome> =>
    deleteAccount();

  const setSetupComplete = (complete: boolean) => {
    updateStateImmediately((prev) => ({ ...prev, setupComplete: complete }));
  };

  const setOnboardingStep = (step: number) => {
    updateStateImmediately((prev) => ({ ...prev, onboardingStep: step }));
  };

  const setHighlightedRecordId = (id?: string) => {
    updateStateImmediately((prev) => ({ ...prev, highlightedRecordId: id }));
  };

  const startDemo = () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const daysAgo = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d.toISOString().split('T')[0];
    };

    updateStateImmediately((prev) => ({
      ...DEFAULT_STATE,
      ...carryOverDevicePrefs(prev),
      setupComplete: true,
      isDemoMode: true,
      authenticatedUser: null,
      profile: {
        ...DEFAULT_STATE.profile,
        myName: '춘향',
        role: 'gomsin',
        couple: {
          ...DEFAULT_STATE.profile.couple,
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
    updateStateImmediately((prev) => ({ ...prev, authenticatedUser: user }));
  };

  const setWidgetLayout = (layout: string[]) => {
    updateStateImmediately((prev) => ({ ...prev, widgetLayout: layout }));
  };

  const setHasSeenInstallPrompt = (seen: boolean) => {
    updateStateImmediately((prev) => ({ ...prev, hasSeenInstallPrompt: seen }));
  };

  const setTheme = (theme: 'light' | 'dark') => {
    updateStateImmediately((prev) => ({ ...prev, theme }));
  };

  /**
   * Manual recovery for the shared workspace.
   *
   * Only meaningful while a couple channel is mounted; without one there is
   * nothing to re-verify and the shared workspace is not being withheld.
   */
  const retrySharedAccess = async (): Promise<boolean> => {
    const retry = retrySharedAccessRef.current;
    if (!retry) return false;
    return retry();
  };

  return (
    <StoreContext.Provider
      value={{
        state,
        isReady: isHydrated && isAuthChecked,
        authSyncUnavailable,
        sharedSyncStatus,
        accountDeletionRecovery,
        deletionStatus,
        retryAccountDeletion,
        retrySharedAccess,
        updateProfile,
        addRecord,
        addRecordWithMedia,
        updateRecord,
        deleteRecord,
        addEvent,
        updateEvent,
        deleteEvent,
        reloadEvents,
        switchRole,
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
