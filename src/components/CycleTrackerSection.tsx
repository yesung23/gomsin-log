import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  buildMonthCalendarCells,
  calculateExpectedStartDate,
  CYCLE_LENGTH_MAX,
  CYCLE_LENGTH_MIN,
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
  const [entries, setEntries] = useState<CycleEntry[]>([]);
  const [cycleLength, setCycleLength] = useState(28);
  const [periodLength, setPeriodLength] = useState(5);
  const [cycleLengthDraft, setCycleLengthDraft] = useState(28);
  const [periodLengthDraft, setPeriodLengthDraft] = useState(5);
  const [settingsPending, setSettingsPending] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CycleEntryDraft>(emptyDraft(today));
  const [formPending, setFormPending] = useState(false);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const loadCoordinatorRef = useRef<{
    key: string;
    queued: boolean;
    promise: Promise<void>;
  } | null>(null);

  useLayoutEffect(() => {
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
    if (!userId) return;
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
  }, [captureIdentity, isCurrentIdentity, userId]);

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

  return (
    <section className="bg-card rounded-3xl p-5 border border-border shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border/40 pb-3 gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-coral" />
          <h3 className="text-heading text-foreground">내 몸의 리듬</h3>
        </div>
        <span className="text-caption text-coral-strong font-bold bg-coral/10 px-2.5 py-1 rounded-full whitespace-nowrap">
          <Lock className="w-3 h-3 inline mr-1" />나만 보기
        </span>
      </div>

      <div className="bg-lilac/30 border border-lilac/60 p-3.5 rounded-2xl text-center">
        <p className="text-caption text-muted-foreground leading-relaxed">
          시작일·종료일·증상·메모는 파트너에게 공유되지 않아요.
        </p>
      </div>

      {loadState === 'loading' && (
        <div className="py-10 flex items-center justify-center gap-2 text-caption text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> 개인 기록을 불러오는 중이에요.
        </div>
      )}

      {(loadState === 'unauthenticated' || loadState === 'forbidden' || loadState === 'error') && (
        <div className="p-4 rounded-2xl bg-muted/40 border border-border text-center space-y-3" role="alert">
          <p className="text-caption text-muted-foreground">{failureMessage(loadState)}</p>
          {loadState === 'error' && (
            <button type="button" onClick={() => void load()} className="px-4 py-2 rounded-xl bg-foreground text-background text-label font-bold">
              다시 시도
            </button>
          )}
        </div>
      )}

      {(loadState === 'ready' || loadState === 'empty') && (
        <>
          {expectedStartDate ? (
            <div className="p-4 rounded-2xl bg-coral/10 border border-coral/20 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption text-coral-strong font-bold">다음 예상 시작일</span>
                <span className="text-label font-bold text-foreground">{expectedStartDate}</span>
              </div>
              <p className="text-caption text-muted-foreground">
                최근 시작일 + 평균 {cycleLength}일로 계산한 단순 예상이며, 의료 조언이 아니에요.
              </p>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 text-caption text-muted-foreground text-center">
              시작일 기록이 생기면 다음 예상 시작일을 표시해요.
            </div>
          )}

          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between px-1">
              <button type="button" onClick={() => moveMonth(-1)} className="p-2 rounded-xl hover:bg-muted min-h-[40px] min-w-[40px]" aria-label="이전 달">
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>
              <span className="text-label font-bold text-foreground">{viewYear}년 {viewMonth + 1}월</span>
              <button type="button" onClick={() => moveMonth(1)} className="p-2 rounded-xl hover:bg-muted min-h-[40px] min-w-[40px]" aria-label="다음 달">
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-caption font-bold text-muted-foreground gap-1">
              <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
            </div>
            <div className="grid grid-cols-7 text-center text-label gap-1 font-medium">
              {cells.map((cell, index) => {
                if (!cell.date || !cell.day) return <span key={`blank-${index}`} aria-hidden="true" className="min-h-[42px]" />;
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
                      'py-1.5 rounded-xl transition flex flex-col items-center justify-center min-h-[42px] border',
                      hasRange ? 'bg-rose-100 border-rose-200 text-rose-800 font-bold' : 'border-transparent text-foreground hover:bg-muted',
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

          <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-label font-bold text-foreground">{selectedDate}</p>
                <p className="text-caption text-muted-foreground">선택한 날의 개인 기록</p>
              </div>
              <button type="button" onClick={() => openCreate()} className="flex items-center gap-1 px-3 py-2 rounded-xl bg-coral-strong text-coral-strong-foreground text-label font-bold min-h-[40px]">
                <Plus className="w-3.5 h-3.5" /> 기록 추가
              </button>
            </div>
            {selectedMatches.length === 0 ? (
              <p className="text-caption text-muted-foreground text-center py-2">이 날에 해당하는 기록이 없어요.</p>
            ) : selectedMatches.map(({ entry }) => (
              <div key={entry.id} className="bg-card border border-border rounded-xl p-3 space-y-2">
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
            <div className="p-4 rounded-2xl border border-dashed border-border text-center space-y-1">
              <CalendarDays className="w-5 h-5 text-muted-foreground mx-auto" />
              <p className="text-label font-bold text-foreground">아직 저장한 기록이 없어요.</p>
              <p className="text-caption text-muted-foreground">날짜를 선택하고 첫 기록을 추가해 보세요.</p>
            </div>
          )}

          {formOpen && (
            <div className="rounded-2xl border border-coral/30 bg-coral/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-heading text-foreground">{editingId ? '개인 기록 수정' : '개인 기록 추가'}</h4>
                <button type="button" onClick={closeForm} disabled={formPending} className="text-caption text-muted-foreground">닫기</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-label font-bold text-foreground space-y-1">
                  <span>시작일 *</span>
                  <input type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} className="w-full p-2.5 rounded-xl border border-border bg-card text-body" disabled={formPending} />
                </label>
                <label className="text-label font-bold text-foreground space-y-1">
                  <span>종료일 (선택)</span>
                  <input type="date" value={draft.endDate || ''} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value || undefined }))} min={draft.startDate} className="w-full p-2.5 rounded-xl border border-border bg-card text-body" disabled={formPending} />
                </label>
              </div>
              <fieldset className="space-y-2" disabled={formPending}>
                <legend className="text-label font-bold text-foreground">증상 (선택)</legend>
                <div className="grid grid-cols-2 gap-2">
                  {CYCLE_SYMPTOMS.map((symptom) => (
                    <label key={symptom} className="flex items-center gap-2 p-2 rounded-xl bg-card border border-border text-label text-foreground">
                      <input type="checkbox" checked={draft.symptoms.includes(symptom)} onChange={() => toggleSymptom(symptom)} />
                      {symptomLabels[symptom]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="text-label font-bold text-foreground space-y-1 block">
                <span>메모 (선택)</span>
                <textarea value={draft.notes || ''} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} className="w-full p-3 rounded-xl border border-border bg-card text-body resize-none" disabled={formPending} />
              </label>
              {formError && <p className="text-caption text-destructive" role="alert">{formError}</p>}
              <div className="flex gap-2">
                {editingId && (
                  <button type="button" onClick={() => {
                    const entry = entries.find((item) => item.id === editingId);
                    if (entry) void deleteEntry(entry);
                  }} disabled={formPending || deletePendingId === editingId} className="px-3 py-2.5 rounded-xl border border-destructive/30 text-destructive text-label font-bold disabled:opacity-50 min-h-[42px]">
                    {deletePendingId === editingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
                <button type="button" onClick={() => void saveEntry()} disabled={formPending || deletePendingId !== null} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-coral-strong text-coral-strong-foreground text-label font-bold disabled:opacity-50 min-h-[42px]">
                  {formPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {formPending ? '저장 중' : '저장'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border p-4 space-y-3">
            <div>
              <h4 className="text-heading text-foreground">평균 길이 설정</h4>
              <p className="text-caption text-muted-foreground mt-0.5">저장된 평균 기간: {periodLength}일</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-label font-bold text-foreground space-y-1">
                <span>평균 주기 길이</span>
                <input type="number" min={CYCLE_LENGTH_MIN} max={CYCLE_LENGTH_MAX} value={cycleLengthDraft} onChange={(event) => setCycleLengthDraft(Number(event.target.value))} className="w-full p-2.5 rounded-xl border border-border bg-card text-body" disabled={settingsPending} />
              </label>
              <label className="text-label font-bold text-foreground space-y-1">
                <span>평균 기간</span>
                <input type="number" min={PERIOD_LENGTH_MIN} max={PERIOD_LENGTH_MAX} value={periodLengthDraft} onChange={(event) => setPeriodLengthDraft(Number(event.target.value))} className="w-full p-2.5 rounded-xl border border-border bg-card text-body" disabled={settingsPending} />
              </label>
            </div>
            <p className="text-caption text-muted-foreground">주기 {CYCLE_LENGTH_MIN}~{CYCLE_LENGTH_MAX}일 · 기간 {PERIOD_LENGTH_MIN}~{PERIOD_LENGTH_MAX}일</p>
            {settingsError && <p className="text-caption text-destructive" role="alert">{settingsError}</p>}
            <button type="button" onClick={() => void saveSettings()} disabled={settingsPending} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-foreground text-background text-label font-bold disabled:opacity-50 min-h-[42px]">
              {settingsPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {settingsPending ? '설정 저장 중' : '평균 길이 저장'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
