import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/useStore';
import { generateDailySummary } from '@/lib/briefing';
import { useEscapeKey } from '@/lib/hooks';
import { scrollBehavior } from '@/lib/motion';
import { visibleRecordsForViewer, isOwnRecord } from '@/lib/privacy';
import { EmotionFlowInsightCard } from '@/components/EmotionFlowInsightCard';
import { RecordEmotionCorrection } from '@/components/RecordEmotionCorrection';
import { EmotionFlowSummarySection } from '@/components/EmotionFlowSummarySection';
import {
  ChevronLeft, ChevronRight, Lock, Unlock,
  Image as ImageIcon, Mic, Film, Sparkles, Clock, Calendar,
  Pencil, Trash2,
} from 'lucide-react';
import { cn, formatLocalDate, toLocalDateString, localToday } from '@/lib/utils';
import { parseTripPeriodParams, recordsInInclusiveRange } from '@/lib/trips';
import { toast } from 'sonner';
import { MEDIA_ACCEPT, classifyMediaFile } from '@/lib/records';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { serverErrorMessage } from '@/lib/serverErrors';
import { AttachmentMedia } from '@/components/AttachmentMedia';
import type { DailyRecord, ServerErrorKind } from '@/types';

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

  const closeSelectedRecord = useCallback(() => {
    setSelectedRecordId(null);
    setIsEditing(false);
    setEditText('');
    setShowDeleteConfirm(false);
  }, []);
  useEscapeKey(closeSelectedRecord, selectedRecordId !== null);

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
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">기록</h1>
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className={cn(
              'p-2.5 rounded-2xl transition active:scale-95 flex items-center justify-center min-h-[44px] min-w-[44px]',
              showCalendar
                ? 'bg-coral text-coral-foreground shadow-sm'
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
              <p className="text-sm font-bold text-foreground">
                {periodTrip ? `${periodTrip.title} 여행 기간` : '여행 기간 기록'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatLocalDate(tripPeriod.from)} ~ {formatLocalDate(tripPeriod.to)} · 이 기간의 기록만 표시해요.
              </p>
              {!periodTrip && (
                <p className="text-[11px] text-amber-700 mt-1">여행 정보를 찾을 수 없지만, 유효한 기간 필터는 유지했어요.</p>
              )}
            </div>
            <button onClick={() => navigate('/record', { replace: true })} className="shrink-0 text-xs font-bold text-coral underline">기간 보기 해제</button>
          </div>
        ) : hasTripPeriodQuery ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-800">여행 기간 정보가 올바르지 않아 전체 기록을 표시해요.</p>
            <button onClick={() => navigate('/record', { replace: true })} className="shrink-0 text-xs font-bold text-amber-800 underline">지우기</button>
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
                <h2 className="text-base font-bold text-foreground">
                  {viewYear}년 {viewMonth + 1}월
                </h2>
                {!(viewYear === today.getFullYear() && viewMonth === today.getMonth()) && (
                  <button
                    onClick={goToToday}
                    className="text-[11px] font-bold text-coral bg-coral/10 px-3 py-1.5 rounded-lg active:scale-95 transition min-h-[36px] flex items-center justify-center"
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
                  'text-center text-[11px] font-bold py-2',
                  i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-muted-foreground'
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
                    isSelected && 'bg-coral text-coral-foreground',
                    !isSelected && isTodayCell && 'ring-2 ring-coral/50 ring-inset rounded-lg',
                  )}
                >
                  <span
                    className={cn(
                      'text-sm font-semibold leading-none',
                      !cell.inMonth && 'text-muted-foreground/30',
                      cell.inMonth && !isSelected && isFuture && 'text-muted-foreground/50',
                      cell.inMonth && !isSelected && !isFuture && dow === 0 && 'text-red-400',
                      cell.inMonth && !isSelected && !isFuture && dow === 6 && 'text-blue-400',
                      isSelected && 'text-coral-foreground',
                    )}
                  >
                    {cell.date.getDate()}
                  </span>

                  {/* Record indicator dots */}
                  {cell.inMonth && !isFuture && recordCount > 0 && (
                    <div className="flex items-center gap-[3px] mt-0.5 h-[6px]" aria-hidden="true">
                      <span className={cn(
                        'w-[5px] h-[5px] rounded-full',
                        isSelected ? 'bg-coral-foreground/80' : 'bg-coral'
                      )} />
                      {hasMedia && (
                        <span className={cn(
                          'w-[5px] h-[5px] rounded-full',
                          isSelected ? 'bg-coral-foreground/60' : 'bg-coral/50'
                        )} />
                      )}
                      {recordCount >= 4 && (
                        <span className={cn(
                          'w-[5px] h-[5px] rounded-full',
                          isSelected ? 'bg-coral-foreground/40' : 'bg-coral/30'
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
          <div className="text-center py-4 text-muted-foreground text-xs">
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
            <h3 className="text-sm font-bold text-foreground">
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
            <div className="flex items-center gap-1.5 px-1 mb-2 text-[11px] text-muted-foreground">
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
          <div className="mb-4 rounded-2xl bg-lilac/30 border border-lilac/50 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-foreground mb-0.5">
              <div className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-coral" />
                <span>{isToday ? '오늘의 빠른 정리' : '그날의 빠른 정리'}</span>
              </div>
              <span className="text-[10px] text-foreground/50 font-normal">눌러서 원문 이동</span>
            </div>
            {selectedDaySummary.items.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSummaryItemClick(item.recordIds[0])}
                className="w-full text-left p-2 rounded-xl bg-card/60 hover:bg-card transition flex items-center justify-between text-xs font-medium text-foreground group active:scale-[0.99]"
              >
                <span className="leading-snug flex-1 pr-2">• {item.text}</span>
                <ChevronRight size={13} className="text-foreground/30 group-hover:text-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Media Filter Chips */}
        {selectedDayAllRecords.length > 0 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setMediaFilter(f.key)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition min-h-[32px]',
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

        {/* Day Timeline */}
        <div className="space-y-3">
          {selectedDayRecords.length === 0 ? (
            <div className="rounded-2xl bg-card border border-border/60 p-8 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📖</div>
              <p className="text-sm font-semibold">
                {selectedDayAllRecords.length === 0
                  ? '이 날은 남긴 순간이 없어요'
                  : '선택한 유형의 기록이 없어요'}
              </p>
              <p className="text-xs mt-1 text-muted-foreground/70">
                {selectedDayAllRecords.length === 0
                  ? '달력에서 점이 있는 날짜를 눌러보세요'
                  : '다른 필터를 선택해보세요'}
              </p>
            </div>
          ) : (
            selectedDayRecords.map((r) => {
              const isOwn = r.authorRole === profile.role;
              const isHighlighted = state.highlightedRecordId === r.id;

              return (
                <div
                  id={`record-${r.id}`}
                  key={r.id}
                  onClick={() => setSelectedRecordId(r.id)}
                  className={cn(
                    'rounded-2xl bg-card border p-4 shadow-sm space-y-2 cursor-pointer active:scale-[0.98] transition-all duration-500',
                    isHighlighted
                      ? 'border-coral ring-4 ring-coral/30 bg-coral/5 scale-[1.01]'
                      : 'border-border/60'
                  )}
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{r.time}</span>
                      <span className="text-muted-foreground/70">{isOwn ? '나' : partnerDisplayName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {r.reaction && (
                        <span className="px-2 py-0.5 rounded-full bg-coral/10 text-coral font-medium text-[11px]">
                          {REACTION_LABELS[r.reaction] || r.reaction}
                        </span>
                      )}
                      {r.isPrivate ? (
                        <span className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-medium text-[11px]">
                          <Lock size={10} /> 나에게만
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50 text-[11px]">
                          <Unlock size={10} className="inline" />
                        </span>
                      )}
                    </div>
                  </div>

                  {r.log && (
                    <p className="text-sm text-foreground leading-relaxed">{r.log}</p>
                  )}

                  {r.attachments && r.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {r.attachments.map((att, i) => (
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
                </div>
              );
            })
          )}
        </div>

      {/* Floating CTA Button: + 지금의 마음 남기기 */}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-[400px] px-6 z-40">
        <button
          onClick={() => navigate('/home')}
          className="w-full py-3.5 rounded-full bg-coral text-coral-foreground font-extrabold text-sm shadow-xl active:scale-[0.98] transition flex items-center justify-center gap-2 border border-coral-foreground/20 backdrop-blur-xs"
        >
          <span className="text-lg">+</span>
          <span>지금의 마음 남기기</span>
        </button>
      </div>

      {/*
        Detail Modal.

        z-[60], not z-50: MobileShell's tab bar is `fixed bottom-0 ... z-50` and
        comes AFTER <main> in the DOM, so at an equal z-index it paints over a
        bottom-anchored sheet and swallows the taps aimed at the owner-only
        수정 / 삭제 buttons. SchedulePage's event modal already sits at z-[60].
      */}
      {selectedRecord && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-sm p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="record-detail-modal-title" className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 id="record-detail-modal-title" className="text-lg font-bold text-card-foreground">
                {formatLocalDate(selectedRecord.date)} {selectedRecord.time}
              </h3>
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
                <p className="text-sm font-bold text-destructive">이 기록을 삭제할까요?</p>
                <p className="text-xs text-muted-foreground">삭제하면 되돌릴 수 없어요.</p>
                {isOffline && (
                  <p className="text-xs text-muted-foreground">{OFFLINE_READONLY_MESSAGE}</p>
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
                    className="px-4 py-2 rounded-lg bg-destructive text-destructive-foreground font-bold text-xs disabled:opacity-50"
                  >
                    {isSaving ? '삭제 중...' : '삭제'}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 rounded-lg bg-muted text-muted-foreground font-bold text-xs"
                  >
                    취소
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {selectedRecord.reaction && (
                <div className="px-3 py-1.5 rounded-full bg-coral/10 text-coral text-xs font-semibold inline-block">
                  {REACTION_LABELS[selectedRecord.reaction]}
                </div>
              )}

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    aria-label="기록 내용 수정"
                    className="w-full h-32 bg-muted rounded-xl p-3 text-sm text-foreground outline-none resize-none placeholder:text-muted-foreground"
                    placeholder="기록 내용을 입력하세요"
                  />
                  {/* Say it before saving, not after: the confirmations were
                      derived from the previous text, so they get cleared. */}
                  {editText.trim() !== (selectedRecord.log ?? '').trim() && (
                    <p className="text-xs text-muted-foreground">
                      내용을 바꾸면 이전 글에서 고른 마음은 지워져요.
                    </p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditText('');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground font-bold text-xs"
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
                      className="px-3 py-1.5 rounded-lg bg-coral text-coral-foreground font-bold text-xs disabled:opacity-50"
                    >
                      {isSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-muted p-4 rounded-xl">
                  <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed">
                    {selectedRecord.log || '(내용 없음)'}
                  </p>
                </div>
              )}

              {selectedRecord.isPrivate && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl font-medium">
                  <Lock size={13} /> 나에게만 남긴 기록
                </div>
              )}

              {((selectedRecord.attachments && selectedRecord.attachments.length > 0) || canEditMedia) && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-muted-foreground">첨부 파일</h4>
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
                              className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 text-destructive font-bold text-xs disabled:opacity-50"
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
                        className="w-full min-h-[44px] rounded-xl border border-dashed border-border text-xs font-bold text-muted-foreground disabled:opacity-50"
                      >
                        {isMediaBusy ? '첨부 처리 중...' : '+ 사진 · 영상 · 음성 추가'}
                      </button>
                      {isOffline && (
                        <p className="text-[11px] text-muted-foreground text-center">
                          오프라인이라 지금은 읽기만 가능해요. 연결되면 다시 시도해 주세요.
                        </p>
                      )}
                    </div>
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
                    className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] min-w-[44px] rounded-lg bg-muted text-foreground font-bold text-xs active:scale-95 transition"
                  >
                    <Pencil size={13} /> 수정
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center justify-center gap-1.5 px-4 min-h-[44px] min-w-[44px] rounded-lg bg-destructive/10 text-destructive font-bold text-xs active:scale-95 transition"
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
