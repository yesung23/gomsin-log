import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  HeartPulse,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { Check, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { predictCycle } from '@/lib/cyclePrediction';
import {
  buildMonthCalendarCells,
  calculateExpectedStartDate,
  CYCLE_LENGTH_MAX,
  CYCLE_LENGTH_MIN,
  cycleEntryOccursOnDate,
  cycleRangesOnDate,
  deleteCycleEntryFromDB,
  fetchCycleEntriesResultFromDB,
  fetchCycleSettingsResultFromDB,
  localToday,
  PERIOD_LENGTH_MAX,
  PERIOD_LENGTH_MIN,
  saveCycleEntryToDB,
  saveCycleSettingsToDB,
  shiftCalendarMonth,
  updateCycleEntryInDB,
  validateCycleEntryDraft,
  validateCycleSettings,
  type CycleEntryDraft,
  type CycleFetchFailureReason,
} from '@/lib/cycle';
import { classifyServerError, serverErrorMessage } from '@/lib/serverErrors';
import { grantCycleSensitiveConsent, hasCycleSensitiveConsent, revokeConsentInDB } from '@/lib/sensitiveConsent';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { CYCLE_SYMPTOMS, type CycleEntry, type CycleSymptom } from '@/types';

type LoadState = 'loading' | 'ready' | 'empty' | CycleFetchFailureReason;

const symptomLabels: Record<CycleSymptom, string> = {
  cramps: '복부 불편감',
  headache: '두통',
  fatigue: '피로',
  bloating: '더부룩함',
  mood_changes: '기분 변화',
  backache: '허리 불편감',
};

const symptomIcons: Record<CycleSymptom, string> = {
  cramps: '🩸',
  headache: '💆‍♀️',
  fatigue: '😴',
  bloating: '🎈',
  mood_changes: '⚡',
  backache: '💫',
};

const emptyDraft = (startDate: string): CycleEntryDraft => ({
  startDate,
  endDate: undefined,
  notes: '',
  symptoms: [],
});

function failureMessage(state: Extract<LoadState, 'unauthenticated' | 'forbidden' | 'error'>) {
  if (state === 'unauthenticated') return '개인 기록을 보려면 로그인해 주세요.';
  if (state === 'forbidden') return '이 개인 기록에 접근할 권한이 없어요.';
  return '개인 기록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
}

function formatRange(entry: CycleEntry): string {
  return entry.endDate ? `${entry.startDate} ~ ${entry.endDate}` : entry.startDate;
}

function getDaysDifference(fromStr: string, toStr: string): number {
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

function formatDDayText(expectedStr: string, todayStr: string): string {
  const diff = getDaysDifference(todayStr, expectedStr);
  if (diff === 0) return 'D-Day (오늘)';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

export function CycleTrackerSection({ userId }: { userId?: string }) {
  const today = localToday();
  const initialDate = new Date();
  const identityRef = useRef(userId);
  const generationRef = useRef(0);
  if (identityRef.current !== userId) {
    identityRef.current = userId;
    generationRef.current += 1;
  }
  const captureIdentity = useCallback(() => ({ userId, generation: generationRef.current }), [userId]);
  const isCurrentIdentity = useCallback(
    (identity: { userId?: string; generation: number }) =>
      identity.userId === identityRef.current && identity.generation === generationRef.current,
    [],
  );
  const [loadState, setLoadState] = useState<LoadState>(userId ? 'loading' : 'unauthenticated');
  const [consentGranted, setConsentGranted] = useState(() => hasCycleSensitiveConsent(userId));
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [entries, setEntries] = useState<CycleEntry[]>([]);
  const [cycleLength, setCycleLength] = useState(28);
  const [periodLength, setPeriodLength] = useState(5);
  const [cycleLengthDraft, setCycleLengthDraft] = useState(28);
  const [periodLengthDraft, setPeriodLengthDraft] = useState(5);
  const [settingsPending, setSettingsPending] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [showPartnerPreview, setShowPartnerPreview] = useState(false);
  const [shareCurrentPeriod, setShareCurrentPeriod] = useState(false);
  const [sharePredictionWindow, setSharePredictionWindow] = useState(false);
  const [shareFertilityWindow, setShareFertilityWindow] = useState(false);
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CycleEntryDraft>(emptyDraft(today));
  const [showMoreForm, setShowMoreForm] = useState(false);
  const [formPending, setFormPending] = useState(false);
  const [quickActionPending, setQuickActionPending] = useState(false);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const loadCoordinatorRef = useRef<{
    key: string;
    queued: boolean;
    promise: Promise<void>;
  } | null>(null);

  useLayoutEffect(() => {
    setConsentGranted(hasCycleSensitiveConsent(userId));
    setConsentChecked(false);
    setConsentError(null);
    setEntries([]);
    setCycleLength(28);
    setPeriodLength(5);
    setCycleLengthDraft(28);
    setPeriodLengthDraft(5);
    setSettingsPending(false);
    setSettingsError(null);
    setSelectedDate(today);
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft(today));
    setFormPending(false);
    setDeletePendingId(null);
    setFormError(null);
    setLoadState(userId ? 'loading' : 'unauthenticated');
  }, [today, userId]);

  const performLoad = useCallback(async () => {
    const identity = captureIdentity();
    setLoadState(userId ? 'loading' : 'unauthenticated');
    if (!userId || !consentGranted) return;
    try {
      const [entryResult, settingResult] = await Promise.all([
        fetchCycleEntriesResultFromDB(),
        fetchCycleSettingsResultFromDB(),
      ]);
      if (!isCurrentIdentity(identity)) return;
      if (!entryResult.ok || !settingResult.ok) {
        const reasons = [
          !entryResult.ok ? entryResult.reason : null,
          !settingResult.ok ? settingResult.reason : null,
        ];
        const reason = reasons.includes('unauthenticated')
          ? 'unauthenticated'
          : reasons.includes('forbidden') ? 'forbidden' : 'error';
        setLoadState(reason);
        return;
      }
      setEntries(entryResult.entries);
      const nextCycleLength = settingResult.settings?.averageCycleLength ?? 28;
      const nextPeriodLength = settingResult.settings?.averagePeriodLength ?? 5;
      setCycleLength(nextCycleLength);
      setPeriodLength(nextPeriodLength);
      setCycleLengthDraft(nextCycleLength);
      setPeriodLengthDraft(nextPeriodLength);
      setLoadState(entryResult.entries.length === 0 ? 'empty' : 'ready');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Failed to load private cycle data:', error);
      setLoadState('error');
    }
  }, [captureIdentity, consentGranted, isCurrentIdentity, userId]);

  const load = useCallback((): Promise<void> => {
    const key = userId || '';
    const active = loadCoordinatorRef.current;
    if (active?.key === key) {
      active.queued = true;
      return active.promise;
    }

    const coordinator = {
      key,
      queued: false,
      promise: Promise.resolve(),
    };
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
  }, [performLoad, userId]);

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

  const cells = useMemo(
    () => buildMonthCalendarCells(viewYear, viewMonth),
    [viewMonth, viewYear],
  );
  const selectedMatches = useMemo(
    () => cycleRangesOnDate(entries, selectedDate),
    [entries, selectedDate],
  );
  const expectedStartDate = useMemo(
    () => calculateExpectedStartDate(entries, cycleLength),
    [cycleLength, entries],
  );

  const moveMonth = (amount: number) => {
    const next = shiftCalendarMonth(viewYear, viewMonth, amount);
    setViewYear(next.year);
    setViewMonth(next.month);
  };

  const openCreate = (date = selectedDate) => {
    setEditingId(null);
    setDraft(emptyDraft(date));
    setFormError(null);
    setFormOpen(true);
  };

  const prediction = useMemo(
    () => predictCycle({
      periods: entries.map((e) => ({ startDate: e.startDate, endDate: e.endDate })),
      configuredCycleLength: cycleLength,
      configuredPeriodLength: periodLength,
      today,
    }),
    [entries, cycleLength, periodLength, today],
  );

  const handleRevokeConsent = async () => {
    if (!userId) return;
    await revokeConsentInDB(userId);
    setConsentGranted(false);
    setConsentChecked(false);
    toast.info('민감정보 동의를 철회했어요.');
  };
  // Active ongoing period entry (started on/before today and has no endDate or endDate >= today)
  const activePeriodEntry = useMemo(
    () => entries.find((e) => e.startDate <= today && (!e.endDate || e.endDate >= today)),
    [entries, today],
  );

  const activePeriodDayNumber = useMemo(() => {
    if (!activePeriodEntry) return null;
    return getDaysDifference(activePeriodEntry.startDate, today) + 1;
  }, [activePeriodEntry, today]);

  // 1-Tap Quick Action: Start period today or End period today
  const handleQuickTogglePeriod = async () => {
    const identity = captureIdentity();
    if (!identity.userId || quickActionPending) return;
    setQuickActionPending(true);
    setFormError(null);
    try {
      if (activePeriodEntry) {
        // End active period today
        const result = await updateCycleEntryInDB(activePeriodEntry.id, {
          startDate: activePeriodEntry.startDate,
          endDate: today,
          notes: activePeriodEntry.notes,
          symptoms: activePeriodEntry.symptoms,
        });
        if (!isCurrentIdentity(identity)) return;
        if (!result.ok) {
          toast.error(serverErrorMessage(result.reason));
          return;
        }
        const saved = result.entry;
        setEntries((current) => current.map((e) => (e.id === saved.id ? saved : e)));
        toast.success('오늘 생리 종료일을 기록했어요! ✨');
      } else {
        // Start new period today
        const result = await saveCycleEntryToDB(today, undefined, '', []);
        if (!isCurrentIdentity(identity)) return;
        if (!result.ok) {
          toast.error(serverErrorMessage(result.reason));
          return;
        }
        const saved = result.entry;
        setEntries((current) => [
          saved,
          ...current.filter((item) => item.id !== saved.id),
        ].sort((a, b) => b.startDate.localeCompare(a.startDate)));
        setLoadState('ready');
        toast.success('오늘 생리 시작일을 기록했어요! 🌸');
      }
    } catch (err) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Quick toggle period failed:', err);
      toast.error(classifyServerError(err).message);
    } finally {
      if (isCurrentIdentity(identity)) setQuickActionPending(false);
    }
  };

  // 1-Tap Quick Symptom Toggle for selected date or today
  const handleQuickToggleSymptom = async (symptom: CycleSymptom) => {
    const identity = captureIdentity();
    if (!identity.userId || quickActionPending) return;
    const targetDate = selectedDate || today;
    const existingEntry = entries.find((e) => cycleEntryOccursOnDate(e, targetDate));

    setQuickActionPending(true);
    try {
      if (existingEntry) {
        const nextSymptoms = existingEntry.symptoms.includes(symptom)
          ? existingEntry.symptoms.filter((s) => s !== symptom)
          : [...existingEntry.symptoms, symptom];
        const result = await updateCycleEntryInDB(existingEntry.id, {
          startDate: existingEntry.startDate,
          endDate: existingEntry.endDate,
          notes: existingEntry.notes,
          symptoms: nextSymptoms,
        });
        if (!isCurrentIdentity(identity)) return;
        if (!result.ok) {
          toast.error(serverErrorMessage(result.reason));
          return;
        }
        setEntries((current) => current.map((e) => (e.id === result.entry.id ? result.entry : e)));
        toast.success('오늘의 컨디션을 업데이트했어요! 💊');
      } else {
        const result = await saveCycleEntryToDB(targetDate, undefined, '', [symptom]);
        if (!isCurrentIdentity(identity)) return;
        if (!result.ok) {
          toast.error(serverErrorMessage(result.reason));
          return;
        }
        setEntries((current) => [result.entry, ...current].sort((a, b) => b.startDate.localeCompare(a.startDate)));
        setLoadState('ready');
        toast.success('오늘의 컨디션을 기록했어요! 💊');
      }
    } catch (err) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Quick symptom toggle failed:', err);
      toast.error(classifyServerError(err).message);
    } finally {
      if (isCurrentIdentity(identity)) setQuickActionPending(false);
    }
  };

  const openEdit = (entry: CycleEntry) => {
    setEditingId(entry.id);
    setDraft({
      startDate: entry.startDate,
      endDate: entry.endDate,
      notes: entry.notes || '',
      symptoms: [...entry.symptoms],
    });
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (formPending) return;
    setFormOpen(false);
    setEditingId(null);
    setFormError(null);
  };

  const toggleSymptom = (symptom: CycleSymptom) => {
    setDraft((current) => ({
      ...current,
      symptoms: current.symptoms.includes(symptom)
        ? current.symptoms.filter((value) => value !== symptom)
        : [...current.symptoms, symptom],
    }));
  };

  const saveEntry = async () => {
    const error = validateCycleEntryDraft(draft);
    if (error) {
      setFormError(error);
      return;
    }
    const identity = captureIdentity();
    if (!identity.userId) return;
    setFormPending(true);
    setFormError(null);
    try {
      const result = editingId
        ? await updateCycleEntryInDB(editingId, draft)
        : await saveCycleEntryToDB(draft.startDate, draft.endDate, draft.notes, draft.symptoms);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        // The cause decides the copy. A `forbidden` result is a permission
        // problem, so it must never be reported as a connection problem.
        setFormError(serverErrorMessage(result.reason));
        return;
      }
      const saved = result.entry;
      setEntries((current) => [
        saved,
        ...current.filter((entry) => entry.id !== saved.id),
      ].sort((a, b) => b.startDate.localeCompare(a.startDate)));
      setSelectedDate(saved.startDate);
      setLoadState('ready');
      setFormOpen(false);
      setEditingId(null);
      toast.success(editingId ? '개인 기록을 수정했어요.' : '개인 기록을 저장했어요.');
    } catch (saveError) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Failed to save private cycle entry:', saveError);
      setFormError(classifyServerError(saveError).message);
    } finally {
      if (isCurrentIdentity(identity)) setFormPending(false);
    }
  };

  const deleteEntry = async (entry: CycleEntry) => {
    const identity = captureIdentity();
    if (!identity.userId) return;
    setDeletePendingId(entry.id);
    setFormError(null);
    try {
      const result = await deleteCycleEntryFromDB(entry.id);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        setFormError(serverErrorMessage(result.reason));
        return;
      }
      setEntries((current) => {
        const next = current.filter((item) => item.id !== entry.id);
        setLoadState(next.length === 0 ? 'empty' : 'ready');
        return next;
      });
      if (editingId === entry.id) {
        setFormOpen(false);
        setEditingId(null);
      }
      toast.info('개인 기록을 삭제했어요.');
    } catch (deleteError) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Failed to delete private cycle entry:', deleteError);
      setFormError(classifyServerError(deleteError).message);
    } finally {
      if (isCurrentIdentity(identity)) setDeletePendingId(null);
    }
  };

  const saveSettings = async () => {
    const error = validateCycleSettings(cycleLengthDraft, periodLengthDraft);
    if (error) {
      setSettingsError(error);
      return;
    }
    const identity = captureIdentity();
    if (!identity.userId) return;
    setSettingsPending(true);
    setSettingsError(null);
    try {
      const result = await saveCycleSettingsToDB(cycleLengthDraft, periodLengthDraft);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        setSettingsError(serverErrorMessage(result.reason));
        return;
      }
      const saved = result.settings;
      setCycleLength(saved.averageCycleLength);
      setPeriodLength(saved.averagePeriodLength);
      setCycleLengthDraft(saved.averageCycleLength);
      setPeriodLengthDraft(saved.averagePeriodLength);
      toast.success('평균 길이 설정을 저장했어요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Failed to save private cycle settings:', error);
      setSettingsError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setSettingsPending(false);
    }
  };

  const acceptSensitiveConsent = () => {
    if (!userId || !consentChecked) return;
    if (!grantCycleSensitiveConsent(userId)) {
      setConsentError('동의 상태를 안전하게 저장하지 못했어요. 브라우저 저장공간을 확인해 주세요.');
      return;
    }
    setConsentError(null);
    setConsentGranted(true);
  };

  if (userId && !consentGranted) {
    return (
      <section className="bg-card rounded-surface p-4 border border-border space-y-4" aria-labelledby="cycle-consent-title">
        <div className="flex items-center gap-2 border-b border-border/40 pb-3">
          <HeartPulse className="w-5 h-5 text-coral" aria-hidden="true" />
          <h3 id="cycle-consent-title" className="text-heading text-foreground">내 몸의 리듬 시작하기</h3>
        </div>
        <div className="rounded-control border border-coral/30 bg-coral/5 p-3 space-y-2 text-caption text-muted-foreground leading-relaxed">
          <p><strong className="text-foreground">수집 항목:</strong> 주기 시작·종료일, 증상, 메모, 평균 주기·기간</p>
          <p><strong className="text-foreground">이용 목적:</strong> 본인 전용 주기 기록과 예상일 표시</p>
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
        <Button variant="primary" size="md" full disabled={!consentChecked} onClick={acceptSensitiveConsent}>
          동의하고 시작하기
        </Button>
        <a href="/legal/privacy" className="flex min-h-11 items-center justify-center text-caption font-medium text-info underline underline-offset-2">
          개인정보 처리방침 보기
        </a>
      </section>
    );
  }

  return (
    <section className="bg-card rounded-surface p-4 border border-border space-y-4">
      <div className="flex items-center justify-between border-b border-border/40 pb-3 gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-coral" />
          <h3 className="text-heading text-foreground">내 몸의 리듬</h3>
        </div>
        <span className="text-caption text-coral-strong font-bold bg-coral/10 px-2.5 py-1 rounded-full whitespace-nowrap">
          <Lock className="w-3 h-3 inline mr-1" />나만 보기
        </span>
      </div>

      <div className="bg-lilac/30 border border-lilac/60 p-3.5 rounded-surface text-center">
        <p className="text-caption text-muted-foreground leading-relaxed">
          시작일·종료일·증상·메모는 파트너에게 공유되지 않아요.
        </p>
      </div>

      {loadState === 'loading' && (
        <div className="py-6 flex items-center justify-center gap-2 text-caption text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> 개인 기록을 불러오는 중이에요.
        </div>
      )}

      {(loadState === 'unauthenticated' || loadState === 'forbidden' || loadState === 'error') && (
        <div className="p-4 rounded-surface bg-muted/40 border border-border text-center space-y-3" role="alert">
          <p className="text-caption text-muted-foreground">{failureMessage(loadState)}</p>
          {loadState === 'error' && (
            <button type="button" onClick={() => void load()} className="px-4 py-2 rounded-control bg-foreground text-background text-label font-bold">
              다시 시도
            </button>
          )}
        </div>
      )}

     {(loadState === 'ready' || loadState === 'empty') && (
       <>
          {/* 1-Tap Hero Card */}
          <div className="p-4 rounded-surface bg-gradient-to-br from-coral/15 via-coral/5 to-coral/10 border border-coral/30 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                {activePeriodEntry ? (
                  <div className="flex items-center gap-1.5 text-coral-strong font-bold text-label">
                    <span className="animate-pulse">🌸</span>
                    <span>생리 {activePeriodDayNumber}일째 진행 중</span>
                  </div>
                ) : expectedStartDate ? (
                  <div className="flex items-center gap-1.5 text-coral-strong font-bold text-label">
                    <Sparkles className="w-4 h-4 text-coral" />
                    <span>다음 예상: {expectedStartDate} ({formatDDayText(expectedStartDate, today)})</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-coral-strong font-bold text-label">
                    <span>🌷 생리 주기를 간편하게 관리해요</span>
                  </div>
                )}
                <p className="text-caption text-muted-foreground mt-0.5">
                  {activePeriodEntry
                    ? `${activePeriodEntry.startDate}에 시작된 생리가 진행 중이에요.`
                    : expectedStartDate
                    ? `평균 주기 ${cycleLength}일 기준으로 계산한 예상일이에요.`
                    : '버튼 한 번으로 오늘 생리 시작을 기록해 보세요.'}
                </p>
              </div>
            </div>

            {/* 1-Tap Quick Action Button */}
            <button
              type="button"
              onClick={() => void handleQuickTogglePeriod()}
              disabled={quickActionPending}
              className={cn(
                'w-full py-3 px-4 rounded-full text-label font-bold transition flex items-center justify-center gap-2 shadow-xs min-h-11 active:scale-98',
                activePeriodEntry
                  ? 'bg-card border-2 border-coral text-coral hover:bg-coral/10'
                  : 'bg-coral-strong text-coral-strong-foreground hover:opacity-95',
              )}
            >
              {quickActionPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : activePeriodEntry ? (
                <>
                  <Check className="w-4 h-4" /> 오늘 생리 끝났어요 ✨
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" /> 오늘 생리 시작했어요 🌸
                </>
              )}
            </button>
          </div>

          {/* 1-Tap Quick Symptom Chips */}
          {(() => {
            const selectedDateEntry = entries.find((e) => cycleEntryOccursOnDate(e, selectedDate));
            const currentSymptoms = selectedDateEntry?.symptoms || [];
            return (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-caption font-bold text-foreground">
                    {selectedDate === today ? '오늘의 컨디션 선택' : `${selectedDate} 컨디션 선택`}
                  </span>
                  <span className="text-caption text-muted-foreground">터치해서 쉬운 기록</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CYCLE_SYMPTOMS.map((symptom) => {
                    const isChecked = currentSymptoms.includes(symptom);
                    return (
                      <button
                        type="button"
                        key={symptom}
                        onClick={() => void handleQuickToggleSymptom(symptom)}
                        disabled={quickActionPending}
                        className={cn(
                          'px-3 py-2 rounded-full text-caption font-medium transition border flex items-center gap-1.5 min-h-11 active:scale-95',
                          isChecked
                            ? 'bg-coral/20 border-coral text-coral-strong font-bold'
                            : 'bg-card border-border text-foreground hover:bg-muted',
                        )}
                      >
                        <span>{symptomIcons[symptom]}</span>
                        <span>{symptomLabels[symptom]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between px-1">
              <button type="button" onClick={() => moveMonth(-1)} className="p-2 rounded-control hover:bg-muted min-h-11 min-w-11" aria-label="이전 달">
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>
              <span className="text-label font-bold text-foreground">{viewYear}년 {viewMonth + 1}월</span>
              <button type="button" onClick={() => moveMonth(1)} className="p-2 rounded-control hover:bg-muted min-h-11 min-w-11" aria-label="다음 달">
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-caption font-bold text-muted-foreground gap-0.5">
              <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
            </div>
            {/*
              `gap-0.5` (2px), not `gap-1`, and the reason is arithmetic rather than
              taste: the grid is 324px wide inside this card, so seven cells with a
              4px gap resolve to 42.9px and miss the 44px tap target by a pixel.
              At 2px they resolve to 44.6px.

              Widening the card or shrinking the calendar were the alternatives; both
              cost more than 2px of gutter, and a day cell is the most-tapped control
              on this screen.
            */}
            <div className="grid grid-cols-7 text-center text-label gap-0.5 font-medium">
              {cells.map((cell, index) => {
                if (!cell.date || !cell.day) return <span key={`blank-${index}`} aria-hidden="true" className="min-h-11" />;
                const ranges = cycleRangesOnDate(entries, cell.date);
                const hasRange = ranges.length > 0;
                const hasStart = ranges.some((range) => range.isStart);
                const selected = selectedDate === cell.date;
                return (
                  <button
                    type="button"
                    key={cell.date}
                    onClick={() => setSelectedDate(cell.date as string)}
                    className={cn(
                      'py-1.5 rounded-control transition flex flex-col items-center justify-center min-h-11 border',
                      hasRange ? 'bg-coral/15 border-coral/30 text-coral-strong font-bold' : 'border-transparent text-foreground hover:bg-muted',
                      cell.date === today && !hasRange && 'ring-1 ring-coral text-coral font-bold',
                      selected && 'ring-2 ring-navy ring-offset-1',
                    )}
                    aria-label={`${cell.date}${hasRange ? ', 기간 기록 있음' : ''}`}
                  >
                    <span>{cell.day}</span>
                    {hasRange && <span className="text-caption leading-none mt-0.5">{hasStart ? '시작' : '기간'}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-surface border border-border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-label font-bold text-foreground">{selectedDate}</p>
                <p className="text-caption text-muted-foreground">선택한 날의 개인 기록</p>
              </div>
              <button type="button" onClick={() => openCreate()} className="flex items-center gap-1 px-3 py-2 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold min-h-11">
                <Plus className="w-3.5 h-3.5" /> 기록 추가
              </button>
            </div>
            {selectedMatches.length === 0 ? (
              <p className="text-caption text-muted-foreground text-center py-2">이 날에 해당하는 기록이 없어요.</p>
            ) : selectedMatches.map(({ entry }) => (
              <div key={entry.id} className="bg-card border border-border rounded-control p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-label font-bold text-foreground">{formatRange(entry)}</p>
                    {entry.symptoms.length > 0 && (
                      <p className="text-caption text-muted-foreground mt-1">{entry.symptoms.map((item) => symptomLabels[item]).join(' · ')}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => openEdit(entry)} className="p-2 rounded-lg text-coral hover:bg-coral/10" aria-label="기록 수정">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                {entry.notes && <p className="text-body text-foreground whitespace-pre-wrap break-keep">{entry.notes}</p>}
              </div>
            ))}
          </div>

          {loadState === 'empty' && (
            <div className="p-4 rounded-surface border border-dashed border-border text-center space-y-1">
              <CalendarDays className="w-5 h-5 text-muted-foreground mx-auto" />
              <p className="text-label font-bold text-foreground">아직 저장한 기록이 없어요.</p>
              <p className="text-caption text-muted-foreground">날짜를 선택하고 첫 기록을 추가해 보세요.</p>
            </div>
          )}

          {formOpen && (
            <div className="rounded-surface border border-coral/30 bg-coral/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-heading text-foreground">{editingId ? '개인 기록 수정' : '개인 기록 추가'}</h4>
                <button type="button" onClick={closeForm} disabled={formPending} className="text-caption text-muted-foreground">닫기</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-label font-bold text-foreground space-y-1">
                  <span>시작일 *</span>
                  <input type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} className="w-full p-2.5 rounded-control border border-border bg-card text-body" disabled={formPending} />
                </label>
                <label className="text-label font-bold text-foreground space-y-1">
                  <span>종료일 (선택)</span>
                  <input type="date" value={draft.endDate || ''} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value || undefined }))} min={draft.startDate} className="w-full p-2.5 rounded-control border border-border bg-card text-body" disabled={formPending} />
                </label>
              </div>
              <fieldset className="space-y-2" disabled={formPending}>
                <legend className="text-label font-bold text-foreground">증상 (선택)</legend>
                <div className="grid grid-cols-2 gap-2">
                  {CYCLE_SYMPTOMS.map((symptom) => (
                    <label key={symptom} className="flex items-center gap-2 p-2 rounded-control bg-card border border-border text-label text-foreground">
                      <input type="checkbox" checked={draft.symptoms.includes(symptom)} onChange={() => toggleSymptom(symptom)} />
                      {symptomLabels[symptom]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Detailed Health Fields (+ 더 기록하기) */}
              <div className="pt-2 border-t border-border/40 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowMoreForm((prev) => !prev)}
                  className="text-caption font-bold text-coral flex items-center gap-1 min-h-11"
                >
                  {showMoreForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>{showMoreForm ? '간단히 보기' : '+ 출혈량/통증/기분 더 기록하기'}</span>
                </button>

                {showMoreForm && (
                  <div className="space-y-3 pt-1 animate-in fade-in-50">
                    <div className="space-y-1">
                      <span className="text-caption font-bold text-foreground">출혈량 (선택)</span>
                      <div className="grid grid-cols-4 gap-1">
                        {(['spotting', 'light', 'medium', 'heavy'] as const).map((f) => (
                          <button
                            type="button"
                            key={f}
                            onClick={() => setDraft((current) => ({ ...current, flow: current.flow === f ? undefined : f }))}
                            className={cn(
                              'p-2 text-caption rounded-control border text-center transition min-h-11',
                              draft.flow === f ? 'bg-coral/20 border-coral font-bold text-coral-strong' : 'bg-card border-border text-foreground hover:bg-muted',
                            )}
                          >
                            {f === 'spotting' ? '점상' : f === 'light' ? '적음' : f === 'medium' ? '보통' : '많음'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-caption font-bold text-foreground">통증 (선택)</span>
                      <div className="grid grid-cols-4 gap-1">
                        {(['none', 'mild', 'moderate', 'severe'] as const).map((p) => (
                          <button
                            type="button"
                            key={p}
                            onClick={() => setDraft((current) => ({ ...current, painLevel: current.painLevel === p ? undefined : p }))}
                            className={cn(
                              'p-2 text-caption rounded-control border text-center transition min-h-11',
                              draft.painLevel === p ? 'bg-coral/20 border-coral font-bold text-coral-strong' : 'bg-card border-border text-foreground hover:bg-muted',
                            )}
                          >
                            {p === 'none' ? '없음' : p === 'mild' ? '약함' : p === 'moderate' ? '보통' : '심함'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-caption font-bold text-foreground">기분 (선택)</span>
                      <div className="grid grid-cols-5 gap-1">
                        {(['calm', 'sensitive', 'sad', 'tired', 'good'] as const).map((m) => (
                          <button
                            type="button"
                            key={m}
                            onClick={() => setDraft((current) => ({ ...current, mood: current.mood === m ? undefined : m }))}
                            className={cn(
                              'p-1.5 text-caption rounded-control border text-center transition min-h-11',
                              draft.mood === m ? 'bg-coral/20 border-coral font-bold text-coral-strong' : 'bg-card border-border text-foreground hover:bg-muted',
                            )}
                          >
                            {m === 'calm' ? '편안' : m === 'sensitive' ? '예민' : m === 'sad' ? '울적' : m === 'tired' ? '피곤' : '괜찮'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <label className="text-label font-bold text-foreground space-y-1 block">
                <span>메모 (선택)</span>
                <textarea value={draft.notes || ''} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} className="w-full p-3 rounded-control border border-border bg-card text-body resize-none" disabled={formPending} />
              </label>
              {formError && <p className="text-caption text-destructive" role="alert">{formError}</p>}
              <div className="flex gap-2">
                {editingId && (
                  <button type="button" onClick={() => {
                    const entry = entries.find((item) => item.id === editingId);
                    if (entry) void deleteEntry(entry);
                  }} disabled={formPending || deletePendingId === editingId} className="px-3 py-2.5 rounded-control border border-destructive/30 text-destructive text-label font-bold disabled:opacity-50 min-h-11">
                    {deletePendingId === editingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
                <button type="button" onClick={() => void saveEntry()} disabled={formPending || deletePendingId !== null} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold disabled:opacity-50 min-h-11">
                  {formPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {formPending ? '저장 중' : '저장'}
                </button>
              </div>
            </div>
          )}

         {/* Average Length Settings Section (Clean Collapsible) */}
         <div className="rounded-surface border border-border bg-card overflow-hidden transition">
           <button
             type="button"
             onClick={() => setInsightsOpen((prev) => !prev)}
             className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 min-h-11 transition"
           >
             <div>
               <h4 className="text-heading text-foreground font-bold">최근 주기 경향 보기</h4>
               <p className="text-caption text-muted-foreground mt-0.5">
                 {prediction.status === 'personalized'
                   ? `평균 ${prediction.medianCycleLength || cycleLength}일 주기 · 범위 ±${prediction.variabilityDays || 2}일`
                   : '기록이 모이면 내 주기 패턴을 분석해드려요.'}
               </p>
             </div>
             <div className="p-1 text-muted-foreground">
               {insightsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
             </div>
           </button>

           {insightsOpen && (
             <div className="p-4 pt-0 border-t border-border/40 space-y-2 text-caption text-muted-foreground leading-relaxed animate-in fade-in-50">
               <div className="grid grid-cols-2 gap-2 pt-3">
                 <div className="p-2.5 rounded-control bg-muted/20 border border-border/60">
                   <span className="block text-caption font-bold text-foreground">평균 주기</span>
                   <span className="text-label font-bold text-coral-strong">{prediction.medianCycleLength || cycleLength}일</span>
                 </div>
                 <div className="p-2.5 rounded-control bg-muted/20 border border-border/60">
                   <span className="block text-caption font-bold text-foreground">평균 생리 기간</span>
                   <span className="text-label font-bold text-coral-strong">{periodLength}일</span>
                 </div>
               </div>
               <p className="pt-1 text-caption text-muted-foreground">
                 최근 {prediction.cyclesUsed}회의 기록을 바탕으로 분석된 통계이며, 의료적 진단이나 결론을 의미하지 않아요.
               </p>
             </div>
           )}
         </div>

          <div className="rounded-surface border border-border bg-card overflow-hidden transition">
           <button
             type="button"
             onClick={() => setSettingsOpen((prev) => !prev)}
             className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 min-h-11 transition"
           >
             <div>
               <h4 className="text-heading text-foreground">평균 주기 설정</h4>
               <p className="text-caption text-muted-foreground mt-0.5">저장된 평균 기간: {periodLength}일</p>
             </div>
             <div className="p-1 text-muted-foreground">
               {settingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
             </div>
           </button>

            {settingsOpen && (
              <div className="p-4 pt-0 border-t border-border/40 space-y-3 animate-in fade-in-50">
                <div className="grid grid-cols-2 gap-2 pt-3">
                  <label className="text-label font-bold text-foreground space-y-1">
                    <span>평균 주기 길이</span>
                    <input type="number" min={CYCLE_LENGTH_MIN} max={CYCLE_LENGTH_MAX} value={cycleLengthDraft} onChange={(event) => setCycleLengthDraft(Number(event.target.value))} className="w-full p-2.5 rounded-control border border-border bg-card text-body" disabled={settingsPending} />
                  </label>
                  <label className="text-label font-bold text-foreground space-y-1">
                    <span>평균 기간</span>
                    <input type="number" min={PERIOD_LENGTH_MIN} max={PERIOD_LENGTH_MAX} value={periodLengthDraft} onChange={(event) => setPeriodLengthDraft(Number(event.target.value))} className="w-full p-2.5 rounded-control border border-border bg-card text-body" disabled={settingsPending} />
                  </label>
                </div>
                <p className="text-caption text-muted-foreground">주기 {CYCLE_LENGTH_MIN}~{CYCLE_LENGTH_MAX}일 · 기간 {PERIOD_LENGTH_MIN}~{PERIOD_LENGTH_MAX}일</p>
                {settingsError && <p className="text-caption text-destructive" role="alert">{settingsError}</p>}
                <button type="button" onClick={() => void saveSettings()} disabled={settingsPending} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-control bg-foreground text-background text-label font-bold disabled:opacity-50 min-h-11">
                  {settingsPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {settingsPending ? '설정 저장 중' : '평균 길이 저장'}
                </button>

                {/* Partner Sharing Preferences & Preview */}
                <div className="pt-3 border-t border-border/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-label font-bold text-foreground">파트너 배려 공유 설정</h5>
                    <button
                      type="button"
                      onClick={() => setShowPartnerPreview(true)}
                      className="text-caption text-coral font-bold flex items-center gap-1 min-h-11 p-1"
                    >
                      <Eye className="w-3.5 h-3.5" /> 상대에게 어떻게 보이나요?
                    </button>
                  </div>

                  <label className="flex items-center justify-between p-2.5 rounded-control bg-muted/20 border border-border/60 text-caption font-bold text-foreground min-h-11">
                    <span>생리 진행 상태 공유 (기본 OFF)</span>
                    <input
                      type="checkbox"
                      checked={shareCurrentPeriod}
                      onChange={(e) => setShareCurrentPeriod(e.target.checked)}
                      className="accent-coral"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-control bg-muted/20 border border-border/60 text-caption font-bold text-foreground min-h-11">
                    <span>다음 예상 기간 공유 (기본 OFF)</span>
                    <input
                      type="checkbox"
                      checked={sharePredictionWindow}
                      onChange={(e) => setSharePredictionWindow(e.target.checked)}
                      className="accent-coral"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-control bg-muted/20 border border-border/60 text-caption font-bold text-foreground min-h-11">
                    <span>가임/배란 예상 기간 공유 (기본 OFF)</span>
                    <input
                      type="checkbox"
                      checked={shareFertilityWindow}
                      onChange={(e) => setShareFertilityWindow(e.target.checked)}
                      className="accent-coral"
                    />
                  </label>
                </div>

                {/* Sensitive Consent Revoke Option */}
                <div className="pt-3 border-t border-border/40 flex items-center justify-between">
                  <span className="text-caption text-muted-foreground">민감정보 동의 관리</span>
                  <button
                    type="button"
                    onClick={() => void handleRevokeConsent()}
                    className="text-caption text-destructive underline min-h-11 p-1"
                  >
                    민감정보 동의 철회
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Partner Preview Modal */}
          {showPartnerPreview && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <div className="bg-card w-full max-w-sm rounded-surface border border-border p-4 space-y-3 animate-in fade-in-50">
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <h4 className="text-heading text-foreground font-bold">군화에게 이렇게 보여요</h4>
                  <button type="button" onClick={() => setShowPartnerPreview(false)} className="text-caption text-muted-foreground p-1 min-h-11">
                    닫기
                  </button>
                </div>
                <div className="p-3.5 rounded-surface bg-mint/40 border border-mint-foreground/20 text-caption text-mint-foreground space-y-1.5 leading-relaxed">
                  <p className="font-bold">🌷 이번 주 컨디션 참고</p>
                  <p>생리 예상 기간이 가까워졌다고 공유했어요.</p>
                  <p className="text-muted-foreground text-caption">정확한 날짜가 아닐 수 있으니 평소처럼 편하게 안부를 물어봐 주세요.</p>
                </div>
                <div className="rounded-control bg-coral/5 border border-coral/20 p-2.5 text-caption text-muted-foreground">
                  🔒 <strong>안심하세요:</strong> 상세 증상, 메모, 통증, 출혈량 등 원본 기록은 파트너에게 절대 노출되지 않아요.
                </div>
                <Button variant="secondary" size="md" full onClick={() => setShowPartnerPreview(false)}>
                  확인
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
