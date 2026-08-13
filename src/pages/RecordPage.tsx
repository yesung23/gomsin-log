import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { generateDailySummary } from '@/lib/briefing';
import { useEscapeKey } from '@/lib/hooks';
import { scrollBehavior } from '@/lib/motion';
import { visibleRecordsForViewer, isOwnRecord } from '@/lib/privacy';
import { recordAuthorPresentation } from '@/lib/recordAuthor';
import { EmotionFlowInsightCard } from '@/components/EmotionFlowInsightCard';
import { RecordEmotionCorrection } from '@/components/RecordEmotionCorrection';
import { EmotionFlowSummarySection } from '@/components/EmotionFlowSummarySection';
import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';
import { isMarkedByViewer } from '@/lib/talkAboutList';
import {
  ChevronLeft, ChevronRight, Lock, Unlock,
  Sparkles, Clock, Calendar,
  Pencil, Trash2, X, MessageCircle,
} from 'lucide-react';
import { cn, formatLocalDate, toLocalDateString, localToday } from '@/lib/utils';
import { parseTripPeriodParams, recordsInInclusiveRange } from '@/lib/trips';
import { toast } from 'sonner';
import { MEDIA_ACCEPT, classifyMediaFile } from '@/lib/records';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { AttachmentMedia } from '@/components/AttachmentMedia';
import { Button } from '@/components/ui/Button';
import type { DailyRecord } from '@/types';

type MediaFilter = 'all' | 'photo' | 'video' | 'voice' | 'text';

// Build calendar grid for a given year/month
function buildCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=Sun
  const totalDays = lastDay.getDate();

  const cells: { date: Date; inMonth: boolean }[] = [];

  // Previous month overflow
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, inMonth: false });
  }
  // Current month
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  // Next month overflow to fill 6 rows max (42 cells) or complete the last row
  const remainder = cells.length % 7;
  if (remainder > 0) {
    const fill = 7 - remainder;
    for (let i = 1; i <= fill; i++) {
      cells.push({ date: new Date(year, month + 1, i), inMonth: false });
    }
  }

  return cells;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const REACTION_LABELS: Record<string, string> = {
  good: '😊 좋았어',
  event: '💬 이런 일이 있었어',
  hard: '🥹 힘들었어',
  thought_of_you: '💌 네 생각났어',
};

const FILTERS: { key: MediaFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'photo', label: '사진' },
  { key: 'video', label: '영상' },
  { key: 'voice', label: '음성' },
  { key: 'text', label: '글' },
];

export function RecordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    state,
    setHighlightedRecordId,
    updateRecord,
    deleteRecord,
    updateRecordMedia,
    sharedSyncStatus,
    markTalkAbout,
    unmarkTalkAbout,
  } = useStore();
  const isOnline = useOnlineStatus();
  const isOffline = !isOnline;
  const { records, profile } = state;
  const today = localToday();
  const todayStr = toLocalDateString(today);
  const tripPeriod = useMemo(() => parseTripPeriodParams(searchParams), [searchParams]);
  const hasTripPeriodQuery = searchParams.has('trip') || searchParams.has('from') || searchParams.has('to');
  const periodTrip = tripPeriod
    ? state.trips.find((trip) => trip.id === tripPeriod.tripId) || null
    : null;

  // Calendar state
  const [showCalendar, setShowCalendar] = useState(false);
  const [viewYear, setViewYear] = useState(() => Number((tripPeriod?.from || todayStr).slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number((tripPeriod?.from || todayStr).slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState(tripPeriod?.from || todayStr);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  // Hold the id, not a snapshot: the modal must re-read the record from the
  // store after an edit, otherwise it keeps showing pre-save content.
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMediaBusy, setIsMediaBusy] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  /**
   * PRODUCT_V3 §7.1.1 / CURRENT_STATE #1: before this, the only way to write a
   * record was a Home widget the user can remove from their own layout, at
   * which point there was no way left to record anything at all. The 기록 tab
   * itself had no creation affordance. This sheet is that affordance, and it
   * cannot be removed by any widget-layout choice because it lives on this
   * page, not in the widget system.
   */
  const [showComposer, setShowComposer] = useState(false);

  const closeSelectedRecord = useCallback(() => {
    setSelectedRecordId(null);
    setIsEditing(false);
    setEditText('');
    setShowDeleteConfirm(false);
  }, []);
  useEscapeKey(closeSelectedRecord, selectedRecordId !== null);
  useEscapeKey(() => setShowComposer(false), showComposer);

  // Own records + the partner's shared ones, with author-only fragments removed.
  // Uses the shared privacy helper so the rule lives in exactly one place.
  const visibleRecords = useMemo(() => {
    const permitted = visibleRecordsForViewer(records, { userId: profile.id, role: profile.role });
    return tripPeriod
      ? recordsInInclusiveRange(permitted, tripPeriod.from, tripPeriod.to)
      : permitted;
  }, [records, profile.id, profile.role, tripPeriod]);

  // Always the store's current version of the open record, already sanitised for
  // this viewer by `visibleRecordsForViewer`.
  const selectedRecord = useMemo(
    () => visibleRecords.find((r) => r.id === selectedRecordId) ?? null,
    [visibleRecords, selectedRecordId],
  );

  // The record went away (deleted here, or revoked by its author): close up.
  useEffect(() => {
    if (selectedRecordId !== null && selectedRecord === null) closeSelectedRecord();
  }, [selectedRecordId, selectedRecord, closeSelectedRecord]);

  /**
   * Media may only be edited on a record this viewer owns. The partner's records
   * are read-only here for the same reason their 수정/삭제 controls are hidden.
   */
  const canEditMedia = !!selectedRecord
    && isOwnRecord(selectedRecord, { userId: profile.id, role: profile.role });

  const handleAddAttachments = useCallback(async (files: File[]) => {
    if (!selectedRecord || files.length === 0) return;
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    // Validate against the same allowlist and size ceilings the create path uses,
    // before anything is uploaded.
    const rejected: string[] = [];
    const accepted = files.filter((file) => {
      const classified = classifyMediaFile(file);
      if ('error' in classified) {
        rejected.push(`${file.name}: ${classified.error}`);
        return false;
      }
      return true;
    });
    rejected.forEach((message) => toast.error(message));
    if (accepted.length === 0) return;

    setIsMediaBusy(true);
    try {
      const result = await updateRecordMedia(selectedRecord.id, { addFiles: accepted });
      if (!result.ok) {
        toast.error(result.error || '첨부를 추가하지 못했어요.');
        return;
      }
      if (result.failedFiles.length > 0) {
        toast.warning(`첨부 ${result.failedFiles.length}개를 올리지 못했어요.`);
        return;
      }
      toast.success('첨부를 추가했어요.');
    } finally {
      setIsMediaBusy(false);
    }
  }, [isOffline, selectedRecord, updateRecordMedia]);

  const handleRemoveAttachment = useCallback(async (path: string) => {
    if (!selectedRecord) return;
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    setIsMediaBusy(true);
    try {
      const result = await updateRecordMedia(selectedRecord.id, { removePaths: [path] });
      if (!result.ok) {
        toast.error(result.error || '첨부를 삭제하지 못했어요.');
        return;
      }
      toast.success('첨부를 삭제했어요.');
    } finally {
      setIsMediaBusy(false);
    }
  }, [isOffline, selectedRecord, updateRecordMedia]);

  useEffect(() => {
    if (!tripPeriod) return;
    setSelectedDate(tripPeriod.from);
    setViewYear(Number(tripPeriod.from.slice(0, 4)));
    setViewMonth(Number(tripPeriod.from.slice(5, 7)) - 1);
    setMediaFilter('all');
  }, [tripPeriod]);

  // Map of dateStr -> visible records for that date
  const recordsByDate = useMemo(() => {
    const map: Record<string, DailyRecord[]> = {};
    visibleRecords.forEach((r) => {
      if (!map[r.date]) map[r.date] = [];
      map[r.date].push(r);
    });
    // Sort each day chronologically
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) =>
        new Date(`${a.date}T${a.time || '00:00'}`).getTime() -
        new Date(`${b.date}T${b.time || '00:00'}`).getTime()
      )
    );
    return map;
  }, [visibleRecords]);

  // Calendar grid cells
  const calendarCells = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  // Selected day records
  const selectedDayRecords = useMemo(() => {
    const dayRecs = recordsByDate[selectedDate] || [];
    if (mediaFilter === 'all') return dayRecs;
    return dayRecs.filter((r) => {
      if (mediaFilter === 'text') return r.log && r.log.trim();
      return r.attachments?.some((a) => a.type === mediaFilter);
    });
  }, [recordsByDate, selectedDate, mediaFilter]);

  // Stats for selected day
  /**
   * Records the period summary aggregates.
   *
   * Already viewer-filtered by `visibleRecords`, so the summary can never include
   * a partner's private record or an author-only emotion item. In trip-period mode
   * `visibleRecords` is already narrowed to the range; otherwise the visible month
   * is the natural period.
   */
  const periodSummaryRecords = useMemo(
    () => tripPeriod
      ? visibleRecords
      : visibleRecords.filter((record) => {
          const [year, month] = record.date.split('-');
          return Number(year) === viewYear && Number(month) === viewMonth + 1;
        }),
    [tripPeriod, visibleRecords, viewYear, viewMonth],
  );

  const periodSummaryLabel = tripPeriod
    ? periodTrip
      ? `${periodTrip.title} 여행 기간`
      : '여행 기간'
    : `${viewYear}년 ${viewMonth + 1}월`;

  const selectedDayAllRecords = useMemo(
    () => recordsByDate[selectedDate] || [],
    [recordsByDate, selectedDate]
  );
  const photoCount = selectedDayAllRecords.filter((r) => r.attachments?.some((a) => a.type === 'photo')).length;
  const voiceCount = selectedDayAllRecords.filter((r) => r.attachments?.some((a) => a.type === 'voice')).length;
  const videoCount = selectedDayAllRecords.filter((r) => r.attachments?.some((a) => a.type === 'video')).length;
  const textCount = selectedDayAllRecords.filter((r) => r.log && r.log.trim()).length;

  // Summary for selected day
  const selectedDaySummary = useMemo(() => {
    const sharedRecs = selectedDayAllRecords.filter((r) => !r.isPrivate);
    return generateDailySummary(sharedRecs, profile.couple.partnerName || '상대방');
  }, [selectedDayAllRecords, profile.couple.partnerName]);

  // Navigation
  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    const t = localToday();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    setSelectedDate(toLocalDateString(t));
  };

  const handleDateSelect = (dateStr: string) => {
    setSelectedDate(dateStr);
    setMediaFilter('all');
    setShowCalendar(false);
    setTimeout(() => {
      timelineRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }, 100);
  };

  // Summary item click -> scroll to record
  const handleSummaryItemClick = (recordId?: string) => {
    if (!recordId) return;
    setHighlightedRecordId(recordId);
    const el = document.getElementById(`record-${recordId}`);
    if (el) {
      el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }
  };

  /**
   * Arriving with a record already chosen: open ITS date, then scroll to it.
   *
   * README section 1 promises that tapping a summary item scrolls to the original
   * record and emphasises it for 1~2 seconds. Inside this page that worked
   * (`handleSummaryItemClick`). Arriving from the home screen did not: a widget set
   * `highlightedRecordId` and navigated, this page opened on TODAY, and the only
   * thing that read the id was the effect below -- which CLEARS it two seconds
   * later. `추억 다시보기` was the worst case: it targets a record from a past year,
   * which is not even rendered on today's timeline, so the tap silently did
   * nothing.
   *
   * Runs twice by design when the date has to change: the first pass switches the
   * date, the second finds the element now that the timeline for that date is
   * mounted.
   */
  useEffect(() => {
    const targetId = state.highlightedRecordId;
    if (!targetId) return;
    const target = state.records.find((record) => record.id === targetId);
    // An id with no record on screen: a private record of the partner's, or one
    // deleted since. Nothing to scroll to, and nothing to invent.
    if (!target) return;
    if (target.date !== selectedDate) {
      setSelectedDate(target.date);
      setMediaFilter('all');
      setShowCalendar(false);
      return;
    }
    const timer = setTimeout(() => {
      document.getElementById(`record-${targetId}`)?.scrollIntoView({
        behavior: scrollBehavior(),
        block: 'center',
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [state.highlightedRecordId, state.records, selectedDate]);

  /**
   * The durable half of source addressing: `?record=<id>` in the URL.
   *
   * `state.highlightedRecordId` above is in-memory store state -- it answers
   * "which record did I just tap", not "which record does this URL mean", so
   * a reload or a direct link opened `/record` with no target at all
   * (CURRENT_STATE #9 / PRODUCT_V3 §7.5's addressing requirement). Every
   * caller that used to do `setHighlightedRecordId(id); navigate('/record')`
   * now also puts the id in the URL, so the SAME effect below fires whether
   * this page just mounted fresh or the widget navigated here a moment ago.
   *
   * Bridges into `setHighlightedRecordId` rather than duplicating the
   * date-switch/scroll logic above, so there is exactly one place that owns
   * "how a target record gets to be on screen and highlighted".
   *
   * Waits out `sharedSyncStatus === 'unavailable'`: that is the ~2s
   * membership-confirmation window on a cold load with no realtime socket
   * yet (see the period-summary honesty tests), during which `state.records`
   * can be legitimately empty for a reason that has nothing to do with
   * whether the target record exists. Judging "missing" during that window
   * would show a false failure on exactly the case this fix is for --
   * arriving fresh from a deep link.
   */
  const recordIdParam = searchParams.get('record');
  const handledRecordParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!recordIdParam) return;
    if (sharedSyncStatus === 'unavailable') return;
    if (handledRecordParamRef.current === recordIdParam) return;
    handledRecordParamRef.current = recordIdParam;

    const target = state.records.find((record) => record.id === recordIdParam);
    if (!target) {
      // Deleted, never existed, or belongs to someone else and was correctly
      // never sent to this client -- one message covers all three on
      // purpose. Distinguishing them would tell an unauthorized viewer that
      // *something* is there, just hidden.
      toast.info('이 기록은 삭제되었어요.');
      return;
    }
    setHighlightedRecordId(recordIdParam);
  }, [recordIdParam, sharedSyncStatus, state.records, setHighlightedRecordId]);

  // Auto-clear highlight
  useEffect(() => {
    if (state.highlightedRecordId) {
      const timer = setTimeout(() => setHighlightedRecordId(undefined), 2000);
      return () => clearTimeout(timer);
    }
  }, [state.highlightedRecordId, setHighlightedRecordId]);

  // Format selected date for display
  const selectedDateObj = new Date(
    parseInt(selectedDate.split('-')[0]),
    parseInt(selectedDate.split('-')[1]) - 1,
    parseInt(selectedDate.split('-')[2])
  );
  const isToday = selectedDate === todayStr;
  const selectedDateLabel = `${selectedDateObj.getMonth() + 1}월 ${selectedDateObj.getDate()}일`;

  // Check if a date has records with media
  const dateHasMedia = (dateStr: string) => {
    const recs = recordsByDate[dateStr];
    if (!recs) return false;
    return recs.some((r) => r.attachments && r.attachments.length > 0);
  };

  const partnerDisplayName = profile.couple.partnerName || '상대방';

  /**
   * Attribution for the open record, so the detail modal names the author with
   * the same three channels the timeline card uses.
   */
  const selectedAuthor = useMemo(
    () => (selectedRecord
      ? recordAuthorPresentation(
        selectedRecord,
        { userId: profile.id, role: profile.role },
        partnerDisplayName,
      )
      : null),
    [selectedRecord, profile.id, profile.role, partnerDisplayName],
  );

  // Check if selected month has any records at all
  const monthHasRecords = useMemo(() => {
    return calendarCells.some((cell) => {
      if (!cell.inMonth) return false;
      const ds = toLocalDateString(cell.date);
      return (recordsByDate[ds]?.length || 0) > 0;
    });
  }, [calendarCells, recordsByDate]);

  return (
    <MobileShell>
      <div className="p-4 pb-28 relative min-h-screen">
        {/* Top Header with Title and Calendar Toggle Button */}
        <div className="flex items-center justify-between px-1 pt-4 pb-3">
          <h1 className="text-title tracking-tight text-foreground">기록</h1>
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className={cn(
              'p-2.5 rounded-2xl transition active:scale-95 flex items-center justify-center min-h-[44px] min-w-[44px]',
              showCalendar
                ? 'bg-coral-fill text-coral-fill-foreground shadow-sm'
                : 'bg-card border border-border text-foreground hover:bg-muted'
            )}
            aria-label="달력 보기"
          >
            <Calendar size={20} />
          </button>
        </div>

        {tripPeriod ? (
          <div className="mb-4 rounded-2xl border border-coral/30 bg-coral/10 p-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-label font-bold text-foreground">
                {periodTrip ? `${periodTrip.title} 여행 기간` : '여행 기간 기록'}
              </p>
              <p className="text-caption text-muted-foreground mt-1">
                {formatLocalDate(tripPeriod.from)} ~ {formatLocalDate(tripPeriod.to)} · 이 기간의 기록만 표시해요.
              </p>
              {!periodTrip && (
                <p className="text-caption text-warning-foreground mt-1">여행 정보를 찾을 수 없지만, 유효한 기간 필터는 유지했어요.</p>
              )}
            </div>
            <button onClick={() => navigate('/record', { replace: true })} className="shrink-0 text-caption font-bold text-coral-strong underline">기간 보기 해제</button>
          </div>
        ) : hasTripPeriodQuery ? (
          <div className="mb-4 rounded-2xl border border-warning/30 bg-warning-surface p-4 flex items-center justify-between gap-3">
            <p className="text-caption text-warning-foreground">여행 기간 정보가 올바르지 않아 전체 기록을 표시해요.</p>
            <button onClick={() => navigate('/record', { replace: true })} className="shrink-0 text-caption font-bold text-warning-foreground underline">지우기</button>
          </div>
        ) : null}

        {/* Collapsible Calendar Grid */}
        {showCalendar && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Month Header */}
            <div className="flex items-center justify-between mb-3 px-1">
              <button
                onClick={goToPrevMonth}
                className="p-2 rounded-xl hover:bg-muted active:scale-95 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="이전 달"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="flex items-center gap-2">
                <h2 className="text-heading text-foreground">
                  {viewYear}년 {viewMonth + 1}월
                </h2>
                {!(viewYear === today.getFullYear() && viewMonth === today.getMonth()) && (
                  <button
                    onClick={goToToday}
                    className="text-caption font-bold text-coral-strong bg-coral/10 px-3 py-1.5 rounded-lg active:scale-95 transition min-h-[36px] flex items-center justify-center"
                  >
                    오늘
                  </button>
                )}
              </div>
              <button
                onClick={goToNextMonth}
                className="p-2 rounded-xl hover:bg-muted active:scale-95 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="다음 달"
              >
                <ChevronRight size={20} />
              </button>
            </div>

        {/* Calendar Grid */}
        <div className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden mb-4">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-border/40">
            {WEEKDAYS.map((day, i) => (
              <div
                key={day}
                className={cn(
                  'text-center text-caption font-bold py-2',
                  i === 0 ? 'text-destructive' : i === 6 ? 'text-info' : 'text-muted-foreground'
                )}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7">
            {calendarCells.map((cell, idx) => {
              const dateStr = toLocalDateString(cell.date);
              const dayRecords = recordsByDate[dateStr] || [];
              const recordCount = dayRecords.length;
              const hasMedia = dateHasMedia(dateStr);
              const isTodayCell = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const isFuture = cell.date > today;
              const dow = cell.date.getDay();

              // Build aria-label
              let ariaLabel = `${cell.date.getMonth() + 1}월 ${cell.date.getDate()}일`;
              if (recordCount > 0) ariaLabel += `, 기록 ${recordCount}개`;
              else ariaLabel += ', 기록 없음';
              if (isSelected) ariaLabel += ', 선택됨';
              if (isTodayCell) ariaLabel += ', 오늘';

              const isOutsideTripPeriod = Boolean(
                tripPeriod && (dateStr < tripPeriod.from || dateStr > tripPeriod.to),
              );

              return (
                <button
                  key={idx}
                  onClick={() => cell.inMonth && !isOutsideTripPeriod && handleDateSelect(dateStr)}
                  disabled={!cell.inMonth || isOutsideTripPeriod}
                  aria-label={ariaLabel}
                  className={cn(
                    'relative flex flex-col items-center justify-center py-1.5 min-h-[44px] transition-colors',
                    (!cell.inMonth || isOutsideTripPeriod) && 'opacity-30 pointer-events-none',
                    cell.inMonth && !isSelected && 'hover:bg-muted/50 active:bg-muted',
                    isSelected && 'bg-coral-fill text-coral-fill-foreground',
                    !isSelected && isTodayCell && 'ring-2 ring-coral/50 ring-inset rounded-lg',
                  )}
                >
                  <span
                    className={cn(
                      'text-label font-semibold leading-none',
                      !cell.inMonth && 'text-muted-foreground/30',
                      cell.inMonth && !isSelected && isFuture && 'text-muted-foreground/50',
                      cell.inMonth && !isSelected && !isFuture && dow === 0 && 'text-destructive',
                      cell.inMonth && !isSelected && !isFuture && dow === 6 && 'text-info',
                      isSelected && 'text-coral-strong-foreground',
                    )}
                  >
                    {cell.date.getDate()}
                  </span>

                  {/* Record indicator dots */}
                  {cell.inMonth && !isFuture && recordCount > 0 && (
                    <div className="flex items-center gap-[3px] mt-0.5 h-[6px]" aria-hidden="true">
                      <span className={cn(
                        'w-[5px] h-[5px] rounded-full',
                        isSelected ? 'bg-coral-strong-foreground/80' : 'bg-coral'
                      )} />
                      {hasMedia && (
                        <span className={cn(
                          'w-[5px] h-[5px] rounded-full',
                          isSelected ? 'bg-coral-strong-foreground/60' : 'bg-coral/50'
                        )} />
                      )}
                      {recordCount >= 4 && (
                        <span className={cn(
                          'w-[5px] h-[5px] rounded-full',
                          isSelected ? 'bg-coral-strong-foreground/40' : 'bg-coral/30'
                        )} />
                      )}
                    </div>
                  )}
                  {/* Placeholder to keep cell height consistent when no dots */}
                  {(cell.inMonth && (isFuture || recordCount === 0)) && (
                    <div className="h-[6px] mt-0.5" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Empty month message */}
        {!monthHasRecords && (
          <div className="text-center py-4 text-muted-foreground text-caption">
            이번 달의 첫 순간을 남겨보세요 ✨
          </div>
        )}
          </div>
        )}

        {/* Aggregated emotion flow for the period on screen. Purely derived from
            the already-loaded, already-sanitised visible records, so a record edit
            or delete changes it on the next render with nothing to invalidate. */}
        <EmotionFlowSummarySection
          records={periodSummaryRecords}
          periodLabel={periodSummaryLabel}
          // `unavailable` means the shared workspace is hidden pending an
          // authoritative membership re-check, so `periodSummaryRecords` is empty
          // for a reason that is NOT "no emotions". Reporting an empty period here
          // contradicted the SharedSyncBanner immediately above. `delayed` is
          // different: the data on screen is real, only possibly stale.
          isLoading={sharedSyncStatus === 'unavailable'}
          className="mb-3"
        />

        {/* Selected Day Summary Bar */}
        <div ref={timelineRef} className="mb-3">
          <div className="flex items-center justify-between px-1 mb-1">
            <h3 className="text-heading text-foreground">
              {selectedDateLabel}
              {isToday && <span className="text-coral ml-1">오늘</span>}
              {selectedDayAllRecords.length > 0 && (
                <span className="text-muted-foreground font-normal ml-1.5">
                  · 순간 {selectedDayAllRecords.length}개
                </span>
              )}
            </h3>
          </div>
          {/* Stats chips */}
          {selectedDayAllRecords.length > 0 && (
            <div className="flex items-center gap-1.5 px-1 mb-2 text-caption text-muted-foreground">
              <Clock size={11} className="text-coral" />
              <span>
                {[
                  photoCount > 0 ? `사진 ${photoCount}` : '',
                  videoCount > 0 ? `영상 ${videoCount}` : '',
                  voiceCount > 0 ? `음성 ${voiceCount}` : '',
                  textCount > 0 ? `글 ${textCount}` : '',
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
        </div>

        {/* Day Summary Card (only if 2+ shared records) */}
        {selectedDaySummary.items.length > 0 && (
          <div className="mb-3 rounded-surface bg-lilac/30 border border-lilac/50 px-3 py-2 space-y-1">
            <div className="flex items-center justify-between text-caption text-foreground">
              <div className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-coral" aria-hidden="true" />
                <span className="font-semibold">{isToday ? '오늘의 빠른 정리' : '그날의 빠른 정리'}</span>
              </div>
              <span className="text-caption text-muted-foreground">눌러서 원문 이동</span>
            </div>
            {selectedDaySummary.items.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSummaryItemClick(item.recordIds[0])}
                /*
                 * Full-width rows in a stacked list, so the minimum goes to 44px
                 * rather than being faked with an overlay: an overlay on stacked rows
                 * would make neighbours' hit areas overlap, and the row that receives
                 * a tap near the boundary would stop being predictable.
                 */
                className="w-full text-left px-2 py-1.5 rounded-control bg-card/60 hover:bg-card transition flex items-center justify-between text-caption text-foreground group active:scale-[0.99] min-h-11"
              >
                <span className="leading-snug flex-1 pr-2 break-keep">• {item.text}</span>
                <ChevronRight size={12} className="text-foreground/30 group-hover:text-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Media Filter Chips */}
        {selectedDayAllRecords.length > 0 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide pb-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setMediaFilter(f.key)}
                className={cn(
                  /*
                   * The media filter chips paint at 28px tall and 30-41px wide, and
                   * they stay that size: a row of five has to fit across 390px, and
                   * growing them to 44px would either wrap the row or push the
                   * timeline below the fold.
                   *
                  * So the tap target comes from a `::before` overlay instead
                   * (DESIGN_V2 §Visual footprint ≠ hit target).
                   *
                   * Written as arbitrary values rather than as `-inset-x-2`: with
                   * `before:-inset-x-*` and `before:-inset-y-*` both present, the
                   * generated rules collide and the horizontal one loses -- measured
                   * `left: 0px` on the rendered chip while the vertical -8px applied.
                   * Naming the four sides explicitly is unambiguous.
                   *
                   * `글` is the narrowest at 30px, so 8px per side takes it to 46;
                   * 28px tall plus 8px per side is 44.
                   */
                  'px-2.5 py-1 rounded-full text-caption font-semibold whitespace-nowrap transition min-h-[28px]',
                  "relative isolate before:absolute before:content-[''] before:-z-10",
                  'before:top-[-8px] before:bottom-[-8px] before:left-[-8px] before:right-[-8px]',
                  'relative before:absolute before:inset-x-0 before:-inset-y-2 before:content-[""]',
                  mediaFilter === f.key
                    ? 'bg-navy text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Day Timeline — editorial layout */}
        <ul className="space-y-0">
          {selectedDayRecords.length === 0 ? (
            <li className="list-none rounded-surface bg-card border border-border/60 p-6 text-center text-muted-foreground">
              <p className="text-body font-semibold">
                {selectedDayAllRecords.length === 0
                  ? '이 날은 남긴 순간이 없어요'
                  : '선택한 유형의 기록이 없어요'}
              </p>
              <p className="text-caption mt-1 text-muted-foreground">
                {selectedDayAllRecords.length === 0
                  ? '달력에서 점이 있는 날짜를 눌러보세요'
                  : '다른 필터를 선택해보세요'}
              </p>
            </li>
          ) : (
            selectedDayRecords.map((r) => {
              const author = recordAuthorPresentation(
                r,
                { userId: profile.id, role: profile.role },
                partnerDisplayName,
              );
              const isHighlighted = state.highlightedRecordId === r.id;
              const hasMedia = r.attachments && r.attachments.length > 0;

              return (
                <li
                  id={`record-${r.id}`}
                  key={r.id}
                  data-author-role={author.role ?? 'unknown'}
                  data-author-own={author.isOwn ? 'true' : 'false'}
                  className={cn(
                    'list-none relative border-b border-border/40 last:border-b-0 transition-all duration-500',
                    isHighlighted && 'record-highlighted ring-2 ring-coral/30 bg-coral/5 rounded-control'
                  )}
                >
                  {/* Author hue stripe — left edge */}
                  <span
                    aria-hidden="true"
                    className={cn('absolute left-0 top-0 bottom-0 w-1', author.stripeClass)}
                  />

                  {/*
                    Editorial row structure:
                    - The opener <button> covers: time column + spacer (for media overlay) + content.
                    - Media is a SIBLING positioned absolutely over the spacer area
                      so <video>/<audio> controls are not nested inside the button.

                    Column geometry:
                      time = w-11 (44px), gap = 8px, media = 68px (76px @360+)
                      left offset for media = 44 + 8 = 52px → left-[52px]
                  */}
                  {/*
                    Row layout: time and marker are a fixed left rail, then media and
                    prose stack in the remaining width. Everything is in normal flow,
                    so the row's height is whatever its content needs -- a text-only
                    record is short, one with a photo or three lines of prose is taller.

                    Replaces an absolutely-positioned media overlay. That version could
                    not contribute height, so a photo drew outside its own row and over
                    the record below it, and a long log was clamped to keep the overlap
                    from getting worse.

                    The opener button no longer wraps the whole row: `<button>` cannot
                    contain `<video controls>` / `<audio controls>`, which is why the
                    overlay existed. Instead the button covers the time rail and the
                    prose -- everything except the media -- so `<audio>` and `<video>`
                    stay outside it while a tap on the time still opens the detail
                    sheet, which `recordAuthorDistinction.test.tsx` clicks.
                  */}
                  <div className="flex pl-2.5 gap-2 py-3">
                    {/*
                      Time + marker rail, tappable.

                      Splitting the opener into two buttons -- rail and prose -- is what
                      lets the media sit between them in normal flow. But two buttons
                      with the same accessible name is one control announced twice, so
                      only the prose button carries the name; this one is hidden from
                      assistive tech and exists for the pointer, where tapping the time
                      has always opened the record.
                      `keyboardOperableCards.test.tsx` asserts exactly one button per
                      record, and `recordAuthorDistinction.test.tsx` clicks the time.
                    */}
                    <button
                      type="button"
                      onClick={() => setSelectedRecordId(r.id)}
                      aria-hidden="true"
                      tabIndex={-1}
                      className="shrink-0 flex gap-2 text-left self-stretch rounded-control active:bg-muted/40 transition-colors cursor-pointer"
                    >
                      <span className="shrink-0 w-11 text-right text-caption text-muted-foreground tabular-nums pt-0.5 font-medium">
                        {r.time}
                      </span>
                      <span className="shrink-0 flex flex-col items-center pt-1.5" aria-hidden="true">
                        <span className={author.markerClass} />
                        <span className="w-px flex-1 bg-border mt-1" />
                      </span>
                    </button>

                    {/* Media + prose share the remaining width and set the row height */}
                    <div className="min-w-0 flex-1 flex gap-2">
                      {hasMedia && (
                        <div className="shrink-0 w-[68px] min-[360px]:w-[76px] space-y-1">
                          {r.attachments!.map((att, i) => (
                            <AttachmentMedia
                              key={i}
                              attachment={att}
                              coupleId={state.profile.couple.coupleId}
                              recordId={r.id}
                              variant="timeline"
                            />
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setSelectedRecordId(r.id)}
                        aria-label={`${author.srAttribution} 자세히 보기`}
                        className="min-w-0 flex-1 flex flex-col gap-1 text-left rounded-control active:bg-muted/40 transition-colors cursor-pointer"
                      >
                        {/* Attribution chip */}
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'px-1.5 py-0.5 rounded-full font-semibold text-caption whitespace-nowrap inline-flex items-center',
                              author.chipClass,
                            )}
                          >
                            {author.attribution}
                          </span>
                          <span className="sr-only">{author.srAttribution}</span>
                          {r.isPrivate ? (
                            <span className="flex items-center gap-0.5 text-warning-foreground bg-warning-surface px-1.5 py-0.5 rounded-md font-medium text-caption">
                              <Lock size={9} /> 나에게만
                            </span>
                          ) : null}
                        </span>

                        {/* User's original text — the primary content */}
                        {/*
                          No `leading-snug` here. `text-body` already carries
                          15/22 (1.467) from the scale, and Tailwind's snug
                          (1.375) overrode it -- below the 1.4 floor that
                          `e2e/renderedTypeScale.spec.ts` measures on the real
                          render, because Korean prose crowds at that leading.
                          The record's own sentence is the one thing on this
                          screen that must stay comfortable to read.
                        */}
                        {/*
                          No clamp. The row grows to fit the log now that nothing is
                          absolutely positioned inside it -- `line-clamp-3` existed to
                          stop long prose from making the overlap with the floated
                          media worse, and there is no overlap left to manage. A record
                          is short because the person wrote a short one, not because the
                          layout cut it off.
                        */}
                        {r.log && (
                          <span data-testid="record-log" className="text-body text-foreground break-keep whitespace-pre-wrap">{r.log}</span>
                        )}

                        {/* Secondary metadata — compact, never outweighs the prose */}
                        <span className="flex items-center gap-1.5 flex-wrap">
                          {r.reaction && (
                            <span className="text-caption text-muted-foreground">
                              {REACTION_LABELS[r.reaction] || r.reaction}
                            </span>
                          )}
                          {!r.isPrivate && (
                            <span className="text-muted-foreground/60" aria-hidden="true">
                              <Unlock size={9} className="inline" />
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>

      {/* Floating CTA — the one primary action. 48px via Button size="lg".
          Positioned off the measured bottom chrome so it never overlaps the
          offline banner or the tab bar. Hidden while the sheet it opens is
          already open: left visible it sits behind the overlay with a label
          ("...남기기") that collides with the composer's own save button. */}
      {!showComposer && (
        <div className="fixed bottom-[calc(var(--gomsin-tabbar-height,70px)+var(--gomsin-bottom-banner-height,0px)+12px)] left-1/2 -translate-x-1/2 w-full max-w-[400px] px-5 z-40">
          <Button
            variant="primary"
            size="lg"
            full
            onClick={() => setShowComposer(true)}
            className="shadow-md"
          >
            <span aria-hidden="true">+</span>
            <span>지금의 마음 남기기</span>
          </Button>
        </div>
      )}

      {/*
        Composer sheet. Reuses the exact same TodayLogWidget the Home widget
        renders -- not a second, differently-shaped editor -- so this and the
        Home composer can never drift apart. z-[60] to sit above the tab bar,
        matching the detail modal below.
      */}
      {showComposer && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="지금의 마음 남기기"
            className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-surface p-4 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-end mb-1">
              <button
                type="button"
                onClick={() => setShowComposer(false)}
                aria-label="닫기"
                className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <TodayLogWidget onSaved={() => setShowComposer(false)} />
          </div>
        </div>
      )}

      {/*
        Detail Modal.

        z-[60], not z-50: MobileShell's tab bar is `fixed bottom-0 ... z-50` and
        comes AFTER <main> in the DOM, so at an equal z-index it paints over a
        bottom-anchored sheet and swallows the taps aimed at the owner-only
        수정 / 삭제 buttons. SchedulePage's event modal already sits at z-[60].
      */}
      {selectedRecord && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-sm p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="record-detail-modal-title" className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-surface p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <div className="min-w-0">
                <h3 id="record-detail-modal-title" className="text-heading text-card-foreground">
                  {formatLocalDate(selectedRecord.date)} {selectedRecord.time}
                </h3>
                {/*
                  The modal used to name only the date and time. Opening a card
                  from a day both people wrote on therefore lost the one thing the
                  timeline had just established: whose entry this is.
                */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1 inline-block px-2 py-0.5 rounded-full font-semibold text-caption',
                    selectedAuthor?.chipClass,
                  )}
                >
                  {selectedAuthor?.attribution}
                </span>
                {/*
                  Same split as the timeline chip: the emoji shorthand is for the
                  eye, the sentence is for the screen reader. The modal is labelled
                  by the date heading, so this sits inside it as extra prose rather
                  than replacing the accessible name.
                */}
                <span className="sr-only">{selectedAuthor?.srAttribution}</span>
              </div>
              <button
                onClick={closeSelectedRecord}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-muted text-muted-foreground min-w-[44px] min-h-[44px]"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <div className="mb-4 p-4 rounded-xl bg-destructive/10 border border-destructive/30 space-y-3">
                <p className="text-label font-bold text-destructive">이 기록을 삭제할까요?</p>
                <p className="text-caption text-muted-foreground">삭제하면 되돌릴 수 없어요.</p>
                {isOffline && (
                  <p className="text-caption text-muted-foreground">{OFFLINE_READONLY_MESSAGE}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setIsSaving(true);
                      try {
                        const result = await deleteRecord(selectedRecord.id);
                        if (result.ok) {
                          toast.success('기록이 삭제되었어요.');
                          closeSelectedRecord();
                        } else {
                          // The store always supplies a cause-specific message,
                          // so there is no generic fallback to fall back to.
                          toast.error(result.error);
                        }
                      } finally {
                        setIsSaving(false);
                        setShowDeleteConfirm(false);
                      }
                    }}
                    disabled={isSaving || isOffline}
                    className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground font-bold text-label disabled:opacity-50"
                  >
                    {isSaving ? '삭제 중...' : '삭제'}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 rounded-lg bg-muted text-muted-foreground font-bold text-label"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {selectedRecord.reaction && (
                <div className="px-3 py-1.5 rounded-full bg-coral/10 text-coral-strong text-caption font-semibold inline-block">
                  {REACTION_LABELS[selectedRecord.reaction]}
                </div>
              )}

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    aria-label="기록 내용 수정"
                    className="w-full h-32 bg-muted rounded-xl p-3 text-body text-foreground outline-none resize-none placeholder:text-muted-foreground"
                    placeholder="기록 내용을 입력하세요"
                  />
                  {/* Say it before saving, not after: the confirmations were
                      derived from the previous text, so they get cleared. */}
                  {editText.trim() !== (selectedRecord.log ?? '').trim() && (
                    <p className="text-caption text-muted-foreground">
                      내용을 바꾸면 이전 글에서 고른 마음은 지워져요.
                    </p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditText('');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground font-bold text-label"
                    >
                      취소
                    </button>
                    <button
                      onClick={async () => {
                        if (!editText.trim()) {
                          toast.error('빈 내용은 저장할 수 없어요.');
                          return;
                        }
                        setIsSaving(true);
                        try {
                          const textChanged = editText.trim() !== (selectedRecord.log || '').trim();
                          const updates: Partial<DailyRecord> = { log: editText.trim() };
                          // If text content changed, clear emotion analysis since
                          // it was derived from the previous text.
                          if (textChanged) {
                            updates.emotionFlow = [];
                            updates.emotionUpdatedAt = null;
                          }
                          const result = await updateRecord(selectedRecord.id, updates);
                          if (result.ok) {
                            toast.success('기록이 수정되었어요.');
                            setIsEditing(false);
                            setEditText('');
                            // Deliberately keep the modal open: it now re-reads
                            // the saved record from the store.
                          } else {
                            toast.error(result.error);
                          }
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                      disabled={isSaving || !editText.trim() || isOffline}
                      className="px-3 py-1.5 rounded-lg bg-coral-fill text-coral-fill-foreground font-bold text-label disabled:opacity-50"
                    >
                      {isSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-muted p-4 rounded-xl">
                  <p className="text-foreground whitespace-pre-wrap text-body break-keep">
                    {selectedRecord.log || '(내용 없음)'}
                  </p>
                </div>
              )}

              {selectedRecord.isPrivate && (
                <div className="flex items-center gap-1.5 text-caption text-warning-foreground bg-warning-surface px-3 py-2 rounded-xl font-medium">
                  <Lock size={13} /> 나에게만 남긴 기록
                </div>
              )}

              {((selectedRecord.attachments && selectedRecord.attachments.length > 0) || canEditMedia) && (
                <div className="space-y-2">
                  <h4 className="text-caption font-bold text-muted-foreground">첨부 파일</h4>
                  {(selectedRecord.attachments || []).map((att, idx) => (
                    <AttachmentMedia
                      key={idx}
                      attachment={att}
                      coupleId={state.profile.couple.coupleId}
                      recordId={selectedRecord.id}
                      variant="detail"
                      footer={
                        /* Removal needs the durable storage path. A legacy
                           attachment without one cannot be addressed in Storage,
                           so no delete control is offered for it. */
                        canEditMedia && att.path ? (
                          <div className="flex justify-end px-3 pb-2 pt-1">
                            <button
                              type="button"
                              onClick={() => void handleRemoveAttachment(att.path!)}
                              disabled={isMediaBusy || isOffline}
                              aria-label={`첨부 ${att.name} 삭제`}
                              className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 text-destructive font-bold text-label disabled:opacity-50"
                            >
                              <Trash2 size={13} /> 첨부 삭제
                            </button>
                          </div>
                        ) : undefined
                      }
                    />
                  ))}

                  {canEditMedia && (
                    <div className="pt-1 space-y-2">
                      <input
                        ref={mediaInputRef}
                        type="file"
                        accept={MEDIA_ACCEPT}
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const files = Array.from(event.target.files || []);
                          event.target.value = '';
                          void handleAddAttachments(files);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => mediaInputRef.current?.click()}
                        disabled={isMediaBusy || isOffline}
                        className="w-full min-h-[44px] rounded-xl border border-dashed border-border text-label font-bold text-muted-foreground disabled:opacity-50"
                      >
                        {isMediaBusy ? '첨부 처리 중...' : '+ 사진 · 영상 · 음성 추가'}
                      </button>
                      {isOffline && (
                        <p className="text-caption text-muted-foreground text-center">
                          오프라인이라 지금은 읽기만 가능해요. 연결되면 다시 시도해 주세요.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/*
                "이따 이야기하기" — available to BOTH partners, which is the
                whole point (PRODUCT_V3 §8). Shared records only: a private
                record has no one to talk to about it, and the DB policy
                refuses it anyway.
              */}
              {!selectedRecord.isPrivate && !isEditing && !showDeleteConfirm && (
                <div className="pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={async () => {
                      if (isOffline) {
                        toast.error(OFFLINE_READONLY_MESSAGE);
                        return;
                      }
                      const marked = isMarkedByViewer(
                        state.talkAboutMarks ?? [], selectedRecord.id, profile.id,
                      );
                      const result = marked
                        ? await unmarkTalkAbout(selectedRecord.id)
                        : await markTalkAbout(selectedRecord.id);
                      if (!result.ok) {
                        toast.error(result.error || '처리하지 못했어요.');
                        return;
                      }
                      toast.success(marked ? '표시를 해제했어요.' : '이따 이야기할 것으로 표시했어요.');
                    }}
                    aria-pressed={isMarkedByViewer(state.talkAboutMarks ?? [], selectedRecord.id, profile.id)}
                    className={cn(
                      'w-full flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-lg font-bold text-label active:scale-95 transition',
                      isMarkedByViewer(state.talkAboutMarks ?? [], selectedRecord.id, profile.id)
                        ? 'bg-coral/10 text-coral-strong border border-coral/30'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    <MessageCircle size={14} aria-hidden="true" />
                    {isMarkedByViewer(state.talkAboutMarks ?? [], selectedRecord.id, profile.id)
                      ? '이따 이야기하기 표시됨'
                      : '이따 이야기하기'}
                  </button>
                  {/*
                    Attribution, not a count of anything hidden: these are
                    marks on a record this viewer is already reading.
                  */}
                  {(state.talkAboutMarks ?? []).some(
                    (m) => m.recordId === selectedRecord.id && m.actorUserId !== profile.id,
                  ) && (
                    <p className="text-caption text-muted-foreground mt-1.5 text-center">
                      {profile.couple.partnerName || '상대방'}도 이 기록을 표시했어요.
                    </p>
                  )}
                </div>
              )}

              {/* Derived on the fly from the record's confirmed emotions. The
                  record here is already sanitised for this viewer, so a
                  partner never sees author-only items in it. */}
              <EmotionFlowInsightCard items={selectedRecord.emotionFlow} variant="detail" />

              {/* Author-only: fix a wrong reading after the fact. Before this, a
                  saved flow was permanent, which is the defect the product owner
                  named as the app's biggest problem. */}
              {isOwnRecord(selectedRecord, { userId: profile.id, role: profile.role }) && !isEditing && !showDeleteConfirm && (
                <div className="pt-2 border-t border-border">
                  <RecordEmotionCorrection
                    record={selectedRecord}
                    disabled={isOffline}
                    disabledReason={OFFLINE_READONLY_MESSAGE}
                    onSave={async (emotionFlow) => {
                      const result = await updateRecord(selectedRecord.id, {
                        emotionFlow,
                        emotionUpdatedAt: new Date().toISOString(),
                      });
                      return result.ok ? { ok: true } : { ok: false, error: result.error };
                    }}
                  />
                </div>
              )}

              {/* Owner-only edit/delete controls. Partner records NEVER show these. */}
              {isOwnRecord(selectedRecord, { userId: profile.id, role: profile.role }) && !isEditing && !showDeleteConfirm && (
                <div className="flex gap-2 pt-2 border-t border-border">
                  <button
                    onClick={() => {
                      setEditText(selectedRecord.log || '');
                      setIsEditing(true);
                    }}
                    className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] min-w-[44px] rounded-lg bg-muted text-foreground font-bold text-label active:scale-95 transition"
                  >
                    <Pencil size={13} /> 수정
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] min-w-[44px] rounded-lg bg-destructive/10 text-destructive font-bold text-label active:scale-95 transition"
                  >
                    <Trash2 size={13} /> 삭제
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </MobileShell>
  );
}
