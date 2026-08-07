import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Heart,
  Lock,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { classifyServerError, serverErrorMessage } from '@/lib/serverErrors';
import { MobileShell } from '@/components/MobileShell';
import { PlanSectionNav } from '@/components/PlanSectionNav';
import {
  dDayLabel,
  eventsOnDate,
  upcomingEvents,
  validateEventDraft,
} from '@/lib/calendar';
import { useEscapeKey } from '@/lib/hooks';
import { nextAnniversaryMilestone } from '@/lib/milestones';
import { daysBetweenLocal, localToday, toLocalDateString } from '@/lib/utils';
import { useStore } from '@/lib/useStore';
import { createTask, deleteTask, fetchTasks, updateTask, validateTaskTitle } from '@/lib/tasks';
import { supabase } from '@/lib/supabase';
import type { CoupleEvent, CoupleTask, EventType } from '@/types';

const EVENT_BADGES: Record<EventType, { label: string; color: string }> = {
  anniversary: { label: '기념일', color: 'bg-purple-500/10 text-purple-600' },
  visit: { label: '면회', color: 'bg-emerald-500/10 text-emerald-600' },
  vacation: { label: '휴가', color: 'bg-coral/10 text-coral' },
  date: { label: '데이트', color: 'bg-pink-500/10 text-pink-600' },
  trip: { label: '여행', color: 'bg-blue-500/10 text-blue-600' },
  other: { label: '기타', color: 'bg-navy/10 text-foreground' },
};

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

export function SchedulePage() {
  const { state, addEvent, updateEvent, deleteEvent, reloadEvents, sharedSyncStatus } = useStore();
  const { profile, events, authenticatedUser } = state;
  const today = toLocalDateString(localToday());
  /** Both partners present: required before a schedule can be shared. */
  const activeCouple = Boolean(
    authenticatedUser?.id &&
      profile.couple.coupleId &&
      profile.couple.connected &&
      profile.couple.status === 'active',
  );
  /**
   * A couple space exists and this account still belongs to it, with or without
   * a partner. Enough to keep a private schedule, which is the author's own row.
   */
  const hasCoupleSpace = Boolean(
    authenticatedUser?.id &&
      profile.couple.coupleId &&
      profile.couple.status !== 'disconnected',
  );
  const scheduleAccessKey = authenticatedUser?.id
    ? `${authenticatedUser.id}:${profile.couple.coupleId || ''}:${profile.couple.connected ? 'connected' : 'disconnected'}:${profile.couple.status}`
    : '';
  const accessKeyRef = useRef(scheduleAccessKey);
  const accessGenerationRef = useRef(0);
  if (accessKeyRef.current !== scheduleAccessKey) {
    accessKeyRef.current = scheduleAccessKey;
    accessGenerationRef.current += 1;
  }
  const captureAccess = useCallback(
    () => ({ key: scheduleAccessKey, generation: accessGenerationRef.current }),
    [scheduleAccessKey],
  );
  const isCurrentAccess = useCallback(
    (access: { key: string; generation: number }) =>
      access.key === accessKeyRef.current
      && access.generation === accessGenerationRef.current
      && access.key !== '',
    [],
  );

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [selectedDate, setSelectedDate] = useState(today);
  const [currMonth, setCurrMonth] = useState(localToday().getMonth());
  const [currYear, setCurrYear] = useState(localToday().getFullYear());
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<EventType>('visit');
  const [eventStartDate, setEventStartDate] = useState(today);
  const [eventEndDate, setEventEndDate] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [talkAbout, setTalkAbout] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isOffline = !useOnlineStatus();
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<CoupleTask[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [taskForMe, setTaskForMe] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const reloadEventsRef = useRef(reloadEvents);
  reloadEventsRef.current = reloadEvents;

  useEscapeKey(
    () => setShowEventModal(false),
    showEventModal && !isSaving && deletingEventId === null,
  );

  useLayoutEffect(() => {
    // Copied event details must never survive an account/workspace/access change.
    setShowEventModal(false);
    setEditingEventId(null);
    setTitle('');
    setEventType('visit');
    setEventStartDate(today);
    setEventEndDate('');
    setIsPrivate(false);
    setTalkAbout(false);
    setFormError(null);
    setIsSaving(false);
    setDeletingEventId(null);
  }, [scheduleAccessKey, today]);

  useEffect(() => {
    if (!authenticatedUser?.id) return;
    let cancelled = false;
    setLoadState('loading');
    void reloadEventsRef.current().then((result) => {
      if (cancelled) return;
      if (result.ok) setLoadState('ready');
      else setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [authenticatedUser?.id, scheduleAccessKey]);

  const refreshTasks = useCallback(async () => {
    const coupleId = profile.couple.coupleId;
    if (!authenticatedUser?.id || !coupleId || !activeCouple) {
      setTasks([]);
      return;
    }
    const access = captureAccess();
    const result = await fetchTasks(coupleId);
    if (!isCurrentAccess(access)) return;
    if (result.ok) setTasks(result.tasks);
  }, [activeCouple, authenticatedUser?.id, captureAccess, isCurrentAccess, profile.couple.coupleId]);

  useEffect(() => {
    void refreshTasks();
    const client = supabase;
    const coupleId = profile.couple.coupleId;
    if (!client || !activeCouple || !coupleId) return;
    const channel = client.channel(`couple-tasks:${coupleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_tasks', filter: `couple_id=eq.${coupleId}` }, () => void refreshTasks())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeCouple, profile.couple.coupleId, refreshTasks]);

  /**
   * Re-read once the shared workspace becomes authoritative again.
   *
   * `reloadEvents` reports `forbidden` while the workspace is QUARANTINED, which is
   * a transient transport state, not a permissions verdict: when the realtime
   * channel cannot be established at all (blocked WebSocket, restrictive network),
   * the store quarantines, then recovers over HTTP a moment later. Without this
   * effect the page's single load attempt landed inside that window and left
   * "일정을 볼 권한이 없어요" on screen permanently, even though the events were
   * available and every other surface showed them.
   *
   * Only a transition INTO a healthy state triggers the retry, so a live workspace
   * does not re-read on every transport flap.
   */
  const previousSyncStatusRef = useRef(sharedSyncStatus);
  /**
   * Read through a ref, NOT a dependency.
   *
   * Depending on `loadState` here would make the effect re-trigger itself: it sets
   * `loading`, the dependency changes, the effect re-runs and its cleanup cancels
   * the in-flight retry -- leaving the page spinning forever.
   */
  const loadStateRef = useRef(loadState);
  loadStateRef.current = loadState;
  useEffect(() => {
    const previous = previousSyncStatusRef.current;
    previousSyncStatusRef.current = sharedSyncStatus;
    if (!authenticatedUser?.id) return;
    if (previous !== 'unavailable' || sharedSyncStatus === 'unavailable') return;
    if (loadStateRef.current === 'ready' || loadStateRef.current === 'loading') return;

    let cancelled = false;
    setLoadState('loading');
    void reloadEventsRef.current().then((result) => {
      if (cancelled) return;
      if (result.ok) setLoadState('ready');
      else setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [authenticatedUser?.id, sharedSyncStatus]);

  const retryLoad = async () => {
    setLoadState('loading');
    const result = await reloadEvents();
    if (result.ok) setLoadState('ready');
    else setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
  };

  const moveMonth = (offset: number) => {
    const next = new Date(currYear, currMonth + offset, 1);
    setCurrYear(next.getFullYear());
    setCurrMonth(next.getMonth());
  };

  const openCreateModal = () => {
    if (!hasCoupleSpace) return;
    setEditingEventId(null);
    setTitle('');
    setEventType('visit');
    setEventStartDate(selectedDate);
    setEventEndDate('');
    // Without a partner there is nobody to share with, so default to private.
    setIsPrivate(!activeCouple);
    setTalkAbout(false);
    setFormError(null);
    setShowEventModal(true);
  };

  const openEditModal = (event: CoupleEvent) => {
    if (event.createdBy !== authenticatedUser?.id) return;
    setEditingEventId(event.id);
    setTitle(event.title);
    setEventType(event.eventType);
    setEventStartDate(event.startDate);
    setEventEndDate(event.endDate || '');
    setIsPrivate(event.isPrivate);
    setTalkAbout(event.talkAbout === true);
    setFormError(null);
    setShowEventModal(true);
  };

  const handleSaveEvent = async () => {
    if (isSaving) return;
    // Pre-emptive: refuse before building a request that can only fail, instead of
    // firing it and then explaining the failure with a cause-blind message.
    if (isOffline) {
      setFormError(OFFLINE_READONLY_MESSAGE);
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    const validationError = validateEventDraft({
      title,
      startDate: eventStartDate,
      endDate: eventEndDate || undefined,
    });
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }
    const editingEvent = editingEventId
      ? events.find((event) => event.id === editingEventId)
      : undefined;
    if (editingEventId && !editingEvent) {
      const message = '이 일정은 더 이상 확인할 수 없어요. 목록을 새로 확인해 주세요.';
      setFormError(message);
      toast.error(message);
      return;
    }
    const canEditPrivateWhileDisconnected = Boolean(
      editingEvent
      && editingEvent.createdBy === authenticatedUser?.id
      && editingEvent.isPrivate
      && isPrivate,
    );
    // Sharing needs a partner; keeping a schedule to yourself does not.
    const canSave = editingEventId
      ? (activeCouple || canEditPrivateWhileDisconnected)
      : (hasCoupleSpace && (isPrivate || activeCouple));
    if (!authenticatedUser || !canSave) {
      const message = editingEventId
        ? '연결이 해제된 동안에는 기존 비공개 일정만 수정할 수 있어요.'
        : hasCoupleSpace
          ? '공유 일정은 파트너와 연결된 뒤에 등록할 수 있어요. 나만 보기로는 지금 저장할 수 있어요.'
          : '로그인하고 우리 공간을 만든 뒤에 새 일정을 저장할 수 있어요.';
      setFormError(message);
      toast.error(message);
      return;
    }

    const access = captureAccess();
    setIsSaving(true);
    setFormError(null);
    const changes = {
      title: title.trim(),
      eventType,
      startDate: eventStartDate,
      endDate: eventEndDate || undefined,
      isPrivate,
      talkAbout: !isPrivate && talkAbout,
    };

    try {
      const saved = editingEventId
        ? await updateEvent(editingEventId, changes)
        : await addEvent({
            coupleId: profile.couple.coupleId!,
            createdBy: authenticatedUser.id,
            ...changes,
          });
      if (!isCurrentAccess(access)) return;
      if (!saved) {
        const message = '일정을 저장하지 못했습니다. 입력 내용은 유지되니 다시 시도해 주세요.';
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success(editingEventId ? '일정이 수정되었습니다.' : '새 일정이 등록되었습니다.');
      setSelectedDate(eventStartDate);
      setShowEventModal(false);
    } catch {
      if (!isCurrentAccess(access)) return;
      const message = '일정을 저장하지 못했습니다. 입력 내용은 유지되니 다시 시도해 주세요.';
      setFormError(message);
      toast.error(message);
    } finally {
      if (isCurrentAccess(access)) setIsSaving(false);
    }
  };

  const handleDeleteEvent = async (event: CoupleEvent) => {
    if (deletingEventId || event.createdBy !== authenticatedUser?.id) return;
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    const access = captureAccess();
    setDeletingEventId(event.id);
    try {
      const deleted = await deleteEvent(event.id);
      if (!isCurrentAccess(access)) return;
      if (deleted) toast.success('일정이 삭제되었습니다.');
      // A refused delete is an authorization/ownership answer far more often than a
      // transport failure, so the copy must not promise that retrying will help.
      else toast.error(`일정을 삭제하지 못했습니다. ${serverErrorMessage('forbidden')}`);
    } catch (error) {
      if (!isCurrentAccess(access)) return;
      toast.error(`일정을 삭제하지 못했습니다. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentAccess(access)) setDeletingEventId(null);
    }
  };

  const handleCreateTask = async () => {
    if (isSavingTask || isOffline || !authenticatedUser?.id || !profile.couple.coupleId || !activeCouple) return;
    const error = validateTaskTitle(taskTitle);
    if (error) {
      toast.error(error);
      return;
    }
    const access = captureAccess();
    setIsSavingTask(true);
    try {
      const saved = await createTask({
        coupleId: profile.couple.coupleId,
        createdBy: authenticatedUser.id,
        title: taskTitle,
        dueDate: selectedDate,
        dueTime: taskTime || undefined,
        assigneeId: taskForMe ? authenticatedUser.id : undefined,
        isPrivate: false,
      });
      if (!isCurrentAccess(access)) return;
      if (!saved) {
        toast.error('할 일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setTasks((current) => [...current, saved]);
      setTaskTitle('');
      setTaskTime('');
      toast.success('우리 할 일에 추가했습니다.');
    } finally {
      if (isCurrentAccess(access)) setIsSavingTask(false);
    }
  };

  const handleToggleTask = async (task: CoupleTask) => {
    if (pendingTaskIds.has(task.id) || isOffline) return;
    setPendingTaskIds((current) => new Set(current).add(task.id));
    const saved = await updateTask(task, { completed: !task.completed });
    setPendingTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
    if (!saved) {
      toast.error('할 일 상태를 저장하지 못했어요.');
      return;
    }
    setTasks((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
  };

  const handleDeleteTask = async (task: CoupleTask) => {
    if (pendingTaskIds.has(task.id) || task.createdBy !== authenticatedUser?.id || isOffline) return;
    setPendingTaskIds((current) => new Set(current).add(task.id));
    const deleted = await deleteTask(task);
    setPendingTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
    if (deleted) setTasks((current) => current.filter((entry) => entry.id !== task.id));
    else toast.error('할 일을 삭제하지 못했어요.');
  };

  const selectedEvents = eventsOnDate(events, selectedDate).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const selectedTasks = tasks.filter((task) => task.dueDate === selectedDate)
    .sort((a, b) => (a.completed === b.completed ? (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') : Number(a.completed) - Number(b.completed)));
  const upcoming = upcomingEvents(events, today);
  const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currYear, currMonth, 1).getDay();
  const anniversaryDate = profile.couple.anniversaryDate;
  const daysTogether = anniversaryDate ? daysBetweenLocal(anniversaryDate, today) + 1 : null;
  const nextMilestone = nextAnniversaryMilestone(anniversaryDate, today);

  const renderEventCard = (event: CoupleEvent, history = false) => {
    const badge = EVENT_BADGES[event.eventType];
    const isAuthor = event.createdBy === authenticatedUser?.id;
    const isOngoing = event.startDate < today && (event.endDate || event.startDate) >= today;
    return (
      <div
        key={event.id}
        className="rounded-2xl bg-card border border-border p-4 shadow-sm flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 shrink-0 rounded-xl ${badge.color} flex items-center justify-center font-bold text-xs`}>
            {badge.label}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-foreground truncate">{event.title}</h3>
              {event.isPrivate ? (
                <span title="나만 보기"><Lock size={12} className="text-muted-foreground" /></span>
              ) : (
                <span title="둘이 보기"><Users size={12} className="text-muted-foreground" /></span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {event.startDate}{event.endDate ? ` ~ ${event.endDate}` : ''}
            </p>
            {event.talkAbout && <p className="mt-1 text-[10px] font-bold text-coral">♥ 통화 때 꼭 얘기</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`px-2 py-1 rounded-xl font-bold text-[11px] ${badge.color}`}>
            {isOngoing && !history ? '진행 중' : dDayLabel(event.startDate, today)}
          </span>
          {isAuthor && (
            <>
              <button
                type="button"
                onClick={() => openEditModal(event)}
                disabled={isSaving || deletingEventId !== null || isOffline}
                aria-label={`${event.title} 일정 수정`}
                className="p-1.5 text-muted-foreground hover:text-coral rounded-lg disabled:opacity-40"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteEvent(event)}
                disabled={deletingEventId !== null || isSaving || isOffline}
                aria-label={`${event.title} 일정 삭제`}
                className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <MobileShell>
      <div className="pb-28 px-5 pt-8 space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">우리의 계획</h1>
            <p className="mt-1 text-xs text-muted-foreground">둘이 볼 일정과 나만의 일정을 한곳에서 관리해요.</p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            disabled={!hasCoupleSpace || loadState !== 'ready' || isOffline}
            className="p-2.5 rounded-xl bg-coral-strong text-coral-strong-foreground font-bold text-xs flex items-center gap-1 shadow-sm active:scale-95 transition min-h-[44px] disabled:opacity-40 disabled:active:scale-100"
          >
            <Plus size={16} />
            <span>일정 추가</span>
          </button>
        </header>

        {/* 여행 is one tap away from here now, instead of hidden behind a
            deletable home widget. */}
        <PlanSectionNav active="schedule" />

        {!authenticatedUser ? (
          <StatusCard
            icon={<ShieldAlert size={24} />}
            title="로그인 권한이 필요해요"
            description="일정은 계정과 연결된 공간에서만 안전하게 확인하고 등록할 수 있어요."
          />
        ) : loadState === 'loading' ? (
          <StatusCard
            icon={<RefreshCw size={24} className="animate-spin" />}
            title="일정을 불러오는 중이에요"
            description="공유 범위를 확인해 안전하게 가져오고 있어요."
          />
        ) : loadState === 'forbidden' ? (
          <StatusCard
            icon={<ShieldAlert size={24} />}
            title="일정을 볼 권한이 없어요"
            description="연결 상태나 계정 권한을 확인한 뒤 다시 시도해 주세요."
            actionLabel="다시 시도"
            onAction={() => void retryLoad()}
          />
        ) : loadState === 'error' ? (
          <StatusCard
            icon={<RefreshCw size={24} />}
            title="일정을 불러오지 못했어요"
            description="서버 연결을 확인한 뒤 다시 시도해 주세요. 기존 일정이 없는 상태와는 다른 오류예요."
            actionLabel="다시 시도"
            onAction={() => void retryLoad()}
          />
        ) : (
          <>
            {!activeCouple && (
              <StatusCard
                icon={<Users size={24} />}
                title={profile.couple.status === 'pending' ? '파트너 연결을 기다리고 있어요' : '연결된 우리 공간이 없어요'}
                description={profile.couple.status === 'pending'
                  ? '지금은 나만 보기 일정만 등록할 수 있어요. 공유 일정은 파트너가 연결되면 열려요.'
                  : '기존 비공개 일정만 본인이 계속 확인·수정할 수 있어요. 새 일정과 공유 일정은 연결 후 이용할 수 있어요.'}
              />
            )}
            <section className="rounded-3xl bg-card border border-border p-5 shadow-sm space-y-3">
              {anniversaryDate && daysTogether !== null ? (
                <>
                  <div className="flex items-center justify-between text-xs font-bold text-coral">
                    <span className="flex items-center gap-1.5"><Heart size={14} className="fill-coral" />함께한 지</span>
                    <span className="text-muted-foreground font-medium">사귄 날 {anniversaryDate}</span>
                  </div>
                  <div className="text-3xl font-extrabold text-foreground">
                    {daysTogether > 0 ? `+${daysTogether}일` : dDayLabel(anniversaryDate, today)}
                  </div>
                  {nextMilestone && (
                    <p className="text-[11px] text-muted-foreground">
                      다음 {nextMilestone.label}은 {nextMilestone.date}, D-{nextMilestone.daysRemaining}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Heart size={20} />
                  <div>
                    <p className="text-xs font-bold text-foreground">등록된 사귄 날이 없어요</p>
                    <p className="text-[11px] mt-0.5">프로필에 실제 기념일을 등록하면 관계 D-Day를 보여드려요.</p>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-3xl bg-card border border-border p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-foreground">{currYear}년 {currMonth + 1}월</h2>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달" className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted">
                    <ChevronLeft size={16} />
                  </button>
                  <button type="button" onClick={() => moveMonth(1)} aria-label="다음 달" className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-muted-foreground pb-1">
                <span className="text-red-400">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span className="text-blue-400">토</span>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {Array.from({ length: firstDayOfWeek }).map((_, index) => <div key={`empty-${index}`} className="h-11" />)}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const date = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayEvents = eventsOnDate(events, date);
                  const dayTasks = tasks.filter((task) => task.dueDate === date && !task.completed);
                  const isToday = date === today;
                  const isSelected = date === selectedDate;
                  return (
                    <button
                      type="button"
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      aria-label={`${date}, 일정 ${dayEvents.length}개, 남은 할 일 ${dayTasks.length}개`}
                      aria-pressed={isSelected}
                      className={`h-11 rounded-xl flex flex-col items-center justify-center text-xs font-semibold transition ${
                        isSelected
                          ? 'ring-2 ring-coral bg-coral/10 text-coral'
                          : isToday
                            ? 'bg-coral-strong text-coral-strong-foreground font-extrabold shadow-sm'
                            : 'hover:bg-muted/50 text-foreground'
                      }`}
                    >
                      <span>{day}</span>
                      {dayEvents.length > 0 && (
                        <span className="flex gap-0.5 mt-1" aria-hidden="true">
                          {dayEvents.slice(0, 3).map((event) => (
                            <span key={event.id} className={`w-1.5 h-1.5 rounded-full ${event.isPrivate ? 'bg-muted-foreground' : isToday && !isSelected ? 'bg-coral-strong-foreground' : 'bg-coral'}`} />
                          ))}
                        </span>
                      )}
                      {dayTasks.length > 0 && <span className="w-1.5 h-1.5 rounded-sm bg-indigo-500 mt-0.5" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-bold text-foreground">{selectedDate} 한눈에 보기</h2>
                <button type="button" onClick={openCreateModal} disabled={!hasCoupleSpace || isOffline} className="text-[11px] font-bold text-coral disabled:opacity-40">이 날짜에 추가</button>
              </div>
              {activeCouple && <div className="rounded-2xl bg-card border border-border p-3 space-y-2">
                <div className="flex gap-2">
                  <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value.slice(0, 120))} onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateTask(); }} placeholder="우리 할 일 빠르게 추가" className="flex-1 min-w-0 bg-muted rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-400/40" />
                  <input type="time" value={taskTime} onChange={(event) => setTaskTime(event.target.value)} aria-label="할 일 시간" className="w-[92px] bg-muted rounded-xl px-2 py-2.5 text-xs" />
                  <button type="button" onClick={() => void handleCreateTask()} disabled={isSavingTask || !taskTitle.trim() || isOffline} className="px-3 rounded-xl bg-indigo-500 text-white text-xs font-bold disabled:opacity-40">추가</button>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground"><input type="checkbox" checked={taskForMe} onChange={(event) => setTaskForMe(event.target.checked)} className="accent-indigo-500" />내 담당으로 표시</label>
              </div>}
              <div className="space-y-2">
                {selectedTasks.map((task) => {
                  const pending = pendingTaskIds.has(task.id);
                  return <div key={task.id} className="rounded-2xl bg-card border border-border px-4 py-3 flex items-center gap-3">
                    <button type="button" onClick={() => void handleToggleTask(task)} disabled={pending || isOffline} aria-label={`${task.title} ${task.completed ? '미완료로 변경' : '완료로 변경'}`} className="text-indigo-500 disabled:opacity-40">{task.completed ? <CheckCircle2 size={21} /> : <Circle size={21} />}</button>
                    <div className="flex-1 min-w-0"><p className={`text-xs font-bold truncate ${task.completed ? 'line-through text-muted-foreground' : ''}`}>{task.title}</p><p className="text-[10px] text-muted-foreground">{task.dueTime || '시간 미정'} · {task.assigneeId === authenticatedUser?.id ? '내 담당' : '함께'}</p></div>
                    {task.createdBy === authenticatedUser?.id && <button type="button" onClick={() => void handleDeleteTask(task)} disabled={pending || isOffline} aria-label={`${task.title} 할 일 삭제`} className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-40"><Trash2 size={14} /></button>}
                  </div>;
                })}
                {selectedEvents.map((event) => renderEventCard(event, true))}
                {selectedEvents.length === 0 && selectedTasks.length === 0 && (
                  <div className="rounded-2xl bg-card border border-dashed border-border/80 p-5 text-center text-muted-foreground">
                    <ListTodo size={22} className="mx-auto mb-1 opacity-60" />
                    <p className="text-xs font-semibold">선택한 날짜에 일정과 할 일이 없어요.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-bold text-foreground px-1">다가오는 일정</h2>
              <div className="space-y-2">
                {upcoming.length > 0 ? upcoming.map((event) => renderEventCard(event)) : (
                  <div className="rounded-2xl bg-card border border-dashed border-border/80 p-6 text-center text-muted-foreground space-y-1">
                    <Clock size={24} className="mx-auto mb-1 opacity-60" />
                    <p className="text-xs font-semibold">다가오는 일정이 없어요.</p>
                    <p className="text-[11px]">지난 일정은 날짜를 선택하면 다시 볼 수 있어요.</p>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {showEventModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="event-modal-title" className="bg-card rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-border">
              <div className="flex items-center justify-between">
                <h3 id="event-modal-title" className="text-base font-bold text-foreground">{editingEventId ? '일정 수정' : '새 일정 추가'}</h3>
                <button type="button" onClick={() => setShowEventModal(false)} disabled={isSaving} aria-label="닫기" className="p-1 text-muted-foreground disabled:opacity-40"><X size={18} /></button>
              </div>
              <div className="space-y-3 text-xs">
                <div>
                  <label htmlFor="event-title" className="block text-muted-foreground font-bold mb-1">일정 제목 *</label>
                  <input id="event-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 첫 휴가 / 주말 데이트" className="w-full p-3 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:border-coral" />
                </div>
                <div>
                  <label htmlFor="event-type" className="block text-muted-foreground font-bold mb-1">일정 유형</label>
                  <select id="event-type" value={eventType} onChange={(event) => setEventType(event.target.value as EventType)} className="w-full p-3 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:border-coral">
                    {(Object.entries(EVENT_BADGES) as [EventType, { label: string; color: string }][]).map(([value, badge]) => <option key={value} value={value}>{badge.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="event-start" className="block text-muted-foreground font-bold mb-1">시작일 *</label>
                    <input id="event-start" type="date" value={eventStartDate} onChange={(event) => setEventStartDate(event.target.value)} className="w-full p-2.5 rounded-xl border border-border bg-background text-foreground text-xs" />
                  </div>
                  <div>
                    <label htmlFor="event-end" className="block text-muted-foreground font-bold mb-1">종료일</label>
                    <input id="event-end" type="date" value={eventEndDate} onChange={(event) => setEventEndDate(event.target.value)} className="w-full p-2.5 rounded-xl border border-border bg-background text-foreground text-xs" />
                  </div>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-muted-foreground font-bold">공개 범위 *</legend>
                  <label className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer ${!isPrivate ? 'border-coral bg-coral/5' : 'border-border'}`}>
                    <input type="radio" name="visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} disabled={!activeCouple} className="accent-coral" />
                    <Users size={15} className="text-coral" />
                    <span><strong className="block text-foreground">둘이 보기 (공유)</strong><span className="text-[10px] text-muted-foreground">연결된 파트너도 읽을 수 있어요.</span></span>
                  </label>
                  <label className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer ${isPrivate ? 'border-coral bg-coral/5' : 'border-border'}`}>
                    <input type="radio" name="visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} className="accent-coral" />
                    <Lock size={15} className="text-muted-foreground" />
                    <span><strong className="block text-foreground">나만 보기 (비공개)</strong><span className="text-[10px] text-muted-foreground">작성자 본인만 읽을 수 있어요.</span></span>
                  </label>
                </fieldset>
                {!isPrivate && <label className="flex items-center gap-2 rounded-xl bg-coral/5 px-3 py-3 font-bold text-coral"><input type="checkbox" checked={talkAbout} onChange={(event) => setTalkAbout(event.target.checked)} className="accent-coral" />통화 때 꼭 얘기</label>}
                {formError && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] font-semibold text-destructive">{formError}</p>}
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowEventModal(false)} disabled={isSaving} className="flex-1 py-3 bg-muted text-foreground font-bold rounded-xl text-xs disabled:opacity-50">취소</button>
                <button type="button" onClick={() => void handleSaveEvent()} disabled={isSaving || isOffline} className="flex-1 py-3 bg-coral-strong text-coral-strong-foreground font-bold rounded-xl text-xs shadow-sm active:scale-95 disabled:opacity-50">
                  {isSaving ? '저장 중...' : editingEventId ? '수정하기' : '등록하기'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}

function StatusCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="rounded-3xl bg-card border border-border p-7 text-center shadow-sm space-y-3">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-muted text-muted-foreground flex items-center justify-center">{icon}</div>
      <div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-5">{description}</p>
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="px-4 py-2.5 rounded-xl bg-coral-strong text-coral-strong-foreground text-xs font-bold">{actionLabel}</button>
      )}
    </section>
  );
}
