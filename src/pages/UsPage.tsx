import { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { MobileShell } from '@/components/MobileShell';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { Heart, Calendar as CalendarIcon, Plane, Plus, ChevronRight, MapPin, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn, toLocalDateString, localToday, formatLocalDate } from '@/lib/utils';
import { getNextAnniversary, validateAnniversary, daysTogether } from '@/lib/insights';
import { toast } from 'sonner';

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
  const { state, updateProfile } = useStore();
  const navigate = useNavigate();
  const { myName } = state.profile;
  const partnerName = state.profile.couple.partnerName || '상대방';
  const connected = state.profile.couple.connected;
  const anniversaryDate = state.profile.couple.anniversaryDate;
  const trips = state.trips || [];
  const events = useMemo(() => state.events || [], [state.events]);

  const today = localToday();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [isEditingAnniversary, setIsEditingAnniversary] = useState(false);
  const [anniversaryDraft, setAnniversaryDraft] = useState(anniversaryDate || '');

  const calendarCells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayStr = toLocalDateString(today);

  // 사귄 날짜가 없으면 임의 날짜를 만들지 않고 미설정 상태로 둡니다.
  const diffDays = daysTogether(anniversaryDate, todayStr);
  const nextAnniversary = useMemo(
    () => getNextAnniversary(anniversaryDate, events, todayStr),
    [anniversaryDate, events, todayStr],
  );

  const handleSaveAnniversary = () => {
    const validated = validateAnniversary(anniversaryDraft, todayStr);
    if (!validated.ok) {
      toast.error(
        validated.reason === 'future'
          ? '사귄 날짜는 오늘보다 뒤일 수 없어요.'
          : '날짜를 선택해 주세요.',
      );
      return;
    }
    updateProfile({
      couple: { ...state.profile.couple, anniversaryDate: validated.value },
    });
    setIsEditingAnniversary(false);
    toast.success('사귄 날짜를 저장했어요.');
  };

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
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">우리</h1>
          <button
            onClick={() => navigate('/trips')}
            className="text-xs font-bold text-coral bg-coral/10 px-3 py-2 rounded-xl active:scale-95 transition flex items-center gap-1"
          >
            <Plane size={14} />
            <span>여행 플래너</span>
          </button>
        </div>

        {/* Profile */}
        <section className="rounded-3xl bg-card border border-border p-5 shadow-sm flex flex-col items-center text-center space-y-4">
          <CoupleAvatar size={64} />
          <div>
            <h2 className="text-lg font-extrabold text-foreground flex items-center justify-center gap-1.5">
              <span>{myName || '나'}</span>
              <Heart size={16} className="text-coral fill-coral animate-pulse" />
              <span>{partnerName}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {!connected
                ? '초대 코드로 커플 공간을 완성해보세요'
                : diffDays !== null
                ? `함께한 지 +${diffDays}일째 💕`
                : '사귄 날짜를 등록하면 D-Day를 세어드려요'}
            </p>
          </div>

          {/* 사귄 날짜 설정 / 수정 */}
          {isEditingAnniversary ? (
            <div className="w-full space-y-2">
              <input
                type="date"
                value={anniversaryDraft}
                max={todayStr}
                onChange={(e) => setAnniversaryDraft(e.target.value)}
                aria-label="사귄 날짜"
                className="w-full border border-border rounded-xl px-3 py-2.5 bg-card text-sm text-foreground min-h-[44px]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsEditingAnniversary(false);
                    setAnniversaryDraft(anniversaryDate || '');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-muted text-foreground text-xs font-bold min-h-[40px]"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveAnniversary}
                  className="flex-1 py-2.5 rounded-xl bg-coral text-white text-xs font-bold min-h-[40px]"
                >
                  저장
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full space-y-2">
              {nextAnniversary && (
                <div className="rounded-2xl bg-coral/10 border border-coral/20 px-3 py-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-coral">
                    다음 기념일 · {nextAnniversary.label}
                  </span>
                  <span className="text-[11px] font-extrabold text-foreground">
                    {nextAnniversary.dDay === 0 ? 'D-Day' : `D-${nextAnniversary.dDay}`}
                  </span>
                </div>
              )}
              <button
                onClick={() => setIsEditingAnniversary(true)}
                className="w-full py-2.5 rounded-xl bg-muted/60 text-foreground text-xs font-bold min-h-[40px] active:scale-95 transition"
              >
                {anniversaryDate
                  ? `사귄 날짜 ${formatLocalDate(anniversaryDate)} · 수정`
                  : '+ 사귄 날짜 등록하기'}
              </button>
            </div>
          )}
        </section>

        {/* Calendar UI */}
        <section className="rounded-3xl bg-card border border-border shadow-sm overflow-hidden p-4">
          <div className="flex items-center justify-between mb-4 px-1">
            <button onClick={goToPrevMonth} className="p-2 rounded-xl hover:bg-muted active:scale-95 transition" aria-label="이전 달">
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-base font-bold text-foreground">
              {viewYear}년 {viewMonth + 1}월
            </h2>
            <button onClick={goToNextMonth} className="p-2 rounded-xl hover:bg-muted active:scale-95 transition" aria-label="다음 달">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-border/40 pb-2 mb-2">
            {WEEKDAYS.map((day, i) => (
              <div key={day} className={cn("text-center text-[10px] font-bold", i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-muted-foreground')}>
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
                    'text-xs font-semibold leading-none w-6 h-6 flex items-center justify-center rounded-full',
                    isToday ? 'bg-coral text-white' : '',
                    !isToday && dow === 0 ? 'text-red-400' : '',
                    !isToday && dow === 6 ? 'text-blue-400' : '',
                    !isToday && cell.inMonth && dow !== 0 && dow !== 6 ? 'text-foreground' : ''
                  )}>
                    {cell.date.getDate()}
                  </span>
                  
                  <div className="flex gap-1 mt-1">
                    {hasTrip && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    {hasEvent && <span className="w-1.5 h-1.5 rounded-full bg-coral" />}
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="flex justify-end gap-3 mt-4 text-[10px] font-bold text-muted-foreground px-2">
            <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />여행</div>
            <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-coral" />일정</div>
          </div>
        </section>

        {/* Travel Planner & Events */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              <Plane className="w-4 h-4 text-blue-500" /> 다가오는 여행
            </h3>
            <button onClick={() => navigate('/trips')} className="text-xs font-bold text-muted-foreground hover:text-foreground">
              전체보기
            </button>
          </div>
          
          {trips.length > 0 ? (
            <div className="space-y-2">
              {trips.map((trip) => (
                <div key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)} className="p-4 rounded-2xl bg-card border border-border shadow-sm active:scale-[0.98] transition cursor-pointer flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                      <MapPin size={14} className="text-blue-500" /> {trip.title}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-medium">{trip.startDate} ~ {trip.endDate}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground/50" />
                </div>
              ))}
            </div>
          ) : (
            <div onClick={() => navigate('/trips')} className="p-4 rounded-2xl bg-muted/40 border border-dashed border-border/60 text-center cursor-pointer hover:bg-muted/60 transition">
              <p className="text-xs font-bold text-muted-foreground mb-1">+ 새로운 여행 계획하기</p>
            </div>
          )}
        </section>

      </div>
    </MobileShell>
  );
}
