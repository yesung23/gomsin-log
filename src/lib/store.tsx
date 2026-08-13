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
import { DEFAULT_LAYOUT_BY_ROLE, migrateWidgetLayout } from '@/lib/widgets';
import { clearAllComposerDrafts } from '@/lib/composerDraft';
import { clearAllAvatars } from '@/lib/avatarImage';
import { revokeCycleSensitiveConsent } from '@/lib/sensitiveConsent';
import {
  authRepository,
  supabase,
  disconnectCoupleFromDB,
  deleteAccountFromDB,
  saveCoupleAnniversary,
  fetchMyCoupleState,
} from '@/lib/supabase';
import {
  fetchFullStateResultFromDB,
  FULL_STATE_UNAVAILABLE,
  type AuthSyncStage,
} from '@/lib/sync';
import {
  classifyServerError,
  serverErrorMessage,
  type ServerErrorKind,
} from '@/lib/serverErrors';
import {
  deriveCoupleLifecycle,
  mergeCoupleState,
  type CoupleLifecycle,
  type RemoteCoupleState,
} from '@/lib/coupleLifecycle';
import {
  deleteEventFromDB,
  fetchEventsResultFromDB,
  saveEventToDB,
  updateEventInDB,
} from '@/lib/events';
import { fetchTripsResultFromDB, reconcileParentTrips } from '@/lib/trips';
import {
  fetchTalkAboutMarksFromDB,
  markTalkAboutInDB,
  unmarkTalkAboutInDB,
  resolveTalkAboutInDB,
} from '@/lib/talkAbout';
import { visibleRecordsForViewer } from '@/lib/privacy';
import {
  applyDeliveryOutcome,
  countForAccount as countOutbox,
  deliverableForAccount,
  discardEntry as discardOutboxEntry,
  enqueueRecord,
  isRetryableReason,
  pendingForAccount,
  purgeAccount as purgeOutboxAccount,
  unblockEntry,
  type OutboxPersistence,
} from '@/lib/outbox';
import { createIndexedDbOutbox } from '@/lib/outboxStorage';
import {
  saveRecordToDB,
  deleteRecordFromDB,
  fetchRecordsResultFromDB,
  uploadRecordMedia,
  removeRecordMedia,
  resolveAttachmentUrls,
  isCanonicalRecordMediaPath,
} from '@/lib/records';
import { StoreContext } from '@/lib/storeContext';
import type {
  RecordMutationReason,
  RecordMutationResult,
  SharedSyncStatus,
} from '@/lib/storeContext';
import {
  assertNever,
  classifyDeletionStatus,
  clearRecoveryMarker,
  deletionStatusLogToken,
  markRecoveryPending,
  readRecoveryMarker,
  registerServerCallGate,
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
const LIGHT_THEME_COLOR = '#FFF7F7';
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

class DevicePreferencesRepository {
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
      // Browser storage is a strict device-preference whitelist. Auth, profile,
      // couple, invite, military, contact and shared/private content remain
      // server/session-owned. `hasAuthenticatedSession` stays in the signature
      // because callers already know it, but both signed-in and signed-out states
      // now obey the same rule: local storage never becomes an account database.
      void hasAuthenticatedSession;
      localStorage.setItem(STORE_KEY, JSON.stringify(carryOverDevicePrefs(state)));
    } catch (e) {
      console.error('[gomsinlog] Failed to save state to localStorage', e);
    }
  }
}

const DEFAULT_STATE: AppState = {
  setupComplete: false,
  onboardingStep: 0,
  authenticatedUser: null,
  profile: {
    myName: '',
    role: 'gomsin',
    couple: {
      partnerName: '',
      // No invented anniversary, for the same reason the military block below
      // carries none: a literal here produces a confident "+N일째" for a couple
      // that has never stated a date. Unknown until they do.
      anniversaryDate: undefined,
      coupleCode: '',
      connected: false,
      status: 'pending',
    },
    // No invented service period. This block used to carry the same fabricated
    // enlistment/discharge pair as the sync fallback, which seeded a fake D-Day
    // for any state that predates the field. Unknown until the user states it.
    military: {
      branch: 'army',
      militaryStatus: 'unknown',
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
  talkAboutMarks: [],
  widgetLayout: DEFAULT_LAYOUT_BY_ROLE.gomsin,
  soldierWidgetLayout: DEFAULT_LAYOUT_BY_ROLE.soldier,
  hasSeenInstallPrompt: false,
  theme: 'light',
};

/**
 * Preferences that belong to the device rather than to the signed-in account.
 * These survive sign-out and account switches; everything else must not.
 */
function carryOverDevicePrefs(
  prev: AppState,
): Pick<AppState, 'widgetLayout' | 'soldierWidgetLayout' | 'hasSeenInstallPrompt' | 'theme'> {
  return {
    widgetLayout: prev.widgetLayout,
    // Kept per role: the two people use one app on two devices with opposite
    // home screens, and a single shared list meant whoever edited last
    // overwrote the other's arrangement on role change.
    soldierWidgetLayout: prev.soldierWidgetLayout,
    hasSeenInstallPrompt: prev.hasSeenInstallPrompt,
    theme: prev.theme || 'light',
  };
}

const devicePreferencesRepository = new DevicePreferencesRepository();

/**
 * Whether a resolved deletion status must stop a server call.
 *
 * Exhaustive at compile time: a fourth variant, or an unhandled `unknown`, is a
 * TYPE ERROR rather than a silent fall-through into permissive behaviour.
 */
/**
 * Korean copy for every way a record mutation can fail.
 *
 * Total over the union, so a new reason cannot ship with an empty toast. Server
 * causes defer to `serverErrors.ts` rather than restating its wording, which is
 * what keeps the "no internet message unless actually offline" rule in one place.
 */
function recordFailureMessage(reason: RecordMutationReason): string {
  switch (reason) {
    case 'stale':
      return '계정 또는 커플 공간이 변경되어 작업을 중단했어요.';
    case 'missing':
      return '기록을 찾을 수 없어요. 새로고침한 뒤 다시 시도해 주세요.';
    case 'not_owner':
      return '내가 남긴 기록만 수정하거나 삭제할 수 있어요.';
    case 'no_workspace':
      return '커플 공간을 만든 뒤에 기록을 남길 수 있어요.';
    case 'workspace_unresolved':
      return '지금 커플 공간을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.';
    case 'workspace_unconfigured':
      // PRIORITY 1. The membership RPC is not deployed, so no amount of retrying
      // changes the answer and the couple space is probably fine. Naming the
      // server setup is the only honest and actionable thing to say -- the
      // alternatives on this path were a transient-retry message and, worse, a
      // connection diagnosis for a device that was online.
      return '서버 설정이 아직 끝나지 않아 커플 공간을 확인할 수 없어요. 관리자에게 문의해 주세요.';
    case 'deletion_pending':
      return '탈퇴 처리가 진행 중이어서 기록을 저장할 수 없어요.';
    default:
      return serverErrorMessage(reason);
  }
}

function recordFailure(reason: RecordMutationReason): RecordMutationResult {
  return { ok: false, reason, error: recordFailureMessage(reason) };
}

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
   * Why hydration failed. Kept outside `AppState` (never persisted) and reset to
   * `null` on every success, so the outage screen cannot show a stale cause.
   */
  const [authSyncReason, setAuthSyncReason] = useState<ServerErrorKind | null>(null);
  const [authSyncStage, setAuthSyncStage] = useState<AuthSyncStage | null>(null);
  const [authSyncCode, setAuthSyncCode] = useState<string | null>(null);
  /**
   * Server-authoritative couple lifecycle, starting at `unknown` because nothing
   * has been asked yet. It is never initialised to `personal`: that would render
   * "create a space" to a connected user for one frame.
   */
  const [coupleLifecycle, setCoupleLifecycle] = useState<CoupleLifecycle>('unknown');
  const [invitationExpiresAt, setInvitationExpiresAt] = useState<string | null>(null);
  /**
   * A couple space this session demonstrably had and lost.
   *
   * `deriveCoupleLifecycle` can only answer `disconnected` while a local
   * `coupleId` survives as evidence, and the purge clears that id first -- so the
   * next authoritative read said `personal` and offered "create a space" to
   * someone who had just been disconnected, which for a remotely disconnected
   * partner is indistinguishable from a brand-new account.
   *
   * In memory ONLY, and scoped to one user id: persisting it would put couple
   * state back into browser storage (which the device-preference whitelist
   * deliberately excludes) and could carry across an account switch. A reload
   * therefore still reads `personal`, which is the honest limit of what the
   * client can know once the server says "no membership".
   */
  const revokedCoupleRef = useRef<{ userId: string; coupleId: string } | null>(null);
  /**
   * In-flight session refresh, so N parallel failures cause ONE refresh attempt
   * rather than N competing ones.
   */
  const authRecoveryRef = useRef<Promise<boolean> | null>(null);
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

  /**
   * Persistence for writes the network refused. Null where IndexedDB does not
   * exist, in which case nothing is ever reported as queued -- see `queueOrFail`.
   */
  const outboxRef = useRef<OutboxPersistence | null>(null);
  if (outboxRef.current === null) outboxRef.current = createIndexedDbOutbox();
  const [outboxCounts, setOutboxCounts] = useState<{ waiting: number; blocked: number }>(
    { waiting: 0, blocked: 0 },
  );
  /** Single-flight: a flush triggered by `online` must not race one from visibility. */
  const flushInFlightRef = useRef(false);
  /**
   * The flush, reachable from the realtime effect.
   *
   * A ref rather than a dependency: `flushOutbox` closes over `addRecordWithMedia`
   * and is redefined on every render, so listing it would tear down and rebuild the
   * realtime channel constantly.
   */
  const flushOutboxRef = useRef<(() => Promise<unknown>) | null>(null);

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

  /**
   * The single recovery path for a lost session.
   *
   * Exactly ONE `refreshSession()` attempt per burst, then a decision:
   *
   *  - refreshed: the caller may retry its operation, and no message is shown at
   *    all, because from the user's point of view nothing went wrong.
   *  - not refreshed: sign out and surface the session copy. Signing out routes
   *    through `onAuthStateChange`'s `SIGNED_OUT` branch, so the local purge and
   *    the route change are the same ones every other sign-out uses -- there is no
   *    second, subtly different teardown path to keep in sync.
   *
   * Returns whether the session was rescued.
   */
  const handleAuthExpired = useCallback(async (): Promise<boolean> => {
    const client = supabase;
    if (!client) return false;
    const existing = authRecoveryRef.current;
    if (existing) return existing;

    const attempt = (async (): Promise<boolean> => {
      try {
        const { data, error } = await client.auth.refreshSession();
        if (!error && data?.session) {
          setAuthSyncReason(null);
          return true;
        }
        console.warn('[gomsinlog] Session refresh failed; signing out', error);
      } catch (error) {
        console.warn('[gomsinlog] Session refresh threw; signing out', error);
      }
      // The session cannot be rescued. Say so in Korean and never let a raw
      // permission/DB string reach the UI for this cause.
      setAuthSyncReason('auth_expired');
      try {
        await authRepository.signOut();
      } catch (error) {
        console.error('[gomsinlog] Sign-out after session expiry failed', error);
      }
      return false;
    })();

    authRecoveryRef.current = attempt;
    void attempt.finally(() => {
      if (authRecoveryRef.current === attempt) authRecoveryRef.current = null;
    });
    return attempt;
  }, []);

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
   * Ask the server what couple space this account is in, and merge the answer.
   *
   * This is the ONLY authoritative answer available to the client: migration 013
   * revoked SELECT on `invitation_codes`, so nothing else can distinguish a
   * pending creator from a personal user. See `coupleLifecycle.ts` for the merge
   * contract -- in particular that a failed answer returns local state untouched
   * and yields `unknown`.
   */
  const refreshCoupleLifecycle = useCallback(async (): Promise<CoupleLifecycle> => {
    const identity = captureActiveIdentity();
    if (!identity) return 'unknown';

    // This runs from background timers (the pending-partner poll) as well as from
    // hydration, so an unexpected throw here must not escape as an unhandled
    // rejection. An unusable answer is `unknown`, which by contract changes
    // nothing.
    let result: Awaited<ReturnType<typeof fetchMyCoupleState>>;
    try {
      result = await fetchMyCoupleState();
    } catch (error) {
      console.error('[gomsinlog] Couple lifecycle probe threw:', error);
      result = { ok: false, reason: 'unknown' };
    }
    if (!isCurrentIdentity(identity)) return 'unknown';
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      console.error('[gomsinlog] Couple lifecycle probe returned an unusable value.');
      setCoupleLifecycle('unknown');
      return 'unknown';
    }

    if (!result.ok) {
      if (result.reason === 'auth_expired') void handleAuthExpired();
      // `undefined` (not `null`) is the "could not ask" signal, so the merge
      // leaves local state exactly as it was.
      setCoupleLifecycle(deriveCoupleLifecycle(undefined, stateRef.current.profile.couple));
      return 'unknown';
    }

    const remote: RemoteCoupleState | null = result.state;
    const derived = deriveCoupleLifecycle(remote, stateRef.current.profile.couple);
    /**
     * A definite "no couple space" for an account whose space was revoked in
     * this session is `disconnected`, not `personal`. Both are definite negative
     * answers, so this is not an `unknown`-to-negative promotion: it only picks
     * the honest wording between two negatives.
     */
    if (remote?.coupleId) {
      // A space exists again, so the revocation is history.
      revokedCoupleRef.current = null;
    } else if (derived === 'disconnected') {
      const revokedCoupleId = stateRef.current.profile.couple.coupleId;
      revokedCoupleRef.current = revokedCoupleId
        ? { userId: identity.userId, coupleId: revokedCoupleId }
        : revokedCoupleRef.current;
    }
    const lifecycle: CoupleLifecycle =
      derived === 'personal' && revokedCoupleRef.current?.userId === identity.userId
        ? 'disconnected'
        : derived;
    updateStateImmediately((current) => {
      if (!isCurrentIdentity(identity)) return current;
      const merged = mergeCoupleState(current.profile.couple, remote);
      return merged === current.profile.couple
        ? current
        : { ...current, profile: { ...current.profile, couple: merged } };
    });
    setCoupleLifecycle(lifecycle);
    setInvitationExpiresAt(
      remote?.invitationActive ? remote.invitationExpiresAt : null,
    );
    return lifecycle;
  }, [captureActiveIdentity, handleAuthExpired, isCurrentIdentity, updateStateImmediately]);

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
      ...carryOverDevicePrefs(current),
      authenticatedUser: current.authenticatedUser,
    };
    // Rewrite `STORE_KEY` through the existing save path, then block the save
    // effect so it cannot resurrect the cache on the next render. The recovery
    // marker lives at its own top-level key and is untouched by either.
    void devicePreferencesRepository.saveState(nextState, sessionUserIdRef.current !== null);
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
    devicePreferencesRepository.loadState().then((stored) => {
      if (stored) {
        const theme = stored.theme === 'light' || stored.theme === 'dark'
          ? stored.theme
          : preferredTheme();
        const devicePrefs = {
          widgetLayout: Array.isArray(stored.widgetLayout)
            && stored.widgetLayout.every((item) => typeof item === 'string')
            ? migrateWidgetLayout(stored.widgetLayout, 'gomsin')
            : DEFAULT_STATE.widgetLayout,
          soldierWidgetLayout: Array.isArray(stored.soldierWidgetLayout)
            && stored.soldierWidgetLayout.every((item: unknown) => typeof item === 'string')
            ? stored.soldierWidgetLayout
            : DEFAULT_STATE.soldierWidgetLayout,
          hasSeenInstallPrompt: typeof stored.hasSeenInstallPrompt === 'boolean'
            ? stored.hasSeenInstallPrompt
            : DEFAULT_STATE.hasSeenInstallPrompt,
          theme,
        };
        // Older releases could persist complete sample-account content here.
        // Retain only harmless device preferences and drop all profile,
        // relationship and record data on first launch.
        const nextState: AppState = { ...DEFAULT_STATE, ...devicePrefs };
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

  /**
   * Publish the pre-flight gate to the data-layer modules whose mutations are
   * issued directly by pages rather than through `StoreContextType` (trips,
   * cycle, invitations). Without this they would issue writes for an account
   * whose deletion is pending, which is exactly what clause 2.46 forbids.
   */
  useEffect(() => {
    registerServerCallGate(ensureNotPendingBeforeServerCall);
    return () => registerServerCallGate(null);
  }, [ensureNotPendingBeforeServerCall]);

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
        setAuthSyncReason(null);
        setAuthSyncStage(null);
        setAuthSyncCode(null);
        hydratedUserIdRef.current = null;
        // The couple lifecycle and the invitation expiry belong to the account
        // that is leaving. Nobody has asked the question for the incoming
        // account yet, so the only truthful value is `unknown` -- keeping the
        // previous verdict rendered account A's `connected` (which suppresses
        // the banner entirely) and account A's expiry for account B.
        revokedCoupleRef.current = null;
        setCoupleLifecycle('unknown');
        setInvitationExpiresAt(null);
        // Fail closed before account hydration starts: the previous account's
        // React state must not remain rendered during the network request.
        setIsAuthChecked(false);
        const current = stateRef.current;
        const clearedState: AppState = {
          ...DEFAULT_STATE,
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
                ...carryOverDevicePrefs(stateRef.current),
                authenticatedUser: authUser,
              });
              return;
            }
            setAccountDeletionRecovery(null);

            const authReconciliationRevision = membershipReconciliationRef.current;
            // A hanging fetch must never keep the app behind the splash spinner.
            let hydration = await withTimeout(
              fetchFullStateResultFromDB(sessionUser.id),
              AUTH_SYNC_TIMEOUT_MS,
              {
                ok: false as const,
                reason: 'unknown' as ServerErrorKind,
                stage: 'timeout' as const,
              },
            );
            // One refresh, then one retry of the SAME read. An expired JWT is the
            // single most common cause of a first-load failure after the app has
            // been backgrounded overnight, and it is fully recoverable.
            if (!hydration.ok && hydration.reason === 'auth_expired') {
              const refreshed = await handleAuthExpired();
              if (
                disposed
                || sessionGenerationRef.current !== authGeneration
                || sessionUserIdRef.current !== sessionUser.id
              ) return;
              if (refreshed) {
                hydration = await withTimeout(
                  fetchFullStateResultFromDB(sessionUser.id),
                  AUTH_SYNC_TIMEOUT_MS,
                  {
                    ok: false as const,
                    reason: 'unknown' as ServerErrorKind,
                    stage: 'timeout' as const,
                  },
                );
              }
            }
            const dbState = hydration.ok ? hydration.state : FULL_STATE_UNAVAILABLE;
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
            // A known auth loss is the most specific and most actionable cause, so a
            // concurrent hydration pass that failed for a vaguer reason must not mask
            // it: that would replace "다시 로그인해 주세요" with "잠시 후 다시 시도해
            // 주세요" and strand the user on a retry that cannot succeed. Success
            // still clears it outright.
            setAuthSyncReason((previous) => {
              if (hydration.ok) return null;
              return previous === 'auth_expired' ? previous : hydration.reason;
            });
            setAuthSyncStage(hydration.ok ? null : hydration.stage);
            setAuthSyncCode(hydration.ok ? null : hydration.code ?? null);
            if (syncUnavailable) {
              // A failed hydration answers nothing about the couple space, so the
              // lifecycle must go to `unknown` -- never to `personal`.
              setCoupleLifecycle('unknown');
              setInvitationExpiresAt(null);
            }
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
                ...dbState,
                ...(remoteProfile ? { profile: remoteProfile } : {}),
              };
            })();
            replaceStateImmediately(nextState);

            hydratedUserIdRef.current = dbState && dbState !== FULL_STATE_UNAVAILABLE
              ? sessionUser.id
              : null;

            // Ask the server for the lifecycle only once the local snapshot is in
            // place, so the merge has something coherent to merge into. A failure
            // here leaves that snapshot untouched by contract.
            if (!syncUnavailable) void refreshCoupleLifecycle();
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
          // Same reason as the identity-change reset above: a signed-out device
          // holds no answer about any account's couple space.
          revokedCoupleRef.current = null;
          setCoupleLifecycle('unknown');
          setInvitationExpiresAt(null);
          const nextState: AppState = {
            ...DEFAULT_STATE,
            ...carryOverDevicePrefs(stateRef.current),
          };
          replaceStateImmediately(nextState);
          setIsAuthChecked(true);
          return;
        }

        if (event === 'INITIAL_SESSION') {
          hydratedUserIdRef.current = null;
          const current = stateRef.current;
          const nextState = { ...DEFAULT_STATE, ...carryOverDevicePrefs(current) };
          replaceStateImmediately(nextState);
          setIsAuthChecked(true);
        }
      })();
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [
    applyDeletionStatus,
    handleAuthExpired,
    isHydrated,
    refreshCoupleLifecycle,
    replaceStateImmediately,
    verifyDeletionStatus,
  ]);

  useEffect(() => {
    if (!isHydrated || (supabase && !isAuthChecked)) return;
    // After an explicit sign-out / account deletion the cache stays empty until
    // the next real state change, so the purge cannot be silently undone.
    if (cachePurgedRef.current) {
      cachePurgedRef.current = false;
      return;
    }
    devicePreferencesRepository.saveState(state, sessionUserIdRef.current !== null);
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
      // Couple-scoped coordination metadata goes with the workspace. The
      // 이야기할 것 list would render empty anyway, since it can only show
      // records that are present -- but stale couple metadata should not
      // outlive the authorization that produced it.
      talkAboutMarks: [],
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
    // The lifecycle is what every banner reads, and it renders NOTHING for
    // `connected`. Leaving it stale here is what emptied the timeline with no
    // explanation and no reconnect route until the app was reloaded.
    const revokedCoupleId = current.profile.couple.coupleId;
    const revokedUserId = current.authenticatedUser?.id;
    revokedCoupleRef.current = revokedCoupleId && revokedUserId
      ? { userId: revokedUserId, coupleId: revokedCoupleId }
      : null;
    setCoupleLifecycle('disconnected');
    // The expiry described the invitation of the space that just went away.
    setInvitationExpiresAt(null);
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
      talkAboutMarks: [],
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
        // An expired session is not evidence that membership was revoked, so it
        // must not look like one. Recover the session centrally and let the retry
        // path re-ask; the workspace is quarantined meanwhile, not purged.
        if (classifyServerError(error).kind === 'auth_expired') void handleAuthExpired();
        quarantineSharedAccess(workspace);
        return false;
      }
      if (data !== workspace.coupleId) {
        purgeSharedAccess(workspace);
        return false;
      }

      // Recovery is never snapshot-based: every shared slice must be read again
      // through the caller's current RLS policy after membership is confirmed.
      const [recordsResult, eventsResult, tripsResult, talkAboutMarks] = await Promise.all([
        fetchRecordsResultFromDB(workspace.coupleId),
        fetchEventsResultFromDB(workspace.coupleId),
        fetchTripsResultFromDB(workspace.coupleId),
        // Metadata only, and deliberately not part of the ok/quarantine gate
        // below: a mark list that fails to load costs the user a section of
        // the home screen, whereas treating it as authoritative would
        // quarantine the whole shared workspace over a coordination detail.
        // It returns [] on failure, which renders as "nothing to talk about".
        fetchTalkAboutMarksFromDB(workspace.coupleId),
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
        talkAboutMarks,
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
    handleAuthExpired,
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
      // A queued write waits for exactly this moment: the tab came back, or the
      // connection did. Single-flighted inside `flushOutbox`, so the two listeners
      // firing together cost one pass, not two.
      void flushOutboxRef.current?.();
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
      // The lifecycle RPC is what keeps the invitation's validity and expiry
      // current while we wait; `get_partner_profile` is still the only source of
      // the partner's display name.
      void refreshCoupleLifecycle();
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
        setCoupleLifecycle('connected');
        setInvitationExpiresAt(null);
        return; // Connected: stop polling.
      }

      if (error) {
        console.error('[gomsinlog] Partner lookup failed:', error);
        if (error.code === 'PGRST301') void handleAuthExpired();
      }
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
    handleAuthExpired,
    isAuthChecked,
    refreshCoupleLifecycle,
    updateStateImmediately,
  ]);

  const updateProfile = async (
    profileUpdates: Partial<UserProfile>,
    options: { persist?: boolean } = {},
  ): Promise<boolean> => {
    // Compute the next profile outside the updater. React StrictMode invokes
    // updaters twice, so performing network writes inside one would fire every
    // request twice.
    const prev = stateRef.current;
    const newProfile: UserProfile = { ...prev.profile, ...profileUpdates };
    const commitLocally = () => updateStateImmediately((current) => ({
      ...current,
      profile: { ...current.profile, ...profileUpdates },
    }));

    if (options.persist === false || !supabase || !prev.authenticatedUser) {
      commitLocally();
      return true;
    }
    const userId = prev.authenticatedUser.id;
    const identity = captureActiveIdentity();
    if (!identity) return false;

    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) return false;
    if (!isCurrentIdentity(identity)) return false;

    try {
      if (
        profileUpdates.myName !== undefined
        || profileUpdates.military !== undefined
        || profileUpdates.role !== undefined
      ) {
        const { data, error } = await supabase
        .from('profiles')
        .update({
          display_name: newProfile.myName,
          role: newProfile.role,
          military_info: newProfile.military,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('id')
        .maybeSingle();
        if (error) {
          console.error('[gomsinlog] Failed to update profile:', error);
          return false;
        }
        // PostgREST can answer an RLS-filtered UPDATE with no error and zero rows.
        // Only a returned copy of this exact profile proves the write happened.
        if (data?.id !== userId) {
          console.error('[gomsinlog] Profile update matched no accessible row.');
          return false;
        }
      }

      if (profileUpdates.contact) {
        const { error } = await supabase.from('contact_preferences').upsert({
          user_id: userId,
          weekday_start: newProfile.contact.weekdayStart,
          weekday_end: newProfile.contact.weekdayEnd,
          weekend_start: newProfile.contact.weekendStart,
          weekend_end: newProfile.contact.weekendEnd,
        });
        if (error) {
          console.error('[gomsinlog] Failed to update contact preferences:', error);
          return false;
        }
      }

      // `undefined` intentionally clears an existing date by writing SQL NULL.
      const nextAnniversary = profileUpdates.couple?.anniversaryDate;
      const coupleId = newProfile.couple.coupleId;
      if (coupleId && nextAnniversary !== prev.profile.couple.anniversaryDate) {
        const saved = await saveCoupleAnniversary(coupleId, nextAnniversary || null);
        if (!saved) return false;
      }

      if (!isCurrentIdentity(identity)) return false;
      commitLocally();
      return true;
    } catch (error) {
      console.error('[gomsinlog] Failed to update profile settings:', error);
      return false;
    }
  };

  const addRecord = async (record: Omit<DailyRecord, 'id' | 'createdAt'>): Promise<boolean> => {
    const result = await addRecordWithMedia(record, []);
    return result.ok;
  };

  /**
   * Resolve the caller's couple space when local state does not have it.
   *
   * Three outcomes, and the difference between them is the whole point:
   *
   *  - a definite couple id: adopt it into state and let the write proceed;
   *  - a definite "no couple space": the personal-mode message is CORRECT;
   *  - no answer: a retryable message. Never the create-a-space message (which
   *    would be a lie), and never a connection message when the cause was
   *    authorization.
   */
  const resolveWorkspaceOnDemand = async (): Promise<
    ActiveWorkspace | { reason: RecordMutationReason; error: string }
  > => {
    const identity = captureActiveIdentity();
    if (!identity) return { reason: 'stale', error: recordFailureMessage('stale') };

    const result = await fetchMyCoupleState();
    if (!isCurrentIdentity(identity)) {
      return { reason: 'stale', error: recordFailureMessage('stale') };
    }

    if (!result.ok) {
      if (result.reason === 'auth_expired') {
        void handleAuthExpired();
        return { reason: 'auth_expired', error: recordFailureMessage('auth_expired') };
      }
      if (result.reason === 'offline') {
        return { reason: 'offline', error: recordFailureMessage('offline') };
      }
      // An undeployed membership RPC is a server-configuration state, not a
      // transient one, and definitely not a connection one.
      if (result.schemaGap) {
        return {
          reason: 'workspace_unconfigured',
          error: recordFailureMessage('workspace_unconfigured'),
        };
      }
      return {
        reason: 'workspace_unresolved',
        error: recordFailureMessage('workspace_unresolved'),
      };
    }

    const remote = result.state;
    if (!remote?.coupleId) {
      // Authoritative negative: there really is no couple space.
      setCoupleLifecycle('personal');
      return { reason: 'no_workspace', error: recordFailureMessage('no_workspace') };
    }

    const coupleId = remote.coupleId;
    updateStateImmediately((current) => {
      if (!isCurrentIdentity(identity)) return current;
      return {
        ...current,
        profile: {
          ...current.profile,
          couple: mergeCoupleState(current.profile.couple, remote),
        },
      };
    });
    setCoupleLifecycle(deriveCoupleLifecycle(remote, stateRef.current.profile.couple));
    setInvitationExpiresAt(remote.invitationActive ? remote.invitationExpiresAt : null);

    const workspace: ActiveWorkspace = { ...identity, coupleId };
    return isCurrentLinkedCouple(workspace)
      ? workspace
      : { reason: 'stale', error: recordFailureMessage('stale') };
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
    /**
     * Internal, and deliberately absent from `StoreContextValue`.
     *
     * `recordId` lets a replay reuse the id the entry was queued under, so a write
     * that reached the server but whose response was lost cannot insert the row a
     * second time. `allowQueue: false` stops a replay from re-queueing itself into
     * an endless cycle -- the outbox decides what happens to a failed entry, and it
     * has the attempt count to do that with.
     */
    options?: { recordId?: string; allowQueue?: boolean },
  ): Promise<{
    ok: boolean;
    failedFiles: string[];
    error?: string;
    queued?: boolean;
    /**
     * The classified cause, for the outbox to decide with. Absent on success and on
     * the stale/no-workspace paths, which a retry cannot change either way, so the
     * caller treats a missing reason as definitive.
     */
    reason?: RecordMutationReason;
  }> => {
    const recordId = options?.recordId ?? crypto.randomUUID();
    const allowQueue = options?.allowQueue !== false;
    const baseRecord: DailyRecord = {
      ...record,
      id: recordId,
      createdAt: new Date().toISOString(),
    };

    // A missing LOCAL couple id is not proof that the account has no couple
    // space: the creator's membership is `active` on the server from the moment
    // they create it, and a failed hydration (or an abandoned onboarding) leaves
    // that membership real but locally invisible. Resolving it on demand is the
    // difference between "you already own a space" and telling the user to create
    // one they cannot create.
    const workspace = captureLinkedCouple() ?? await resolveWorkspaceOnDemand();
    if (!('coupleId' in workspace)) {
      return {
        ok: false,
        failedFiles: files.map((file) => file.name),
        error: workspace.error,
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

    /**
     * Hand a refused write to the outbox instead of losing it.
     *
     * Only reachable before any row is written or any object uploaded, so a queued
     * entry describes an intent with nothing half-done behind it. Returns
     * `queued: true` so the composer can say the record is waiting rather than
     * report a failure -- the difference between "저장 못 했어요" and "연결되면
     * 보낼게요" is the whole point of this queue existing.
     */
    const queueOrFail = async (
      reason: RecordMutationReason,
    ): Promise<{
      ok: boolean;
      failedFiles: string[];
      error?: string;
      queued?: boolean;
      reason?: RecordMutationReason;
    }> => {
      const message = recordFailureMessage(reason);
      const persistence = outboxRef.current;
      // Never claim a record is queued when it is not: no storage, a replay that
      // must not re-queue, or a reason a later attempt cannot change.
      if (!allowQueue || !persistence || !isRetryableReason(reason)) {
        return { ok: false, failedFiles: files.map((file) => file.name), error: message, reason };
      }
      try {
        await enqueueRecord(persistence, {
          id: recordId,
          userId: workspace.userId,
          coupleId: workspace.coupleId,
          record,
          files,
        });
      } catch (error) {
        console.error('[gomsinlog] Failed to queue record for later delivery:', error);
        return { ok: false, failedFiles: files.map((file) => file.name), error: message, reason };
      }
      setOutboxCounts(await countOutbox(persistence, workspace.userId));
      return { ok: false, queued: true, failedFiles: [], reason };
    };

    try {
      const saved = await saveRecordToDB(
        newRecord,
        workspace.coupleId,
        workspace.userId,
      );
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      if (!saved.ok) {
        // The cause travels all the way from PostgREST to the toast, so a `42501`
        // membership rejection can no longer be reported as a network problem.
        if (saved.reason === 'auth_expired') void handleAuthExpired();
        return queueOrFail(saved.reason);
      }
    } catch (error) {
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      console.error('[gomsinlog] Failed to save record:', error);
      const reason = classifyServerError(error).kind;
      if (reason === 'auth_expired') void handleAuthExpired();
      return queueOrFail(reason);
    }

    const attachments: Attachment[] = [...(newRecord.attachments || [])];
    const uploadedPaths: string[] = [];
    const failedFiles: string[] = [];

    /**
     * Abandon the upload loop, reclaiming what it already uploaded.
     *
     * Inside the loop the attachment patch has definitively NOT run yet, so no row
     * references these objects and deleting them cannot break anything. Bailing out
     * without this left them in Storage forever: the client only learns an object's
     * path from local state, and the Storage DELETE policy needs an owned
     * `daily_records` row in the ACTIVE couple, so once the workspace moved on
     * nothing client-side could ever reach them again.
     *
     * Best-effort by necessity -- if the couple genuinely changed, that same policy
     * will refuse this delete too, and only `delete-account` or an operator can
     * reclaim them. It still recovers the common case, where "stale" is a local
     * generation bump rather than a real membership change.
     */
    const abandonUploads = async (): Promise<typeof staleResult> => {
      if (uploadedPaths.length > 0) {
        try {
          await removeRecordMedia(uploadedPaths);
        } catch {
          /* best-effort cleanup */
        }
      }
      return staleResult;
    };

    for (const file of files) {
      if (!isCurrentLinkedCouple(workspace)) return abandonUploads();
      const result = await uploadRecordMedia(file, workspace.coupleId, recordId);
      if (!isCurrentLinkedCouple(workspace)) return abandonUploads();
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
        // Deliberately NOT reclaiming uploads here: the patch has already been
        // issued, so whether the row now references these objects is unknown.
        // Deleting them could strip a successfully patched record's attachments,
        // which is worse than leaving objects an operator can sweep.
        if (!isCurrentLinkedCouple(workspace)) return staleResult;
        if (!patched.ok) {
          try { await removeRecordMedia(uploadedPaths); } catch { /* best-effort cleanup */ }
          if (!isCurrentLinkedCouple(workspace)) return staleResult;
          failedFiles.push(...files.map((file) => file.name));
          finalRecord = { ...newRecord, attachments: newRecord.attachments || [] };
        }
      } catch (error) {
        if (!isCurrentLinkedCouple(workspace)) return staleResult;
        console.error('[gomsinlog] Failed to attach media to record:', error);
        try { await removeRecordMedia(uploadedPaths); } catch { /* best-effort cleanup */ }
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

  /**
   * Queue a record without attempting the write.
   *
   * The composer calls this when `navigator.onLine === false`, which the OS is
   * trusted about. Going through the failure path instead would mean firing a
   * request that cannot succeed and depending on its error classification to reach
   * the queue -- and the pre-flight deletion gate is itself a server call, so on a
   * genuinely dead network the write could fail for a reason that is not
   * `offline` and never be queued at all. Deterministic beats clever here.
   */
  const queueRecordForLater = async (
    record: Omit<DailyRecord, 'id' | 'createdAt'>,
    files: File[],
  ): Promise<{ queued: boolean; error?: string }> => {
    const persistence = outboxRef.current;
    if (!persistence) {
      return { queued: false, error: '이 브라우저에서는 기록을 임시 보관할 수 없어요.' };
    }
    const workspace = captureLinkedCouple();
    // No local couple space means the id this record belongs to is unknown, and
    // resolving it needs the network that is absent. Refusing is honest.
    if (!workspace) {
      return { queued: false, error: recordFailureMessage('workspace_unresolved') };
    }
    try {
      await enqueueRecord(persistence, {
        id: crypto.randomUUID(),
        userId: workspace.userId,
        coupleId: workspace.coupleId,
        record,
        files,
      });
    } catch (error) {
      console.error('[gomsinlog] Failed to queue record for later delivery:', error);
      return { queued: false, error: recordFailureMessage('unknown') };
    }
    setOutboxCounts(await countOutbox(persistence, workspace.userId));
    return { queued: true };
  };

  /**
   * Try to deliver everything queued for the signed-in account, oldest first.
   *
   * Replays through `addRecordWithMedia`, so every identity and membership guard in
   * it applies again -- which is the correct behaviour, not a limitation: if the
   * couple space changed while an entry waited, that write SHOULD be refused rather
   * than forced through. `allowQueue: false` keeps a replay from re-queueing itself;
   * the outbox decides what happens to a failure, using the attempt count.
   *
   * Sequential on purpose. The entries are one person's day and land in the order
   * they were written; parallel delivery would reorder them for no gain on a
   * connection that just came back.
   */
  const flushOutbox = async (): Promise<{ delivered: number; requeued: number; blocked: number }> => {
    const persistence = outboxRef.current;
    const identity = captureActiveIdentity();
    const result = { delivered: 0, requeued: 0, blocked: 0 };
    if (!persistence || !identity || flushInFlightRef.current) return result;
    flushInFlightRef.current = true;
    try {
      const entries = await deliverableForAccount(persistence, identity.userId);
      for (const entry of entries) {
        // The account changed mid-flush: stop rather than write one person's queue
        // into another's session.
        if (!isCurrentIdentity(identity)) break;
        const attempt = await addRecordWithMedia(entry.record, entry.files, {
          recordId: entry.id,
          allowQueue: false,
        });
        const disposition = await applyDeliveryOutcome(
          persistence,
          entry,
          attempt.ok
            ? { ok: true }
            : { ok: false, reason: attempt.reason ?? 'unknown', message: attempt.error ?? '' },
        );
        if (disposition === 'delivered') result.delivered += 1;
        else if (disposition === 'requeued') result.requeued += 1;
        else result.blocked += 1;
      }
      setOutboxCounts(await countOutbox(persistence, identity.userId));
    } catch (error) {
      console.error('[gomsinlog] Outbox flush failed:', error);
    } finally {
      flushInFlightRef.current = false;
    }
    return result;
  };

  /** Clear the block on every stopped entry, so the next flush tries them again. */
  const retryBlockedRecords = async (): Promise<number> => {
    const persistence = outboxRef.current;
    const identity = captureActiveIdentity();
    if (!persistence || !identity) return 0;
    const pending = await pendingForAccount(persistence, identity.userId);
    const blocked = pending.filter((entry) => entry.blocked);
    for (const entry of blocked) await unblockEntry(persistence, entry);
    setOutboxCounts(await countOutbox(persistence, identity.userId));
    await flushOutbox();
    return blocked.length;
  };

  /** Throw away everything queued for this account, at the user's explicit request. */
  const discardQueuedRecords = async (): Promise<number> => {
    const persistence = outboxRef.current;
    const identity = captureActiveIdentity();
    if (!persistence || !identity) return 0;
    const pending = await pendingForAccount(persistence, identity.userId);
    for (const entry of pending) await discardOutboxEntry(persistence, entry.id);
    setOutboxCounts({ waiting: 0, blocked: 0 });
    return pending.length;
  };

  flushOutboxRef.current = flushOutbox;

  /**
   * Read the queue's size for whoever is signed in now.
   *
   * Runs on identity change, not once on mount: the counts are per account, and a
   * sign-in must not inherit the previous account's numbers even for a render.
   */
  useEffect(() => {
    const persistence = outboxRef.current;
    const userId = state.authenticatedUser?.id;
    if (!persistence || !userId) {
      setOutboxCounts({ waiting: 0, blocked: 0 });
      return;
    }
    let cancelled = false;
    void countOutbox(persistence, userId).then((counts) => {
      if (!cancelled) setOutboxCounts(counts);
    }).catch(() => { /* an unreadable queue is reported as empty, never as an error toast */ });
    return () => { cancelled = true; };
  }, [state.authenticatedUser?.id]);

  const updateRecord = async (
    id: string,
    updates: Partial<DailyRecord>,
  ): Promise<RecordMutationResult> => {
    const initial = stateRef.current;
    const existing = initial.records.find((record) => record.id === id);
    if (!existing) return recordFailure('missing');
    // Identity-bearing fields are immutable even if an older caller still
    // passes the broad Partial<DailyRecord> API.
    const updated: DailyRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
    };

    const workspace = captureLinkedCouple();
    if (!workspace) return recordFailure('workspace_unresolved');
    if (existing.userId !== workspace.userId) return recordFailure('not_owner');
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) {
      return recordFailure('deletion_pending');
    }
    try {
      const saved = await saveRecordToDB(updated, workspace.coupleId, workspace.userId);
      if (!isCurrentLinkedCouple(workspace)) return recordFailure('stale');
      if (!saved.ok) {
        if (saved.reason === 'auth_expired') void handleAuthExpired();
        return recordFailure(saved.reason);
      }
    } catch (error) {
      if (!isCurrentLinkedCouple(workspace)) return recordFailure('stale');
      console.error('[gomsinlog] Failed to update record:', error);
      const reason = classifyServerError(error).kind;
      if (reason === 'auth_expired') void handleAuthExpired();
      return recordFailure(reason);
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
      if (!isCurrentLinkedCouple(workspace)) return recordFailure('stale');
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
    return isCurrentLinkedCouple(workspace) ? { ok: true } : recordFailure('stale');
  };

  const deleteRecord = async (id: string): Promise<RecordMutationResult> => {
    const initial = stateRef.current;
    const existing = initial.records.find((record) => record.id === id);
    if (!existing) return recordFailure('missing');

    const workspace = captureLinkedCouple();
    if (!workspace) return recordFailure('workspace_unresolved');
    if (existing.userId !== workspace.userId) return recordFailure('not_owner');
    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) {
      return recordFailure('deletion_pending');
    }

    // Storage cleanup: remove owned media objects BEFORE deleting the DB row.
    // Fail closed: if cleanup fails, abort the delete rather than orphaning
    // storage objects that can no longer be traced back to a record.
    const attachmentPaths = (existing.attachments || [])
      .map((a) => a.path)
      .filter((p): p is string =>
        isCanonicalRecordMediaPath(p, workspace.coupleId, id),
      );

    if (attachmentPaths.length > 0) {
      try {
        await removeRecordMedia(attachmentPaths);
        if (!isCurrentLinkedCouple(workspace)) return recordFailure('stale');
      } catch (error) {
        if (!isCurrentLinkedCouple(workspace)) return recordFailure('stale');
        console.error('[gomsinlog] Storage cleanup failed, aborting delete:', error);
        return recordFailure(classifyServerError(error).kind);
      }
    }

    try {
      const deleted = await deleteRecordFromDB(
        id,
        workspace.userId,
        workspace.coupleId,
      );
      if (!isCurrentLinkedCouple(workspace)) return recordFailure('stale');
      if (!deleted.ok) {
        if (deleted.reason === 'auth_expired') void handleAuthExpired();
        return recordFailure(deleted.reason);
      }
    } catch (error) {
      if (!isCurrentLinkedCouple(workspace)) return recordFailure('stale');
      console.error('Failed to delete record:', error);
      const reason = classifyServerError(error).kind;
      if (reason === 'auth_expired') void handleAuthExpired();
      return recordFailure(reason);
    }

    updateStateImmediately((current) =>
      isCurrentLinkedCouple(workspace) && stateMatchesLinkedCouple(current, workspace)
        ? { ...current, records: current.records.filter((record) => record.id !== id) }
        : current,
    );
    return isCurrentLinkedCouple(workspace) ? { ok: true } : recordFailure('stale');
  };

  /**
   * Add and/or remove media on an existing record.
   *
   * Ordering is forced by storage RLS and by the no-orphans rule, and is the same
   * shape `addRecordWithMedia` uses:
   *
   *   gate -> verify ownership -> upload new objects -> patch the row -> ONLY THEN
   *   delete the removed objects.
   *
   * If the patch fails, the freshly uploaded objects are deleted again and the row
   * is left exactly as it was: no orphaned storage, no phantom success. Deleting
   * the removed objects last is deliberate -- doing it first would destroy files
   * that are still referenced by the row if the patch then failed.
   */
  const updateRecordMedia = async (
    id: string,
    changes: { addFiles?: File[]; removePaths?: string[] },
  ): Promise<{ ok: boolean; failedFiles: string[]; error?: string }> => {
    const addFiles = changes.addFiles || [];
    const removePaths = changes.removePaths || [];
    const allFileNames = addFiles.map((file) => file.name);
    const initial = stateRef.current;
    const existing = initial.records.find((record) => record.id === id);
    if (!existing) {
      return { ok: false, failedFiles: allFileNames, error: recordFailureMessage('missing') };
    }
    if (addFiles.length === 0 && removePaths.length === 0) return { ok: true, failedFiles: [] };

    const workspace = captureLinkedCouple() ?? await resolveWorkspaceOnDemand();
    if (!('coupleId' in workspace)) {
      return { ok: false, failedFiles: allFileNames, error: workspace.error };
    }
    if (existing.userId !== workspace.userId) {
      return { ok: false, failedFiles: allFileNames, error: recordFailureMessage('not_owner') };
    }

    // Never accept a path from outside this record's own namespace, even though
    // it can only have come from local state: it is the same validation storage
    // RLS applies, and applying it here keeps a corrupted cache from asking us to
    // delete another record's (or another couple's) files.
    const invalidPath = removePaths.find(
      (path) => !isCanonicalRecordMediaPath(path, workspace.coupleId, id),
    );
    if (invalidPath) {
      console.error('[gomsinlog] Refusing to remove a non-canonical media path:', invalidPath);
      return {
        ok: false,
        failedFiles: allFileNames,
        error: '첨부 파일 경로가 올바르지 않아 삭제하지 않았어요.',
      };
    }

    const staleResult = {
      ok: false,
      failedFiles: allFileNames,
      error: recordFailureMessage('stale'),
    };

    if (blocksServerCall(await ensureNotPendingBeforeServerCall())) {
      return { ok: false, failedFiles: allFileNames, error: recordFailureMessage('deletion_pending') };
    }
    if (!isCurrentLinkedCouple(workspace)) return staleResult;

    const kept = (existing.attachments || []).filter(
      (attachment) => !attachment.path || !removePaths.includes(attachment.path),
    );
    const uploadedPaths: string[] = [];
    const failedFiles: string[] = [];
    const added: Attachment[] = [];

    for (const file of addFiles) {
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      const result = await uploadRecordMedia(file, workspace.coupleId, id);
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      if ('error' in result) {
        failedFiles.push(file.name);
        console.error(`[gomsinlog] Attachment failed (${file.name}): ${result.error}`);
        continue;
      }
      added.push(result.attachment);
      if (result.attachment.path) uploadedPaths.push(result.attachment.path);
    }

    const patchedRecord: DailyRecord = { ...existing, attachments: [...kept, ...added] };
    const rollbackUploads = async () => {
      if (uploadedPaths.length === 0) return;
      try {
        await removeRecordMedia(uploadedPaths);
      } catch (error) {
        console.error('[gomsinlog] Failed to roll back uploaded media:', error);
      }
    };

    try {
      const patched = await saveRecordToDB(patchedRecord, workspace.coupleId, workspace.userId);
      if (!patched.ok) {
        await rollbackUploads();
        if (!isCurrentLinkedCouple(workspace)) return staleResult;
        if (patched.reason === 'auth_expired') void handleAuthExpired();
        return {
          ok: false,
          failedFiles: allFileNames,
          error: recordFailureMessage(patched.reason),
        };
      }
    } catch (error) {
      console.error('[gomsinlog] Failed to patch record media:', error);
      await rollbackUploads();
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
      const reason = classifyServerError(error).kind;
      if (reason === 'auth_expired') void handleAuthExpired();
      return { ok: false, failedFiles: allFileNames, error: recordFailureMessage(reason) };
    }

    // The row no longer references these objects, so removing them now cannot
    // orphan a live attachment. A failure here leaves unreferenced bytes behind,
    // which is logged but must NOT fail the operation the user asked for.
    if (removePaths.length > 0) {
      try {
        await removeRecordMedia(removePaths);
      } catch (error) {
        console.error('[gomsinlog] Failed to clean up removed media objects:', error);
      }
    }
    if (!isCurrentLinkedCouple(workspace)) return staleResult;

    let committed = patchedRecord;
    if (committed.attachments?.length) {
      committed = {
        ...committed,
        attachments: await resolveAttachmentUrls(committed.attachments, workspace.coupleId, id),
      };
      if (!isCurrentLinkedCouple(workspace)) return staleResult;
    }

    updateStateImmediately((current) =>
      isCurrentLinkedCouple(workspace) && stateMatchesLinkedCouple(current, workspace)
        ? {
            ...current,
            records: current.records.map((record) => record.id === id ? committed : record),
          }
        : current,
    );
    return isCurrentLinkedCouple(workspace)
      ? { ok: true, failedFiles: Array.from(new Set(failedFiles)) }
      : staleResult;
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
      const saved = await saveEventToDB(newEvent);
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
      const saved = await updateEventInDB(updated);
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
      // The author is already verified above; passing it makes the predicate part
      // of the request rather than an assumption about RLS.
      const deleted = await deleteEventFromDB(id, identity.userId);
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
    // Unsent composer text is held in memory, so it is not covered by removing the
    // storage keys above. It must not outlive the session that produced it.
    clearAllComposerDrafts();
    /*
     * Avatar photos live under their own `gomsinlog.avatar.*` keys, deliberately
     * outside `STORE_KEY`, so the two `removeItem` calls above do not reach them.
     *
     * They are outside the store because `saveState` persists a strict
     * device-preference whitelist for an authenticated user and a test asserts that
     * list exactly -- image data in there would defeat the guarantee the whitelist
     * exists for. The cost of that separation is this line: without it, a photo of
     * a person's face would survive both sign-out and account deletion.
     */
    clearAllAvatars();
    // The outbox is NOT cleared here. This runs on sign-out as well as on account
    // deletion, and the same person signing back in must still find the record they
    // wrote on a train with no signal. Every read is filtered by `userId`, so
    // another account on this device can neither see nor replay it. Account
    // DELETION purges it explicitly -- see `deleteAccount`.
    setOutboxCounts({ waiting: 0, blocked: 0 });
    const current = stateRef.current;
    const nextState: AppState = {
      ...DEFAULT_STATE,
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
      revokeCycleSensitiveConsent(identity.userId);
      if (!purgeLocalContentRetainingIdentity(identity)) return outcome;
      setAccountDeletionRecovery({ warnings: outcome.warnings });
      applyDeletionStatus({ kind: 'pending' });
      cancelDeferredSyncRef.current?.();
      return outcome;
    }

    // `deleted`: the Auth user is gone, which is the ONLY confirmation that
    // permits clearing the marker.
    if (!purgeLocalAccountData(identity)) return outcome;
    revokeCycleSensitiveConsent(identity.userId);
    // The queue is deliberately kept across sign-out, so deletion is the one place
    // it must be removed: this account will never sign in again, and leaving its
    // unsent records on the device would outlive the account they belong to.
    if (outboxRef.current) {
      try {
        await purgeOutboxAccount(outboxRef.current, identity.userId);
      } catch (error) {
        console.error('[gomsinlog] Failed to purge the outbox after deletion:', error);
      }
    }
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

  /**
   * "이따 이야기하기" writes.
   *
   * Each one re-reads the couple's marks from the server afterwards rather
   * than patching local state optimistically. The list is tiny metadata, the
   * partner may have changed it concurrently, and the server is the only
   * place that knows the authoritative `created_at` -- so a refetch is both
   * cheaper to reason about and the only way the two clients converge.
   */
  const refreshTalkAboutMarks = async (): Promise<void> => {
    const coupleId = stateRef.current.profile.couple.coupleId;
    if (!coupleId) return;
    const marks = await fetchTalkAboutMarksFromDB(coupleId);
    updateStateImmediately((prev) => ({ ...prev, talkAboutMarks: marks }));
  };

  const markTalkAbout = async (recordId: string): Promise<{ ok: boolean; error?: string }> => {
    const current = stateRef.current;
    const coupleId = current.profile.couple.coupleId;
    const userId = current.authenticatedUser?.id || current.profile.id;
    if (!coupleId || !userId) {
      return { ok: false, error: '커플 연결이 확인되지 않아 표시할 수 없어요.' };
    }
    const result = await markTalkAboutInDB(recordId, coupleId, userId);
    if (result.ok) await refreshTalkAboutMarks();
    return result;
  };

  /** Withdraw only your own flag; the partner's stays. */
  const unmarkTalkAbout = async (recordId: string): Promise<{ ok: boolean; error?: string }> => {
    const current = stateRef.current;
    const userId = current.authenticatedUser?.id || current.profile.id;
    if (!userId) return { ok: false, error: '해제할 수 없어요.' };
    const result = await unmarkTalkAboutInDB(recordId, userId);
    if (result.ok) await refreshTalkAboutMarks();
    return result;
  };

  /** 이야기했어요 — the conversation happened, so clear it for both. */
  const resolveTalkAbout = async (recordId: string): Promise<{ ok: boolean; error?: string }> => {
    const result = await resolveTalkAboutInDB(recordId);
    if (result.ok) await refreshTalkAboutMarks();
    return result;
  };

  const setAuthenticatedUser = (user: AuthUser | null) => {
    updateStateImmediately((prev) => ({ ...prev, authenticatedUser: user }));
  };

  const setWidgetLayout = (layout: string[], role: Role = 'gomsin') => {
    updateStateImmediately((prev) => (role === 'soldier'
      ? { ...prev, soldierWidgetLayout: layout }
      : { ...prev, widgetLayout: layout }));
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
        authSyncReason,
        authSyncStage,
        authSyncCode,
        sharedSyncStatus,
        coupleLifecycle,
        invitationExpiresAt,
        refreshCoupleLifecycle,
        // The same single-flight recovery every store mutation already routes
        // `auth_expired` to, so a page-issued RPC cannot grow a second one.
        recoverExpiredSession: handleAuthExpired,
        accountDeletionRecovery,
        deletionStatus,
        retryAccountDeletion,
        retrySharedAccess,
        updateProfile,
        addRecord,
        addRecordWithMedia,
        queueRecordForLater,
        flushOutbox,
        retryBlockedRecords,
        discardQueuedRecords,
        outboxWaiting: outboxCounts.waiting,
        outboxBlocked: outboxCounts.blocked,
        updateRecord,
        deleteRecord,
        updateRecordMedia,
        addEvent,
        updateEvent,
        deleteEvent,
        reloadEvents,
        disconnect,
        deleteAccount,
        signOut,
        setSetupComplete,
        setOnboardingStep,
        setHighlightedRecordId,
        markTalkAbout,
        unmarkTalkAbout,
        resolveTalkAbout,
        setAuthenticatedUser,
        setWidgetLayout,
        setHasSeenInstallPrompt,
        setTheme,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
