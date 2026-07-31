import { useState } from 'react';
import { useStore } from '@/lib/useStore';
import { MobileShell } from '@/components/MobileShell';
import { 
  Calendar as CalendarIcon, Heart, ShieldCheck, Clock, Plus, 
  Trash2, X, ChevronLeft, ChevronRight, CheckCircle2, Lock, Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { EventType, CoupleEvent } from '@/types';

export function SchedulePage() {
  const { state, addEvent, deleteEvent } = useStore();
  const { profile, events } = state;
  const partnerName = profile.couple.partnerName || '상대방';
  const startDate = profile.couple.anniversaryDate || '2024-12-24';

  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<EventType>('visit');
  const [eventStartDate, setEventStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [eventEndDate, setEventEndDate] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  // Calendar State
  const [currMonth, setCurrMonth] = useState(new Date().getMonth());
  const [currYear, setCurrYear] = useState(new Date().getFullYear());

  // D-Day calculations
  const daysTogether = Math.floor(
    (new Date().getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  const next100Days = Math.ceil(daysTogether / 100) * 100;
  const daysUntilNext100 = next100Days - daysTogether;

  const handlePrevMonth = () => {
    if (currMonth === 0) {
      setCurrMonth(11);
      setCurrYear((prev) => prev - 1);
    } else {
      setCurrMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currMonth === 11) {
      setCurrMonth(0);
      setCurrYear((prev) => prev + 1);
    } else {
      setCurrMonth((prev) => prev + 1);
    }
  };

  const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currYear, currMonth, 1).getDay();

  const handleCreateEvent = async () => {
    if (!title.trim()) {
      toast.error('일정 제목을 입력해 주세요.');
      return;
    }

    // Placeholder ids used to be substituted here ('demo-couple-id' /
    // 'demo-user-id'). Outside demo mode those produce rows that violate the
    // `created_by = auth.uid()` check, so the insert failed with a confusing
    // error. Fail early with an actionable message instead.
    if (!state.isDemoMode) {
      if (!profile.couple.coupleId) {
        toast.error('우리 공간이 연결된 뒤에 일정을 등록할 수 있어요.');
        return;
      }
      if (!profile.id) {
        toast.error('로그인 정보를 확인하지 못했어요. 앱을 새로고침한 뒤 다시 시도해 주세요.');
        return;
      }
    }

    const newEventPayload: Omit<CoupleEvent, 'id' | 'createdAt'> = {
      coupleId: profile.couple.coupleId || 'demo-couple-id',
      createdBy: profile.id || 'demo-user-id',
      title: title.trim(),
      eventType,
      startDate: eventStartDate,
      endDate: eventEndDate || undefined,
      isPrivate,
    };

    setIsSaving(true);
    const saved = await addEvent(newEventPayload);
    setIsSaving(false);

    if (!saved) {
      toast.error('일정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    toast.success('새 일정이 등록되었습니다.');
    setShowAddModal(false);
    setTitle('');
    setIsPrivate(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    setDeletingEventId(eventId);
    const deleted = await deleteEvent(eventId);
    setDeletingEventId(null);

    if (deleted) {
      toast.info('일정이 삭제되었습니다.');
    } else {
      toast.error('일정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  const getEventBadge = (type: EventType) => {
    switch (type) {
      case 'visit': return { label: '면회', color: 'bg-emerald-500/10 text-emerald-600' };
      case 'vacation': return { label: '휴가', color: 'bg-coral/10 text-coral' };
      case 'anniversary': return { label: '기념일', color: 'bg-purple-500/10 text-purple-600' };
      case 'trip': return { label: '여행', color: 'bg-blue-500/10 text-blue-600' };
      default: return { label: '약속', color: 'bg-navy/10 text-navy' };
    }
  };

  const getDDayStr = (targetDateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDateStr);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return 'D-DAY';
    if (diff > 0) return `D-${diff}`;
    return `D+${Math.abs(diff)}`;
  };

  return (
    <MobileShell>
      <div className="pb-28 px-5 pt-8 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">공유 일정</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {partnerName}님과 함께 기다릴 미래의 중요한 날을 맞추어보세요.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="p-2.5 rounded-xl bg-coral text-white font-bold text-xs flex items-center gap-1 shadow-sm active:scale-95 transition min-h-[44px]"
          >
            <Plus size={16} />
            <span>일정 추가</span>
          </button>
        </header>

        {/* D-Day Together Card */}
        <section className="rounded-3xl bg-card border border-border p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-coral">
            <span className="flex items-center gap-1.5">
              <Heart size={14} className="fill-coral animate-pulse" />
              <span>함께한 지</span>
            </span>
            <span className="text-muted-foreground font-medium">사귄 날 {startDate}</span>
          </div>
          <div className="text-3xl font-extrabold text-foreground">
            +{daysTogether}일 <span className="text-xs font-normal text-muted-foreground">째 사랑 중 💕</span>
          </div>
        </section>

        {/* Monthly Calendar View */}
        <section className="rounded-3xl bg-card border border-border p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-foreground">
              {currYear}년 {currMonth + 1}월
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-muted-foreground pb-1">
            <span className="text-red-400">일</span>
            <span>월</span>
            <span>화</span>
            <span>수</span>
            <span>목</span>
            <span>금</span>
            <span className="text-blue-400">토</span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="h-8" />
            ))}

            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const dayEvents = events.filter((e) => e.startDate === dateStr);
              const isToday = new Date().toISOString().split('T')[0] === dateStr;

              return (
                <div
                  key={dayNum}
                  className={`h-9 rounded-xl flex flex-col items-center justify-center relative text-xs font-semibold ${
                    isToday ? 'bg-coral text-white font-extrabold shadow-sm' : 'hover:bg-muted/50 text-foreground'
                  }`}
                >
                  <span>{dayNum}</span>
                  {dayEvents.length > 0 && (
                    <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${isToday ? 'bg-white' : 'bg-coral'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Upcoming Events List */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-foreground px-1">다가오는 공유 일정 목록</h2>

          <div className="space-y-2">
            {/* Automatic 100-Day Anniversary Badge */}
            <div className="rounded-2xl bg-card border border-border p-4 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold text-sm">
                  <CalendarIcon size={20} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-foreground">다음 {next100Days}일 기념일</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{daysUntilNext100}일 남음</p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-xl bg-purple-500/15 text-purple-600 font-bold text-xs">
                D-{daysUntilNext100}
              </span>
            </div>

            {/* DB Store Events */}
            {events.map((ev) => {
              const badge = getEventBadge(ev.eventType);
              const ddayStr = getDDayStr(ev.startDate);
              return (
                <div
                  key={ev.id}
                  className="rounded-2xl bg-card border border-border p-4 shadow-sm flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${badge.color} flex items-center justify-center font-bold text-xs`}>
                      {badge.label}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-xs font-bold text-foreground">{ev.title}</h3>
                        {ev.isPrivate && <Lock size={12} className="text-muted-foreground" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {ev.startDate} {ev.endDate ? `~ ${ev.endDate}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-xl font-bold text-xs ${badge.color}`}>
                      {ddayStr}
                    </span>
                    {(state.isDemoMode || ev.createdBy === state.authenticatedUser?.id) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteEvent(ev.id)}
                        disabled={deletingEventId === ev.id}
                        aria-label={`${ev.title} 일정 삭제`}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {events.length === 0 && (
              <div className="rounded-2xl bg-card border border-dashed border-border/80 p-6 text-center text-muted-foreground space-y-1">
                <Clock size={24} className="mx-auto text-muted-foreground/60 mb-1" />
                <p className="text-xs font-semibold">아직 추가된 공유 일정이 없어요.</p>
                <p className="text-[11px] text-muted-foreground/80">휴가, 면회, 기념일을 추가해보세요!</p>
              </div>
            )}
          </div>
        </section>

        {/* Add Event Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-foreground">새 일정 추가</h3>
                <button onClick={() => setShowAddModal(false)} className="p-1 text-muted-foreground">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-muted-foreground font-bold mb-1">일정 제목 *</label>
                  <input
                    type="text"
                    placeholder="예: 곰신 첫 휴가 / 면회"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full p-3 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:border-coral"
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground font-bold mb-1">일정 유형</label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value as EventType)}
                    className="w-full p-3 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:border-coral"
                  >
                    <option value="visit">면회</option>
                    <option value="vacation">휴가</option>
                    <option value="anniversary">기념일</option>
                    <option value="trip">여행</option>
                    <option value="other">기타 약속</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-muted-foreground font-bold mb-1">시작일 *</label>
                    <input
                      type="date"
                      value={eventStartDate}
                      onChange={(e) => setEventStartDate(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-border bg-background text-foreground text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-muted-foreground font-bold mb-1">종료일 (선택)</label>
                    <input
                      type="date"
                      value={eventEndDate}
                      onChange={(e) => setEventEndDate(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-border bg-background text-foreground text-xs"
                    />
                  </div>
                </div>

                <div className="pt-1 flex items-center justify-between p-3 rounded-2xl bg-muted/40 border border-border">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Lock size={14} className="text-muted-foreground" />
                    <span>나만 보기 (비공개)</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="w-4 h-4 text-coral rounded accent-coral"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowAddModal(false)}
                  disabled={isSaving}
                  className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={handleCreateEvent}
                  disabled={isSaving}
                  className="flex-1 py-3 bg-coral text-white font-bold rounded-xl text-xs shadow-sm active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? '저장 중...' : '등록하기'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
