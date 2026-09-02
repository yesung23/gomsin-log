import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HeartPulse, Loader2, Lock, Settings2 } from 'lucide-react';
import { App } from '@capacitor/app';
import { toast } from 'sonner';
import {
  activePeriodOnDate,
  dailyLogOnDate,
  deleteCycleDailyLogFromDB,
  deleteCyclePeriodFromDB,
  fetchCycleDailyLogsResultFromDB,
  fetchCyclePeriodsResultFromDB,
  fetchCycleSettingsResultFromDB,
  fetchCycleSharingPreferencesFromDB,
  localToday,
  saveCycleDailyLogToDB,
  saveCyclePeriodToDB,
  saveCycleSettingsToDB,
  saveCycleSharingPreferencesToDB,
  shiftCalendarMonth,
  updateCyclePeriodInDB,
  validateCycleSettings,
  type CycleFetchFailureReason,
} from '@/lib/cycle';
import { predictCycle, predictionOccursOnDate } from '@/lib/cyclePrediction';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { classifyServerError, serverErrorMessage } from '@/lib/serverErrors';
import {
  clearPendingCycleConsentRevocation,
  grantCycleConsentInDB,
  grantCycleSensitiveConsent,
  hasCycleSensitiveConsent,
  hasPendingCycleConsentRevocation,
  markCycleConsentRevocationPending,
  revokeCycleConsentInDB,
  revokeCycleSensitiveConsent,
  syncCycleConsentWithDB,
} from '@/lib/sensitiveConsent';
import { Button } from '@/components/ui/Button';
import type {
  CycleDailyLog,
  CyclePeriod,
  CycleSharingPreferences,
  CycleSymptom,
} from '@/types';
import { CycleCalendar } from '@/components/cycle/CycleCalendar';
import { CycleDailyLogEditor } from '@/components/cycle/CycleDailyLogEditor';
import type { CycleDailyLogDraft, CyclePeriodDraft } from '@/components/cycle/cycleDrafts';
import { CycleDaySheet } from '@/components/cycle/CycleDaySheet';
import { CyclePeriodEditor } from '@/components/cycle/CyclePeriodEditor';
import { CycleQuickLog } from '@/components/cycle/CycleQuickLog';
import { CycleSettingsSheet } from '@/components/cycle/CycleSettingsSheet';
import { CycleStatusHero } from '@/components/cycle/CycleStatusHero';
import { CycleSummary } from '@/components/cycle/CycleSummary';
import { formatKoreanDate } from '@/components/cycle/cycleFormatting';
import { Card } from '@/components/ui/Card';
import { isNativePlatform } from '@/lib/platform';

type LoadState = 'loading' | 'ready' | CycleFetchFailureReason;
type ShareKey = 'shareCurrentPeriod' | 'sharePredictionWindow' | 'shareFertilityWindow';
type ConsentAuthorityPhase =
  | 'checking'
  | 'granted'
  | 'locked'
  | 'granting'
  | 'revoking'
  | 'locked_error';

interface ConsentAuthorityToken {
  userId: string;
  accountGeneration: number;
  operation: number;
  revision: number;
}

interface ConsentAuthorityState extends ConsentAuthorityToken {
  phase: ConsentAuthorityPhase;
}

/** Which sheet, if any, is on screen. Only one at a time by construction. */
type OpenSheet =
  | { kind: 'none' }
  | { kind: 'day'; date: string }
  | { kind: 'dailyLog'; date: string }
  | { kind: 'period'; period: CyclePeriod }
  | { kind: 'settings' };

const EMPTY_PREFERENCES: CycleSharingPreferences = {
  userId: '',
  shareCurrentPeriod: false,
  sharePredictionWindow: false,
  shareFertilityWindow: false,
};

function failureMessage(
  state: Extract<LoadState, 'unauthenticated' | 'forbidden' | 'not_deployed' | 'error'>,
) {
  if (state === 'unauthenticated') return '개인 기록을 보려면 로그인해 주세요.';
  if (state === 'forbidden') return '이 개인 기록에 접근할 권한이 없어요.';
  /*
   * A missing table is a deployment state, not a user problem. Saying "잠시 후"
   * would be a lie -- waiting changes nothing until the migration is applied --
   * so the copy says the feature is not ready yet and stops there.
   */
  if (state === 'not_deployed') return '주기 기능 준비가 아직 끝나지 않았어요. 기록은 사라지지 않았어요.';
  return '개인 기록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
}

/**
 * 내 몸의 리듬 — V3.
 *
 * Two tables, kept apart on purpose:
 *   `cycle_periods`    — when a period started and ended. Nothing else.
 *   `cycle_daily_logs` — one row per date: symptoms, flow, pain, mood, note.
 *
 * The legacy `cycle_entries` table conflated the two, so logging a headache on a
 * non-period day created a row whose `start_date` was that day, and the
 * prediction then read it as a new cycle start. Nothing in this component may
 * read or write `cycle_entries`; `src/components/cycleV3DataPath.test.tsx`
 * enforces that with a source guard so the regression cannot come back quietly.
 *
 * Screen order is Hero -> Calendar -> Quick log -> Summary. Settings, sharing and
 * consent live behind a single header action.
 */
export function CycleTrackerSection({ userId }: { userId?: string }) {
  const today = localToday();
  const [initialYear, initialMonthNumber] = today.split('-').map(Number);

  /*
   * Identity generation guard.
   *
   * An account switch must invalidate every in-flight request: without this, a
   * slow load for user A could resolve after user B signed in and paint A's
   * health data onto B's screen.
   */
  const identityRef = useRef(userId);
  const generationRef = useRef(0);
  const authorityOperationRef = useRef(0);
  const authorityRef = useRef<ConsentAuthorityState>({
    userId: userId || '',
    accountGeneration: 0,
    operation: 0,
    revision: 0,
    phase: userId ? 'checking' : 'locked',
  });
  if (identityRef.current !== userId) {
    identityRef.current = userId;
    generationRef.current += 1;
    authorityOperationRef.current += 1;
    authorityRef.current = {
      userId: userId || '',
      accountGeneration: generationRef.current,
      operation: authorityOperationRef.current,
      revision: 0,
      phase: userId ? 'checking' : 'locked',
    };
  }
  const [loadState, setLoadState] = useState<LoadState>(userId ? 'loading' : 'unauthenticated');
  /**
   * Server consent is a small authority state machine, not a boolean.
   *
   * `accountGeneration` invalidates the previous signed-in account. `operation`
   * orders checks, grants and revokes inside one account. A response may update
   * UI or cache only when both still match, so an older foreground check cannot
   * reopen a revoke and an old account cannot paint health data onto a new one.
   */
  const [consentAuthority, setConsentAuthority] = useState<ConsentAuthorityState>(
    authorityRef.current,
  );
  const authorityForCurrentUser = !!userId
    && consentAuthority.userId === userId
    && consentAuthority.accountGeneration === generationRef.current;
  const consentPhase: ConsentAuthorityPhase = authorityForCurrentUser
    ? consentAuthority.phase
    : userId ? 'checking' : 'locked';
  const consentGranted = consentPhase === 'granted';
  const consentChecking = consentPhase === 'checking';
  const consentPending = consentPhase === 'granting' || consentPhase === 'revoking';
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const beginAuthorityOperation = useCallback((phase: ConsentAuthorityPhase) => {
    const currentUserId = identityRef.current;
    if (!currentUserId) return null;
    authorityOperationRef.current += 1;
    const next: ConsentAuthorityState = {
      userId: currentUserId,
      accountGeneration: generationRef.current,
      operation: authorityOperationRef.current,
      revision: authorityRef.current.userId === currentUserId
        && authorityRef.current.accountGeneration === generationRef.current
        ? authorityRef.current.revision
        : 0,
      phase,
    };
    authorityRef.current = next;
    setConsentAuthority(next);
    return next;
  }, []);

  const isCurrentAuthority = useCallback((token: ConsentAuthorityToken) => {
    const current = authorityRef.current;
    return token.userId === identityRef.current
      && token.userId === current.userId
      && token.accountGeneration === generationRef.current
      && token.accountGeneration === current.accountGeneration
      && token.operation === current.operation;
  }, []);

  const commitAuthority = useCallback((
    token: ConsentAuthorityToken,
    phase: ConsentAuthorityPhase,
    revision = token.revision,
  ) => {
    if (!isCurrentAuthority(token)) return false;
    const next: ConsentAuthorityState = { ...token, revision, phase };
    authorityRef.current = next;
    setConsentAuthority(next);
    return true;
  }, [isCurrentAuthority]);

  const captureGrantedAuthority = useCallback((): ConsentAuthorityToken | null => {
    const current = authorityRef.current;
    if (current.phase !== 'granted'
      || !current.userId
      || current.userId !== identityRef.current
      || current.accountGeneration !== generationRef.current) return null;
    return {
      userId: current.userId,
      accountGeneration: current.accountGeneration,
      operation: current.operation,
      revision: current.revision,
    };
  }, []);

  const isCurrentGrantedAuthority = useCallback(
    (token: ConsentAuthorityToken) =>
      isCurrentAuthority(token) && authorityRef.current.phase === 'granted',
    [isCurrentAuthority],
  );

  // V3 server state. Periods and daily logs are separate arrays, never merged.
  const [periods, setPeriods] = useState<CyclePeriod[]>([]);
  const [dailyLogs, setDailyLogs] = useState<CycleDailyLog[]>([]);
  const [cycleLength, setCycleLength] = useState(28);
  const [periodLength, setPeriodLength] = useState(5);
  const [preferences, setPreferences] = useState<CycleSharingPreferences>(EMPTY_PREFERENCES);

  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonthNumber - 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [sheet, setSheet] = useState<OpenSheet>({ kind: 'none' });

  // Separate pending flags: tapping a symptom chip must not disable the period
  // button, and vice versa.
  const [periodPending, setPeriodPending] = useState(false);
  const [periodDeletePending, setPeriodDeletePending] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [quickSymptomPending, setQuickSymptomPending] = useState<CycleSymptom | null>(null);
  const [dailyLogPending, setDailyLogPending] = useState(false);
  const [dailyLogDeletePending, setDailyLogDeletePending] = useState(false);
  const [dailyLogError, setDailyLogError] = useState<string | null>(null);
  const [settingsPending, setSettingsPending] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [sharingPendingKey, setSharingPendingKey] = useState<ShareKey | null>(null);
  const [sharingError, setSharingError] = useState<string | null>(null);

  /**
   * Remove every health-derived value before consent is rechecked.
   *
   * A foreground/reconnect check can discover a revoke made on another device.
   * Keeping the old values painted while that authority check runs would expose
   * data after its permission became uncertain, so uncertainty immediately
   * returns this component to an empty, locked state.
   */
  const clearSensitiveState = useCallback(() => {
    setLoadState('loading');
    setPeriods([]);
    setDailyLogs([]);
    setCycleLength(28);
    setPeriodLength(5);
    setPreferences(EMPTY_PREFERENCES);
    setSheet({ kind: 'none' });
    setPeriodPending(false);
    setPeriodDeletePending(false);
    setPeriodError(null);
    setQuickSymptomPending(null);
    setDailyLogPending(false);
    setDailyLogDeletePending(false);
    setDailyLogError(null);
    setSettingsPending(false);
    setSettingsError(null);
    setSharingPendingKey(null);
    setSharingError(null);
  }, []);

  /*
   * Daily-log writes are serialised through this promise chain.
   *
   * Fast repeated chip taps otherwise interleave read-modify-write cycles and the
   * later upsert overwrites the earlier one with a stale symptom array. Chaining
   * makes each write see the previous result.
   */
  const dailyLogQueueRef = useRef<Promise<void>>(Promise.resolve());

  /*
   * Load coordinator.
   *
   * The load effect re-runs whenever consent resolves, and the recovery
   * listeners below fire on every tab focus and reconnect. Without coalescing,
   * those overlap into several concurrent reads of three tables each, and the
   * last one to resolve wins regardless of which was issued first. One in-flight
   * load per identity, with at most one queued re-run, keeps the result
   * deterministic and the traffic proportional.
   */
  const loadCoordinatorRef = useRef<{
    key: string;
    queued: boolean;
    promise: Promise<void>;
  } | null>(null);

  const consentCoordinatorRef = useRef<{
    key: string;
    queued: boolean;
    promise: Promise<boolean>;
  } | null>(null);

  useLayoutEffect(() => {
    setLoadState(userId ? 'loading' : 'unauthenticated');
    setConsentAuthority({
      userId: userId || '',
      accountGeneration: generationRef.current,
      operation: authorityOperationRef.current,
      revision: 0,
      phase: userId ? 'checking' : 'locked',
    });
    setConsentChecked(false);
    setConsentError(null);
    setPeriods([]);
    setDailyLogs([]);
    setCycleLength(28);
    setPeriodLength(5);
    setPreferences(EMPTY_PREFERENCES);
    setSelectedDate(today);
    setSheet({ kind: 'none' });
    setPeriodPending(false);
    setPeriodDeletePending(false);
    setPeriodError(null);
    setQuickSymptomPending(null);
    setDailyLogPending(false);
    setDailyLogDeletePending(false);
    setDailyLogError(null);
    setSettingsPending(false);
    setSettingsError(null);
    setSharingPendingKey(null);
    setSharingError(null);
  }, [today, userId]);

  /*
   * Consent is verified against the SERVER before any cycle data is fetched.
   *
   * A check starts a new authority operation, invalidating older loads and
   * writes without changing the account generation. Cache is updated only after
   * this exact operation receives a server verdict.
   */
  const performConsentCheck = useCallback(async (): Promise<boolean> => {
    // A native/browser lifecycle callback can fire once after its effect was
    // removed. Refuse it before reading per-user pending state or opening a new
    // authority operation, otherwise A's stale callback could lock B's screen.
    if (!userId || identityRef.current !== userId) {
      return false;
    }

    // A failed revoke survives process restarts. Do not let the server's older
    // positive row reopen this device before the user retries the stop request.
    if (hasPendingCycleConsentRevocation(userId)) {
      const pending = beginAuthorityOperation('locked_error');
      if (!pending) return false;
      revokeCycleSensitiveConsent(pending.userId);
      clearSensitiveState();
      setConsentError('이전에 요청한 동의 철회를 완료하려면 다시 시도해 주세요.');
      return false;
    }

    // Server consent proves the account-level legal state; this local proof
    // proves that this particular device did not previously ask to stop. Both
    // are required. This also keeps a failed revoke closed after restart when a
    // quota error prevented the separate pending marker from being written.
    const hadDeviceConsent = hasCycleSensitiveConsent(userId);
    const authority = beginAuthorityOperation('checking');
    if (!authority) return false;
    setConsentError(null);
    clearSensitiveState();

    try {
      const result = await syncCycleConsentWithDB(authority.userId);
      if (!isCurrentAuthority(authority)) return false;

      if (!result.ok) {
        revokeCycleSensitiveConsent(authority.userId);
        commitAuthority(authority, 'locked');
        setConsentError(serverErrorMessage(result.reason));
        return false;
      }

      if (result.granted && hadDeviceConsent) {
        commitAuthority(authority, 'granted', result.revision);
      } else {
        revokeCycleSensitiveConsent(authority.userId);
        commitAuthority(authority, 'locked', result.revision);
        if (result.granted) {
          setConsentError('이 기기에서는 민감정보 동의를 다시 확인해야 해요.');
        }
      }
      return result.granted && hadDeviceConsent;
    } catch (error) {
      if (!isCurrentAuthority(authority)) return false;
      revokeCycleSensitiveConsent(authority.userId);
      commitAuthority(authority, 'locked');
      setConsentError(classifyServerError(error).message);
      return false;
    }
  }, [
    beginAuthorityOperation,
    clearSensitiveState,
    commitAuthority,
    isCurrentAuthority,
    userId,
  ]);

  const verifyConsent = useCallback((): Promise<boolean> => {
    const key = userId || '';
    if (!key) return Promise.resolve(false);

    // Explicit grant/revoke owns authority until it settles. Foreground and
    // reconnect signals may not supersede it, and a failed revoke is retried
    // only through the explicit recovery button.
    if (authorityRef.current.userId === key
      && ['granting', 'revoking', 'locked_error'].includes(authorityRef.current.phase)) {
      return Promise.resolve(false);
    }

    const active = consentCoordinatorRef.current;
    if (active?.key === key) {
      active.queued = true;
      return active.promise;
    }

    const coordinator = { key, queued: false, promise: Promise.resolve(false) };
    const run = async () => {
      let granted = false;
      do {
        coordinator.queued = false;
        granted = await performConsentCheck();
      } while (coordinator.queued
        && identityRef.current === userId
        && !['granting', 'revoking', 'locked_error'].includes(authorityRef.current.phase));
      return granted;
    };
    coordinator.promise = run().finally(() => {
      if (consentCoordinatorRef.current === coordinator) {
        consentCoordinatorRef.current = null;
      }
    });
    consentCoordinatorRef.current = coordinator;
    return coordinator.promise;
  }, [performConsentCheck, userId]);

  useEffect(() => {
    void verifyConsent();
  }, [verifyConsent]);

  const performLoad = useCallback(async () => {
    const authority = captureGrantedAuthority();
    if (!userId || !consentGranted || !authority) return;
    setLoadState('loading');
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const [periodResult, logResult, settingResult] = await Promise.all([
        fetchCyclePeriodsResultFromDB(authority.userId),
        fetchCycleDailyLogsResultFromDB(authority.userId),
        fetchCycleSettingsResultFromDB(authority.userId),
      ]);
      if (!isCurrentGrantedAuthority(authority)) return;

      if (!periodResult.ok || !logResult.ok || !settingResult.ok) {
        const reasons = [
          !periodResult.ok ? periodResult.reason : null,
          !logResult.ok ? logResult.reason : null,
          !settingResult.ok ? settingResult.reason : null,
        ];
        // Authority first: an RLS refusal must never be reported as a network
        // problem, because retrying will never fix it.
        // `not_deployed` outranks the generic `error` for the same reason: it is
        // the specific, actionable cause when the migration is not applied yet.
        setLoadState(reasons.includes('unauthenticated')
          ? 'unauthenticated'
          : reasons.includes('forbidden')
            ? 'forbidden'
            : reasons.includes('not_deployed') ? 'not_deployed' : 'error');
        return;
      }

      setPeriods(periodResult.periods);
      setDailyLogs(logResult.logs);
      setCycleLength(settingResult.settings?.averageCycleLength ?? 28);
      setPeriodLength(settingResult.settings?.averagePeriodLength ?? 5);
      setLoadState('ready');

      const nextPreferences = await fetchCycleSharingPreferencesFromDB(authority.userId);
      if (!isCurrentGrantedAuthority(authority)) return;
      setPreferences(nextPreferences);
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to load private cycle data.');
      setLoadState('error');
    }
  }, [captureGrantedAuthority, consentGranted, isCurrentGrantedAuthority, userId]);

  const load = useCallback((): Promise<void> => {
    const key = `${userId || ''}:${consentAuthority.operation}:${consentGranted ? '1' : '0'}`;
    const active = loadCoordinatorRef.current;
    if (active?.key === key) {
      // A load for this exact identity is already running; ask it to repeat once
      // rather than starting a second concurrent read.
      active.queued = true;
      return active.promise;
    }

    const coordinator = { key, queued: false, promise: Promise.resolve() };
    const run = async () => {
      do {
        coordinator.queued = false;
        await performLoad();
      } while (coordinator.queued && identityRef.current === userId);
    };
    coordinator.promise = run().finally(() => {
      if (loadCoordinatorRef.current === coordinator) loadCoordinatorRef.current = null;
    });
    loadCoordinatorRef.current = coordinator;
    return coordinator.promise;
  }, [consentAuthority.operation, consentGranted, performLoad, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const recoverVisible = () => {
      if (document.visibilityState === 'visible') void verifyConsent();
    };
    const recoverOnline = () => void verifyConsent();
    let disposed = false;
    let removeNativeListener: (() => Promise<void>) | null = null;

    document.addEventListener('visibilitychange', recoverVisible);
    window.addEventListener('online', recoverOnline);
    if (isNativePlatform()) {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void verifyConsent();
      }).then((handle) => {
        if (disposed) void handle.remove();
        else removeNativeListener = () => handle.remove();
      }).catch(() => {
        console.error('[gomsinlog] Could not observe native app state for consent recovery.');
      });
    }

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', recoverVisible);
      window.removeEventListener('online', recoverOnline);
      if (removeNativeListener) void removeNativeListener();
    };
  }, [verifyConsent]);

  /*
   * Prediction reads `periods` ONLY.
   *
   * `dailyLogs` is not in scope of this call and not in the dependency list: a
   * condition log cannot move the prediction, which is the whole point of the V3
   * split.
   */
  const prediction = useMemo(
    () => predictCycle({
      periods,
      configuredCycleLength: cycleLength,
      configuredPeriodLength: periodLength,
      today,
    }),
    [cycleLength, periodLength, periods, today],
  );

  const activePeriod = useMemo(() => activePeriodOnDate(periods, today), [periods, today]);
  const selectedLog = useMemo(
    () => dailyLogOnDate(dailyLogs, selectedDate),
    [dailyLogs, selectedDate],
  );

  const mergeDailyLog = useCallback((saved: CycleDailyLog) => {
    setDailyLogs((current) => {
      const others = current.filter((log) => log.logDate !== saved.logDate);
      return [saved, ...others].sort((a, b) => b.logDate.localeCompare(a.logDate));
    });
  }, []);

  const moveMonth = (amount: number) => {
    const next = shiftCalendarMonth(viewYear, viewMonth, amount);
    setViewYear(next.year);
    setViewMonth(next.month);
  };

  // ---------------------------------------------------------------
  // Period mutations — write `cycle_periods`, never a daily log.
  // ---------------------------------------------------------------

  const startPeriodToday = async () => {
    const authority = captureGrantedAuthority();
    if (!authority || periodPending) return;
    // A second concurrent period is not a thing; the UI also hides this action
    // while one is active, and this is the race-safe backstop.
    if (activePeriod) return;
    setPeriodPending(true);
    setPeriodError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await saveCyclePeriodToDB(today, undefined, authority.userId);
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        toast.error(serverErrorMessage(result.reason));
        return;
      }
      const saved = result.period;
      setPeriods((current) => [
        saved,
        ...current.filter((period) => period.id !== saved.id),
      ].sort((a, b) => b.startDate.localeCompare(a.startDate)));
      toast.success('오늘부터 생리로 기록했어요.');
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to start cycle period.');
      toast.error(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setPeriodPending(false);
    }
  };

  const endPeriodToday = async () => {
    const authority = captureGrantedAuthority();
    if (!authority || periodPending || !activePeriod) return;
    // Already ended today: the write would set the identical end date, which
    // succeeds and changes nothing, so a stale render cannot make it look like
    // the tap did something. The Hero hides the button in this state; this is
    // the race-safe backstop.
    if (activePeriod.endDate === today) return;
    setPeriodPending(true);
    setPeriodError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await updateCyclePeriodInDB(
        activePeriod.id,
        activePeriod.startDate,
        today,
        authority.userId,
      );
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        toast.error(serverErrorMessage(result.reason));
        return;
      }
      const saved = result.period;
      setPeriods((current) => current.map((period) => (period.id === saved.id ? saved : period)));
      toast.success('오늘 종료로 기록했어요.');
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to end cycle period.');
      toast.error(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setPeriodPending(false);
    }
  };

  const savePeriodEdit = async (period: CyclePeriod, draft: CyclePeriodDraft) => {
    const authority = captureGrantedAuthority();
    if (!authority || periodPending) return;
    setPeriodPending(true);
    setPeriodError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await updateCyclePeriodInDB(
        period.id,
        draft.startDate,
        draft.endDate,
        authority.userId,
      );
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        setPeriodError(serverErrorMessage(result.reason));
        return;
      }
      const saved = result.period;
      setPeriods((current) => current
        .map((item) => (item.id === saved.id ? saved : item))
        .sort((a, b) => b.startDate.localeCompare(a.startDate)));
      setSheet({ kind: 'none' });
      toast.success('생리 기간을 수정했어요.');
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to update cycle period.');
      setPeriodError(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setPeriodPending(false);
    }
  };

  const deletePeriod = async (period: CyclePeriod) => {
    const authority = captureGrantedAuthority();
    if (!authority || periodDeletePending) return;
    setPeriodDeletePending(true);
    setPeriodError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await deleteCyclePeriodFromDB(period.id, authority.userId);
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        setPeriodError(serverErrorMessage(result.reason));
        return;
      }
      // Deleting a period leaves that date's condition log alone: they are
      // independent records and the user did not ask to lose their notes.
      setPeriods((current) => current.filter((item) => item.id !== period.id));
      setSheet({ kind: 'none' });
      toast.info('생리 기록을 삭제했어요.');
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to delete cycle period.');
      setPeriodError(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setPeriodDeletePending(false);
    }
  };

  // ---------------------------------------------------------------
  // Daily-log mutations — write `cycle_daily_logs`, never a period.
  // ---------------------------------------------------------------

  const toggleQuickSymptom = (symptom: CycleSymptom) => {
    const authority = captureGrantedAuthority();
    if (!authority || quickSymptomPending) return;
    const targetDate = selectedDate || today;
    setQuickSymptomPending(symptom);
    setDailyLogError(null);

    // Serialised so a burst of taps cannot overwrite each other's symptom array.
    dailyLogQueueRef.current = dailyLogQueueRef.current.then(async () => {
      try {
        // A consent recheck advances the generation before clearing the UI. Do
        // not let a queued tap cross that boundary and issue a late health write.
        if (!isCurrentGrantedAuthority(authority)) return;
        // Re-read from the latest state inside the queue, not from the closure.
        const existing = dailyLogOnDate(dailyLogsRef.current, targetDate);
        const nextSymptoms = existing?.symptoms.includes(symptom)
          ? existing.symptoms.filter((value) => value !== symptom)
          : [...(existing?.symptoms ?? []), symptom];

        const result = await saveCycleDailyLogToDB(targetDate, nextSymptoms, {
          flow: existing?.flow,
          painLevel: existing?.painLevel,
          mood: existing?.mood,
          note: existing?.note,
        }, authority.userId);
        if (!isCurrentGrantedAuthority(authority)) return;
        if (!result.ok) {
          toast.error(serverErrorMessage(result.reason));
          return;
        }
        mergeDailyLog(result.log);
      } catch (error) {
        if (!isCurrentGrantedAuthority(authority)) return;
        console.error('[gomsinlog] Failed to save cycle daily log.');
        toast.error(classifyServerError(error).message);
      } finally {
        if (isCurrentGrantedAuthority(authority)) setQuickSymptomPending(null);
      }
    });
  };

  const saveDailyLog = async (draft: CycleDailyLogDraft) => {
    const authority = captureGrantedAuthority();
    if (!authority || dailyLogPending) return;
    setDailyLogPending(true);
    setDailyLogError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await saveCycleDailyLogToDB(draft.logDate, draft.symptoms, {
        flow: draft.flow,
        painLevel: draft.painLevel,
        mood: draft.mood,
        note: draft.note,
      }, authority.userId);
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        // The sheet stays open, so the note the user typed survives a refusal.
        setDailyLogError(serverErrorMessage(result.reason));
        return;
      }
      mergeDailyLog(result.log);
      setSheet({ kind: 'none' });
      toast.success('오늘의 컨디션을 기록했어요.');
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to save cycle daily log.');
      setDailyLogError(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setDailyLogPending(false);
    }
  };

  const deleteDailyLog = async (log: CycleDailyLog) => {
    const authority = captureGrantedAuthority();
    if (!authority || dailyLogDeletePending) return;
    setDailyLogDeletePending(true);
    setDailyLogError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await deleteCycleDailyLogFromDB(log.id, authority.userId);
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        setDailyLogError(serverErrorMessage(result.reason));
        return;
      }
      setDailyLogs((current) => current.filter((item) => item.id !== log.id));
      setSheet({ kind: 'none' });
      toast.info('이 날의 컨디션 기록을 삭제했어요.');
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to delete cycle daily log.');
      setDailyLogError(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setDailyLogDeletePending(false);
    }
  };

  // ---------------------------------------------------------------
  // Settings, sharing, consent.
  // ---------------------------------------------------------------

  const saveLengths = async (nextCycleLength: number, nextPeriodLength: number) => {
    const authority = captureGrantedAuthority();
    if (!authority || settingsPending) return;
    const validation = validateCycleSettings(nextCycleLength, nextPeriodLength);
    if (validation) {
      setSettingsError(validation);
      return;
    }
    setSettingsPending(true);
    setSettingsError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await saveCycleSettingsToDB(
        nextCycleLength,
        nextPeriodLength,
        authority.userId,
      );
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        setSettingsError(serverErrorMessage(result.reason));
        return;
      }
      setCycleLength(result.settings.averageCycleLength);
      setPeriodLength(result.settings.averagePeriodLength);
      toast.success('주기 설정을 저장했어요.');
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to save cycle settings.');
      setSettingsError(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setSettingsPending(false);
    }
  };

  const toggleSharing = async (key: ShareKey, next: boolean) => {
    const authority = captureGrantedAuthority();
    if (!authority || sharingPendingKey) return;
    setSharingPendingKey(key);
    setSharingError(null);
    try {
      if (!isCurrentGrantedAuthority(authority)) return;
      const result = await saveCycleSharingPreferencesToDB({ [key]: next }, authority.userId);
      if (!isCurrentGrantedAuthority(authority)) return;
      if (!result.ok) {
        // No optimistic flip: an unsaved preference must never look saved, because
        // the user would believe they had shared (or stopped sharing) something.
        setSharingError(serverErrorMessage(result.reason));
        return;
      }
      setPreferences(result.preferences);
    } catch (error) {
      if (!isCurrentGrantedAuthority(authority)) return;
      console.error('[gomsinlog] Failed to save cycle sharing preferences.');
      setSharingError(classifyServerError(error).message);
    } finally {
      if (isCurrentGrantedAuthority(authority)) setSharingPendingKey(null);
    }
  };

  const acceptConsent = async () => {
    const current = authorityRef.current;
    if (!userId
      || current.userId !== userId
      || current.phase !== 'locked'
      || !consentChecked) return;
    const authority = beginAuthorityOperation('granting');
    if (!authority) return;
    setConsentError(null);
    revokeCycleSensitiveConsent(authority.userId);
    clearSensitiveState();
    try {
      // A previous consent period must never silently reactivate old partner
      // sharing. All-false is permitted while locked by migration 070.
      const resetSharing = await saveCycleSharingPreferencesToDB({
        shareCurrentPeriod: false,
        sharePredictionWindow: false,
        shareFertilityWindow: false,
      }, authority.userId);
      if (!isCurrentAuthority(authority)) return;
      if (!resetSharing.ok) {
        commitAuthority(authority, 'locked');
        setConsentError(serverErrorMessage(resetSharing.reason));
        return;
      }

      const result = await grantCycleConsentInDB(authority.userId, authority.revision);
      if (!isCurrentAuthority(authority)) return;
      if (!result.ok) {
        commitAuthority(authority, 'locked');
        setConsentError(serverErrorMessage(result.reason));
        return;
      }
      if (!result.applied || !result.granted) {
        commitAuthority(authority, 'locked', result.revision);
        setConsentChecked(false);
        setConsentError('동의 상태가 다른 기기에서 바뀌었어요. 내용을 다시 확인해 주세요.');
        return;
      }
      if (!grantCycleSensitiveConsent(authority.userId)) {
        commitAuthority(authority, 'locked', result.revision);
        setConsentError('이 기기에 민감정보 동의 상태를 안전하게 저장하지 못했어요.');
        return;
      }
      commitAuthority(authority, 'granted', result.revision);
      setConsentChecked(false);
    } catch (error) {
      if (!isCurrentAuthority(authority)) return;
      commitAuthority(authority, 'locked');
      setConsentError(classifyServerError(error).message);
    }
  };

  const revokeConsent = async () => {
    const current = authorityRef.current;
    if (!userId
      || current.userId !== userId
      || (current.phase !== 'granted' && current.phase !== 'locked_error')) return;
    const shouldResetSharing = preferences.shareCurrentPeriod
      || preferences.sharePredictionWindow
      || preferences.shareFertilityWindow;
    const authority = beginAuthorityOperation('revoking');
    if (!authority) return;

    // The user's explicit stop request wins locally at once. Server failure does
    // not reopen cached health data; it enters a retry-only fail-closed state.
    markCycleConsentRevocationPending(authority.userId);
    revokeCycleSensitiveConsent(authority.userId);
    setConsentError(null);
    clearSensitiveState();
    try {
      // Revoke first. The server projection is consent-gated, so this is the
      // shortest path to stopping every partner projection even when preference
      // cleanup later fails.
      const result = await revokeCycleConsentInDB(authority.userId);
      if (!isCurrentAuthority(authority)) return;
      if (!result.ok) {
        commitAuthority(authority, 'locked_error');
        setConsentError(serverErrorMessage(result.reason));
        return;
      }

      if (!result.applied || result.granted) {
        commitAuthority(authority, 'locked_error', result.revision);
        setConsentError('민감정보 동의 철회 상태를 확인하지 못했어요. 다시 시도해 주세요.');
        return;
      }

      clearPendingCycleConsentRevocation(authority.userId);
      commitAuthority(authority, 'locked', result.revision);
      setConsentChecked(false);
      toast.info('민감정보 동의를 철회했어요.');

      // Remove stale opt-ins after authority is gone. This is hygiene rather
      // than the privacy boundary: migration 069 already returns no projection
      // for revoked consent, and grant clears these values again before unlock.
      // It deliberately runs in the background so a slow cleanup cannot hold
      // sensitive UI in a pending state after revocation already succeeded.
      if (shouldResetSharing) {
        void saveCycleSharingPreferencesToDB({
          shareCurrentPeriod: false,
          sharePredictionWindow: false,
          shareFertilityWindow: false,
        }, authority.userId).then((stopSharing) => {
          if (!stopSharing.ok) {
            console.error('[gomsinlog] Could not reset cycle sharing after consent revoke.');
          }
        }).catch(() => {
          console.error('[gomsinlog] Could not reset cycle sharing after consent revoke.');
        });
      }
    } catch (error) {
      if (!isCurrentAuthority(authority)) return;
      commitAuthority(authority, 'locked_error');
      setConsentError(classifyServerError(error).message);
    }
  };

  // Latest daily logs, readable from inside the serialised write queue.
  const dailyLogsRef = useRef(dailyLogs);
  useEffect(() => { dailyLogsRef.current = dailyLogs; }, [dailyLogs]);

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  if (!userId) {
    return (
      <Card>
        <p className="text-caption text-muted-foreground text-center">
          {failureMessage('unauthenticated')}
        </p>
      </Card>
    );
  }

  if (consentChecking) {
    return (
      <Card>
        <div
          className="py-6 flex items-center justify-center gap-2 text-caption text-muted-foreground"
          role="status"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          동의 상태를 확인하는 중이에요.
        </div>
      </Card>
    );
  }

  if (consentPhase === 'revoking') {
    return (
      <Card>
        <div
          className="py-6 flex items-center justify-center gap-2 text-caption text-muted-foreground"
          role="status"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          민감정보 동의를 철회하는 중이에요.
        </div>
      </Card>
    );
  }

  if (consentPhase === 'locked_error') {
    return (
      <Card className="space-y-4" aria-labelledby="cycle-revoke-recovery-title">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-destructive" aria-hidden="true" />
          <h3 id="cycle-revoke-recovery-title" className="text-heading text-foreground">
            주기 기능을 잠갔어요
          </h3>
        </div>
        <p className="text-caption text-muted-foreground leading-relaxed">
          기기에서는 기록을 모두 숨겼어요. 서버의 동의 철회를 완료하려면 다시 시도해 주세요.
        </p>
        {consentError && <ErrorNote>{consentError}</ErrorNote>}
        <Button variant="primary" size="md" full onClick={() => void revokeConsent()}>
          철회 다시 시도
        </Button>
      </Card>
    );
  }

  if (!consentGranted) {
    return (
      /*
        Order matters here, and it is the whole point of this layout.

        This card is the FIRST thing a 곰신 who has not consented sees on 마이 --
        above their cycle, above 복무와 일정, above settings. It used to open with
        the four-field disclosure block in a filled, coral-bordered box, so the
        first impression of the tab was a legal form and the thing being offered
        was never stated in words anyone would choose to read.

        Nothing legally required was removed to fix that: PIPA §23 needs separate,
        informed consent for 민감정보, so all four items and the refusal-rights
        sentence are still here and still visible without a tap. What changed is
        that the offer is stated first and the disclosure is drawn as reference
        text underneath it rather than as the loudest element on the screen.
      */
      <Card className="space-y-4" aria-labelledby="cycle-consent-title">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-coral" aria-hidden="true" />
          <h3 id="cycle-consent-title" className="text-heading text-foreground">내 몸의 리듬 시작하기</h3>
        </div>

        <div data-testid="cycle-consent-offer" className="space-y-1.5 border-b border-border/40 pb-3">
          <p className="text-label text-foreground leading-relaxed">
            생리 주기를 기록하면 다음 예상 범위를 볼 수 있어요.
          </p>
          <p className="text-caption text-muted-foreground leading-relaxed">
            기록은 나만 봐요. 상대방에게는 내가 직접 고른 것만 전해지고, 원본은 전해지지 않아요.
          </p>
        </div>

        <div
          data-testid="cycle-consent-disclosure"
          className="rounded-control border border-border bg-muted/40 p-3 space-y-2 text-caption text-muted-foreground leading-relaxed"
        >
          <p className="text-label font-bold text-foreground">동의 전에 확인해 주세요</p>
          <p><strong className="text-foreground">수집 항목:</strong> 생리 시작·종료일, 일별 컨디션(증상·통증·기분·메모), 평균 주기 설정</p>
          <p><strong className="text-foreground">이용 목적:</strong> 본인 주기 기록과 예상 범위 표시</p>
          <p><strong className="text-foreground">파트너 공유:</strong> 직접 선택한 항목만. 원본 기록은 공유되지 않아요.</p>
          <p><strong className="text-foreground">보유 기간:</strong> 직접 삭제하거나 회원 탈퇴할 때까지</p>
          <p>건강 관련 민감정보 처리 동의를 거부할 수 있으며, 거부해도 이 기능 외의 곰신로그는 그대로 이용할 수 있어요.</p>
        </div>
        <label className="flex items-start gap-3 min-h-11 rounded-control border border-border p-3 text-label text-foreground">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(event) => setConsentChecked(event.target.checked)}
            className="mt-0.5 accent-coral"
          />
          <span>위 민감정보 수집·이용에 별도로 동의합니다. (선택)</span>
        </label>
        {consentError && <ErrorNote>{consentError}</ErrorNote>}
        <Button
          variant="primary"
          size="md"
          full
          disabled={!consentChecked || consentPending}
          onClick={() => void acceptConsent()}
        >
          {consentPending ? '확인 중...' : '동의하고 시작하기'}
        </Button>
        <a
          href="/legal/privacy"
          className="flex min-h-11 items-center justify-center text-caption font-medium text-info underline underline-offset-2"
        >
          개인정보 처리방침 보기
        </a>
      </Card>
    );
  }

  const selectedPeriod = periods.find(
    (period) => period.startDate <= selectedDate
      && selectedDate <= (period.endDate || period.startDate),
  ) || null;

  return (
    <Card className="space-y-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-coral" aria-hidden="true" />
          <h2 className="text-heading text-foreground">내 몸의 리듬</h2>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-caption text-coral-strong font-medium bg-coral/10 px-2.5 py-1 rounded-full whitespace-nowrap">
            <Lock className="w-3 h-3 inline mr-1" aria-hidden="true" />나만 보기
          </span>
          <button
            type="button"
            onClick={() => setSheet({ kind: 'settings' })}
            aria-label="내 몸의 리듬 설정"
            className="press-response min-h-11 min-w-11 flex items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
          >
            <Settings2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/*
        First load only. A refresh keeps the calendar the user is looking at.

        The realtime invalidation re-runs the load and sets `loading` again, which
        used to swap a month view for this one line and back. `periods.length === 0`
        makes it a first-load state; the `error` branch below still hides content on
        a genuine failure, which is a different decision and stays.
      */}
      {loadState === 'loading' && periods.length === 0 && (
        <div
          className="py-6 flex items-center justify-center gap-2 text-caption text-muted-foreground"
          role="status"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          개인 기록을 불러오는 중이에요.
        </div>
      )}

      {(loadState === 'unauthenticated'
        || loadState === 'forbidden'
        || loadState === 'not_deployed'
        || loadState === 'error') && (
        <div className="p-4 rounded-surface bg-muted/40 text-center space-y-3" role="alert">
          <p className="text-caption text-muted-foreground">{failureMessage(loadState)}</p>
          {loadState === 'error' && (
            <button
              type="button"
              onClick={() => void verifyConsent()}
              className="press-response min-h-11 px-4 rounded-control bg-foreground text-background text-label font-bold"
            >
              다시 시도
            </button>
          )}
        </div>
      )}

      {(loadState === 'ready'
        // Keep the calendar up through a refresh that already has data.
        || (loadState === 'loading' && periods.length > 0)) && (
        <>
          <CycleStatusHero
            activePeriod={activePeriod}
            prediction={prediction}
            today={today}
            pending={periodPending}
            onStartPeriod={() => void startPeriodToday()}
            onEndPeriod={() => void endPeriodToday()}
          />

          <CycleCalendar
            year={viewYear}
            month={viewMonth}
            periods={periods}
            dailyLogs={dailyLogs}
            prediction={prediction}
            today={today}
            selectedDate={selectedDate}
            onMoveMonth={moveMonth}
            onSelectDate={(date) => {
              setSelectedDate(date);
              setSheet({ kind: 'day', date });
            }}
          />

          <CycleQuickLog
            activeSymptoms={selectedLog?.symptoms ?? []}
            pendingSymptom={quickSymptomPending}
            isToday={selectedDate === today}
            selectedLabel={formatKoreanDate(selectedDate)}
            onToggleSymptom={toggleQuickSymptom}
            onOpenDetail={() => setSheet({ kind: 'dailyLog', date: selectedDate })}
          />

          <CycleSummary
            prediction={prediction}
            periods={periods}
            dailyLogs={dailyLogs}
            configuredCycleLength={cycleLength}
            configuredPeriodLength={periodLength}
          />
        </>
      )}

      {sheet.kind === 'day' && (
        <CycleDaySheet
          date={sheet.date}
          period={selectedPeriod}
          dailyLog={dailyLogOnDate(dailyLogs, sheet.date)}
          isPredicted={predictionOccursOnDate(prediction, sheet.date)}
          onEditPeriod={(period) => setSheet({ kind: 'period', period })}
          onEditDailyLog={() => setSheet({ kind: 'dailyLog', date: sheet.date })}
          onClose={() => setSheet({ kind: 'none' })}
        />
      )}

      {sheet.kind === 'dailyLog' && (
        <CycleDailyLogEditor
          key={sheet.date}
          date={sheet.date}
          existingLog={dailyLogOnDate(dailyLogs, sheet.date)}
          pending={dailyLogPending}
          deletePending={dailyLogDeletePending}
          error={dailyLogError}
          onSave={(draft) => void saveDailyLog(draft)}
          onDelete={(log) => void deleteDailyLog(log)}
          onClose={() => {
            setDailyLogError(null);
            setSheet({ kind: 'none' });
          }}
        />
      )}

      {sheet.kind === 'period' && (
        <CyclePeriodEditor
          key={sheet.period.id}
          period={sheet.period}
          pending={periodPending}
          deletePending={periodDeletePending}
          error={periodError}
          onSave={(draft) => void savePeriodEdit(sheet.period, draft)}
          onDelete={(period) => void deletePeriod(period)}
          onClose={() => {
            setPeriodError(null);
            setSheet({ kind: 'none' });
          }}
        />
      )}

      {sheet.kind === 'settings' && (
        <CycleSettingsSheet
          cycleLength={cycleLength}
          periodLength={periodLength}
          prediction={prediction}
          periodActive={!!activePeriod}
          preferences={preferences}
          sharingPendingKey={sharingPendingKey}
          sharingError={sharingError}
          settingsPending={settingsPending}
          settingsError={settingsError}
          consentPending={consentPending}
          consentError={consentError}
          onSaveLengths={(nextCycle, nextPeriod) => void saveLengths(nextCycle, nextPeriod)}
          onToggleSharing={(key, next) => void toggleSharing(key, next)}
          onRevokeConsent={() => void revokeConsent()}
          onClose={() => {
            setSettingsError(null);
            setSharingError(null);
            setSheet({ kind: 'none' });
          }}
        />
      )}
    </Card>
  );
}
