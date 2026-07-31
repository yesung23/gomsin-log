import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  DailyRecord,
  UserProfile,
  Role,
  AuthUser,
  ILogRepository,
  CoupleEvent,
  Attachment,
} from '@/types';
import {
  authRepository,
  isSupabaseConfigured,
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
  fetchRecordsFromDB,
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

class LocalStorageRepository implements ILogRepository {
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
      const records = state.isDemoMode
        ? state.records.map((record) => {
            // Private records: keep only the skeleton so the body never sits in
            // localStorage as plaintext. The server remains the source of truth.
            if (record.isPrivate) {
              return {
                id: record.id,
                date: record.date,
                time: record.time,
                isPrivate: true,
                authorRole: record.authorRole,
              } as DailyRecord;
            }

            if (!record.attachments?.length) return record;
            return {
              ...record,
              attachments: record.attachments
                // Blob URLs are session-only; persisting them guarantees a broken
                // image after reload.
                .filter((att) => !(att.url?.startsWith('blob:') && !att.path))
                .map((att) =>
                  att.url?.startsWith('blob:') ? { ...att, url: undefined } : att,
                ),
            };
          })
        : [];
      const sanitizedState = {
        ...state,
        // Authenticated shared state is server-owned and must not survive a
        // partner-initiated revocation in browser storage.
        records,
        events: state.isDemoMode ? state.events : [],
        trips: state.isDemoMode ? state.trips : [],
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

  useEffect(() => {
    localRepository.loadState().then((stored) => {
      if (stored) {
        const safeStored = stored.isDemoMode
          ? stored
          : { ...stored, records: [], events: [], trips: [] };
        setState({
          ...DEFAULT_STATE,
          ...safeStored,
          // Respect the system preference until the user picks a theme explicitly.
          theme: safeStored.theme || preferredTheme(),
        });
        if (stored.authenticatedUser?.id) {
          hydratedUserIdRef.current = stored.authenticatedUser.id;
        }
      } else {
        setState((prev) => ({ ...prev, theme: preferredTheme() }));
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
            ) return;

            setState((prev) => {
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
            });

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
          setState((prev) => ({
            ...DEFAULT_STATE,
            isDemoMode: false,
            ...carryOverDevicePrefs(prev),
          }));
          setIsAuthChecked(true);
          return;
        }

        if (event === 'INITIAL_SESSION') {
          hydratedUserIdRef.current = null;
          setState((prev) =>
            // A demo session the user explicitly started must survive a reload.
            prev.isDemoMode && prev.setupComplete
              ? prev
              : { ...DEFAULT_STATE, isDemoMode: false, ...carryOverDevicePrefs(prev) },
          );
          setIsAuthChecked(true);
        }
      })();
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    // After an explicit sign-out / account deletion the cache stays empty until
    // the next real state change, so the purge cannot be silently undone.
    if (cachePurgedRef.current) {
      cachePurgedRef.current = false;
      return;
    }
    localRepository.saveState(state);
  }, [state, isHydrated]);

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
    // Realtime and explicit-operation guards consult stateRef before React has
    // committed the cleanup render.
    stateRef.current = nextState;
    setState(nextState);
    return true;
  }, []);

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

    const refreshSlice = async (slice: SyncSlice) => {
      if (!isCurrentActiveCouple()) return;
      try {
        if (slice === 'records') {
          const raw = await fetchRecordsFromDB(coupleId);
          if (!isCurrentActiveCouple()) return;
          const role = stateRef.current.profile.role;
          const partnerRole: Role = role === 'gomsin' ? 'soldier' : 'gomsin';
          const records = visibleRecordsForViewer(
            raw.map((r) => ({
              ...r,
              authorRole: r.userId === authUserId ? role : partnerRole,
            })),
            { userId: authUserId, role },
          );
          if (isCurrentActiveCouple()) setState((prev) => ({ ...prev, records }));
          return;
        }
        if (slice === 'events') {
          const result = await fetchEventsResultFromDB(coupleId);
          if (result.ok && isCurrentActiveCouple()) {
            setState((prev) => ({ ...prev, events: result.events }));
          }
          return;
        }
        const result = await fetchTripsResultFromDB(coupleId);
        if (result.ok && isCurrentActiveCouple()) {
          setState((prev) => ({ ...prev, trips: reconcileParentTrips(result.trips) }));
        }
      } catch (error) {
        console.error(`[gomsinlog] Realtime refresh of ${slice} failed:`, error);
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

    const reconcileOwnMembership = async (): Promise<boolean> => {
      if (!isCurrentActiveCouple()) return false;
      const { data, error } = await client.rpc('get_my_active_couple_id');
      if (!isCurrentActiveCouple()) return false;
      if (error) {
        console.error('[gomsinlog] Failed to verify active membership:', error);
        return false;
      }
      if (data !== coupleId) {
        purgeSharedAccess(workspace);
        return false;
      }
      return true;
    };

    // One channel covers the shared tables and the current user's own
    // membership row. A partner disconnect updates that row and revokes access.
    const channel = client
      .channel(`couple-sync:${coupleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'couple_members', filter: `user_id=eq.${authUserId}` },
        () => void reconcileOwnMembership(),
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
        // Re-check the authoritative membership after every initial subscribe
        // or reconnect, then refresh all shared slices to discard missed rows.
        if (status === 'SUBSCRIBED') {
          void (async () => {
            if (!await reconcileOwnMembership()) return;
            scheduleRefresh('records');
            scheduleRefresh('events');
            scheduleRefresh('trips');
          })();
        }
      });

    // Realtime messages are dropped while a mobile browser is backgrounded, so
    // verify membership first and only refresh shared slices if it is still active.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        if (!await reconcileOwnMembership()) return;
        scheduleRefresh('records');
        scheduleRefresh('events');
        scheduleRefresh('trips');
      })();
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
  }, [authUserId, coupleConnected, coupleId, coupleStatus, isAuthChecked, purgeSharedAccess]);

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
        setState((prev) => ({
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
  }, [authUserId, coupleConnected, coupleId, coupleStatus, isAuthChecked]);

  const updateProfile = (profileUpdates: Partial<UserProfile>) => {
    // Compute the next profile outside the updater. React StrictMode invokes
    // updaters twice, so performing network writes inside one would fire every
    // request twice.
    const prev = stateRef.current;
    const newProfile: UserProfile = { ...prev.profile, ...profileUpdates };
    setState((current) => ({ ...current, profile: { ...current.profile, ...profileUpdates } }));

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
    const prev = stateRef.current;
    const recordId = crypto.randomUUID();
    const newRecord: DailyRecord = {
      ...record,
      id: recordId,
      createdAt: new Date().toISOString(),
    };

    // Demo / offline: keep session-only preview URLs. These are deliberately not
    // persisted (see saveState) so a reload never shows a broken image.
    if (prev.isDemoMode || !prev.authenticatedUser) {
      const previews: Attachment[] = files.map((file) => {
        const classified = classifyMediaFile(file);
        return {
          type: 'error' in classified ? 'photo' : classified.type,
          name: file.name,
          url: URL.createObjectURL(file),
        };
      });
      const demoRecord: DailyRecord = {
        ...newRecord,
        attachments: [...(newRecord.attachments || []), ...previews],
      };
      setState((current) => ({ ...current, records: [...current.records, demoRecord] }));
      return { ok: true, failedFiles: [] };
    }

    const coupleId = prev.profile.couple.coupleId;
    if (!coupleId) {
      return {
        ok: false,
        failedFiles: files.map((f) => f.name),
        error: '커플 공간이 연결된 뒤에 기록을 남길 수 있어요.',
      };
    }
    const userId = prev.authenticatedUser.id;

    // Phase 1: persist the row so the storage policy can authorise the uploads.
    try {
      const saved = await saveRecordToDB(newRecord, coupleId, userId);
      if (!saved) {
        return { ok: false, failedFiles: files.map((f) => f.name), error: '기록을 저장하지 못했어요.' };
      }
    } catch (error) {
      console.error('[gomsinlog] Failed to save record:', error);
      return { ok: false, failedFiles: files.map((f) => f.name), error: '기록을 저장하지 못했어요.' };
    }

    // Phase 2: upload the files.
    const attachments: Attachment[] = [...(newRecord.attachments || [])];
    const failedFiles: string[] = [];
    for (const file of files) {
      const result = await uploadRecordMedia(file, coupleId, recordId);
      if ('error' in result) {
        failedFiles.push(file.name);
        console.error(`[gomsinlog] Attachment failed (${file.name}): ${result.error}`);
        continue;
      }
      attachments.push(result.attachment);
    }

    let finalRecord: DailyRecord = { ...newRecord, attachments };

    // Phase 3: patch the row with attachment metadata.
    if (attachments.length > 0) {
      try {
        const patched = await saveRecordToDB(finalRecord, coupleId, userId);
        if (!patched) {
          // The text is already safe on the server; drop the orphaned objects so
          // the bucket does not accumulate files no record points at.
          await removeRecordMedia(attachments.map((a) => a.path).filter(Boolean) as string[]);
          failedFiles.push(...files.map((f) => f.name));
          finalRecord = { ...newRecord, attachments: newRecord.attachments || [] };
        }
      } catch (error) {
        console.error('[gomsinlog] Failed to attach media to record:', error);
        await removeRecordMedia(attachments.map((a) => a.path).filter(Boolean) as string[]);
        failedFiles.push(...files.map((f) => f.name));
        finalRecord = { ...newRecord, attachments: newRecord.attachments || [] };
      }
    }

    // Make the freshly uploaded files viewable right away.
    if (finalRecord.attachments && finalRecord.attachments.length > 0) {
      finalRecord = {
        ...finalRecord,
        attachments: await resolveAttachmentUrls(finalRecord.attachments),
      };
    }

    setState((current) => ({ ...current, records: [...current.records, finalRecord] }));
    return { ok: true, failedFiles: Array.from(new Set(failedFiles)) };
  };

  const updateRecord = async (id: string, updates: Partial<DailyRecord>): Promise<boolean> => {
    // Computed outside the updater so StrictMode's double invocation cannot
    // fire the DB write twice.
    const prev = stateRef.current;
    const existing = prev.records.find((r) => r.id === id);
    if (!existing) return false;
    const updated: DailyRecord = { ...existing, ...updates };

    if (!prev.isDemoMode && prev.authenticatedUser) {
      const coupleId = prev.profile.couple.coupleId;
      if (!coupleId) return false;
      // Only the author may edit a record; the server enforces this too but
      // failing fast keeps local state consistent with the server.
      if (existing.userId && existing.userId !== prev.authenticatedUser.id) return false;
      try {
        const saved = await saveRecordToDB(updated, coupleId, prev.authenticatedUser.id);
        if (!saved) return false;
      } catch (error) {
        console.error('[gomsinlog] Failed to update record:', error);
        return false;
      }
    }

    setState((current) => ({
      ...current,
      records: current.records.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
    return true;
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

  const captureActiveIdentity = (): ActiveIdentity | null => {
    const current = stateRef.current;
    const userId = current.authenticatedUser?.id;
    if (!userId || sessionUserIdRef.current !== userId) return null;
    return { userId, generation: sessionGenerationRef.current };
  };

  const isCurrentIdentity = (identity: ActiveIdentity): boolean =>
    sessionGenerationRef.current === identity.generation
    && sessionUserIdRef.current === identity.userId
    && stateRef.current.authenticatedUser?.id === identity.userId;

  const captureActiveWorkspace = (): ActiveWorkspace | null => {
    const identity = captureActiveIdentity();
    const current = stateRef.current;
    const activeCoupleId = current.profile.couple.coupleId;
    if (!identity || !activeCoupleId) return null;
    const workspace = {
      ...identity,
      coupleId: activeCoupleId,
    };
    return stateMatchesWorkspace(current, workspace) ? workspace : null;
  };

  const isCurrentWorkspace = (workspace: ActiveWorkspace): boolean =>
    sessionGenerationRef.current === workspace.generation
    && sessionUserIdRef.current === workspace.userId
    && stateMatchesWorkspace(stateRef.current, workspace);

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
      setState((prev) => isCurrentWorkspace(workspace) && stateMatchesWorkspace(prev, workspace)
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
    setState((prev) => isCurrentScope()
      ? { ...prev, events: prev.events.map((event) => (event.id === id ? updated : event)) }
      : prev);

    try {
      const saved = await import('@/lib/events').then((module) =>
        module.updateEventInDB(updated),
      );
      if (!isCurrentScope()) return false;
      if (!saved) {
        setState((prev) => isCurrentScope()
          ? { ...prev, events: prev.events.map((event) => (event.id === id ? existing : event)) }
          : prev);
        return false;
      }
      setState((prev) => isCurrentScope()
        ? { ...prev, events: prev.events.map((event) => (event.id === id ? saved : event)) }
        : prev);
      return true;
    } catch (error) {
      if (!isCurrentScope()) return false;
      console.error('Failed to update event:', error);
      setState((prev) => isCurrentScope()
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

    setState((prev) => isCurrentScope()
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

    try {
      // Without an active couple the query returns only owner-private rows;
      // with one it additionally returns that couple's shared rows under RLS.
      const result = await fetchEventsResultFromDB(workspace?.coupleId);
      if (!isCurrentIdentity(identity)) return { ok: false, reason: 'forbidden' };
      if (workspace && !isCurrentWorkspace(workspace)) {
        return { ok: false, reason: 'forbidden' };
      }
      if (!result.ok) return result;
      setState((prev) => isCurrentIdentity(identity)
        && (!workspace || (isCurrentWorkspace(workspace) && stateMatchesWorkspace(prev, workspace)))
        ? { ...prev, events: result.events }
        : prev);
      return { ok: true };
    } catch (error) {
      if (!isCurrentIdentity(identity)) return { ok: false, reason: 'forbidden' };
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
    setState((prev) => {
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
    const disconnectIdentity = current.authenticatedUser?.id && current.profile.couple.coupleId
      ? {
          userId: current.authenticatedUser.id,
          coupleId: current.profile.couple.coupleId,
          generation: sessionGenerationRef.current,
        }
      : undefined;
    try {
      if (isSupabaseConfigured) {
        const disconnected = await disconnectCoupleFromDB();
        if (!disconnected) return false;
      }
      return purgeSharedAccess(disconnectIdentity);
    } catch (e) {
      console.error('Failed to disconnect:', e);
      return false;
    }
  };

  /**
   * Drop every trace of the signed-in account from this device.
   * Only device-level preferences (theme, widget layout) are kept.
   */
  const purgeLocalAccountData = () => {
    hydratedUserIdRef.current = null;
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
    stateRef.current = nextState;
    setState(nextState);
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

    const result = await deleteAccountFromDB();
    // Only purge after the server confirms deletion, so a failed attempt leaves
    // the user signed in and able to retry.
    if (!result.ok) return result;

    purgeLocalAccountData();
    try {
      await authRepository.signOut();
    } catch (error) {
      console.error('[gomsinlog] Sign-out after deletion failed; local data was cleared', error);
    }
    return result;
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
