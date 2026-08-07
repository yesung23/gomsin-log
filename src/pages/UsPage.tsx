import { useState, useMemo } from 'react';
import { useStore } from '@/lib/useStore';
import { MobileShell } from '@/components/MobileShell';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { Heart, Calendar as CalendarIcon, CalendarDays, Plane, Plus, ChevronRight, MapPin, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn, toLocalDateString, localToday, daysBetweenLocal } from '@/lib/utils';

function buildCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); 
  const totalDays = lastDay.getDate();

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month, -i), inMonth: false });
  }
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
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

export function UsPage() {
  const { state, coupleLifecycle } = useStore();
  const navigate = useNavigate();
  const { myName } = state.profile;
  const partnerName = state.profile.couple.partnerName || '상대방';
  const connected = state.profile.couple.connected;
  /**
   * M-1: no invented anniversary. This used to fall back to a fixed literal and
   * then render a confident `함께한 지 +N일째` for a couple that never entered a
   * date (`sync.ts` maps a null column to `''`). `DDayWidget` already renders
   * `기념일 미설정` in that case; this surface now agrees with it.
   */
  const anniversaryDate = state.profile.couple.anniversaryDate || undefined;
  const trips = state.trips || [];
  const events = state.events || [];

  const today = localToday();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const calendarCells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayStr = toLocalDateString(today);

  const diffDays = anniversaryDate
    ? daysBetweenLocal(anniversaryDate, todayStr) + 1
    : null;

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

  const hasEventOrTrip = (dateStr: string) => {
    const hasEvent = events.some(e => {
      const eventEndDate = e.endDate || e.startDate;
      return e.startDate <= dateStr && eventEndDate >= dateStr;
    });
    const hasTrip = trips.some(t => t.startDate <= dateStr && t.endDate >= dateStr);
    return { hasEvent, hasTrip };
  };

  return (
    <MobileShell>
      <div className="pb-28 px-5 pt-8 space-y-5">
        <div className="flex items-center justify-between px-1">
          <h1 className="text-title tracking-tight text-foreground">우리</h1>
          <div className="flex items-center gap-2">
            {/* /schedule had no entry point anywhere in the UI before this. */}
            <button
              onClick={() => navigate('/schedule')}
              className="text-label font-bold text-foreground bg-navy/10 px-3 py-2 rounded-xl active:scale-95 transition flex items-center gap-1"
            >
              <CalendarDays size={14} />
              <span>일정</span>
            </button>
            <button
              onClick={() => navigate('/trips')}
              className="text-label font-bold text-coral-strong bg-coral/10 px-3 py-2 rounded-xl active:scale-95 transition flex items-center gap-1"
            >
              <Plane size={14} />
              <span>여행</span>
            </button>
          </div>
        </div>

        {/* Profile */}
        <section className="rounded-surface bg-card border border-border p-5 shadow-sm flex flex-col items-center text-center space-y-4">
          <CoupleAvatar size={64} />
          <div>
            <h2 className="text-heading text-foreground flex items-center justify-center gap-1.5">
              <span>{myName || '나'}</span>
              <Heart size={16} className="text-coral fill-coral animate-pulse" />
              <span>{partnerName}</span>
            </h2>
            {/* Role/lifecycle correct. The previous copy was a single line for
                every non-connected state -- "초대 코드로 커플 공간을 완성해보세요" --
                which reads as "enter a code" and is exactly wrong for the creator
                who is holding one. */}
            <p className="text-caption text-muted-foreground mt-1 font-medium">
              {connected
                ? diffDays !== null
                  ? `함께한 지 +${diffDays}일째 💕`
                  : '기념일 미설정 · 설정에서 사귄 날짜를 추가해 보세요'
                : coupleLifecycle === 'pending'
                  ? '상대방이 초대 코드를 입력하면 연결돼요'
                  : coupleLifecycle === 'disconnected'
                    ? '커플 공간 연결이 해제되었어요'
                    : coupleLifecycle === 'unknown'
                      ? '커플 공간 상태를 확인하고 있어요'
                      : '우리 공간을 만들거나 초대 코드를 입력해 보세요'}
            </p>
          </div>
        </section>

        <CoupleStatusBanner />

        {/* Calendar UI */}
        <section className="rounded-surface bg-card border border-border shadow-sm overflow-hidden p-4">
          <div className="flex items-center justify-between mb-4 px-1">
            <button onClick={goToPrevMonth} className="p-2 rounded-xl hover:bg-muted active:scale-95 transition" aria-label="이전 달">
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-heading text-foreground">
              {viewYear}년 {viewMonth + 1}월
            </h2>
            <button onClick={goToNextMonth} className="p-2 rounded-xl hover:bg-muted active:scale-95 transition" aria-label="다음 달">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-border/40 pb-2 mb-2">
            {WEEKDAYS.map((day, i) => (
              <div key={day} className={cn("text-center text-caption font-bold", i === 0 ? 'text-destructive' : i === 6 ? 'text-info' : 'text-muted-foreground')}>
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-2">
            {calendarCells.map((cell, idx) => {
              const dateStr = toLocalDateString(cell.date);
              const isToday = dateStr === todayStr;
              const dow = cell.date.getDay();
              const { hasEvent, hasTrip } = hasEventOrTrip(dateStr);

              return (
                <div key={idx} className={cn('relative flex flex-col items-center justify-start h-10', !cell.inMonth && 'opacity-30')}>
                  <span className={cn(
                    'text-label font-semibold leading-none w-6 h-6 flex items-center justify-center rounded-full',
                    isToday ? 'bg-coral-strong text-coral-strong-foreground' : '',
                    !isToday && dow === 0 ? 'text-destructive' : '',
                    !isToday && dow === 6 ? 'text-info' : '',
                    !isToday && cell.inMonth && dow !== 0 && dow !== 6 ? 'text-foreground' : ''
                  )}>
                    {cell.date.getDate()}
                  </span>
                  
                  <div className="flex gap-1 mt-1">
                    {hasTrip && <span className="w-1.5 h-1.5 rounded-full bg-info" />}
                    {hasEvent && <span className="w-1.5 h-1.5 rounded-full bg-coral" />}
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="flex justify-end gap-3 mt-4 text-caption font-bold text-muted-foreground px-2">
            <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-info" />여행</div>
            <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-coral" />일정</div>
          </div>
        </section>

        {/* Travel Planner & Events */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-heading text-foreground flex items-center gap-2">
              <Plane className="w-4 h-4 text-info" /> 다가오는 여행
            </h3>
            <button onClick={() => navigate('/trips')} className="text-label font-bold text-muted-foreground hover:text-foreground">
              전체보기
            </button>
          </div>
          
          {trips.length > 0 ? (
            <div className="space-y-2">
              {trips.map((trip) => (
                /*
                  A real <button>, not a clickable <div>: the trip list is the only
                  way into a trip from 우리, and as a div it was in no tab order and
                  answered no key, so the whole 여행 section was pointer-only.
                */
                <button
                  key={trip.id}
                  type="button"
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  aria-label={`${trip.title} 여행 상세 보기`}
                  className="w-full text-left p-4 min-h-[44px] rounded-2xl bg-card border border-border shadow-sm active:scale-[0.98] transition cursor-pointer flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-label font-bold text-foreground">
                      <MapPin size={14} className="text-info" aria-hidden="true" /> {trip.title}
                    </div>
                    <p className="text-caption text-muted-foreground font-medium">{trip.startDate} ~ {trip.endDate}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground/50" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/trips')}
              className="w-full p-4 min-h-[44px] rounded-2xl bg-muted/40 border border-dashed border-border/60 text-center cursor-pointer hover:bg-muted/60 transition"
            >
              <p className="text-label font-bold text-muted-foreground mb-1">+ 새로운 여행 계획하기</p>
            </button>
          )}
        </section>

      </div>
    </MobileShell>
  );
}
