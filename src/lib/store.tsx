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
import { fetchFullStateFromDB } from '@/lib/sync';
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

/** Which slice of shared state a realtime notification affects. */
type SyncSlice = 'records' | 'events' | 'trips';
type ActiveIdentity = { userId: string; generation: number };
type ActiveWorkspace = ActiveIdentity & { coupleId: string };

function stateMatchesWorkspace(state: AppState, workspace: ActiveWorkspace): boolean {
  return state.authenticatedUser?.id === workspace.userId
    && state.profile.couple.coupleId === workspace.coupleId
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthChecked, setIsAuthChecked] = useState(!supabase);
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

          const isAccountSwitch =
            previousHydratedUserId !== null && previousHydratedUserId !== sessionUser.id;

          try {
            cachePurgedRef.current = false;
            const authReconciliationRevision = membershipReconciliationRef.current;
            // A hanging fetch must never keep the app behind the splash spinner.
            const dbState = await withTimeout(
              fetchFullStateFromDB(sessionUser.id),
              AUTH_SYNC_TIMEOUT_MS,
              null,
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
            const nextState = (() => {
              // On an account switch, start from a clean slate so none of the
              // previous account's records/profile can survive.
              const base: AppState = isAccountSwitch
                ? { ...DEFAULT_STATE, ...carryOverDevicePrefs(prev) }
                : prev;

              if (!dbState) {
                // Signed in, but the server has no profile row for this user yet
                // (brand new account) or the sync failed. Either way, do not present
                // stale or demo content as if it belonged to this account.
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

            hydratedUserIdRef.current = dbState ? sessionUser.id : null;
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
  }, [isHydrated, replaceStateImmediately]);

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
      replaceStateImmediately(nextState);
      return true;
    } catch (error) {
      if (!isLatestCurrentWorkspace()) return false;
      console.error('[gomsinlog] Failed to reconcile shared access:', error);
      quarantineSharedAccess(workspace);
      return false;
    }
  }, [
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `couple_id=eq.${coupleId}` },
        () => scheduleRefresh('events'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `couple_id=eq.${coupleId}` },
        () => scheduleRefresh('trips'),
      )
      .subscribe((status) => {
        // A healthy subscription still proves only transport health. Membership
        // and all slices are re-established authoritatively before revealing data.
        if (status === 'SUBSCRIBED') {
          quarantineSharedAccess(workspace);
          void reconcileOwnMembership();
          return;
        }
        if (
          !disposed
          && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
        ) {
          quarantineSharedAccess(workspace);
        }
      });

    // Realtime messages are dropped while a mobile browser is backgrounded, so
    // verify membership first and only refresh shared slices if it is still active.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      quarantineSharedAccess(workspace);
      void reconcileOwnMembership();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleVisibility);

    return () => {
      disposed = true;
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
    updateStateImmediately((current) => ({
      ...current,
      profile: { ...current.profile, ...profileUpdates },
    }));

    if (!supabase || !prev.authenticatedUser || prev.isDemoMode) return;
    const userId = prev.authenticatedUser.id;

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

    const workspace = captureActiveWorkspace();
    if (!workspace) {
      return {
        ok: false,
        failedFiles: files.map((file) => file.name),
        error: '커플 공간이 연결된 뒤에 기록을 남길 수 있어요.',
      };
    }
    const newRecord: DailyRecord = { ...baseRecord, userId: workspace.userId };
    const staleResult = {
      ok: false,
      failedFiles: files.map((file) => file.name),
      error: '계정 또는 커플 공간이 변경되어 작업을 중단했어요.',
    };

    try {
      const saved = await saveRecordToDB(
        newRecord,
        workspace.coupleId,
        workspace.userId,
      );
      if (!isCurrentWorkspace(workspace)) return staleResult;
      if (!saved) {
        return { ok: false, failedFiles: files.map((file) => file.name), error: '기록을 저장하지 못했어요.' };
      }
    } catch (error) {
      if (!isCurrentWorkspace(workspace)) return staleResult;
      console.error('[gomsinlog] Failed to save record:', error);
      return { ok: false, failedFiles: files.map((file) => file.name), error: '기록을 저장하지 못했어요.' };
    }

    const attachments: Attachment[] = [...(newRecord.attachments || [])];
    const uploadedPaths: string[] = [];
    const failedFiles: string[] = [];
    for (const file of files) {
      if (!isCurrentWorkspace(workspace)) return staleResult;
      const result = await uploadRecordMedia(file, workspace.coupleId, recordId);
      if (!isCurrentWorkspace(workspace)) return staleResult;
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
        if (!isCurrentWorkspace(workspace)) return staleResult;
        if (!patched) {
          await removeRecordMedia(uploadedPaths);
          if (!isCurrentWorkspace(workspace)) return staleResult;
          failedFiles.push(...files.map((file) => file.name));
          finalRecord = { ...newRecord, attachments: newRecord.attachments || [] };
        }
      } catch (error) {
        if (!isCurrentWorkspace(workspace)) return staleResult;
        console.error('[gomsinlog] Failed to attach media to record:', error);
        await removeRecordMedia(uploadedPaths);
        if (!isCurrentWorkspace(workspace)) return staleResult;
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
      if (!isCurrentWorkspace(workspace)) return staleResult;
    }

    const recordToCommit = finalRecord;
    updateStateImmediately((current) =>
      isCurrentWorkspace(workspace) && stateMatchesWorkspace(current, workspace)
        ? { ...current, records: [...current.records, recordToCommit] }
        : current,
    );
    return isCurrentWorkspace(workspace)
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

    const workspace = captureActiveWorkspace();
    if (!workspace || existing.userId !== workspace.userId) return false;
    try {
      const saved = await saveRecordToDB(updated, workspace.coupleId, workspace.userId);
      if (!isCurrentWorkspace(workspace) || !saved) return false;
    } catch (error) {
      if (isCurrentWorkspace(workspace)) {
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
      if (!isCurrentWorkspace(workspace)) return false;
    }

    updateStateImmediately((current) =>
      isCurrentWorkspace(workspace) && stateMatchesWorkspace(current, workspace)
        ? {
            ...current,
            records: current.records.map((record) =>
              record.id === id ? recordToCommit : record,
            ),
          }
        : current,
    );
    return isCurrentWorkspace(workspace);
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

    const workspace = captureActiveWorkspace();
    if (!workspace || existing.userId !== workspace.userId) return false;
    try {
      const deleted = await deleteRecordFromDB(
        id,
        workspace.userId,
        workspace.coupleId,
      );
      if (!isCurrentWorkspace(workspace) || !deleted) return false;
    } catch (error) {
      if (isCurrentWorkspace(workspace)) console.error('Failed to delete record:', error);
      return false;
    }

    updateStateImmediately((current) =>
      isCurrentWorkspace(workspace) && stateMatchesWorkspace(current, workspace)
        ? { ...current, records: current.records.filter((record) => record.id !== id) }
        : current,
    );
    return isCurrentWorkspace(workspace);
  };

  const addEvent = async (
    event: Omit<CoupleEvent, 'id' | 'createdAt'>,
  ): Promise<boolean> => {
    const workspace = captureActiveWorkspace();
    if (
      !workspace
      || event.createdBy !== workspace.userId
      || event.coupleId !== workspace.coupleId
    ) return false;

    const newEvent: CoupleEvent = {
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    try {
      const saved = await import('@/lib/events').then((module) =>
        module.saveEventToDB(newEvent),
      );
      if (!isCurrentWorkspace(workspace) || !saved) return false;
      updateStateImmediately((prev) => isCurrentWorkspace(workspace) && stateMatchesWorkspace(prev, workspace)
        ? { ...prev, events: [...prev.events, saved] }
        : prev);
      return true;
    } catch (error) {
      if (isCurrentWorkspace(workspace)) console.error('Failed to save event:', error);
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
    const workspace = captureActiveWorkspace();
    const current = stateRef.current;
    if (
      !workspace
      && current.profile.couple.coupleId
      && current.profile.couple.connected
      && current.profile.couple.status === 'active'
    ) return { ok: false, reason: 'forbidden' };

    try {
      // Without an active couple the query returns only owner-private rows;
      // with one it additionally returns that couple's shared rows under RLS.
      const result = await fetchEventsResultFromDB(workspace?.coupleId);
      if (!isCurrentIdentity(identity)) return { ok: false, reason: 'forbidden' };
      if (workspace && !isCurrentWorkspace(workspace)) {
        return { ok: false, reason: 'forbidden' };
      }
      if (!result.ok) {
        if (workspace) quarantineSharedAccess(workspace);
        return result;
      }
      updateStateImmediately((prev) => isCurrentIdentity(identity)
        && (!workspace || (isCurrentWorkspace(workspace) && stateMatchesWorkspace(prev, workspace)))
        ? { ...prev, events: result.events }
        : prev);
      return { ok: true };
    } catch (error) {
      if (!isCurrentIdentity(identity)) return { ok: false, reason: 'forbidden' };
      if (workspace) quarantineSharedAccess(workspace);
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

  const disconnect = async (): Promise<boolean> => {
    const current = stateRef.current;
    if (current.isDemoMode) {
      // Demo mode never calls the configured backend.
      return purgeSharedAccess();
    }

    const workspace = captureActiveWorkspace();
    if (!workspace || workspaceRefMatches(pendingDisconnectRef.current, workspace)) return false;
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

  const deleteAccount = async (): Promise<{ ok: boolean; warnings: string[] }> => {
    if (stateRef.current.isDemoMode) {
      purgeLocalAccountData();
      return { ok: true, warnings: [] };
    }

    const identity = captureActiveIdentity();
    if (!identity) return { ok: false, warnings: [] };
    const result = await deleteAccountFromDB();
    // Account A's completion must never clear a session that has switched to B.
    if (!isCurrentIdentity(identity)) {
      return { ok: false, warnings: result.warnings };
    }
    if (!result.ok) return result;

    if (!purgeLocalAccountData(identity)) return result;
    try {
      await authRepository.signOut();
    } catch (error) {
      console.error('[gomsinlog] Sign-out after deletion failed; local data was cleared', error);
    }
    return result;
  };

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

  return (
    <StoreContext.Provider
      value={{
        state,
        isReady: isHydrated && isAuthChecked,
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
