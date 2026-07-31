import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
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
import {
  saveRecordToDB,
  deleteRecordFromDB,
  uploadRecordMedia,
  removeRecordMedia,
  resolveAttachmentUrls,
  classifyMediaFile,
} from '@/lib/records';
import { withTimeout, AUTH_SYNC_TIMEOUT_MS } from '@/lib/async';

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
      const sanitizedState = {
        ...state,
        records: state.records.map((record) => {
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
        }),
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

interface StoreContextType {
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
  /**
   * The user id whose server state we have already loaded. Lets us ignore
   * TOKEN_REFRESHED / USER_UPDATED events instead of re-running the full sync,
   * and lets us detect an account switch so we never show account A's cached
   * records to account B.
   */
  const hydratedUserIdRef = useRef<string | null>(null);
  /** Set while signing out / deleting so the persistence effect cannot resurrect the cache. */
  const cachePurgedRef = useRef(false);
  /** Always-current state, so actions can read it without depending on stale closures. */
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    localRepository.loadState().then((stored) => {
      if (stored) {
        setState({
          ...DEFAULT_STATE,
          ...stored,
          theme: stored.theme || 'light',
        });
        if (stored.authenticatedUser?.id) {
          hydratedUserIdRef.current = stored.authenticatedUser.id;
        }
      }
      setIsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!supabase || !isHydrated) return;
    let disposed = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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
            hydratedUserIdRef.current !== null && hydratedUserIdRef.current !== sessionUser.id;

          try {
            cachePurgedRef.current = false;
            // A hanging fetch must never keep the app behind the splash spinner.
            const dbState = await withTimeout(
              fetchFullStateFromDB(sessionUser.id),
              AUTH_SYNC_TIMEOUT_MS,
              null,
            );
            if (disposed) return;

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
            if (!disposed) setIsAuthChecked(true);
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

  /**
   * Drop every trace of the signed-in account from this device.
   * Only device-level preferences (theme, widget layout) are kept.
   */
  const purgeLocalAccountData = () => {
    hydratedUserIdRef.current = null;
    cachePurgedRef.current = true;
    localStorage.removeItem(STORE_KEY_V1);
    localStorage.removeItem(STORE_KEY);
    setState((prev) => ({
      ...DEFAULT_STATE,
      isDemoMode: false,
      ...carryOverDevicePrefs(prev),
    }));
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

  const deleteAccount = async (): Promise<boolean> => {
    if (stateRef.current.isDemoMode) {
      purgeLocalAccountData();
      return true;
    }

    const deleted = await deleteAccountFromDB();
    // Only purge after the server confirms deletion, so a failed attempt leaves
    // the user signed in and able to retry.
    if (!deleted) return false;

    purgeLocalAccountData();
    try {
      await authRepository.signOut();
    } catch (error) {
      console.error('[gomsinlog] Sign-out after deletion failed; local data was cleared', error);
    }
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
        addRecordWithMedia,
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
