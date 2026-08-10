import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HeartPulse, Loader2, Lock, Settings2 } from 'lucide-react';
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
import { classifyServerError, serverErrorMessage } from '@/lib/serverErrors';
import {
  grantCycleConsentInDB,
  hasCycleSensitiveConsent,
  revokeCycleConsentInDB,
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

type LoadState = 'loading' | 'ready' | CycleFetchFailureReason;
type ShareKey = 'shareCurrentPeriod' | 'sharePredictionWindow' | 'shareFertilityWindow';

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
  const initialDate = new Date();

  /*
   * Identity generation guard.
   *
   * An account switch must invalidate every in-flight request: without this, a
   * slow load for user A could resolve after user B signed in and paint A's
   * health data onto B's screen.
   */
  const identityRef = useRef(userId);
  const generationRef = useRef(0);
  if (identityRef.current !== userId) {
    identityRef.current = userId;
    generationRef.current += 1;
  }
  const captureIdentity = useCallback(
    () => ({ userId, generation: generationRef.current }),
    [userId],
  );
  const isCurrentIdentity = useCallback(
    (identity: { userId?: string; generation: number }) =>
      identity.userId === identityRef.current && identity.generation === generationRef.current,
    [],
  );

  const [loadState, setLoadState] = useState<LoadState>(userId ? 'loading' : 'unauthenticated');
  /**
   * Consent verdict, tagged with the account it belongs to.
   *
   * A bare boolean survived an account switch for one render, so the load effect
   * could fire for the NEW account while still holding the PREVIOUS account's
   * "granted". Pairing the verdict with its owner makes that impossible to read
   * as consent: the id must match before anything is fetched.
   */
  const [consentVerdict, setConsentVerdict] = useState<{ userId: string; granted: boolean } | null>(null);
  const consentGranted = !!consentVerdict
    && !!userId
    && consentVerdict.userId === userId
    && consentVerdict.granted;
  const [consentChecking, setConsentChecking] = useState(!!userId);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentPending, setConsentPending] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // V3 server state. Periods and daily logs are separate arrays, never merged.
  const [periods, setPeriods] = useState<CyclePeriod[]>([]);
  const [dailyLogs, setDailyLogs] = useState<CycleDailyLog[]>([]);
  const [cycleLength, setCycleLength] = useState(28);
  const [periodLength, setPeriodLength] = useState(5);
  const [preferences, setPreferences] = useState<CycleSharingPreferences>(EMPTY_PREFERENCES);

  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
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

  useLayoutEffect(() => {
    setLoadState(userId ? 'loading' : 'unauthenticated');
    setConsentVerdict(null);
    setConsentChecking(!!userId);
    setConsentChecked(false);
    setConsentPending(false);
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
   * A cached `localStorage` flag is not sufficient authority to read health data:
   * consent revoked on another device, or a row that never persisted, must both
   * keep the feature locked here.
   */
  useEffect(() => {
    if (!userId) return;
    const identity = captureIdentity();
    let cancelled = false;
    setConsentChecking(true);
    void syncCycleConsentWithDB(userId).then((result) => {
      if (cancelled || !isCurrentIdentity(identity)) return;
      if (!result.ok) {
        // Could not reach the authority. Fall back to the cached answer rather
        // than inventing consent, and surface the reason.
        setConsentVerdict({ userId, granted: hasCycleSensitiveConsent(userId) });
        setConsentError(serverErrorMessage(result.reason));
      } else {
        setConsentVerdict({ userId, granted: result.granted });
      }
      setConsentChecking(false);
    });
    return () => { cancelled = true; };
  }, [captureIdentity, isCurrentIdentity, userId]);

  const performLoad = useCallback(async () => {
    const identity = captureIdentity();
    if (!userId || !consentGranted) return;
    setLoadState('loading');
    try {
      const [periodResult, logResult, settingResult] = await Promise.all([
        fetchCyclePeriodsResultFromDB(),
        fetchCycleDailyLogsResultFromDB(),
        fetchCycleSettingsResultFromDB(),
      ]);
      if (!isCurrentIdentity(identity)) return;

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

      const nextPreferences = await fetchCycleSharingPreferencesFromDB();
      if (!isCurrentIdentity(identity)) return;
      setPreferences(nextPreferences);
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to load private cycle data:', error);
      setLoadState('error');
    }
  }, [captureIdentity, consentGranted, isCurrentIdentity, userId]);

  const load = useCallback((): Promise<void> => {
    const key = `${userId || ''}:${consentGranted ? '1' : '0'}`;
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
  }, [consentGranted, performLoad, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const recoverVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const recoverOnline = () => void load();
    document.addEventListener('visibilitychange', recoverVisible);
    window.addEventListener('online', recoverOnline);
    return () => {
      document.removeEventListener('visibilitychange', recoverVisible);
      window.removeEventListener('online', recoverOnline);
    };
  }, [load]);

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
    const identity = captureIdentity();
    if (!identity.userId || periodPending) return;
    // A second concurrent period is not a thing; the UI also hides this action
    // while one is active, and this is the race-safe backstop.
    if (activePeriod) return;
    setPeriodPending(true);
    setPeriodError(null);
    try {
      const result = await saveCyclePeriodToDB(today);
      if (!isCurrentIdentity(identity)) return;
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
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to start cycle period:', error);
      toast.error(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setPeriodPending(false);
    }
  };

  const endPeriodToday = async () => {
    const identity = captureIdentity();
    if (!identity.userId || periodPending || !activePeriod) return;
    setPeriodPending(true);
    setPeriodError(null);
    try {
      const result = await updateCyclePeriodInDB(activePeriod.id, activePeriod.startDate, today);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        toast.error(serverErrorMessage(result.reason));
        return;
      }
      const saved = result.period;
      setPeriods((current) => current.map((period) => (period.id === saved.id ? saved : period)));
      toast.success('오늘 종료로 기록했어요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to end cycle period:', error);
      toast.error(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setPeriodPending(false);
    }
  };

  const savePeriodEdit = async (period: CyclePeriod, draft: CyclePeriodDraft) => {
    const identity = captureIdentity();
    if (!identity.userId || periodPending) return;
    setPeriodPending(true);
    setPeriodError(null);
    try {
      const result = await updateCyclePeriodInDB(period.id, draft.startDate, draft.endDate);
      if (!isCurrentIdentity(identity)) return;
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
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to update cycle period:', error);
      setPeriodError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setPeriodPending(false);
    }
  };

  const deletePeriod = async (period: CyclePeriod) => {
    const identity = captureIdentity();
    if (!identity.userId || periodDeletePending) return;
    setPeriodDeletePending(true);
    setPeriodError(null);
    try {
      const result = await deleteCyclePeriodFromDB(period.id);
      if (!isCurrentIdentity(identity)) return;
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
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to delete cycle period:', error);
      setPeriodError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setPeriodDeletePending(false);
    }
  };

  // ---------------------------------------------------------------
  // Daily-log mutations — write `cycle_daily_logs`, never a period.
  // ---------------------------------------------------------------

  const toggleQuickSymptom = (symptom: CycleSymptom) => {
    const identity = captureIdentity();
    if (!identity.userId || quickSymptomPending) return;
    const targetDate = selectedDate || today;
    setQuickSymptomPending(symptom);
    setDailyLogError(null);

    // Serialised so a burst of taps cannot overwrite each other's symptom array.
    dailyLogQueueRef.current = dailyLogQueueRef.current.then(async () => {
      try {
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
        });
        if (!isCurrentIdentity(identity)) return;
        if (!result.ok) {
          toast.error(serverErrorMessage(result.reason));
          return;
        }
        mergeDailyLog(result.log);
      } catch (error) {
        if (!isCurrentIdentity(identity)) return;
        console.error('[gomsinlog] Failed to save cycle daily log:', error);
        toast.error(classifyServerError(error).message);
      } finally {
        if (isCurrentIdentity(identity)) setQuickSymptomPending(null);
      }
    });
  };

  const saveDailyLog = async (draft: CycleDailyLogDraft) => {
    const identity = captureIdentity();
    if (!identity.userId || dailyLogPending) return;
    setDailyLogPending(true);
    setDailyLogError(null);
    try {
      const result = await saveCycleDailyLogToDB(draft.logDate, draft.symptoms, {
        flow: draft.flow,
        painLevel: draft.painLevel,
        mood: draft.mood,
        note: draft.note,
      });
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        // The sheet stays open, so the note the user typed survives a refusal.
        setDailyLogError(serverErrorMessage(result.reason));
        return;
      }
      mergeDailyLog(result.log);
      setSheet({ kind: 'none' });
      toast.success('오늘의 컨디션을 기록했어요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to save cycle daily log:', error);
      setDailyLogError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setDailyLogPending(false);
    }
  };

  const deleteDailyLog = async (log: CycleDailyLog) => {
    const identity = captureIdentity();
    if (!identity.userId || dailyLogDeletePending) return;
    setDailyLogDeletePending(true);
    setDailyLogError(null);
    try {
      const result = await deleteCycleDailyLogFromDB(log.id);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        setDailyLogError(serverErrorMessage(result.reason));
        return;
      }
      setDailyLogs((current) => current.filter((item) => item.id !== log.id));
      setSheet({ kind: 'none' });
      toast.info('이 날의 컨디션 기록을 삭제했어요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to delete cycle daily log:', error);
      setDailyLogError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setDailyLogDeletePending(false);
    }
  };

  // ---------------------------------------------------------------
  // Settings, sharing, consent.
  // ---------------------------------------------------------------

  const saveLengths = async (nextCycleLength: number, nextPeriodLength: number) => {
    const identity = captureIdentity();
    if (!identity.userId || settingsPending) return;
    const validation = validateCycleSettings(nextCycleLength, nextPeriodLength);
    if (validation) {
      setSettingsError(validation);
      return;
    }
    setSettingsPending(true);
    setSettingsError(null);
    try {
      const result = await saveCycleSettingsToDB(nextCycleLength, nextPeriodLength);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        setSettingsError(serverErrorMessage(result.reason));
        return;
      }
      setCycleLength(result.settings.averageCycleLength);
      setPeriodLength(result.settings.averagePeriodLength);
      toast.success('주기 설정을 저장했어요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to save cycle settings:', error);
      setSettingsError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setSettingsPending(false);
    }
  };

  const toggleSharing = async (key: ShareKey, next: boolean) => {
    const identity = captureIdentity();
    if (!identity.userId || sharingPendingKey) return;
    setSharingPendingKey(key);
    setSharingError(null);
    try {
      const result = await saveCycleSharingPreferencesToDB({ [key]: next });
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        // No optimistic flip: an unsaved preference must never look saved, because
        // the user would believe they had shared (or stopped sharing) something.
        setSharingError(serverErrorMessage(result.reason));
        return;
      }
      setPreferences(result.preferences);
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('[gomsinlog] Failed to save cycle sharing preferences:', error);
      setSharingError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setSharingPendingKey(null);
    }
  };

  const acceptConsent = async () => {
    const identity = captureIdentity();
    if (!identity.userId || !consentChecked || consentPending) return;
    setConsentPending(true);
    setConsentError(null);
    try {
      // Server first, cache second, unlock last.
      const result = await grantCycleConsentInDB(identity.userId);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        setConsentError(serverErrorMessage(result.reason));
        return;
      }
      setConsentVerdict({ userId: identity.userId, granted: true });
    } finally {
      if (isCurrentIdentity(identity)) setConsentPending(false);
    }
  };

  const revokeConsent = async () => {
    const identity = captureIdentity();
    if (!identity.userId || consentPending) return;
    setConsentPending(true);
    setConsentError(null);
    try {
      /*
       * Turn partner sharing off BEFORE revoking, not after.
       *
       * Revoking means "stop using this data this way", and sharing it with a
       * partner is one of those ways. Doing it in this order means a failure
       * anywhere leaves the stricter state: if the sharing write fails we stop
       * and keep consent, so the user is never told sharing ended while it
       * continued. The server enforces the same rule independently (migration
       * 026), because this write can fail or the revoke can happen on another
       * device.
       */
      if (preferences.shareCurrentPeriod
        || preferences.sharePredictionWindow
        || preferences.shareFertilityWindow) {
        const stopSharing = await saveCycleSharingPreferencesToDB({
          shareCurrentPeriod: false,
          sharePredictionWindow: false,
          shareFertilityWindow: false,
        });
        if (!isCurrentIdentity(identity)) return;
        if (!stopSharing.ok) {
          setConsentError(serverErrorMessage(stopSharing.reason));
          return;
        }
        setPreferences(stopSharing.preferences);
      }

      const result = await revokeCycleConsentInDB(identity.userId);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        // Never report a refused revoke as done.
        setConsentError(serverErrorMessage(result.reason));
        return;
      }
      setConsentVerdict({ userId: identity.userId, granted: false });
      setConsentChecked(false);
      setPeriods([]);
      setDailyLogs([]);
      setPreferences(EMPTY_PREFERENCES);
      setSheet({ kind: 'none' });
      toast.info('민감정보 동의를 철회했어요.');
    } finally {
      if (isCurrentIdentity(identity)) setConsentPending(false);
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
      <section className="bg-card rounded-surface p-4 border border-border">
        <p className="text-caption text-muted-foreground text-center">
          {failureMessage('unauthenticated')}
        </p>
      </section>
    );
  }

  if (consentChecking) {
    return (
      <section className="bg-card rounded-surface p-4 border border-border">
        <div
          className="py-6 flex items-center justify-center gap-2 text-caption text-muted-foreground"
          role="status"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          동의 상태를 확인하는 중이에요.
        </div>
      </section>
    );
  }

  if (!consentGranted) {
    return (
      <section
        className="bg-card rounded-surface p-4 border border-border space-y-4"
        aria-labelledby="cycle-consent-title"
      >
        <div className="flex items-center gap-2 border-b border-border/40 pb-3">
          <HeartPulse className="w-5 h-5 text-coral" aria-hidden="true" />
          <h3 id="cycle-consent-title" className="text-heading text-foreground">내 몸의 리듬 시작하기</h3>
        </div>
        <div className="rounded-control border border-coral/30 bg-coral/5 p-3 space-y-2 text-caption text-muted-foreground leading-relaxed">
          <p><strong className="text-foreground">수집 항목:</strong> 생리 시작·종료일, 일별 컨디션(증상·출혈량·통증·기분·메모), 평균 주기 설정</p>
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
        {consentError && <p role="alert" className="text-caption text-destructive">{consentError}</p>}
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
      </section>
    );
  }

  const selectedPeriod = periods.find(
    (period) => period.startDate <= selectedDate
      && selectedDate <= (period.endDate || period.startDate),
  ) || null;

  return (
    <section className="bg-card rounded-surface border border-border p-4 space-y-6">
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
            className="min-h-11 min-w-11 flex items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
          >
            <Settings2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {loadState === 'loading' && (
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
              onClick={() => void load()}
              className="min-h-11 px-4 rounded-control bg-foreground text-background text-label font-bold"
            >
              다시 시도
            </button>
          )}
        </div>
      )}

      {loadState === 'ready' && (
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
    </section>
  );
}
