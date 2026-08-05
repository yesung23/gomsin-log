import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/store';
import { generateDailySummary } from '@/lib/briefing';
import {
  ChevronLeft, ChevronRight, Lock, Unlock,
  Image as ImageIcon, Mic, Film, Sparkles, Clock, Calendar
} from 'lucide-react';
import { cn, formatLocalDate, toLocalDateString, localToday, parseLocalDate } from '@/lib/utils';
import { toast } from 'sonner';
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
  const { state, setHighlightedRecordId } = useStore();
  const { records, profile } = state;
  const today = localToday();
  const todayStr = toLocalDateString(today);

  // Calendar state
  const [showCalendar, setShowCalendar] = useState(false);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [selectedRecord, setSelectedRecord] = useState<DailyRecord | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // 위젯/브리핑에서 넘어온 ?date=YYYY-MM-DD&record=<id> 를 처리합니다.
  const [searchParams] = useSearchParams();
  const appliedParamsRef = useRef<string | null>(null);

  useEffect(() => {
    const dateParam = searchParams.get('date');
    const recordParam = searchParams.get('record');
    const key = `${dateParam ?? ''}|${recordParam ?? ''}`;
    if (appliedParamsRef.current === key) return;
    appliedParamsRef.current = key;

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const parsed = parseLocalDate(dateParam);
      setSelectedDate(dateParam);
      setViewYear(parsed.getFullYear());
      setViewMonth(parsed.getMonth());
      setMediaFilter('all');
    }

    if (recordParam) {
      setHighlightedRecordId(recordParam);
      setTimeout(() => {
        document
          .getElementById(`record-${recordParam}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    }
  }, [searchParams, setHighlightedRecordId]);

  // Compute visible records (own records + partner's non-private records)
  const visibleRecords = useMemo(() => {
    return records.filter((r) => {
      const isOwn = r.authorRole === profile.role;
      if (!isOwn && r.isPrivate) return false;
      return true;
    });
  }, [records, profile.role]);

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
      timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // Summary item click -> scroll to record
  const handleSummaryItemClick = (recordId?: string) => {
    if (!recordId) return;
    setHighlightedRecordId(recordId);
    const el = document.getElementById(`record-${recordId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                ? 'bg-coral text-white shadow-sm'
                : 'bg-card border border-border text-foreground hover:bg-muted'
            )}
            aria-label="달력 보기"
          >
            <Calendar size={20} />
          </button>
        </div>

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

              return (
                <button
                  key={idx}
                  onClick={() => cell.inMonth && handleDateSelect(dateStr)}
                  disabled={!cell.inMonth}
                  aria-label={ariaLabel}
                  className={cn(
                    'relative flex flex-col items-center justify-center py-1.5 min-h-[44px] transition-colors',
                    !cell.inMonth && 'opacity-0 pointer-events-none',
                    cell.inMonth && !isSelected && 'hover:bg-muted/50 active:bg-muted',
                    isSelected && 'bg-coral text-white',
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
                      isSelected && 'text-white',
                    )}
                  >
                    {cell.date.getDate()}
                  </span>

                  {/* Record indicator dots */}
                  {cell.inMonth && !isFuture && recordCount > 0 && (
                    <div className="flex items-center gap-[3px] mt-0.5 h-[6px]" aria-hidden="true">
                      <span className={cn(
                        'w-[5px] h-[5px] rounded-full',
                        isSelected ? 'bg-white/80' : 'bg-coral'
                      )} />
                      {hasMedia && (
                        <span className={cn(
                          'w-[5px] h-[5px] rounded-full',
                          isSelected ? 'bg-white/60' : 'bg-coral/50'
                        )} />
                      )}
                      {recordCount >= 4 && (
                        <span className={cn(
                          'w-[5px] h-[5px] rounded-full',
                          isSelected ? 'bg-white/40' : 'bg-coral/30'
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
            <div className="flex items-center justify-between text-xs font-bold text-navy mb-0.5">
              <div className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-coral" />
                <span>{isToday ? '오늘의 빠른 정리' : '그날의 빠른 정리'}</span>
              </div>
              <span className="text-[10px] text-navy/50 font-normal">눌러서 원문 이동</span>
            </div>
            {selectedDaySummary.items.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSummaryItemClick(item.recordIds[0])}
                className="w-full text-left p-2 rounded-xl bg-white/60 hover:bg-white transition flex items-center justify-between text-xs font-medium text-navy group active:scale-[0.99]"
              >
                <span className="leading-snug flex-1 pr-2">• {item.text}</span>
                <ChevronRight size={13} className="text-navy/30 group-hover:text-navy shrink-0" />
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
                    ? 'bg-navy text-white'
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
                  onClick={() => setSelectedRecord(r)}
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
                        <div key={i} className="rounded-xl overflow-hidden bg-muted border border-border">
                          {att.type === 'photo' && att.url ? (
                            <img src={att.url} alt={att.name} className="w-full h-36 object-cover rounded-xl" />
                          ) : (
                            <div className="p-3 text-xs flex items-center gap-2 font-medium">
                              {att.type === 'photo' && <ImageIcon size={16} className="text-coral" />}
                              {att.type === 'video' && <Film size={16} className="text-blue-500" />}
                              {att.type === 'voice' && <Mic size={16} className="text-purple-500" />}
                              <span>{att.name}</span>
                            </div>
                          )}
                        </div>
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
          className="w-full py-3.5 rounded-full bg-coral text-white font-extrabold text-sm shadow-xl active:scale-[0.98] transition flex items-center justify-center gap-2 border border-white/20 backdrop-blur-xs"
        >
          <span className="text-lg">+</span>
          <span>지금의 마음 남기기</span>
        </button>
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {formatLocalDate(selectedRecord.date)} {selectedRecord.time}
              </h3>
              <button
                onClick={() => setSelectedRecord(null)}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 min-w-[44px] min-h-[44px]"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {selectedRecord.reaction && (
                <div className="px-3 py-1.5 rounded-full bg-coral/10 text-coral text-xs font-semibold inline-block">
                  {REACTION_LABELS[selectedRecord.reaction]}
                </div>
              )}

              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
                  {selectedRecord.log || '(내용 없음)'}
                </p>
              </div>

              {selectedRecord.isPrivate && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-xl font-medium">
                  <Lock size={13} /> 나에게만 남긴 기록
                </div>
              )}

              {selectedRecord.attachments && selectedRecord.attachments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gray-500">첨부 파일</h4>
                  {selectedRecord.attachments.map((att, idx) => (
                    <div key={idx} className="rounded-xl overflow-hidden bg-muted border border-border">
                      {att.type === 'photo' && att.url ? (
                        <img src={att.url} alt={att.name} className="w-full h-48 object-cover rounded-xl" />
                      ) : (
                        <div className="p-3 text-xs flex items-center gap-2 font-medium">
                          {att.type === 'photo' && <ImageIcon size={16} className="text-coral" />}
                          {att.type === 'video' && <Film size={16} className="text-blue-500" />}
                          {att.type === 'voice' && <Mic size={16} className="text-purple-500" />}
                          <span>{att.name}</span>
                        </div>
                      )}
                    </div>
                  ))}
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
